# app/api/mt5.py
"""
MT5 연동 API - 마틴게일, WebSocket 포함 완벽 버전
Trading-X Backend
"""

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query, status, Body
from typing import List
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False
import asyncio
import json
import httpx
import random
from datetime import datetime, timedelta

from ..database import get_db
from ..utils.crypto import encrypt, decrypt

# ========== 외부 API 캔들 데이터 조회 ==========
async def fetch_binance_candles(symbol: str, timeframe: str, count: int):
    """Binance API에서 캔들 데이터 조회"""
    # 심볼 매핑
    binance_symbol = None
    if "BTC" in symbol:
        binance_symbol = "BTCUSDT"
    elif "ETH" in symbol:
        binance_symbol = "ETHUSDT"
    else:
        return []

    # 타임프레임 매핑
    interval_map = {
        "M1": "1m", "M5": "5m", "M15": "15m", "M30": "30m",
        "H1": "1h", "H4": "4h", "D1": "1d", "W1": "1w", "MN1": "1M"
    }
    interval = interval_map.get(timeframe, "5m")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://api.binance.com/api/v3/klines",
                params={
                    "symbol": binance_symbol,
                    "interval": interval,
                    "limit": min(count, 1000)
                }
            )
            if response.status_code == 200:
                data = response.json()
                candles = []
                for item in data:
                    candles.append({
                        "time": int(item[0] / 1000),  # ms -> s
                        "open": float(item[1]),
                        "high": float(item[2]),
                        "low": float(item[3]),
                        "close": float(item[4]),
                        "volume": int(float(item[5]))
                    })
                return candles
    except Exception as e:
        print(f"[Binance API] Error: {e}")

    return []
from ..models.user import User
from ..utils.security import decode_token
from ..services.indicator_service import IndicatorService
from ..services.martin_service import martin_service

# ============================================================
# MT5 비활성화 플래그 import
# 다시 활성화하려면 mt5_service.py의 MT5_DISABLED = False로 변경
# ============================================================
from ..services.mt5_service import MT5_DISABLED

# ========== MT5 브릿지 데이터 캐시 (전역) ==========
# Windows MT5 브릿지에서 전송된 데이터를 저장
bridge_cache = {
    "prices": {},
    "positions": [],  # ★Bridge 포지션 캐시
    "candles": {},     # {"BTCUSD": {"M1": [...], "M5": [...], "H1": [...], ...}}
    "account": {},     # {"broker": "...", "login": ..., "balance": ..., ...}
    "symbol_info": {}, # {"BTCUSD": {"tick_size": ..., "tick_value": ..., ...}}
    "last_update": 0   # 마지막 업데이트 시간
}

# ========== 주문 대기열 (브릿지용) - 파일 기반 ==========
# Linux에서 주문을 받아 Windows 브릿지가 실행
# 워커 간 공유를 위해 파일 기반으로 구현
import uuid
import fcntl

ORDER_QUEUE_FILE = "/tmp/mt5_orders.json"
ORDER_RESULTS_FILE = "/tmp/mt5_order_results.json"
BRIDGE_HEARTBEAT_FILE = "/tmp/mt5_bridge_heartbeat"

# ★★★ 유저별 라이브 데이터 캐시 (주문/청산 후 업데이트) ★★★
user_live_cache = {}

# ★★★ 유저별 타겟 금액 캐시 (자동청산용) ★★★
user_target_cache = {}

# ★★★ 자동청산 쿨다운 (중복 방지) ★★★
auto_close_cooldown = {}

# ★★★ 심볼별 스펙 (실시간 P/L 계산용) ★★★
SYMBOL_SPECS = {
    "BTCUSD":   {"contract_size": 1,      "tick_size": 0.01,    "tick_value": 0.01},
    "ETHUSD":   {"contract_size": 1,      "tick_size": 0.01,    "tick_value": 0.01},
    "XAUUSD.r": {"contract_size": 100,    "tick_size": 0.01,    "tick_value": 1.0},
    "EURUSD.r": {"contract_size": 100000, "tick_size": 0.00001, "tick_value": 1.0},
    "USDJPY.r": {"contract_size": 100000, "tick_size": 0.001,   "tick_value": 0.67},
    "GBPUSD.r": {"contract_size": 100000, "tick_size": 0.00001, "tick_value": 1.0},
    "AUDUSD.r": {"contract_size": 100000, "tick_size": 0.00001, "tick_value": 1.0},
    "USDCAD.r": {"contract_size": 100000, "tick_size": 0.00001, "tick_value": 0.74},
    "US100.":   {"contract_size": 20,     "tick_size": 0.01,    "tick_value": 0.2},
}

def calculate_realtime_profit(pos_type: int, symbol: str, volume: float, open_price: float, current_bid: float, current_ask: float) -> float:
    """실시간 P/L 계산"""
    specs = SYMBOL_SPECS.get(symbol, {"contract_size": 1, "tick_size": 0.01, "tick_value": 0.01})
    contract_size = specs["contract_size"]
    tick_size = specs["tick_size"]
    tick_value = specs["tick_value"]

    if pos_type == 0:  # BUY
        price_diff = current_bid - open_price
    else:  # SELL
        price_diff = open_price - current_ask

    # P/L = (price_diff / tick_size) * tick_value * volume
    if tick_size > 0:
        profit = (price_diff / tick_size) * tick_value * volume
    else:
        profit = price_diff * volume * contract_size

    return round(profit, 2)

def update_bridge_heartbeat():
    """브릿지 하트비트 파일에 현재 시간 기록"""
    import time as time_module
    try:
        with open(BRIDGE_HEARTBEAT_FILE, 'w') as f:
            f.write(str(time_module.time()))
    except Exception:
        pass

def get_bridge_heartbeat() -> float:
    """브릿지 하트비트 파일에서 마지막 업데이트 시간 읽기"""
    try:
        with open(BRIDGE_HEARTBEAT_FILE, 'r') as f:
            return float(f.read().strip())
    except (FileNotFoundError, ValueError):
        return 0

def _read_order_queue() -> list:
    """주문 대기열 읽기 (잠금 적용)"""
    try:
        with open(ORDER_QUEUE_FILE, 'r') as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_SH)
            data = json.load(f)
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []

def _write_order_queue(data: list):
    """주문 대기열 쓰기 (잠금 적용)"""
    with open(ORDER_QUEUE_FILE, 'w') as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        json.dump(data, f)
        fcntl.flock(f.fileno(), fcntl.LOCK_UN)

def append_order(order_data: dict):
    """주문 대기열에 추가"""
    queue = _read_order_queue()
    queue.append(order_data)
    _write_order_queue(queue)

def pop_all_orders() -> list:
    """모든 대기 주문 가져오고 비우기"""
    queue = _read_order_queue()
    _write_order_queue([])
    return queue

def _read_order_results() -> dict:
    """주문 결과 읽기 (잠금 적용)"""
    try:
        with open(ORDER_RESULTS_FILE, 'r') as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_SH)
            data = json.load(f)
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def _write_order_results(data: dict):
    """주문 결과 쓰기 (잠금 적용)"""
    with open(ORDER_RESULTS_FILE, 'w') as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        json.dump(data, f)
        fcntl.flock(f.fileno(), fcntl.LOCK_UN)

def set_order_result(order_id: str, result: dict):
    """주문 결과 저장"""
    results = _read_order_results()
    results[order_id] = result
    _write_order_results(results)

def pop_order_result(order_id: str) -> dict:
    """주문 결과 가져오고 삭제"""
    results = _read_order_results()
    result = results.pop(order_id, None)
    if result:
        _write_order_results(results)
    return result

# ========== 계정 검증 대기열 (브릿지용) - 파일 기반 ==========
# 워커 간 공유를 위해 파일 기반으로 구현

VERIFY_PENDING_FILE = "/tmp/mt5_verify_pending.json"
VERIFY_RESULTS_FILE = "/tmp/mt5_verify_results.json"

def _read_json_file(filepath: str) -> dict:
    """파일에서 JSON 읽기 (잠금 적용)"""
    try:
        with open(filepath, 'r') as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_SH)
            data = json.load(f)
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            return data
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def _write_json_file(filepath: str, data: dict):
    """파일에 JSON 쓰기 (잠금 적용)"""
    with open(filepath, 'w') as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        json.dump(data, f)
        fcntl.flock(f.fileno(), fcntl.LOCK_UN)

def get_pending_verifications() -> dict:
    """대기 중인 검증 요청 조회"""
    return _read_json_file(VERIFY_PENDING_FILE)

def set_pending_verification(verify_id: str, data: dict):
    """검증 요청 추가"""
    pending = get_pending_verifications()
    pending[verify_id] = data
    _write_json_file(VERIFY_PENDING_FILE, pending)

def remove_pending_verification(verify_id: str):
    """검증 요청 제거"""
    pending = get_pending_verifications()
    pending.pop(verify_id, None)
    _write_json_file(VERIFY_PENDING_FILE, pending)

def get_verification_results() -> dict:
    """검증 결과 조회"""
    return _read_json_file(VERIFY_RESULTS_FILE)

def set_verification_result(verify_id: str, result: dict):
    """검증 결과 저장"""
    results = get_verification_results()
    results[verify_id] = result
    _write_json_file(VERIFY_RESULTS_FILE, results)

def pop_verification_result(verify_id: str) -> dict:
    """검증 결과 가져오고 삭제"""
    results = get_verification_results()
    result = results.pop(verify_id, None)
    _write_json_file(VERIFY_RESULTS_FILE, results)
    return result

def get_bridge_prices():
    """브릿지 캐시에서 가격 데이터 조회"""
    return bridge_cache["prices"]

def get_bridge_candles(symbol: str, timeframe: str = "M5"):
    """브릿지 캐시에서 캔들 데이터 조회 (타임프레임별)"""
    symbol_data = bridge_cache["candles"].get(symbol, {})
    return symbol_data.get(timeframe, [])

def mt5_initialize_safe() -> bool:
    """MT5 초기화 래퍼 함수 (비활성화 체크 포함)"""
    if not MT5_AVAILABLE:
        print("[MT5] MetaTrader5 모듈을 사용할 수 없습니다 (Linux 환경)")
        return False
    if MT5_DISABLED:
        print("[MT5 비활성화됨] MT5 초기화를 건너뜁니다.")
        return False
    return mt5.initialize()

router = APIRouter(prefix="/mt5", tags=["MT5"])
security = HTTPBearer()


# ========== 인증 함수 ==========
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """JWT 토큰에서 현재 사용자 가져오기"""
    token = credentials.credentials
    payload = decode_token(token)
    
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 토큰입니다"
        )
    
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 토큰입니다"
        )
    
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다"
        )
    
    return user


    # ========== 계정 정보 ==========
@router.get("/account-info")
async def get_account_info(current_user: User = Depends(get_current_user)):
    """MT5 계정 정보 + 인디케이터 + 포지션 조회"""
    try:
        if not mt5_initialize_safe():
            # MT5 없음 - bridge_cache에서 계정 정보 조회
            cached_account = bridge_cache.get("account", {})
            cached_positions = bridge_cache.get("positions", [])

            # 인디케이터 계산
            try:
                indicators = IndicatorService.calculate_all_indicators("BTCUSD")
                buy_count = indicators["buy"]
                sell_count = indicators["sell"]
                neutral_count = indicators["neutral"]
                base_score = indicators["score"]
            except Exception:
                buy_count, sell_count, neutral_count, base_score = 33, 33, 34, 50

            # Buy/Sell 패널용 포지션 (magic=100001)
            position_data = None
            for pos in cached_positions:
                if pos.get("magic") == 100001:
                    position_data = {
                        "type": "BUY" if pos.get("type", 0) == 0 else "SELL",
                        "symbol": pos.get("symbol", ""),
                        "volume": pos.get("volume", 0),
                        "entry": pos.get("price_open", 0),
                        "profit": pos.get("profit", 0),
                        "ticket": pos.get("ticket", 0),
                        "magic": pos.get("magic", 0)
                    }
                    break

            # ★★★ 유저 DB 값 사용 (브릿지 계좌 노출 방지) ★★★
            if current_user.has_mt5_account and current_user.mt5_account_number:
                return {
                    "broker": "Live Account",
                    "account": current_user.mt5_account_number,
                    "server": current_user.mt5_server or "HedgeHood-MT5",
                    "balance": current_user.mt5_balance or 0,
                    "equity": current_user.mt5_equity or current_user.mt5_balance or 0,
                    "margin": current_user.mt5_margin or 0,
                    "free_margin": current_user.mt5_free_margin or current_user.mt5_balance or 0,
                    "profit": current_user.mt5_profit or 0,
                    "leverage": current_user.mt5_leverage or 500,
                    "currency": current_user.mt5_currency or "USD",
                    "positions_count": len(cached_positions),
                    "position": position_data,
                    "buy_count": buy_count,
                    "sell_count": sell_count,
                    "neutral_count": neutral_count,
                    "base_score": base_score,
                    "prices": get_bridge_prices(),
                    "martin": martin_service.get_state(),
                    "has_mt5": True
                }
            else:
                # MT5 계정 없음 - 기본값 반환
                return {
                    "broker": "N/A",
                    "account": "N/A",
                    "server": "N/A",
                    "balance": 0,
                    "equity": 0,
                    "margin": 0,
                    "free_margin": 0,
                    "profit": 0,
                    "leverage": 500,
                    "positions_count": 0,
                    "position": None,
                    "buy_count": buy_count,
                    "sell_count": sell_count,
                    "neutral_count": neutral_count,
                    "base_score": base_score,
                    "prices": get_bridge_prices(),
                    "martin": martin_service.get_state(),
                    "has_mt5": False
                }

        account = mt5.account_info()
        if not account:
            raise HTTPException(status_code=500, detail="계정 정보 없음")
        
        # 포지션 정보
        positions = mt5.positions_get()
        positions_count = len(positions) if positions else 0
        
        position_data = None
        if positions and len(positions) > 0:
            # Buy/Sell 패널용 포지션 (magic=100001)
            buysell_pos = None
            for pos in positions:
                if pos.magic == 100001:
                    buysell_pos = pos
                    break
            
            if buysell_pos:
                position_data = {
                    "type": "BUY" if buysell_pos.type == 0 else "SELL",
                    "symbol": buysell_pos.symbol,
                    "volume": buysell_pos.volume,
                    "entry": buysell_pos.price_open,
                    "profit": buysell_pos.profit,
                    "ticket": buysell_pos.ticket,
                    "magic": buysell_pos.magic
                }
        
        # 인디케이터 계산
        try:
            indicators = IndicatorService.calculate_all_indicators("BTCUSD")
            buy_count = indicators["buy"]
            sell_count = indicators["sell"]
            neutral_count = indicators["neutral"]
            base_score = indicators["score"]
        except Exception as e:
            print(f"인디케이터 계산 오류: {e}")
            buy_count = 33
            sell_count = 33
            neutral_count = 34
            base_score = 50
        
        # 모든 심볼 가격
        symbols_list = ["BTCUSD", "EURUSD.r", "USDJPY.r", "XAUUSD.r", "US100."]
        prices = {}
        for sym in symbols_list:
            tick = mt5.symbol_info_tick(sym)
            if tick:
                prices[sym] = {"bid": tick.bid, "ask": tick.ask}
        
        # ★ 유저가 등록한 계좌 정보만 사용 (브릿지 계좌 노출 방지)
        if current_user.has_mt5_account and current_user.mt5_account_number:
            user_account = current_user.mt5_account_number
            user_server = current_user.mt5_server or "HedgeHood-MT5"
        else:
            user_account = "N/A"
            user_server = "N/A"

        return {
            "broker": account.company,
            "account": user_account,  # ★ 유저 계좌 우선
            "server": user_server,    # ★ 유저 서버 우선
            "balance": account.balance,
            "equity": account.equity,
            "margin": account.margin,
            "free_margin": account.margin_free,
            "leverage": account.leverage,
            "positions_count": positions_count,
            "position": position_data,
            "buy_count": buy_count,
            "sell_count": sell_count,
            "neutral_count": neutral_count,
            "base_score": base_score,
            "prices": prices,
            "martin": martin_service.get_state(),
            "has_mt5": current_user.has_mt5_account  # ★ MT5 연결 상태 추가
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ========== 캔들 데이터 ==========
@router.get("/candles/{symbol}")
async def get_candles(
    symbol: str,
    timeframe: str = "M1",
    count: int = 1000
):
    """캔들 데이터 + 인디케이터 조회"""
    candles = []
    closes = []
    highs = []
    lows = []

    if mt5_initialize_safe():
        # MT5 사용 가능
        tf_map = {
            "M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5,
            "M15": mt5.TIMEFRAME_M15, "M30": mt5.TIMEFRAME_M30,
            "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4,
            "D1": mt5.TIMEFRAME_D1, "W1": mt5.TIMEFRAME_W1,
            "MN1": mt5.TIMEFRAME_MN1,
        }
        tf = tf_map.get(timeframe, mt5.TIMEFRAME_M1)

        if not mt5.symbol_select(symbol, True):
            import time
            time.sleep(0.5)
            mt5.symbol_select(symbol, True)

        rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)

        if rates is not None and len(rates) > 0:
            for r in rates:
                candles.append({
                    "time": int(r['time']),
                    "open": float(r['open']),
                    "high": float(r['high']),
                    "low": float(r['low']),
                    "close": float(r['close']),
                    "volume": int(r['tick_volume'])
                })
                closes.append(r['close'])
                highs.append(r['high'])
                lows.append(r['low'])
    else:
        # MT5 없음 - 브릿지 캐시에서 가져오기 (타임프레임별)
        cached_candles = get_bridge_candles(symbol, timeframe)
        if cached_candles:
            candles = cached_candles[-count:] if len(cached_candles) > count else cached_candles
            closes = [c['close'] for c in candles]
            highs = [c['high'] for c in candles]
            lows = [c['low'] for c in candles]
            print(f"[Candles] {symbol}/{timeframe} - 브릿지 캐시에서 {len(candles)}개 로드")

    if not candles:
        # MT5도 없고 브릿지 캐시도 없으면 → Binance API fallback
        try:
            candles = await fetch_binance_candles(symbol, timeframe, count)
            if candles:
                closes = [c['close'] for c in candles]
                highs = [c['high'] for c in candles]
                lows = [c['low'] for c in candles]
                print(f"[Candles] {symbol}/{timeframe} - Binance API에서 {len(candles)}개 로드")
        except Exception as e:
            print(f"[Candles] Binance API fallback error: {e}")

    if not candles:
        return {"candles": [], "indicators": {}, "source": "no_data", "timeframe": timeframe}

    # 인디케이터 계산
    indicators = IndicatorService.calculate_chart_indicators(candles, closes, highs, lows)

    return {"candles": candles, "indicators": indicators}


# ========== 인디케이터 전용 (인증 불필요) ==========
@router.get("/indicators/{symbol}")
async def get_indicators(symbol: str = "BTCUSD"):
    """인디케이터만 조회 (게스트 모드용)"""
    if mt5_initialize_safe():
        try:
            indicators = IndicatorService.calculate_all_indicators(symbol)
            return indicators
        except Exception as e:
            print(f"인디케이터 오류: {e}")

    # MT5 없을 때 - Binance 캔들로 인디케이터 계산
    candles = await fetch_binance_candles(symbol, "M5", 100)
    if candles:
        closes = [c['close'] for c in candles]
        highs = [c['high'] for c in candles]
        lows = [c['low'] for c in candles]
        indicators = IndicatorService.calculate_chart_indicators(candles, closes, highs, lows)
        # 기본 형식으로 변환
        buy = indicators.get("summary", {}).get("buy", 35)
        sell = indicators.get("summary", {}).get("sell", 30)
        neutral = 100 - buy - sell
        score = 50 + (buy - sell) / 2
        return {"buy": buy, "sell": sell, "neutral": neutral, "score": score}

    return {"buy": 35, "sell": 30, "neutral": 35, "score": 52}


# ========== 브릿지 데이터 수신 (인증 불필요) ==========
# 중요: 구체적인 경로(/bridge/account)가 동적 경로(/bridge/{symbol})보다 먼저 와야 함!
# ★ Bridge 포지션 수신
@router.post("/bridge/positions")
async def receive_bridge_positions(data: dict):
    """Windows 브릿지에서 포지션 데이터 수신"""
    bridge_cache["positions"] = data.get("positions", [])
    bridge_cache["last_update"] = time.time()
    update_bridge_heartbeat()
    return {"status": "ok", "positions_count": len(bridge_cache["positions"])}

@router.post("/bridge/account")
async def receive_bridge_account(data: dict):
    """
    Windows MT5 브릿지에서 전송된 계정 정보 수신
    """
    import time as time_module
    try:
        bridge_cache["account"] = {
            "broker": data.get("broker", ""),
            "login": data.get("login", 0),
            "server": data.get("server", ""),
            "balance": data.get("balance", 0),
            "equity": data.get("equity", 0),
            "margin": data.get("margin", 0),
            "free_margin": data.get("free_margin", 0),
            "leverage": data.get("leverage", 0)
        }
        bridge_cache["last_update"] = time_module.time()
        update_bridge_heartbeat()

        print(f"[Bridge] Account 수신: {data.get('login')} @ {data.get('broker')}")

        return {
            "status": "success",
            "account": data.get("login"),
            "balance": data.get("balance")
        }
    except Exception as e:
        print(f"[Bridge] Account 수신 오류: {e}")
        return {"status": "error", "message": str(e)}


@router.get("/bridge/account")
async def get_bridge_account():
    """브릿지 캐시에서 계정 정보 반환"""
    return bridge_cache.get("account", {})

@router.post("/bridge/batch")
async def receive_bridge_batch(data: dict):
    """Windows 브릿지에서 모든 심볼 가격 + 계정정보 한번에 수신"""
    import time as time_module
    try:
        # 가격 데이터 일괄 업데이트
        prices = data.get("prices", {})
        for symbol, price_data in prices.items():
            bridge_cache["prices"][symbol] = {
                "bid": price_data.get("bid", 0),
                "ask": price_data.get("ask", 0),
                "last": price_data.get("last", 0),
                "time": price_data.get("time", int(time_module.time()))
            }

        # 계정 정보 업데이트
        account = data.get("account")
        if account:
            bridge_cache["account"] = {
                "broker": account.get("broker", "N/A"),
                "login": account.get("login", 0),
                "server": account.get("server", "N/A"),
                "balance": account.get("balance", 0),
                "equity": account.get("equity", 0),
                "margin": account.get("margin", 0),
                "free_margin": account.get("free_margin", 0),
                "leverage": account.get("leverage", 0),
            }

        # 포지션 업데이트
        positions = data.get("positions")
        if positions is not None:
            bridge_cache["positions"] = positions

        bridge_cache["last_update"] = time_module.time()
        update_bridge_heartbeat()

        return {"status": "ok", "symbols": len(prices)}
    except Exception as e:
        print(f"[Bridge Batch] 오류: {e}")
        return {"status": "error", "message": str(e)}


# ★★★ 유저별 동기화 이벤트 저장 (SL/TP 청산 감지용) ★★★
# 반드시 {symbol} 와일드카드 라우트 앞에 정의!
user_sync_events = {}


@router.get("/bridge/active_users")
async def get_active_users():
    """포지션 있는 유저 목록 반환 (브릿지 동기화용)"""
    active_users = []
    for user_id, cache in user_live_cache.items():
        positions = cache.get("positions", [])
        if positions and len(positions) > 0:
            # DB에서 유저의 MT5 계정 정보 조회
            from app.database import SessionLocal
            db = SessionLocal()
            try:
                user = db.query(User).filter(User.id == user_id).first()
                if user and user.mt5_account_number:
                    mt5_password = None
                    if user.mt5_password_encrypted:
                        try:
                            mt5_password = decrypt(user.mt5_password_encrypted)
                        except:
                            pass
                    active_users.append({
                        "user_id": user_id,
                        "mt5_account": user.mt5_account_number,
                        "mt5_password": mt5_password,
                        "mt5_server": user.mt5_server,
                        "cached_positions": len(positions)
                    })
            finally:
                db.close()
    return {"active_users": active_users}


@router.post("/bridge/sync_positions")
async def sync_positions(data: dict = Body(...)):
    """MT5 포지션과 캐시 동기화 (브릿지에서 호출)"""
    import time as time_module

    user_id = data.get("user_id")
    mt5_positions = data.get("positions", [])
    account_info = data.get("account_info")
    deal_history = data.get("deal_history")

    if not user_id:
        return {"status": "error", "message": "user_id required"}

    user_cache = user_live_cache.get(user_id)
    if not user_cache:
        return {"status": "skip", "message": "no cache for user"}

    cached_positions = user_cache.get("positions", [])

    # ★ 디버그 로그
    print(f"[Sync] 수신: user_id={user_id}, mt5_positions={len(mt5_positions)}개, cached={len(cached_positions)}개")

    # MT5에 포지션 없고 캐시에 있으면 = SL/TP로 청산됨
    if len(mt5_positions) == 0 and len(cached_positions) > 0:
        # deal_history에서 P/L 계산
        total_profit = 0
        if deal_history and len(deal_history) > 0:
            for deal in deal_history:
                total_profit += deal.get("profit", 0) + deal.get("commission", 0) + deal.get("swap", 0)

        print(f"[Sync] 🎯 User {user_id}: SL/TP 청산 감지! 캐시 {len(cached_positions)}개 → MT5 0개, P/L: ${total_profit:.2f}")

        # 캐시 업데이트 (포지션 제거)
        existing_history = user_cache.get("history", [])
        existing_today_pl = user_cache.get("today_pl", 0)

        # deal_history 추가
        if deal_history:
            for deal in deal_history:
                existing_history.append(deal)
                existing_today_pl += deal.get("profit", 0) + deal.get("commission", 0) + deal.get("swap", 0)

        user_live_cache[user_id] = {
            "positions": [],
            "account_info": account_info,
            "history": existing_history[-50:],
            "today_pl": round(existing_today_pl, 2),
            "updated_at": time_module.time()
        }

        # 동기화 이벤트 저장 (WS에서 전송)
        user_sync_events[user_id] = {
            "type": "sl_tp_closed",
            "profit": round(total_profit, 2),
            "timestamp": time_module.time()
        }
        print(f"[Sync] ✅ sync_event 저장: user_id={user_id}, profit=${total_profit:.2f}")

        return {"status": "synced", "event": "sl_tp_closed", "profit": total_profit}

    # MT5에 포지션 있으면 정상
    if len(mt5_positions) > 0:
        print(f"[Sync] MT5 포지션 정상: user_id={user_id}, {len(mt5_positions)}개")

    # 포지션 수 동일하면 account_info만 업데이트
    if account_info:
        user_live_cache[user_id]["account_info"] = account_info
        user_live_cache[user_id]["updated_at"] = time_module.time()

    return {"status": "ok"}


@router.post("/bridge/{symbol}")
async def receive_bridge_data(symbol: str, data: dict):
    """
    Windows MT5 브릿지에서 전송된 시세 데이터 수신

    데이터 형식:
    {
        "bid": 97000.0,
        "ask": 97010.0,
        "last": 97005.0,
        "volume": 100,
        "time": 1234567890
    }
    """
    import time as time_module
    try:
        # 가격 데이터 캐시에 저장
        bridge_cache["prices"][symbol] = {
            "bid": data.get("bid", 0),
            "ask": data.get("ask", 0),
            "last": data.get("last", 0),
            "time": data.get("time", int(time_module.time()))
        }
        bridge_cache["last_update"] = time_module.time()
        update_bridge_heartbeat()

        return {
            "status": "success",
            "symbol": symbol,
            "bid": data.get("bid"),
            "ask": data.get("ask")
        }
    except Exception as e:
        print(f"[Bridge] 데이터 수신 오류: {e}")
        return {"status": "error", "message": str(e)}


@router.post("/bridge/{symbol}/info")
async def receive_bridge_symbol_info(symbol: str, data: dict):
    """Windows MT5 브릿지에서 전송된 심볼 계약 정보 수신"""
    import time as time_module
    try:
        bridge_cache["symbol_info"][symbol] = data
        bridge_cache["last_update"] = time_module.time()
        print(f"[Bridge] {symbol} symbol_info 수신")
        return {"status": "success", "symbol": symbol}
    except Exception as e:
        print(f"[Bridge] symbol_info 수신 오류: {e}")
        return {"status": "error", "message": str(e)}


# 중요: 구체적인 경로가 먼저 와야 함 (FastAPI 라우터 순서)
@router.post("/bridge/{symbol}/candles/{timeframe}")
async def receive_bridge_candles_tf(symbol: str, timeframe: str, candles: List[dict] = Body(...)):
    """
    Windows MT5 브릿지에서 전송된 캔들 데이터 수신 (타임프레임별)

    URL: /api/mt5/bridge/BTCUSD/candles/M5
    데이터 형식: [{"time": ..., "open": ..., "high": ..., "low": ..., "close": ..., "volume": ...}, ...]
    """
    import time as time_module
    try:
        # 심볼별 딕셔너리 초기화
        if symbol not in bridge_cache["candles"]:
            bridge_cache["candles"][symbol] = {}

        # 타임프레임별 캔들 데이터 저장
        bridge_cache["candles"][symbol][timeframe] = candles
        bridge_cache["last_update"] = time_module.time()
        update_bridge_heartbeat()

        print(f"[Bridge] {symbol}/{timeframe} 캔들 {len(candles)}개 수신")

        return {
            "status": "success",
            "symbol": symbol,
            "timeframe": timeframe,
            "total_candles": len(candles)
        }
    except Exception as e:
        print(f"[Bridge] 캔들 수신 오류: {e}")
        return {"status": "error", "message": str(e)}


@router.post("/bridge/{symbol}/candles")
async def receive_bridge_candles_default(symbol: str, candles: List[dict] = Body(...)):
    """캔들 데이터 수신 (기본 M5 타임프레임)"""
    return await receive_bridge_candles_tf(symbol, "M5", candles)


@router.get("/bridge/prices")
async def get_bridge_prices_api():
    """브릿지 캐시에서 실시간 가격 데이터 반환"""
    return bridge_cache.get("prices", {})


@router.get("/bridge/status")
async def get_bridge_status():
    """브릿지 캐시 상태 조회"""
    import time as time_module
    symbols_with_prices = list(bridge_cache["prices"].keys())
    symbols_with_candles = list(bridge_cache["candles"].keys())
    last_update = bridge_cache["last_update"]
    age = time_module.time() - last_update if last_update > 0 else -1

    # 타임프레임별 캔들 개수
    candles_detail = {}
    for symbol, tf_data in bridge_cache["candles"].items():
        if isinstance(tf_data, dict):
            candles_detail[symbol] = {tf: len(candles) for tf, candles in tf_data.items()}
        else:
            candles_detail[symbol] = {"M5": len(tf_data)}

    return {
        "prices_count": len(symbols_with_prices),
        "candles_count": len(symbols_with_candles),
        "symbols_prices": symbols_with_prices,
        "symbols_candles": symbols_with_candles,
        "candles_detail": candles_detail,
        "last_update": last_update,
        "age_seconds": round(age, 1)
    }


# ========== 브릿지 주문 API ==========
@router.get("/bridge/orders/pending")
async def get_pending_orders():
    """브릿지가 대기 중인 주문을 가져감 (파일 기반)"""
    pending = pop_all_orders()
    return {"orders": pending}


@router.post("/bridge/orders/result")
async def submit_order_result(result: dict):
    """브릿지가 주문 실행 결과를 전송 (파일 기반)"""
    import time as time_module
    order_id = result.get("order_id")
    if order_id:
        set_order_result(order_id, result)
        print(f"[Bridge] 주문 결과 수신: {order_id} - {result.get('success')}")

        # 주문 성공시 bridge에 포지션 갱신 요청을 위해 last_update 기록
        if result.get("success"):
            bridge_cache["last_update"] = time_module.time()
            # 결과에 포지션 정보가 포함되어 있으면 캐시 업데이트
            if "positions" in result:
                bridge_cache["positions"] = result["positions"]

            # ★★★ user_live_cache에 유저별 데이터 저장 ★★★
            user_id = result.get("user_id")
            if user_id and ("positions" in result or "account_info" in result):
                # 기존 캐시 가져오기 (히스토리 유지)
                existing_cache = user_live_cache.get(user_id, {})
                existing_history = existing_cache.get("history", [])
                existing_today_pl = existing_cache.get("today_pl", 0)

                # 청산 결과면 히스토리에 추가
                deal_history = result.get("deal_history")
                if deal_history:
                    existing_history.append(deal_history)
                    existing_today_pl += deal_history.get("profit", 0)
                    print(f"[Bridge] 유저 {user_id} 거래 히스토리 추가: ${deal_history.get('profit', 0):.2f}")

                user_live_cache[user_id] = {
                    "positions": result.get("positions", []),
                    "account_info": result.get("account_info"),
                    "history": existing_history[-50:],  # 최근 50개만 유지
                    "today_pl": round(existing_today_pl, 2),
                    "updated_at": time_module.time()
                }
                print(f"[Bridge] 유저 {user_id} 라이브 캐시 업데이트 (포지션: {len(result.get('positions', []))}개, Today P/L: ${existing_today_pl:.2f})")

    return {"status": "ok"}


@router.get("/bridge/orders/result/{order_id}")
async def get_order_result(order_id: str):
    """주문 결과 조회 (클라이언트 폴링용, 파일 기반)"""
    result = pop_order_result(order_id)
    if result:
        return result
    return {"status": "pending"}


# ========== 계정 검증 (브릿지용) ==========
@router.get("/bridge/verify/pending")
async def api_get_pending_verifications():
    """브릿지가 폴링: 대기 중인 검증 요청 목록 (파일 기반)"""
    import time as time_module

    pending = get_pending_verifications()

    # 오래된 요청 정리 (60초 이상)
    expired = []
    for vid, data in pending.items():
        if time_module.time() - data.get("created_at", 0) > 60:
            expired.append(vid)
    for vid in expired:
        remove_pending_verification(vid)

    # 최신 데이터 다시 읽기
    pending = get_pending_verifications()

    # 대기 중인 요청 반환
    verifications = []
    for vid, data in pending.items():
        verifications.append({
            "verify_id": vid,
            "account": data["account"],
            "password": data["password"],
            "server": data["server"]
        })

    # 대기 중인 요청이 있으면 로그
    if verifications:
        print(f"[BRIDGE POLL] 📋 대기 중인 검증: {len(verifications)}건 - {[v['account'] for v in verifications]}")

    return {"verifications": verifications}


@router.post("/bridge/verify/result")
async def receive_verification_result(data: dict = Body(...)):
    """브릿지가 검증 결과 전송 (파일 기반)"""
    verify_id = data.get("verify_id")
    if not verify_id:
        return {"status": "error", "message": "verify_id missing"}

    set_verification_result(verify_id, {
        "success": data.get("success", False),
        "message": data.get("message", ""),
        "account_info": data.get("account_info", {})
    })

    # pending에서 제거
    remove_pending_verification(verify_id)

    print(f"[Verify] 결과 수신: {verify_id} - {data.get('success')}")
    return {"status": "ok"}


# ========== 주문 실행 ==========
@router.post("/order")
async def place_order(
    symbol: str = "BTCUSD",
    order_type: str = "BUY",
    volume: float = 0.01,
    target: int = 100,
    magic: int = 100000,
    current_user: User = Depends(get_current_user)
):
    """일반 주문 실행 (BUY/SELL)"""
    import time as time_module

    # ★ Linux 환경 (MT5 없음) → 브릿지 모드
    if not MT5_AVAILABLE:
        # 브릿지 연결 확인 (파일 기반 하트비트)
        bridge_age = time_module.time() - get_bridge_heartbeat()
        if bridge_age > 30:
            return JSONResponse({"success": False, "message": "MT5 브릿지 연결 없음"})

        # 주문 ID 생성
        order_id = str(uuid.uuid4())[:8]

        # ★ 사용자 MT5 계정 정보 추가 (라이브 모드)
        user_mt5_account = None
        user_mt5_password = None
        user_mt5_server = None

        if current_user.has_mt5_account and current_user.mt5_account_number:
            user_mt5_account = current_user.mt5_account_number
            user_mt5_server = current_user.mt5_server
            # 암호화된 비밀번호 복호화
            if current_user.mt5_password_encrypted:
                try:
                    user_mt5_password = decrypt(current_user.mt5_password_encrypted)
                except Exception as e:
                    print(f"[Bridge Order] ⚠️ 비밀번호 복호화 실패: {e}")

        # ★★★ TP/SL points 계산 (target > 0일 때만) ★★★
        tp_points = 0
        sl_points = 0
        if target > 0:
            specs = SYMBOL_SPECS.get(symbol, {"tick_value": 0.01})
            point_value = specs["tick_value"] if specs["tick_value"] > 0 else 1
            tp_points = int(target / (volume * point_value)) if volume * point_value > 0 else 500
            sl_points = tp_points
            print(f"[Bridge Order] SL/TP 계산: target=${target}, volume={volume}, point_value={point_value} -> tp_points={tp_points}, sl_points={sl_points}")

        # 주문을 대기열에 추가
        order_data = {
            "order_id": order_id,
            "action": "order",
            "symbol": symbol,
            "order_type": order_type.upper(),
            "volume": volume,
            "target": target,
            "magic": magic,
            "user_id": current_user.id,
            "timestamp": time_module.time(),
            # ★ 사용자 MT5 계정 정보
            "mt5_account": user_mt5_account,
            "mt5_password": user_mt5_password,
            "mt5_server": user_mt5_server,
            # ★ SL/TP points
            "tp_points": tp_points,
            "sl_points": sl_points
        }
        append_order(order_data)

        # ★★★ 자동청산용 타겟 저장 ★★★
        if target > 0:
            user_target_cache[current_user.id] = target
            print(f"[Bridge Order] 타겟 저장: User {current_user.id} = ${target}")

        print(f"[Bridge Order] 주문 대기열에 추가 (파일): {order_id} - {order_type} {symbol} {volume} (MT5: {user_mt5_account})")

        return JSONResponse({
            "success": True,
            "message": f"{order_type.upper()} 주문 전송 중...",
            "order_id": order_id,
            "bridge_mode": True
        })
    if not mt5_initialize_safe():
        return JSONResponse({"success": False, "message": "MT5 초기화 실패"})
    tick = mt5.symbol_info_tick(symbol)
    symbol_info = mt5.symbol_info(symbol)
    
    if not tick or not symbol_info:
        return JSONResponse({"success": False, "message": "가격 정보 없음"})
    
    # TP/SL 계산 (target > 0일 때만)
    if target > 0:
        point_value = symbol_info.trade_tick_value if symbol_info.trade_tick_value > 0 else 1
        tp_points = int(target / (volume * point_value)) if volume * point_value > 0 else 500
        sl_points = tp_points
        
        if order_type.upper() == "BUY":
            tp_price = tick.ask + (tp_points * symbol_info.point)
            sl_price = tick.ask - (sl_points * symbol_info.point)
        else:
            tp_price = tick.bid - (tp_points * symbol_info.point)
            sl_price = tick.bid + (sl_points * symbol_info.point)
    else:
        tp_price = 0
        sl_price = 0
    
    if order_type.upper() == "BUY":
        mt5_type = mt5.ORDER_TYPE_BUY
        price = tick.ask
    else:
        mt5_type = mt5.ORDER_TYPE_SELL
        price = tick.bid
    
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": volume,
        "type": mt5_type,
        "price": price,
        "deviation": 20,
        "magic": magic,
        "comment": f"Trading-X {order_type.upper()}",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    
    # SL/TP가 있을 때만 추가
    if sl_price > 0:
        request["sl"] = sl_price
    if tp_price > 0:
        request["tp"] = tp_price
    
    result = mt5.order_send(request)
    
    if result.retcode == mt5.TRADE_RETCODE_DONE:
        return JSONResponse({
            "success": True,
            "message": f"{order_type.upper()} 성공! {volume} lot @ {result.price:,.2f}",
            "ticket": result.order
        })
    else:
        return JSONResponse({
            "success": False,
            "message": f"실패: {result.retcode} - {result.comment}"
        })


# ========== 포지션 청산 ==========
@router.post("/close")
async def close_position(
    symbol: str = "BTCUSD",
    magic: int = None,
    current_user: User = Depends(get_current_user)
):
    """포지션 청산 (magic 필터 옵션)"""
    import time as time_module

    # ★ Linux 환경 (MT5 없음) → 브릿지 모드
    if not MT5_AVAILABLE:
        # 브릿지 연결 확인 (파일 기반 하트비트)
        bridge_age = time_module.time() - get_bridge_heartbeat()
        if bridge_age > 30:
            return JSONResponse({"success": False, "message": "MT5 브릿지 연결 없음"})

        order_id = str(uuid.uuid4())[:8]

        # ★ 사용자 MT5 계정 정보 추가 (라이브 모드)
        user_mt5_account = None
        user_mt5_password = None
        user_mt5_server = None

        if current_user.has_mt5_account and current_user.mt5_account_number:
            user_mt5_account = current_user.mt5_account_number
            user_mt5_server = current_user.mt5_server
            # 암호화된 비밀번호 복호화
            if current_user.mt5_password_encrypted:
                try:
                    user_mt5_password = decrypt(current_user.mt5_password_encrypted)
                except Exception as e:
                    print(f"[Bridge Order] ⚠️ 비밀번호 복호화 실패: {e}")

        order_data = {
            "order_id": order_id,
            "action": "close",
            "symbol": symbol,
            "magic": magic,
            "user_id": current_user.id,
            "timestamp": time_module.time(),
            # ★ 사용자 MT5 계정 정보
            "mt5_account": user_mt5_account,
            "mt5_password": user_mt5_password,
            "mt5_server": user_mt5_server
        }
        append_order(order_data)

        print(f"[Bridge Order] 청산 주문 추가 (파일): {order_id} - {symbol} (MT5: {user_mt5_account})")

        return JSONResponse({
            "success": True,
            "message": "청산 주문 전송 중...",
            "order_id": order_id,
            "bridge_mode": True
        })
    if not mt5_initialize_safe():
        return JSONResponse({"success": False, "message": "MT5 초기화 실패"})
    positions = mt5.positions_get(symbol=symbol)
    if not positions:
        return JSONResponse({"success": False, "message": "열린 포지션 없음"})
    
    for pos in positions:
        # magic 필터링 (지정된 경우)
        if magic is not None and pos.magic != magic:
            continue
            
        tick = mt5.symbol_info_tick(symbol)
        close_type = mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY
        close_price = tick.bid if pos.type == 0 else tick.ask
        
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": pos.volume,
            "type": close_type,
            "position": pos.ticket,
            "price": close_price,
            "deviation": 20,
            "magic": 123456,
            "comment": "Trading-X CLOSE",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        
        result = mt5.order_send(request)
        
        if result.retcode == mt5.TRADE_RETCODE_DONE:
            return JSONResponse({
                "success": True,
                "message": f"청산 성공! P/L: ${pos.profit:,.2f}",
                "profit": pos.profit
            })
    
    return JSONResponse({"success": False, "message": "청산 실패"})

# ========== 포지션 목록 조회 ==========
@router.get("/positions")
async def get_positions(
    magic: int = None,
    current_user: User = Depends(get_current_user)
):
    """모든 열린 포지션 조회 (magic 필터 옵션)"""
    if not mt5_initialize_safe():
        # MT5 없음 - bridge_cache에서 포지션 조회
        cached_positions = bridge_cache.get("positions", [])
        if not cached_positions:
            return {"success": True, "positions": [], "count": 0, "total_margin": 0, "message": "bridge mode"}

        position_list = []
        for pos in cached_positions:
            if magic is not None and pos.get("magic") != magic:
                continue
            position_list.append({
                "ticket": pos.get("ticket", 0),
                "symbol": pos.get("symbol", ""),
                "type": "BUY" if pos.get("type", 0) == 0 else "SELL",
                "volume": pos.get("volume", 0),
                "entry": pos.get("price_open", 0),
                "current": pos.get("price_current", 0),
                "profit": pos.get("profit", 0),
                "sl": pos.get("sl", 0),
                "tp": pos.get("tp", 0),
                "magic": pos.get("magic", 0),
                "comment": pos.get("comment", ""),
                "margin": 0
            })

        return {
            "success": True,
            "positions": position_list,
            "count": len(position_list),
            "total_margin": 0,
            "leverage": 500
        }
    
    positions = mt5.positions_get()
    account = mt5.account_info()
    leverage = account.leverage if account else 500
    total_margin = account.margin if account else 0
    
    if not positions:
        return {"success": True, "positions": [], "count": 0, "total_margin": 0}
    
    position_list = []
    for pos in positions:
        # magic 필터링 (지정된 경우)
        if magic is not None and pos.magic != magic:
            continue
        
        # MT5 함수로 정확한 마진 계산 (종목별 레버리지 자동 적용)
        order_type = mt5.ORDER_TYPE_BUY if pos.type == 0 else mt5.ORDER_TYPE_SELL
        tick = mt5.symbol_info_tick(pos.symbol)
        current_price = tick.ask if pos.type == 0 else tick.bid if tick else pos.price_open
        margin = mt5.order_calc_margin(order_type, pos.symbol, pos.volume, current_price)
        if margin is None:
            margin = 0
            
        position_list.append({
            "ticket": pos.ticket,
            "symbol": pos.symbol,
            "type": "BUY" if pos.type == 0 else "SELL",
            "volume": pos.volume,
            "entry": pos.price_open,
            "current": pos.price_current,
            "profit": pos.profit,
            "sl": pos.sl,
            "tp": pos.tp,
            "magic": pos.magic,
            "comment": pos.comment,
            "margin": round(margin, 2)
        })
    
    # 필터된 포지션들의 마진 합계
    filtered_margin = sum(p["margin"] for p in position_list)
    
    return {
        "success": True, 
        "positions": position_list, 
        "count": len(position_list),
        "total_margin": round(filtered_margin, 2),
        "leverage": leverage
    }

# ========== 전체 청산 ==========
@router.post("/close-all")
async def close_all_positions(
    magic: int = None,
    current_user: User = Depends(get_current_user)
):
    """모든 포지션 청산 (magic 필터 옵션)"""
    if not mt5_initialize_safe():
        return JSONResponse({"success": False, "message": "MT5 초기화 실패"})
    
    positions = mt5.positions_get()
    if not positions:
        return JSONResponse({"success": False, "message": "열린 포지션 없음"})
    
    closed_count = 0
    total_profit = 0
    
    for pos in positions:
        # magic 필터링
        if magic is not None and pos.magic != magic:
            continue
            
        tick = mt5.symbol_info_tick(pos.symbol)
        if not tick:
            continue
            
        close_type = mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY
        close_price = tick.bid if pos.type == 0 else tick.ask
        
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": close_type,
            "position": pos.ticket,
            "price": close_price,
            "deviation": 20,
            "magic": 123456,
            "comment": "Trading-X CLOSE ALL",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        
        result = mt5.order_send(request)
        
        if result.retcode == mt5.TRADE_RETCODE_DONE:
            closed_count += 1
            total_profit += pos.profit
    
    if closed_count > 0:
        return JSONResponse({
            "success": True,
            "message": f"{closed_count}개 청산 완료! 총 P/L: ${total_profit:,.2f}",
            "closed_count": closed_count,
            "total_profit": total_profit
        })
    else:
        return JSONResponse({"success": False, "message": "청산 실패"})


# ========== 타입별 청산 (BUY/SELL) ==========
@router.post("/close-by-type")
async def close_by_type(
    type: str = "BUY",
    magic: int = None,
    current_user: User = Depends(get_current_user)
):
    """BUY 또는 SELL 포지션만 청산"""
    if not mt5_initialize_safe():
        return JSONResponse({"success": False, "message": "MT5 초기화 실패"})
    
    positions = mt5.positions_get()
    if not positions:
        return JSONResponse({"success": False, "message": "열린 포지션 없음"})
    
    target_type = 0 if type.upper() == "BUY" else 1
    closed_count = 0
    total_profit = 0
    
    for pos in positions:
        if pos.type != target_type:
            continue
        # magic 필터링
        if magic is not None and pos.magic != magic:
            continue
            
        tick = mt5.symbol_info_tick(pos.symbol)
        if not tick:
            continue
            
        close_type = mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY
        close_price = tick.bid if pos.type == 0 else tick.ask
        
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": close_type,
            "position": pos.ticket,
            "price": close_price,
            "deviation": 20,
            "magic": 123456,
            "comment": f"Trading-X CLOSE {type.upper()}",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        
        result = mt5.order_send(request)
        
        if result.retcode == mt5.TRADE_RETCODE_DONE:
            closed_count += 1
            total_profit += pos.profit
    
    if closed_count > 0:
        return JSONResponse({
            "success": True,
            "message": f"{type.upper()} {closed_count}개 청산! P/L: ${total_profit:,.2f}",
            "closed_count": closed_count,
            "total_profit": total_profit
        })
    else:
        return JSONResponse({"success": False, "message": f"{type.upper()} 포지션 없음"})


# ========== 손익별 청산 (수익/손실) ==========
@router.post("/close-by-profit")
async def close_by_profit(
    profit_type: str = "positive",
    magic: int = None,
    current_user: User = Depends(get_current_user)
):
    """수익 또는 손실 포지션만 청산"""
    if not mt5_initialize_safe():
        return JSONResponse({"success": False, "message": "MT5 초기화 실패"})
    
    positions = mt5.positions_get()
    if not positions:
        return JSONResponse({"success": False, "message": "열린 포지션 없음"})
    
    closed_count = 0
    total_profit = 0
    
    for pos in positions:
        # magic 필터링
        if magic is not None and pos.magic != magic:
            continue
        # 수익/손실 필터링
        if profit_type == "positive" and pos.profit <= 0:
            continue
        if profit_type == "negative" and pos.profit >= 0:
            continue
            
        tick = mt5.symbol_info_tick(pos.symbol)
        if not tick:
            continue
            
        close_type = mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY
        close_price = tick.bid if pos.type == 0 else tick.ask
        
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": close_type,
            "position": pos.ticket,
            "price": close_price,
            "deviation": 20,
            "magic": 123456,
            "comment": f"Trading-X CLOSE {'PROFIT' if profit_type == 'positive' else 'LOSS'}",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        
        result = mt5.order_send(request)
        
        if result.retcode == mt5.TRADE_RETCODE_DONE:
            closed_count += 1
            total_profit += pos.profit
    
    type_name = "수익" if profit_type == "positive" else "손실"
    
    if closed_count > 0:
        return JSONResponse({
            "success": True,
            "message": f"{type_name} {closed_count}개 청산! P/L: ${total_profit:,.2f}",
            "closed_count": closed_count,
            "total_profit": total_profit
        })
    else:
        return JSONResponse({"success": False, "message": f"{type_name} 포지션 없음"})

# ========== 거래 내역 ==========
@router.get("/history")
async def get_history(current_user: User = Depends(get_current_user)):
    """거래 내역 조회"""
    if not MT5_AVAILABLE:
        return {"history": []}
    if not mt5_initialize_safe():
        return {"history": []}

    from_date = datetime.now() - timedelta(days=30)
    to_date = datetime.now() + timedelta(days=1)  # 미래 1일 추가 (시간대 문제 방지)

    deals = mt5.history_deals_get(from_date, to_date)
    
    print(f"[MT5 History] from: {from_date}, to: {to_date}")
    print(f"[MT5 History] Total deals found: {len(deals) if deals else 0}")
    
    history = []
    if deals:
        # profit이 0이 아닌 거래만 필터링하고 시간순 정렬
        filtered_deals = [d for d in deals if d.profit != 0]
        # 최신순 정렬
        sorted_deals = sorted(filtered_deals, key=lambda x: x.time, reverse=True)
        
        print(f"[MT5 History] Filtered deals: {len(filtered_deals)}")
        
        for deal in sorted_deals[:30]:  # 최근 30개
            # MT5 서버 시간 → 로컬 시간 보정 (2시간 차이 보정)
            trade_time = datetime.fromtimestamp(deal.time) - timedelta(hours=2)
            history.append({
                "ticket": deal.ticket,
                "time": trade_time.strftime("%m/%d %H:%M"),
                "symbol": deal.symbol,
                "type": "BUY" if deal.type == 0 else "SELL",
                "volume": deal.volume,
                "price": deal.price,
                "profit": deal.profit,
                "entry": deal.price,
                "exit": deal.price
            })
            print(f"[MT5 History] Deal: {deal.ticket}, Time: {trade_time}, Symbol: {deal.symbol}, Profit: {deal.profit}")
    
    return {"history": history}


# ========== 마틴게일 API ==========
@router.post("/martin/enable")
async def enable_martin(
    base_lot: float = 0.01,
    target: int = 50,
    max_steps: int = 7,
    current_user: User = Depends(get_current_user)
):
    """마틴게일 모드 활성화"""
    result = martin_service.enable(base_lot, target, max_steps)
    return JSONResponse(result)


@router.post("/martin/disable")
async def disable_martin(current_user: User = Depends(get_current_user)):
    """마틴게일 모드 비활성화"""
    result = martin_service.disable()
    return JSONResponse(result)


@router.get("/martin/state")
async def get_martin_state(current_user: User = Depends(get_current_user)):
    """마틴게일 상태 조회"""
    return martin_service.get_state()


@router.post("/martin/buy")
async def martin_buy(
    symbol: str = "BTCUSD",
    current_user: User = Depends(get_current_user)
):
    """마틴게일 BUY 주문"""
    result = martin_service.place_order(symbol, "BUY")
    return JSONResponse(result)


@router.post("/martin/sell")
async def martin_sell(
    symbol: str = "BTCUSD",
    current_user: User = Depends(get_current_user)
):
    """마틴게일 SELL 주문"""
    result = martin_service.place_order(symbol, "SELL")
    return JSONResponse(result)


@router.post("/martin/update")
async def martin_update(
    profit: float = 0,
    current_user: User = Depends(get_current_user)
):
    """포지션 청산 후 마틴 상태 업데이트"""
    result = martin_service.update_after_close(profit)
    return JSONResponse(result)


@router.post("/martin/update-state")
async def martin_update_state(
    step: int = 1,
    accumulated_loss: float = 0,
    current_user: User = Depends(get_current_user)
):
    """마틴 단계와 누적손실 업데이트"""
    martin_service.state.step = step
    martin_service.state.accumulated_loss = accumulated_loss
    
    return JSONResponse({
        "success": True,
        "message": f"마틴 상태 업데이트: Step {step}, 누적손실 ${accumulated_loss:,.2f}",
        "step": step,
        "accumulated_loss": accumulated_loss,
        "current_lot": martin_service.get_current_lot()
    })


@router.post("/martin/reset-full")
async def martin_reset_full(
    current_user: User = Depends(get_current_user)
):
    """마틴 완전 초기화 (1단계, 누적손실 0)"""
    martin_service.state.step = 1
    martin_service.state.accumulated_loss = 0
    # current_lot은 get_current_lot() 메서드로 자동 계산됨
    
    return JSONResponse({
        "success": True,
        "message": "마틴 초기화 완료",
        "step": 1,
        "accumulated_loss": 0
    })


# ========== 종목 검색 API ==========
def get_symbol_icon(symbol_name: str):
    """심볼에 맞는 아이콘과 색상 반환"""
    symbol_upper = symbol_name.upper()
    
    # 암호화폐
    if "BTC" in symbol_upper:
        return "₿", "#f7931a"
    if "ETH" in symbol_upper:
        return "Ξ", "#627eea"
    if "XRP" in symbol_upper:
        return "✕", "#00aae4"
    if "LTC" in symbol_upper:
        return "Ł", "#bfbbbb"
    if "DOGE" in symbol_upper:
        return "Ð", "#c2a633"
    
    # 귀금속
    if "XAU" in symbol_upper or "GOLD" in symbol_upper:
        return "✦", "#ffd700"
    if "XAG" in symbol_upper or "SILVER" in symbol_upper:
        return "✦", "#c0c0c0"
    
    # 통화
    if "EUR" in symbol_upper:
        return "€", "#0052cc"
    if "GBP" in symbol_upper:
        return "£", "#9c27b0"
    if "JPY" in symbol_upper:
        return "¥", "#dc143c"
    if "AUD" in symbol_upper:
        return "A$", "#00875a"
    if "CAD" in symbol_upper:
        return "C$", "#ff5722"
    if "CHF" in symbol_upper:
        return "₣", "#e91e63"
    if "NZD" in symbol_upper:
        return "NZ$", "#4caf50"
    
    # 지수
    if "US100" in symbol_upper or "NAS" in symbol_upper or "NDX" in symbol_upper:
        return "📈", "#00d4ff"
    if "US500" in symbol_upper or "SPX" in symbol_upper:
        return "◆", "#1976d2"
    if "US30" in symbol_upper or "DJI" in symbol_upper:
        return "◈", "#ff9800"
    if "GER" in symbol_upper or "DAX" in symbol_upper:
        return "▣", "#ffeb3b"
    if "UK100" in symbol_upper:
        return "▤", "#3f51b5"
    if "JP225" in symbol_upper or "NIK" in symbol_upper:
        return "◉", "#f44336"
    
    # 원유/에너지
    if "OIL" in symbol_upper or "WTI" in symbol_upper or "BRENT" in symbol_upper:
        return "🛢", "#795548"
    if "GAS" in symbol_upper:
        return "⛽", "#607d8b"
    
    # 기본값 (Forex)
    return "$", "#9ca3af"


def get_symbol_category(symbol_name: str):
    """심볼 카테고리 분류"""
    symbol_upper = symbol_name.upper()
    
    if any(x in symbol_upper for x in ["BTC", "ETH", "XRP", "LTC", "DOGE", "ADA", "SOL", "DOT"]):
        return "crypto"
    if any(x in symbol_upper for x in ["XAU", "XAG", "GOLD", "SILVER", "PLATINUM", "PALLADIUM"]):
        return "metals"
    if any(x in symbol_upper for x in ["US100", "US500", "US30", "GER", "UK100", "JP225", "NAS", "SPX", "DJI", "DAX"]):
        return "indices"
    if any(x in symbol_upper for x in ["OIL", "WTI", "BRENT", "GAS", "NATGAS"]):
        return "energy"
    
    return "forex"


@router.get("/symbols/search")
def search_symbols(query: str = ""):
    """MT5 종목 검색 API"""
    if not mt5_initialize_safe():
        return {"success": False, "symbols": [], "message": "MT5 not connected"}
    
    try:
        # 모든 심볼 가져오기
        all_symbols = mt5.symbols_get()
        
        if all_symbols is None:
            return {"success": False, "symbols": [], "message": "Failed to get symbols"}
        
        results = []
        query_upper = query.upper()
        
        for symbol in all_symbols:
            # 검색어가 심볼명 또는 설명에 포함되어 있는지 확인
            if query_upper in symbol.name.upper() or query_upper in symbol.description.upper():
                # 심볼 아이콘 및 색상 결정
                icon, color = get_symbol_icon(symbol.name)
                
                results.append({
                    "symbol": symbol.name,
                    "name": symbol.description or symbol.name,
                    "icon": icon,
                    "color": color,
                    "category": get_symbol_category(symbol.name)
                })
        
        # 최대 20개까지만 반환
        return {"success": True, "symbols": results[:20], "total": len(results)}
        
    except Exception as e:
        return {"success": False, "symbols": [], "message": str(e)}


@router.get("/symbols/all")
def get_all_symbols():
    """MT5 전체 종목 목록 API"""
    if not mt5_initialize_safe():
        return {"success": False, "symbols": [], "message": "MT5 not connected"}
    
    try:
        all_symbols = mt5.symbols_get()
        
        if all_symbols is None:
            return {"success": False, "symbols": [], "message": "Failed to get symbols"}
        
        results = []
        for symbol in all_symbols:
            if symbol.visible:  # Market Watch에 있는 것만
                icon, color = get_symbol_icon(symbol.name)
                results.append({
                    "symbol": symbol.name,
                    "name": symbol.description or symbol.name,
                    "icon": icon,
                    "color": color,
                    "category": get_symbol_category(symbol.name)
                })
        
        return {"success": True, "symbols": results, "total": len(results)}
        
    except Exception as e:
        return {"success": False, "symbols": [], "message": str(e)}

# ========== MT5 계정 연결 ==========
from pydantic import BaseModel

class MT5ConnectRequest(BaseModel):
    server: str = "HedgeHood-MT5"
    account: str
    password: str

@router.post("/connect")
async def connect_mt5_account(
    request: MT5ConnectRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """MT5 계정 연결 - 브릿지를 통한 실제 검증 후 저장"""
    import time as time_module

    print(f"[CONNECT] 🔵 User {current_user.id} 연결 시도: {request.account}@{request.server}")

    if not request.account or not request.password:
        return JSONResponse({"success": False, "message": "계좌번호와 비밀번호를 입력하세요"})

    # 1. 브릿지 연결 확인 (파일 기반 하트비트)
    bridge_age = time_module.time() - get_bridge_heartbeat()
    print(f"[CONNECT] 브릿지 상태: age={bridge_age:.1f}초")
    if bridge_age > 60:
        return JSONResponse({
            "success": False,
            "message": "MT5 브릿지 연결 없음. Windows 서버에서 브릿지를 실행해주세요."
        })

    # 2. 검증 요청 생성 (파일 기반)
    verify_id = str(uuid.uuid4())
    set_pending_verification(verify_id, {
        "account": request.account,
        "password": request.password,
        "server": request.server,
        "created_at": time_module.time()
    })
    print(f"[CONNECT] 📝 검증 요청 생성: {verify_id[:8]}...")

    # 3. 브릿지가 검증하고 결과를 보낼 때까지 대기 (최대 15초)
    max_wait = 15
    waited = 0
    while waited < max_wait:
        results = get_verification_results()
        if verify_id in results:
            result = pop_verification_result(verify_id)
            remove_pending_verification(verify_id)
            print(f"[CONNECT] ✅ 검증 결과 수신: success={result.get('success')}")

            if result and result.get("success"):
                # 검증 성공 - DB에 저장 (비밀번호 암호화 + 잔고 정보)
                account_info = result.get("account_info", {})

                current_user.has_mt5_account = True
                current_user.mt5_account_number = request.account
                current_user.mt5_server = request.server
                current_user.mt5_password_encrypted = encrypt(request.password)
                current_user.mt5_connected_at = datetime.utcnow()

                # ★★★ MT5 잔고 정보 저장 (검증 시점 스냅샷) ★★★
                current_user.mt5_balance = account_info.get("balance", 0)
                current_user.mt5_equity = account_info.get("equity", account_info.get("balance", 0))
                current_user.mt5_margin = account_info.get("margin", 0)
                current_user.mt5_free_margin = account_info.get("free_margin", account_info.get("balance", 0))
                current_user.mt5_profit = account_info.get("profit", 0)
                current_user.mt5_leverage = account_info.get("leverage", 500)
                current_user.mt5_currency = account_info.get("currency", "USD")

                db.commit()
                print(f"[CONNECT] 🎉 DB 저장 완료: {request.account}")
                print(f"[CONNECT]    Balance: ${account_info.get('balance', 0)}, Equity: ${account_info.get('equity', 0)}")

                return JSONResponse({
                    "success": True,
                    "message": "MT5 계정 검증 완료!",
                    "account": request.account,
                    "server": request.server,
                    "account_info": result.get("account_info", {})
                })
            else:
                # 검증 실패
                msg = result.get("message", "계좌번호 또는 비밀번호가 올바르지 않습니다") if result else "검증 실패"
                print(f"[CONNECT] ❌ 검증 실패: {msg}")
                return JSONResponse({
                    "success": False,
                    "message": msg
                })

        await asyncio.sleep(0.5)
        waited += 0.5

    # 4. 타임아웃
    remove_pending_verification(verify_id)
    print(f"[CONNECT] ⏰ 타임아웃 ({max_wait}초): 브릿지 응답 없음")
    return JSONResponse({
        "success": False,
        "message": f"검증 시간 초과 ({max_wait}초). 브릿지가 응답하지 않습니다."
    })


@router.post("/disconnect")
async def disconnect_mt5_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """MT5 계정 연결 해제 - 모든 정보 완전 삭제"""
    current_user.has_mt5_account = False
    current_user.mt5_account_number = None
    current_user.mt5_server = None
    current_user.mt5_password_encrypted = None
    current_user.mt5_connected_at = None
    db.commit()

    return JSONResponse({
        "success": True,
        "message": "MT5 계정 연결이 해제되었습니다"
    })

# ========== WebSocket 실시간 데이터 ==========
@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """실시간 데이터 WebSocket (Live 모드)"""
    await websocket.accept()

    # ★ Query parameter에서 토큰으로 유저 식별
    token = websocket.query_params.get("token")
    user_id = None
    user_mt5_account = None
    user_mt5_balance = None
    user_mt5_equity = None
    user_mt5_margin = None
    user_mt5_free_margin = None
    user_mt5_profit = None
    user_mt5_leverage = None
    user_mt5_server = None

    if token:
        try:
            payload = decode_token(token)
            if payload:
                user_id = int(payload.get("sub"))
                # DB에서 유저의 MT5 계정 정보 조회
                db = next(get_db())
                user = db.query(User).filter(User.id == user_id).first()
                if user and user.has_mt5_account:
                    user_mt5_account = user.mt5_account_number
                    user_mt5_balance = user.mt5_balance
                    user_mt5_equity = user.mt5_equity
                    user_mt5_margin = user.mt5_margin
                    user_mt5_free_margin = user.mt5_free_margin
                    user_mt5_profit = user.mt5_profit
                    user_mt5_leverage = user.mt5_leverage
                    user_mt5_server = user.mt5_server
                    print(f"[LIVE WS] User {user_id} connected (MT5: {user_mt5_account}, Balance: ${user_mt5_balance})")
                else:
                    print(f"[LIVE WS] User {user_id} connected (No MT5 account)")
                db.close()
        except Exception as e:
            print(f"[LIVE WS] Token decode error: {e}")
    else:
        print(f"[LIVE WS] Anonymous connection (no token)")

    symbols_list = ["BTCUSD", "EURUSD.r", "USDJPY.r", "XAUUSD.r", "US100.", "GBPUSD.r", "AUDUSD.r", "USDCAD.r", "ETHUSD"]

    # 인디케이터 캐시
    indicator_cache = {"buy": 33, "sell": 33, "neutral": 34, "score": 50}
    indicator_last_update = 0

    while True:
        try:
            import time as time_module
            mt5_connected = mt5_initialize_safe()

            # ★ 브릿지 연결 상태 확인 (개선)
            last_update = bridge_cache.get("last_update", 0)
            current_time = time_module.time()

            # last_update가 0이면 아직 브릿지 데이터 없음
            # last_update가 있으면 30초 이내인지 확인
            if last_update == 0:
                bridge_connected = False
                bridge_age = -1
            else:
                bridge_age = current_time - last_update
                bridge_connected = bridge_age < 30  # 30초 이내 데이터 있으면 연결됨
            
            # ★★★ 유저 라이브 캐시 확인 (주문/청산 직후 데이터) ★★★
            user_cache = user_live_cache.get(user_id) if user_id else None

            # ★ 계정 정보: MT5 직접 또는 브릿지 캐시
            if user_cache and user_cache.get("account_info"):
                # ★★★ 유저 라이브 캐시에서 계정 정보 사용 ★★★
                acc_info = user_cache["account_info"]
                broker = "HedgeHood Pty Ltd"
                login = user_mt5_account or 0
                server = user_mt5_server or "HedgeHood-MT5"
                balance = acc_info.get("balance", 0)
                equity = acc_info.get("equity", 0)
                margin = acc_info.get("margin", 0)
                free_margin = acc_info.get("free_margin", 0)
                leverage = user_mt5_leverage or 500
            elif mt5_connected:
                account = mt5.account_info()
                broker = account.company if account else "N/A"
                login = account.login if account else 0
                server = account.server if account else "N/A"
                balance = account.balance if account else 0
                equity = account.equity if account else 0
                margin = account.margin if account else 0
                free_margin = account.margin_free if account else 0
                leverage = account.leverage if account else 0
            elif bridge_connected and bridge_cache.get("account"):
                # ★ 브릿지 캐시에서 가격/포지션용 정보 사용
                acc = bridge_cache["account"]
                broker = acc.get("broker", "HedgeHood Pty Ltd")
                login = acc.get("login", 0)
                server = acc.get("server", "N/A")
                # ★★★ 잔고는 유저별 저장된 값만 사용 (브릿지 계정 노출 금지) ★★★
                if user_mt5_balance is not None:
                    balance = user_mt5_balance
                    equity = user_mt5_equity or user_mt5_balance
                    margin = user_mt5_margin or 0
                    free_margin = user_mt5_free_margin or user_mt5_balance
                    leverage = user_mt5_leverage or 500
                else:
                    # 유저 정보 없으면 0으로 표시 (브릿지 값 노출 금지)
                    balance = 0
                    equity = 0
                    margin = 0
                    free_margin = 0
                    leverage = 500
            else:
                broker = "HedgeHood Pty Ltd"
                login = 0
                server = user_mt5_server or "HedgeHood-MT5"
                # ★★★ 유저별 저장된 잔고만 사용 ★★★
                balance = user_mt5_balance or 0
                equity = user_mt5_equity or user_mt5_balance or 0
                margin = user_mt5_margin or 0
                free_margin = user_mt5_free_margin or user_mt5_balance or 0
                leverage = user_mt5_leverage or 500
            
            # ★ 가격 정보: MT5 직접 또는 브릿지 캐시
            all_prices = {}
            if mt5_connected:
                for sym in symbols_list:
                    tick = mt5.symbol_info_tick(sym)
                    if tick:
                        all_prices[sym] = {"bid": tick.bid, "ask": tick.ask}
            else:
                all_prices = get_bridge_prices()
                
                # 브릿지 캐시도 비어있으면 → Binance API fallback
                if not all_prices:
                    try:
                        from .demo import fetch_external_prices
                        all_prices = await fetch_external_prices()
                        print("[LIVE WS] 📡 Using Binance API fallback for prices")
                    except Exception as e:
                        print(f"[LIVE WS] ⚠️ Binance fallback error: {e}")
            
            # ★ 캔들 정보: MT5 직접 또는 브릿지 캐시
            all_candles = {}
            if mt5_connected:
                for sym in symbols_list:
                    rates = mt5.copy_rates_from_pos(sym, mt5.TIMEFRAME_M1, 0, 1)
                    if rates is not None and len(rates) > 0:
                        r = rates[0]
                        all_candles[sym] = {
                            "time": int(r['time']),
                            "open": float(r['open']),
                            "high": float(r['high']),
                            "low": float(r['low']),
                            "close": float(r['close'])
                        }
            else:
                # ★ 브릿지 캐시에서 각 심볼의 마지막 캔들 가져오기
                # 실시간 가격으로 close 업데이트
                for sym in symbols_list:
                    cached = get_bridge_candles(sym, "M1")
                    if cached and len(cached) > 0:
                        last_candle = cached[-1]
                        # 실시간 가격으로 close/high/low 업데이트
                        current_price = all_prices.get(sym, {}).get("bid", last_candle.get("close", 0))
                        candle_high = max(last_candle.get("high", 0), current_price)
                        candle_low = min(last_candle.get("low", float('inf')), current_price) if last_candle.get("low", 0) > 0 else current_price
                        all_candles[sym] = {
                            "time": last_candle.get("time", 0),
                            "open": last_candle.get("open", 0),
                            "high": candle_high,
                            "low": candle_low,
                            "close": current_price  # ★ 실시간 가격으로 close 업데이트
                        }

                # 캔들도 비어있으면 → 가격으로 합성
                if not all_candles and all_prices:
                    current_ts = int(time_module.time())
                    candle_time = current_ts - (current_ts % 60)
                    for sym in symbols_list:
                        if sym in all_prices:
                            price = all_prices[sym].get("bid", 0)
                            if price > 0:
                                all_candles[sym] = {
                                    "time": candle_time,
                                    "open": price,
                                    "high": price,
                                    "low": price,
                                    "close": price
                                }
                    print("[LIVE WS] 📡 Generated synthetic candles from prices")
            
            # 포지션 정보 (MT5 직접 연결 또는 Bridge)
            positions_count = 0
            position_data = None
            total_realtime_profit = 0  # ★★★ 실시간 총 P/L

            if user_cache and user_cache.get("positions"):
                # ★★★ 유저 라이브 캐시에서 포지션 정보 + 실시간 P/L 재계산 ★★★
                cache_positions = user_cache["positions"]
                positions_count = len(cache_positions)
                for pos in cache_positions:
                    pos_symbol = pos.get("symbol", "")
                    pos_type = pos.get("type", 0)
                    pos_volume = pos.get("volume", 0)
                    pos_open = pos.get("price_open", 0)

                    # ★ 현재 가격으로 P/L 재계산
                    current_price_data = all_prices.get(pos_symbol, {})
                    current_bid = current_price_data.get("bid", pos_open)
                    current_ask = current_price_data.get("ask", pos_open)

                    realtime_profit = calculate_realtime_profit(
                        pos_type, pos_symbol, pos_volume, pos_open, current_bid, current_ask
                    )
                    total_realtime_profit += realtime_profit

                    if pos.get("magic") == 100001:
                        position_data = {
                            "type": "BUY" if pos_type == 0 else "SELL",
                            "symbol": pos_symbol,
                            "volume": pos_volume,
                            "entry": pos_open,
                            "profit": realtime_profit,  # ★ 실시간 P/L
                            "ticket": pos.get("ticket", 0),
                            "magic": pos.get("magic", 0)
                        }

                # ★★★ equity = balance + 실시간 총 P/L ★★★
                if user_cache.get("account_info"):
                    equity = balance + total_realtime_profit

                # ★★★ 자동청산 체크 (타겟 도달 시) ★★★
                target = user_target_cache.get(user_id, 0)
                if target > 0 and positions_count > 0 and position_data:
                    cooldown_key = f"{user_id}"
                    current_ts = time_module.time()

                    # 쿨다운 체크 (10초 내 중복 청산 방지)
                    if cooldown_key not in auto_close_cooldown or current_ts - auto_close_cooldown.get(cooldown_key, 0) > 10:
                        should_close = False
                        is_win = False

                        if total_realtime_profit >= target:  # WIN
                            should_close = True
                            is_win = True
                            print(f"[LIVE WS] 🎯 AUTO CLOSE WIN! User {user_id}: ${total_realtime_profit:.2f} >= Target ${target}")
                        elif total_realtime_profit <= -target * 0.98:  # LOSE (98%)
                            should_close = True
                            is_win = False
                            print(f"[LIVE WS] 💔 AUTO CLOSE LOSE! User {user_id}: ${total_realtime_profit:.2f} <= -${target * 0.98:.2f}")

                        if should_close:
                            # 쿨다운 설정
                            auto_close_cooldown[cooldown_key] = current_ts

                            # 청산 주문 추가
                            import uuid
                            close_order_id = str(uuid.uuid4())[:8]
                            close_order_data = {
                                "order_id": close_order_id,
                                "action": "close",
                                "symbol": position_data["symbol"],
                                "magic": 100001,
                                "user_id": user_id,
                                "timestamp": current_ts
                            }

                            # 유저의 MT5 계정 정보 추가
                            if user_mt5_account:
                                close_order_data["mt5_account"] = user_mt5_account
                                close_order_data["mt5_server"] = user_mt5_server
                                # 비밀번호는 DB에서 다시 가져와야 함
                                try:
                                    db = next(get_db())
                                    user_obj = db.query(User).filter(User.id == user_id).first()
                                    if user_obj and user_obj.mt5_password_encrypted:
                                        from ..utils.crypto import decrypt
                                        close_order_data["mt5_password"] = decrypt(user_obj.mt5_password_encrypted)
                                    db.close()
                                except Exception as e:
                                    print(f"[LIVE WS] 자동청산 비밀번호 조회 실패: {e}")

                            append_order(close_order_data)
                            print(f"[LIVE WS] 자동청산 주문 추가: {close_order_id}")

                            # 타겟 캐시 삭제 (청산 후)
                            if user_id in user_target_cache:
                                del user_target_cache[user_id]

            elif mt5_connected:
                positions = mt5.positions_get()
                positions_count = len(positions) if positions else 0
                
                if positions and len(positions) > 0:
                    for pos in positions:
                        if pos.magic == 100001:
                            position_data = {
                                "type": "BUY" if pos.type == 0 else "SELL",
                                "symbol": pos.symbol,
                                "volume": pos.volume,
                                "entry": pos.price_open,
                                "profit": pos.profit,
                                "ticket": pos.ticket,
                                "magic": pos.magic
                            }
                            break
            elif bridge_connected:
                # ★ Bridge 포지션 캐시에서 조회 (포맷 변환 추가)
                bridge_positions = bridge_cache.get("positions", [])
                positions_count = len(bridge_positions)
                for pos in bridge_positions:
                    if pos.get("magic") == 100001:
                        position_data = {
                            "type": "BUY" if pos.get("type", 0) == 0 else "SELL",
                            "symbol": pos.get("symbol", ""),
                            "volume": pos.get("volume", 0),
                            "entry": pos.get("price_open", 0),
                            "profit": pos.get("profit", 0),
                            "ticket": pos.get("ticket", 0),
                            "magic": pos.get("magic", 0)
                        }
                        break
            
            # 인디케이터 계산 (5초마다 캐시)
            current_time = time_module.time()
            if current_time - indicator_last_update > 5:
                try:
                    indicators = IndicatorService.calculate_all_indicators("BTCUSD")
                    indicator_cache = indicators
                    indicator_last_update = current_time
                    # print(f"[WS] 인디케이터 업데이트: {indicators}")  # 디버그
                except Exception as ind_err:
                    print(f"[WS] 인디케이터 계산 오류: {ind_err}")
            buy_count = indicator_cache.get("buy", 33)
            sell_count = indicator_cache.get("sell", 33)
            neutral_count = indicator_cache.get("neutral", 34)
            base_score = indicator_cache.get("score", 50)
            
            # 마틴 상태
            martin_state = martin_service.get_state()
            
            # ★★★ 유저의 MT5 계정 우선 사용 (브릿지 계정 노출 방지) ★★★
            display_account = user_mt5_account if user_mt5_account else login

            # ★ 유저가 MT5 계정을 등록했으면 연결된 것으로 표시
            # (브릿지 연결 여부와 무관하게 유저에게는 Connected로 표시)
            user_has_mt5 = user_mt5_account is not None

            # ★★★ user_live_cache에서 히스토리/Today P/L 가져오기 ★★★
            live_history = []
            live_today_pl = 0
            if user_cache:
                live_history = user_cache.get("history", [])
                live_today_pl = user_cache.get("today_pl", 0)

            # ★★★ 동기화 이벤트 확인 (SL/TP 청산 감지) ★★★
            sync_event = None
            if user_id and user_id in user_sync_events:
                sync_event = user_sync_events.pop(user_id)
                print(f"[WS] 📢 User {user_id} sync_event 전송: {sync_event}")

            data = {
                "mt5_connected": user_has_mt5 or mt5_connected or bridge_connected,
                "broker": broker,
                "account": display_account,  # ★ 유저 계정 우선
                "server": server,
                "balance": balance,
                "equity": equity,
                "margin": margin,
                "free_margin": free_margin,
                "leverage": leverage,
                "positions_count": positions_count,
                "position": position_data,
                "buy_count": buy_count,
                "sell_count": sell_count,
                "neutral_count": neutral_count,
                "base_score": base_score,
                "all_prices": all_prices,
                "all_candles": all_candles,
                "martin": martin_state,
                "user_id": user_id,
                "history": live_history,  # ★ 거래 히스토리
                "today_pl": live_today_pl,  # ★ 오늘 P/L
                "sync_event": sync_event  # ★ SL/TP 청산 이벤트
            }
            
            await websocket.send_text(json.dumps(data))
            await asyncio.sleep(random.uniform(1.0, 3.0))  # ★ 0.5초마다 전송 (실시간 업데이트)

        except WebSocketDisconnect:
            break
        except Exception as e:
                if str(e):
                    print(f"WebSocket Error: {e}")
                await asyncio.sleep(random.uniform(1.0, 3.0))

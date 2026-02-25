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
from dateutil import parser as dateutil_parser
import pytz

# ★★★ JSON 직렬화 안전 변환 헬퍼 ★★★
def safe_json_value(val):
    """datetime, bytes 등 JSON 직렬화 안 되는 타입을 안전하게 변환"""
    if val is None:
        return None
    if isinstance(val, (datetime,)):
        return val.isoformat()
    if hasattr(val, 'isoformat'):  # date, datetime 등
        return val.isoformat()
    if isinstance(val, bytes):
        return val.decode('utf-8', errors='replace')
    return val

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
from ..models.live_martin_state import LiveMartinState
from ..models.live_trade import LiveTrade
from ..utils.security import decode_token
from ..services.indicator_service import IndicatorService
from ..services.martin_service import martin_service
from math import ceil
# calculate_indicators_from_bridge는 함수 내부에서 지연 import (순환 참조 방지)

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
# ★★★ 자동청산 캐시 (프론트엔드 전달용) ★★★
auto_closed_cache = {}
user_close_acknowledged = {}  # ★ 유저 청산 확인: {user_id: timestamp} — WS 이중 감지 방지

# ★★★ 자동청산 쿨다운 (중복 방지) ★★★
auto_close_cooldown = {}

# ★★★ MetaAPI 프로비저닝 에러 메시지 (metaapi-status에서 전달) ★★★
metaapi_error_messages = {}

# ★ 자동 deploy 쿨다운 (유저별 마지막 시도 시간)
_auto_deploy_cooldown = {}  # {user_id: timestamp}
AUTO_DEPLOY_COOLDOWN_SEC = 60  # 60초 쿨다운

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
    candles = symbol_data.get(timeframe, [])
    return candles

def aggregate_candles(m1_candles: list, target_tf: str) -> list:
    """M1 캔들을 상위 타임프레임으로 합성"""
    tf_minutes = {
        "M1": 1, "M5": 5, "M15": 15, "M30": 30,
        "H1": 60, "H4": 240, "D1": 1440, "W1": 10080
    }

    minutes = tf_minutes.get(target_tf, 1)
    if minutes <= 1 or not m1_candles:
        return m1_candles

    # 시간 기준으로 그룹화
    aggregated = {}
    for candle in m1_candles:
        candle_time = candle.get("time", 0)
        # 타임프레임 단위로 정렬 (분 단위 * 60초)
        group_time = (candle_time // (minutes * 60)) * (minutes * 60)

        if group_time not in aggregated:
            aggregated[group_time] = {
                "time": group_time,
                "open": candle.get("open", 0),
                "high": candle.get("high", 0),
                "low": candle.get("low", 0),
                "close": candle.get("close", 0),
                "volume": candle.get("volume", 0)
            }
        else:
            agg = aggregated[group_time]
            agg["high"] = max(agg["high"], candle.get("high", 0))
            agg["low"] = min(agg["low"], candle.get("low", 0))
            agg["close"] = candle.get("close", 0)  # 마지막 close
            agg["volume"] = agg.get("volume", 0) + candle.get("volume", 0)

    # 시간순 정렬
    result = sorted(aggregated.values(), key=lambda x: x["time"])
    print(f"[Candles] M1 {len(m1_candles)}개 → {target_tf} {len(result)}개 합성")
    return result

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
async def get_account_info(
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """MT5 계정 정보 + 인디케이터 + 포지션 조회"""
    try:
        # ★★★ MetaAPI에서 계정/포지션 정보 가져오기 ★★★
        from .metaapi_service import get_metaapi_account, get_metaapi_positions, is_metaapi_connected, user_metaapi_cache

        # ★★★ 유저별 MetaAPI 판단 ★★★
        _use_user_metaapi = bool(current_user.metaapi_account_id and current_user.metaapi_status == 'deployed')
        _user_ma_cache = user_metaapi_cache.get(current_user.id) if _use_user_metaapi else None

        metaapi_account = get_metaapi_account()
        metaapi_positions = get_metaapi_positions()
        metaapi_connected = is_metaapi_connected()

        if not mt5_initialize_safe():
            # MT5 없음 - MetaAPI 또는 bridge_cache에서 정보 조회

            # 인디케이터 계산
            try:
                indicators = IndicatorService.calculate_all_indicators("BTCUSD")
                buy_count = indicators["buy"]
                sell_count = indicators["sell"]
                neutral_count = indicators["neutral"]
                base_score = indicators["score"]
            except Exception:
                buy_count, sell_count, neutral_count, base_score = 33, 33, 34, 50

            # ★★★ 0순위: 유저별 MetaAPI 계정 데이터 ★★★
            if _use_user_metaapi and _user_ma_cache and _user_ma_cache.get("account_info"):
                _u_acc = _user_ma_cache["account_info"]
                balance = _u_acc.get("balance", 0)
                equity = _u_acc.get("equity", balance)
                margin = _u_acc.get("margin", 0)
                free_margin = _u_acc.get("freeMargin", balance)
                profit = _u_acc.get("profit", 0)
                leverage = _u_acc.get("leverage", 500)

                # 유저별 포지션
                _u_positions = _user_ma_cache.get("positions", [])
                position_data = None
                for pos in _u_positions:
                    if pos.get("magic") == magic:
                        pos_type = pos.get("type", "")
                        if isinstance(pos_type, int):
                            pos_type = "BUY" if pos_type == 0 else "SELL"
                        elif "BUY" in str(pos_type):
                            pos_type = "BUY"
                        else:
                            pos_type = "SELL"
                        position_data = {
                            "type": pos_type,
                            "symbol": pos.get("symbol", ""),
                            "volume": pos.get("volume", 0),
                            "entry": pos.get("openPrice", 0),
                            "profit": pos.get("profit", 0),
                            "ticket": pos.get("id", 0),
                            "magic": pos.get("magic", 0)
                        }
                        break

                # DB 업데이트
                if current_user.has_mt5_account:
                    current_user.mt5_balance = balance
                    current_user.mt5_equity = equity
                    current_user.mt5_margin = margin
                    current_user.mt5_free_margin = free_margin
                    current_user.mt5_profit = profit
                    current_user.mt5_leverage = leverage
                    current_user.metaapi_last_active = datetime.utcnow()
                    db.commit()

                return {
                    "broker": "HedgeHood Pty Ltd",
                    "account": current_user.mt5_account_number or "MetaAPI",
                    "server": current_user.mt5_server or "HedgeHood-MT5",
                    "balance": balance,
                    "equity": equity,
                    "margin": margin,
                    "free_margin": free_margin,
                    "profit": profit,
                    "leverage": leverage,
                    "currency": "USD",
                    "positions_count": len(_u_positions),
                    "position": position_data,
                    "buy_count": buy_count,
                    "sell_count": sell_count,
                    "neutral_count": neutral_count,
                    "base_score": base_score,
                    "prices": get_bridge_prices(),
                    "martin": martin_service.get_state(),
                    "has_mt5": True,
                    "metaapi_mode": "user"
                }

            # ★★★ 1순위: 공유 MetaAPI (유저별 MetaAPI가 없는 경우만) ★★★
            if metaapi_connected and metaapi_account and not _use_user_metaapi:
                balance = metaapi_account.get("balance", 0)
                equity = metaapi_account.get("equity", balance)
                margin = metaapi_account.get("margin", 0)
                free_margin = metaapi_account.get("freeMargin", balance)
                profit = metaapi_account.get("profit", 0)
                leverage = metaapi_account.get("leverage", 500)

                # 패널용 포지션 (magic 파라미터로 필터링)
                position_data = None
                for pos in metaapi_positions:
                    if pos.get("magic") == magic:
                        pos_type = pos.get("type", "")
                        if isinstance(pos_type, int):
                            pos_type = "BUY" if pos_type == 0 else "SELL"
                        position_data = {
                            "type": pos_type,
                            "symbol": pos.get("symbol", ""),
                            "volume": pos.get("volume", 0),
                            "entry": pos.get("openPrice", 0),
                            "profit": pos.get("profit", 0),
                            "ticket": pos.get("id", 0),
                            "magic": pos.get("magic", 0)
                        }
                        break

                # ★★★ 유저 DB 업데이트 ★★★
                if current_user.has_mt5_account:
                    current_user.mt5_balance = balance
                    current_user.mt5_equity = equity
                    current_user.mt5_margin = margin
                    current_user.mt5_free_margin = free_margin
                    current_user.mt5_profit = profit
                    current_user.mt5_leverage = leverage
                    db.commit()

                return {
                    "broker": "MetaAPI Live",
                    "account": current_user.mt5_account_number or "MetaAPI",
                    "server": current_user.mt5_server or "HedgeHood-MT5",
                    "balance": balance,
                    "equity": equity,
                    "margin": margin,
                    "free_margin": free_margin,
                    "profit": profit,
                    "leverage": leverage,
                    "currency": "USD",
                    "positions_count": len(metaapi_positions),
                    "position": position_data,
                    "buy_count": buy_count,
                    "sell_count": sell_count,
                    "neutral_count": neutral_count,
                    "base_score": base_score,
                    "prices": get_bridge_prices(),
                    "martin": martin_service.get_state(),
                    "has_mt5": True
                }

            # ★★★ Bridge 캐시 fallback ★★★
            cached_positions = bridge_cache.get("positions", [])

            # 패널용 포지션 (magic 파라미터로 필터링)
            position_data = None
            for pos in cached_positions:
                if pos.get("magic") == magic:
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
            # 패널용 포지션 (magic 파라미터로 필터링)
            buysell_pos = None
            for pos in positions:
                if pos.magic == magic:
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
        # MT5 없음 - MetaAPI 캔들 캐시에서 직접 반환 (모든 TF 실시간 업데이트됨)
        from .metaapi_service import quote_candle_cache
        cached_candles = quote_candle_cache.get(symbol, {}).get(timeframe, [])
        # fallback: 브릿지 캐시
        if not cached_candles:
            cached_candles = get_bridge_candles(symbol, timeframe)
        if cached_candles:
            candles = cached_candles[-count:] if len(cached_candles) > count else cached_candles
            closes = [c['close'] for c in candles]
            highs = [c['high'] for c in candles]
            lows = [c['low'] for c in candles]
            print(f"[Candles] {symbol}/{timeframe} - 캐시에서 {len(candles)}개 로드")

    # ★ null/0 값 캔들 필터링 (lightweight-charts "Value is null" 에러 방지)
    if candles:
        candles = [c for c in candles if c.get('time') and c.get('open') and c.get('high') and c.get('low') and c.get('close')]

    # ★ time 기준 정렬 + 같은 time 중복 제거 (MetaAPI vs realtime 시간 기준 충돌 방지)
    if candles:
        candles.sort(key=lambda x: x['time'])
        seen_times = {}
        for c in candles:
            seen_times[c['time']] = c  # 같은 time이면 마지막 것 유지
        candles = sorted(seen_times.values(), key=lambda x: x['time'])

    if candles:
        closes = [c['close'] for c in candles]
        highs = [c['high'] for c in candles]
        lows = [c['low'] for c in candles]

    # ★ Binance fallback 비활성화 (MetaAPI와 시간 기준 불일치로 D1/W1 역순 발생)
    # if not candles:
    #     if 'BTC' in symbol or 'ETH' in symbol:
    #         try:
    #             candles = await fetch_binance_candles(symbol, timeframe, count)
    #             if candles:
    #                 closes = [c['close'] for c in candles]
    #                 highs = [c['high'] for c in candles]
    #                 lows = [c['low'] for c in candles]
    #                 print(f"[Candles] {symbol}/{timeframe} - Binance fallback {len(candles)}개")
    #         except Exception as e:
    #             print(f"[Candles] Binance fallback error: {e}")

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
    magic: int = 100001,
    is_martin: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """일반 주문 실행 (BUY/SELL) - MetaAPI 버전 + 마틴 모드 지원"""
    import time as time_module
    from .metaapi_service import metaapi_service, quote_price_cache, metaapi_positions_cache, is_metaapi_connected, get_metaapi_account, place_order_for_user, user_metaapi_cache

    # ★★★ 유저별 MetaAPI 판단 ★★★
    _use_user_metaapi = bool(current_user.metaapi_account_id and current_user.metaapi_status == 'deployed')
    _user_mid = current_user.metaapi_account_id if _use_user_metaapi else None

    # ★★★ MetaAPI 연결 상태 체크 (공유 + 유저별 모두) ★★★
    if _use_user_metaapi:
        # 유저별 MetaAPI: DB status가 deployed가 아니면 거부
        if current_user.metaapi_status != 'deployed':
            print(f"[MetaAPI Order] ❌ 유저 MetaAPI 준비 안 됨 (status={current_user.metaapi_status})")
            return JSONResponse({
                "success": False,
                "message": "Trading API가 아직 준비 중입니다. 잠시 후 다시 시도해주세요.",
                "metaapi_disconnected": True
            })
    else:
        if not is_metaapi_connected():
            print(f"[MetaAPI Order] ❌ MetaAPI 연결 끊김 - 주문 거부")
            return JSONResponse({
                "success": False,
                "message": "MetaAPI 연결이 불안정합니다. 잠시 후 다시 시도해주세요.",
                "metaapi_disconnected": True
            })

    # ★★★ 마틴 모드 감지 및 랏/타겟 재계산 ★★★
    martin_state = None
    martin_step = 1
    if is_martin:
        martin_state = get_or_create_live_martin_state(db, current_user.id, magic)
        if martin_state.enabled:
            # 마틴 랏 계산: base_lot × 2^(step-1)
            martin_lot = martin_state.base_lot * (2 ** (martin_state.step - 1))
            martin_lot = round(martin_lot, 2)

            # 프론트에서 보낸 target으로 base_target 업데이트
            if target > 0 and target != martin_state.base_target:
                martin_state.base_target = target
                db.commit()
                print(f"[MARTIN ORDER] Updated base_target: {target}")

            # 마틴 목표 계산: ceil((accumulated_loss + base_target) / 5) * 5
            real_target = ceil((martin_state.accumulated_loss + martin_state.base_target) / 5) * 5

            martin_step = martin_state.step
            print(f"[MARTIN ORDER] User {current_user.id} Step {martin_step}: Lot {volume:.2f} → {martin_lot:.2f}, Target ${target} → ${real_target} (AccLoss=${martin_state.accumulated_loss:.2f})")

            volume = martin_lot
            target = real_target

    print(f"[MetaAPI Order] 주문 요청: {order_type} {symbol} {volume} lot, target=${target}, martin={is_martin}")

    # ★★★ 종목별 1 lot 증거금 (실제 브로커 기준) ★★★
    SYMBOL_MARGIN_PER_LOT = {
        "BTCUSD": 672,
        "ETHUSD": 200,
        "US100.": 2517,
        "XAUUSD.r": 1012,
        "EURUSD.r": 237,
        "USDJPY.r": 200,
        "GBPUSD.r": 250,
        "AUDUSD.r": 150,
        "USDCAD.r": 200
    }

    # ★★★ 증거금 사전 체크 (마틴 모드 필수) ★★★
    if is_martin and martin_state and martin_state.enabled:
        account_info = get_metaapi_account()
        free_margin = account_info.get('freeMargin', 0)

        # 종목별 1 lot 증거금 조회
        margin_per_lot = SYMBOL_MARGIN_PER_LOT.get(symbol, 500)

        # 현재 step 기준 필요 증거금: step_lot × margin_per_lot
        required_margin = volume * margin_per_lot
        required_margin = round(required_margin, 2)

        print(f"[MetaAPI Order] 증거금 체크: free_margin=${free_margin:.2f}, required=${required_margin:.2f} (Step {martin_step}, {volume:.2f} lot)")

        if required_margin > free_margin:
            print(f"[MetaAPI Order] ❌ 증거금 부족: 필요 ${required_margin:.2f} > 가용 ${free_margin:.2f}")
            return JSONResponse({
                "success": False,
                "message": f"증거금 부족! 가용마진: ${free_margin:.0f}, 필요마진: ${required_margin:.0f} (Step {martin_step}, {volume:.2f} lot)",
                "margin_insufficient": True,
                "free_margin": free_margin,
                "required_margin": required_margin,
                "martin_step": martin_step,
                "martin_lot": volume
            })


    # ★★★ 일반 모드 증거금 사전 체크 ★★★
    if not is_martin:
        # 유저별 MetaAPI: user_metaapi_cache에서 계정정보 조회
        if _use_user_metaapi:
            _u_acc = user_metaapi_cache.get(current_user.id, {}).get("account_info", {})
            free_margin = _u_acc.get("freeMargin", 0) if _u_acc else 0
        else:
            _u_acc = get_metaapi_account()
            free_margin = _u_acc.get("freeMargin", 0)

        margin_per_lot = SYMBOL_MARGIN_PER_LOT.get(symbol, 500)
        required_margin = round(volume * margin_per_lot, 2)

        print(f"[MetaAPI Order] 증거금 체크 (일반): free_margin=${free_margin:.2f}, required=${required_margin:.2f} ({volume:.2f} lot)")

        if free_margin > 0 and required_margin > free_margin:
            print(f"[MetaAPI Order] ❌ 증거금 부족 (일반): 필요 ${required_margin:.2f} > 가용 ${free_margin:.2f}")
            return JSONResponse({
                "success": False,
                "message": f"증거금 부족! 가용: ${free_margin:.0f} / 필요: ${required_margin:.0f}",
                "margin_insufficient": True,
                "free_margin": free_margin,
                "required_margin": required_margin,
                "volume": volume
            })
    # ★★★ 중복 주문 방지: 같은 매직넘버 + 같은 종목 포지션 확인 ★★★
    # 종목이 다르면 같은 매직넘버라도 독립 주문 허용 (QuickEasy 다종목 지원)
    if _use_user_metaapi:
        _user_positions = user_metaapi_cache.get(current_user.id, {}).get("positions", [])
    else:
        _user_positions = user_live_cache.get(current_user.id, {}).get("positions", [])
    existing = [p for p in _user_positions if p.get('magic') == magic and p.get('symbol') == symbol]
    if existing:
        print(f"[MetaAPI Order] 중복 주문 차단: user={current_user.id}, magic={magic}, symbol={symbol}, 기존 포지션={len(existing)}개")
        return JSONResponse({"success": False, "message": f"{symbol} 포지션이 이미 있습니다"})

    # ★★★ MetaAPI를 통한 주문 실행 ★★★
    try:
        # ★★★ 스프레드 체크 (30% 기준) + TP/SL points 계산 ★★★
        tp_points = 0
        sl_points = 0
        if target > 0:
            from .metaapi_service import quote_price_cache as qpc
            price_data = qpc.get(symbol, {})
            bid = price_data.get('bid', 0)
            ask = price_data.get('ask', 0)
            
            if bid > 0 and ask > 0:
                spread_raw = ask - bid  # 가격 스프레드
                
                # 스프레드 비용 계산 (volume * tick_value 기준)
                specs = SYMBOL_SPECS.get(symbol, {"tick_value": 0.01, "tick_size": 0.01})
                tick_value = specs.get("tick_value", 0.01)
                tick_size = specs.get("tick_size", 0.01)
                
                if tick_size > 0 and tick_value > 0:
                    spread_points = spread_raw / tick_size
                    spread_cost = spread_points * tick_value * volume
                else:
                    spread_cost = 0
                
                spread_ratio = (spread_cost / target) if target > 0 else 0
                print(f"[MetaAPI Order] 스프레드 체크: spread={spread_raw}, cost=${spread_cost:.2f}, target=${target}, ratio={spread_ratio:.1%}")

                # ★★★ 마틴 모드는 40%, 일반은 35% ★★★
                spread_limit = 0.40 if is_martin else 0.35
                if spread_ratio > spread_limit:
                    print(f"[MetaAPI Order] ❌ 스프레드 거부: {spread_ratio:.1%} > {spread_limit:.0%}")
                    return JSONResponse({
                        "success": False,
                        "message": f"스프레드 비용(${spread_cost:.1f})이 타겟(${target})의 {spread_ratio:.0%}입니다. 잠시 후 다시 시도해주세요.",
                        "spread_rejected": True,
                        "spread_cost": round(spread_cost, 2),
                        "spread_ratio": round(spread_ratio * 100, 1)
                    })
                
                # ★★★ TP/SL 포인트 계산 ★★★
                point_value = tick_value if tick_value > 0 else 1
                tp_points = int(target / (volume * point_value)) if volume * point_value > 0 else 500
                sl_points = int((target * 0.99) / (volume * point_value)) if volume * point_value > 0 else tp_points  # SL = TP × 99% (magic 무관 통일)
                print(f"[MetaAPI Order] TP/SL 계산: target=${target}, magic={magic} -> tp_points={tp_points}, sl_points={sl_points}")
            else:
                # 가격 없으면 기본값
                specs = SYMBOL_SPECS.get(symbol, {"tick_value": 0.01})
                point_value = specs.get("tick_value", 0.01)
                tp_points = int(target / (volume * point_value)) if volume * point_value > 0 else 500
                sl_points = int((target * 0.99) / (volume * point_value)) if volume * point_value > 0 else tp_points
                print(f"[MetaAPI Order] 가격 없음, 기본 SL/TP: tp={tp_points}, sl={sl_points}, magic={magic}")

        # ★★★ MetaAPI 주문 실행 (유저별 or 공유) ★★★
        if _use_user_metaapi:
            result = await place_order_for_user(
                user_id=current_user.id,
                metaapi_account_id=_user_mid,
                symbol=symbol,
                order_type=order_type.upper(),
                volume=volume,
                sl_points=sl_points,
                tp_points=tp_points,
                magic=magic,
                comment=f"Trading-X {order_type.upper()}"
            )
            # 활동 시각 갱신
            current_user.metaapi_last_active = datetime.utcnow()
            db.commit()
            print(f"[Order] User {current_user.id} 유저별 MetaAPI 주문")
        else:
            result = await metaapi_service.place_order(
                symbol=symbol,
                order_type=order_type.upper(),
                volume=volume,
                sl_points=sl_points,
                tp_points=tp_points,
                magic=magic,
                comment=f"Trading-X {order_type.upper()}"
            )

        if result.get('success'):
            position_id = result.get('positionId', '')
            order_id = result.get('orderId', '')

            # 현재 가격 가져오기
            price_data = quote_price_cache.get(symbol, {})
            entry_price = price_data.get('ask' if order_type.upper() == 'BUY' else 'bid', 0)

            # ★★★ user_live_cache 업데이트 ★★★
            if current_user.id not in user_live_cache:
                user_live_cache[current_user.id] = {"positions": [], "account_info": {}}

            new_position = {
                "id": position_id,
                "ticket": order_id,
                "symbol": symbol,
                "type": 0 if order_type.upper() == 'BUY' else 1,
                "volume": volume,
                "price_open": entry_price,
                "profit": 0,
                "magic": magic,
                "comment": f"Trading-X {order_type.upper()}"
            }
            user_live_cache[current_user.id]["positions"].append(new_position)
            user_live_cache[current_user.id]["updated_at"] = time_module.time()

            # ★★★ LiveTrade DB 기록 (등급 시스템용) ★★★
            try:
                live_trade = LiveTrade(
                    user_id=current_user.id,
                    symbol=symbol,
                    trade_type=order_type.upper(),
                    volume=volume,
                    position_id=position_id,
                    entry_price=entry_price,
                    magic=magic
                )
                db.add(live_trade)
                db.commit()
                print(f"[LiveTrade] ✅ 기록 저장: user={current_user.id}, {order_type} {symbol} {volume}lot, pos={position_id}")
            except Exception as lt_err:
                db.rollback()
                print(f"[LiveTrade] ⚠️ 기록 실패 (주문은 성공): {lt_err}")

            # ★★★ 자동청산용 타겟 저장 ★★★
            if target > 0:
                user_target_cache[current_user.id] = target
                print(f"[MetaAPI Order] 타겟 저장: User {current_user.id} = ${target}")

            # ★★★ 주문 직후 빠른 동기화 예약 (3초 + 6초 후) ★★★
            _now = time_module.time()
            if current_user.id not in globals().get('_user_sync_soon_map', {}):
                if '_user_sync_soon_map' not in globals():
                    globals()['_user_sync_soon_map'] = {}
                globals()['_user_sync_soon_map'][current_user.id] = [_now + 3, _now + 6]
                print(f"[MetaAPI Order] ⏰ User {current_user.id} 빠른 동기화 예약: 3초+6초 후")

            print(f"[MetaAPI Order] ✅ 주문 성공: {order_type} {symbol} {volume} lot, positionId={position_id}")

            response_data = {
                "success": True,
                "message": f"{order_type.upper()} 성공! {volume} lot",
                "ticket": order_id,
                "positionId": position_id,
                "metaapi_mode": True
            }

            # ★★★ 마틴 모드 정보 추가 ★★★
            if is_martin and martin_state and martin_state.enabled:
                response_data["martin_step"] = martin_step
                response_data["martin_lot"] = volume
                response_data["martin_target"] = target
                response_data["message"] = f"[MARTIN Step {martin_step}] {order_type.upper()} {volume} lot"

            return JSONResponse(response_data)
        else:
            error_msg = result.get('error', 'Unknown error')
            print(f"[MetaAPI Order] ❌ 주문 실패: {error_msg}")
            return JSONResponse({
                "success": False,
                "message": f"주문 실패: {error_msg}"
            })

    except Exception as e:
        print(f"[MetaAPI Order] ❌ 예외 발생: {e}")
        return JSONResponse({
            "success": False,
            "message": f"주문 오류: {str(e)}"
        })

    # ========== 기존 Bridge/MT5 코드 (주석 처리) ==========
    # if not MT5_AVAILABLE:
    #     bridge_age = time_module.time() - get_bridge_heartbeat()
    #     if bridge_age > 30:
    #         return JSONResponse({"success": False, "message": "MT5 브릿지 연결 없음"})
    #     order_id = str(uuid.uuid4())[:8]
    #     ... (기존 브릿지 코드)
    # if not mt5_initialize_safe():
    #     return JSONResponse({"success": False, "message": "MT5 초기화 실패"})
    # ... (기존 MT5 직접 연결 코드)


# ========== SL/TP 설정 (바이셀 패널용) ==========
@router.post("/set-sltp")
async def set_sltp(
    symbol: str = "BTCUSD",
    sl: float = 0,
    tp: float = 0,
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """기존 포지션에 SL/TP 설정 (바이셀 패널용) - MetaAPI"""
    from .metaapi_service import metaapi_service, is_metaapi_connected, user_metaapi_cache

    _use_user_metaapi = bool(current_user.metaapi_account_id and current_user.metaapi_status == "deployed")

    # 포지션 찾기
    if _use_user_metaapi:
        _positions = user_metaapi_cache.get(current_user.id, {}).get("positions", [])
    else:
        _positions = user_live_cache.get(current_user.id, {}).get("positions", [])

    target_pos = None
    for p in _positions:
        if p.get("symbol") == symbol and p.get("magic") == magic:
            target_pos = p
            break

    if not target_pos:
        return JSONResponse({"success": False, "message": f"{symbol} 포지션을 찾을 수 없습니다"})

    position_id = target_pos.get("id", "")
    if not position_id:
        return JSONResponse({"success": False, "message": "포지션 ID를 찾을 수 없습니다"})

    # SL/TP 값 검증
    stop_loss = sl if sl > 0 else None
    take_profit = tp if tp > 0 else None

    if not stop_loss and not take_profit:
        return JSONResponse({"success": False, "message": "SL 또는 TP 값을 입력하세요"})

    try:
        if _use_user_metaapi:
            from .metaapi_service import get_user_trade_connection
            rpc = await get_user_trade_connection(current_user.id, current_user.metaapi_account_id)
            if not rpc:
                return JSONResponse({"success": False, "message": "MetaAPI 연결 실패"})
            result = await rpc.modify_position(
                position_id=position_id,
                stop_loss=stop_loss,
                take_profit=take_profit
            )
        else:
            if not metaapi_service.trade_connection:
                return JSONResponse({"success": False, "message": "MetaAPI 연결 실패"})
            result = await metaapi_service.trade_connection.modify_position(
                position_id=position_id,
                stop_loss=stop_loss,
                take_profit=take_profit
            )

        if result and result.get("stringCode") == "TRADE_RETCODE_DONE":
            print(f"[MT5 SL/TP] ✅ {symbol} SL={stop_loss}, TP={take_profit} 설정 완료 (pos={position_id})")
            return JSONResponse({"success": True, "message": f"SL/TP 설정 완료"})
        else:
            print(f"[MT5 SL/TP] ⚠️ 응답: {result}")
            return JSONResponse({"success": True, "message": "SL/TP 설정 요청 전송됨"})

    except Exception as e:
        print(f"[MT5 SL/TP] ❌ 실패: {e}")
        return JSONResponse({"success": False, "message": f"SL/TP 설정 실패: {str(e)}"})

# ========== 포지션 청산 ==========
@router.post("/close")
async def close_position(
    symbol: str = "BTCUSD",
    magic: int = None,
    position_id: str = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """포지션 청산 (magic 필터 옵션) - MetaAPI 버전"""
    import time as time_module
    from .metaapi_service import metaapi_service, remove_position_from_cache, close_position_for_user, get_user_positions, user_metaapi_cache

    # ★★★ 유저별 MetaAPI 판단 ★★★
    _use_user_metaapi = bool(current_user.metaapi_account_id and current_user.metaapi_status == 'deployed')
    _user_mid = current_user.metaapi_account_id if _use_user_metaapi else None

    print(f"[MetaAPI Close] 청산 요청: symbol={symbol}, magic={magic}, position_id={position_id}, user_metaapi={_use_user_metaapi}")

    # ★★★ MetaAPI를 통한 청산 실행 ★★★
    try:
        # 1) position_id가 직접 전달된 경우
        if position_id:
            if _use_user_metaapi:
                result = await close_position_for_user(current_user.id, _user_mid, position_id)
                current_user.metaapi_last_active = datetime.utcnow()
                db.commit()
            else:
                result = await metaapi_service.close_position(position_id)
            if result.get('success'):
                # ★★★ MT5 실제 체결 손익 우선 사용 ★★★
                actual_profit = result.get('actual_profit')
                actual_commission = result.get('actual_commission', 0)
                actual_swap = result.get('actual_swap', 0)

                if actual_profit is not None:
                    profit = round(actual_profit + actual_commission + actual_swap, 2)
                    print(f"[MetaAPI Close] ★ MT5 실제 손익: profit={actual_profit}, comm={actual_commission}, swap={actual_swap} → 총={profit}")
                else:
                    profit = 0
                    print(f"[MetaAPI Close] ⚠️ actual_profit 없음")

                # user_live_cache에서 포지션 제거 + today_pl 업데이트
                if current_user.id in user_live_cache:
                    positions = user_live_cache[current_user.id].get("positions", [])
                    user_live_cache[current_user.id]["positions"] = [
                        p for p in positions if p.get("id") != position_id
                    ]
                    # ★★★ today_pl 업데이트 ★★★
                    if actual_profit is not None:
                        old_today_pl = user_live_cache[current_user.id].get("today_pl", 0)
                        user_live_cache[current_user.id]["today_pl"] = round(old_today_pl + profit, 2)
                        print(f"[MetaAPI Close] ★ today_pl 업데이트: ${old_today_pl:.2f} + ${profit:.2f} = ${user_live_cache[current_user.id]['today_pl']:.2f}")

                # ★★★ user_metaapi_cache에서도 해당 포지션 제거 (재출현 방지) ★★★
                if current_user.id in user_metaapi_cache and "positions" in user_metaapi_cache.get(current_user.id, {}):
                    user_metaapi_cache[current_user.id]["positions"] = [
                        p for p in user_metaapi_cache[current_user.id]["positions"]
                        if p.get("id") != position_id
                    ]
                    print(f"[MetaAPI Close] 🧹 user_metaapi_cache 포지션 제거: {position_id}")

                # ★★★ WS 이중 감지 방지 플래그 ★★★
                user_close_acknowledged[current_user.id] = time_module.time()
                user_close_acknowledged[f"{current_user.id}_pos_id"] = str(position_id)

                # ★★★ LiveTrade DB 업데이트 (등급 시스템용) ★★★
                try:
                    live_trade_record = db.query(LiveTrade).filter(
                        LiveTrade.user_id == current_user.id,
                        LiveTrade.position_id == str(position_id),
                        LiveTrade.is_closed == False
                    ).first()
                    if live_trade_record:
                        live_trade_record.exit_price = result.get('close_price', 0)
                        live_trade_record.profit = profit
                        live_trade_record.is_closed = True
                        live_trade_record.closed_at = datetime.utcnow()
                        db.commit()
                        print(f"[LiveTrade] ✅ 청산 기록 업데이트: pos={position_id}, profit=${profit:.2f}")
                    else:
                        print(f"[LiveTrade] ⚠️ 해당 포지션 기록 없음: pos={position_id}")
                except Exception as lt_err:
                    db.rollback()
                    print(f"[LiveTrade] ⚠️ 업데이트 실패: {lt_err}")

                print(f"[MetaAPI Close] ✅ 청산 성공: positionId={position_id}, P/L=${profit:.2f}")
                return JSONResponse({
                    "success": True,
                    "message": f"청산 성공! P/L: ${profit:,.2f}",
                    "profit": profit,
                    "raw_profit": actual_profit if actual_profit is not None else profit,
                    "positionId": position_id,
                    "metaapi_mode": True,
                    "actual": actual_profit is not None
                })
            else:
                # ★★★ 에러 시 캐시 정리 (이미 청산된 포지션일 수 있음) ★★★
                error_msg = result.get('error', '')
                if 'POSITION_NOT_FOUND' in str(error_msg) or 'not found' in str(error_msg).lower():
                    # 캐시에서 제거
                    remove_position_from_cache(position_id)
                    if current_user.id in user_live_cache:
                        positions = user_live_cache[current_user.id].get("positions", [])
                        user_live_cache[current_user.id]["positions"] = [
                            p for p in positions if p.get("id") != position_id
                        ]
                    print(f"[MetaAPI Close] ⚠️ 이미 청산됨: positionId={position_id}")
                    return JSONResponse({
                        "success": True,
                        "message": "이미 청산됨",
                        "positionId": position_id,
                        "force_sync": True,
                        "metaapi_mode": True
                    })
                return JSONResponse({
                    "success": False,
                    "message": f"청산 실패: {result.get('error')}"
                })

        # 2) symbol/magic으로 포지션 찾아서 청산
        if _use_user_metaapi:
            positions = await get_user_positions(current_user.id, _user_mid)
        else:
            positions = await metaapi_service.get_positions()
        if not positions:
            return JSONResponse({"success": False, "message": "열린 포지션 없음"})

        # 필터링 (symbol, magic)
        target_positions = []
        for pos in positions:
            if pos.get('symbol') != symbol:
                continue
            if magic is not None and pos.get('magic') != magic:
                continue
            target_positions.append(pos)

        if not target_positions:
            return JSONResponse({"success": False, "message": f"{symbol} 포지션 없음"})

        # 첫 번째 매칭 포지션 청산
        pos = target_positions[0]
        pos_id = pos.get('id')
        if _use_user_metaapi:
            result = await close_position_for_user(current_user.id, _user_mid, pos_id)
            current_user.metaapi_last_active = datetime.utcnow()
            db.commit()
        else:
            result = await metaapi_service.close_position(pos_id)

        if result.get('success'):
            # ★★★ MT5 실제 체결 손익 우선 사용 ★★★
            actual_profit = result.get('actual_profit')
            actual_commission = result.get('actual_commission', 0)
            actual_swap = result.get('actual_swap', 0)
            
            if actual_profit is not None:
                # MT5 실제 손익 (commission + swap 포함)
                profit = round(actual_profit + actual_commission + actual_swap, 2)
                print(f"[MetaAPI Close] ★ MT5 실제 손익: profit={actual_profit}, comm={actual_commission}, swap={actual_swap} → 총={profit}")
            else:
                # fallback: 캐시된 손익
                profit = pos.get('profit', 0)
                print(f"[MetaAPI Close] ⚠️ 캐시 손익 사용: {profit}")
            
            # user_live_cache에서 포지션 제거
            if current_user.id in user_live_cache:
                cache_positions = user_live_cache[current_user.id].get("positions", [])
                user_live_cache[current_user.id]["positions"] = [
                    p for p in cache_positions if p.get("id") != pos_id
                ]
            # ★★★ user_metaapi_cache에서도 해당 포지션 제거 (재출현 방지) ★★★
            if current_user.id in user_metaapi_cache and "positions" in user_metaapi_cache.get(current_user.id, {}):
                user_metaapi_cache[current_user.id]["positions"] = [
                    p for p in user_metaapi_cache[current_user.id]["positions"]
                    if p.get("id") != pos_id
                ]
                print(f"[MetaAPI Close] 🧹 user_metaapi_cache 포지션 제거: {pos_id}")
            # ★★★ WS 이중 감지 방지 플래그 ★★★
            user_close_acknowledged[current_user.id] = time_module.time()
            user_close_acknowledged[f"{current_user.id}_pos_id"] = str(pos_id)

            # ★★★ LiveTrade DB 업데이트 (등급 시스템용) ★★★
            try:
                live_trade_record = db.query(LiveTrade).filter(
                    LiveTrade.user_id == current_user.id,
                    LiveTrade.position_id == str(pos_id),
                    LiveTrade.is_closed == False
                ).first()
                if live_trade_record:
                    live_trade_record.exit_price = result.get('close_price', 0)
                    live_trade_record.profit = profit
                    live_trade_record.is_closed = True
                    live_trade_record.closed_at = datetime.utcnow()
                    db.commit()
                    print(f"[LiveTrade] ✅ 청산 기록 업데이트: pos={pos_id}, profit=${profit:.2f}")
                else:
                    print(f"[LiveTrade] ⚠️ 해당 포지션 기록 없음: pos={pos_id}")
            except Exception as lt_err:
                db.rollback()
                print(f"[LiveTrade] ⚠️ 업데이트 실패: {lt_err}")

            print(f"[MetaAPI Close] ✅ 청산 성공: {symbol} P/L=${profit:.2f}")
            return JSONResponse({
                "success": True,
                "message": f"청산 성공! P/L: ${profit:,.2f}",
                "profit": profit,
                "raw_profit": actual_profit if actual_profit is not None else profit,
                "positionId": pos_id,
                "metaapi_mode": True,
                "actual": actual_profit is not None
            })
        else:
            # ★★★ 에러 시 캐시 정리 ★★★
            error_msg = result.get('error', '')
            if 'POSITION_NOT_FOUND' in str(error_msg) or 'not found' in str(error_msg).lower():
                remove_position_from_cache(pos_id)
                if current_user.id in user_live_cache:
                    cache_positions = user_live_cache[current_user.id].get("positions", [])
                    user_live_cache[current_user.id]["positions"] = [
                        p for p in cache_positions if p.get("id") != pos_id
                    ]
                print(f"[MetaAPI Close] ⚠️ 이미 청산됨: {symbol}")
                return JSONResponse({
                    "success": True,
                    "message": "이미 청산됨",
                    "positionId": pos_id,
                    "force_sync": True,
                    "metaapi_mode": True
                })
            return JSONResponse({
                "success": False,
                "message": f"청산 실패: {result.get('error')}"
            })

    except Exception as e:
        print(f"[MetaAPI Close] ❌ 예외 발생: {e}")
        return JSONResponse({
            "success": False,
            "message": f"청산 오류: {str(e)}"
        })

    # ========== 기존 Bridge/MT5 코드 (주석 처리) ==========
    # if not MT5_AVAILABLE:
    #     bridge_age = time_module.time() - get_bridge_heartbeat()
    #     if bridge_age > 30:
    #         return JSONResponse({"success": False, "message": "MT5 브릿지 연결 없음"})
    #     ... (기존 브릿지 코드)
    # if not mt5_initialize_safe():
    #     return JSONResponse({"success": False, "message": "MT5 초기화 실패"})
    # ... (기존 MT5 직접 연결 코드)

# ========== 포지션 목록 조회 ==========
@router.get("/positions")
async def get_positions(
    magic: int = None,
    current_user: User = Depends(get_current_user)
):
    """모든 열린 포지션 조회 (magic 필터 옵션)"""
    # ★★★ MetaAPI에서 포지션 정보 가져오기 ★★★
    from .metaapi_service import get_metaapi_positions, get_metaapi_account, is_metaapi_connected

    metaapi_positions = get_metaapi_positions()
    metaapi_account = get_metaapi_account()
    metaapi_connected = is_metaapi_connected()

    if not mt5_initialize_safe():
        # ★★★ MetaAPI 포지션 우선 사용 ★★★
        if metaapi_connected and metaapi_positions is not None:
            position_list = []
            total_margin = 0
            leverage = metaapi_account.get("leverage", 500) if metaapi_account else 500

            for pos in metaapi_positions:
                if magic is not None and pos.get("magic") != magic:
                    continue

                # type 필드 변환 (POSITION_TYPE_BUY/SELL → BUY/SELL)
                pos_type = pos.get("type", "")
                if isinstance(pos_type, int):
                    pos_type = "BUY" if pos_type == 0 else "SELL"
                elif isinstance(pos_type, str):
                    if "BUY" in pos_type.upper():
                        pos_type = "BUY"
                    elif "SELL" in pos_type.upper():
                        pos_type = "SELL"

                pos_margin = pos.get("margin", 0) or 0
                total_margin += pos_margin

                position_list.append({
                    "ticket": pos.get("id", 0),
                    "symbol": pos.get("symbol", ""),
                    "type": pos_type,
                    "volume": pos.get("volume", 0),
                    "entry": pos.get("openPrice", 0),
                    "current": pos.get("currentPrice", 0),
                    "profit": pos.get("profit", 0),
                    "sl": pos.get("stopLoss", 0),
                    "tp": pos.get("takeProfit", 0),
                    "magic": pos.get("magic", 0),
                    "comment": pos.get("comment", ""),
                    "margin": round(pos_margin, 2)
                })

            return {
                "success": True,
                "positions": position_list,
                "count": len(position_list),
                "total_margin": round(total_margin, 2),
                "leverage": leverage,
                "source": "metaapi"
            }

        # ★★★ Bridge 캐시 fallback ★★★
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
    symbol: str = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """모든 포지션 청산 (magic/symbol 필터 옵션) - MetaAPI 버전"""
    from .metaapi_service import metaapi_service, close_position_for_user, get_user_positions

    # ★★★ 유저별 MetaAPI 판단 ★★★
    _use_user_metaapi = bool(current_user.metaapi_account_id and current_user.metaapi_status == 'deployed')
    _user_mid = current_user.metaapi_account_id if _use_user_metaapi else None

    print(f"[MetaAPI CloseAll] 전체 청산 요청: magic={magic}, symbol={symbol}, user_metaapi={_use_user_metaapi}")

    # ★★★ MetaAPI를 통한 전체 청산 ★★★
    try:
        # 모든 포지션 조회
        if _use_user_metaapi:
            positions = await get_user_positions(current_user.id, _user_mid)
        else:
            positions = await metaapi_service.get_positions()
        if not positions:
            return JSONResponse({"success": False, "message": "열린 포지션 없음"})

        # 필터링 (magic, symbol)
        target_positions = []
        for pos in positions:
            if symbol and pos.get('symbol') != symbol:
                continue
            if magic is not None and pos.get('magic') != magic:
                continue
            target_positions.append(pos)

        if not target_positions:
            return JSONResponse({"success": False, "message": "청산할 포지션 없음"})

        closed_count = 0
        total_profit = 0
        errors = []

        for pos in target_positions:
            pos_id = pos.get('id')
            if _use_user_metaapi:
                result = await close_position_for_user(current_user.id, _user_mid, pos_id)
            else:
                result = await metaapi_service.close_position(pos_id)

            if result.get('success'):
                closed_count += 1
                total_profit += pos.get('profit', 0)
            else:
                errors.append(f"{pos_id}: {result.get('error')}")

        # user_live_cache 초기화
        if current_user.id in user_live_cache:
            if symbol or magic is not None:
                # 필터링된 포지션만 제거
                closed_ids = [p.get('id') for p in target_positions]
                cache_positions = user_live_cache[current_user.id].get("positions", [])
                user_live_cache[current_user.id]["positions"] = [
                    p for p in cache_positions if p.get("id") not in closed_ids
                ]
            else:
                # 전체 청산
                user_live_cache[current_user.id]["positions"] = []

        # ★★★ user_metaapi_cache도 동일하게 초기화 (중복 주문 방지용) ★★★
        from .metaapi_service import user_metaapi_cache
        if current_user.id in user_metaapi_cache:
            if symbol or magic is not None:
                closed_ids = [p.get('id') for p in target_positions]
                cache_positions = user_metaapi_cache[current_user.id].get("positions", [])
                user_metaapi_cache[current_user.id]["positions"] = [
                    p for p in cache_positions if p.get("id") not in closed_ids
                ]
                print(f"[MetaAPI CloseAll] 🧹 user_metaapi_cache 포지션 {len(closed_ids)}개 제거")
            else:
                user_metaapi_cache[current_user.id]["positions"] = []
                print(f"[MetaAPI CloseAll] 🧹 user_metaapi_cache 전체 초기화")

        if closed_count > 0:
            if _use_user_metaapi:
                current_user.metaapi_last_active = datetime.utcnow()
                db.commit()
            print(f"[MetaAPI CloseAll] ✅ {closed_count}개 청산 완료, 총 P/L=${total_profit:.2f}")
            return JSONResponse({
                "success": True,
                "message": f"{closed_count}개 청산 완료! 총 P/L: ${total_profit:,.2f}",
                "closed_count": closed_count,
                "total_profit": total_profit,
                "errors": errors if errors else None,
                "metaapi_mode": True
            })
        else:
            return JSONResponse({
                "success": False,
                "message": "청산 실패",
                "errors": errors
            })

    except Exception as e:
        print(f"[MetaAPI CloseAll] ❌ 예외 발생: {e}")
        return JSONResponse({
            "success": False,
            "message": f"청산 오류: {str(e)}"
        })

    # ========== 기존 MT5 코드 (주석 처리) ==========
    # if not mt5_initialize_safe():
    #     return JSONResponse({"success": False, "message": "MT5 초기화 실패"})
    # positions = mt5.positions_get()
    # ... (기존 MT5 직접 연결 코드)


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

# ========== 최신 거래 1건 (magic 필터) ==========
@router.get("/last-trade")
async def get_last_trade(
    magic: int = Query(0, description="Magic number 필터"),
    exclude_id: str = Query("", description="제외할 trade ID (이전 trade 필터)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """매직넘버로 필터한 최신 거래 1건 조회 (마틴 정확한 손익용)"""
    user_id = current_user.id

    from .metaapi_service import get_user_history

    if not current_user.metaapi_account_id or current_user.metaapi_status != 'deployed':
        return {"success": False, "message": "MetaAPI not connected"}

    try:
        from datetime import datetime, timedelta
        start_time = datetime.now() - timedelta(minutes=5)  # 최근 5분만 조회
        history = await get_user_history(
            user_id=user_id,
            metaapi_account_id=current_user.metaapi_account_id,
            start_time=start_time
        )

        if not history:
            return {"success": False, "message": "No trades found"}

        # magic number로 필터 + DEAL_ENTRY_OUT만 (청산 건)
        if magic > 0:
            filtered = [h for h in history if h.get('magic') == magic and h.get('entryType') != 'DEAL_ENTRY_IN']
        else:
            filtered = [h for h in history if h.get('entryType') != 'DEAL_ENTRY_IN']

        if not filtered:
            return {"success": False, "message": "No matching trade"}

        # exclude_id가 있으면 해당 trade 제외
        if exclude_id:
            filtered = [h for h in filtered if str(h.get('id', '')) != exclude_id]
            if not filtered:
                return {"success": False, "message": "No new trade yet"}

        # 최신 1건
        last = filtered[0]

        return {
            "success": True,
            "trade": {
                "profit": last.get('profit', 0),
                "symbol": last.get('symbol', ''),
                "volume": last.get('volume', 0),
                "time": str(last.get('time', '')),
                "magic": last.get('magic', 0),
                "id": last.get('id', '')
            }
        }
    except Exception as e:
        print(f"[last-trade] Error: {e}")
        return {"success": False, "message": str(e)}


# ========== 거래 내역 ==========
@router.get("/history")
async def get_history(
    period: str = Query("week", description="조회 기간: today, week, month, all"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """거래 내역 조회 - MetaAPI, user_live_cache 또는 MT5 직접 연결"""
    user_id = current_user.id

    # ★★★ period에 따른 조회 기간 설정 ★★★
    now = datetime.now()
    if period == "today":
        start_time = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        start_time = now - timedelta(days=7)
    elif period == "month":
        start_time = now - timedelta(days=30)
    else:  # all
        start_time = now - timedelta(days=90)

    # ★★★ 0순위: 유저별 MetaAPI 히스토리 조회 ★★★
    from .metaapi_service import metaapi_service, is_metaapi_connected, get_user_history

    _use_user_metaapi = bool(current_user.metaapi_account_id and current_user.metaapi_status == 'deployed')

    if _use_user_metaapi:
        try:
            metaapi_history = await get_user_history(
                user_id=user_id,
                metaapi_account_id=current_user.metaapi_account_id,
                start_time=start_time
            )
            if metaapi_history:
                # 포맷 맞추기 (기존 MetaAPI 히스토리와 동일 로직)
                formatted_history = []
                kst = pytz.timezone('Asia/Seoul')
                for h in metaapi_history:
                    entry_type = h.get("entryType", "")
                    if entry_type == "DEAL_ENTRY_IN":
                        continue

                    trade_time = h.get("time", "")
                    try:
                        if isinstance(trade_time, datetime):
                            dt = trade_time
                            if dt.tzinfo is None:
                                dt = pytz.utc.localize(dt)
                            dt_kst = dt.astimezone(kst)
                            trade_time = dt_kst.strftime("%m/%d %H:%M")
                        elif isinstance(trade_time, str) and trade_time:
                            dt = dateutil_parser.isoparse(trade_time)
                            if dt.tzinfo is None:
                                dt = pytz.utc.localize(dt)
                            dt_kst = dt.astimezone(kst)
                            trade_time = dt_kst.strftime("%m/%d %H:%M")
                        elif isinstance(trade_time, (int, float)):
                            dt = datetime.fromtimestamp(trade_time, tz=pytz.utc)
                            dt_kst = dt.astimezone(kst)
                            trade_time = dt_kst.strftime("%m/%d %H:%M")
                    except Exception as parse_err:
                        print(f"[MT5 History] 시간 변환 실패: {trade_time} - {parse_err}")

                    formatted_history.append({
                        "ticket": h.get("ticket", h.get("id", 0)),
                        "time": trade_time,
                        "symbol": h.get("symbol", ""),
                        "type": h.get("type", ""),
                        "volume": h.get("volume", 0),
                        "price": h.get("price", 0),
                        "profit": h.get("profit", 0),
                        "entry": h.get("entry", h.get("price", 0)),
                        "exit": h.get("exit", h.get("price", 0))
                    })
                print(f"[MT5 History] User {user_id}: {len(formatted_history)}개 (from User MetaAPI)")
                return {"history": formatted_history, "source": "user_metaapi"}
        except Exception as e:
            print(f"[MT5 History] User MetaAPI 조회 실패: {e}")

    # ★★★ 1순위: 공유 MetaAPI에서 히스토리 조회 (유저별 MetaAPI 없는 경우) ★★★
    if not _use_user_metaapi and is_metaapi_connected():
        try:
            metaapi_history = await metaapi_service.get_history(start_time=start_time)
            if metaapi_history:
                # 포맷 맞추기
                formatted_history = []
                kst = pytz.timezone('Asia/Seoul')
                for h in metaapi_history:
                    # ★★★ entryType IN 필터 (청산 거래만) ★★★
                    entry_type = h.get("entryType", "")
                    if entry_type == "DEAL_ENTRY_IN":
                        continue  # 진입 거래는 스킵, 청산 거래만 표시

                    # ★★★ 시간 변환 + KST 변환 ★★★
                    trade_time = h.get("time", "")
                    try:
                        if isinstance(trade_time, datetime):
                            # datetime 객체인 경우
                            dt = trade_time
                            if dt.tzinfo is None:
                                dt = pytz.utc.localize(dt)
                            dt_kst = dt.astimezone(kst)
                            trade_time = dt_kst.strftime("%m/%d %H:%M")
                        elif isinstance(trade_time, str) and trade_time:
                            # ISO 문자열인 경우
                            dt = dateutil_parser.isoparse(trade_time)
                            if dt.tzinfo is None:
                                dt = pytz.utc.localize(dt)
                            dt_kst = dt.astimezone(kst)
                            trade_time = dt_kst.strftime("%m/%d %H:%M")
                        elif isinstance(trade_time, (int, float)):
                            # Unix timestamp인 경우
                            dt = datetime.fromtimestamp(trade_time, tz=pytz.utc)
                            dt_kst = dt.astimezone(kst)
                            trade_time = dt_kst.strftime("%m/%d %H:%M")
                    except Exception as parse_err:
                        print(f"[MT5 History] 시간 변환 실패: {trade_time} - {parse_err}")

                    formatted_history.append({
                        "ticket": h.get("ticket", 0),
                        "time": trade_time,
                        "symbol": h.get("symbol", ""),
                        "type": h.get("type", ""),
                        "volume": h.get("volume", 0),
                        "price": h.get("price", 0),
                        "profit": h.get("profit", 0),
                        "entry": h.get("entry", h.get("price", 0)),
                        "exit": h.get("exit", h.get("price", 0))
                    })
                print(f"[MT5 History] User {user_id}: {len(formatted_history)}개 (from MetaAPI)")
                return {"history": formatted_history, "source": "metaapi"}
        except Exception as e:
            print(f"[MT5 History] MetaAPI 조회 실패: {e}")

    # ★★★ 2순위: user_live_cache에서 히스토리 확인 ★★★
    user_cache = user_live_cache.get(user_id)
    if user_cache and user_cache.get("history"):
        cached_history = user_cache.get("history", [])
        # 캐시된 히스토리가 있으면 반환 (포맷 맞추기)
        formatted_history = []
        for h in cached_history:
            trade_time = h.get("time", "")
            if isinstance(trade_time, (int, float)):
                trade_time = datetime.fromtimestamp(trade_time).strftime("%m/%d %H:%M")
            formatted_history.append({
                "ticket": h.get("ticket", 0),
                "time": trade_time,
                "symbol": h.get("symbol", ""),
                "type": "BUY" if h.get("type") == 0 else "SELL",
                "volume": h.get("volume", 0),
                "price": h.get("price", 0),
                "profit": h.get("profit", 0),
                "entry": h.get("price", 0),
                "exit": h.get("price", 0)
            })
        print(f"[MT5 History] User {user_id}: {len(formatted_history)}개 (from cache)")
        print(f"[MT5 History] Data: {formatted_history}")
        return {"history": formatted_history}

    # ★★★ 3순위: MT5 직접 연결 시도 ★★★
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


# ========== 라이브 마틴게일 API (DB 기반) ==========
def get_or_create_live_martin_state(db: Session, user_id: int, magic: int) -> LiveMartinState:
    """magic별 라이브 마틴 상태 조회 또는 생성"""
    state = db.query(LiveMartinState).filter_by(user_id=user_id, magic=magic).first()
    if not state:
        state = LiveMartinState(user_id=user_id, magic=magic)
        db.add(state)
        db.commit()
        db.refresh(state)
    return state


@router.get("/martin/state")
async def get_live_martin_state(
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """라이브 마틴 상태 조회 (magic별 독립 관리)"""
    state = get_or_create_live_martin_state(db, current_user.id, magic)

    current_lot = state.base_lot * (2 ** (state.step - 1))
    current_lot = round(current_lot, 2)

    return {
        "enabled": state.enabled,
        "step": state.step,
        "max_steps": state.max_steps,
        "base_lot": state.base_lot,
        "base_target": state.base_target,
        "current_lot": current_lot,
        "accumulated_loss": state.accumulated_loss,
        "magic": magic
    }


@router.post("/martin/enable")
async def enable_live_martin(
    magic: int = 100001,
    base_lot: float = 0.01,
    max_steps: int = 7,
    base_target: float = 50.0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """라이브 마틴 모드 활성화 (magic별 독립 관리)"""
    state = get_or_create_live_martin_state(db, current_user.id, magic)
    state.enabled = True
    state.step = 1
    state.max_steps = max_steps
    state.base_lot = base_lot
    state.base_target = base_target
    state.accumulated_loss = 0.0
    db.commit()

    print(f"[LIVE MARTIN] User {current_user.id} 활성화: magic={magic}, base_lot={base_lot}, max_steps={max_steps}, target=${base_target}")

    return JSONResponse({
        "success": True,
        "message": f"마틴 모드 활성화! 기본 랏: {base_lot}, 최대 단계: {max_steps}",
        "state": {
            "step": 1,
            "max_steps": max_steps,
            "base_lot": base_lot,
            "base_target": base_target,
            "current_lot": base_lot,
            "accumulated_loss": 0.0,
            "magic": magic
        }
    })


@router.post("/martin/disable")
async def disable_live_martin(
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """라이브 마틴 모드 비활성화 (magic별 독립 관리)"""
    state = get_or_create_live_martin_state(db, current_user.id, magic)
    state.enabled = False
    state.step = 1
    state.accumulated_loss = 0.0
    db.commit()

    print(f"[LIVE MARTIN] User {current_user.id} 비활성화: magic={magic}")

    return JSONResponse({
        "success": True,
        "message": "마틴 모드 비활성화 및 리셋 완료",
        "magic": magic
    })


@router.post("/martin/update")
async def update_live_martin_after_close(
    profit: float = 0,
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """청산 후 라이브 마틴 상태 업데이트 (magic별 독립 관리)"""
    state = get_or_create_live_martin_state(db, current_user.id, magic)

    if profit >= 0:
        # 이익: 마틴 리셋!
        state.step = 1
        state.accumulated_loss = 0.0
        db.commit()

        print(f"[LIVE MARTIN] User {current_user.id} WIN! +${profit:.2f} → Step 1 리셋")

        return JSONResponse({
            "success": True,
            "message": f"마틴 성공! +${profit:,.2f} → Step 1 리셋",
            "new_step": 1,
            "accumulated_loss": 0.0,
            "reset": True,
            "magic": magic
        })
    else:
        # 손실: 다음 단계로
        new_accumulated = state.accumulated_loss + abs(profit)
        new_step = state.step + 1

        if new_step > state.max_steps:
            # 최대 단계 초과: 강제 리셋
            state.step = 1
            state.accumulated_loss = 0.0
            db.commit()

            print(f"[LIVE MARTIN] User {current_user.id} MAX STEP! 총손실=${new_accumulated:.2f} → 강제 리셋")

            return JSONResponse({
                "success": False,
                "message": f"마틴 실패! 최대 단계 도달 → 강제 리셋",
                "new_step": 1,
                "accumulated_loss": 0.0,
                "reset": True,
                "total_loss": new_accumulated,
                "magic": magic
            })
        else:
            state.step = new_step
            state.accumulated_loss = new_accumulated
            db.commit()

            next_lot = state.base_lot * (2 ** (new_step - 1))

            print(f"[LIVE MARTIN] User {current_user.id} LOSS! -${abs(profit):.2f} → Step {new_step}, NextLot {next_lot:.2f}")

            return JSONResponse({
                "success": True,
                "message": f"Step {new_step}로 진행! 다음 랏: {next_lot:.2f}",
                "new_step": new_step,
                "accumulated_loss": new_accumulated,
                "next_lot": round(next_lot, 2),
                "reset": False,
                "magic": magic
            })


@router.post("/martin/update-state")
async def update_live_martin_state(
    step: int = 1,
    accumulated_loss: float = 0,
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """라이브 마틴 단계와 누적손실 업데이트 (magic별 독립 관리)"""
    state = get_or_create_live_martin_state(db, current_user.id, magic)
    state.step = step
    state.accumulated_loss = accumulated_loss
    db.commit()

    current_lot = state.base_lot * (2 ** (step - 1))

    return JSONResponse({
        "success": True,
        "message": f"마틴 상태 업데이트: Step {step}, 누적손실 ${accumulated_loss:,.2f}",
        "step": step,
        "accumulated_loss": accumulated_loss,
        "current_lot": round(current_lot, 2),
        "magic": magic
    })


@router.post("/martin/reset-full")
async def reset_live_martin_full(
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """라이브 마틴 완전 초기화 (magic별 독립 관리)"""
    state = get_or_create_live_martin_state(db, current_user.id, magic)
    state.step = 1
    state.accumulated_loss = 0.0
    db.commit()

    print(f"[LIVE MARTIN] User {current_user.id} 완전 리셋: magic={magic}")

    return JSONResponse({
        "success": True,
        "message": "마틴 초기화 완료",
        "step": 1,
        "accumulated_loss": 0,
        "magic": magic
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


# ========== MetaAPI 백그라운드 프로비저닝 ==========
async def _provision_metaapi_background(user_id: int, login: str, password: str, server: str):
    """백그라운드에서 MetaAPI 유저 계정 Deploy + 검증 + 잔고 조회"""
    from .metaapi_service import provision_user_metaapi, deploy_user_metaapi, get_user_account_info
    import time as time_module

    print(f"[MetaAPI BG] 🔵 User {user_id} 백그라운드 프로비저닝 시작")
    start_time = time_module.time()

    def _save_error(error_msg: str):
        """에러 상태 저장 (DB + 메시지 캐시)"""
        metaapi_error_messages[user_id] = error_msg
        try:
            _db = next(get_db())
            _user = _db.query(User).filter(User.id == user_id).first()
            if _user:
                _user.metaapi_status = 'error'
                _db.commit()
            _db.close()
        except:
            pass

    try:
        db = next(get_db())
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            print(f"[MetaAPI BG] ❌ User {user_id} 찾을 수 없음")
            return

        # ★★★ MetaAPI 계정 ID 확인 (이미 등록 or 신규) ★★★
        account_id = user.metaapi_account_id

        if not account_id:
            # 신규 등록 필요
            print(f"[MetaAPI BG] User {user_id} 신규 MetaAPI 계정 등록...")
            provision_result = await provision_user_metaapi(
                user_id=user_id, login=login, password=password, server=server
            )
            if not provision_result.get("success"):
                error_msg = provision_result.get("error", "계정 등록 실패")
                print(f"[MetaAPI BG] ❌ User {user_id} 프로비저닝 실패: {error_msg}")
                db.close()
                _save_error(error_msg)
                return

            account_id = provision_result["account_id"]
            user.metaapi_account_id = account_id
            user.metaapi_status = 'deploying'
            db.commit()
            print(f"[MetaAPI BG] User {user_id} 계정 등록 완료: {account_id[:8]}...")

        # ★★★ Deploy (활성화 + MT5 브로커 연결 = 계정 검증) ★★★
        print(f"[MetaAPI BG] User {user_id} Deploy 시작: {account_id[:8]}...")
        deploy_result = await deploy_user_metaapi(account_id)

        if not deploy_result.get("success"):
            error_msg = deploy_result.get("error", "연결 실패")
            # ★ 비밀번호/계정 오류 판별
            error_lower = error_msg.lower()
            if 'auth' in error_lower or 'password' in error_lower or 'credential' in error_lower or 'login' in error_lower:
                user_msg = "계좌번호 또는 비밀번호가 올바르지 않습니다."
            elif 'server' in error_lower or 'connect' in error_lower:
                user_msg = "MT5 서버에 연결할 수 없습니다. 서버명을 확인해주세요."
            else:
                user_msg = f"연결 실패: {error_msg}"

            print(f"[MetaAPI BG] ❌ User {user_id} Deploy 실패: {error_msg}")
            user.metaapi_status = 'error'
            db.commit()
            db.close()
            metaapi_error_messages[user_id] = user_msg
            return

        # ★★★ Deploy 성공 → 계정 검증 완료! 잔고 조회 ★★★
        user.metaapi_status = 'deployed'
        user.metaapi_deployed_at = datetime.utcnow()
        elapsed = time_module.time() - start_time
        print(f"[MetaAPI BG] ✅ User {user_id} Deploy 완료 ({elapsed:.1f}초)")

        # ★★★ 잔고 정보 가져오기 (deploy 직후) ★★★
        try:
            account_info = await get_user_account_info(user_id, account_id)
            if account_info:
                user.mt5_balance = account_info.get("balance", 0)
                user.mt5_equity = account_info.get("equity", account_info.get("balance", 0))
                user.mt5_margin = account_info.get("margin", 0)
                user.mt5_free_margin = account_info.get("freeMargin", account_info.get("balance", 0))
                user.mt5_profit = account_info.get("profit", 0)
                user.mt5_leverage = account_info.get("leverage", 500)
                user.mt5_currency = account_info.get("currency", "USD")
                print(f"[MetaAPI BG] 💰 User {user_id} 잔고: ${account_info.get('balance', 0)}, Equity: ${account_info.get('equity', 0)}")
        except Exception as info_err:
            print(f"[MetaAPI BG] ⚠️ User {user_id} 잔고 조회 실패 (무시): {info_err}")

        db.commit()
        db.close()

        # 에러 메시지 정리
        metaapi_error_messages.pop(user_id, None)

    except Exception as e:
        print(f"[MetaAPI BG] ❌ User {user_id} 백그라운드 오류: {e}")
        _save_error(str(e))


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
    """MT5 계정 연결 - MetaAPI 직접 프로비저닝으로 검증 + 연결"""
    import time as time_module
    from .metaapi_service import provision_user_metaapi

    print(f"[CONNECT] 🔵 User {current_user.id} 연결 시도: {request.account}@{request.server}")

    if not request.account or not request.password:
        return JSONResponse({"success": False, "message": "계좌번호와 비밀번호를 입력하세요"})

    # ★★★ 같은 MT5 계좌를 다른 유저가 이미 등록했는지 체크 ★★★
    existing_user = db.query(User).filter(
        User.mt5_account_number == request.account,
        User.has_mt5_account == True,
        User.id != current_user.id
    ).first()
    if existing_user:
        print(f"[CONNECT] ⛔ User {current_user.id} 차단 - 계좌 {request.account}는 User {existing_user.id}가 이미 사용 중")
        return JSONResponse({"success": False, "message": "이 계좌는 다른 사용자가 이미 연결하고 있습니다"})

    # ★★★ 이전 에러 메시지 초기화 ★★★
    metaapi_error_messages.pop(current_user.id, None)

    # ★★★ 이미 MetaAPI 계정이 있는 경우: 같은 계정이면 deploy만, 다른 계정이면 새로 프로비저닝 ★★★
    _existing_account_id = current_user.metaapi_account_id
    _same_account = (current_user.mt5_account_number == request.account and _existing_account_id)

    if _same_account:
        print(f"[CONNECT] 🔄 User {current_user.id} 기존 계정 재연결: {_existing_account_id[:8]}...")
        # DB 업데이트 (비밀번호 변경 대응)
        current_user.has_mt5_account = True
        current_user.mt5_server = request.server
        current_user.mt5_password_encrypted = encrypt(request.password)
        current_user.mt5_connected_at = datetime.utcnow()
        current_user.metaapi_status = 'deploying'
        current_user.metaapi_last_active = datetime.utcnow()
        db.commit()

        # 백그라운드에서 deploy
        asyncio.create_task(_provision_metaapi_background(
            user_id=current_user.id,
            login=request.account,
            password=request.password,
            server=request.server
        ))

        return JSONResponse({
            "success": True,
            "message": "MT5 계정 연결 중...",
            "account": request.account,
            "server": request.server,
            "account_info": {
                "balance": current_user.mt5_balance or 0,
                "equity": current_user.mt5_equity or 0,
                "leverage": current_user.mt5_leverage or 500,
            },
            "metaapi_status": "deploying"
        })

    # ★★★ 신규 계정: MetaAPI create_account로 등록 ★★★
    try:
        print(f"[CONNECT] 📝 MetaAPI 계정 등록 시작: {request.account}@{request.server}")
        provision_result = await provision_user_metaapi(
            user_id=current_user.id,
            login=request.account,
            password=request.password,
            server=request.server
        )

        if not provision_result.get("success"):
            error_msg = provision_result.get("error", "MetaAPI 계정 등록 실패")
            print(f"[CONNECT] ❌ MetaAPI 계정 등록 실패: {error_msg}")
            return JSONResponse({
                "success": False,
                "message": f"계정 등록 실패: {error_msg}"
            })

        account_id = provision_result["account_id"]
        print(f"[CONNECT] ✅ MetaAPI 계정 등록 완료: {account_id[:8]}...")

        # DB 저장
        current_user.has_mt5_account = True
        current_user.mt5_account_number = request.account
        current_user.mt5_server = request.server
        current_user.mt5_password_encrypted = encrypt(request.password)
        current_user.mt5_connected_at = datetime.utcnow()
        current_user.metaapi_account_id = account_id
        current_user.metaapi_status = 'deploying'
        current_user.metaapi_last_active = datetime.utcnow()
        db.commit()

        print(f"[CONNECT] 🎉 DB 저장 완료: {request.account}, MetaAPI: {account_id[:8]}...")

        # 백그라운드에서 deploy + 계정 검증 + 잔고 조회
        asyncio.create_task(_provision_metaapi_background(
            user_id=current_user.id,
            login=request.account,
            password=request.password,
            server=request.server
        ))

        return JSONResponse({
            "success": True,
            "message": "MT5 계정 연결 중...",
            "account": request.account,
            "server": request.server,
            "account_info": {},
            "metaapi_status": "deploying"
        })

    except Exception as e:
        print(f"[CONNECT] ❌ 오류: {e}")
        return JSONResponse({
            "success": False,
            "message": f"연결 오류: {str(e)}"
        })


@router.post("/disconnect")
async def disconnect_mt5_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """MT5 계정 연결 해제 - MetaAPI undeploy + 모든 정보 삭제"""
    from .metaapi_service import undeploy_user_metaapi, user_trade_connections

    # ★★★ MetaAPI undeploy (백그라운드) ★★★
    if current_user.metaapi_account_id:
        print(f"[DISCONNECT] User {current_user.id} MetaAPI undeploy 시작: {current_user.metaapi_account_id[:8]}...")
        try:
            await undeploy_user_metaapi(current_user.metaapi_account_id)
        except Exception as e:
            print(f"[DISCONNECT] MetaAPI undeploy 오류: {e}")

        # 연결 풀 정리
        if current_user.id in user_trade_connections:
            try:
                conn = user_trade_connections[current_user.id].get("rpc")
                if conn:
                    await conn.close()
            except:
                pass
            del user_trade_connections[current_user.id]

    # MT5 정보 초기화
    current_user.has_mt5_account = False
    current_user.mt5_account_number = None
    current_user.mt5_server = None
    current_user.mt5_password_encrypted = None
    current_user.mt5_connected_at = None

    # MetaAPI 정보 초기화 (account_id는 유지 - 재연결 시 재사용 가능)
    current_user.metaapi_status = 'undeployed'
    current_user.metaapi_deployed_at = None

    db.commit()

    return JSONResponse({
        "success": True,
        "message": "MT5 계정 연결이 해제되었습니다"
    })


@router.get("/metaapi-status")
async def get_metaapi_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """유저의 MetaAPI 프로비저닝 상태 조회"""
    # ★ 에러 메시지 포함 (있으면)
    error_msg = metaapi_error_messages.get(current_user.id)

    # ★★★ undeployed 상태면 자동 deploy 시도 (쿨다운 60초) ★★★
    _status = current_user.metaapi_status
    _account_id = current_user.metaapi_account_id
    if _account_id and _status in ('undeployed', 'error', None):
        import time as _time
        _now = _time.time()
        _last_attempt = _auto_deploy_cooldown.get(current_user.id, 0)
        if _now - _last_attempt >= AUTO_DEPLOY_COOLDOWN_SEC:
            _mt5_pw = decrypt(current_user.mt5_password_encrypted) if current_user.mt5_password_encrypted else ""
            if _mt5_pw and current_user.mt5_account_number:
                _auto_deploy_cooldown[current_user.id] = _now
                print(f"[MetaAPI Status] 🔄 User {current_user.id} 자동 deploy 시작 (status={_status})")
                asyncio.create_task(_provision_metaapi_background(
                    user_id=current_user.id,
                    login=current_user.mt5_account_number,
                    password=_mt5_pw,
                    server=current_user.mt5_server or "HedgeHood-MT5"
                ))
        else:
            print(f"[MetaAPI Status] ⏳ User {current_user.id} deploy 쿨다운 중 ({int(AUTO_DEPLOY_COOLDOWN_SEC - (_now - _last_attempt))}초 남음)")

    return JSONResponse({
        "success": True,
        "metaapi_status": current_user.metaapi_status or 'none',
        "metaapi_account_id": current_user.metaapi_account_id[:8] + '...' if current_user.metaapi_account_id else None,
        "has_mt5_account": current_user.has_mt5_account,
        "mt5_account": current_user.mt5_account_number,
        "deployed_at": current_user.metaapi_deployed_at.isoformat() if current_user.metaapi_deployed_at else None,
        "last_active": current_user.metaapi_last_active.isoformat() if current_user.metaapi_last_active else None,
        "error_message": error_msg
    })


@router.get("/admin/users")
async def admin_get_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """[어드민] 전체 유저 MetaAPI 계정 상태 조회"""
    if not current_user.is_admin:
        return JSONResponse({"success": False, "message": "관리자 권한이 필요합니다"}, status_code=403)

    users = db.query(User).filter(User.has_mt5_account == True).all()

    user_list = []
    for u in users:
        user_list.append({
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "mt5_account": u.mt5_account_number,
            "mt5_server": u.mt5_server,
            "mt5_balance": u.mt5_balance,
            "mt5_equity": u.mt5_equity,
            "metaapi_status": u.metaapi_status or 'none',
            "metaapi_account_id": u.metaapi_account_id[:8] + '...' if u.metaapi_account_id else None,
            "deployed_at": u.metaapi_deployed_at.isoformat() if u.metaapi_deployed_at else None,
            "last_active": u.metaapi_last_active.isoformat() if u.metaapi_last_active else None,
            "connected_at": u.mt5_connected_at.isoformat() if u.mt5_connected_at else None
        })

    return JSONResponse({
        "success": True,
        "total": len(user_list),
        "users": user_list
    })

# ========== WebSocket 실시간 데이터 ==========
@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """실시간 데이터 WebSocket (Live 모드) - MetaAPI 버전"""
    await websocket.accept()

    # ★★★ MetaAPI 실시간 데이터 import ★★★
    from .metaapi_service import (
        get_metaapi_prices, get_metaapi_candles, is_metaapi_connected,
        get_metaapi_last_update, get_metaapi_indicators, get_realtime_data,
        quote_price_cache, quote_last_update,
        get_metaapi_positions, get_metaapi_account, pop_metaapi_closed_events,
        get_user_account_info, get_user_positions, user_metaapi_cache,
        user_trade_connections  # ★ Streaming 연결 체크용
    )

    # ★ Query parameter에서 토큰/magic으로 유저 식별
    token = websocket.query_params.get("token")
    magic = int(websocket.query_params.get("magic", 100001))
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

                    # ★★★ 유저별 MetaAPI 정보 ★★★
                    _ws_user_metaapi_id = user.metaapi_account_id
                    _ws_user_metaapi_status = user.metaapi_status
                    _ws_use_user_metaapi = bool(_ws_user_metaapi_id and _ws_user_metaapi_status == 'deployed')
                    if _ws_use_user_metaapi:
                        print(f"[LIVE WS] User {user_id} connected (MT5: {user_mt5_account}, Balance: ${user_mt5_balance}, MetaAPI: ✅ {_ws_user_metaapi_id[:8]}...)")
                    else:
                        print(f"[LIVE WS] User {user_id} connected (MT5: {user_mt5_account}, Balance: ${user_mt5_balance}, MetaAPI: ❌ {_ws_user_metaapi_status})")
                        # ★★★ undeployed/error 상태면 자동 deploy 시도 (쿨다운 60초) ★★★
                        if _ws_user_metaapi_id and _ws_user_metaapi_status in ('undeployed', 'error', None):
                            import time as _time
                            _now = _time.time()
                            _last_attempt = _auto_deploy_cooldown.get(user_id, 0)
                            if _now - _last_attempt >= AUTO_DEPLOY_COOLDOWN_SEC:
                                _auto_deploy_cooldown[user_id] = _now
                                print(f"[LIVE WS] 🔄 User {user_id} MetaAPI 자동 deploy 시작...")
                                _mt5_pw = decrypt(user.mt5_password_encrypted) if user.mt5_password_encrypted else ""
                                if _mt5_pw:
                                    asyncio.create_task(_provision_metaapi_background(
                                        user_id=user_id,
                                        login=user.mt5_account_number,
                                        password=_mt5_pw,
                                        server=user.mt5_server or "HedgeHood-MT5"
                                    ))
                            else:
                                print(f"[LIVE WS] ⏳ User {user_id} deploy 쿨다운 중 ({int(AUTO_DEPLOY_COOLDOWN_SEC - (_now - _last_attempt))}초 남음)")
                else:
                    print(f"[LIVE WS] User {user_id} connected (No MT5 account)")
                db.close()
        except Exception as e:
            print(f"[LIVE WS] Token decode error: {e}")
    else:
        print(f"[LIVE WS] Anonymous connection (no token)")

    # ★★★ 유저별 MetaAPI 변수 초기화 ★★★
    if '_ws_use_user_metaapi' not in locals():
        _ws_use_user_metaapi = False
        _ws_user_metaapi_id = None
        _ws_user_metaapi_status = None
    last_user_metaapi_sync = 0  # 유저 MetaAPI 동기화 타이머
    _prev_user_position = None  # ★ 이전 유저 포지션 (청산 감지용)
    _position_disappeared_count = 0  # ★ 포지션 사라짐 연속 카운트 (오탐 방지)
    _user_has_position = False  # ★ 유저 포지션 보유 여부 (동기화 주기 결정)
    _user_sync_soon_at = []  # ★ 주문 직후 빠른 동기화 예약 시간 리스트
    _last_sent_position = None  # ★ 포지션 홀드: 마지막 전송 포지션
    _last_position_time = 0  # ★ 포지션 홀드: 마지막 포지션 있었던 시간
    POSITION_HOLD_SEC = 3  # ★ 포지션 홀드: null 유예 시간 (초)

    symbols_list = ["BTCUSD", "EURUSD.r", "USDJPY.r", "XAUUSD.r", "US100.", "GBPUSD.r", "AUDUSD.r", "USDCAD.r", "ETHUSD"]

    # ★★★ 마지막 전송 시간 추적 (실시간 전환용) ★★★
    last_send_time = 0
    last_data_timestamp = 0
    last_user_refresh = 0  # ★ 유저 MT5 정보 DB 갱신 타이머
    last_ping_time = 0  # ★ 서버 ping 타이머
    last_client_pong = time.time() if 'time' in dir() else 0  # ★ 클라이언트 응답 시간

    while True:
        try:
            import time as time_module
            current_time = time_module.time()

            # ★★★ MetaAPI 실시간 데이터 (시세 + 캔들 + 인디케이터 동기화) ★★★
            realtime_data = get_realtime_data()
            all_prices = realtime_data["prices"]
            all_candles = realtime_data["candles"]
            indicators = realtime_data["indicators"]
            data_timestamp = realtime_data["timestamp"]

            # ★★★ 데이터 변경 시에만 전송 (또는 1초 경과) ★★★
            should_send = (
                data_timestamp != last_data_timestamp or
                (current_time - last_send_time) >= 1.0
            )

            if not should_send:
                await asyncio.sleep(0.1)  # 100ms 대기 후 재확인
                continue

            last_send_time = current_time
            last_data_timestamp = data_timestamp

            # ★★★ 유저 MT5 계정 정보 주기적 DB 갱신 (30초마다) ★★★
            if user_id and (current_time - last_user_refresh) > 30:
                last_user_refresh = current_time
                try:
                    _refresh_db = next(get_db())
                    _refresh_user = _refresh_db.query(User).filter(User.id == user_id).first()
                    if _refresh_user and _refresh_user.has_mt5_account:
                        if _refresh_user.mt5_account_number != user_mt5_account:
                            print(f"[LIVE WS] 🔄 User {user_id} MT5 계정 갱신: {user_mt5_account} → {_refresh_user.mt5_account_number}")
                        user_mt5_account = _refresh_user.mt5_account_number
                        user_mt5_server = _refresh_user.mt5_server
                        user_mt5_balance = _refresh_user.mt5_balance
                        user_mt5_equity = _refresh_user.mt5_equity
                        user_mt5_leverage = _refresh_user.mt5_leverage

                        # ★★★ MetaAPI 상태 갱신 ★★★
                        _old_status = _ws_user_metaapi_status
                        _ws_user_metaapi_id = _refresh_user.metaapi_account_id
                        _ws_user_metaapi_status = _refresh_user.metaapi_status
                        _ws_use_user_metaapi = bool(_ws_user_metaapi_id and _ws_user_metaapi_status == 'deployed')
                        if _old_status != _ws_user_metaapi_status:
                            print(f"[LIVE WS] 🔄 User {user_id} MetaAPI 상태 변경: {_old_status} → {_ws_user_metaapi_status}")

                    elif _refresh_user and not _refresh_user.has_mt5_account and user_mt5_account:
                        print(f"[LIVE WS] 🔄 User {user_id} MT5 계정 해제 감지")
                        user_mt5_account = None
                        user_mt5_server = None
                    _refresh_db.close()
                except Exception as _refresh_err:
                    print(f"[LIVE WS] DB refresh error: {_refresh_err}")

            # ★ 주문 후 빠른 동기화 예약 확인
            if user_id and '_user_sync_soon_map' in globals() and user_id in globals()['_user_sync_soon_map']:
                _user_sync_soon_at = globals()['_user_sync_soon_map'].pop(user_id)
                print(f"[LIVE WS] User {user_id} 빠른 동기화 예약 수신: {len(_user_sync_soon_at)}건")

            # ★★★ 유저별 MetaAPI 데이터 동기화 (적응형 주기) ★★★
            # ★★★ Streaming 연결 시 RPC는 백업용 (30초), 없으면 기존 주기 ★★★
            if _ws_use_user_metaapi and user_id:
                _has_streaming = user_id in user_trade_connections and user_trade_connections[user_id].get("streaming") is not None
                _sync_interval = 30 if _has_streaming else (5 if _user_has_position else 30)
                _should_sync = (current_time - last_user_metaapi_sync) > _sync_interval

                # ★★★ 첫 연결 시 강제 즉시 동기화 (stale 캐시 방지) ★★★
                if last_user_metaapi_sync == 0:
                    _should_sync = True
                    print(f"[LIVE WS] User {user_id} 첫 연결 - 강제 동기화 실행")

                # ★ 주문 직후 빠른 동기화 (예약된 시간 도달 시)
                if _user_sync_soon_at and current_time >= _user_sync_soon_at[0]:
                    _should_sync = True
                    _user_sync_soon_at.pop(0)
                    print(f"[LIVE WS] User {user_id} 주문 후 빠른 동기화 실행")

                if _should_sync:
                    last_user_metaapi_sync = current_time
                    try:
                        _u_account = await get_user_account_info(user_id, _ws_user_metaapi_id)
                        # ★★★ 항상 포지션 조회 (모든 magic 포지션 표시 필요) ★★★
                        _u_positions = await get_user_positions(user_id, _ws_user_metaapi_id)

                        if _u_account:
                            user_metaapi_cache[user_id] = {
                                "account_info": _u_account,
                                "positions": _u_positions or [],
                                "last_sync": current_time
                            }
                            # ★ 포지션 보유 여부 업데이트 (모든 magic 포지션 기준)
                            _user_has_position = len(_u_positions or []) > 0
                    except Exception as _sync_err:
                        print(f"[LIVE WS] User {user_id} MetaAPI sync error: {_sync_err}")

            # ★★★ 유저별 MetaAPI가 deployed면 connected 처리 ★★★
            metaapi_connected = is_metaapi_connected()
            if not metaapi_connected and _use_user_metaapi:
                metaapi_connected = True  # 유저 전용 MetaAPI deployed = connected
            mt5_connected = mt5_initialize_safe()
            bridge_connected = metaapi_connected

            # ★★★ 인디케이터 값 (동일 데이터에서 계산됨) ★★★
            buy_count = indicators["buy"]
            sell_count = indicators["sell"]
            neutral_count = indicators["neutral"]
            base_score = indicators["score"]

            # ★★★ 유저 라이브 캐시 확인 (주문/청산 직후 데이터) ★★★
            user_cache = user_live_cache.get(user_id) if user_id else None

            # ★★★ MetaAPI 캐시 조회 ★★★
            metaapi_account = get_metaapi_account()
            metaapi_positions = get_metaapi_positions()
            import time as _t
            closed_events = [e for e in pop_metaapi_closed_events() if _t.time() - e.get('timestamp', 0) < 60]  # 60초 이내만

            # ★ 유저의 실제 포지션이 없으면 이벤트 무시
            if closed_events and not (user_id and user_live_cache.get(user_id, {}).get('positions')):
                print(f"[WS] ⚠️ 청산 이벤트 {len(closed_events)}건 무시 (유저 포지션 없음)")
                closed_events = []

            # ★★★ 유저별 MetaAPI 포지션 청산 감지 (user_close_acknowledged 체크 포함) ★★★
            _user_closed_event = None
            _user_ack_time = user_close_acknowledged.get(user_id, 0) if user_id else 0
            _is_user_close_recent = (current_time - _user_ack_time) < 20  # 20초 이내 사용자 청산

            if _ws_use_user_metaapi and user_id:
                _user_ma_positions_now = user_metaapi_cache.get(user_id, {}).get("positions", [])
                _user_magic_positions = [p for p in _user_ma_positions_now if p.get("magic", 0) == magic]
                _has_position_now = len(_user_magic_positions) > 0

                if _prev_user_position and not _has_position_now:
                    if _is_user_close_recent:
                        # ★★★ 사용자가 직접 청산 → WS 자동감지 완전 스킵 + 캐시 강제 정리 ★★★
                        print(f"[LIVE WS] ⏭️ User {user_id} 사용자 청산 후 {current_time - _user_ack_time:.1f}초 — 자동감지 스킵")
                        # ★ 청산된 포지션만 캐시에서 제거 (다른 포지션은 유지!)
                        _closed_pos_id = _prev_user_position.get("id") if _prev_user_position else None
                        if _closed_pos_id and user_id in user_live_cache:
                            user_live_cache[user_id]["positions"] = [
                                p for p in user_live_cache[user_id].get("positions", [])
                                if p.get("id") != _closed_pos_id
                            ]
                        _prev_user_position = None
                        _position_disappeared_count = 0
                    else:
                        _position_disappeared_count += 1
                        # 2회 연속 확인 시 청산으로 확정 (SL/TP 빠른 감지 필요)
                        if _position_disappeared_count >= 2:
                            _prev_profit = _prev_user_position.get("profit", 0)
                            _prev_symbol = _prev_user_position.get("symbol", "")
                            _is_win = _prev_profit >= 0

                            _user_closed_event = {
                                "profit": _prev_profit,
                                "symbol": _prev_symbol,
                                "is_win": _is_win,
                                "position_id": _prev_user_position.get("id", ""),
                            }
                            print(f"[LIVE WS] 🔔 자동 청산 감지! User {user_id}, {_prev_symbol} P/L=${_prev_profit:.2f}")

                            _prev_user_position = None
                            _position_disappeared_count = 0
                elif _has_position_now:
                    _prev_user_position = _user_magic_positions[0]
                    _position_disappeared_count = 0
                    # ★★★ 포지션 있으면 acknowledged 클리어 (새 포지션 진입 의미) ★★★
                    if user_id and user_id in user_close_acknowledged:
                        del user_close_acknowledged[user_id]

            # ★ 계정 정보 (유저별 MetaAPI > 공유 MetaAPI > user_cache > MT5)
            _user_ma_cache = user_metaapi_cache.get(user_id) if user_id else None
            if _ws_use_user_metaapi and _user_ma_cache and _user_ma_cache.get("account_info"):
                # ★★★ 유저별 MetaAPI 계정 데이터 ★★★
                _u_acc = _user_ma_cache["account_info"]
                broker = "HedgeHood Pty Ltd"
                login = user_mt5_account or 0
                server = user_mt5_server or "HedgeHood-MT5"
                balance = _u_acc.get("balance", 0)
                equity = _u_acc.get("equity", 0)
                margin = _u_acc.get("margin", 0)
                free_margin = _u_acc.get("freeMargin", 0)
                leverage = _u_acc.get("leverage", 0) or user_mt5_leverage or 500
            elif metaapi_account and metaapi_account.get("balance") and not _ws_use_user_metaapi and user_has_mt5:
                # ★★★ 유저별 MetaAPI가 없는 경우에만 공유 MetaAPI 사용 ★★★
                broker = "HedgeHood Pty Ltd"
                login = user_mt5_account or 0
                server = user_mt5_server or "HedgeHood-MT5"
                balance = metaapi_account.get("balance", 0)
                equity = metaapi_account.get("equity", 0)
                margin = metaapi_account.get("margin", 0)
                free_margin = metaapi_account.get("freeMargin", 0)
                leverage = metaapi_account.get("leverage", 0) or user_mt5_leverage or 500
            elif user_cache and user_cache.get("account_info"):
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
                # ★★★ 공유 MT5 터미널 계정 노출 방지 - 유저 계정 우선 ★★★
                login = user_mt5_account or 0
                server = user_mt5_server or (account.server if account else "N/A")
                balance = account.balance if account else 0
                equity = account.equity if account else 0
                margin = account.margin if account else 0
                free_margin = account.margin_free if account else 0
                leverage = account.leverage if account else 0
            else:
                broker = "HedgeHood Pty Ltd"
                login = user_mt5_account or 0
                server = user_mt5_server or "HedgeHood-MT5"
                # 유저별 저장된 잔고 사용
                balance = user_mt5_balance or 0
                equity = user_mt5_equity or user_mt5_balance or 0
                margin = user_mt5_margin or 0
                free_margin = user_mt5_free_margin or user_mt5_balance or 0
                leverage = user_mt5_leverage or 500

            # ★★★ 시세/캔들은 이미 realtime_data에서 가져옴 (위에서) ★★★

            # 포지션 정보 (유저 MetaAPI → 공유 MetaAPI → user_cache → MT5 → Bridge)
            positions_count = 0
            position_data = None
            total_realtime_profit = 0  # ★★★ 실시간 총 P/L

            # ★★★ 유저별 MetaAPI 포지션 우선 ★★★
            if _ws_use_user_metaapi and _user_ma_cache and "positions" in _user_ma_cache:
                _u_positions = _user_ma_cache["positions"]
                positions_count = len(_u_positions)
                for pos in _u_positions:
                    pos_symbol = pos.get("symbol", "")
                    pos_type_str = pos.get("type", "")
                    pos_type = 0 if "BUY" in str(pos_type_str) else 1
                    pos_volume = pos.get("volume", 0)
                    pos_open = pos.get("openPrice", 0)

                    # ★ 현재 가격으로 P/L 재계산
                    current_price_data = all_prices.get(pos_symbol, {})
                    current_bid = current_price_data.get("bid", pos_open)
                    current_ask = current_price_data.get("ask", pos_open)

                    realtime_profit = calculate_realtime_profit(
                        pos_type, pos_symbol, pos_volume, pos_open, current_bid, current_ask
                    )
                    total_realtime_profit += realtime_profit

                    # 패널용 포지션 (magic 파라미터로 필터링)
                    if pos.get("magic") == magic:
                        position_data = {
                            "type": "BUY" if pos_type == 0 else "SELL",
                            "symbol": pos_symbol,
                            "volume": pos_volume,
                            "entry": pos_open,
                            "profit": realtime_profit,
                            "ticket": pos.get("id", 0),
                            "magic": pos.get("magic", 0)
                        }

                # ★★★ MetaAPI 동기화 지연 보완: user_live_cache fallback ★★★
                # MetaAPI에 포지션 없지만 user_live_cache에 있으면 (주문 직후 3~10초)
                # ★ 단, 사용자 청산 확인 후에는 fallback 하지 않음 (포지션 재출현 방지)
                if not position_data and user_cache and user_cache.get("positions") and not _is_user_close_recent:
                    for pos in user_cache["positions"]:
                        if pos.get("magic") == magic:
                            pos_symbol = pos.get("symbol", "")
                            pos_type = pos.get("type", 0)
                            pos_volume = pos.get("volume", 0)
                            pos_open = pos.get("price_open", 0)

                            current_price_data = all_prices.get(pos_symbol, {})
                            current_bid = current_price_data.get("bid", pos_open)
                            current_ask = current_price_data.get("ask", pos_open)
                            realtime_profit = calculate_realtime_profit(
                                pos_type, pos_symbol, pos_volume, pos_open, current_bid, current_ask
                            )

                            position_data = {
                                "type": "BUY" if pos_type == 0 else "SELL",
                                "symbol": pos_symbol,
                                "volume": pos_volume,
                                "entry": pos_open,
                                "profit": realtime_profit,
                                "ticket": pos.get("ticket", 0),
                                "magic": pos.get("magic", 0)
                            }
                            positions_count = max(positions_count, 1)
                            break

                # equity 재계산
                equity = balance + total_realtime_profit

            # ★★★ 공유 MetaAPI 캐시 사용 (유저별 MetaAPI가 없는 경우만) ★★★
            elif metaapi_connected and not _ws_use_user_metaapi:
                positions_count = len(metaapi_positions)
                for pos in metaapi_positions:
                    pos_symbol = pos.get("symbol", "")
                    # type: POSITION_TYPE_BUY → 0, POSITION_TYPE_SELL → 1
                    pos_type_str = pos.get("type", "")
                    pos_type = 0 if "BUY" in str(pos_type_str) else 1
                    pos_volume = pos.get("volume", 0)
                    pos_open = pos.get("openPrice", 0)

                    # ★ 현재 가격으로 P/L 재계산
                    current_price_data = all_prices.get(pos_symbol, {})
                    current_bid = current_price_data.get("bid", pos_open)
                    current_ask = current_price_data.get("ask", pos_open)

                    realtime_profit = calculate_realtime_profit(
                        pos_type, pos_symbol, pos_volume, pos_open, current_bid, current_ask
                    )
                    total_realtime_profit += realtime_profit

                    # 패널용 포지션 (magic 파라미터로 필터링)
                    if pos.get("magic") == magic:
                        position_data = {
                            "type": "BUY" if pos_type == 0 else "SELL",
                            "symbol": pos_symbol,
                            "volume": pos_volume,
                            "entry": pos_open,
                            "profit": realtime_profit,
                            "ticket": pos.get("id", 0),
                            "magic": pos.get("magic", 0)
                        }

                # equity 재계산
                equity = balance + total_realtime_profit

            elif user_cache and user_cache.get("positions"):
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

                    if pos.get("magic") == magic:
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

                # ★★★ [Option A] MT5 TP/SL에 위임 — 서버는 모니터링만 ★★★
                # 서버가 직접 청산하지 않음. MT5 TP/SL이 자동 청산 처리.
                # 여기서는 로그만 남겨서 상태 확인용으로 사용.
                target = user_target_cache.get(user_id, 0)
                if target > 0 and positions_count > 0 and position_data:
                    if total_realtime_profit >= target:
                        print(f"[LIVE WS] 📊 모니터링: User {user_id} WIN 영역 ${total_realtime_profit:.2f} >= Target ${target} (MT5 TP 대기)")
                    elif total_realtime_profit <= -target * 0.99:
                        print(f"[LIVE WS] 📊 모니터링: User {user_id} LOSE 영역 ${total_realtime_profit:.2f} <= -${target*0.99:.2f} (MT5 SL 대기)")

            elif mt5_connected:
                positions = mt5.positions_get()
                positions_count = len(positions) if positions else 0
                
                if positions and len(positions) > 0:
                    for pos in positions:
                        if pos.magic == magic:
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
                    if pos.get("magic") == magic:
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
            
            # ★★★ 인디케이터는 이미 realtime_data에서 동기화 계산됨 (위에서) ★★★

            # ★★★ 라이브 마틴 상태 (DB 기반) ★★★
            martin_state = None
            if user_id:
                try:
                    ws_db2 = next(get_db())
                    live_martin_state = ws_db2.query(LiveMartinState).filter_by(user_id=user_id, magic=magic).first()
                    if live_martin_state:
                        current_lot = live_martin_state.base_lot * (2 ** (live_martin_state.step - 1))
                        martin_state = {
                            "enabled": live_martin_state.enabled,
                            "step": live_martin_state.step,
                            "max_steps": live_martin_state.max_steps,
                            "base_lot": live_martin_state.base_lot,
                            "base_target": live_martin_state.base_target,
                            "current_lot": round(current_lot, 2),
                            "accumulated_loss": live_martin_state.accumulated_loss,
                            "magic": magic
                        }
                    ws_db2.close()
                except Exception as martin_db_err:
                    print(f"[WS] 마틴 상태 조회 오류: {martin_db_err}")
                    martin_state = martin_service.get_state()  # fallback
            else:
                martin_state = martin_service.get_state()  # 비로그인 fallback
            
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

            # ★★★ 동기화 이벤트 확인 (SL/TP 청산 감지 + MetaAPI 청산 이벤트) ★★★
            sync_event = None
            if user_id and user_id in user_sync_events:
                sync_event = user_sync_events.pop(user_id)
                print(f"[WS] 📢 User {user_id} sync_event 전송: {sync_event}")

            # ★★★ 자동청산 캐시 확인 (WS 루프 기반 자동청산) ★★★
            ws_auto_closed_info = None
            if user_id and user_id in auto_closed_cache:
                cached = auto_closed_cache[user_id]
                if current_time <= cached.get("until", 0):
                    ws_auto_closed_info = cached.get("info")
                else:
                    del auto_closed_cache[user_id]

            # ★★★ 유저 Streaming 청산 이벤트 체크 (실시간 감지!) ★★★
            _user_streaming_closed = None
            if user_id:
                from .metaapi_service import pop_user_closed_events
                _streaming_events = pop_user_closed_events(user_id, magic)
                if _streaming_events:
                    _user_streaming_closed = _streaming_events[0]  # 첫 번째 이벤트
                    print(f"[WS] 📢 Streaming 청산 감지! User {user_id}, {_user_streaming_closed['symbol']} P/L=${_user_streaming_closed['profit']:.2f}")

            # ★★★ MetaAPI 청산 이벤트 처리 ★★★
            auto_closed = False
            closed_profit = 0
            is_win = False
            closed_message = None
            closed_at = None
            martin_reset = False
            martin_step_up = False
            martin_step = 1
            martin_accumulated_loss = 0

            # 우선순위: WS 자동청산 캐시 > Streaming 청산 > MetaAPI 포지션 감지 > 공유 MetaAPI
            if ws_auto_closed_info:
                auto_closed = True
                closed_profit = ws_auto_closed_info.get("closed_profit", 0)
                is_win = ws_auto_closed_info.get("is_win", False)
                closed_message = ws_auto_closed_info.get("message", "")
                closed_at = ws_auto_closed_info.get("closed_at", 0)
                martin_reset = ws_auto_closed_info.get("martin_reset", False)
                martin_step_up = ws_auto_closed_info.get("martin_step_up", False)
                martin_step = ws_auto_closed_info.get("martin_step", 1)
                martin_accumulated_loss = ws_auto_closed_info.get("martin_accumulated_loss", 0)
            elif _user_streaming_closed:
                # ★★★ Streaming 실시간 청산 감지 (가장 빠른 감지!) ★★★
                auto_closed = True
                closed_profit = _user_streaming_closed["profit"]
                is_win = _user_streaming_closed["is_win"]
                closed_message = f"{'이익' if is_win else '손실'} 청산: ${closed_profit:.2f}"
                closed_at = current_time

                print(f"[WS] 📢 Streaming 청산: {_user_streaming_closed['symbol']} P/L=${closed_profit:.2f}")

                # ★★★ 라이브 마틴: DB 안 건드림! 현재 값만 읽어서 프론트에 전달 ★★★
                if user_id:
                    try:
                        ws_db = next(get_db())
                        live_martin = ws_db.query(LiveMartinState).filter_by(user_id=user_id, magic=magic).first()
                        if live_martin and live_martin.enabled:
                            martin_step = live_martin.step
                            martin_accumulated_loss = live_martin.accumulated_loss
                            martin_reset = False
                            martin_step_up = False
                            print(f"[WS MARTIN] User {user_id} P/L=${closed_profit:.2f} (DB 미변경, 프론트 팝업 대기)")
                        ws_db.close()
                    except Exception as martin_err:
                        print(f"[WS MARTIN] DB 조회 오류: {martin_err}")

                # ★★★ 청산된 포지션만 제거 (다른 포지션 유지!) ★★★
                _streaming_closed_id = _user_streaming_closed.get("position_id", "")
                if user_id and user_id in user_live_cache and _streaming_closed_id:
                    user_live_cache[user_id]["positions"] = [
                        p for p in user_live_cache[user_id].get("positions", [])
                        if p.get("id") != _streaming_closed_id
                    ]
                    user_live_cache[user_id]["updated_at"] = time_module.time()
                    print(f"[WS] 🧹 Streaming 청산 - 포지션 {_streaming_closed_id} 제거")
                if user_id in user_target_cache:
                    del user_target_cache[user_id]
            elif _user_closed_event:
                # ★★★ 유저별 MetaAPI 포지션 청산 (RPC 폴링 fallback) ★★★
                auto_closed = True
                closed_profit = _user_closed_event["profit"]
                is_win = _user_closed_event["is_win"]
                closed_message = f"{'이익' if is_win else '손실'} 청산: ${closed_profit:.2f}"
                closed_at = current_time

                print(f"[WS] 📢 유저별 MetaAPI 청산: {_user_closed_event['symbol']} P/L=${closed_profit:.2f}")

                # ★★★ 캐시 즉시 정리 (포지션 재출현 방지) ★★★
                _closed_pos_id = _user_closed_event.get("position_id", "")
                if user_id and user_id in user_metaapi_cache and "positions" in user_metaapi_cache.get(user_id, {}):
                    user_metaapi_cache[user_id]["positions"] = [
                        p for p in user_metaapi_cache[user_id]["positions"]
                        if p.get("id") != _closed_pos_id
                    ]
                    print(f"[WS] 🧹 user_metaapi_cache 포지션 제거: {_closed_pos_id}")

                # ★★★ 라이브 마틴: DB 안 건드림! 현재 값만 읽어서 프론트에 전달 ★★★
                if user_id:
                    try:
                        ws_db = next(get_db())
                        live_martin = ws_db.query(LiveMartinState).filter_by(user_id=user_id, magic=magic).first()
                        if live_martin and live_martin.enabled:
                            martin_step = live_martin.step
                            martin_accumulated_loss = live_martin.accumulated_loss
                            martin_reset = False
                            martin_step_up = False
                            print(f"[WS MARTIN RPC] User {user_id} P/L=${closed_profit:.2f} (DB 미변경, 프론트 팝업 대기)")
                        ws_db.close()
                    except Exception as martin_err:
                        print(f"[WS MARTIN RPC] DB 조회 오류: {martin_err}")

                # ★★★ 청산된 포지션만 제거 (다른 포지션 유지!) ★★★
                _rpc_closed_id = _user_closed_event.get("position_id", "")
                if user_id and user_id in user_live_cache and _rpc_closed_id:
                    user_live_cache[user_id]["positions"] = [
                        p for p in user_live_cache[user_id].get("positions", [])
                        if p.get("id") != _rpc_closed_id
                    ]
                    user_live_cache[user_id]["updated_at"] = time_module.time()
                    print(f"[WS] 🧹 RPC 청산 - 포지션 {_rpc_closed_id} 제거")

                # user_target_cache 정리
                if user_id in user_target_cache:
                    del user_target_cache[user_id]

            elif closed_events:
                # 첫 번째 이벤트 기준으로 설정
                first_event = closed_events[0]
                auto_closed = True
                closed_profit = first_event.get('profit', 0)
                is_win = closed_profit >= 0
                closed_message = f"{'이익' if is_win else '손실'} 청산: ${closed_profit:.2f}"
                closed_at = current_time

                if sync_event is None:
                    sync_event = {}
                sync_event["metaapi_closed"] = closed_events
                print(f"[WS] 📢 MetaAPI 청산 이벤트: {len(closed_events)}건, P/L=${closed_profit:.2f}")

                # ★★★ 라이브 마틴: DB 안 건드림! 현재 값만 읽어서 프론트에 전달 ★★★
                if user_id:
                    try:
                        ws_db = next(get_db())
                        live_martin = ws_db.query(LiveMartinState).filter_by(user_id=user_id, magic=magic).first()
                        if live_martin and live_martin.enabled:
                            martin_step = live_martin.step
                            martin_accumulated_loss = live_martin.accumulated_loss
                            martin_reset = False
                            martin_step_up = False
                            print(f"[WS MARTIN Events] User {user_id} P/L=${closed_profit:.2f} (DB 미변경, 프론트 팝업 대기)")
                        ws_db.close()
                    except Exception as martin_err:
                        print(f"[WS MARTIN Events] DB 조회 오류: {martin_err}")

                # ★★★ 청산된 포지션만 제거 (다른 포지션 유지!) ★★★
                _closed_event_ids = [e.get("position_id", "") for e in closed_events if e.get("position_id")]
                if user_id and user_id in user_live_cache and _closed_event_ids:
                    user_live_cache[user_id]["positions"] = [
                        p for p in user_live_cache[user_id].get("positions", [])
                        if p.get("id") not in _closed_event_ids
                    ]
                    user_live_cache[user_id]["updated_at"] = time_module.time()
                    print(f"[WS] 🧹 MT5 TP/SL 청산 - 포지션 {len(_closed_event_ids)}개 제거: {_closed_event_ids}")

                # ★★★ user_target_cache 정리 (Option A: MT5 TP/SL 청산 후 모니터링 중단) ★★★
                if user_id in user_target_cache:
                    del user_target_cache[user_id]
                    print(f"[WS] 🧹 User {user_id} target_cache 삭제 (MT5 TP/SL 청산 완료)")

            # ★★★ 포지션 홀드: MetaAPI 동기화 지연 시 null 깜빡임 방지 ★★★
            if position_data:
                _last_sent_position = position_data
                _last_position_time = current_time
            elif _last_sent_position and (current_time - _last_position_time) < POSITION_HOLD_SEC:
                # 포지션이 사라졌지만 3초 이내 → 이전 포지션 유지
                # ★★★ 단, 사용자 청산 확인 or 자동청산이면 홀드하지 않음 ★★★
                if not auto_closed and not _is_user_close_recent:
                    position_data = _last_sent_position
                    positions_count = max(positions_count, 1)
                else:
                    _last_sent_position = None
            else:
                _last_sent_position = None

            # ★★★ 사용자 청산 확인 후 포지션 데이터 전송 차단 ★★★
            # 단, 새로운 포지션이 열린 경우(다른 ticket/id)는 전송 허용
            if _is_user_close_recent and position_data and not auto_closed:
                _ack_pos_id = user_close_acknowledged.get(f"{user_id}_pos_id", "")
                _current_pos_id = str(position_data.get("ticket", ""))
                if not _ack_pos_id or _ack_pos_id == _current_pos_id:
                    print(f"[LIVE WS] ⏭️ User {user_id} 청산 확인 후 — 동일 포지션 데이터 제거")
                    position_data = None
                    _last_sent_position = None
                else:
                    print(f"[LIVE WS] ✅ User {user_id} 새 포지션 감지 — 전송 허용 (old={_ack_pos_id}, new={_current_pos_id})")

            # ★★★ 라이브 positions 배열 구성 (Open Positions 탭용) ★★★
            # MetaAPI 원본 필드 → 프론트엔드 통일 필드로 변환
            raw_positions = []
            if _ws_use_user_metaapi and user_id:
                # 유저별 MetaAPI 포지션
                raw_positions = user_metaapi_cache.get(user_id, {}).get("positions", [])
            elif user_id and user_id in user_live_cache:
                # user_live_cache 포지션
                raw_positions = user_live_cache[user_id].get("positions", [])
            else:
                # 공유 MetaAPI 포지션
                raw_positions = metaapi_positions or []

            # ★★★ 필드명 통일 변환 (MetaAPI → 프론트엔드 형식) ★★★
            live_positions_list = []
            for pos in raw_positions:
                live_positions_list.append({
                    "id": pos.get("id"),
                    "ticket": pos.get("id"),  # 청산용 티켓 ID
                    "symbol": pos.get("symbol"),
                    "type": pos.get("type"),  # POSITION_TYPE_BUY → 프론트에서 정규화
                    "volume": pos.get("volume", 0),
                    "profit": pos.get("profit") or pos.get("unrealizedProfit", 0),
                    "entry": pos.get("openPrice", 0),  # ★ openPrice → entry
                    "current": pos.get("currentPrice", 0),  # ★ currentPrice → current
                    "magic": pos.get("magic", 0),
                    "opened_at": safe_json_value(pos.get("time", "")),  # ★ datetime 안전 변환
                    "sl": pos.get("stopLoss", 0),
                    "tp": pos.get("takeProfit", 0),
                    "target": pos.get("target", 0)
                })

            data = {
                "mt5_connected": user_has_mt5,  # ★ 전체 연결 상태
                "metaapi_connected": metaapi_connected,  # ★★★ MetaAPI 연결 상태 (마틴 주문 제한용) ★★★
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
                "positions": live_positions_list,  # ★★★ Open Positions 탭용 ★★★
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
                "sync_event": sync_event,  # ★ SL/TP 청산 이벤트
                # ★★★ 자동 청산 정보 ★★★
                "auto_closed": auto_closed,
                "closed_profit": closed_profit,
                "is_win": is_win,
                "magic": magic,  # ★ Quick&Easy 패널 연동용
                "closed_message": closed_message,
                "closed_at": closed_at,
                "martin_reset": martin_reset,
                "martin_step_up": martin_step_up,
                "martin_step": martin_step,
                "martin_accumulated_loss": martin_accumulated_loss
            }
            
            # ★★★ default=str로 datetime 등 직렬화 안 되는 타입 자동 변환 ★★★
            await websocket.send_text(json.dumps(data, default=str))

            # ★★★ 서버 ping (20초마다) ★★★
            if current_time - last_ping_time > 20:
                last_ping_time = current_time
                try:
                    await websocket.send_text(json.dumps({"type": "ping", "ts": current_time}))
                except Exception:
                    break  # 전송 실패 = 연결 죽음

            # ★★★ 클라이언트 메시지 비동기 수신 (pong 등) ★★★
            try:
                client_msg = await asyncio.wait_for(websocket.receive_text(), timeout=0.05)
                if client_msg:
                    parsed = json.loads(client_msg)
                    if parsed.get("type") == "pong":
                        last_client_pong = current_time
            except asyncio.TimeoutError:
                pass  # 타임아웃 OK - 클라이언트가 보낸 게 없음
            except Exception:
                break  # 수신 실패 = 연결 죽음

            # ★★★ 실시간 전송: 0.2초 간격 (데모와 동일) ★★★
            await asyncio.sleep(0.15)

        except WebSocketDisconnect:
            print(f"[LIVE WS] User {user_id} WebSocket disconnected")
            break
        except Exception as e:
            # ★ 에러 발생해도 WS 연결 유지, 해당 루프만 스킵
            if str(e):
                print(f"[LIVE WS] WebSocket Error (user {user_id}): {e}")
            await asyncio.sleep(random.uniform(1.0, 3.0))

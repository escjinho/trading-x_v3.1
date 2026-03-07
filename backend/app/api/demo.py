# app/api/demo.py
"""
Demo 모드 API - 모의투자 기능
Trading-X Backend
"""

from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, Query, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import Integer
from datetime import datetime, timedelta
import pytz as _demo_pytz
_DEMO_KST = _demo_pytz.timezone('Asia/Seoul')
def _demo_kst_now():
    return datetime.now(_DEMO_KST).replace(tzinfo=None)
try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False
import asyncio
import json
import random
import httpx
import time

from ..database import get_db

# ========== 외부 API 가격 캐시 ==========
price_cache = {
    "prices": {},
    "last_update": 0
}

async def fetch_external_prices():
    """Binance API에서 실시간 가격 조회"""
    global price_cache

    # 1초 이내 캐시 사용
    if time.time() - price_cache["last_update"] < 1:
        return price_cache["prices"]

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # Binance API로 BTC, ETH 가격 조회
            response = await client.get("https://api.binance.com/api/v3/ticker/price", params={
                "symbols": '["BTCUSDT","ETHUSDT"]'
            })
            if response.status_code == 200:
                data = response.json()
                prices = {}
                for item in data:
                    if item["symbol"] == "BTCUSDT":
                        price = float(item["price"])
                        prices["BTCUSD"] = {"bid": price - 5, "ask": price + 5, "last": price}
                    elif item["symbol"] == "ETHUSDT":
                        price = float(item["price"])
                        prices["ETHUSD"] = {"bid": price - 1, "ask": price + 1, "last": price}

                # 다른 심볼은 더미 데이터
                prices["EURUSD.r"] = {"bid": 1.0850, "ask": 1.0852, "last": 1.0851}
                prices["USDJPY.r"] = {"bid": 149.50, "ask": 149.52, "last": 149.51}
                prices["XAUUSD.r"] = {"bid": 2025.50, "ask": 2026.00, "last": 2025.75}
                prices["US100."] = {"bid": 17850.0, "ask": 17852.0, "last": 17851.0}
                prices["GBPUSD.r"] = {"bid": 1.2650, "ask": 1.2652, "last": 1.2651}
                prices["AUDUSD.r"] = {"bid": 0.6550, "ask": 0.6552, "last": 0.6551}
                prices["USDCAD.r"] = {"bid": 1.3450, "ask": 1.3452, "last": 1.3451}

                price_cache["prices"] = prices
                price_cache["last_update"] = time.time()
                return prices
    except Exception as e:
        print(f"[External API] Error: {e}")

    # 실패시 더미 데이터
    return {
        "BTCUSD": {"bid": 97000.0, "ask": 97010.0, "last": 97005.0},
        "ETHUSD": {"bid": 3200.0, "ask": 3202.0, "last": 3201.0},
        "EURUSD.r": {"bid": 1.0850, "ask": 1.0852, "last": 1.0851},
        "USDJPY.r": {"bid": 149.50, "ask": 149.52, "last": 149.51},
        "XAUUSD.r": {"bid": 2025.50, "ask": 2026.00, "last": 2025.75},
        "US100.": {"bid": 17850.0, "ask": 17852.0, "last": 17851.0},
        "GBPUSD.r": {"bid": 1.2650, "ask": 1.2652, "last": 1.2651},
        "AUDUSD.r": {"bid": 0.6550, "ask": 0.6552, "last": 0.6551},
        "USDCAD.r": {"bid": 1.3450, "ask": 1.3452, "last": 1.3451}
    }
from math import ceil
from ..models.user import User
from ..models.demo_trade import DemoTrade, DemoPosition, DemoMartinState, DemoTransaction
from .demo_service import reset_account, topup_account, record_trade_transaction, get_anchor_point, get_period_initial_balance, get_net_deposits, get_filtered_trades
from ..utils.security import decode_token
from ..services.indicator_service import IndicatorService
from .mt5 import get_bridge_prices, get_bridge_candles, bridge_cache

# ========== 시그널 게이지 로직 (원칙 기반) ==========
# 이전 점수 저장 (스무딩용)
_prev_signal_score = 50.0

# ★★★ Phase 2: 동적 심볼 지원 ★★★
indicator_symbol = "BTCUSD"

# ★ Synthetic 캔들 시가 캐시 (1분마다 갱신)
_synthetic_candle_cache = {
    "minute": 0,      # 현재 분 (unix timestamp // 60)
    "open_prices": {} # {symbol: open_price}
}

def calculate_indicators_from_bridge(symbol: str = "BTCUSD") -> dict:
    """
    원칙 기반 시그널 게이지 (1분봉 캔들 기준):

    1) 양봉 (current_tick > candle_open):
       - Neutral 기준 Buy 쪽으로 이동
       - 양봉 크면 (≥0.1%): Strong Buy ~ Buy 사이 왔다갔다
       - 양봉 작으면: Neutral ~ Buy 사이 왔다갔다

    2) 음봉 (current_tick < candle_open):
       - Sell 쪽으로 이동
       - 음봉 크면 (≥0.1%): Strong Sell ~ Sell 사이 왔다갔다
       - 음봉 작으면: Neutral ~ Sell 사이 왔다갔다

    3) 시가 부근 (변동폭 매우 작음):
       - Neutral 중심, 양봉/음봉에 따라 살짝 왔다갔다

    Score 범위:
    - 80~95: Strong Buy
    - 60~80: Buy
    - 40~60: Neutral
    - 20~40: Sell
    - 5~20: Strong Sell
    """
    global _prev_signal_score, _synthetic_candle_cache

    # 현재 tick 가격 가져오기
    prices = get_bridge_prices()
    price_data = prices.get(symbol, {})
    current_tick = price_data.get("bid", 0)

    # ★ Bridge에 가격이 없으면 외부 API 캐시 사용
    if current_tick == 0:
        ext_prices = price_cache.get("prices", {})
        if symbol in ext_prices:
            current_tick = ext_prices[symbol].get("bid", 0)

    # 1분봉 캔들 데이터 (M1 우선, 없으면 M5)
    candles = get_bridge_candles(symbol, "M1")
    if not candles or len(candles) < 1:
        candles = get_bridge_candles(symbol, "M5")

    # 기본값
    candle_open = 0
    if candles and len(candles) >= 1:
        # 가장 최근 캔들의 open
        candle_open = candles[-1].get("open", 0)

    # ★ 캔들이 없으면 synthetic 캔들 사용 (1분마다 시가 갱신)
    if candle_open == 0 and current_tick > 0:
        current_minute = int(time.time()) // 60
        if _synthetic_candle_cache["minute"] != current_minute:
            # 새로운 분 → 시가 갱신
            _synthetic_candle_cache["minute"] = current_minute
            _synthetic_candle_cache["open_prices"][symbol] = current_tick
        elif symbol not in _synthetic_candle_cache["open_prices"]:
            # 해당 심볼 시가가 없으면 현재가로 설정
            _synthetic_candle_cache["open_prices"][symbol] = current_tick

        candle_open = _synthetic_candle_cache["open_prices"].get(symbol, current_tick)

    # 변동폭 계산
    if current_tick > 0 and candle_open > 0:
        change_pct = (current_tick - candle_open) / candle_open * 100
    else:
        change_pct = 0

    # ========== 점수 범위 결정 ==========
    if change_pct >= 0.1:
        # 강한 양봉 → Strong Buy ~ Buy (80~95)
        score_min, score_max = 80, 95
    elif change_pct >= 0.03:
        # 일반 양봉 → Buy ~ Strong Buy (65~85)
        score_min, score_max = 65, 85
    elif change_pct > 0.01:
        # 약한 양봉 → Neutral ~ Buy (50~70)
        score_min, score_max = 50, 70
    elif change_pct <= -0.1:
        # 강한 음봉 → Strong Sell ~ Sell (5~20)
        score_min, score_max = 5, 20
    elif change_pct <= -0.03:
        # 일반 음봉 → Sell ~ Strong Sell (15~35)
        score_min, score_max = 15, 35
    elif change_pct < -0.01:
        # 약한 음봉 → Sell ~ Neutral (30~50)
        score_min, score_max = 30, 50
    else:
        # 시가 부근 (변동 미미) → Neutral 중심 (40~60)
        # 양봉/음봉 방향에 따라 살짝 치우침
        if change_pct > 0:
            score_min, score_max = 45, 60
        elif change_pct < 0:
            score_min, score_max = 40, 55
        else:
            score_min, score_max = 45, 55

    # ========== 랜덤워크로 범위 내 왔다갔다 ==========
    raw_score = random.uniform(score_min, score_max)

    # ========== 스무딩 (70% 이전값 + 30% 새값) ==========
    smoothed_score = _prev_signal_score * 0.7 + raw_score * 0.3

    # 범위 제한 (5~95)
    final_score = max(5, min(95, smoothed_score))

    # 이전 값 저장
    _prev_signal_score = final_score

    # ========== buy/sell/neutral 계산 ==========
    if final_score >= 70:
        disp_buy = 55 + int((final_score - 70) * 1.5)
        disp_sell = max(5, 20 - int((final_score - 70) * 0.5))
    elif final_score >= 50:
        disp_buy = 35 + int((final_score - 50) * 1.0)
        disp_sell = 35 - int((final_score - 50) * 0.5)
    elif final_score >= 30:
        disp_sell = 35 + int((50 - final_score) * 1.0)
        disp_buy = 35 - int((50 - final_score) * 0.5)
    else:
        disp_sell = 55 + int((30 - final_score) * 1.5)
        disp_buy = max(5, 20 - int((30 - final_score) * 0.5))

    disp_buy = max(5, min(80, disp_buy))
    disp_sell = max(5, min(80, disp_sell))
    disp_neutral = 100 - disp_buy - disp_sell
    disp_neutral = max(5, disp_neutral)

    return {
        "buy": disp_buy,
        "sell": disp_sell,
        "neutral": disp_neutral,
        "score": final_score
    }

# ========== 심볼별 기본 스펙 (bridge_cache에 symbol_info 없을 때 사용) ==========
# contract_size: 1랏 기준 계약 크기, margin_rate: 증거금률 (MT5 기준)
DEFAULT_SYMBOL_SPECS = {
    "BTCUSD":   {"tick_size": 0.01,    "tick_value": 0.01,  "contract_size": 1,      "margin_rate": 0.01},    # 1:100 (MT5 기준)
    "ETHUSD":   {"tick_size": 0.01,    "tick_value": 0.01,  "contract_size": 1,      "margin_rate": 0.02},    # 1:50 (MT5 기준)
    "XAUUSD.r": {"tick_size": 0.01,    "tick_value": 1.0,   "contract_size": 100,    "margin_rate": 0.0035},  # 1랏 $993
    "EURUSD.r": {"tick_size": 0.00001, "tick_value": 1.0,   "contract_size": 100000, "margin_rate": 0.002},   # 1:500
    "USDJPY.r": {"tick_size": 0.001,   "tick_value": 0.67,  "contract_size": 100000, "margin_rate": 0.002},   # 1:500
    "GBPUSD.r": {"tick_size": 0.00001, "tick_value": 1.0,   "contract_size": 100000, "margin_rate": 0.002},   # 1:500
    "AUDUSD.r": {"tick_size": 0.00001, "tick_value": 1.0,   "contract_size": 100000, "margin_rate": 0.002},   # 1:500
    "USDCAD.r": {"tick_size": 0.00001, "tick_value": 0.74,  "contract_size": 100000, "margin_rate": 0.002},   # 1:500
    "US100.":   {"tick_size": 0.01,    "tick_value": 0.2,   "contract_size": 20,     "margin_rate": 0.00574}, # 1랏 $2502
}

def calculate_demo_margin(symbol: str, volume: float, price: float) -> float:
    """데모 마진 계산 (MT5 없을 때 사용)"""
    specs = DEFAULT_SYMBOL_SPECS.get(symbol, {"contract_size": 1, "margin_rate": 0.002})
    contract_size = specs.get("contract_size", 1)
    margin_rate = specs.get("margin_rate", 0.002)  # 1:500 = 0.002

    # margin = volume * contract_size * price * margin_rate
    margin = volume * contract_size * price * margin_rate
    return round(margin, 2)

def calculate_demo_profit(symbol: str, entry_price: float, trade_type: str, volume: float):
    """Bridge 가격 기반 데모 손익 계산. Returns: (current_price, profit)"""
    current_price = 0
    # ★ MetaAPI 실시간 가격 우선 사용
    from .metaapi_service import quote_price_cache
    if quote_price_cache and symbol in quote_price_cache:
        price_data = quote_price_cache[symbol]
        current_price = price_data.get('bid', 0) if trade_type == "BUY" else price_data.get('ask', 0)
    # fallback: bridge cache
    if current_price <= 0:
        bridge_prices = get_bridge_prices()
        if bridge_prices and symbol in bridge_prices:
            price_data = bridge_prices[symbol]
            current_price = price_data.get('bid', 0) if trade_type == "BUY" else price_data.get('ask', 0)

    if not current_price or current_price <= 0:
        return entry_price, 0.0

    # symbol_info 우선, 없으면 DEFAULT_SYMBOL_SPECS 사용
    sym_info = bridge_cache.get("symbol_info", {}).get(symbol)
    if sym_info and sym_info.get('tick_size', 0) > 0 and sym_info.get('tick_value', 0) > 0:
        tick_size = sym_info['tick_size']
        tick_value = sym_info['tick_value']
    else:
        specs = DEFAULT_SYMBOL_SPECS.get(symbol, {"tick_size": 0.01, "tick_value": 0.01})
        tick_size = specs['tick_size']
        tick_value = specs['tick_value']

    if trade_type == "BUY":
        price_diff = current_price - entry_price
    else:
        price_diff = entry_price - current_price

    ticks = price_diff / tick_size
    profit = ticks * tick_value * volume
    return current_price, round(profit, 2)

router = APIRouter(prefix="/demo", tags=["Demo"])
security = HTTPBearer()


# ========== 인증 함수 ==========
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    token = credentials.credentials
    payload = decode_token(token)
    
    if not payload:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰")
    
    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == int(user_id)).first()
    
    if not user:
        raise HTTPException(status_code=404, detail="사용자 없음")
    
    return user


# ========== 데모 계좌 개설 ==========
@router.post("/create-account")
async def create_demo_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 계좌 개설 — D-500XXXXX 형식으로 자동 발번"""
    # 이미 계좌가 있으면 기존 계좌번호 반환
    if current_user.demo_account_number:
        return {
            "success": True,
            "account_number": current_user.demo_account_number,
            "message": "이미 데모 계좌가 개설되어 있습니다",
            "already_exists": True
        }

    # 현재 최대 번호 조회
    from sqlalchemy import func as sa_func
    max_result = db.query(
        sa_func.max(
            sa_func.cast(
                sa_func.replace(User.demo_account_number, 'D-500', ''),
                Integer
            )
        )
    ).filter(User.demo_account_number.isnot(None)).scalar()

    next_num = (max_result or 10000) + 1
    new_account_number = f"D-500{next_num}"

    # 유저에게 할당 + 초기 잔고 세팅
    current_user.demo_account_number = new_account_number
    current_user.demo_balance = 10000.0
    current_user.demo_equity = 10000.0
    current_user.demo_today_profit = 0.0
    db.commit()
    db.refresh(current_user)

    print(f"[DEMO] ✅ 계좌 개설: User {current_user.id} → {new_account_number}")

    return {
        "success": True,
        "account_number": new_account_number,
        "message": "데모 계좌가 개설되었습니다",
        "already_exists": False
    }


# ========== 데모 계정 정보 ==========
@router.get("/account-info")
async def get_demo_account(
    _force_mode: str = Query(None, alias="mode", description="mode=demo이면 항상 데모 데이터 반환"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 계정 정보 조회"""
    print(f"\n[ACCOUNT-INFO] 🔵 START - User: {current_user.id}")

    # ★ 기존 유저 자동 마이그레이션: balance > 0인데 계좌번호 없으면 자동 발번
    if not current_user.demo_account_number and (current_user.demo_balance or 0) > 0:
        from sqlalchemy import func as sa_func
        max_result = db.query(
            sa_func.max(
                sa_func.cast(
                    sa_func.replace(User.demo_account_number, 'D-500', ''),
                    Integer
                )
            )
        ).filter(User.demo_account_number.isnot(None)).scalar()
        next_num = (max_result or 10000) + 1
        current_user.demo_account_number = f"D-500{next_num}"
        db.commit()
        db.refresh(current_user)
        print(f"[ACCOUNT-INFO] ✅ 기존 유저 자동 마이그레이션: User {current_user.id} → {current_user.demo_account_number}")

    # 모든 열린 포지션 조회 (Account 탭용)
    all_positions = db.query(DemoPosition).filter(
        DemoPosition.user_id == current_user.id
    ).all()
    
    # Buy/Sell 패널용 포지션 (magic=100001)
    positions = [p for p in all_positions if p.magic == 100001]

    print(f"[ACCOUNT-INFO] 🔍 Query result - Found {len(positions)} positions")
    for pos in positions:
        print(f"[ACCOUNT-INFO] 📍 Position ID: {pos.id}, Symbol: {pos.symbol}, Type: {pos.trade_type}, User: {pos.user_id}")

    # 기존 로직 호환 (첫 번째 포지션)
    position = positions[0] if positions else None

    if position:
        print(f"[ACCOUNT-INFO] ✅ First position - ID: {position.id}, Symbol: {position.symbol}")
    else:
        print("[ACCOUNT-INFO] ❌ No positions found!")

    position_data = None
    if position:
        # 현재가 조회
        print(f"[DEBUG] Position found: {position.symbol}, target: {position.target_profit}")
        
        if not MT5_AVAILABLE or not mt5.initialize():
            print("[DEBUG] MT5 not available - using bridge for profit calculation")
            current_price, profit = calculate_demo_profit(
                position.symbol, position.entry_price, position.trade_type, position.volume
            )
            # Quick&Easy(100003)는 WebSocket에서만 자동청산 (hidePositionView 알림 위해)
            if position.magic == 100003:
                target = 0  # account-info에서 자동청산 스킵
            else:
                target = position.target_profit or 0
            print(f"[DEBUG-BRIDGE] Symbol: {position.symbol}, Entry: {position.entry_price}, Current: {current_price}, Profit: {profit}, Target: {target}")

            # 목표 수익/손실 도달시 자동 청산 (양방향)
            should_close = False
            is_win = False

            # ★★★ 디버그 로그 추가 ★★★
            print(f"[MARTIN-DEBUG] Checking close: symbol={position.symbol}, profit={profit:.2f}, target={target}, magic={position.magic}")

            if target > 0:
                # ★ 가격 기반 청산 (tp_price/sl_price 우선)
                if position.tp_price and position.sl_price and current_price > 0:
                    if position.trade_type == "BUY":
                        if current_price >= position.tp_price:
                            should_close = True
                            is_win = True
                            print(f"[AUTO-CLOSE] BUY TP 도달! current={current_price} >= tp={position.tp_price}")
                        elif current_price <= position.sl_price:
                            should_close = True
                            is_win = False
                            print(f"[AUTO-CLOSE] BUY SL 도달! current={current_price} <= sl={position.sl_price}")
                    else:  # SELL
                        if current_price <= position.tp_price:
                            should_close = True
                            is_win = True
                            print(f"[AUTO-CLOSE] SELL TP 도달! current={current_price} <= tp={position.tp_price}")
                        elif current_price >= position.sl_price:
                            should_close = True
                            is_win = False
                            print(f"[AUTO-CLOSE] SELL SL 도달! current={current_price} >= sl={position.sl_price}")
                else:
                    # fallback: profit 기반 (tp_price 없는 기존 포지션)
                    if profit >= target:
                        should_close = True
                        is_win = True
                        print(f"[AUTO-CLOSE] Fallback WIN: profit={profit:.2f} >= target={target}")
                    elif profit <= -target * 0.99:
                        should_close = True
                        is_win = False
                        print(f"[AUTO-CLOSE] Fallback LOSE: profit={profit:.2f} <= -{target*0.99:.2f}")

            if not should_close and target > 0:
                print(f"[MARTIN-DEBUG] No close: profit={profit:.2f}, target_range=[{-target*0.99:.2f}, {target:.2f}]")

            if should_close:
                print(f"[DEBUG-BRIDGE] AUTO CLOSING! {'WIN' if is_win else 'LOSE'} - Profit: {profit}")

                # 마틴 모드 상태 업데이트 (DemoMartinState 테이블 사용)
                martin_reset = False
                martin_step_up = False

                martin_state = get_or_create_martin_state(db, current_user.id, position.magic)
                print(f"[MARTIN-DEBUG] Martin state BEFORE: enabled={martin_state.enabled}, step={martin_state.step}, acc_loss={martin_state.accumulated_loss}")

                if martin_state.enabled and martin_state.step >= 1:
                    # ★★★ DB 변경 안 함! 프론트 팝업에서 유저 선택 후 API로 처리 ★★★
                    print(f"[MARTIN-DEBUG] 마틴 상태 읽기만: step={martin_state.step}, acc_loss={martin_state.accumulated_loss}")

                print(f"[MARTIN-DEBUG] Martin state AFTER: step={martin_state.step}, acc_loss={martin_state.accumulated_loss}")

                # 거래 내역 저장
                trade = DemoTrade(
                    user_id=current_user.id,
                    symbol=position.symbol,
                    trade_type=position.trade_type,
                    volume=position.volume,
                    entry_price=position.entry_price,
                    exit_price=current_price,
                    profit=profit,
                    is_closed=True,
                    closed_at=datetime.now()
                )
                db.add(trade)
                db.flush()
                _bal_bf = current_user.demo_balance or 10000.0
                record_trade_transaction(db, current_user.id, trade.id, position.symbol, position.trade_type, profit, _bal_bf, round(_bal_bf + profit, 2))

                current_user.demo_balance = (current_user.demo_balance or 10000.0) + profit
                current_user.demo_equity = current_user.demo_balance
                current_user.demo_today_profit = (current_user.demo_today_profit or 0.0) + profit
                db.delete(position)
                db.commit()

                message = f"🎯 목표 도달! +${profit:,.2f}" if is_win else f"💔 손절! ${profit:,.2f}"

                # 라이브/데모 모드에 따른 반환값 설정
                if current_user.has_mt5_account:
                    return {
                        "balance": current_user.mt5_balance or 0,
                        "equity": current_user.mt5_equity or current_user.mt5_balance or 0,
                        "today_profit": current_user.demo_today_profit,
                        "broker": "Trading-X Markets",
                        "account": current_user.demo_account_number or "-",
                        "server": "Demo Server",
                        "leverage": current_user.mt5_leverage or 500,
                        "position": None,
                        "positions_count": 0,
                        "has_mt5": True,
                        "has_demo_account": bool(current_user.demo_account_number),
                        "auto_closed": True,
                        "closed_profit": profit,
                        "is_win": is_win,
                        "martin_reset": martin_reset,
                        "martin_step_up": martin_step_up if not is_win else False,
                        "message": message
                    }
                else:
                    return {
                        "balance": current_user.demo_balance,
                        "equity": current_user.demo_equity,
                        "today_profit": current_user.demo_today_profit,
                        "broker": "Trading-X Markets",
                        "account": current_user.demo_account_number or "-",
                        "server": "Demo Server",
                        "leverage": 500,
                        "position": None,
                        "positions_count": 0,
                        "has_mt5": False,
                        "has_demo_account": bool(current_user.demo_account_number),
                        "auto_closed": True,
                        "closed_profit": profit,
                        "is_win": is_win,
                        "martin_reset": martin_reset,
                        "martin_step_up": martin_step_up if not is_win else False,
                        "message": message
                    }

            position_data = {
                "id": position.id,
                "type": position.trade_type,
                "symbol": position.symbol,
                "volume": position.volume,
                "entry": position.entry_price,
                "current": current_price,
                "profit": profit,
                "target": target,
                "tp_price": position.tp_price,
                "sl_price": position.sl_price
            }
        else:
            tick = mt5.symbol_info_tick(position.symbol)
            if not tick:
                print(f"[DEBUG] Tick FAILED for {position.symbol}!")
                position_data = {
                    "id": position.id,
                    "type": position.trade_type,
                    "symbol": position.symbol,
                    "volume": position.volume,
                    "entry": position.entry_price,
                    "current": position.entry_price,
                    "profit": 0,
                    "target": position.target_profit,
                    "tp_price": position.tp_price,
                    "sl_price": position.sl_price
                }
            else:
                print(f"[DEBUG] Tick OK - bid: {tick.bid}, ask: {tick.ask}")
                current_price = tick.bid if position.trade_type == "BUY" else tick.ask
                entry_price = position.entry_price
                
                # MT5에서 심볼 정보로 정확한 손익 계산
                symbol_info = mt5.symbol_info(position.symbol)
                if symbol_info:
                    contract_size = symbol_info.trade_contract_size
                    tick_size = symbol_info.trade_tick_size
                    tick_value = symbol_info.trade_tick_value
                    
                    if position.trade_type == "BUY":
                        price_diff = current_price - entry_price
                    else:
                        price_diff = entry_price - current_price
                    
                    if tick_size > 0:
                        ticks = price_diff / tick_size
                        profit = ticks * tick_value * position.volume
                    else:
                        profit = price_diff * contract_size * position.volume
                else:
                    if position.trade_type == "BUY":
                        profit = (current_price - entry_price) * position.volume
                    else:
                        profit = (entry_price - current_price) * position.volume
                
                profit = round(profit, 2)
                target = position.target_profit or 0
                
                print(f"="*50)
                print(f"[DEBUG] Symbol: {position.symbol}")
                print(f"[DEBUG] Type: {position.trade_type}")
                print(f"[DEBUG] Entry: {entry_price}, Current: {current_price}")
                print(f"[DEBUG] Profit: {profit} (type: {type(profit).__name__})")
                print(f"[DEBUG] Target: {target} (type: {type(target).__name__})")
                print(f"[DEBUG] Condition WIN: profit >= target = {profit} >= {target} = {profit >= target}")
                print(f"[DEBUG] Condition LOSE: profit <= -target = {profit} <= -{target} = {profit <= -target}")
                print(f"="*50)
                
                # 목표 수익/손실 도달시 자동 청산! (양방향)
                should_close = False
                is_win = False
                
                if target > 0:
                    if profit >= target:  # WIN: 정확히 target 도달
                        should_close = True
                        is_win = True
                        print(f"[DEBUG] WIN! Profit {profit} >= Target {target}")
                    elif profit <= -target * 0.99:  # LOSE: target의 99% 도달 시 청산
                        should_close = True
                        is_win = False
                        print(f"[DEBUG] LOSE! Profit {profit} <= -Target*0.99 {-target * 0.99}")
                
                if should_close:
                    print(f"[DEBUG] AUTO CLOSING! {'WIN' if is_win else 'LOSE'} - Profit: {profit}")
                    
                    # 마틴 모드 상태 업데이트 (DemoMartinState 테이블 사용)
                    martin_reset = False
                    martin_step_up = False

                    martin_state = get_or_create_martin_state(db, current_user.id, position.magic)
                    if martin_state.enabled and martin_state.step >= 1:
                        # ★★★ DB 변경 안 함! 프론트 팝업에서 유저 선택 후 API로 처리 ★★★
                        print(f"[DEBUG] 마틴 상태 읽기만: step={martin_state.step}, acc_loss={martin_state.accumulated_loss}")
                    
                    # 거래 내역 저장
                    trade = DemoTrade(
                        user_id=current_user.id,
                        symbol=position.symbol,
                        trade_type=position.trade_type,
                        volume=position.volume,
                        entry_price=entry_price,
                        exit_price=current_price,
                        profit=profit,
                        is_closed=True,
                        closed_at=datetime.now()
                    )
                    db.add(trade)
                    db.flush()
                    _bal_bf = current_user.demo_balance or 10000.0
                    record_trade_transaction(db, current_user.id, trade.id, position.symbol, position.trade_type, profit, _bal_bf, round(_bal_bf + profit, 2))

                    # 잔고 업데이트
                    current_user.demo_balance = (current_user.demo_balance or 10000.0) + profit
                    current_user.demo_equity = current_user.demo_balance
                    current_user.demo_today_profit = (current_user.demo_today_profit or 0.0) + profit
                    
                    # 포지션 삭제
                    db.delete(position)
                    db.commit()
                    
                    # 청산된 상태로 반환
                    if is_win:
                        message = f"🎯 목표 도달! +${profit:,.2f}"
                    else:
                        message = f"💔 손절! ${profit:,.2f}"

                    # 라이브/데모 모드에 따른 반환값 설정
                    if current_user.has_mt5_account:
                        return {
                            "balance": current_user.mt5_balance or 0,
                            "equity": current_user.mt5_equity or current_user.mt5_balance or 0,
                            "today_profit": current_user.demo_today_profit,
                            "broker": "Trading-X Markets",
                            "account": current_user.demo_account_number or "-",
                            "server": "Demo Server",
                            "leverage": current_user.mt5_leverage or 500,
                            "position": None,
                            "positions_count": 0,
                            "has_mt5": True,
                            "has_demo_account": bool(current_user.demo_account_number),
                            "auto_closed": True,
                            "closed_profit": profit,
                            "is_win": is_win,
                            "martin_reset": martin_reset,
                            "martin_step_up": martin_step_up if not is_win else False,
                            "message": message
                        }
                    else:
                        return {
                            "balance": current_user.demo_balance,
                            "equity": current_user.demo_equity,
                            "today_profit": current_user.demo_today_profit,
                            "broker": "Trading-X Markets",
                            "account": current_user.demo_account_number or "-",
                            "server": "Demo Server",
                            "leverage": 500,
                            "position": None,
                            "positions_count": 0,
                            "has_mt5": False,
                            "has_demo_account": bool(current_user.demo_account_number),
                            "auto_closed": True,
                            "closed_profit": profit,
                            "is_win": is_win,
                            "martin_reset": martin_reset,
                            "martin_step_up": martin_step_up if not is_win else False,
                            "message": message
                        }
                
                position_data = {
                    "id": position.id,
                    "type": position.trade_type,
                    "symbol": position.symbol,
                    "volume": position.volume,
                    "entry": entry_price,
                    "current": current_price,
                    "profit": profit,
                    "target": target
                }
    
    # 다중 포지션 데이터 생성 (전체 포지션 - Account 탭용)
    positions_data = []
    total_margin = 0
    leverage = 500  # 데모 레버리지
    
    for pos in all_positions:
        pos_price_data = {"profit": 0, "current": pos.entry_price, "margin": 0}

        if MT5_AVAILABLE and mt5.initialize():
            tick = mt5.symbol_info_tick(pos.symbol)
            symbol_info = mt5.symbol_info(pos.symbol)

            if tick:
                current_price = tick.bid if pos.trade_type == "BUY" else tick.ask

                if symbol_info and symbol_info.trade_tick_size > 0:
                    if pos.trade_type == "BUY":
                        price_diff = current_price - pos.entry_price
                    else:
                        price_diff = pos.entry_price - current_price
                    ticks = price_diff / symbol_info.trade_tick_size
                    profit = ticks * symbol_info.trade_tick_value * pos.volume
                else:
                    if pos.trade_type == "BUY":
                        profit = (current_price - pos.entry_price) * pos.volume
                    else:
                        profit = (pos.entry_price - current_price) * pos.volume

                # MT5 함수로 정확한 마진 계산 (종목별 레버리지 자동 적용)
                order_type = mt5.ORDER_TYPE_BUY if pos.trade_type == "BUY" else mt5.ORDER_TYPE_SELL
                margin = mt5.order_calc_margin(order_type, pos.symbol, pos.volume, current_price)
                if margin is None:
                    margin = 0

                pos_price_data = {
                    "profit": round(profit, 2),
                    "current": current_price,
                    "margin": round(margin, 2)
                }
        else:
            # MT5 없음 - bridge 기반 계산
            cur_px, cur_profit = calculate_demo_profit(
                pos.symbol, pos.entry_price, pos.trade_type, pos.volume
            )
            # 마진 계산 (MT5 없을 때)
            cur_margin = calculate_demo_margin(pos.symbol, pos.volume, cur_px)
            pos_price_data = {
                "profit": cur_profit,
                "current": cur_px,
                "margin": cur_margin
            }
        
        total_margin += pos_price_data["margin"]
        
        positions_data.append({
            "id": pos.id,
            "ticket": pos.id,
            "type": pos.trade_type,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "entry": pos.entry_price,
            "current": pos_price_data["current"],
            "profit": pos_price_data["profit"],
            "target": pos.target_profit,
            "magic": pos.magic,
            "margin": pos_price_data["margin"],
            "opened_at": str(pos.created_at) if pos.created_at else "",
            "tp_price": pos.tp_price,
            "sl_price": pos.sl_price
        })

    # ★ current_pl 계산 (모든 포지션 profit 합산)
    current_pl = sum(p.get("profit", 0) for p in positions_data)

    print(f"[ACCOUNT-INFO] 📦 Returning - position_data: {position_data is not None}, positions_count: {len(positions)}, current_pl: {current_pl}")
    print("[ACCOUNT-INFO] 🔴 END\n")

    # ★★★ 라이브 모드 (MT5 계정 연결됨) - 유저 MT5 계정 정보 반환 ★★★
    # mode=demo 파라미터가 있으면 항상 데모 데이터 반환 (Demo Trading Report용)
    if current_user.has_mt5_account and _force_mode != "demo":
        # MT5 포지션 수: margin > 0이면 포지션 있음 (MetaAPI 기반)
        mt5_margin_val = current_user.mt5_margin or 0
        # ★ P/L = Equity - Balance (MT5 표준 공식)
        mt5_equity_val = current_user.mt5_equity or current_user.mt5_balance or 0
        mt5_balance_val = current_user.mt5_balance or 0
        mt5_profit_val = round(mt5_equity_val - mt5_balance_val, 2)
        # MT5 open positions 추정: margin이 있으면 포지션 존재
        mt5_open_count = getattr(current_user, 'mt5_positions_count', None)
        if mt5_open_count is None:
            # mt5_positions_count 필드가 없으면 margin으로 추정
            mt5_open_count = len(all_positions) if len(all_positions) > 0 else (1 if mt5_margin_val > 0 else 0)
        return {
            "balance": current_user.mt5_balance or 0,
            "equity": current_user.mt5_equity or current_user.mt5_balance or 0,
            "margin": mt5_margin_val,
            "free_margin": current_user.mt5_free_margin or current_user.mt5_balance or 0,
            "profit": mt5_profit_val,
            "today_profit": current_user.demo_today_profit or 0.0,
            "current_pl": mt5_profit_val,  # ★ equity - balance (profit과 동일)
            "broker": "Trading-X Markets",
            "account": current_user.demo_account_number or "-",
            "server": "Demo Server",
            "leverage": current_user.mt5_leverage or 500,
            "currency": current_user.mt5_currency or "USD",
            "position": position_data,
            "positions": positions_data,
            "positions_count": mt5_open_count,
            "buysell_count": len(positions),
            "has_mt5": True,
            "has_demo_account": bool(current_user.demo_account_number),
            "total_margin": round(total_margin, 2)
        }

    # ★★★ 데모 모드 - 기존 데모 계정 정보 반환 ★★★
    demo_balance = current_user.demo_balance or 10000.0
    return {
        "balance": demo_balance,
        "equity": current_user.demo_equity or 10000.0,
        "today_profit": current_user.demo_today_profit or 0.0,
        "current_pl": round(current_pl, 2),
        "broker": "Trading-X Markets",
        "account": current_user.demo_account_number or "-",
        "server": "Demo Server",
        "leverage": 500,
        "position": position_data,
        "positions": positions_data,
        "positions_count": len(all_positions),
        "buysell_count": len(positions),
        "has_mt5": False,
        "has_demo_account": bool(current_user.demo_account_number),
        "margin": round(total_margin, 2),
        "free_margin": round(demo_balance - total_margin, 2),
        "total_margin": round(total_margin, 2)
    }


# ========== 데모 주문 ==========
@router.post("/order")
async def place_demo_order(
    symbol: str = "BTCUSD",
    order_type: str = "BUY",
    volume: float = 0.01,
    target: float = 100,
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 주문 실행 (다중 포지션 지원)"""
    print(f"\n[DEMO ORDER] 🔵 START - User: {current_user.id}, Symbol: {symbol}, Type: {order_type}, Volume: {volume}, Target: {target}")

    # ★ 데모 계좌 미생성 시 주문 거부
    if not current_user.demo_account_number:
        return JSONResponse(status_code=403, content={
            "success": False,
            "message": "데모 계좌를 먼저 개설해주세요."
        })

    # 중복 주문 허용 - 체크 로직 제거됨

    # 현재가 조회
    entry_price = 0.0
    if MT5_AVAILABLE and mt5.initialize():
        tick = mt5.symbol_info_tick(symbol)
        if tick:
            entry_price = tick.ask if order_type.upper() == "BUY" else tick.bid
            print(f"[DEMO ORDER] 📊 Using MT5 price: {entry_price}")

    # ★★★ MT5 실패 또는 미사용 시 MetaAPI → Bridge → Binance fallback ★★★
    if entry_price <= 0:
        print(f"[DEMO ORDER] ⚠️ MT5 price unavailable for {symbol}, trying MetaAPI...")
        from .metaapi_service import quote_price_cache
        if quote_price_cache and symbol in quote_price_cache:
            price_data = quote_price_cache[symbol]
            entry_price = price_data.get('ask', 0) if order_type.upper() == "BUY" else price_data.get('bid', 0)
            print(f"[DEMO ORDER] 📊 Using MetaAPI price: {entry_price}")

    if entry_price <= 0:
        bridge_prices = get_bridge_prices()
        if bridge_prices and symbol in bridge_prices:
            price_data = bridge_prices[symbol]
            entry_price = price_data.get('ask', 0) if order_type.upper() == "BUY" else price_data.get('bid', 0)
            print(f"[DEMO ORDER] 📊 Using bridge cache price: {entry_price}")

    if entry_price <= 0:
        try:
            external_prices = await fetch_external_prices()
            if external_prices and symbol in external_prices:
                price_data = external_prices[symbol]
                entry_price = price_data.get('ask', 0) if order_type.upper() == "BUY" else price_data.get('bid', 0)
                print(f"[DEMO ORDER] 📡 Using Binance API price: {entry_price}")
        except Exception as e:
            print(f"[DEMO ORDER] ⚠️ Binance API error: {e}")

    if entry_price <= 0:
        entry_price = 50000.0 if "BTC" in symbol else 1.0
        print(f"[DEMO ORDER] ⚠️ All sources failed, using dummy: {entry_price}")
    print(f"[DEMO ORDER] 📊 Entry price: {entry_price}")

    # ★ B안: TP/SL 가격 계산 (magic=100003 Quick&Easy)
    tp_price_val = None
    sl_price_val = None
    if target > 0:
        specs = DEFAULT_SYMBOL_SPECS.get(symbol, {"tick_size": 0.01, "tick_value": 0.01})
        tick_size = specs.get("tick_size", 0.01)
        tick_value = specs.get("tick_value", 0.01)
        # ★ contract_size 제거 - calculate_demo_profit 공식과 일치
        ppp = volume * tick_value / tick_size if tick_size > 0 else 1

        if magic == 100003:
            # B안 비대칭: TP=target/ppp, SL=(target-spread)/ppp
            spread_raw = 0
            from .metaapi_service import quote_price_cache
            if quote_price_cache and symbol in quote_price_cache:
                pd = quote_price_cache[symbol]
                spread_raw = abs(pd.get('ask', 0) - pd.get('bid', 0))
            spread_cost = (spread_raw / tick_size) * tick_value * volume if tick_size > 0 else 0
            tp_diff = target / ppp if ppp > 0 else 0
            sl_diff = (target * 0.99) / ppp if ppp > 0 else 0  # ★ SL = target × 99%

            if order_type.upper() == "BUY":
                tp_price_val = round(entry_price + tp_diff, 8)
                sl_price_val = round(entry_price - sl_diff, 8)
            else:
                tp_price_val = round(entry_price - tp_diff, 8)
                sl_price_val = round(entry_price + sl_diff, 8)
            print(f"[DEMO B안] TP={tp_price_val}, SL={sl_price_val}, spread_cost={spread_cost:.2f}")
        else:
            # 기존 로직 (Buy/Sell, Martin)
            tp_diff = target / ppp if ppp > 0 else 0
            sl_diff = (target * 0.99) / ppp if ppp > 0 else 0
            if order_type.upper() == "BUY":
                tp_price_val = round(entry_price + tp_diff, 8)
                sl_price_val = round(entry_price - sl_diff, 8)
            else:
                tp_price_val = round(entry_price - tp_diff, 8)
                sl_price_val = round(entry_price + sl_diff, 8)

    # 포지션 생성 (Basic/NoLimit 모드용 - target 그대로 사용)
    new_position = DemoPosition(
        user_id=current_user.id,
        symbol=symbol,
        trade_type=order_type.upper(),
        volume=volume,
        entry_price=entry_price,
        target_profit=target,
        magic=magic,
        tp_price=tp_price_val,
        sl_price=sl_price_val
    )

    db.add(new_position)
    db.commit()
    db.refresh(new_position)

    print(f"[DEMO ORDER] ✅ Position created! ID: {new_position.id}, User: {new_position.user_id}")
    print(f"[DEMO ORDER] 📦 Position details - Symbol: {new_position.symbol}, Type: {new_position.trade_type}, Entry: {new_position.entry_price}, Target: {new_position.target_profit}")

    # 저장 확인 쿼리
    check_position = db.query(DemoPosition).filter(DemoPosition.id == new_position.id).first()
    print(f"[DEMO ORDER] 🔍 Verification query - Position exists: {check_position is not None}")

    print("[DEMO ORDER] 🔴 END\n")

    return JSONResponse({
        "success": True,
        "message": f"[DEMO] {order_type.upper()} {volume} lot @ {entry_price:,.2f}",
        "position_id": new_position.id
    })

# ========== 데모 포지션 조회 ==========
@router.get("/positions")
async def get_demo_positions(
    magic: int = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 포지션 조회 (magic 필터 옵션)"""
    query = db.query(DemoPosition).filter(
        DemoPosition.user_id == current_user.id
    )
    if magic is not None:
        query = query.filter(DemoPosition.magic == magic)
    
    positions = query.all()

    mt5_connected = MT5_AVAILABLE and mt5.initialize() if MT5_AVAILABLE else False

    leverage = 500  # 데모 기본 레버리지

    positions_data = []
    total_margin = 0

    for pos in positions:
        current_price = pos.entry_price
        profit = 0
        margin = 0

        if mt5_connected:
            tick = mt5.symbol_info_tick(pos.symbol)
            symbol_info = mt5.symbol_info(pos.symbol)

            if tick:
                current_price = tick.bid if pos.trade_type == "BUY" else tick.ask

                if symbol_info and symbol_info.trade_tick_size > 0:
                    if pos.trade_type == "BUY":
                        price_diff = current_price - pos.entry_price
                    else:
                        price_diff = pos.entry_price - current_price
                    ticks = price_diff / symbol_info.trade_tick_size
                    profit = ticks * symbol_info.trade_tick_value * pos.volume
                else:
                    if pos.trade_type == "BUY":
                        profit = (current_price - pos.entry_price) * pos.volume
                    else:
                        profit = (pos.entry_price - current_price) * pos.volume

                profit = round(profit, 2)

            order_type = mt5.ORDER_TYPE_BUY if pos.trade_type == "BUY" else mt5.ORDER_TYPE_SELL
            margin = mt5.order_calc_margin(order_type, pos.symbol, pos.volume, current_price)
            if margin is None:
                margin = 0
        else:
            # MT5 없음 - bridge 기반 계산
            current_price, profit = calculate_demo_profit(
                pos.symbol, pos.entry_price, pos.trade_type, pos.volume
            )
            # 마진 계산 (MT5 없을 때)
            margin = calculate_demo_margin(pos.symbol, pos.volume, current_price)

        margin = round(margin, 2)
        total_margin += margin

        positions_data.append({
            "id": pos.id,
            "ticket": pos.id,
            "type": pos.trade_type,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "entry": pos.entry_price,
            "current": current_price,
            "profit": profit,
            "target": pos.target_profit,
            "magic": pos.magic,
            "margin": margin,
            "opened_at": str(pos.created_at) if pos.created_at else "",
            "tp_price": pos.tp_price,
            "sl_price": pos.sl_price
        })
    
    return {
        "positions": positions_data,
        "count": len(positions_data),
        "total_margin": round(total_margin, 2),
        "leverage": leverage
    }

# ========== 데모 청산 ==========
@router.post("/close")
async def close_demo_position(
    ticket: int = None,
    symbol: str = None,
    magic: int = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 포지션 청산 (ticket 또는 symbol로 지정 가능)"""
    # ★ 디버깅 로그
    print(f"[close_demo_position] ticket={ticket}, symbol={symbol}, magic={magic}, user_id={current_user.id}")

    # 유저의 모든 포지션 ID 확인 (디버깅)
    all_positions = db.query(DemoPosition).filter(DemoPosition.user_id == current_user.id).all()
    print(f"[close_demo_position] 유저의 모든 포지션 ID: {[p.id for p in all_positions]}")

    # ticket으로 특정 포지션 청산
    if ticket:
        position = db.query(DemoPosition).filter(
            DemoPosition.id == ticket,
            DemoPosition.user_id == current_user.id
        ).first()
        print(f"[close_demo_position] ticket={ticket}으로 조회 결과: {position.id if position else 'None'}")
    # symbol + magic으로 해당 종목 포지션 청산
    elif symbol and magic:
        position = db.query(DemoPosition).filter(
            DemoPosition.symbol == symbol,
            DemoPosition.magic == magic,
            DemoPosition.user_id == current_user.id
        ).first()
    # symbol만으로 해당 종목 첫 번째 포지션 청산
    elif symbol:
        position = db.query(DemoPosition).filter(
            DemoPosition.symbol == symbol,
            DemoPosition.user_id == current_user.id
        ).first()
    # magic만으로 해당 패널 포지션 청산
    elif magic:
        position = db.query(DemoPosition).filter(
            DemoPosition.magic == magic,
            DemoPosition.user_id == current_user.id
        ).first()
    # 둘 다 없으면 아무 포지션이나 청산
    else:
        position = db.query(DemoPosition).filter(
            DemoPosition.user_id == current_user.id
        ).first()
    
    if not position:
        return JSONResponse({"success": False, "message": "열린 포지션 없음"})

    # 현재가 조회
    entry_price = position.entry_price
    exit_price = entry_price  # 기본값
    profit = 0

    if MT5_AVAILABLE and mt5.initialize():
        tick = mt5.symbol_info_tick(position.symbol)
        if tick:
            exit_price = tick.bid if position.trade_type == "BUY" else tick.ask

            # MT5에서 심볼 정보 가져와서 정확한 손익 계산
            symbol_info = mt5.symbol_info(position.symbol)
            if symbol_info:
                contract_size = symbol_info.trade_contract_size
                tick_size = symbol_info.trade_tick_size
                tick_value = symbol_info.trade_tick_value

                if position.trade_type == "BUY":
                    price_diff = exit_price - entry_price
                else:
                    price_diff = entry_price - exit_price

                # 정확한 손익 계산
                if tick_size > 0:
                    ticks = price_diff / tick_size
                    profit = ticks * tick_value * position.volume
                else:
                    profit = price_diff * contract_size * position.volume
            else:
                # 심볼 정보 없으면 간단 계산
                if position.trade_type == "BUY":
                    profit = (exit_price - entry_price) * position.volume
                else:
                    profit = (entry_price - exit_price) * position.volume
    else:
        # MT5 없음 - ★ MetaAPI 우선 사용 (주문 진입과 동일한 가격 소스)
        from .metaapi_service import quote_price_cache
        if quote_price_cache and position.symbol in quote_price_cache:
            price_data = quote_price_cache[position.symbol]
            exit_price = price_data.get('bid', 0) if position.trade_type == "BUY" else price_data.get('ask', 0)
            print(f"[DEMO CLOSE] 📊 Using MetaAPI price: {exit_price}")
            
            if exit_price > 0:
                # symbol_info로 정확한 손익 계산
                sym_info = bridge_cache.get("symbol_info", {}).get(position.symbol)
                if sym_info and sym_info.get('tick_size', 0) > 0 and sym_info.get('tick_value', 0) > 0:
                    tick_size = sym_info['tick_size']
                    tick_value = sym_info['tick_value']
                    if position.trade_type == "BUY":
                        price_diff = exit_price - entry_price
                    else:
                        price_diff = entry_price - exit_price
                    if tick_size > 0:
                        ticks = price_diff / tick_size
                        profit = ticks * tick_value * position.volume
                    else:
                        profit = price_diff * position.volume
                else:
                    # DEFAULT_SYMBOL_SPECS fallback
                    specs = DEFAULT_SYMBOL_SPECS.get(position.symbol, {"tick_size": 0.01, "tick_value": 0.01})
                    tick_size = specs['tick_size']
                    tick_value = specs['tick_value']
                    if position.trade_type == "BUY":
                        price_diff = exit_price - entry_price
                    else:
                        price_diff = entry_price - exit_price
                    ticks = price_diff / tick_size
                    profit = ticks * tick_value * position.volume
        
        # MetaAPI 실패 시 bridge cache fallback
        if exit_price <= 0 or exit_price == entry_price:
            bridge_prices = get_bridge_prices()
            if bridge_prices and position.symbol in bridge_prices:
                price_data = bridge_prices[position.symbol]
                exit_price = price_data.get('bid', entry_price) if position.trade_type == "BUY" else price_data.get('ask', entry_price)
                
                # 손익 계산 (bridge cache 사용)
                symbol_info = bridge_cache.get("symbol_info", {}).get(position.symbol)
                if symbol_info:
                    tick_size = symbol_info.get('tick_size', 0.01)
                    tick_value = symbol_info.get('tick_value', 1)
                    if position.trade_type == "BUY":
                        price_diff = exit_price - entry_price
                    else:
                        price_diff = entry_price - exit_price
                    if tick_size > 0:
                        ticks = price_diff / tick_size
                        profit = ticks * tick_value * position.volume
                    else:
                        profit = price_diff * position.volume
                else:
                    # symbol_info 없으면 간단 계산
                    if position.trade_type == "BUY":
                        profit = (exit_price - entry_price) * position.volume
                    else:
                        profit = (entry_price - exit_price) * position.volume
            else:
                # bridge cache도 없으면 → Binance API fallback
                try:
                    external_prices = await fetch_external_prices()
                    if external_prices and position.symbol in external_prices:
                        price_data = external_prices[position.symbol]
                        exit_price = price_data.get('bid', entry_price) if position.trade_type == "BUY" else price_data.get('ask', entry_price)
                        
                        if position.trade_type == "BUY":
                            profit = (exit_price - entry_price) * position.volume
                        else:
                            profit = (entry_price - exit_price) * position.volume
                        print(f"[DEMO CLOSE] 📡 Using Binance API price: {exit_price}")
                    else:
                        exit_price = entry_price
                        profit = 0
                except Exception as e:
                    print(f"[DEMO CLOSE] ⚠️ Binance API error: {e}")
                    exit_price = entry_price
                    profit = 0
    
    profit = round(profit, 2)
    
    # 거래 내역 저장
    trade = DemoTrade(
        user_id=current_user.id,
        symbol=position.symbol,
        trade_type=position.trade_type,
        volume=position.volume,
        entry_price=entry_price,
        exit_price=exit_price,
        profit=profit,
        is_closed=True,
        closed_at=datetime.now()
    )
    
    db.add(trade)
    db.flush()
    _bal_bf = current_user.demo_balance or 10000.0
    record_trade_transaction(db, current_user.id, trade.id, trade.symbol, trade.trade_type, profit, _bal_bf, round(_bal_bf + profit, 2))

    # 잔고 업데이트
    current_user.demo_balance = (current_user.demo_balance or 10000.0) + profit
    current_user.demo_equity = current_user.demo_balance
    current_user.demo_today_profit = (current_user.demo_today_profit or 0.0) + profit

    # ★★★ 마틴 상태는 프론트 팝업에서 처리 — 여기서는 읽기만 ★★★
    martin_reset = False
    martin_step = 1
    martin_accumulated_loss = 0.0

    martin_state = get_or_create_martin_state(db, current_user.id, position.magic)
    if martin_state.enabled:
        martin_step = martin_state.step
        martin_accumulated_loss = martin_state.accumulated_loss
        print(f"[DEMO CLOSE] 마틴 상태 읽기만: step={martin_step}, acc_loss={martin_accumulated_loss}")

    # 포지션 삭제
    db.delete(position)
    db.commit()

    return JSONResponse({
        "success": True,
        "message": f"[DEMO] 청산 완료! P/L: ${profit:+,.2f}",
        "profit": profit,
        "raw_profit": profit,  # 데모는 수수료 없음
        "new_balance": current_user.demo_balance,
        "martin_step": martin_step,
        "martin_accumulated_loss": martin_accumulated_loss,
        "martin_reset": martin_reset
    })


# ========== 데모 최신 거래 1건 (magic 필터) ==========
@router.get("/last-trade")
async def get_demo_last_trade(
    magic: int = Query(0, description="Magic number"),
    exclude_id: str = Query("", description="제외할 trade ID (이전 trade 필터)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 최신 거래 1건 (magic 필터)"""
    query = db.query(DemoTrade).filter(DemoTrade.user_id == current_user.id)
    if magic > 0:
        query = query.filter(DemoTrade.magic == magic)
    if exclude_id and exclude_id.isdigit():
        query = query.filter(DemoTrade.id != int(exclude_id))

    trade = query.order_by(DemoTrade.id.desc()).first()

    if not trade:
        return {"success": False, "message": "No trades"}

    return {
        "success": True,
        "trade": {
            "id": trade.id,
            "profit": trade.profit,
            "symbol": trade.symbol,
            "volume": trade.volume,
            "time": str(trade.created_at) if trade.created_at else "",
            "magic": trade.magic if hasattr(trade, 'magic') else 0
        }
    }


# ========== 데모 거래 내역 ==========
@router.get("/history")
async def get_demo_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 거래 내역 조회"""
    trades = db.query(DemoTrade).filter(
        DemoTrade.user_id == current_user.id,
        DemoTrade.is_closed == True
    ).order_by(DemoTrade.closed_at.desc()).limit(500).all()
    
    history = []
    for t in trades:
        history.append({
            "id": t.id,
            "symbol": t.symbol,
            "type": t.trade_type,
            "volume": t.volume,
            "entry": t.entry_price,
            "exit": t.exit_price,
            "profit": t.profit,
            "time": (t.closed_at + timedelta(hours=9)).strftime("%m/%d %H:%M") if t.closed_at else ""  # UTC → KST
        })
    
    return {"history": history}


# ========== 데모 잔고 리셋 ==========
@router.post("/reset")
async def reset_demo_balance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 잔고 초기화 — 서비스 레이어 호출"""
    result = reset_account(db, current_user)
    return JSONResponse({
        "success": True,
        "message": "데모 계정이 초기화되었습니다. 잔고: $10,000",
        "balance": 10000.0
    })


# ========== 데모 잔고 충전 ==========
@router.post("/topup")
async def topup_demo_balance(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 잔고 충전 — 서비스 레이어 호출"""
    try:
        body = await request.json()
        topup_amount = float(body.get("amount", 10000))
    except:
        topup_amount = 10000.0

    result = topup_account(db, current_user, topup_amount)
    return JSONResponse({
        "success": result["success"],
        "message": result["message"],
        "balance": result["balance"]
    })

    # ========== 데모 마틴 모드 API ==========

# ========== 마틴 상태 헬퍼 함수 ==========
def get_or_create_martin_state(db: Session, user_id: int, magic: int) -> DemoMartinState:
    """magic별 마틴 상태 조회 또는 생성"""
    state = db.query(DemoMartinState).filter_by(user_id=user_id, magic=magic).first()
    if not state:
        state = DemoMartinState(user_id=user_id, magic=magic)
        db.add(state)
        db.commit()
        db.refresh(state)
    return state

@router.get("/martin/state")
async def get_demo_martin_state(
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 마틴 상태 조회 (magic별 독립 관리)"""
    state = get_or_create_martin_state(db, current_user.id, magic)

    # 현재 랏 계산: base_lot × 2^(step-1)
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
async def enable_demo_martin(
    magic: int = 100001,
    base_lot: float = 0.01,
    max_steps: int = 5,
    base_target: float = 50.0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 마틴 모드 활성화 (magic별 독립 관리)"""
    state = get_or_create_martin_state(db, current_user.id, magic)
    state.enabled = True
    state.step = 1
    state.max_steps = max_steps
    state.base_lot = base_lot
    state.base_target = base_target
    state.accumulated_loss = 0.0
    db.commit()

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
async def disable_demo_martin(
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 마틴 모드 비활성화 (magic별 독립 관리)"""
    state = get_or_create_martin_state(db, current_user.id, magic)
    state.enabled = False
    state.step = 1
    state.accumulated_loss = 0.0
    db.commit()

    return JSONResponse({
        "success": True,
        "message": "마틴 모드 비활성화 및 리셋 완료",
        "magic": magic
    })


@router.post("/martin/order")
async def place_demo_martin_order(
    symbol: str = "BTCUSD",
    order_type: str = "BUY",
    target: float = 50,
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 마틴 주문 (magic별 독립 관리)"""
    # ★ 데모 계좌 미생성 시 주문 거부
    if not current_user.demo_account_number:
        return JSONResponse(status_code=403, content={
            "success": False,
            "message": "데모 계좌를 먼저 개설해주세요."
        })

    # 이미 열린 포지션 확인 (같은 magic)
    existing = db.query(DemoPosition).filter(
        DemoPosition.user_id == current_user.id,
        DemoPosition.magic == magic
    ).first()

    if existing:
        return JSONResponse({
            "success": False,
            "message": "이미 열린 포지션이 있습니다. 먼저 청산해주세요."
        })

    # 마틴 상태 조회
    state = get_or_create_martin_state(db, current_user.id, magic)

    # ★★★ 프론트에서 보낸 target으로 base_target 업데이트 ★★★
    if target > 0 and target != state.base_target:
        state.base_target = target
        print(f"[MARTIN ORDER] Updated base_target: {target}")

    # 현재가 조회
    entry_price = 0.0
    if MT5_AVAILABLE and mt5.initialize():
        tick = mt5.symbol_info_tick(symbol)
        if tick:
            entry_price = tick.ask if order_type.upper() == "BUY" else tick.bid
            print(f"[MARTIN ORDER] 📊 Using MT5 price: {entry_price}")

    # ★★★ MT5 실패 시 MetaAPI → Bridge → Binance fallback ★★★
    if entry_price <= 0:
        print(f"[MARTIN ORDER] ⚠️ MT5 price unavailable for {symbol}, trying MetaAPI...")
        from .metaapi_service import quote_price_cache
        if quote_price_cache and symbol in quote_price_cache:
            price_data = quote_price_cache[symbol]
            entry_price = price_data.get('ask', 0) if order_type.upper() == "BUY" else price_data.get('bid', 0)
            print(f"[MARTIN ORDER] 📊 Using MetaAPI price: {entry_price}")

    if entry_price <= 0:
        bridge_prices = get_bridge_prices()
        if bridge_prices and symbol in bridge_prices:
            price_data = bridge_prices[symbol]
            entry_price = price_data.get('ask', 0) if order_type.upper() == "BUY" else price_data.get('bid', 0)
            print(f"[MARTIN ORDER] 📊 Using bridge cache price: {entry_price}")

    if entry_price <= 0:
        try:
            external_prices = await fetch_external_prices()
            if external_prices and symbol in external_prices:
                price_data = external_prices[symbol]
                entry_price = price_data.get('ask', 0) if order_type.upper() == "BUY" else price_data.get('bid', 0)
                print(f"[MARTIN ORDER] 📡 Using Binance API price: {entry_price}")
        except Exception as e:
            print(f"[MARTIN ORDER] ⚠️ Binance API error: {e}")

    if entry_price <= 0:
        entry_price = 50000.0 if "BTC" in symbol else 1.0
        print(f"[MARTIN ORDER] ⚠️ All sources failed, using dummy: {entry_price}")

    # 마틴 랏 계산: base_lot * 2^(step-1)
    martin_lot = state.base_lot * (2 ** (state.step - 1))
    martin_lot = round(martin_lot, 2)

    # 마틴 목표 계산: ceil((accumulated_loss + base_target) / 5) * 5
    real_target = ceil((state.accumulated_loss + state.base_target) / 5) * 5
    print(f"[DEBUG] Martin Order: Magic {magic}, Step {state.step}, Lot {martin_lot}, AccLoss {state.accumulated_loss}, BaseTarget {state.base_target}, RealTarget {real_target}")

    # 포지션 생성
    new_position = DemoPosition(
        user_id=current_user.id,
        symbol=symbol,
        trade_type=order_type.upper(),
        volume=martin_lot,
        entry_price=entry_price,
        target_profit=real_target,
        magic=magic
    )

    db.add(new_position)
    db.commit()

    return JSONResponse({
        "success": True,
        "message": f"[MARTIN Step {state.step}] {order_type.upper()} {martin_lot} lot @ {entry_price:,.2f}",
        "position_id": new_position.id,
        "martin_step": state.step,
        "martin_lot": martin_lot,
        "magic": magic
    })


@router.post("/martin/update")
async def update_demo_martin_after_close(
    profit: float = 0,
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """청산 후 마틴 상태 업데이트 (magic별 독립 관리)"""
    state = get_or_create_martin_state(db, current_user.id, magic)

    if profit >= 0:
        # 이익: 마틴 리셋!
        state.step = 1
        state.accumulated_loss = 0.0
        db.commit()

        return JSONResponse({
            "success": True,
            "message": f"🎉 마틴 성공! +${profit:,.2f} → Step 1 리셋",
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

            return JSONResponse({
                "success": False,
                "message": f"❌ 마틴 실패! 최대 단계 도달 → 강제 리셋",
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

            return JSONResponse({
                "success": True,
                "message": f"📈 Step {new_step}로 진행! 다음 랏: {next_lot:.2f}",
                "new_step": new_step,
                "accumulated_loss": new_accumulated,
                "next_lot": round(next_lot, 2),
                "reset": False,
                "magic": magic
            })


# ========== 데모 마틴 누적손실 업데이트 ==========
@router.post("/martin/update-loss")
async def update_demo_martin_loss(
    accumulated_loss: float = 0,
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """마틴 누적손실만 업데이트 (magic별 독립 관리)"""
    state = get_or_create_martin_state(db, current_user.id, magic)
    state.accumulated_loss = accumulated_loss
    db.commit()

    return JSONResponse({
        "success": True,
        "message": f"누적손실 업데이트: ${accumulated_loss:,.2f}",
        "accumulated_loss": accumulated_loss,
        "magic": magic
    })


# ========== 데모 마틴 상태 업데이트 (단계 + 누적손실) ==========
@router.post("/martin/update-state")
async def update_demo_martin_state(
    step: int = 1,
    accumulated_loss: float = 0,
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """마틴 단계와 누적손실 업데이트 (magic별 독립 관리)"""
    state = get_or_create_martin_state(db, current_user.id, magic)
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


# ========== 데모 마틴 완전 리셋 ==========
@router.post("/martin/reset-full")
async def reset_demo_martin_full(
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """마틴 완전 초기화 (magic별 독립 관리)"""
    state = get_or_create_martin_state(db, current_user.id, magic)
    state.step = 1
    state.accumulated_loss = 0.0
    db.commit()

    return JSONResponse({
        "success": True,
        "message": "마틴 초기화 완료",
        "step": 1,
        "accumulated_loss": 0,
        "magic": magic
    })

# ========== 일괄 청산 ==========
@router.post("/close-all")
async def close_all_demo_positions(
    magic: int = None,
    symbol: str = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """모든 데모 포지션 일괄 청산 (magic + symbol 필터 옵션)"""
    query = db.query(DemoPosition).filter(
        DemoPosition.user_id == current_user.id
    )
    if magic is not None:
        query = query.filter(DemoPosition.magic == magic)
    if symbol is not None:
        query = query.filter(DemoPosition.symbol == symbol)
    positions = query.all()
    
    if not positions:
        return JSONResponse({"success": False, "message": "열린 포지션 없음"})

    total_profit = 0
    _running_bal = current_user.demo_balance or 10000.0
    closed_count = 0
    mt5_connected = MT5_AVAILABLE and mt5.initialize() if MT5_AVAILABLE else False

    for position in positions:
        entry_price = position.entry_price
        exit_price = entry_price
        profit = 0

        if mt5_connected:
            tick = mt5.symbol_info_tick(position.symbol)
            if tick:
                exit_price = tick.bid if position.trade_type == "BUY" else tick.ask

                symbol_info = mt5.symbol_info(position.symbol)
                if symbol_info and symbol_info.trade_tick_size > 0:
                    if position.trade_type == "BUY":
                        price_diff = exit_price - entry_price
                    else:
                        price_diff = entry_price - exit_price
                    ticks = price_diff / symbol_info.trade_tick_size
                    profit = ticks * symbol_info.trade_tick_value * position.volume
                else:
                    if position.trade_type == "BUY":
                        profit = (exit_price - entry_price) * position.volume
                    else:
                        profit = (entry_price - exit_price) * position.volume
        else:
            # MT5 없음 - bridge 기반 계산
            exit_price, profit = calculate_demo_profit(
                position.symbol, entry_price, position.trade_type, position.volume
            )

        profit = round(profit, 2)
        total_profit += profit

        # 거래 내역 저장
        trade = DemoTrade(
            user_id=current_user.id,
            symbol=position.symbol,
            trade_type=position.trade_type,
            volume=position.volume,
            entry_price=entry_price,
            exit_price=exit_price,
            profit=profit,
            is_closed=True,
            closed_at=datetime.now()
        )
        db.add(trade)
        db.flush()
        _bal_after = round(_running_bal + profit, 2)
        record_trade_transaction(db, current_user.id, trade.id, position.symbol, position.trade_type, profit, _running_bal, _bal_after)
        _running_bal = _bal_after
        db.delete(position)
        closed_count += 1

    # 잔고 업데이트
    current_user.demo_balance = (current_user.demo_balance or 10000.0) + total_profit
    current_user.demo_equity = current_user.demo_balance
    current_user.demo_today_profit = (current_user.demo_today_profit or 0.0) + total_profit

    db.commit()

    return JSONResponse({
        "success": True,
        "message": f"[DEMO] {closed_count}개 포지션 청산 완료! P/L: ${total_profit:+,.2f}",
        "closed_count": closed_count,
        "profit": total_profit,
        "new_balance": current_user.demo_balance
    })


# ========== 타입별 청산 (매수만/매도만) ==========
@router.post("/close-by-type")
async def close_demo_by_type(
    type: str = "BUY",
    magic: int = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """특정 타입(BUY/SELL) 포지션만 청산 (magic 필터 옵션)"""
    query = db.query(DemoPosition).filter(
        DemoPosition.user_id == current_user.id,
        DemoPosition.trade_type == type.upper()
    )
    if magic is not None:
        query = query.filter(DemoPosition.magic == magic)
    positions = query.all()
    
    if not positions:
        return JSONResponse({"success": False, "message": f"{type} 포지션 없음"})

    total_profit = 0
    _running_bal = current_user.demo_balance or 10000.0
    closed_count = 0
    mt5_connected = MT5_AVAILABLE and mt5.initialize() if MT5_AVAILABLE else False

    for position in positions:
        entry_price = position.entry_price
        exit_price = entry_price
        profit = 0

        if mt5_connected:
            tick = mt5.symbol_info_tick(position.symbol)
            if tick:
                exit_price = tick.bid if position.trade_type == "BUY" else tick.ask

                symbol_info = mt5.symbol_info(position.symbol)
                if symbol_info and symbol_info.trade_tick_size > 0:
                    if position.trade_type == "BUY":
                        price_diff = exit_price - entry_price
                    else:
                        price_diff = entry_price - exit_price
                    ticks = price_diff / symbol_info.trade_tick_size
                    profit = ticks * symbol_info.trade_tick_value * position.volume
                else:
                    if position.trade_type == "BUY":
                        profit = (exit_price - entry_price) * position.volume
                    else:
                        profit = (entry_price - exit_price) * position.volume
        else:
            # MT5 없음 - bridge 기반 계산
            exit_price, profit = calculate_demo_profit(
                position.symbol, entry_price, position.trade_type, position.volume
            )

        profit = round(profit, 2)
        total_profit += profit

        # 거래 내역 저장
        trade = DemoTrade(
            user_id=current_user.id,
            symbol=position.symbol,
            trade_type=position.trade_type,
            volume=position.volume,
            entry_price=entry_price,
            exit_price=exit_price,
            profit=profit,
            is_closed=True,
            closed_at=datetime.now()
        )
        db.add(trade)
        db.flush()
        _bal_after = round(_running_bal + profit, 2)
        record_trade_transaction(db, current_user.id, trade.id, position.symbol, position.trade_type, profit, _running_bal, _bal_after)
        _running_bal = _bal_after
        db.delete(position)
        closed_count += 1

    # 잔고 업데이트
    current_user.demo_balance = (current_user.demo_balance or 10000.0) + total_profit
    current_user.demo_equity = current_user.demo_balance
    current_user.demo_today_profit = (current_user.demo_today_profit or 0.0) + total_profit

    db.commit()

    return JSONResponse({
        "success": True,
        "message": f"[DEMO] {type} {closed_count}개 청산! P/L: ${total_profit:+,.2f}",
        "closed_count": closed_count,
        "profit": total_profit,
        "new_balance": current_user.demo_balance
    })


# ========== 손익별 청산 (수익만/손실만) ==========
@router.post("/close-by-profit")
async def close_demo_by_profit(
    profit_type: str = "positive",
    magic: int = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """수익/손실 포지션만 청산 (profit_type: positive/negative, magic 필터 옵션)"""
    query = db.query(DemoPosition).filter(
        DemoPosition.user_id == current_user.id
    )
    if magic is not None:
        query = query.filter(DemoPosition.magic == magic)
    positions = query.all()
    
    if not positions:
        return JSONResponse({"success": False, "message": "열린 포지션 없음"})

    mt5_connected = MT5_AVAILABLE and mt5.initialize() if MT5_AVAILABLE else False

    total_profit = 0
    _running_bal = current_user.demo_balance or 10000.0
    closed_count = 0

    for position in positions:
        entry_price = position.entry_price
        exit_price = entry_price
        profit = 0

        if mt5_connected:
            tick = mt5.symbol_info_tick(position.symbol)
            if tick:
                exit_price = tick.bid if position.trade_type == "BUY" else tick.ask

                # 손익 계산
                symbol_info = mt5.symbol_info(position.symbol)
                if symbol_info and symbol_info.trade_tick_size > 0:
                    if position.trade_type == "BUY":
                        price_diff = exit_price - entry_price
                    else:
                        price_diff = entry_price - exit_price
                    ticks = price_diff / symbol_info.trade_tick_size
                    profit = ticks * symbol_info.trade_tick_value * position.volume
                else:
                    if position.trade_type == "BUY":
                        profit = (exit_price - entry_price) * position.volume
                    else:
                        profit = (entry_price - exit_price) * position.volume

        profit = round(profit, 2)

        # 조건 체크: positive면 수익만, negative면 손실만
        if profit_type == "positive" and profit <= 0:
            continue
        if profit_type == "negative" and profit >= 0:
            continue

        total_profit += profit

        # 거래 내역 저장
        trade = DemoTrade(
            user_id=current_user.id,
            symbol=position.symbol,
            trade_type=position.trade_type,
            volume=position.volume,
            entry_price=entry_price,
            exit_price=exit_price,
            profit=profit,
            is_closed=True,
            closed_at=datetime.now()
        )
        db.add(trade)
        db.flush()
        _bal_after = round(_running_bal + profit, 2)
        record_trade_transaction(db, current_user.id, trade.id, position.symbol, position.trade_type, profit, _running_bal, _bal_after)
        _running_bal = _bal_after
        db.delete(position)
        closed_count += 1

    if closed_count == 0:
        msg = "수익 포지션 없음" if profit_type == "positive" else "손실 포지션 없음"
        return JSONResponse({"success": False, "message": msg})
    
    # 잔고 업데이트
    current_user.demo_balance = (current_user.demo_balance or 10000.0) + total_profit
    current_user.demo_equity = current_user.demo_balance
    current_user.demo_today_profit = (current_user.demo_today_profit or 0.0) + total_profit
    
    db.commit()
    
    type_name = "수익" if profit_type == "positive" else "손실"
    return JSONResponse({
        "success": True,
        "message": f"[DEMO] {type_name} {closed_count}개 청산! P/L: ${total_profit:+,.2f}",
        "closed_count": closed_count,
        "profit": total_profit,
        "new_balance": current_user.demo_balance
    })


# ========== Demo WebSocket ==========
@router.websocket("/ws")
async def demo_websocket_endpoint(websocket: WebSocket):
    """Demo 모드 실시간 데이터 WebSocket"""
    await websocket.accept()
    # ★ 모니터링: 데모 WS 접속 카운트
    try:
        from app.monitor_counters import ws_connect
        ws_connect("demo")
    except Exception:
        pass

    # Query parameter에서 토큰 + magic 가져오기
    token = websocket.query_params.get("token")
    magic = int(websocket.query_params.get("magic", 100001))
    user_id = None

    if token:
        try:
            payload = decode_token(token)
            if payload:
                user_id = int(payload.get("sub"))
                print(f"[DEMO WS] User {user_id} connected")
        except Exception as e:
            print(f"[DEMO WS] Token decode error: {e}")

    symbols_list = ["BTCUSD", "EURUSD.r", "USDJPY.r", "XAUUSD.r", "US100.", "GBPUSD.r", "AUDUSD.r", "USDCAD.r", "ETHUSD"]

    # ★★★ 히스토리 주기적 전송 (첫 연결 + 30초마다) ★★★
    _ws_loop_count = 0
    _last_history_time = 0

    while True:
        try:
            # ★★★ Phase 2: 클라이언트 메시지 수신 (심볼 변경) ★★★
            global indicator_symbol
            try:
                # Non-blocking receive with short timeout
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=0.05)
                data = json.loads(msg)
                if data.get("type") == "symbol_change":
                    new_symbol = data.get("symbol", "BTCUSD")
                    indicator_symbol = new_symbol
                    print(f"[DEMO WS] 🔄 Symbol changed to: {indicator_symbol}")
            except asyncio.TimeoutError:
                pass  # No message, continue
            except Exception:
                pass  # Ignore parse errors

            realtime = None  # ★ 추가
            # MT5 사용 가능 여부 체크
            mt5_connected = False
            if MT5_AVAILABLE and mt5 is not None:
                try:
                    mt5_connected = mt5.initialize()
                except:
                    mt5_connected = False

            # 인디케이터 분석 (★ 동적 심볼 사용)
            if mt5_connected:
                try:
                    indicators = IndicatorService.calculate_all_indicators(indicator_symbol)
                    buy_count = indicators["buy"]
                    sell_count = indicators["sell"]
                    neutral_count = indicators["neutral"]
                    base_score = indicators["score"]
                    # ★ Phase 2: 랜덤 변동 제거 - 백엔드 계산값 그대로 사용

                    print(f"[DEMO WS] 📊 Indicators ({indicator_symbol}) - Sell: {sell_count}, Neutral: {neutral_count}, Buy: {buy_count}, Score: {base_score:.1f}")
                except Exception as e:
                    print(f"[DEMO WS] ⚠️ Indicator calculation error: {e}")
                    # Bridge 캐시 기반 인디케이터 계산 (★ 동적 심볼)
                    indicators = calculate_indicators_from_bridge(indicator_symbol)
                    buy_count = indicators["buy"]
                    sell_count = indicators["sell"]
                    neutral_count = indicators["neutral"]
                    base_score = indicators["score"]
            else:
                from .metaapi_service import get_realtime_data
                realtime = get_realtime_data()
                realtime_indicators = realtime.get("indicators", {})
                buy_count = realtime_indicators.get("buy", 50)
                sell_count = realtime_indicators.get("sell", 30)
                neutral_count = realtime_indicators.get("neutral", 20)
                base_score = realtime_indicators.get("score", 50.0)

            # 모든 심볼 가격 정보
            all_prices = {}
            all_candles = {}

            if mt5_connected:
                for symbol in symbols_list:
                    tick = mt5.symbol_info_tick(symbol)
                    if tick:
                        all_prices[symbol] = {
                            "bid": tick.bid,
                            "ask": tick.ask,
                            "last": tick.last
                        }

                        # 최신 캔들 (1분봉 기준)
                        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 1)
                        if rates is not None and len(rates) > 0:
                            latest = rates[-1]
                            all_candles[symbol] = {
                                "time": int(latest["time"]),
                                "open": float(latest["open"]),
                                "high": float(latest["high"]),
                                "low": float(latest["low"]),
                                "close": float(latest["close"])
                            }
            else:
                if realtime is None:
                    from .metaapi_service import get_realtime_data
                    realtime = get_realtime_data()
                all_prices = realtime.get("prices", {})
                all_candles = realtime.get("candles", {})

                # MetaAPI도 비어있으면 브릿지 캐시 fallback
                if not all_prices:
                    all_prices = get_bridge_prices()

                # 브릿지 캐시도 비어있으면 → Binance API fallback
                if not all_prices:
                    all_prices = await fetch_external_prices()
                    print("[DEMO WS] 📡 Using Binance API fallback for prices")

                # 캔들도 비어있으면 → 현재 가격으로 합성 캔들 생성
                if not all_candles and all_prices:
                    current_time = int(time.time())
                    # 현재 분의 시작 시간 (60초 단위)
                    candle_time = current_time - (current_time % 60)
                    for symbol in symbols_list:
                        if symbol in all_prices:
                            price = all_prices[symbol].get("bid", 0)
                            if price > 0:
                                all_candles[symbol] = {
                                    "time": candle_time,
                                    "open": price,
                                    "high": price,
                                    "low": price,
                                    "close": price
                                }
                    print("[DEMO WS] 📡 Generated synthetic candles from prices")

            # Demo 계정 정보 (DB에서 실제 데이터 가져오기)
            demo_balance = 10000.0
            demo_equity = 10000.0
            demo_today_profit = 0.0  # ★ Today P/L 초기화
            demo_position = None
            positions_data = []
            positions_count = 0
            total_margin = 0.0
            total_profit = 0.0

            # ★★★ 자동청산 정보 - 유저별로 일정 시간 유지 ★★★
            # _auto_closed_cache[user_id] = {"info": {...}, "until": timestamp}
            if not hasattr(demo_websocket_endpoint, '_auto_closed_cache'):
                demo_websocket_endpoint._auto_closed_cache = {}

            auto_closed_info = None
            current_time = time.time()

            # 이전에 저장된 자동청산 정보가 있고 아직 유효하면 사용
            if user_id and user_id in demo_websocket_endpoint._auto_closed_cache:
                cached = demo_websocket_endpoint._auto_closed_cache[user_id]
                if current_time < cached.get("until", 0):
                    auto_closed_info = cached.get("info")
                else:
                    # 만료됨 - 삭제
                    del demo_websocket_endpoint._auto_closed_cache[user_id]

            if user_id:
                try:
                    # DB 세션 생성
                    from ..database import SessionLocal
                    db = SessionLocal()

                    try:
                        # 사용자 정보 조회
                        user = db.query(User).filter(User.id == user_id).first()
                        if user:
                            demo_balance = user.demo_balance or 10000.0
                            demo_equity = user.demo_equity or 10000.0
                            demo_today_profit = user.demo_today_profit or 0.0  # ★ Today P/L

                            # 열린 포지션들 조회 (다중 포지션)
                            positions = db.query(DemoPosition).filter(
                                DemoPosition.user_id == user_id
                            ).all()

                            positions_count = len(positions)

                            # 포지션들의 실시간 profit 계산 + 자동청산 체크
                            total_profit = 0.0
                            total_margin = 0.0  # 총 사용 마진
                            auto_closed_info = None  # 자동청산 정보

                            for pos in positions:
                                current_price = all_prices.get(pos.symbol)
                                entry = pos.entry_price
                                volume = pos.volume
                                profit = 0.0
                                current_px = entry  # 기본값

                                if current_price:
                                    current_px = current_price['bid'] if pos.trade_type == "BUY" else current_price['ask']

                                    # MT5 연결 시 정확한 손익 계산
                                    if mt5_connected:
                                        symbol_info = mt5.symbol_info(pos.symbol)
                                        if symbol_info and symbol_info.trade_tick_size > 0:
                                            if pos.trade_type == "BUY":
                                                price_diff = current_price['bid'] - entry
                                            else:
                                                price_diff = entry - current_price['ask']
                                            ticks = price_diff / symbol_info.trade_tick_size
                                            profit = ticks * symbol_info.trade_tick_value * volume
                                        else:
                                            if pos.trade_type == "BUY":
                                                profit = (current_price['bid'] - entry) * volume
                                            else:
                                                profit = (entry - current_price['ask']) * volume
                                    else:
                                        # MT5 없음 - bridge symbol_info 기반 계산
                                        sym_info = bridge_cache.get("symbol_info", {}).get(pos.symbol)
                                        if sym_info and sym_info.get('tick_size', 0) > 0 and sym_info.get('tick_value', 0) > 0:
                                            ts = sym_info['tick_size']
                                            tv = sym_info['tick_value']
                                            if pos.trade_type == "BUY":
                                                pd = current_price['bid'] - entry
                                            else:
                                                pd = entry - current_price['ask']
                                            profit = (pd / ts) * tv * volume
                                        else:
                                            specs = DEFAULT_SYMBOL_SPECS.get(pos.symbol, {"tick_size": 0.01, "tick_value": 0.01})
                                            ts = specs['tick_size']
                                            tv = specs['tick_value']
                                            if pos.trade_type == "BUY":
                                                pd = current_price['bid'] - entry
                                            else:
                                                pd = entry - current_price['ask']
                                            profit = (pd / ts) * tv * volume

                                profit = round(profit, 2)
                                target = pos.target_profit or 0

                                # ★★★ 자동청산 체크 (WS에서 실시간 처리) ★★★
                                should_close = False
                                is_win = False

                                if target > 0 and auto_closed_info is None:  # 아직 청산 안 됐을 때만
                                    # ★ B안: 가격 기반 청산 (tp_price/sl_price 우선)
                                    if pos.magic == 100003:  # Quick&Easy 디버그
                                        print(f"[QE-DEBUG] {pos.trade_type} current={current_px:.2f} TP={pos.tp_price:.2f} SL={pos.sl_price:.2f}")
                                    if pos.tp_price and pos.sl_price and current_px > 0:
                                        if pos.trade_type == "BUY":
                                            if current_px >= pos.tp_price:
                                                should_close = True
                                                is_win = True
                                                print(f"[DEMO WS] 🎯 BUY TP 도달! current={current_px} >= tp={pos.tp_price}")
                                            elif current_px <= pos.sl_price:
                                                should_close = True
                                                is_win = False
                                                print(f"[DEMO WS] 💔 BUY SL 도달! current={current_px} <= sl={pos.sl_price}")
                                        else:  # SELL
                                            if current_px <= pos.tp_price:
                                                should_close = True
                                                is_win = True
                                                print(f"[DEMO WS] 🎯 SELL TP 도달! current={current_px} <= tp={pos.tp_price}")
                                            elif current_px >= pos.sl_price:
                                                should_close = True
                                                is_win = False
                                                print(f"[DEMO WS] 💔 SELL SL 도달! current={current_px} >= sl={pos.sl_price}")
                                    else:
                                        # fallback: profit 기반 (tp_price 없는 기존 포지션)
                                        if profit >= target:  # WIN
                                            should_close = True
                                            is_win = True
                                            print(f"[DEMO WS] 🎯 Fallback WIN! Profit ${profit:.2f} >= Target ${target:.2f}")
                                        elif profit <= -target * 0.99:  # LOSE (99% 도달 시)
                                            should_close = True
                                            is_win = False
                                            print(f"[DEMO WS] 💔 Fallback LOSE! Profit ${profit:.2f} <= -Target*0.99 ${-target * 0.99:.2f}")

                                if should_close:
                                    # 자동청산 실행
                                    try:
                                        # ★★★ 마틴 상태 업데이트 (DemoMartinState) ★★★
                                        martin_state = get_or_create_martin_state(db, user.id, pos.magic)
                                        martin_step = martin_state.step
                                        martin_accumulated_loss = martin_state.accumulated_loss
                                        martin_reset = False
                                        martin_step_up = False

                                        if martin_state.enabled:
                                            # ★★★ DB 변경 안 함! 프론트 팝업에서 유저 선택 후 API로 처리 ★★★
                                            print(f"[DEMO WS] 마틴 상태 읽기만: step={martin_state.step}, acc_loss={martin_state.accumulated_loss}")

                                        # 거래 내역 저장
                                        trade = DemoTrade(
                                            user_id=user_id,
                                            symbol=pos.symbol,
                                            trade_type=pos.trade_type,
                                            volume=volume,
                                            entry_price=entry,
                                            exit_price=current_px,
                                            profit=profit,
                                            is_closed=True,
                                            closed_at=datetime.now()
                                        )
                                        db.add(trade)
                                        db.flush()
                                        _bal_bf = user.demo_balance or 10000.0
                                        record_trade_transaction(db, user_id, trade.id, pos.symbol, pos.trade_type, profit, _bal_bf, round(_bal_bf + profit, 2))

                                        # 잔고 업데이트
                                        user.demo_balance = (user.demo_balance or 10000.0) + profit
                                        user.demo_equity = user.demo_balance
                                        user.demo_today_profit = (user.demo_today_profit or 0.0) + profit

                                        # 포지션 삭제
                                        db.delete(pos)
                                        db.commit()

                                        # 자동청산 정보 저장 (응답에 포함)
                                        auto_closed_info = {
                                            "auto_closed": True,
                                            "closed_profit": profit,
                                            "is_win": is_win,
                                            "magic": pos.magic,  # ★ Quick&Easy 패널 연동용
                                            "message": f"🎯 목표 도달! +${profit:,.2f}" if is_win else f"💔 손절! ${profit:,.2f}",
                                            "closed_at": current_time,  # ★ 청산 시간 추가
                                            "martin_step": martin_step,
                                            "martin_accumulated_loss": martin_accumulated_loss,
                                            "martin_reset": martin_reset,
                                            "martin_step_up": martin_step_up
                                        }

                                        # ★★★ 3초 동안 자동청산 정보 유지 (프론트엔드가 놓치지 않도록) ★★★
                                        demo_websocket_endpoint._auto_closed_cache[user_id] = {
                                            "info": auto_closed_info,
                                            "until": current_time + 3  # 3초 동안 유지 (0.2초 간격 = 약 15회)
                                        }

                                        # 잔고 업데이트
                                        demo_balance = user.demo_balance
                                        positions_count -= 1

                                        print(f"[DEMO WS] ✅ Auto-closed position: {'WIN' if is_win else 'LOSE'} ${profit:.2f}")
                                        continue  # 다음 포지션으로

                                    except Exception as close_err:
                                        print(f"[DEMO WS] ❌ Auto-close error: {close_err}")
                                        db.rollback()

                                total_profit += profit

                                # 마진 계산
                                pos_margin = calculate_demo_margin(pos.symbol, volume, current_px)
                                total_margin += pos_margin

                                # 포지션 데이터 추가
                                pos_data = {
                                    "id": pos.id,
                                    "ticket": pos.id,
                                    "type": pos.trade_type,
                                    "symbol": pos.symbol,
                                    "volume": pos.volume,
                                    "entry": entry,
                                    "current": current_px,
                                    "profit": profit,
                                    "target": target,
                                    "margin": pos_margin,
                                    "magic": pos.magic,  # ★ 패널 구분용
                                    "tp_price": pos.tp_price,
                                    "sl_price": pos.sl_price,
                                    "opened_at": str(pos.created_at) if pos.created_at else "",
            "tp_price": pos.tp_price,
            "sl_price": pos.sl_price
                                }
                                positions_data.append(pos_data)

                                # ★★★ magic 일치 포지션만 패널에 표시 ★★★
                                if demo_position is None and pos.magic == magic:
                                    demo_position = pos_data

                            # Equity 업데이트
                            demo_equity = demo_balance + total_profit

                            print(f"[DEMO WS] 💼 User {user_id}: Balance=${demo_balance:.2f}, Positions={positions_count}, TotalProfit=${total_profit:.2f}")
                    finally:
                        db.close()

                except Exception as e:
                    print(f"[DEMO WS] ❌ DB fetch error: {e}")
                    import traceback
                    traceback.print_exc()

            data = {
                "broker": "Trading-X Markets",
                "account": user.demo_account_number if user else "DEMO",
                "balance": demo_balance,
                "equity": demo_equity,
                "free_margin": round(demo_balance - total_margin, 2),
                "margin": round(total_margin, 2),
                "current_pl": round(total_profit, 2),
                "today_pl": round(demo_today_profit, 2),  # ★ Today P/L 추가
                "leverage": 500,
                "positions_count": positions_count,
                "buy_count": buy_count,
                "sell_count": sell_count,
                "neutral_count": neutral_count,
                "base_score": base_score,
                "all_prices": all_prices,
                "all_candles": all_candles,
                "position": demo_position,
                "positions": positions_data
            }

            # ★★★ 히스토리 주기적 전송 (첫 연결 + 30초마다) ★★★
            _ws_loop_count += 1
            _should_send_history = (_ws_loop_count == 1) or (time.time() - _last_history_time >= 30)
            if _should_send_history and user_id:
                try:
                    from ..database import SessionLocal
                    hist_db = SessionLocal()
                    try:
                        trades = hist_db.query(DemoTrade).filter(
                            DemoTrade.user_id == user_id,
                            DemoTrade.is_closed == True
                        ).order_by(DemoTrade.closed_at.desc()).limit(50).all()

                        ws_history = []
                        for t in trades:
                            ws_history.append({
                                "id": t.id,
                                "symbol": t.symbol,
                                "type": t.trade_type,
                                "volume": t.volume,
                                "entry": t.entry_price,
                                "exit": t.exit_price,
                                "profit": t.profit,
                                "time": (t.closed_at + timedelta(hours=9)).strftime("%m/%d %H:%M") if t.closed_at else ""
                            })
                        data["history"] = ws_history
                        _last_history_time = time.time()
                        if _ws_loop_count == 1:
                            print(f"[DEMO WS] 📜 첫 연결 히스토리 전송: {len(ws_history)}건")
                    finally:
                        hist_db.close()
                except Exception as hist_err:
                    print(f"[DEMO WS] ⚠️ 히스토리 조회 오류: {hist_err}")

            # ★ 자동청산 정보가 있으면 응답에 포함
            if auto_closed_info:
                data.update(auto_closed_info)

            await websocket.send_text(json.dumps(data))
            await asyncio.sleep(0.2)  # ★ 0.2초 간격으로 실시간 업데이트 (손익 게이지 즉시 반영)

        except Exception as e:
            error_type = type(e).__name__
            error_msg = str(e) if str(e) else "No message"
            print(f"[DEMO WS] Error ({error_type}): {error_msg}")
            import traceback
            traceback.print_exc()
            break

    # ★ 모니터링: 데모 WS 해제 카운트
    try:
        from app.monitor_counters import ws_disconnect
        ws_disconnect("demo")
    except Exception:
        pass
    await websocket.close()
@router.get("/deposit-history")
async def get_deposit_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """입출금 내역 조회 (최근 6개월)"""
    from datetime import timedelta
    six_months_ago = datetime.now() - timedelta(days=180)

    # MetaAPI를 통한 실제 입출금 내역은 추후 연동
    # 현재는 빈 배열 반환 (더미 데이터 제거)
    history = []

    return {"history": history}


# ========== 데모 트레이딩 리포트 — Summary ==========
@router.get("/trading-report-summary")
async def get_demo_trading_report_summary(
    period: str = Query("week", description="조회 기간: today, week, month, 3month, custom"),
    start_date: str = Query(None, description="커스텀 시작일 (YYYY-MM-DD)"),
    end_date: str = Query(None, description="커스텀 종료일 (YYYY-MM-DD)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 트레이딩 리포트 Summary — 정방향 계산 + 앵커 기반 필터"""
    user_id = current_user.id

    # ★ 기간 설정
    now = _demo_kst_now()
    if period == "custom" and start_date and end_date:
        try:
            start_time = datetime.strptime(start_date, "%Y-%m-%d")
            end_time = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        except:
            start_time = now - timedelta(days=7)
            end_time = now
    elif period == "today":
        start_time = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end_time = now
    elif period == "week":
        start_time = now - timedelta(days=7)
        end_time = now
    elif period == "month":
        start_time = now - timedelta(days=30)
        end_time = now
    elif period == "3month":
        start_time = now - timedelta(days=90)
        end_time = now
    else:
        start_time = now - timedelta(days=365)
        end_time = now

    # ★ 계정 정보
    broker = "Trading-X Markets"
    account = current_user.demo_account_number or "-"
    current_balance = current_user.demo_balance or 10000.0

    # ★ 앵커 포인트 조회 (마지막 리셋 시점)
    anchor_time, anchor_balance = get_anchor_point(current_user)

    # ★ 서비스 함수로 거래 조회 (앵커 이후 + 기간 내)
    trades = get_filtered_trades(db, user_id, start_time, end_time, anchor_time)

    trade_profit = 0.0
    deal_count = len(trades)
    daily_pl = {}

    for t in trades:
        profit = t.profit or 0
        trade_profit += profit

        if t.closed_at:
            day_key = t.closed_at.strftime("%Y-%m-%d")
            if day_key not in daily_pl:
                daily_pl[day_key] = {"profit": 0, "swap": 0, "commission": 0, "total": 0}
            daily_pl[day_key]["profit"] += profit
            daily_pl[day_key]["total"] += profit

    # ★ 합산
    trade_profit = round(trade_profit, 2)
    total_pl = trade_profit
    total_swap = 0.0
    total_commission = 0.0

    # ★ 정방향 계산: 초기 금액
    initial_balance = get_period_initial_balance(
        db, user_id, start_time, anchor_time, anchor_balance
    )

    # ★ 순입금액 (기간 내 충전 합계)
    deposits = get_net_deposits(db, user_id, start_time, end_time, anchor_time)

    # ★ 수익률 = 거래 P/L / (초기금액 + 순입금) × 100
    invested = initial_balance + deposits
    return_rate = round((total_pl / invested * 100), 2) if invested > 0 else 0

    # ★ 일별 데이터 정렬 + 누적 계산
    sorted_daily = sorted(daily_pl.items())
    cumulative = 0
    daily_data = []
    for k, v in sorted_daily:
        cumulative += v["total"]
        daily_data.append({
            "date": k,
            "profit": round(v["profit"], 2),
            "swap": 0,
            "commission": 0,
            "total": round(v["total"], 2),
            "cumulative": round(cumulative, 2)
        })

    print(f"[DemoReport] User {user_id}: period={period}, deals={deal_count}, "
          f"trade_profit={trade_profit}, total_pl={total_pl}, "
          f"initial={initial_balance}(정방향), deposits={deposits}, "
          f"current={current_balance}, rate={return_rate}%")

    return {
        "broker": broker,
        "account": account,
        "initial_balance": initial_balance,
        "trade_profit": trade_profit,
        "swap": total_swap,
        "commission": total_commission,
        "total_pl": total_pl,
        "net_deposits": deposits,
        "current_balance": current_balance,
        "return_rate": return_rate,
        "deal_count": deal_count,
        "period": period,
        "start_date": start_time.strftime("%Y-%m-%d"),
        "end_date": end_time.strftime("%Y-%m-%d"),
        "daily_pl": daily_data
    }


# ========== 데모 트레이딩 리포트 — Analysis ==========
@router.get("/trading-report-analysis")
async def get_demo_trading_report_analysis(
    period: str = Query("week", description="조회 기간: today, week, month, 3month, custom"),
    start_date: str = Query(None, description="커스텀 시작일 (YYYY-MM-DD)"),
    end_date: str = Query(None, description="커스텀 종료일 (YYYY-MM-DD)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 트레이딩 리포트 분석 — 6개 카드 데이터 (DemoTrade 테이블 기반)"""
    user_id = current_user.id

    # ★ 기간 설정 (summary와 동일)
    now = _demo_kst_now()
    if period == "custom" and start_date and end_date:
        try:
            start_time = datetime.strptime(start_date, "%Y-%m-%d")
            end_time = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        except:
            start_time = now - timedelta(days=7)
            end_time = now
    elif period == "today":
        start_time = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end_time = now
    elif period == "week":
        start_time = now - timedelta(days=7)
        end_time = now
    elif period == "month":
        start_time = now - timedelta(days=30)
        end_time = now
    elif period == "3month":
        start_time = now - timedelta(days=90)
        end_time = now
    else:
        start_time = now - timedelta(days=365)
        end_time = now

    # ★ 앵커 기반 거래 조회 (리셋 이후 데이터만)
    anchor_time, anchor_balance = get_anchor_point(current_user)
    trades = get_filtered_trades(db, user_id, start_time, end_time, anchor_time)

    print(f"[ANALYSIS] User {user_id}: period={period}, anchor={anchor_time}, "
          f"start={start_time}, end={end_time}, trades={len(trades)}")

    # ★ 딜 데이터 가공
    closed_deals = []
    for t in trades:
        profit = round(t.profit or 0, 2)
        hour = -1
        time_str = ""
        if t.closed_at:
            kst_time = t.closed_at + timedelta(hours=9)  # UTC → KST
            hour = kst_time.hour
            time_str = kst_time.strftime("%m/%d")

        closed_deals.append({
            "symbol": t.symbol,
            "type": t.trade_type,
            "volume": t.volume or 0.01,
            "profit": profit,
            "raw_profit": profit,
            "hour": hour,
            "time_str": time_str
        })

    total_count = len(closed_deals)
    if total_count == 0:
        return {
            "total_count": 0, "period": period,
            "winrate": {}, "symbols": [], "buysell": {}, "hourly": {},
            "volume": {}, "risk": {}
        }

    # ═══════════════════════════════════════
    # 카드 1: 승률 분석
    # ═══════════════════════════════════════
    wins = [d for d in closed_deals if d["profit"] > 0]
    losses = [d for d in closed_deals if d["profit"] <= 0]
    win_count = len(wins)
    lose_count = len(losses)
    win_rate = round(win_count / total_count * 100, 1) if total_count > 0 else 0
    avg_win = round(sum(d["profit"] for d in wins) / win_count, 2) if win_count > 0 else 0
    avg_loss = round(sum(d["profit"] for d in losses) / lose_count, 2) if lose_count > 0 else 0
    rr_ratio = round(abs(avg_win / avg_loss), 2) if avg_loss != 0 else 0

    winrate_data = {
        "total": total_count, "win": win_count, "lose": lose_count,
        "rate": win_rate, "avg_win": avg_win, "avg_loss": avg_loss, "rr_ratio": rr_ratio
    }

    # ═══════════════════════════════════════
    # 카드 2: 종목별 분석
    # ═══════════════════════════════════════
    symbol_map = {}
    for d in closed_deals:
        s = d["symbol"]
        if s not in symbol_map:
            symbol_map[s] = {"count": 0, "wins": 0, "total_pl": 0, "volume": 0}
        symbol_map[s]["count"] += 1
        if d["profit"] > 0:
            symbol_map[s]["wins"] += 1
        symbol_map[s]["total_pl"] += d["profit"]
        symbol_map[s]["volume"] += d["volume"]

    symbols_data = []
    for s, v in sorted(symbol_map.items(), key=lambda x: abs(x[1]["total_pl"]), reverse=True):
        symbols_data.append({
            "symbol": s,
            "count": v["count"],
            "win_rate": round(v["wins"] / v["count"] * 100, 1) if v["count"] > 0 else 0,
            "total_pl": round(v["total_pl"], 2),
            "volume": round(v["volume"], 2)
        })

    # ═══════════════════════════════════════
    # 카드 3: Buy/Sell 분석
    # ═══════════════════════════════════════
    buys = [d for d in closed_deals if d["type"] == "BUY"]
    sells = [d for d in closed_deals if d["type"] == "SELL"]
    buy_wins = len([d for d in buys if d["profit"] > 0])
    sell_wins = len([d for d in sells if d["profit"] > 0])
    buy_pl = round(sum(d["profit"] for d in buys), 2)
    sell_pl = round(sum(d["profit"] for d in sells), 2)

    buysell_data = {
        "buy": {
            "count": len(buys),
            "win_rate": round(buy_wins / len(buys) * 100, 1) if buys else 0,
            "total_pl": buy_pl,
            "avg_pl": round(buy_pl / len(buys), 2) if buys else 0
        },
        "sell": {
            "count": len(sells),
            "win_rate": round(sell_wins / len(sells) * 100, 1) if sells else 0,
            "total_pl": sell_pl,
            "avg_pl": round(sell_pl / len(sells), 2) if sells else 0
        }
    }

    # ═══════════════════════════════════════
    # 카드 4: 시간대별 분석
    # ═══════════════════════════════════════
    hourly_map = {}
    for h in range(24):
        hourly_map[h] = {"count": 0, "total_pl": 0}
    for d in closed_deals:
        if 0 <= d["hour"] <= 23:
            hourly_map[d["hour"]]["count"] += 1
            hourly_map[d["hour"]]["total_pl"] += d["profit"]

    best_hour = max(hourly_map.items(), key=lambda x: x[1]["total_pl"])
    worst_hour = min(hourly_map.items(), key=lambda x: x[1]["total_pl"])

    hourly_data = {
        "hours": {str(k): {"count": v["count"], "pl": round(v["total_pl"], 2)} for k, v in hourly_map.items()},
        "best_hour": best_hour[0],
        "best_hour_pl": round(best_hour[1]["total_pl"], 2),
        "worst_hour": worst_hour[0],
        "worst_hour_pl": round(worst_hour[1]["total_pl"], 2)
    }

    # ═══════════════════════════════════════
    # 카드 5: 거래량 분석
    # ═══════════════════════════════════════
    volumes = [d["volume"] for d in closed_deals]
    total_vol = round(sum(volumes), 2)
    avg_vol = round(total_vol / total_count, 2) if total_count > 0 else 0
    max_vol_deal = max(closed_deals, key=lambda d: d["volume"])
    min_vol_deal = min(closed_deals, key=lambda d: d["volume"])

    volume_data = {
        "total": total_vol,
        "avg": avg_vol,
        "max": round(max_vol_deal["volume"], 2),
        "max_detail": f"{max_vol_deal['symbol']} {max_vol_deal['type']} · {max_vol_deal['time_str']}",
        "min": round(min_vol_deal["volume"], 2)
    }

    # ═══════════════════════════════════════
    # 카드 6: 리스크 지표
    # ═══════════════════════════════════════
    max_win_streak = 0; max_loss_streak = 0
    cur_win = 0; cur_loss = 0
    win_streak_pl = 0; loss_streak_pl = 0
    best_streak_pl = 0; worst_streak_pl = 0

    for d in closed_deals:
        if d["profit"] > 0:
            cur_win += 1
            win_streak_pl += d["profit"]
            if cur_win > max_win_streak:
                max_win_streak = cur_win
                best_streak_pl = win_streak_pl
            cur_loss = 0; loss_streak_pl = 0
        else:
            cur_loss += 1
            loss_streak_pl += d["profit"]
            if cur_loss > max_loss_streak:
                max_loss_streak = cur_loss
                worst_streak_pl = loss_streak_pl
            cur_win = 0; win_streak_pl = 0

    best_deal = max(closed_deals, key=lambda d: d["profit"])
    worst_deal = min(closed_deals, key=lambda d: d["profit"])

    gross_profit = sum(d["profit"] for d in closed_deals if d["profit"] > 0)
    gross_loss = abs(sum(d["profit"] for d in closed_deals if d["profit"] < 0))
    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else 0

    risk_data = {
        "max_win_streak": max_win_streak,
        "max_win_streak_pl": round(best_streak_pl, 2),
        "max_loss_streak": max_loss_streak,
        "max_loss_streak_pl": round(worst_streak_pl, 2),
        "best_deal_pl": round(best_deal["profit"], 2),
        "best_deal_detail": f"{best_deal['symbol']} · {best_deal['time_str']}",
        "worst_deal_pl": round(worst_deal["profit"], 2),
        "worst_deal_detail": f"{worst_deal['symbol']} · {worst_deal['time_str']}",
        "profit_factor": profit_factor
    }

    print(f"[DemoAnalysis] User {user_id}: period={period}, deals={total_count}, "
          f"winrate={win_rate}%, profit_factor={profit_factor}")

    return {
        "total_count": total_count,
        "period": period,
        "winrate": winrate_data,
        "symbols": symbols_data,
        "buysell": buysell_data,
        "hourly": hourly_data,
        "volume": volume_data,
        "risk": risk_data
    }

# app/api/metaapi_service.py
"""
MetaAPI 서비스 모듈
Trading-X Backend - MetaTrader5 Cloud API 연동
"""

import asyncio
import os
import time
import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from dotenv import load_dotenv

import json
from pathlib import Path

# ★ Redis 캐시 (병행 저장용)
try:
    from ..redis_client import set_price as redis_set_price, get_price as redis_get_price, get_all_prices as redis_get_all_prices, is_redis_available
    print("[MetaAPI] ✅ Redis client imported")
except ImportError:
    redis_set_price = None
    redis_get_price = None
    redis_get_all_prices = None
    is_redis_available = lambda: False
    print("[MetaAPI] ⚠️ Redis client not available — dict fallback only")

# ★ 캔들 캐시 파일 경로
CANDLE_CACHE_FILE = Path("/var/www/trading-x/backend/candle_cache.json")

# .env 로드
load_dotenv('/var/www/trading-x/.env')

# MetaAPI SDK
try:
    from metaapi_cloud_sdk import MetaApi
    METAAPI_AVAILABLE = True
except ImportError:
    MetaApi = None
    METAAPI_AVAILABLE = False
    print("[MetaAPI] SDK를 찾을 수 없습니다. pip install metaapi-cloud-sdk")


# ============================================================
# 전역 캐시 (WS에서 직접 접근용) - bridge_cache 대체
# ============================================================
quote_price_cache: Dict[str, Dict] = {}  # {"BTCUSD": {"bid": 70000, "ask": 70010}, ...}
quote_candle_cache: Dict[str, Dict[str, List]] = {}  # {"BTCUSD": {"M1": [...], "M5": [...]}, ...}
quote_last_update: float = 0
quote_connected: bool = False

# ★★★ 실시간 인디케이터 캐시 ★★★
indicator_cache: Dict[str, Dict] = {}  # {"BTCUSD": {"buy": 50, "sell": 30, "neutral": 20, "score": 60}}
indicator_base_cache: Dict[str, Dict] = {}  # 랜덤워크 기준값 캐시
last_tick_time: Dict[str, float] = {}  # 마지막 틱 시간 (랜덤워크 리셋용)

# ★★★ WS 브로드캐스트용 큐 ★★★
ws_broadcast_queue: List[Dict] = []
ws_clients: List = []  # WebSocket 클라이언트 목록

# ★★★ MetaAPI 실시간 동기화 캐시 ★★★
metaapi_positions_cache: List[Dict] = []  # 실시간 포지션 목록
metaapi_account_cache: Dict[str, Any] = {}  # 계정 정보 (balance, equity, margin 등)
metaapi_closed_events: List[Dict] = []  # 청산 이벤트 큐 (프론트에 알림용)
_initial_sync_complete = False  # ★ 초기 동기화 완료 플래그 (재시작 시 가짜 이벤트 방지)
_server_start_time = time.time()  # ★ 서버 시작 시간


def add_closed_event(position_id: str, symbol: str, profit: float, reason: str = 'closed'):
    """청산 이벤트 추가 (중복 방지)"""
    global metaapi_closed_events, _initial_sync_complete, _server_start_time

    # ★★★ 초기 동기화 완료 전에는 이벤트 무시 (서버 재시작 시 가짜 팝업 방지) ★★★
    if not _initial_sync_complete:
        elapsed = time.time() - _server_start_time
        if elapsed < 60:  # 서버 시작 후 60초 이내
            print(f"[MetaAPI] ⏳ 초기 동기화 중 - 청산 이벤트 무시: {symbol} P/L=${profit:.2f} (경과 {elapsed:.0f}초)")
            return False
        else:
            # 60초 지났으면 동기화 완료로 간주
            _initial_sync_complete = True
            print(f"[MetaAPI] ✅ 초기 동기화 완료 (60초 경과)")

    # 중복 체크: 같은 position_id가 이미 있으면 스킵
    for event in metaapi_closed_events:
        if event.get('position_id') == position_id:
            return False

    closed_event = {
        'position_id': position_id,
        'symbol': symbol,
        'profit': profit,
        'reason': reason,
        'timestamp': time.time()
    }
    metaapi_closed_events.append(closed_event)

    # 최근 100개만 유지
    if len(metaapi_closed_events) > 100:
        metaapi_closed_events.pop(0)

    return True


# ============================================================
# 설정
# ============================================================
METAAPI_TOKEN = os.environ.get('METAAPI_TOKEN')
QUOTE_ACCOUNT_ID = '265f13fb-26ae-4505-b13c-13339616c2a2'
TRADE_ACCOUNT_ID = 'ab8b3c02-5390-4d9a-b879-8b8c86f1ebf5'

# ★★★ 스마트 슬롯 관리 설정 ★★★
MAX_DEPLOYED_SLOTS = 300
SYSTEM_ACCOUNTS = [QUOTE_ACCOUNT_ID, TRADE_ACCOUNT_ID]
SLOT_WARN_RATIO = 0.70
SLOT_BUSY_RATIO = 0.85
SLOT_CRITICAL_RATIO = 0.90

# 지원 심볼
SYMBOLS = [
    'BTCUSD',
    'ETHUSD',
    'EURUSD.r',
    'USDJPY.r',
    'GBPUSD.r',
    'AUDUSD.r',
    'USDCAD.r',
    'XAUUSD.r',
    'US100.'
]

# 심볼 스펙 (P/L 계산용)
SYMBOL_SPECS = {
    "BTCUSD":   {"contract_size": 1,      "tick_size": 0.01,    "tick_value": 0.01,  "digits": 2},
    "ETHUSD":   {"contract_size": 1,      "tick_size": 0.01,    "tick_value": 0.01,  "digits": 2},
    "XAUUSD.r": {"contract_size": 100,    "tick_size": 0.01,    "tick_value": 1.0,   "digits": 2},
    "EURUSD.r": {"contract_size": 100000, "tick_size": 0.00001, "tick_value": 1.0,   "digits": 5},
    "USDJPY.r": {"contract_size": 100000, "tick_size": 0.001,   "tick_value": 0.67,  "digits": 3},
    "GBPUSD.r": {"contract_size": 100000, "tick_size": 0.00001, "tick_value": 1.0,   "digits": 5},
    "AUDUSD.r": {"contract_size": 100000, "tick_size": 0.00001, "tick_value": 1.0,   "digits": 5},
    "USDCAD.r": {"contract_size": 100000, "tick_size": 0.00001, "tick_value": 0.74,  "digits": 5},
    "US100.":   {"contract_size": 20,     "tick_size": 0.01,    "tick_value": 0.2,   "digits": 2},
}


# ============================================================
# 인디케이터 계산 함수 (demo.py 로직 이식)
# ============================================================

# 이전 점수 저장 (스무딩용)
_prev_signal_score = 50.0

# Synthetic 캔들 시가 캐시 (1분마다 갱신)
_synthetic_candle_cache = {
    "minute": 0,      # 현재 분 (unix timestamp // 60)
    "open_prices": {} # {symbol: open_price}
}


def calculate_indicators_from_bridge(symbol: str = "BTCUSD") -> Dict:
    """
    원칙 기반 시그널 게이지 (1분봉 캔들 기준) - demo.py에서 이식

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
    global quote_price_cache, quote_candle_cache, indicator_cache

    # 현재 tick 가격 가져오기 (quote_price_cache에서)
    price_data = quote_price_cache.get(symbol, {})
    current_tick = price_data.get("bid", 0)

    if current_tick <= 0:
        # 캐시에 이전 값이 있으면 반환
        if symbol in indicator_cache:
            return indicator_cache[symbol]
        return {"buy": 33, "sell": 33, "neutral": 34, "score": 50}

    # 1분봉 캔들 데이터 (quote_candle_cache에서)
    candles = quote_candle_cache.get(symbol, {}).get("M1", [])

    # 기본값
    candle_open = 0
    if candles and len(candles) >= 1:
        # 가장 최근 캔들의 open
        candle_open = candles[-1].get("open", 0)

    # 캔들이 없으면 synthetic 캔들 사용 (1분마다 시가 갱신)
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
    # ★★★ Buy+Sell+Neutral = 100 보장 (단순화) ★★★
    disp_neutral = 100 - disp_buy - disp_sell

    result = {
        "buy": disp_buy,
        "sell": disp_sell,
        "neutral": disp_neutral,
        "score": final_score
    }

    # 캐시 업데이트
    indicator_cache[symbol] = result
    return result


def calculate_indicators_base(symbol: str = "BTCUSD") -> Dict:
    """calculate_indicators_from_bridge 래퍼 (호환성)"""
    return calculate_indicators_from_bridge(symbol)


def calculate_indicators_realtime(symbol: str = "BTCUSD") -> Dict:
    """calculate_indicators_from_bridge 래퍼 (호환성)"""
    return calculate_indicators_from_bridge(symbol)


async def initialize_candles_from_api(account, symbol: str, timeframe: str = "M1", count: int = 100) -> bool:
    """
    MetaAPI에서 실제 과거 캔들 로딩
    account.get_historical_candles() 사용
    """
    global quote_candle_cache

    # 타임프레임 매핑
    tf_map = {
        "M1": "1m", "M5": "5m", "M15": "15m", "M30": "30m",
        "H1": "1h", "H4": "4h", "D1": "1d", "W1": "1w", "MN1": "1mn"
    }
    api_timeframe = tf_map.get(timeframe, "1m")

    try:
        # ★★★ 원래 방식 유지: 현재 시간 기준으로 과거 캔들 요청 ★★★
        end_time = datetime.now()

        print(f"[MetaAPI] {symbol}/{timeframe} 히스토리 캔들 요청 중... (limit={count})")

        # MetaAPI 히스토리 캔들 API 호출
        candles_data = await account.get_historical_candles(
            symbol=symbol,
            timeframe=api_timeframe,
            start_time=end_time,
            limit=count
        )

        if not candles_data or len(candles_data) == 0:
            print(f"[MetaAPI] {symbol} 히스토리 캔들 없음")
            return False

        # 캔들 변환 및 저장
        candles = []
        for c in candles_data:
            # datetime을 timestamp로 변환
            candle_time = c.get('time')
            if isinstance(candle_time, datetime):
                candle_time = int(candle_time.timestamp())
            elif isinstance(candle_time, str):
                candle_time = int(datetime.fromisoformat(candle_time.replace('Z', '+00:00')).timestamp())

            candles.append({
                'time': candle_time,
                'open': c.get('open', 0),
                'high': c.get('high', 0),
                'low': c.get('low', 0),
                'close': c.get('close', 0),
                'volume': c.get('tickVolume', 0) or c.get('volume', 0)
            })

        # 시간순 정렬 (오래된 것부터)
        candles.sort(key=lambda x: x['time'])

        if symbol not in quote_candle_cache:
            quote_candle_cache[symbol] = {}

        # ★★★ 기존 캐시와 병합 (갭 방지) ★★★
        existing = quote_candle_cache[symbol].get(timeframe, [])
        if existing:
            # 기존 캔들 + 새 캔들 합치고 time 기준 정렬 + 중복 제거
            merged = {c['time']: c for c in existing}
            for c in candles:
                merged[c['time']] = c  # 새 데이터가 우선
            candles = sorted(merged.values(), key=lambda x: x['time'])
            # 최대 개수 제한
            max_candles = _TF_CONFIG.get(timeframe, (1, 1500))[1]
            if len(candles) > max_candles:
                candles = candles[-max_candles:]
            print(f"[MetaAPI] ✅ {symbol}/{timeframe} 병합 완료: 기존 {len(existing)}개 + 신규 → {len(candles)}개")
        else:
            print(f"[MetaAPI] ✅ {symbol}/{timeframe} 히스토리 캔들 {len(candles)}개 로딩 완료")
        quote_candle_cache[symbol][timeframe] = candles

        # 첫 5개 캔들 출력 (검증용)
        if symbol == "BTCUSD" and len(candles) >= 5:
            print(f"[MetaAPI] {symbol} 캔들 첫 5개:")
            for i, c in enumerate(candles[:5]):
                print(f"  [{i}] time={c['time']} O={c['open']} H={c['high']} L={c['low']} C={c['close']}")

        return True

    except Exception as e:
        print(f"[MetaAPI] ❌ {symbol} 히스토리 캔들 로딩 실패: {e}")
        import traceback
        traceback.print_exc()
        return False


def initialize_candles_synthetic(symbol: str, current_price: float, count: int = 100):
    """
    [FALLBACK] 합성 캔들 생성 (현재가 기준으로 과거 캔들 100개 생성)
    MetaAPI 히스토리 API 실패 시에만 사용
    """
    global quote_candle_cache

    if current_price <= 0:
        return

    current_ts = int(time.time())
    candle_time = current_ts - (current_ts % 60)  # 1분 단위 정렬

    if symbol not in quote_candle_cache:
        quote_candle_cache[symbol] = {"M1": []}

    # 이미 캔들이 있으면 스킵
    if quote_candle_cache[symbol].get("M1") and len(quote_candle_cache[symbol]["M1"]) >= count:
        return

    # 심볼별 변동폭 설정 (대략적인 1분 변동폭)
    volatility = {
        "BTCUSD": 50.0,      # $50
        "ETHUSD": 5.0,       # $5
        "XAUUSD.r": 0.5,     # $0.5
        "EURUSD.r": 0.0003,  # 3 pips
        "USDJPY.r": 0.03,    # 3 pips
        "GBPUSD.r": 0.0003,  # 3 pips
        "AUDUSD.r": 0.0002,  # 2 pips
        "USDCAD.r": 0.0002,  # 2 pips
        "US100.": 5.0,       # 5 points
    }
    vol = volatility.get(symbol, current_price * 0.0005)  # 기본 0.05%

    candles = []
    price = current_price

    # 과거 캔들 생성 (오래된 것부터)
    for i in range(count, 0, -1):
        candle_ts = candle_time - (i * 60)  # 1분 간격

        # 랜덤 변동 (랜덤워크)
        change = random.uniform(-vol, vol)
        open_price = price
        close_price = price + change

        # high/low 계산
        if change >= 0:
            high_price = close_price + random.uniform(0, vol * 0.3)
            low_price = open_price - random.uniform(0, vol * 0.3)
        else:
            high_price = open_price + random.uniform(0, vol * 0.3)
            low_price = close_price - random.uniform(0, vol * 0.3)

        candles.append({
            'time': candle_ts,
            'open': round(open_price, 5),
            'high': round(high_price, 5),
            'low': round(low_price, 5),
            'close': round(close_price, 5),
            'volume': random.randint(100, 1000)
        })

        price = close_price  # 다음 캔들의 시작가

    quote_candle_cache[symbol]["M1"] = candles
    print(f"[MetaAPI] ⚠️ {symbol} 합성 캔들 {len(candles)}개 생성 (Fallback, 가격: {current_price:.2f})")


def initialize_candles(symbol: str, current_price: float, count: int = 100):
    """호환성 래퍼 - 동기 호출 시 합성 캔들 사용"""
    initialize_candles_synthetic(symbol, current_price, count)


# 타임프레임별 분 단위 + 최대 유지 개수
_TF_CONFIG = {
    "M1":  (1,     1500),
    "M5":  (5,     1500),
    "M15": (15,    1500),
    "M30": (30,    1500),
    "H1":  (60,    1500),
    "H4":  (240,   1500),
    "D1":  (1440,  1000),
    "W1":  (10080, 500),
    "MN1": (43200, 200),
}

# ★★★ 종목별 거래시간 스케줄 (MT5 서버시간 UTC+2/+3 기준) ★★★
_MARKET_SCHEDULE = {
    # 크립토: 일~금 00:02-23:57, 토 일부 세션
    "BTCUSD": {
        "sun": "00:02-23:57", "mon": "00:02-23:57", "tue": "00:02-23:57",
        "wed": "00:02-23:57", "thu": "00:02-23:57", "fri": "00:02-23:57",
        "sat": "00:02-09:30,12:30-14:00,15:00-23:57"
    },
    "ETHUSD": {
        "sun": "00:02-23:57", "mon": "00:02-23:57", "tue": "00:02-23:57",
        "wed": "00:02-23:57", "thu": "00:02-23:57", "fri": "00:02-23:57",
        "sat": "00:02-09:30,12:30-14:00,15:00-23:57"
    },
    # FX: 월~금 00:02-23:58
    "EURUSD.r": {"mon": "00:02-23:58", "tue": "00:02-23:58", "wed": "00:02-23:58", "thu": "00:02-23:58", "fri": "00:02-23:58"},
    "USDJPY.r": {"mon": "00:02-23:58", "tue": "00:02-23:58", "wed": "00:02-23:58", "thu": "00:02-23:58", "fri": "00:02-23:58"},
    "GBPUSD.r": {"mon": "00:02-23:58", "tue": "00:02-23:58", "wed": "00:02-23:58", "thu": "00:02-23:58", "fri": "00:02-23:58"},
    "GBPJPY.r": {"mon": "00:02-23:58", "tue": "00:02-23:58", "wed": "00:02-23:58", "thu": "00:02-23:58", "fri": "00:02-23:58"},
    "AUDUSD.r": {"mon": "00:02-23:58", "tue": "00:02-23:58", "wed": "00:02-23:58", "thu": "00:02-23:58", "fri": "00:02-23:58"},
    "USDCAD.r": {"mon": "00:02-23:58", "tue": "00:02-23:58", "wed": "00:02-23:58", "thu": "00:02-23:58", "fri": "00:02-23:58"},
    # 골드: 월~금 01:02-23:58 (금 23:55)
    "XAUUSD.r": {"mon": "01:02-23:58", "tue": "01:02-23:58", "wed": "01:02-23:58", "thu": "01:02-23:58", "fri": "01:02-23:55"},
    # 지수: 월~금 01:02-23:58 (금 23:55)
    "US100.": {"mon": "01:02-23:58", "tue": "01:02-23:58", "wed": "01:02-23:58", "thu": "01:02-23:58", "fri": "01:02-23:55"},
}

def _get_mt5_offset():
    """MT5 서버 시간 오프셋 (UTC+2 겨울, UTC+3 여름)"""
    now = datetime.now()
    year = now.year
    # 유럽 DST: 3월 마지막 일요일 ~ 10월 마지막 일요일
    import calendar
    mar_last = max(d for d in range(25, 32) if calendar.weekday(year, 3, d) == 6)
    oct_last = max(d for d in range(25, 32) if calendar.weekday(year, 10, d) == 6)
    dst_start = datetime(year, 3, mar_last, 1, 0, 0)  # UTC 기준
    dst_end = datetime(year, 10, oct_last, 1, 0, 0)
    return 3 if dst_start <= now.replace(tzinfo=None) < dst_end else 2

def _is_market_open(symbol: str) -> bool:
    """★ 종목별 거래시간 체크 (MT5 서버시간 기준)"""
    schedule = _MARKET_SCHEDULE.get(symbol)
    if not schedule:
        return True  # 스케줄 없으면 열린 것으로 간주

    # 현재 MT5 서버시간 계산
    offset = _get_mt5_offset()
    now_utc = datetime.utcnow()
    server_time = now_utc + timedelta(hours=offset)
    day_names = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
    day_key = day_names[server_time.weekday()]

    day_hours = schedule.get(day_key)
    if not day_hours:
        return False  # 해당 요일에 스케줄 없음 = 휴장

    current_min = server_time.hour * 60 + server_time.minute

    # 복수 세션 지원: "00:02-23:57,12:30-14:00"
    for session in day_hours.split(","):
        session = session.strip()
        parts = session.split("-")
        if len(parts) == 2:
            open_parts = parts[0].strip().split(":")
            close_parts = parts[1].strip().split(":")
            if len(open_parts) == 2 and len(close_parts) == 2:
                open_min = int(open_parts[0]) * 60 + int(open_parts[1])
                close_min = int(close_parts[0]) * 60 + int(close_parts[1])
                if open_min <= current_min <= close_min:
                    return True

    return False

# 동일가 감지용 카운터 (장 마감 보조 체크)
_same_price_counter = {}
_last_prices = {}


def update_candle_realtime(symbol: str, current_price: float):
    """실시간 캔들 업데이트 - 모든 타임프레임 동시 업데이트"""
    global quote_candle_cache, _same_price_counter, _last_prices

    if current_price <= 0:
        return

    # ★★★ 체크 1: 거래시간 스케줄 체크 (종목별 정확한 운영시간) ★★★
    if not _is_market_open(symbol):
        return  # 장 마감 → 캔들 생성 중단

    # ★★★ 체크 2: 동일가 연속 감지 (보조 안전장치) ★★★
    _now_price = round(current_price, 5)
    _prev_price = _last_prices.get(symbol)
    _last_prices[symbol] = _now_price

    if _prev_price is not None and _prev_price == _now_price:
        _same_price_counter[symbol] = _same_price_counter.get(symbol, 0) + 1
        if _same_price_counter[symbol] >= 60:  # 60회 연속 동일가 → 장 마감 추정
            return
    else:
        _same_price_counter[symbol] = 0

    current_ts = int(time.time())

    if symbol not in quote_candle_cache:
        quote_candle_cache[symbol] = {}

    for tf, (minutes, max_candles) in _TF_CONFIG.items():
        seconds = minutes * 60

        if tf not in quote_candle_cache[symbol]:
            quote_candle_cache[symbol][tf] = []

        candles = quote_candle_cache[symbol][tf]

        # ★ D1/W1/MN1: 히스토리 캔들의 시간 기준 유지 (MetaAPI=16:00/22:00 vs UTC=00:00 충돌 방지)
        if tf in ("D1", "W1", "MN1") and candles:
            last_time = candles[-1]['time']
            if current_ts < last_time + seconds:
                # 현재 캔들 기간 내 — OHLC 업데이트
                candles[-1]['close'] = current_price
                candles[-1]['high'] = max(candles[-1]['high'], current_price)
                candles[-1]['low'] = min(candles[-1]['low'], current_price)
            else:
                # 새 캔들 기간 — 히스토리 기준 시간으로 생성
                periods = (current_ts - last_time) // seconds
                new_time = last_time + periods * seconds
                candles.append({
                    'time': new_time,
                    'open': current_price,
                    'high': current_price,
                    'low': current_price,
                    'close': current_price,
                    'volume': 0
                })
                while len(candles) > max_candles:
                    candles.pop(0)
            continue

        # 기존 로직 (M1~H4)
        candle_time = (current_ts // seconds) * seconds

        if candles and candles[-1].get('time') == candle_time:
            candles[-1]['close'] = current_price
            candles[-1]['high'] = max(candles[-1]['high'], current_price)
            candles[-1]['low'] = min(candles[-1]['low'], current_price)
        else:
            new_candle = {
                'time': candle_time,
                'open': current_price,
                'high': current_price,
                'low': current_price,
                'close': current_price,
                'volume': 0
            }
            candles.append(new_candle)
            while len(candles) > max_candles:
                candles.pop(0)


# ============================================================
# 시세 스트리밍 리스너
# ============================================================
class QuotePriceListener:
    """시세 수신 리스너 (Streaming 연결용)"""

    async def on_symbol_price_updated(self, instance_index, price):
        """심볼 가격 업데이트 콜백 - 실시간 처리"""
        global quote_price_cache, quote_last_update, ws_broadcast_queue

        symbol = price.get('symbol')
        if symbol not in SYMBOLS:
            return

        # datetime을 timestamp로 변환
        price_time = price.get('time')
        if isinstance(price_time, datetime):
            price_time = int(price_time.timestamp())

        bid = price.get('bid')
        ask = price.get('ask')

        # 1. 시세 캐시 업데이트
        quote_price_cache[symbol] = {
            'bid': bid,
            'ask': ask,
            'time': price_time
        }
        quote_last_update = time.time()

        # ★ Redis 병행 저장
        try:
            if redis_set_price and bid and ask:
                redis_set_price(symbol, bid, ask)
        except Exception:
            pass

        # 2. 캔들 실시간 업데이트 (모든 심볼)
        if bid and bid > 0:
            update_candle_realtime(symbol, bid)
            # 디버그: XAUUSD 틱 수신 확인
            if symbol == "XAUUSD.r":
                print(f"[MetaAPI Tick] {symbol} bid={bid:.2f} ask={ask:.2f}")

        # 3. 인디케이터 기준값 재계산 (BTCUSD 기준) - 새 틱 도착 시 리셋
        if symbol == "BTCUSD":
            calculate_indicators_base("BTCUSD")

        # 4. WS 브로드캐스트 큐에 추가 (별도 태스크에서 처리)
        ws_broadcast_queue.append({
            'type': 'price_update',
            'symbol': symbol,
            'bid': bid,
            'ask': ask,
            'time': price_time
        })

    async def on_connected(self, instance_index, replicas):
        global quote_connected
        quote_connected = True
        print(f"[MetaAPI Quote] 연결됨 (instance: {instance_index})")

    async def on_disconnected(self, instance_index):
        global quote_connected
        quote_connected = False
        print(f"[MetaAPI Quote] 연결 해제됨 (instance: {instance_index})")

    async def on_broker_connection_status_changed(self, instance_index, connected):
        status = "연결됨" if connected else "연결 끊김"
        print(f"[MetaAPI Quote] 브로커 상태: {status}")

    # 필수 리스너 메서드들
    async def on_synchronization_started(self, instance_index, specifications_hash, positions_hash, orders_hash, synchronization_id):
        pass

    async def on_account_information_updated(self, instance_index, account_information):
        """계정 정보 업데이트 (balance, equity, margin 등)"""
        global metaapi_account_cache
        metaapi_account_cache = {
            'balance': account_information.get('balance', 0),
            'equity': account_information.get('equity', 0),
            'margin': account_information.get('margin', 0),
            'freeMargin': account_information.get('freeMargin', 0),
            'profit': account_information.get('profit', 0),
            'leverage': account_information.get('leverage', 0),
            'currency': account_information.get('currency', 'USD'),
            'updated_at': time.time()
        }
        print(f"[MetaAPI Listener] 📊 계정 업데이트: balance=${metaapi_account_cache['balance']:.2f}, equity=${metaapi_account_cache['equity']:.2f}, profit=${metaapi_account_cache['profit']:.2f}")

    async def on_positions_replaced(self, instance_index, positions):
        """전체 포지션 교체 (초기 동기화 시)"""
        global metaapi_positions_cache
        metaapi_positions_cache = []
        for pos in positions:
            metaapi_positions_cache.append({
                'id': pos.get('id'),
                'symbol': pos.get('symbol'),
                'type': pos.get('type'),  # 'POSITION_TYPE_BUY' or 'POSITION_TYPE_SELL'
                'volume': pos.get('volume', 0),
                'openPrice': pos.get('openPrice', 0),
                'currentPrice': pos.get('currentPrice', 0),
                'profit': pos.get('profit', 0),
                'stopLoss': pos.get('stopLoss', 0),
                'takeProfit': pos.get('takeProfit', 0),
                'magic': pos.get('magic', 0),
                'comment': pos.get('comment', ''),
                'time': pos.get('time')
            })
        print(f"[MetaAPI Listener] 🔄 포지션 전체 교체: {len(metaapi_positions_cache)}개")
        for pos in metaapi_positions_cache:
            print(f"    - {pos['symbol']} {pos['type']} {pos['volume']} lot, P/L: ${pos['profit']:.2f}")

    async def on_positions_synchronized(self, instance_index, synchronization_id):
        global _initial_sync_complete
        if not _initial_sync_complete:
            _initial_sync_complete = True
            print(f"[MetaAPI Listener] ✅ 초기 포지션 동기화 완료 - 청산 이벤트 감지 활성화")

    async def on_position_updated(self, instance_index, position):
        """포지션 업데이트 (신규 또는 기존 포지션 변경)"""
        global metaapi_positions_cache
        pos_id = position.get('id')
        pos_data = {
            'id': pos_id,
            'symbol': position.get('symbol'),
            'type': position.get('type'),
            'volume': position.get('volume', 0),
            'openPrice': position.get('openPrice', 0),
            'currentPrice': position.get('currentPrice', 0),
            'profit': position.get('profit', 0),
            'stopLoss': position.get('stopLoss', 0),
            'takeProfit': position.get('takeProfit', 0),
            'magic': position.get('magic', 0),
            'comment': position.get('comment', ''),
            'time': position.get('time')
        }

        # 기존 포지션 찾아서 업데이트
        found = False
        for i, existing in enumerate(metaapi_positions_cache):
            if existing.get('id') == pos_id:
                metaapi_positions_cache[i] = pos_data
                found = True
                break

        if not found:
            # 새 포지션 추가
            metaapi_positions_cache.append(pos_data)
            print(f"[MetaAPI Listener] ➕ 포지션 추가: {pos_data['symbol']} {pos_data['type']} {pos_data['volume']} lot @ {pos_data['openPrice']}")
        else:
            print(f"[MetaAPI Listener] 📝 포지션 업데이트: {pos_data['symbol']} P/L: ${pos_data['profit']:.2f} SL={pos_data['stopLoss']} TP={pos_data['takeProfit']}")

    async def on_position_removed(self, instance_index, position_id):
        """포지션 제거 (청산됨)"""
        global metaapi_positions_cache, metaapi_closed_events

        # 캐시에서 해당 포지션 찾기
        removed_pos = None
        for i, pos in enumerate(metaapi_positions_cache):
            if pos.get('id') == position_id:
                removed_pos = metaapi_positions_cache.pop(i)
                break

        if removed_pos:
            # 청산 이벤트 추가 (중복 방지)
            if add_closed_event(position_id, removed_pos.get('symbol'), removed_pos.get('profit', 0)):
                print(f"[MetaAPI Listener] ❌ 포지션 종료: {removed_pos['symbol']} {removed_pos['type']} {removed_pos['volume']} lot, P/L: ${removed_pos['profit']:.2f}")
        else:
            print(f"[MetaAPI Listener] ❌ 포지션 종료: id={position_id} (캐시에 없음, 중복?)")
    async def on_pending_orders_replaced(self, instance_index, orders):
        pass
    async def on_pending_orders_synchronized(self, instance_index, synchronization_id):
        pass
    async def on_order_updated(self, instance_index, order):
        pass
    async def on_order_completed(self, instance_index, order_id):
        pass
    async def on_orders_replaced(self, instance_index, orders):
        pass
    async def on_orders_synchronized(self, instance_index, synchronization_id):
        pass
    async def on_history_order_added(self, instance_index, history_order):
        pass
    async def on_deal_added(self, instance_index, deal):
        """거래 추가 (청산 거래 감지)"""
        # DEAL_ENTRY_OUT = 청산 거래
        if deal.get('entryType') == 'DEAL_ENTRY_OUT':
            if add_closed_event(deal.get('positionId'), deal.get('symbol'), deal.get('profit', 0)):
                print(f"[MetaAPI Listener] 💰 포지션 종료 (Deal): {deal.get('symbol')} P/L: ${deal.get('profit', 0):.2f}")
    async def on_deal_synchronization_finished(self, instance_index, synchronization_id):
        pass
    async def on_order_synchronization_finished(self, instance_index, synchronization_id):
        pass
    async def on_symbol_specifications_updated(self, instance_index, specifications, removed_symbols):
        pass
    async def on_symbol_specification_updated(self, instance_index, specification):
        pass
    async def on_symbol_prices_updated(self, instance_index, prices, equity, margin, free_margin, margin_level, account_currency_exchange_rate):
        pass
    async def on_health_status(self, instance_index, status):
        pass
    async def on_history_orders_synchronized(self, instance_index, synchronization_id):
        pass
    async def on_deals_synchronized(self, instance_index, synchronization_id):
        pass


# ============================================================
# Trade 계정 동기화 리스너 (포지션/계정 업데이트 수신)
# ============================================================
class TradeSyncListener:
    """Trade 계정 실시간 동기화 리스너"""

    async def on_connected(self, instance_index, replicas):
        print(f"[MetaAPI Trade] 🟢 연결됨 (instance: {instance_index})")

    async def on_disconnected(self, instance_index):
        print(f"[MetaAPI Trade] 🔴 연결 해제됨")

    async def on_account_information_updated(self, instance_index, account_information):
        """계정 정보 업데이트"""
        global metaapi_account_cache
        metaapi_account_cache = {
            'balance': account_information.get('balance', 0),
            'equity': account_information.get('equity', 0),
            'margin': account_information.get('margin', 0),
            'freeMargin': account_information.get('freeMargin', 0),
            'profit': account_information.get('profit', 0),
            'leverage': account_information.get('leverage', 0),
            'currency': account_information.get('currency', 'USD'),
            'updated_at': time.time()
        }
        print(f"[MetaAPI Trade] 📊 계정: balance=${metaapi_account_cache['balance']:.2f}, equity=${metaapi_account_cache['equity']:.2f}, P/L=${metaapi_account_cache['profit']:.2f}")

    async def on_positions_replaced(self, instance_index, positions):
        """전체 포지션 교체"""
        global metaapi_positions_cache
        metaapi_positions_cache = []
        for pos in positions:
            metaapi_positions_cache.append({
                'id': pos.get('id'),
                'symbol': pos.get('symbol'),
                'type': pos.get('type'),
                'volume': pos.get('volume', 0),
                'openPrice': pos.get('openPrice', 0),
                'currentPrice': pos.get('currentPrice', 0),
                'profit': pos.get('profit', 0),
                'stopLoss': pos.get('stopLoss', 0),
                'takeProfit': pos.get('takeProfit', 0),
                'magic': pos.get('magic', 0),
                'comment': pos.get('comment', ''),
                'time': pos.get('time')
            })
        print(f"[MetaAPI Trade] 🔄 포지션 동기화: {len(metaapi_positions_cache)}개")

    async def on_position_updated(self, instance_index, position):
        """포지션 업데이트/추가"""
        global metaapi_positions_cache
        pos_id = position.get('id')
        pos_data = {
            'id': pos_id,
            'symbol': position.get('symbol'),
            'type': position.get('type'),
            'volume': position.get('volume', 0),
            'openPrice': position.get('openPrice', 0),
            'currentPrice': position.get('currentPrice', 0),
            'profit': position.get('profit', 0),
            'stopLoss': position.get('stopLoss', 0),
            'takeProfit': position.get('takeProfit', 0),
            'magic': position.get('magic', 0),
            'comment': position.get('comment', ''),
            'time': position.get('time')
        }

        found = False
        for i, existing in enumerate(metaapi_positions_cache):
            if existing.get('id') == pos_id:
                metaapi_positions_cache[i] = pos_data
                found = True
                break

        if not found:
            metaapi_positions_cache.append(pos_data)
            print(f"[MetaAPI Trade] ➕ 새 포지션: {pos_data['symbol']} {pos_data['type']} {pos_data['volume']} lot")
        else:
            print(f"[MetaAPI Trade] 📝 포지션 업데이트: {pos_data['symbol']} P/L=${pos_data['profit']:.2f} SL={pos_data['stopLoss']} TP={pos_data['takeProfit']}")

    async def on_position_removed(self, instance_index, position_id):
        """포지션 청산"""
        global metaapi_positions_cache

        removed_pos = None
        for i, pos in enumerate(metaapi_positions_cache):
            if pos.get('id') == position_id:
                removed_pos = metaapi_positions_cache.pop(i)
                break

        if removed_pos:
            if add_closed_event(position_id, removed_pos.get('symbol'), removed_pos.get('profit', 0)):
                print(f"[MetaAPI Trade] ❌ 포지션 종료: {removed_pos['symbol']} P/L=${removed_pos['profit']:.2f}")
        else:
            print(f"[MetaAPI Trade] ❌ 포지션 종료: id={position_id} (중복?)")

    # 필수 빈 메서드들
    async def on_synchronization_started(self, instance_index, specifications_hash, positions_hash, orders_hash, synchronization_id):
        print(f"[MetaAPI Trade] 🔄 동기화 시작...")
    async def on_positions_synchronized(self, instance_index, synchronization_id):
        global _initial_sync_complete
        if not _initial_sync_complete:
            _initial_sync_complete = True
            print(f"[MetaAPI Trade] ✅ 초기 포지션 동기화 완료 - 청산 이벤트 감지 활성화")
        print(f"[MetaAPI Trade] ✅ 포지션 동기화 완료")
    async def on_broker_connection_status_changed(self, instance_index, connected):
        print(f"[MetaAPI Trade] 브로커: {'연결됨' if connected else '연결 끊김'}")
    async def on_pending_orders_replaced(self, instance_index, orders):
        pass
    async def on_pending_orders_synchronized(self, instance_index, synchronization_id):
        pass
    async def on_order_updated(self, instance_index, order):
        pass
    async def on_order_completed(self, instance_index, order_id):
        pass
    async def on_orders_replaced(self, instance_index, orders):
        pass
    async def on_orders_synchronized(self, instance_index, synchronization_id):
        pass
    async def on_history_order_added(self, instance_index, history_order):
        pass
    async def on_deal_added(self, instance_index, deal):
        """거래 추가 (청산 거래 감지)"""
        # DEAL_ENTRY_OUT = 청산 거래
        if deal.get('entryType') == 'DEAL_ENTRY_OUT':
            if add_closed_event(deal.get('positionId'), deal.get('symbol'), deal.get('profit', 0)):
                print(f"[MetaAPI Trade] 💰 포지션 종료 (Deal): {deal.get('symbol')} P/L: ${deal.get('profit', 0):.2f}")
    async def on_deal_synchronization_finished(self, instance_index, synchronization_id):
        pass
    async def on_order_synchronization_finished(self, instance_index, synchronization_id):
        pass
    async def on_symbol_specifications_updated(self, instance_index, specifications, removed_symbols):
        pass
    async def on_symbol_specification_updated(self, instance_index, specification):
        pass
    async def on_symbol_prices_updated(self, instance_index, prices, equity, margin, free_margin, margin_level, account_currency_exchange_rate):
        pass
    async def on_health_status(self, instance_index, status):
        pass
    async def on_symbol_price_updated(self, instance_index, price):
        pass  # Trade 계정에서는 시세 무시
    async def on_history_orders_synchronized(self, instance_index, synchronization_id):
        pass
    async def on_deals_synchronized(self, instance_index, synchronization_id):
        pass
    async def on_positions_updated(self, instance_index, updated_positions, removed_position_ids):
        """포지션 일괄 업데이트 (여러 포지션 동시 변경)"""
        global metaapi_positions_cache, metaapi_closed_events

        # 업데이트된 포지션 처리
        for pos in updated_positions:
            pos_id = pos.get('id')
            pos_data = {
                'id': pos_id,
                'symbol': pos.get('symbol'),
                'type': pos.get('type'),
                'volume': pos.get('volume', 0),
                'openPrice': pos.get('openPrice', 0),
                'currentPrice': pos.get('currentPrice', 0),
                'profit': pos.get('profit', 0),
                'stopLoss': pos.get('stopLoss', 0),
                'takeProfit': pos.get('takeProfit', 0),
                'magic': pos.get('magic', 0),
                'comment': pos.get('comment', ''),
                'time': pos.get('time')
            }

            found = False
            for i, existing in enumerate(metaapi_positions_cache):
                if existing.get('id') == pos_id:
                    metaapi_positions_cache[i] = pos_data
                    found = True
                    break

            if not found:
                metaapi_positions_cache.append(pos_data)

        # 제거된 포지션 처리
        for pos_id in removed_position_ids:
            for i, pos in enumerate(metaapi_positions_cache):
                if pos.get('id') == pos_id:
                    removed_pos = metaapi_positions_cache.pop(i)
                    if add_closed_event(pos_id, removed_pos.get('symbol'), removed_pos.get('profit', 0)):
                        print(f"[MetaAPI Trade] ❌ 포지션 종료: {removed_pos.get('symbol')} P/L=${removed_pos.get('profit', 0):.2f}")
                    break


# ============================================================
# MetaAPI 서비스 클래스
# ============================================================
class MetaAPIService:
    """MetaAPI 연동 서비스"""

    def __init__(self):
        self.api: Optional[MetaApi] = None
        self.quote_account = None
        self.trade_account = None
        self.quote_connection = None
        self.trade_connection = None  # RPC 연결 (주문용)
        self.trade_streaming = None   # Streaming 연결 (실시간 동기화용)
        self._initialized = False
        self._connecting = False
        self._price_loop_task = None
        self._sync_task = None  # 포지션 동기화 태스크
        self._quote_listener = None
        self._trade_listener = None

        # 시세 캐시
        self.price_cache: Dict[str, Dict] = {}
        self.last_price_update: float = 0

    async def initialize(self) -> bool:
        """MetaAPI 초기화"""
        if not METAAPI_AVAILABLE:
            print("[MetaAPI] SDK 미설치")
            return False

        if not METAAPI_TOKEN:
            print("[MetaAPI] API 토큰 없음")
            return False

        if self._initialized:
            return True

        try:
            self.api = MetaApi(METAAPI_TOKEN)
            self._initialized = True
            print("[MetaAPI] 초기화 완료")
            return True
        except Exception as e:
            print(f"[MetaAPI] 초기화 실패: {e}")
            return False

    async def connect_quote_account(self) -> bool:
        """Quote 계정 연결 (시세 수신용)"""
        global quote_connected
        if not await self.initialize():
            return False

        try:
            self.quote_account = await self.api.metatrader_account_api.get_account(QUOTE_ACCOUNT_ID)

            if self.quote_account.state != 'DEPLOYED':
                await self.quote_account.deploy()

            await self.quote_account.wait_connected()

            # Streaming 연결 (시세용)
            self.quote_connection = self.quote_account.get_streaming_connection()

            # 리스너 등록
            self._quote_listener = QuotePriceListener()
            self.quote_connection.add_synchronization_listener(self._quote_listener)

            await self.quote_connection.connect()
            await self.quote_connection.wait_synchronized()

            # 심볼 구독
            for symbol in SYMBOLS:
                try:
                    await self.quote_connection.subscribe_to_market_data(symbol)
                    print(f"[MetaAPI Quote] {symbol} 구독 완료")
                except Exception as e:
                    print(f"[MetaAPI Quote] {symbol} 구독 실패: {e}")

            quote_connected = True
            print(f"[MetaAPI] Quote 계정 연결 완료: {QUOTE_ACCOUNT_ID}")
            return True

        except Exception as e:
            quote_connected = False
            print(f"[MetaAPI] Quote 계정 연결 실패: {e}")
            return False

    async def connect_trade_account(self) -> bool:
        """Trade 계정 연결 (거래 + 실시간 동기화)"""
        if not await self.initialize():
            return False

        try:
            self.trade_account = await self.api.metatrader_account_api.get_account(TRADE_ACCOUNT_ID)

            if self.trade_account.state != 'DEPLOYED':
                await self.trade_account.deploy()

            await self.trade_account.wait_connected()

            # 1. RPC 연결 (주문 실행용)
            self.trade_connection = self.trade_account.get_rpc_connection()
            await self.trade_connection.connect()
            await self.trade_connection.wait_synchronized()
            print(f"[MetaAPI] Trade RPC 연결 완료")

            # 2. Streaming 연결 (실시간 동기화용)
            self.trade_streaming = self.trade_account.get_streaming_connection()
            self._trade_listener = TradeSyncListener()
            self.trade_streaming.add_synchronization_listener(self._trade_listener)
            await self.trade_streaming.connect()
            await self.trade_streaming.wait_synchronized()
            print(f"[MetaAPI] Trade Streaming 연결 완료 (실시간 동기화 활성화)")

            print(f"[MetaAPI] Trade 계정 연결 완료: {TRADE_ACCOUNT_ID}")
            return True

        except Exception as e:
            print(f"[MetaAPI] Trade 계정 연결 실패: {e}")
            return False

    async def disconnect(self):
        """모든 연결 종료"""
        try:
            if self.quote_connection:
                await self.quote_connection.close()
                self.quote_connection = None

            if self.trade_connection:
                await self.trade_connection.close()
                self.trade_connection = None

            if self.trade_streaming:
                await self.trade_streaming.close()
                self.trade_streaming = None

            print("[MetaAPI] 연결 종료 완료")
        except Exception as e:
            print(f"[MetaAPI] 연결 종료 오류: {e}")

    # ============================================================
    # 시세 조회
    # ============================================================
    async def get_price(self, symbol: str) -> Optional[Dict]:
        """단일 심볼 시세 조회"""
        if not self.trade_connection:
            if not await self.connect_trade_account():
                return None

        try:
            price = await self.trade_connection.get_symbol_price(symbol)
            return {
                'symbol': symbol,
                'bid': price.get('bid'),
                'ask': price.get('ask'),
                'time': price.get('time')
            }
        except Exception as e:
            print(f"[MetaAPI] 시세 조회 실패 ({symbol}): {e}")
            return None

    async def get_all_prices(self) -> Dict[str, Dict]:
        """모든 심볼 시세 조회"""
        global quote_price_cache, quote_last_update

        if not self.trade_connection:
            if not await self.connect_trade_account():
                return {}

        prices = {}
        for symbol in SYMBOLS:
            try:
                price = await self.trade_connection.get_symbol_price(symbol)
                # datetime을 timestamp로 변환
                price_time = price.get('time')
                if isinstance(price_time, datetime):
                    price_time = int(price_time.timestamp())

                prices[symbol] = {
                    'bid': price.get('bid'),
                    'ask': price.get('ask'),
                    'time': price_time
                }
            except Exception as e:
                print(f"[MetaAPI] 시세 조회 실패 ({symbol}): {e}")

        self.price_cache = prices
        self.last_price_update = time.time()

        # 전역 캐시 업데이트
        quote_price_cache = prices
        quote_last_update = self.last_price_update

        # ★ Redis 병행 저장 (전체 시세)
        try:
            if redis_set_price:
                for _sym, _pd in prices.items():
                    if _pd.get('bid') and _pd.get('ask'):
                        redis_set_price(_sym, _pd['bid'], _pd['ask'])
        except Exception:
            pass

        # ★★★ 모든 심볼 캔들 실시간 업데이트 ★★★
        for symbol, price_data in prices.items():
            bid = price_data.get('bid', 0)
            if bid and bid > 0:
                update_candle_realtime(symbol, bid)

        return prices

    async def get_candles(self, symbol: str, timeframe: str = "M1", count: int = 100) -> List[Dict]:
        """캔들 데이터 조회 - 캐시에서 직접 반환 (모든 TF가 실시간 업데이트됨)"""
        global quote_candle_cache
        try:
            candles = quote_candle_cache.get(symbol, {}).get(timeframe, [])
            if candles:
                return candles[-count:]
            return []
        except Exception as e:
            print(f"[MetaAPI] 캔들 조회 실패 ({symbol} {timeframe}): {e}")
            return []

    async def update_all_candles(self, timeframe: str = "M1"):
        """모든 심볼 캔들 업데이트"""
        for symbol in SYMBOLS:
            await self.get_candles(symbol, timeframe, 100)

    async def start_price_update_loop(self, interval: float = 1.0):
        """시세 업데이트 백그라운드 루프 시작"""
        global quote_price_cache, quote_last_update, quote_connected

        if self._price_loop_task:
            return  # 이미 실행 중

        async def _loop():
            while True:
                try:
                    if self.trade_connection:
                        await self.get_all_prices()
                        quote_connected = True

                        # ★ 폴링 백업: 모든 심볼 캔들도 업데이트
                        for symbol, price_data in quote_price_cache.items():
                            bid = price_data.get('bid', 0)
                            if bid and bid > 0:
                                update_candle_realtime(symbol, bid)
                    else:
                        # 연결 시도
                        if await self.connect_trade_account():
                            await self.get_all_prices()
                except Exception as e:
                    print(f"[MetaAPI] 시세 루프 오류: {e}")
                    quote_connected = False

                await asyncio.sleep(interval)

        self._price_loop_task = asyncio.create_task(_loop())
        print("[MetaAPI] 시세 업데이트 루프 시작")

    async def start_position_sync_loop(self, interval: float = 30.0):
        """포지션 동기화 백그라운드 루프 (30초 주기)"""
        global metaapi_positions_cache, metaapi_account_cache

        if self._sync_task:
            return  # 이미 실행 중

        async def _sync_loop():
            while True:
                try:
                    await asyncio.sleep(interval)  # 첫 실행 전 대기

                    if not self.trade_connection:
                        continue

                    # 1. 실제 MT5 포지션 조회
                    mt5_positions = await self.trade_connection.get_positions()
                    mt5_pos_ids = {pos.get('id') for pos in mt5_positions}

                    # 2. 캐시 포지션 ID
                    cache_pos_ids = {pos.get('id') for pos in metaapi_positions_cache}

                    # 3. 캐시에 있는데 MT5에 없는 포지션 → 청산됨
                    closed_ids = cache_pos_ids - mt5_pos_ids
                    for pos_id in closed_ids:
                        for i, pos in enumerate(metaapi_positions_cache):
                            if pos.get('id') == pos_id:
                                removed_pos = metaapi_positions_cache.pop(i)
                                if add_closed_event(pos_id, removed_pos.get('symbol'), removed_pos.get('profit', 0)):
                                    print(f"[MetaAPI Sync] 청산 감지: {removed_pos.get('symbol')} P/L=${removed_pos.get('profit', 0):.2f}")
                                break

                    # 4. MT5에 있는데 캐시에 없는 포지션 → 추가
                    new_ids = mt5_pos_ids - cache_pos_ids
                    for pos in mt5_positions:
                        if pos.get('id') in new_ids:
                            metaapi_positions_cache.append({
                                'id': pos.get('id'),
                                'symbol': pos.get('symbol'),
                                'type': pos.get('type'),
                                'volume': pos.get('volume', 0),
                                'openPrice': pos.get('openPrice', 0),
                                'currentPrice': pos.get('currentPrice', 0),
                                'profit': pos.get('profit', 0),
                                'stopLoss': pos.get('stopLoss', 0),
                                'takeProfit': pos.get('takeProfit', 0),
                                'magic': pos.get('magic', 0),
                                'comment': pos.get('comment', ''),
                                'time': pos.get('time')
                            })
                            print(f"[MetaAPI Sync] 포지션 추가: {pos.get('symbol')} {pos.get('type')}")

                    # 5. 계정 정보 동기화
                    account_info = await self.trade_connection.get_account_information()
                    if account_info:
                        metaapi_account_cache.update({
                            'balance': account_info.get('balance', 0),
                            'equity': account_info.get('equity', 0),
                            'margin': account_info.get('margin', 0),
                            'freeMargin': account_info.get('freeMargin', 0),
                            'profit': account_info.get('profit', 0),
                            'updated_at': time.time()
                        })

                    if closed_ids or new_ids:
                        print(f"[MetaAPI Sync] 포지션 동기화: MT5={len(mt5_positions)}개, 캐시={len(metaapi_positions_cache)}개")

                except Exception as e:
                    print(f"[MetaAPI Sync] 동기화 오류: {e}")

        self._sync_task = asyncio.create_task(_sync_loop())
        print("[MetaAPI] 포지션 동기화 루프 시작 (30초 주기)")

    async def subscribe_to_prices(self, symbols: List[str] = None):
        """시세 구독 (Streaming)"""
        if not self.quote_connection:
            if not await self.connect_quote_account():
                return False

        symbols = symbols or SYMBOLS
        for symbol in symbols:
            try:
                await self.quote_connection.subscribe_to_market_data(symbol)
                print(f"[MetaAPI] {symbol} 구독 완료")
            except Exception as e:
                print(f"[MetaAPI] {symbol} 구독 실패: {e}")

        return True

    # ============================================================
    # 계정 정보
    # ============================================================
    async def get_account_info(self) -> Optional[Dict]:
        """Trade 계정 정보 조회"""
        if not self.trade_connection:
            if not await self.connect_trade_account():
                return None

        try:
            info = await self.trade_connection.get_account_information()
            return {
                'broker': info.get('broker', ''),
                'server': info.get('server', ''),
                'balance': info.get('balance', 0),
                'equity': info.get('equity', 0),
                'margin': info.get('margin', 0),
                'freeMargin': info.get('freeMargin', 0),
                'leverage': info.get('leverage', 0),
                'currency': info.get('currency', 'USD'),
                'name': info.get('name', '')
            }
        except Exception as e:
            print(f"[MetaAPI] 계정 정보 조회 실패: {e}")
            return None

    # ============================================================
    # 포지션 조회
    # ============================================================
    async def get_positions(self) -> List[Dict]:
        """현재 포지션 조회"""
        if not self.trade_connection:
            if not await self.connect_trade_account():
                return []

        try:
            positions = await self.trade_connection.get_positions()
            result = []
            for pos in positions:
                result.append({
                    'id': pos.get('id'),
                    'symbol': pos.get('symbol'),
                    'type': 'BUY' if 'BUY' in pos.get('type', '') else 'SELL',
                    'volume': pos.get('volume'),
                    'openPrice': pos.get('openPrice'),
                    'currentPrice': pos.get('currentPrice'),
                    'profit': pos.get('profit'),
                    'commission': pos.get('commission'),
                    'swap': pos.get('swap'),
                    'openTime': pos.get('time'),
                    'magic': pos.get('magic', 0),
                    'comment': pos.get('comment', '')
                })
            return result
        except Exception as e:
            print(f"[MetaAPI] 포지션 조회 실패: {e}")
            return []

    # ============================================================
    # 주문 실행
    # ============================================================
    async def place_order(
        self,
        symbol: str,
        order_type: str,  # 'BUY' or 'SELL'
        volume: float,
        sl_points: int = 0,
        tp_points: int = 0,
        magic: int = 100000,
        comment: str = "Trading-X"
    ) -> Dict:
        """시장가 주문 실행"""
        if not self.trade_connection:
            if not await self.connect_trade_account():
                return {'success': False, 'error': 'Trade 계정 연결 실패'}

        try:
            # ★★★ 심볼별 스펙 (tick_size = point) ★★★
            SYMBOL_SPECS = {
                "BTCUSD":   {"tick_size": 0.01},
                "ETHUSD":   {"tick_size": 0.01},
                "XAUUSD.r": {"tick_size": 0.01},
                "EURUSD.r": {"tick_size": 0.00001},
                "USDJPY.r": {"tick_size": 0.001},
                "GBPUSD.r": {"tick_size": 0.00001},
                "AUDUSD.r": {"tick_size": 0.00001},
                "USDCAD.r": {"tick_size": 0.00001},
                "US100.":   {"tick_size": 0.01},
            }
            specs = SYMBOL_SPECS.get(symbol, {"tick_size": 0.01})
            tick_size = specs["tick_size"]

            # MetaAPI SDK 옵션
            options = {
                'comment': comment,
                'magic': magic
            }

            # ★★★ SL/TP 가격 계산 ★★★
            if sl_points > 0 or tp_points > 0:
                # 현재가 조회 (캐시 또는 API)
                price_data = quote_price_cache.get(symbol, {})
                bid = price_data.get('bid', 0)
                ask = price_data.get('ask', 0)

                if bid > 0 and ask > 0:
                    if order_type.upper() == 'BUY':
                        # BUY: 진입가 = ask, TP = ask + points, SL = ask - points
                        if tp_points > 0:
                            options['takeProfit'] = round(ask + (tp_points * tick_size), 5)
                        if sl_points > 0:
                            options['stopLoss'] = round(ask - (sl_points * tick_size), 5)
                    else:
                        # SELL: 진입가 = bid, TP = bid - points, SL = bid + points
                        if tp_points > 0:
                            options['takeProfit'] = round(bid - (tp_points * tick_size), 5)
                        if sl_points > 0:
                            options['stopLoss'] = round(bid + (sl_points * tick_size), 5)

                    print(f"[MetaAPI] SL/TP 설정: {order_type} {symbol} @ bid={bid}, ask={ask}")
                    print(f"[MetaAPI]   tp_points={tp_points}, sl_points={sl_points}, tick_size={tick_size}")
                    print(f"[MetaAPI]   stopLoss={options.get('stopLoss')}, takeProfit={options.get('takeProfit')}")
                else:
                    print(f"[MetaAPI] 경고: 현재가 없음 ({symbol}), SL/TP 생략")

            if order_type.upper() == 'BUY':
                result = await self.trade_connection.create_market_buy_order(
                    symbol=symbol,
                    volume=volume,
                    options=options
                )
            else:
                result = await self.trade_connection.create_market_sell_order(
                    symbol=symbol,
                    volume=volume,
                    options=options
                )

            print(f"[MetaAPI] 주문 응답: {result}")

            if result.get('stringCode') == 'TRADE_RETCODE_DONE':
                position_id = result.get('positionId')

                # ★★★ TP/SL 설정 확인 + 실패 시 강제 청산 (안전장치) ★★★
                if position_id and (options.get('stopLoss') or options.get('takeProfit')):
                    tp_sl_confirmed = False
                    
                    # 1차: modify_position으로 TP/SL 확실히 설정
                    try:
                        await asyncio.sleep(0.5)
                        modify_result = await self.trade_connection.modify_position(
                            position_id=position_id,
                            stop_loss=options.get('stopLoss'),
                            take_profit=options.get('takeProfit')
                        )
                        print(f"[MetaAPI] SL/TP 설정 결과: {modify_result}")
                        if modify_result and modify_result.get('stringCode') == 'TRADE_RETCODE_DONE':
                            tp_sl_confirmed = True
                            print(f"[MetaAPI] ✅ SL/TP 설정 확인 완료")
                        else:
                            print(f"[MetaAPI] ⚠️ SL/TP 설정 응답 불확실: {modify_result}")
                    except Exception as e:
                        print(f"[MetaAPI] ❌ SL/TP 설정 실패: {e}")

                    # 2차: TP/SL 미확인 시 재시도
                    if not tp_sl_confirmed:
                        try:
                            await asyncio.sleep(1.0)
                            modify_result2 = await self.trade_connection.modify_position(
                                position_id=position_id,
                                stop_loss=options.get('stopLoss'),
                                take_profit=options.get('takeProfit')
                            )
                            print(f"[MetaAPI] SL/TP 재시도 결과: {modify_result2}")
                            if modify_result2 and modify_result2.get('stringCode') == 'TRADE_RETCODE_DONE':
                                tp_sl_confirmed = True
                                print(f"[MetaAPI] ✅ SL/TP 재시도 성공")
                        except Exception as e2:
                            print(f"[MetaAPI] ❌ SL/TP 재시도도 실패: {e2}")

                    # 3차: 최종 실패 시 포지션 강제 청산 (TP/SL 없는 포지션 방지)
                    if not tp_sl_confirmed:
                        print(f"[MetaAPI] 🚨 SL/TP 설정 불가! 포지션 강제 청산: {position_id}")
                        try:
                            await self.close_position(position_id)
                            return {
                                'success': False,
                                'error': 'Target 금액 설정 실패로 안전을 위해 주문이 취소되었습니다. 다시 시도해주세요.',
                                'tp_sl_failed': True
                            }
                        except Exception as close_err:
                            print(f"[MetaAPI] 🚨🚨 강제 청산도 실패!: {close_err}")
                            return {
                                'success': False,
                                'error': 'Target 금액 설정 및 청산 모두 실패! MT5에서 수동 청산 필요!',
                                'tp_sl_failed': True,
                                'critical': True
                            }

                return {
                    'success': True,
                    'orderId': result.get('orderId'),
                    'positionId': position_id,
                    'message': f"{order_type.upper()} 주문 성공",
                    'tp_sl_set': True
                }
            else:
                return {
                    'success': False,
                    'error': result.get('message', 'Unknown error'),
                    'code': result.get('stringCode')
                }

        except Exception as e:
            print(f"[MetaAPI] 주문 실패: {e}")
            return {'success': False, 'error': str(e)}

    async def close_position(self, position_id: str) -> Dict:
        """포지션 청산 + MT5 실제 체결 손익 조회"""
        if not self.trade_connection:
            if not await self.connect_trade_account():
                return {'success': False, 'error': 'Trade 계정 연결 실패'}

        try:
            result = await self.trade_connection.close_position(position_id)

            if result.get('stringCode') == 'TRADE_RETCODE_DONE':
                # ★★★ MT5 실제 체결 손익 조회 ★★★
                actual_profit = None
                actual_commission = 0
                actual_swap = 0
                try:
                    import asyncio
                    await asyncio.sleep(0.5)  # MT5 처리 대기
                    deals = await self.get_deals_by_position(position_id)
                    if deals:
                        # 청산 딜(entryType=DEAL_ENTRY_OUT)에서 실제 손익 추출
                        for deal in deals:
                            entry_type = deal.get('entryType', '')
                            if 'OUT' in str(entry_type).upper() or deal.get('profit', 0) != 0:
                                actual_profit = deal.get('profit', 0)
                                actual_commission = deal.get('commission', 0)
                                actual_swap = deal.get('swap', 0)
                                break
                        # OUT 딜이 없으면 전체 합산
                        if actual_profit is None:
                            actual_profit = sum(d.get('profit', 0) for d in deals)
                            actual_commission = sum(d.get('commission', 0) for d in deals)
                            actual_swap = sum(d.get('swap', 0) for d in deals)
                    print(f"[MetaAPI] ★ 실제 체결 손익: profit={actual_profit}, commission={actual_commission}, swap={actual_swap}")
                except Exception as deal_err:
                    print(f"[MetaAPI] ⚠️ 체결 손익 조회 실패: {deal_err}")

                return {
                    'success': True,
                    'positionId': position_id,
                    'message': '청산 성공',
                    'actual_profit': actual_profit,
                    'actual_commission': actual_commission,
                    'actual_swap': actual_swap
                }
            else:
                return {
                    'success': False,
                    'error': result.get('message', 'Unknown error'),
                    'code': result.get('stringCode')
                }

        except Exception as e:
            print(f"[MetaAPI] 청산 실패: {e}")
            return {'success': False, 'error': str(e)}

    async def close_position_partial(self, position_id: str, volume: float) -> Dict:
        """포지션 부분 청산"""
        if not self.trade_connection:
            if not await self.connect_trade_account():
                return {'success': False, 'error': 'Trade 계정 연결 실패'}

        try:
            result = await self.trade_connection.close_position_partially(position_id, volume)

            if result.get('stringCode') == 'TRADE_RETCODE_DONE':
                return {
                    'success': True,
                    'positionId': position_id,
                    'volume': volume,
                    'message': f'{volume} lot 부분 청산 성공'
                }
            else:
                return {
                    'success': False,
                    'error': result.get('message', 'Unknown error')
                }

        except Exception as e:
            print(f"[MetaAPI] 부분 청산 실패: {e}")
            return {'success': False, 'error': str(e)}

    async def close_all_positions(self, symbol: str = None) -> Dict:
        """모든 포지션 청산 (심볼 지정 가능)"""
        positions = await self.get_positions()

        if symbol:
            positions = [p for p in positions if p['symbol'] == symbol]

        if not positions:
            return {'success': True, 'closed': 0, 'message': '청산할 포지션 없음'}

        closed = 0
        errors = []

        for pos in positions:
            result = await self.close_position(pos['id'])
            if result['success']:
                closed += 1
            else:
                errors.append(f"{pos['id']}: {result.get('error')}")

        return {
            'success': len(errors) == 0,
            'closed': closed,
            'total': len(positions),
            'errors': errors if errors else None
        }

    # ============================================================
    # 거래 히스토리
    # ============================================================
    async def get_history(
        self,
        start_time: datetime = None,
        end_time: datetime = None
    ) -> List[Dict]:
        """거래 히스토리 조회 (최신순 정렬)"""
        if not self.trade_connection:
            if not await self.connect_trade_account():
                return []

        try:
            # 기본값: 7일 (MetaAPI 500개 제한 고려)
            if not start_time:
                start_time = datetime.now() - timedelta(days=7)
            if not end_time:
                end_time = datetime.now() + timedelta(minutes=1)

            result = await self.trade_connection.get_deals_by_time_range(start_time, end_time)
            deals = result.get('deals', []) if isinstance(result, dict) else result

            history = []
            for deal in deals:
                history.append({
                    'id': deal.get('id'),
                    'symbol': deal.get('symbol'),
                    'type': 'BUY' if 'BUY' in deal.get('type', '') else 'SELL',
                    'volume': deal.get('volume'),
                    'price': deal.get('price'),
                    'profit': deal.get('profit'),
                    'commission': deal.get('commission'),
                    'swap': deal.get('swap'),
                    'time': deal.get('time'),
                    'positionId': deal.get('positionId'),
                    'orderId': deal.get('orderId'),
                    'entryType': deal.get('entryType'),
                    'magic': deal.get('magic', 0)
                })

            # ★ 시간 역순 정렬 (최신 먼저)
            history.sort(key=lambda x: x.get('time') or datetime.min, reverse=True)

            return history

        except Exception as e:
            print(f"[MetaAPI] 히스토리 조회 실패: {e}")
            return []

    async def get_deals_by_position(self, position_id: str) -> List[Dict]:
        """포지션별 거래 조회"""
        if not self.trade_connection:
            if not await self.connect_trade_account():
                return []

        try:
            # 최근 7일 히스토리에서 검색
            start_time = datetime.now() - timedelta(days=7)
            end_time = datetime.now() + timedelta(minutes=1)

            result = await self.trade_connection.get_deals_by_time_range(start_time, end_time)
            deals = result.get('deals', []) if isinstance(result, dict) else result

            # 해당 포지션 ID의 거래만 필터
            position_deals = [
                d for d in deals
                if str(d.get('positionId', '')) == str(position_id)
            ]

            return position_deals

        except Exception as e:
            print(f"[MetaAPI] 포지션 거래 조회 실패: {e}")
            return []

    # ============================================================
    # 유틸리티
    # ============================================================
    def calculate_profit(
        self,
        pos_type: str,
        symbol: str,
        volume: float,
        open_price: float,
        current_price: float
    ) -> float:
        """실시간 P/L 계산"""
        specs = SYMBOL_SPECS.get(symbol, {
            "contract_size": 1,
            "tick_size": 0.01,
            "tick_value": 0.01
        })

        contract_size = specs["contract_size"]
        tick_size = specs["tick_size"]
        tick_value = specs["tick_value"]

        if pos_type.upper() == 'BUY':
            price_diff = current_price - open_price
        else:
            price_diff = open_price - current_price

        if tick_size > 0:
            profit = (price_diff / tick_size) * tick_value * volume
        else:
            profit = price_diff * volume * contract_size

        return round(profit, 2)

    def is_connected(self) -> Dict[str, bool]:
        """연결 상태 확인"""
        return {
            'initialized': self._initialized,
            'quote': self.quote_connection is not None,
            'trade': self.trade_connection is not None
        }


# ============================================================
# 싱글톤 인스턴스
# ============================================================
metaapi_service = MetaAPIService()


# ============================================================
# 헬퍼 함수들
# ============================================================
async def get_metaapi_service() -> MetaAPIService:
    """MetaAPI 서비스 인스턴스 반환 (의존성 주입용)"""
    if not metaapi_service._initialized:
        await metaapi_service.initialize()
    return metaapi_service


async def quick_price(symbol: str) -> Optional[Dict]:
    """빠른 시세 조회"""
    return await metaapi_service.get_price(symbol)


async def quick_order(
    symbol: str,
    order_type: str,
    volume: float,
    magic: int = 100000
) -> Dict:
    """빠른 주문 실행"""
    return await metaapi_service.place_order(
        symbol=symbol,
        order_type=order_type,
        volume=volume,
        magic=magic
    )


async def quick_close(position_id: str) -> Dict:
    """빠른 포지션 청산"""
    return await metaapi_service.close_position(position_id)


# ============================================================
# bridge_cache 호환 함수들 (WS에서 직접 호출용)
# ============================================================
def get_metaapi_prices() -> Dict[str, Dict]:
    """시세 캐시 반환 (bridge_cache["prices"] 대체)"""
    return quote_price_cache


def get_metaapi_candles(symbol: str, timeframe: str = "M1") -> List[Dict]:
    """캔들 캐시 반환 (bridge_cache["candles"] 대체)"""
    symbol_data = quote_candle_cache.get(symbol, {})
    return symbol_data.get(timeframe, [])


def is_metaapi_connected() -> bool:
    """MetaAPI 연결 상태 (Quote 또는 Trade 연결 확인)"""
    global quote_connected, quote_last_update
    # 30초 이내 업데이트 있으면 연결 상태
    if quote_last_update > 0 and (time.time() - quote_last_update) < 30:
        return True
    # Trade 계정 연결 확인
    if metaapi_service.trade_connection is not None:
        return True
    return quote_connected


def get_metaapi_last_update() -> float:
    """마지막 업데이트 시간"""
    return quote_last_update


def get_metaapi_indicators(symbol: str = "BTCUSD") -> Dict:
    """인디케이터 값 반환"""
    global indicator_cache
    # 캐시에 없으면 실시간 계산
    if symbol not in indicator_cache:
        return calculate_indicators_realtime(symbol)
    return indicator_cache.get(symbol, {"buy": 33, "sell": 33, "neutral": 34, "score": 50})


# ============================================================
# MetaAPI 캐시 조회 헬퍼 함수 (WS에서 사용)
# ============================================================
def get_metaapi_positions() -> List[Dict]:
    """MetaAPI 포지션 캐시 조회"""
    global metaapi_positions_cache
    return metaapi_positions_cache.copy()


def get_metaapi_account() -> Dict:
    """MetaAPI 계정 정보 캐시 조회"""
    global metaapi_account_cache
    return metaapi_account_cache.copy()


def pop_metaapi_closed_events() -> List[Dict]:
    """청산 이벤트 가져오기 (가져온 후 삭제)"""
    global metaapi_closed_events
    events = metaapi_closed_events.copy()
    metaapi_closed_events.clear()
    return events


def remove_position_from_cache(position_id: str) -> bool:
    """캐시에서 포지션 제거 (청산 실패 시 정리용)"""
    global metaapi_positions_cache
    for i, pos in enumerate(metaapi_positions_cache):
        if pos.get('id') == position_id:
            metaapi_positions_cache.pop(i)
            print(f"[MetaAPI Cache] 포지션 {position_id} 캐시에서 제거")
            return True
    return False


def get_realtime_data() -> Dict:
    """
    WS 전송용 전체 데이터 패키지
    시세 + 캔들 + 인디케이터를 동일 타이밍에 계산
    """
    global quote_price_cache, quote_candle_cache, indicator_cache

    # 모든 심볼의 시세 (캔들 close로 보완)
    all_prices = {}
    for symbol in SYMBOLS:
        price_data = quote_price_cache.get(symbol, {})
        bid = price_data.get("bid")
        ask = price_data.get("ask")

        # 시세가 없으면 캔들 close를 사용
        if not bid or bid <= 0:
            candles = quote_candle_cache.get(symbol, {}).get("M1", [])
            if candles:
                bid = candles[-1].get("close", 0)
                ask = bid  # 스프레드 없음

        if bid and bid > 0:
            all_prices[symbol] = {"bid": bid, "ask": ask or bid}

    # 모든 심볼의 최신 캔들
    all_candles = {}
    for symbol in SYMBOLS:
        candles = quote_candle_cache.get(symbol, {}).get("M1", [])
        if candles:
            last = candles[-1]
            # 현재가로 close 업데이트
            current_bid = all_prices.get(symbol, {}).get("bid", last.get("close", 0))
            all_candles[symbol] = {
                "time": last.get("time", 0),
                "open": last.get("open", 0),
                "high": max(last.get("high", 0), current_bid) if current_bid else last.get("high", 0),
                "low": min(last.get("low", float('inf')), current_bid) if current_bid and last.get("low", 0) > 0 else last.get("low", current_bid),
                "close": current_bid or last.get("close", 0)
            }

    # BTCUSD 인디케이터 계산 (동일 타이밍)
    indicators = calculate_indicators_realtime("BTCUSD")

    return {
        "prices": all_prices,
        "candles": all_candles,
        "indicators": indicators,
        "timestamp": time.time()
    }


# ============================================================
# 캔들 캐시 파일 저장/로드
# ============================================================
def save_candle_cache():
    """캔들 캐시를 JSON 파일로 저장 (atomic write)"""
    global quote_candle_cache
    try:
        tmp_file = CANDLE_CACHE_FILE.with_suffix('.tmp')
        with open(tmp_file, 'w') as f:
            json.dump(quote_candle_cache, f)
        tmp_file.rename(CANDLE_CACHE_FILE)
        total = sum(len(tfs) for tfs in quote_candle_cache.values())
        print(f"[CandleCache] ✅ 저장 완료: {total}개 TF ({CANDLE_CACHE_FILE.stat().st_size / 1024:.0f}KB)")
    except Exception as e:
        print(f"[CandleCache] ❌ 저장 실패: {e}")

def load_candle_cache() -> bool:
    """캔들 캐시 파일에서 로드"""
    global quote_candle_cache
    try:
        if not CANDLE_CACHE_FILE.exists():
            print("[CandleCache] 캐시 파일 없음 - API에서 로딩 필요")
            return False
        
        file_age = time.time() - CANDLE_CACHE_FILE.stat().st_mtime
        with open(CANDLE_CACHE_FILE, 'r') as f:
            data = json.load(f)
        
        if not data or not isinstance(data, dict):
            print("[CandleCache] 캐시 파일 비정상 - 무시")
            return False
        
        quote_candle_cache = data
        total = sum(len(tfs) for tfs in quote_candle_cache.values())
        candle_total = sum(len(candles) for tfs in quote_candle_cache.values() for candles in tfs.values())
        print(f"[CandleCache] ✅ 파일에서 로드 완료: {len(data)}심볼, {total}TF, {candle_total}캔들 (파일 나이: {file_age:.0f}초)")
        return True
    except Exception as e:
        print(f"[CandleCache] ❌ 로드 실패: {e}")
        return False

async def _auto_save_candle_cache():
    """5분마다 캔들 캐시 자동 저장"""
    while True:
        await asyncio.sleep(300)  # 5분
        if quote_candle_cache:
            save_candle_cache()

# ============================================================
# 백그라운드 캔들 로딩 함수 (병렬화 + 캐시 저장)
# ============================================================
async def _load_all_candles_background():
    """
    모든 타임프레임 캔들을 백그라운드에서 로딩
    3개 심볼 동시 병렬 처리 (Rate Limit 안전)
    """
    timeframes = {
        "1m": "M1", "5m": "M5", "15m": "M15", "30m": "M30",
        "1h": "H1", "4h": "H4", "1d": "D1", "1w": "W1"
    }

    print(f"[MetaAPI Background] 히스토리 캔들 로딩 시작... ({len(SYMBOLS)}심볼 x {len(timeframes)}TF)")

    semaphore = asyncio.Semaphore(3)  # ★ 동시 3개 심볼 제한
    total_loaded = 0

    async def load_symbol(symbol):
        nonlocal total_loaded
        failed_tfs = []
        for meta_tf, cache_tf in timeframes.items():
            async with semaphore:
                try:
                    success = await initialize_candles_from_api(
                        metaapi_service.trade_account,
                        symbol,
                        timeframe=cache_tf,
                        count=1000
                    )
                    if success:
                        total_loaded += 1
                    else:
                        failed_tfs.append((meta_tf, cache_tf))
                    await asyncio.sleep(0.5)  # Rate limit 방지
                except Exception as e:
                    print(f"[MetaAPI Background] ⚠️ {symbol}/{cache_tf} 로딩 실패: {e}")
                    failed_tfs.append((meta_tf, cache_tf))

        # ★ 실패한 TF 재시도 (5초 대기 후)
        if failed_tfs:
            print(f"[MetaAPI Background] 🔄 {symbol} 실패 {len(failed_tfs)}개 TF 재시도 대기 (5초)...")
            await asyncio.sleep(5)
            for meta_tf, cache_tf in failed_tfs:
                async with semaphore:
                    try:
                        success = await initialize_candles_from_api(
                            metaapi_service.trade_account,
                            symbol,
                            timeframe=cache_tf,
                            count=1000
                        )
                        if success:
                            total_loaded += 1
                            print(f"[MetaAPI Background] ✅ {symbol}/{cache_tf} 재시도 성공!")
                        await asyncio.sleep(1.0)  # 재시도는 더 느리게
                    except Exception as e:
                        print(f"[MetaAPI Background] ❌ {symbol}/{cache_tf} 재시도도 실패: {e}")

    # ★ 모든 심볼 병렬 실행
    tasks = [load_symbol(symbol) for symbol in SYMBOLS]
    await asyncio.gather(*tasks)

    print(f"[MetaAPI Background] 캔들 로딩 완료: {total_loaded}개 TF 로딩됨")

    # 각 심볼별 캔들 개수 로그 (M1 기준)
    candle_counts = []
    for symbol in SYMBOLS:
        count = len(quote_candle_cache.get(symbol, {}).get("M1", []))
        candle_counts.append(f"{symbol}:{count}")
    print(f"[MetaAPI Background] M1 캔들: {', '.join(candle_counts)}")

    # ★ 로딩 완료 후 캐시 파일 저장
    save_candle_cache()


# ============================================================
# 서버 시작 시 호출할 초기화 함수
# ============================================================
async def startup_metaapi():
    """
    서버 시작 시 MetaAPI 초기화 및 시세 수신 시작
    main.py의 startup 이벤트에서 호출
    """
    print("[MetaAPI Startup] 초기화 시작...")

    try:
        # 1. MetaAPI 초기화
        if not await metaapi_service.initialize():
            print("[MetaAPI Startup] 초기화 실패")
            return False

        # 2. Quote 계정 먼저 연결 (시세 수신이 더 중요)
        try:
            if await metaapi_service.connect_quote_account():
                print("[MetaAPI Startup] ✅ Quote 스트리밍 연결 완료")
            else:
                print("[MetaAPI Startup] ⚠️ Quote 스트리밍 연결 실패 (폴링으로 대체)")
        except Exception as e:
            print(f"[MetaAPI Startup] ⚠️ Quote 스트리밍 오류: {e}")

        # 3. Trade 계정 연결 (실패해도 계속 진행)
        try:
            if await metaapi_service.connect_trade_account():
                print("[MetaAPI Startup] ✅ Trade 계정 연결 완료")
            else:
                print("[MetaAPI Startup] ⚠️ Trade 계정 연결 실패 (유저별 연결로 대체)")
        except Exception as e:
            print(f"[MetaAPI Startup] ⚠️ Trade 계정 연결 오류: {e}")

        # 3. 초기 시세 조회
        prices = await metaapi_service.get_all_prices()
        print(f"[MetaAPI Startup] 초기 시세 조회 완료: {len(prices)}개 심볼")

        # 4. 캔들 캐시 파일에서 즉시 로드 → 백그라운드에서 최신화
        cache_loaded = load_candle_cache()
        asyncio.create_task(_load_all_candles_background())
        
        # 4.5. 캔들 캐시 자동 저장 루프 시작 (5분마다)
        asyncio.create_task(_auto_save_candle_cache())
        
        if cache_loaded:
            print("[MetaAPI Startup] ★ 캐시에서 캔들 즉시 로드 완료! 백그라운드에서 최신화 중...")

        # 5. 시세 업데이트 루프 시작 (10초 간격 - Rate Limit 방지)
        await metaapi_service.start_price_update_loop(interval=60.0)  # 크레딧 절약: 10초→60초 (스트리밍이 메인, 이건 백업)

        # 6. 포지션 동기화 루프 시작 (120초 주기)
        await metaapi_service.start_position_sync_loop(interval=300.0)  # 크레딧 절약: 120초→300초 (TradeSyncListener가 메인, 이건 백업)

        # 7. 비활동 유저 자동 undeploy 루프 시작 (5분마다 체크, 30분 비활동 시 undeploy)
        asyncio.create_task(_auto_undeploy_inactive_users())

        print("[MetaAPI Startup] 초기화 완료!")
        return True

    except Exception as e:
        print(f"[MetaAPI Startup] 오류: {e}")
        import traceback
        traceback.print_exc()
        return False


# ============================================================
# 테스트 함수
# ============================================================
async def test_connection():
    """연결 테스트"""
    print("=" * 50)
    print("MetaAPI 연결 테스트")
    print("=" * 50)

    # 초기화
    if not await metaapi_service.initialize():
        print("초기화 실패")
        return False

    # Trade 계정 연결
    if not await metaapi_service.connect_trade_account():
        print("Trade 계정 연결 실패")
        return False

    # 계정 정보
    account = await metaapi_service.get_account_info()
    if account:
        print(f"\n계정 정보:")
        print(f"  Broker: {account['broker']}")
        print(f"  Balance: ${account['balance']:,.2f}")
        print(f"  Equity: ${account['equity']:,.2f}")

    # 시세 조회
    prices = await metaapi_service.get_all_prices()
    print(f"\n시세 ({len(prices)}개):")
    for symbol, price in prices.items():
        print(f"  {symbol}: Bid={price['bid']}, Ask={price['ask']}")

    # 포지션
    positions = await metaapi_service.get_positions()
    print(f"\n포지션 ({len(positions)}개):")
    for pos in positions[:5]:
        print(f"  {pos['symbol']} {pos['type']} {pos['volume']} @ {pos['openPrice']} P/L: {pos['profit']}")

    # 연결 종료
    await metaapi_service.disconnect()
    print("\n테스트 완료")
    return True


# ============================================================
# 유저별 MetaAPI 계정 프로비저닝
# ============================================================

# 유저별 Trade 연결 풀 (메모리 캐시)
user_trade_connections: Dict[int, Dict] = {}
# 구조: {user_id: {"rpc": connection, "account": metaapi_account_obj, "last_active": timestamp, "account_info": {}, "positions": []}}

# 유저별 MetaAPI 데이터 캐시
user_metaapi_cache: Dict[int, Dict] = {}
# 구조: {user_id: {"account_info": {...}, "positions": [...], "last_sync": timestamp}}

# 유저별 청산 이벤트 큐 (Streaming에서 감지)
user_closed_events: Dict[int, List[Dict]] = {}
# 구조: {user_id: [{"profit": float, "symbol": str, "magic": int, ...}]}


async def provision_user_metaapi(user_id: int, login: str, password: str, server: str, name: str = "") -> Dict:
    """
    유저의 MT5 계정을 MetaAPI에 프로비저닝 (계정 생성)
    - /mt5/connect 성공 후 호출됨
    - ★★★ 중복 방지: 기존 계정 검색 → 있으면 재사용, 없으면 신규 생성 ★★★
    """
    if not metaapi_service.api:
        if not await metaapi_service.initialize():
            return {"success": False, "error": "MetaAPI 초기화 실패"}

    try:
        print(f"[MetaAPI Provision] 🔵 User {user_id} 프로비저닝 시작: {login}@{server}")

        # ★★★ Step 1: DB에서 이미 metaapi_account_id가 있는지 확인 ★★★
        try:
            from ..database import get_db
            from ..models.user import User
            _db = next(get_db())
            _user = _db.query(User).filter(User.id == user_id).first()
            if _user and _user.metaapi_account_id:
                existing_id = _user.metaapi_account_id
                print(f"[MetaAPI Provision] 🔄 User {user_id} DB에 기존 계정 존재: {existing_id[:8]}... → 재사용")
                _db.close()
                return {"success": True, "account_id": existing_id, "state": "existing"}
            _db.close()
        except Exception as db_err:
            print(f"[MetaAPI Provision] ⚠️ DB 확인 실패 (계속 진행): {db_err}")

        # ★★★ Step 2: MetaAPI에서 같은 login+유저명으로 기존 계정 검색 ★★★
        expected_name = f"TradingX-User{user_id}-{login}"
        try:
            accounts = await metaapi_service.api.metatrader_account_api.get_accounts()
            for acc in accounts:
                acc_name = getattr(acc, 'name', '')
                acc_login = str(getattr(acc, 'login', ''))
                if acc_login == str(login) and f"User{user_id}" in acc_name:
                    print(f"[MetaAPI Provision] 🔄 User {user_id} MetaAPI 기존 계정 발견: {acc.id} ({acc_name}) → 재사용")
                    return {"success": True, "account_id": acc.id, "state": acc.state}
            print(f"[MetaAPI Provision] 🆕 User {user_id} 기존 계정 없음 → 신규 생성")
        except Exception as search_err:
            print(f"[MetaAPI Provision] ⚠️ 계정 검색 실패 (신규 생성 진행): {search_err}")

        # ★★★ Step 3: 신규 계정 생성 ★★★
        account = await metaapi_service.api.metatrader_account_api.create_account({
            'name': expected_name,
            'type': 'cloud',
            'login': str(login),
            'password': password,
            'server': server,
            'platform': 'mt5',
            'application': 'MetaApi',
            'magic': 0
        })

        account_id = account.id
        print(f"[MetaAPI Provision] ✅ User {user_id} 계정 생성 완료: {account_id}")

        return {
            "success": True,
            "account_id": account_id,
            "state": account.state
        }

    except Exception as e:
        error_msg = str(e)
        print(f"[MetaAPI Provision] ❌ User {user_id} 프로비저닝 실패: {error_msg}")

        if 'already exists' in error_msg.lower() or 'duplicate' in error_msg.lower():
            try:
                accounts = await metaapi_service.api.metatrader_account_api.get_accounts()
                for acc in accounts:
                    if hasattr(acc, 'login') and str(acc.login) == str(login):
                        acc_name = getattr(acc, 'name', '')
                        if f"User{user_id}" in acc_name:
                            print(f"[MetaAPI Provision] 🔄 User {user_id} 기존 계정 발견: {acc.id}")
                            return {"success": True, "account_id": acc.id, "state": acc.state}
            except Exception as search_err:
                print(f"[MetaAPI Provision] 계정 검색 실패: {search_err}")

        return {"success": False, "error": error_msg}


async def deploy_user_metaapi(metaapi_account_id: str) -> Dict:
    """
    유저의 MetaAPI 계정을 deploy (활성화)
    - deploy → wait_connected 순서
    - 이미 deployed면 즉시 반환
    """
    if not metaapi_service.api:
        return {"success": False, "error": "MetaAPI 미초기화"}

    try:
        account = await metaapi_service.api.metatrader_account_api.get_account(metaapi_account_id)

        if account.state == 'DEPLOYED':
            print(f"[MetaAPI Deploy] ✅ 이미 deployed: {metaapi_account_id[:8]}...")
            return {"success": True, "state": "DEPLOYED", "already_deployed": True}

        print(f"[MetaAPI Deploy] 🔵 Deploying: {metaapi_account_id[:8]}... (현재: {account.state})")
        await account.deploy()
        await account.wait_connected()

        print(f"[MetaAPI Deploy] ✅ Deploy 완료: {metaapi_account_id[:8]}...")
        return {"success": True, "state": "DEPLOYED"}

    except Exception as e:
        print(f"[MetaAPI Deploy] ❌ Deploy 실패: {e}")
        return {"success": False, "error": str(e)}


async def undeploy_user_metaapi(metaapi_account_id: str) -> Dict:
    """
    유저의 MetaAPI 계정을 undeploy (비활성화 - 비용 절감)
    - 30분 비활동 시 호출
    """
    if not metaapi_service.api:
        return {"success": False, "error": "MetaAPI 미초기화"}

    try:
        account = await metaapi_service.api.metatrader_account_api.get_account(metaapi_account_id)

        if account.state == 'UNDEPLOYED':
            print(f"[MetaAPI Undeploy] 이미 undeployed: {metaapi_account_id[:8]}...")
            return {"success": True, "state": "UNDEPLOYED"}

        # 연결 풀에서 제거
        for uid, conn_data in list(user_trade_connections.items()):
            if conn_data.get("metaapi_account_id") == metaapi_account_id:
                try:
                    if conn_data.get("streaming"):
                        await conn_data["streaming"].close()
                except:
                    pass
                try:
                    if conn_data.get("rpc"):
                        await conn_data["rpc"].close()
                except:
                    pass
                del user_trade_connections[uid]
                print(f"[MetaAPI Undeploy] User {uid} 연결 풀 정리 (RPC + Streaming)")
                break

        await account.undeploy()
        print(f"[MetaAPI Undeploy] ✅ Undeploy 완료: {metaapi_account_id[:8]}...")
        return {"success": True, "state": "UNDEPLOYED"}

    except Exception as e:
        print(f"[MetaAPI Undeploy] ❌ Undeploy 실패: {e}")
        return {"success": False, "error": str(e)}


class UserStreamingListener:
    """
    유저별 MetaAPI Streaming 리스너
    - on_position_updated → user_metaapi_cache 실시간 업데이트
    - on_position_removed → 즉시 청산 감지 + user_closed_events에 추가
    - on_account_information_updated → 잔고/자산 실시간 업데이트
    """

    def __init__(self, user_id: int):
        self.user_id = user_id
        self._sync_complete = False
        self._start_time = time.time()

    def _ensure_cache(self):
        if self.user_id not in user_metaapi_cache:
            user_metaapi_cache[self.user_id] = {"positions": [], "account_info": None, "last_sync": 0}

    async def on_connected(self, instance_index, replicas):
        print(f"[UserStreaming] 🟢 User {self.user_id} Streaming 연결됨")

    async def on_disconnected(self, instance_index):
        print(f"[UserStreaming] 🔴 User {self.user_id} Streaming 연결 해제")

    async def on_account_information_updated(self, instance_index, account_information):
        """계정 정보 실시간 업데이트"""
        self._ensure_cache()
        user_metaapi_cache[self.user_id]["account_info"] = {
            "broker": account_information.get("broker", ""),
            "balance": account_information.get("balance", 0),
            "equity": account_information.get("equity", 0),
            "margin": account_information.get("margin", 0),
            "freeMargin": account_information.get("freeMargin", 0) or account_information.get("free_margin", 0),
            "leverage": account_information.get("leverage", 0),
            "currency": account_information.get("currency", "USD"),
            "login": account_information.get("login", 0)
        }
        user_metaapi_cache[self.user_id]["last_sync"] = time.time()
        # ★ Redis 병행 저장 (유저 캐시)
        try:
            if redis_set_price:  # redis 사용 가능 확인
                from ..redis_client import set_user_cache
                set_user_cache(self.user_id, user_metaapi_cache[self.user_id], ttl=30)
        except Exception:
            pass

    async def on_positions_replaced(self, instance_index, positions):
        """전체 포지션 교체 (초기 동기화)"""
        self._ensure_cache()
        pos_list = []
        for pos in positions:
            pos_list.append({
                'id': pos.get('id'),
                'symbol': pos.get('symbol'),
                'type': pos.get('type'),
                'volume': pos.get('volume', 0),
                'openPrice': pos.get('openPrice', 0),
                'currentPrice': pos.get('currentPrice', 0),
                'profit': pos.get('profit', 0),
                'stopLoss': pos.get('stopLoss', 0),
                'takeProfit': pos.get('takeProfit', 0),
                'magic': pos.get('magic', 0),
                'comment': pos.get('comment', ''),
                'time': pos.get('time')
            })
        user_metaapi_cache[self.user_id]["positions"] = pos_list
        user_metaapi_cache[self.user_id]["last_sync"] = time.time()
        # ★ Redis 병행 저장
        try:
            if redis_set_price:
                from ..redis_client import set_user_cache
                set_user_cache(self.user_id, user_metaapi_cache[self.user_id], ttl=30)
        except Exception:
            pass
        print(f"[UserStreaming] User {self.user_id} 포지션 동기화: {len(pos_list)}개")

    async def on_position_updated(self, instance_index, position):
        """포지션 업데이트/추가 (실시간)"""
        self._ensure_cache()
        pos_id = position.get('id')
        pos_data = {
            'id': pos_id,
            'symbol': position.get('symbol'),
            'type': position.get('type'),
            'volume': position.get('volume', 0),
            'openPrice': position.get('openPrice', 0),
            'currentPrice': position.get('currentPrice', 0),
            'profit': position.get('profit', 0),
            'stopLoss': position.get('stopLoss', 0),
            'takeProfit': position.get('takeProfit', 0),
            'magic': position.get('magic', 0),
            'comment': position.get('comment', ''),
            'time': position.get('time')
        }

        positions = user_metaapi_cache[self.user_id].get("positions", [])
        found = False
        for i, existing in enumerate(positions):
            if existing.get('id') == pos_id:
                positions[i] = pos_data
                found = True
                break
        if not found:
            positions.append(pos_data)
            print(f"[UserStreaming] User {self.user_id} ➕ 새 포지션: {pos_data['symbol']} {pos_data['type']}")

        user_metaapi_cache[self.user_id]["positions"] = positions
        user_metaapi_cache[self.user_id]["last_sync"] = time.time()
        # ★ Redis 병행 저장
        try:
            if redis_set_price:
                from ..redis_client import set_user_cache
                set_user_cache(self.user_id, user_metaapi_cache[self.user_id], ttl=30)
        except Exception:
            pass

    async def on_position_removed(self, instance_index, position_id):
        """포지션 청산 (실시간 감지!)"""
        self._ensure_cache()

        # 시작 후 10초 이내 이벤트 무시 (초기 동기화 가짜 이벤트 방지)
        if time.time() - self._start_time < 10:
            print(f"[UserStreaming] User {self.user_id} 초기화 중 — 청산 이벤트 무시: {position_id}")
            return

        positions = user_metaapi_cache[self.user_id].get("positions", [])
        removed_pos = None
        for i, pos in enumerate(positions):
            if pos.get('id') == position_id:
                removed_pos = positions.pop(i)
                break

        user_metaapi_cache[self.user_id]["positions"] = positions
        user_metaapi_cache[self.user_id]["last_sync"] = time.time()
        # ★ Redis 병행 저장
        try:
            if redis_set_price:
                from ..redis_client import set_user_cache
                set_user_cache(self.user_id, user_metaapi_cache[self.user_id], ttl=30)
        except Exception:
            pass

        if removed_pos:
            profit = removed_pos.get('profit', 0)
            symbol = removed_pos.get('symbol', '')
            magic = removed_pos.get('magic', 0)

            # 청산 이벤트 큐에 추가
            if self.user_id not in user_closed_events:
                user_closed_events[self.user_id] = []
            user_closed_events[self.user_id].append({
                "position_id": position_id,
                "profit": profit,
                "symbol": symbol,
                "magic": magic,
                "is_win": profit >= 0,
                "time": time.time()
            })
            print(f"[UserStreaming] User {self.user_id} ❌ 포지션 청산: {symbol} P/L=${profit:.2f} (magic={magic})")
        else:
            print(f"[UserStreaming] User {self.user_id} ❌ 포지션 청산: id={position_id} (캐시에 없음)")

    async def on_deal_added(self, instance_index, deal):
        """거래 추가 (SL/TP 등 청산 거래 감지) — 실제 체결 손익으로 업데이트"""
        if deal.get('entryType') == 'DEAL_ENTRY_OUT':
            profit = deal.get('profit', 0)
            commission = deal.get('commission', 0)
            swap = deal.get('swap', 0)
            total_profit = round(profit + commission + swap, 2)
            position_id = deal.get('positionId') or str(deal.get('position', ''))
            print(f"[UserStreaming] User {self.user_id} 💰 Deal OUT: {deal.get('symbol')} P/L=${total_profit:.2f} (profit={profit}, comm={commission}, swap={swap})")

            # ★★★ user_closed_events의 profit을 실제 체결 금액으로 보정 ★★★
            if self.user_id in user_closed_events:
                for evt in user_closed_events[self.user_id]:
                    if evt.get('position_id') == position_id or (time.time() - evt.get('time', 0)) < 3:
                        old_profit = evt['profit']
                        evt['profit'] = total_profit
                        evt['is_win'] = total_profit >= 0
                        evt['actual'] = True  # 실제 체결 금액 플래그
                        print(f"[UserStreaming] User {self.user_id} ✅ 손익 보정: ${old_profit:.2f} → ${total_profit:.2f}")
                        break

    async def on_positions_synchronized(self, instance_index, synchronization_id):
        if not self._sync_complete:
            self._sync_complete = True
            print(f"[UserStreaming] User {self.user_id} ✅ 포지션 동기화 완료")

    # 필수 빈 메서드들 (SynchronizationListener 인터페이스)
    async def on_synchronization_started(self, instance_index, specifications_hash, positions_hash, orders_hash, synchronization_id):
        pass
    async def on_broker_connection_status_changed(self, instance_index, connected):
        pass
    async def on_pending_orders_replaced(self, instance_index, orders):
        pass
    async def on_pending_orders_synchronized(self, instance_index, synchronization_id):
        pass
    async def on_order_updated(self, instance_index, order):
        pass
    async def on_order_completed(self, instance_index, order_id):
        pass
    async def on_orders_replaced(self, instance_index, orders):
        pass
    async def on_orders_synchronized(self, instance_index, synchronization_id):
        pass
    async def on_history_order_added(self, instance_index, history_order):
        pass
    async def on_deal_synchronization_finished(self, instance_index, synchronization_id):
        pass
    async def on_order_synchronization_finished(self, instance_index, synchronization_id):
        pass
    async def on_symbol_specifications_updated(self, instance_index, specifications, removed_symbols):
        pass
    async def on_symbol_specification_updated(self, instance_index, specification):
        pass
    async def on_symbol_prices_updated(self, instance_index, prices, equity, margin, free_margin, margin_level, account_currency_exchange_rate):
        pass
    async def on_health_status(self, instance_index, status):
        pass
    async def on_symbol_price_updated(self, instance_index, price):
        pass
    async def on_history_orders_synchronized(self, instance_index, synchronization_id):
        pass
    async def on_deals_synchronized(self, instance_index, synchronization_id):
        pass
    async def on_positions_updated(self, instance_index, updated_positions, removed_position_ids):
        """벌크 포지션 업데이트"""
        if updated_positions:
            for pos in updated_positions:
                await self.on_position_updated(instance_index, pos)
        if removed_position_ids:
            for pos_id in removed_position_ids:
                await self.on_position_removed(instance_index, pos_id)


def pop_user_closed_events(user_id: int, magic: int = None) -> List[Dict]:
    """유저의 청산 이벤트 큐에서 꺼내기 (한 번만 소비)"""
    if user_id not in user_closed_events or not user_closed_events[user_id]:
        return []

    events = user_closed_events[user_id]
    if magic is not None:
        # magic 필터링
        matched = [e for e in events if e.get("magic") == magic]
        user_closed_events[user_id] = [e for e in events if e.get("magic") != magic]
        return matched
    else:
        user_closed_events[user_id] = []
        return events


async def get_user_trade_connection(user_id: int, metaapi_account_id: str):
    """
    유저별 Trade RPC + Streaming 연결 가져오기 (없으면 생성)
    - RPC: 주문/청산 실행용
    - Streaming: 실시간 포지션/계정 동기화용 (추가 비용 없음)
    """
    import time as time_module

    # 1. 캐시에 있으면 반환
    if user_id in user_trade_connections:
        conn_data = user_trade_connections[user_id]
        rpc = conn_data.get("rpc")
        if rpc:
            conn_data["last_active"] = time_module.time()
            return rpc

    # 2. 없으면 새로 연결
    if not metaapi_service.api:
        if not await metaapi_service.initialize():
            return None

    try:
        print(f"[MetaAPI Pool] 🔵 User {user_id} RPC 연결 생성: {metaapi_account_id[:8]}...")

        account = await metaapi_service.api.metatrader_account_api.get_account(metaapi_account_id)

        # Deploy 안 되어 있으면 deploy
        if account.state != 'DEPLOYED':
            print(f"[MetaAPI Pool] User {user_id} deploy 필요 (현재: {account.state})")
            await account.deploy()
            await account.wait_connected()

        # 1) RPC 연결 (주문/청산용)
        rpc = account.get_rpc_connection()
        await rpc.connect()
        await rpc.wait_synchronized()
        print(f"[MetaAPI Pool] ✅ User {user_id} RPC 연결 완료")

        # 2) Streaming 연결 (실시간 동기화용 — 추가 비용 없음!)
        streaming = None
        listener = None
        try:
            streaming = account.get_streaming_connection()
            listener = UserStreamingListener(user_id)
            streaming.add_synchronization_listener(listener)
            await streaming.connect()
            await streaming.wait_synchronized()
            print(f"[MetaAPI Pool] ✅ User {user_id} Streaming 연결 완료 (실시간 동기화 활성화)")
        except Exception as stream_err:
            print(f"[MetaAPI Pool] ⚠️ User {user_id} Streaming 연결 실패 (RPC로 fallback): {stream_err}")
            streaming = None

        # 풀에 저장
        user_trade_connections[user_id] = {
            "rpc": rpc,
            "streaming": streaming,
            "listener": listener,
            "account": account,
            "metaapi_account_id": metaapi_account_id,
            "last_active": time_module.time(),
            "connected_at": time_module.time()
        }

        print(f"[MetaAPI Pool] ✅ User {user_id} 연결 완료 (RPC + {'Streaming' if streaming else 'Streaming 없음'})")
        return rpc

    except Exception as e:
        print(f"[MetaAPI Pool] ❌ User {user_id} 연결 실패: {e}")
        return None


async def get_user_account_info(user_id: int, metaapi_account_id: str) -> Optional[Dict]:
    """유저별 계정 정보 조회 (잔고, 자산, 마진 등)"""
    rpc = await get_user_trade_connection(user_id, metaapi_account_id)
    if not rpc:
        return None

    try:
        info = await rpc.get_account_information()
        result = {
            "broker": info.get("broker", ""),
            "balance": info.get("balance", 0),
            "equity": info.get("equity", 0),
            "margin": info.get("margin", 0),
            "freeMargin": info.get("freeMargin", 0) or info.get("free_margin", 0),
            "leverage": info.get("leverage", 0),
            "currency": info.get("currency", "USD"),
            "login": info.get("login", 0)
        }

        # 캐시 업데이트
        if user_id not in user_metaapi_cache:
            user_metaapi_cache[user_id] = {}
        user_metaapi_cache[user_id]["account_info"] = result
        user_metaapi_cache[user_id]["last_sync"] = time.time()
        # ★ Redis 병행 저장
        try:
            if redis_set_price:
                from ..redis_client import set_user_cache
                set_user_cache(user_id, user_metaapi_cache[user_id], ttl=30)
        except Exception:
            pass

        return result
    except Exception as e:
        print(f"[MetaAPI] User {user_id} 계정정보 조회 실패: {e}")
        return user_metaapi_cache.get(user_id, {}).get("account_info")


async def get_user_positions(user_id: int, metaapi_account_id: str) -> List[Dict]:
    """유저별 포지션 목록 조회"""
    rpc = await get_user_trade_connection(user_id, metaapi_account_id)
    if not rpc:
        return []

    try:
        positions = await rpc.get_positions()
        result = positions if positions else []

        # 캐시 업데이트
        if user_id not in user_metaapi_cache:
            user_metaapi_cache[user_id] = {}
        user_metaapi_cache[user_id]["positions"] = result
        user_metaapi_cache[user_id]["last_sync"] = time.time()
        # ★ Redis 병행 저장
        try:
            if redis_set_price:
                from ..redis_client import set_user_cache
                set_user_cache(user_id, user_metaapi_cache[user_id], ttl=30)
        except Exception:
            pass

        return result
    except Exception as e:
        print(f"[MetaAPI] User {user_id} 포지션 조회 실패: {e}")
        return user_metaapi_cache.get(user_id, {}).get("positions", [])


async def place_order_for_user(user_id: int, metaapi_account_id: str, symbol: str, order_type: str, volume: float, sl_points: int = 0, tp_points: int = 0, magic: int = 100000, comment: str = "Trading-X") -> Dict:
    """유저별 MetaAPI 계정으로 주문 실행"""
    rpc = await get_user_trade_connection(user_id, metaapi_account_id)
    if not rpc:
        return {"success": False, "error": "MetaAPI 연결 실패"}

    try:
        # 심볼별 스펙
        SYMBOL_SPECS = {
            "BTCUSD":   {"tick_size": 0.01},
            "ETHUSD":   {"tick_size": 0.01},
            "XAUUSD.r": {"tick_size": 0.01},
            "EURUSD.r": {"tick_size": 0.00001},
            "USDJPY.r": {"tick_size": 0.001},
            "GBPUSD.r": {"tick_size": 0.00001},
            "AUDUSD.r": {"tick_size": 0.00001},
            "USDCAD.r": {"tick_size": 0.00001},
            "US100.":   {"tick_size": 0.01},
        }
        tick_size = SYMBOL_SPECS.get(symbol, {"tick_size": 0.01})["tick_size"]

        options = {'comment': comment, 'magic': magic}

        # SL/TP 가격 계산
        if sl_points > 0 or tp_points > 0:
            price_data = quote_price_cache.get(symbol, {})
            bid = price_data.get('bid', 0)
            ask = price_data.get('ask', 0)

            if bid > 0 and ask > 0:
                if order_type.upper() == 'BUY':
                    if tp_points > 0:
                        options['takeProfit'] = round(ask + (tp_points * tick_size), 5)
                    if sl_points > 0:
                        options['stopLoss'] = round(ask - (sl_points * tick_size), 5)
                else:
                    if tp_points > 0:
                        options['takeProfit'] = round(bid - (tp_points * tick_size), 5)
                    if sl_points > 0:
                        options['stopLoss'] = round(bid + (sl_points * tick_size), 5)

        if order_type.upper() == 'BUY':
            result = await rpc.create_market_buy_order(symbol=symbol, volume=volume, options=options)
        else:
            result = await rpc.create_market_sell_order(symbol=symbol, volume=volume, options=options)

        print(f"[MetaAPI User Order] User {user_id}: {order_type} {symbol} {volume} lot → {result}")

        if result.get('stringCode') == 'TRADE_RETCODE_DONE':
            position_id = result.get('positionId')

            # ★★★ TP/SL 설정 확인 + 실패 시 강제 청산 (안전장치) ★★★
            if position_id and (options.get('stopLoss') or options.get('takeProfit')):
                tp_sl_confirmed = False

                # 1차: modify_position으로 TP/SL 설정
                try:
                    await asyncio.sleep(0.5)
                    modify_result = await rpc.modify_position(
                        position_id=position_id,
                        stop_loss=options.get('stopLoss'),
                        take_profit=options.get('takeProfit')
                    )
                    print(f"[MetaAPI User Order] SL/TP 설정 결과: {modify_result}")
                    if modify_result and modify_result.get('stringCode') == 'TRADE_RETCODE_DONE':
                        tp_sl_confirmed = True
                        print(f"[MetaAPI User Order] ✅ SL/TP 설정 완료")
                    else:
                        print(f"[MetaAPI User Order] ⚠️ SL/TP 설정 응답 불확실: {modify_result}")
                except Exception as mod_err:
                    print(f"[MetaAPI User Order] ❌ SL/TP 1차 실패: {mod_err}")

                # 2차: 실패 시 재시도
                if not tp_sl_confirmed:
                    try:
                        await asyncio.sleep(1.0)
                        modify_result2 = await rpc.modify_position(
                            position_id=position_id,
                            stop_loss=options.get('stopLoss'),
                            take_profit=options.get('takeProfit')
                        )
                        print(f"[MetaAPI User Order] SL/TP 재시도 결과: {modify_result2}")
                        if modify_result2 and modify_result2.get('stringCode') == 'TRADE_RETCODE_DONE':
                            tp_sl_confirmed = True
                            print(f"[MetaAPI User Order] ✅ SL/TP 재시도 성공")
                    except Exception as mod_err2:
                        print(f"[MetaAPI User Order] ❌ SL/TP 2차 실패: {mod_err2}")

                # 3차: 최종 실패 시 강제 청산 (TP/SL 없는 포지션 방지)
                if not tp_sl_confirmed:
                    print(f"[MetaAPI User Order] 🚨 SL/TP 설정 불가! 포지션 강제 청산: {position_id}")
                    try:
                        await rpc.close_position(position_id)
                        return {
                            "success": False,
                            "error": "Target 금액 설정 실패로 안전을 위해 주문이 취소되었습니다. 다시 시도해주세요.",
                            "tp_sl_failed": True
                        }
                    except Exception as close_err:
                        print(f"[MetaAPI User Order] 🚨🚨 강제 청산도 실패!: {close_err}")
                        return {
                            "success": False,
                            "error": "Target 금액 설정 및 청산 모두 실패! MT5에서 수동 청산 필요!",
                            "tp_sl_failed": True,
                            "critical": True
                        }

            return {
                "success": True,
                "positionId": position_id,
                "orderId": result.get('orderId', ''),
                "stringCode": result.get('stringCode')
            }
        else:
            return {
                "success": False,
                "error": result.get('description', result.get('stringCode', 'Unknown')),
                "stringCode": result.get('stringCode')
            }

    except Exception as e:
        print(f"[MetaAPI User Order] ❌ User {user_id} 주문 실패: {e}")
        return {"success": False, "error": str(e)}


async def close_position_for_user(user_id: int, metaapi_account_id: str, position_id: str) -> Dict:
    """유저별 MetaAPI 계정으로 포지션 청산"""
    rpc = await get_user_trade_connection(user_id, metaapi_account_id)
    if not rpc:
        return {"success": False, "error": "MetaAPI 연결 실패"}

    try:
        result = await rpc.close_position(position_id)
        print(f"[MetaAPI User Close] User {user_id}: position {position_id} → {result}")

        if result.get('stringCode') == 'TRADE_RETCODE_DONE':
            return {"success": True, "stringCode": result.get('stringCode')}
        else:
            return {"success": False, "error": result.get('description', 'Unknown')}
    except Exception as e:
        print(f"[MetaAPI User Close] ❌ User {user_id} 청산 실패: {e}")
        return {"success": False, "error": str(e)}


async def get_user_history(user_id: int, metaapi_account_id: str, start_time=None, end_time=None) -> List[Dict]:
    """유저별 MetaAPI 계정에서 거래 히스토리 조회"""
    rpc = await get_user_trade_connection(user_id, metaapi_account_id)
    if not rpc:
        return []

    try:
        if not start_time:
            start_time = datetime.now() - timedelta(days=7)
        if not end_time:
            end_time = datetime.now() + timedelta(minutes=1)

        result = await rpc.get_deals_by_time_range(start_time, end_time)
        deals = result.get('deals', []) if isinstance(result, dict) else result

        history = []
        for deal in deals:
            deal_type_raw = str(deal.get('type', '')).upper()
            entry_type = str(deal.get('entryType', '')).upper()

            # ★★★ 입출금/크레딧/보정 딜 제외 (거래 내역에 포함 금지) ★★★
            if 'BALANCE' in deal_type_raw or 'CREDIT' in deal_type_raw or 'CORRECTION' in deal_type_raw:
                print(f"[MetaAPI UserHistory] 입출금 딜 제외: type={deal_type_raw}, profit={deal.get('profit')}")
                continue

            # ★★★ symbol이 없는 딜도 제외 (입출금은 symbol이 빈 문자열) ★★★
            if not deal.get('symbol'):
                continue

            # ★★★ BUY/SELL 표기 수정 — 청산 딜은 원래 포지션 방향으로 반전 ★★★
            # MT5 규칙: SELL 포지션 청산 → DEAL_TYPE_BUY + DEAL_ENTRY_OUT
            #           BUY 포지션 청산 → DEAL_TYPE_SELL + DEAL_ENTRY_OUT
            # 따라서 청산(OUT) 시 타입을 반전해야 원래 포지션 방향이 됨
            if 'OUT' in entry_type:
                display_type = 'SELL' if 'BUY' in deal_type_raw else 'BUY'
            else:
                display_type = 'BUY' if 'BUY' in deal_type_raw else 'SELL'

            history.append({
                'id': deal.get('id'),
                'symbol': deal.get('symbol'),
                'type': display_type,
                'volume': deal.get('volume'),
                'price': deal.get('price'),
                'profit': deal.get('profit'),
                'commission': deal.get('commission'),
                'swap': deal.get('swap'),
                'time': deal.get('time'),
                'positionId': deal.get('positionId'),
                'orderId': deal.get('orderId'),
                'entryType': deal.get('entryType'),
                'magic': deal.get('magic', 0)
            })

        history.sort(key=lambda x: x.get('time') or datetime.min, reverse=True)
        print(f"[MetaAPI UserHistory] User {user_id}: {len(history)}개 조회")
        return history

    except Exception as e:
        print(f"[MetaAPI UserHistory] User {user_id} 히스토리 조회 실패: {e}")
        return []


# ============================================================
# 비활동 유저 자동 Undeploy 백그라운드 태스크 (★ 스마트 슬롯 관리)
# ============================================================

def _get_deployed_user_count_from_db(db) -> int:
    """DB에서 현재 deployed 유저 수 조회 (시스템 계정 제외)"""
    from ..models.user import User
    return db.query(User).filter(
        User.metaapi_status == 'deployed',
        User.metaapi_account_id.isnot(None),
        ~User.metaapi_account_id.in_(SYSTEM_ACCOUNTS)
    ).count()

def _get_slot_usage_ratio(db) -> float:
    """슬롯 사용률 계산 (0.0 ~ 1.0)"""
    deployed = _get_deployed_user_count_from_db(db)
    max_user_slots = MAX_DEPLOYED_SLOTS - len(SYSTEM_ACCOUNTS)
    if max_user_slots <= 0:
        return 1.0
    return deployed / max_user_slots

async def _evict_least_active_user(db, exclude_user_id=None) -> bool:
    """가장 오래 비활성인 유저 1명 퇴출 (긴급 슬롯 확보용)"""
    from ..models.user import User
    try:
        query = db.query(User).filter(
            User.metaapi_status == 'deployed',
            User.metaapi_account_id.isnot(None),
            ~User.metaapi_account_id.in_(SYSTEM_ACCOUNTS)
        )
        if exclude_user_id:
            query = query.filter(User.id != exclude_user_id)
        # NULL last_active를 먼저 퇴출 (nullsfirst)
        victim = query.order_by(User.metaapi_last_active.asc().nullsfirst()).first()
        if not victim:
            return False
        print(f"[MetaAPI SlotEvict] 🚨 긴급 퇴출: User {victim.id} (last_active={victim.metaapi_last_active})")
        result = await undeploy_user_metaapi(victim.metaapi_account_id)
        if result and result.get("success"):
            victim.metaapi_status = 'undeployed'
            db.commit()
            if victim.id in user_trade_connections:
                del user_trade_connections[victim.id]
            if victim.id in user_metaapi_cache:
                del user_metaapi_cache[victim.id]
            print(f"[MetaAPI SlotEvict] ✅ User {victim.id} 퇴출 완료")
            return True
        return False
    except Exception as e:
        print(f"[MetaAPI SlotEvict] ❌ 퇴출 실패: {e}")
        return False

async def _auto_undeploy_inactive_users():
    """
    3분마다 슬롯 사용률 기반 동적 임계값으로 비활동 유저 undeploy
    - 90%+ → 3분 비활동 퇴출
    - 70%+ → 10분 비활동 퇴출
    - 기본 → 30분 비활동 퇴출
    """
    from ..database import SessionLocal
    from ..models.user import User
    from sqlalchemy import or_
    from datetime import datetime, timedelta

    CHECK_INTERVAL = 3 * 60  # 3분마다 체크

    print("[MetaAPI AutoUndeploy] ★ 스마트 슬롯 관리 태스크 시작")

    while True:
        try:
            await asyncio.sleep(CHECK_INTERVAL)

            db = SessionLocal()
            try:
                usage_ratio = _get_slot_usage_ratio(db)
                deployed_count = _get_deployed_user_count_from_db(db)
                max_user_slots = MAX_DEPLOYED_SLOTS - len(SYSTEM_ACCOUNTS)

                # 슬롯 상태 로그 (색상 이모지)
                if usage_ratio >= SLOT_CRITICAL_RATIO:
                    status_emoji = "🔴"
                    inactivity_threshold = 3 * 60  # 3분
                elif usage_ratio >= SLOT_BUSY_RATIO:
                    status_emoji = "🟠"
                    inactivity_threshold = 10 * 60  # 10분
                elif usage_ratio >= SLOT_WARN_RATIO:
                    status_emoji = "🟡"
                    inactivity_threshold = 10 * 60  # 10분
                else:
                    status_emoji = "🟢"
                    inactivity_threshold = 30 * 60  # 30분

                print(f"[MetaAPI Slots] {status_emoji} {deployed_count}/{max_user_slots} ({usage_ratio*100:.1f}%) — threshold={inactivity_threshold//60}분")

                now = datetime.utcnow()
                threshold_time = now - timedelta(seconds=inactivity_threshold)

                # deployed 상태이고 (마지막 활동이 임계값 이상 OR NULL)인 사용자 조회
                inactive_users = db.query(User).filter(
                    User.metaapi_status == 'deployed',
                    User.metaapi_account_id.isnot(None),
                    ~User.metaapi_account_id.in_(SYSTEM_ACCOUNTS),
                    or_(
                        User.metaapi_last_active < threshold_time,
                        User.metaapi_last_active.is_(None)
                    )
                ).order_by(User.metaapi_last_active.asc().nullsfirst()).all()

                for user in inactive_users:
                    if user.metaapi_account_id:
                        last_active_str = user.metaapi_last_active.strftime('%H:%M:%S') if user.metaapi_last_active else 'NULL'
                        print(f"[MetaAPI AutoUndeploy] User {user.id} 비활동 감지 (last={last_active_str}) - undeploy")
                        try:
                            result = await undeploy_user_metaapi(user.metaapi_account_id)
                            if result and result.get("success"):
                                user.metaapi_status = 'undeployed'
                                db.commit()
                                if user.id in user_trade_connections:
                                    del user_trade_connections[user.id]
                                if user.id in user_metaapi_cache:
                                    del user_metaapi_cache[user.id]
                                print(f"[MetaAPI AutoUndeploy] ✅ User {user.id} undeploy 완료")
                            else:
                                print(f"[MetaAPI AutoUndeploy] ⚠️ User {user.id} undeploy 실패")
                        except Exception as undeploy_err:
                            print(f"[MetaAPI AutoUndeploy] ❌ User {user.id} undeploy 오류: {undeploy_err}")
            finally:
                db.close()

        except Exception as e:
            print(f"[MetaAPI AutoUndeploy] 루프 오류: {e}")
            await asyncio.sleep(60)  # 오류 시 1분 대기 후 재시도


if __name__ == '__main__':
    asyncio.run(test_connection())

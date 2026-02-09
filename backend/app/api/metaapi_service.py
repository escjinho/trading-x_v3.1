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


def add_closed_event(position_id: str, symbol: str, profit: float, reason: str = 'closed'):
    """청산 이벤트 추가 (중복 방지)"""
    global metaapi_closed_events

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


def update_candle_realtime(symbol: str, current_price: float):
    """실시간 캔들 업데이트"""
    global quote_candle_cache

    if current_price <= 0:
        return

    current_ts = int(time.time())
    candle_time = current_ts - (current_ts % 60)  # 1분 단위 정렬

    if symbol not in quote_candle_cache:
        quote_candle_cache[symbol] = {"M1": []}

    if "M1" not in quote_candle_cache[symbol]:
        quote_candle_cache[symbol]["M1"] = []

    candles = quote_candle_cache[symbol]["M1"]

    if candles and candles[-1].get('time') == candle_time:
        # 현재 캔들 업데이트
        candles[-1]['close'] = current_price
        candles[-1]['high'] = max(candles[-1]['high'], current_price)
        candles[-1]['low'] = min(candles[-1]['low'], current_price)
    else:
        # 새 캔들 추가
        new_candle = {
            'time': candle_time,
            'open': current_price,
            'high': current_price,
            'low': current_price,
            'close': current_price,
            'volume': 0
        }
        candles.append(new_candle)
        # 최대 200개 유지
        if len(candles) > 200:
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

        # 2. 캔들 실시간 업데이트
        if bid and bid > 0:
            update_candle_realtime(symbol, bid)

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
        pass

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

        return prices

    async def get_candles(self, symbol: str, timeframe: str = "M1", count: int = 100) -> List[Dict]:
        """캔들 데이터 조회 - 현재 가격 기반 합성"""
        global quote_candle_cache, quote_price_cache

        # MetaAPI RPC에서 캔들 조회가 어려우므로 현재가 기반 합성
        # TODO: 히스토리 API 사용 검토
        try:
            current_ts = int(time.time())
            candle_time = current_ts - (current_ts % 60)  # 1분 단위 정렬

            price_data = quote_price_cache.get(symbol, {})
            current_price = price_data.get('bid', 0)

            if current_price > 0:
                # 기존 캔들 있으면 업데이트, 없으면 새로 생성
                if symbol in quote_candle_cache and timeframe in quote_candle_cache[symbol]:
                    candles = quote_candle_cache[symbol][timeframe]
                    if candles and candles[-1].get('time') == candle_time:
                        # 현재 캔들 업데이트
                        candles[-1]['close'] = current_price
                        candles[-1]['high'] = max(candles[-1]['high'], current_price)
                        candles[-1]['low'] = min(candles[-1]['low'], current_price)
                    else:
                        # 새 캔들 추가
                        candles.append({
                            'time': candle_time,
                            'open': current_price,
                            'high': current_price,
                            'low': current_price,
                            'close': current_price,
                            'volume': 0
                        })
                        # 최대 100개 유지
                        if len(candles) > 100:
                            candles.pop(0)
                else:
                    # 캐시 초기화
                    if symbol not in quote_candle_cache:
                        quote_candle_cache[symbol] = {}
                    quote_candle_cache[symbol][timeframe] = [{
                        'time': candle_time,
                        'open': current_price,
                        'high': current_price,
                        'low': current_price,
                        'close': current_price,
                        'volume': 0
                    }]

            return quote_candle_cache.get(symbol, {}).get(timeframe, [])

        except Exception as e:
            print(f"[MetaAPI] 캔들 생성 실패 ({symbol} {timeframe}): {e}")
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

                # ★★★ 주문 성공 후 SL/TP 설정 (별도 요청) ★★★
                if position_id and (options.get('stopLoss') or options.get('takeProfit')):
                    try:
                        await asyncio.sleep(0.5)  # 포지션 생성 대기
                        modify_result = await self.trade_connection.modify_position(
                            position_id=position_id,
                            stop_loss=options.get('stopLoss'),
                            take_profit=options.get('takeProfit')
                        )
                        print(f"[MetaAPI] SL/TP 수정 결과: {modify_result}")
                    except Exception as e:
                        print(f"[MetaAPI] SL/TP 수정 실패 (주문은 성공): {e}")

                return {
                    'success': True,
                    'orderId': result.get('orderId'),
                    'positionId': position_id,
                    'message': f"{order_type.upper()} 주문 성공"
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
        """포지션 청산"""
        if not self.trade_connection:
            if not await self.connect_trade_account():
                return {'success': False, 'error': 'Trade 계정 연결 실패'}

        try:
            result = await self.trade_connection.close_position(position_id)

            if result.get('stringCode') == 'TRADE_RETCODE_DONE':
                return {
                    'success': True,
                    'positionId': position_id,
                    'message': '청산 성공'
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
        """거래 히스토리 조회"""
        if not self.trade_connection:
            if not await self.connect_trade_account():
                return []

        try:
            if not start_time:
                start_time = datetime.now() - timedelta(days=30)
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

    # 모든 심볼의 시세
    all_prices = quote_price_cache.copy()

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

        # 2. Trade 계정 연결 (시세 조회용)
        if not await metaapi_service.connect_trade_account():
            print("[MetaAPI Startup] Trade 계정 연결 실패")
            return False

        # 3. 초기 시세 조회
        prices = await metaapi_service.get_all_prices()
        print(f"[MetaAPI Startup] 초기 시세 조회 완료: {len(prices)}개 심볼")

        # 4. 초기 캔들 조회 (인디케이터용)
        await metaapi_service.update_all_candles("M1")
        print("[MetaAPI Startup] 초기 캔들 조회 완료")

        # 5. 시세 업데이트 루프 시작
        await metaapi_service.start_price_update_loop(interval=2.0)

        # 6. 포지션 동기화 루프 시작 (30초 주기)
        await metaapi_service.start_position_sync_loop(interval=30.0)

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


if __name__ == '__main__':
    asyncio.run(test_connection())

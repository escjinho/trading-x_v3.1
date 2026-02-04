# mt5_bridge.py - Windows에서 실행
# MT5 시세 데이터를 Linux 서버로 전송

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False
import requests
import time
from datetime import datetime

# ========= 설정 =========
SERVER_URL = "https://trading-x.ai"  # Linux 서버 주소

SYMBOLS = [
    "BTCUSD",
    "ETHUSD",
    "EURUSD.r",
    "USDJPY.r",
    "GBPUSD.r",
    "AUDUSD.r",
    "USDCAD.r",
    "XAUUSD.r",
    "US100.",
]

# 모든 타임프레임 정의
TIMEFRAMES = {}
if MT5_AVAILABLE:
    TIMEFRAMES = {
        "M1": mt5.TIMEFRAME_M1,
        "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15,
        "M30": mt5.TIMEFRAME_M30,
        "H1": mt5.TIMEFRAME_H1,
        "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1,
    }

INTERVAL = 0.5  # 시세 전송 주기 (초) - 실시간 업데이트용
CANDLE_INTERVAL = 60  # 캔들 전송 주기 (초)

def init_mt5():
    """MT5 초기화"""
    if not MT5_AVAILABLE:
        print("MetaTrader5 모듈이 설치되지 않았습니다.")
        return False

    if not mt5.initialize():
        print(f"MT5 초기화 실패: {mt5.last_error()}")
        return False

    account_info = mt5.account_info()
    if account_info:
        print(f"MT5 연결 성공: {account_info.login} @ {account_info.server}")
    return True

def send_quote(symbol: str):
    """심볼의 현재 시세를 서버로 전송"""
    tick = mt5.symbol_info_tick(symbol)
    if not tick:
        return False

    data = {
        "bid": tick.bid,
        "ask": tick.ask,
        "last": tick.last,
        "volume": tick.volume,
        "time": tick.time
    }

    try:
        url = f"{SERVER_URL}/api/mt5/bridge/{symbol}"
        response = requests.post(url, json=data, timeout=5)
        return response.status_code == 200
    except:
        return False

def send_candles(symbol: str, timeframe: str, count: int = 1000):
    """심볼의 캔들 히스토리를 서버로 전송 (타임프레임 포함)"""
    tf = TIMEFRAMES.get(timeframe)
    if tf is None:
        return False

    rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
    if rates is None or len(rates) == 0:
        return False

    candles = []
    for r in rates:
        candles.append({
            "time": int(r['time']),
            "open": float(r['open']),
            "high": float(r['high']),
            "low": float(r['low']),
            "close": float(r['close']),
            "volume": int(r['tick_volume'])
        })

    try:
        # 타임프레임을 URL에 포함
        url = f"{SERVER_URL}/api/mt5/bridge/{symbol}/candles/{timeframe}"
        response = requests.post(url, json=candles, timeout=10)

        if response.status_code == 200:
            result = response.json()
            return True
        else:
            print(f"[{symbol}/{timeframe}] 캔들 전송 실패: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"[{symbol}/{timeframe}] 캔들 전송 오류: {e}")
        return False

# ★★★ 추가 시작 ★★★
def send_symbol_info(symbol: str):
    """심볼의 계약 정보를 서버로 전송 (손익 계산용)"""
    info = mt5.symbol_info(symbol)
    if not info:
        return False

    data = {
        "symbol": symbol,
        "contract_size": info.trade_contract_size,
        "tick_size": info.trade_tick_size,
        "tick_value": info.trade_tick_value,
        "digits": info.digits,
        "volume_min": info.volume_min,
        "volume_max": info.volume_max,
        "volume_step": info.volume_step,
    }

    try:
        url = f"{SERVER_URL}/api/mt5/bridge/{symbol}/info"
        response = requests.post(url, json=data, timeout=5)
        return response.status_code == 200
    except Exception as e:
        print(f"[{symbol}] symbol_info 전송 오류: {e}")
        return False

def send_all_symbol_info():
    """모든 심볼의 계약 정보 전송"""
    print("\n심볼 계약 정보 전송 중...")
    success = 0
    for symbol in SYMBOLS:
        if send_symbol_info(symbol):
            print(f"  [OK] {symbol} symbol_info")
            success += 1
        else:
            print(f"  [FAIL] {symbol} symbol_info")
    return success
# ★★★ 추가 끝 ★★★

def send_account_info():
    """MT5 계정 정보를 서버로 전송"""
    account = mt5.account_info()
    if not account:
        return False

    data = {
        "broker": account.company,
        "login": account.login,
        "server": account.server,
        "balance": account.balance,
        "equity": account.equity,
        "margin": account.margin,
        "free_margin": account.margin_free,
        "leverage": account.leverage
    }

    try:
        url = f"{SERVER_URL}/api/mt5/bridge/account"
        response = requests.post(url, json=data, timeout=5)
        return response.status_code == 200
    except Exception as e:
        print(f"[Account] 전송 오류: {e}")
        return False
    
def send_all_candles(symbol: str, count: int = 1000):
    """모든 타임프레임의 캔들 전송"""
    success = 0
    for tf_name in TIMEFRAMES.keys():
        if send_candles(symbol, tf_name, count):
            success += 1
    return success


# ========== 주문 처리 함수들 ==========
def fetch_pending_orders():
    """서버에서 대기 중인 주문 가져오기"""
    try:
        url = f"{SERVER_URL}/api/mt5/bridge/orders/pending"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            return data.get("orders", [])
    except Exception as e:
        print(f"[Order] 주문 조회 오류: {e}")
    return []


def execute_order(order_data: dict):
    """MT5에서 주문 실행"""
    symbol = order_data.get("symbol", "BTCUSD")
    order_type = order_data.get("order_type", "BUY")
    volume = order_data.get("volume", 0.01)
    magic = order_data.get("magic", 100001)

    tick = mt5.symbol_info_tick(symbol)
    if not tick:
        return {"success": False, "message": "가격 정보 없음"}

    if order_type == "BUY":
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
        "comment": f"Trading-X {order_type}",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request)

    if result and result.retcode == mt5.TRADE_RETCODE_DONE:
        return {
            "success": True,
            "message": f"{order_type} 성공! {volume} lot @ {result.price:,.2f}",
            "ticket": result.order,
            "price": result.price
        }
    else:
        error_code = result.retcode if result else "Unknown"
        error_comment = result.comment if result else "No result"
        return {
            "success": False,
            "message": f"주문 실패: {error_code} - {error_comment}"
        }


def execute_close(order_data: dict):
    """MT5에서 포지션 청산"""
    symbol = order_data.get("symbol", "BTCUSD")
    magic = order_data.get("magic")

    positions = mt5.positions_get(symbol=symbol)
    if not positions:
        return {"success": False, "message": "열린 포지션 없음"}

    for pos in positions:
        if magic is not None and pos.magic != magic:
            continue

        tick = mt5.symbol_info_tick(symbol)
        if not tick:
            continue

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

        if result and result.retcode == mt5.TRADE_RETCODE_DONE:
            return {
                "success": True,
                "message": f"청산 성공! P/L: ${pos.profit:,.2f}",
                "profit": pos.profit
            }

    return {"success": False, "message": "청산 실패"}


def send_order_result(order_id: str, result: dict):
    """주문 결과를 서버로 전송"""
    try:
        result["order_id"] = order_id
        url = f"{SERVER_URL}/api/mt5/bridge/orders/result"
        response = requests.post(url, json=result, timeout=5)
        return response.status_code == 200
    except Exception as e:
        print(f"[Order] 결과 전송 오류: {e}")
        return False


def process_pending_orders():
    """대기 중인 주문 처리"""
    orders = fetch_pending_orders()

    for order_data in orders:
        order_id = order_data.get("order_id")
        action = order_data.get("action")

        print(f"\n[Order] 처리 중: {order_id} - {action}")

        if action == "order":
            result = execute_order(order_data)
        elif action == "close":
            result = execute_close(order_data)
        else:
            result = {"success": False, "message": f"알 수 없는 액션: {action}"}

        # 결과 전송
        send_order_result(order_id, result)
        print(f"[Order] 완료: {order_id} - {result.get('success')} - {result.get('message')}")


def main():
    print("=" * 50)
    print("MT5 Bridge - Windows to Linux")
    print(f"Server: {SERVER_URL}")
    print(f"Timeframes: {', '.join(TIMEFRAMES.keys())}")
    print("=" * 50)

    # MT5 초기화
    if not init_mt5():
        return

    # 심볼 활성화
    print("\n심볼 활성화 중...")
    for symbol in SYMBOLS:
        if mt5.symbol_select(symbol, True):
            print(f"  [OK] {symbol}")
        else:
            print(f"  [FAIL] {symbol}")

    # ★★★ 추가 ★★★
    send_all_symbol_info()

    # 초기 캔들 히스토리 전송 (모든 타임프레임)
    print("\n캔들 히스토리 전송 중 (모든 타임프레임)...")
    for symbol in SYMBOLS:
        tf_count = send_all_candles(symbol, 1000)
        print(f"  [{symbol}] {tf_count}/{len(TIMEFRAMES)} 타임프레임 전송 완료")

    print(f"\n실시간 시세 전송 시작 (주기: {INTERVAL}초)")
    print("-" * 50)

    last_candle_update = time.time()

    # 실시간 시세 전송 루프
    while True:
        try:
            success_count = 0
            for symbol in SYMBOLS:
                if send_quote(symbol):
                    success_count += 1

            # ★ 계정 정보도 함께 전송
            send_account_info()

            # ★ 대기 중인 주문 처리
            process_pending_orders()

            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] {success_count}/{len(SYMBOLS)} 심볼 + Account 전송", end="\r")

            # 주기적으로 캔들 업데이트 (1분마다)
            if time.time() - last_candle_update > CANDLE_INTERVAL:
                print(f"\n[{timestamp}] 캔들 데이터 업데이트...")
                for symbol in SYMBOLS:
                    # M1, M5만 자주 업데이트 (나머지는 초기 로드로 충분)
                    send_candles(symbol, "M1", 100)
                    send_candles(symbol, "M5", 100)
                last_candle_update = time.time()

            time.sleep(INTERVAL)
        except KeyboardInterrupt:
            print("\n\n브릿지 종료...")
            break
        except Exception as e:
            print(f"\n오류: {e}")
            time.sleep(5)

    mt5.shutdown()

if __name__ == "__main__":
    main()

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

INTERVAL = 1  # 시세 전송 주기 (초)
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

def send_all_candles(symbol: str, count: int = 1000):
    """모든 타임프레임의 캔들 전송"""
    success = 0
    for tf_name in TIMEFRAMES.keys():
        if send_candles(symbol, tf_name, count):
            success += 1
    return success

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

            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] {success_count}/{len(SYMBOLS)} 심볼 전송 완료", end="\r")

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

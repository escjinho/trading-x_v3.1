try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False
import requests
import time
from datetime import datetime

SERVER_URL = "https://trading-x.ai"

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

INTERVAL = 1

def init_mt5():
    if not mt5.initialize():
        print(f"MT5 초기화 실패: {mt5.last_error()}")
        return False
    account_info = mt5.account_info()
    if account_info:
        print(f"MT5 연결 성공: {account_info.login} @ {account_info.server}")
    return True

def send_quote(symbol):
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

def send_candles(symbol, count=200):
    rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, count)
    if rates is None or len(rates) == 0:
        print(f"[{symbol}] 캔들 데이터 없음")
        return False
    candles = []
    for r in rates:
        candles.append({
            "time": int(r['time']),
            "open": float(r['open']),
            "high": float(r['high']),
            "low": float(r['low']),
            "close": float(r['close']),
            "volume": float(r['tick_volume'])
        })
    try:
        url = f"{SERVER_URL}/api/mt5/bridge/{symbol}/candles"
        response = requests.post(url, json=candles, timeout=10)
        if response.status_code == 200:
            print(f"[{symbol}] 캔들 전송 완료")
            return True
        return False
    except:
        return False

def main():
    print("=" * 50)
    print("MT5 Bridge - Windows to Linux")
    print("=" * 50)
    if not init_mt5():
        return
    for symbol in SYMBOLS:
        mt5.symbol_select(symbol, True)
    print("\n캔들 히스토리 전송 중...")
    for symbol in SYMBOLS:
        send_candles(symbol, 200)
    print(f"\n실시간 시세 전송 시작 (주기: {INTERVAL}초)")
    while True:
        try:
            success_count = 0
            for symbol in SYMBOLS:
                if send_quote(symbol):
                    success_count += 1
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] {success_count}/{len(SYMBOLS)} 심볼 전송 완료", end="\r")
            time.sleep(INTERVAL)
        except KeyboardInterrupt:
            print("\n브릿지 종료...")
            break
    mt5.shutdown()

if __name__ == "__main__":
    main()
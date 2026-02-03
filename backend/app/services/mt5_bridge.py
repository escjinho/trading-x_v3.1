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

INTERVAL = 1  # 전송 주기 (초)

def init_mt5():
    """MT5 초기화"""
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
    
    # 시세 데이터 구성
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
        
        if response.status_code == 200:
            result = response.json()
            return True
        else:
            print(f"[{symbol}] 전송 실패: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"[{symbol}] 연결 오류: {e}")
        return False

def send_candles(symbol: str, count: int = 200):
    """심볼의 캔들 히스토리를 서버로 전송 (초기 로드용)"""
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
            result = response.json()
            print(f"[{symbol}] 캔들 {result.get('total_candles', 0)}개 전송 완료")
            return True
        else:
            print(f"[{symbol}] 캔들 전송 실패: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"[{symbol}] 캔들 전송 오류: {e}")
        return False

def main():
    print("=" * 50)
    print("MT5 Bridge - Windows to Linux")
    print("=" * 50)
    
    # MT5 초기화
    if not init_mt5():
        return
    
    # 심볼 활성화
    for symbol in SYMBOLS:
        if not mt5.symbol_select(symbol, True):
            print(f"[{symbol}] 심볼 활성화 실패")
    
    # 초기 캔들 히스토리 전송
    print("\n캔들 히스토리 전송 중...")
    for symbol in SYMBOLS:
        send_candles(symbol, 200)
    
    print(f"\n실시간 시세 전송 시작 (주기: {INTERVAL}초)")
    print("-" * 50)
    
    # 실시간 시세 전송 루프
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
            print("\n\n브릿지 종료...")
            break
        except Exception as e:
            print(f"\n오류: {e}")
            time.sleep(5)
    
    mt5.shutdown()

if __name__ == "__main__":
    main()
```

---

### 3단계: 저장 후 실행

메모장에서 **Ctrl + S** 저장 후:
```
python mt5_bridge.py
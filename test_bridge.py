"""
MT5 Bridge 테스트 스크립트
브릿지가 제대로 작동하는지 확인합니다
"""

import sys
from pathlib import Path

# 프로젝트 경로를 Python Path에 추가
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root / "backend"))

import MetaTrader5 as mt5
import httpx
import asyncio
from datetime import datetime


async def test_mt5_connection():
    """MT5 연결 테스트"""
    print("=" * 60)
    print("1. MT5 연결 테스트")
    print("=" * 60)

    # MT5 초기화
    if not mt5.initialize():
        print("❌ MT5 초기화 실패")
        print(f"   오류: {mt5.last_error()}")
        return False

    print("✅ MT5 초기화 성공")

    # 계정 정보 확인
    account = mt5.account_info()
    if account:
        print(f"   계정: {account.login}")
        print(f"   서버: {account.server}")
        print(f"   잔고: {account.balance} {account.currency}")
    else:
        print("⚠️  계정 정보 없음 (로그인 필요할 수 있음)")

    mt5.shutdown()
    print()
    return True


def test_symbol_availability():
    """심볼 가용성 테스트"""
    print("=" * 60)
    print("2. 심볼 가용성 테스트")
    print("=" * 60)

    if not mt5.initialize():
        print("❌ MT5 초기화 실패")
        return False

    symbols = [
        "BTCUSD",
        "EURUSD.r",
        "USDJPY.r",
        "XAUUSD.r",
        "US100.",
        "GBPUSD.r",
        "AUDUSD.r",
        "USDCAD.r",
        "ETHUSD"
    ]

    available_count = 0
    for symbol in symbols:
        # 심볼 선택 시도
        if mt5.symbol_select(symbol, True):
            # 시세 확인
            tick = mt5.symbol_info_tick(symbol)
            if tick:
                print(f"✅ {symbol:12} - Bid: {tick.bid}, Ask: {tick.ask}")
                available_count += 1
            else:
                print(f"⚠️  {symbol:12} - 심볼 선택됨, 시세 없음")
        else:
            print(f"❌ {symbol:12} - 심볼 없음")

    mt5.shutdown()
    print(f"\n사용 가능한 심볼: {available_count}/{len(symbols)}")
    print()
    return available_count > 0


def test_candle_data():
    """캔들 데이터 수집 테스트"""
    print("=" * 60)
    print("3. 캔들 데이터 수집 테스트")
    print("=" * 60)

    if not mt5.initialize():
        print("❌ MT5 초기화 실패")
        return False

    symbol = "BTCUSD"
    print(f"테스트 심볼: {symbol}")

    # 캔들 데이터 가져오기
    rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M15, 0, 10)

    if rates is None or len(rates) == 0:
        print(f"❌ 캔들 데이터 없음")
        mt5.shutdown()
        return False

    print(f"✅ 캔들 데이터 수집 성공 ({len(rates)}개)")
    print(f"\n최신 캔들:")
    latest = rates[-1]
    print(f"   시간: {datetime.fromtimestamp(latest['time'])}")
    print(f"   시가: {latest['open']}")
    print(f"   고가: {latest['high']}")
    print(f"   저가: {latest['low']}")
    print(f"   종가: {latest['close']}")
    print(f"   볼륨: {latest['tick_volume']}")

    mt5.shutdown()
    print()
    return True


async def test_server_connection():
    """Linux 서버 연결 테스트"""
    print("=" * 60)
    print("4. Linux 서버 연결 테스트")
    print("=" * 60)

    server_url = "http://158.247.251.146:8000"
    print(f"서버 주소: {server_url}")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Health check
            response = await client.get(f"{server_url}/health")

            if response.status_code == 200:
                print("✅ 서버 연결 성공")
                print(f"   응답: {response.json()}")
            else:
                print(f"⚠️  서버 응답 이상: {response.status_code}")

    except httpx.ConnectError:
        print("❌ 서버 연결 실패 (네트워크 오류)")
        return False
    except httpx.TimeoutException:
        print("❌ 서버 연결 시간 초과")
        return False
    except Exception as e:
        print(f"❌ 오류 발생: {e}")
        return False

    print()
    return True


async def test_data_transmission():
    """데이터 전송 테스트"""
    print("=" * 60)
    print("5. 데이터 전송 테스트")
    print("=" * 60)

    if not mt5.initialize():
        print("❌ MT5 초기화 실패")
        return False

    symbol = "BTCUSD"
    print(f"테스트 심볼: {symbol}")

    # 캔들 데이터 수집
    rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M15, 0, 10)
    if rates is None or len(rates) == 0:
        print("❌ 캔들 데이터 없음")
        mt5.shutdown()
        return False

    candles = []
    for rate in rates:
        candles.append({
            "time": int(rate['time']),
            "open": float(rate['open']),
            "high": float(rate['high']),
            "low": float(rate['low']),
            "close": float(rate['close']),
            "volume": int(rate['tick_volume'])
        })

    # 시세 데이터 수집
    tick = mt5.symbol_info_tick(symbol)
    if not tick:
        print("❌ 시세 데이터 없음")
        mt5.shutdown()
        return False

    tick_data = {
        "symbol": symbol,
        "bid": tick.bid,
        "ask": tick.ask,
        "last": tick.last,
        "time": datetime.fromtimestamp(tick.time).isoformat()
    }

    # 전송 데이터 구성
    data = {
        "symbol": symbol,
        "candles": candles,
        "tick": tick_data,
        "timestamp": datetime.now().isoformat()
    }

    print(f"✅ 전송 데이터 준비 완료")
    print(f"   캔들: {len(candles)}개")
    print(f"   현재가: {tick.bid}")

    # 서버로 전송
    try:
        server_url = "http://158.247.251.146:8000"
        url = f"{server_url}/api/mt5/bridge/{symbol}"

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, json=data)

            if response.status_code == 200:
                print("✅ 데이터 전송 성공")
                result = response.json()
                print(f"   응답: {result}")
            else:
                print(f"❌ 전송 실패: {response.status_code}")
                print(f"   응답: {response.text}")

    except Exception as e:
        print(f"❌ 전송 오류: {e}")
        mt5.shutdown()
        return False

    mt5.shutdown()
    print()
    return True


async def main():
    """메인 테스트 함수"""
    print("\n")
    print("╔" + "═" * 58 + "╗")
    print("║" + " " * 15 + "MT5 Bridge 테스트" + " " * 25 + "║")
    print("╚" + "═" * 58 + "╝")
    print()

    results = []

    # 1. MT5 연결 테스트
    results.append(("MT5 연결", await test_mt5_connection()))

    # 2. 심볼 가용성 테스트
    results.append(("심볼 가용성", test_symbol_availability()))

    # 3. 캔들 데이터 수집 테스트
    results.append(("캔들 데이터", test_candle_data()))

    # 4. Linux 서버 연결 테스트
    results.append(("서버 연결", await test_server_connection()))

    # 5. 데이터 전송 테스트
    results.append(("데이터 전송", await test_data_transmission()))

    # 결과 요약
    print("=" * 60)
    print("테스트 결과 요약")
    print("=" * 60)

    passed = 0
    for name, result in results:
        status = "✅ 통과" if result else "❌ 실패"
        print(f"{name:20} : {status}")
        if result:
            passed += 1

    print(f"\n총 {len(results)}개 테스트 중 {passed}개 통과")

    if passed == len(results):
        print("\n🎉 모든 테스트 통과! 브릿지를 실행할 수 있습니다.")
        print("   실행 명령: run_bridge.bat 또는 python run_bridge.py")
    else:
        print("\n⚠️  일부 테스트 실패. BRIDGE_SETUP_GUIDE.md를 참조하세요.")

    print()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n테스트가 중단되었습니다.")
    except Exception as e:
        print(f"\n\n오류 발생: {e}")
        sys.exit(1)

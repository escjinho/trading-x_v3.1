#!/usr/bin/env python3
"""
WS 데이터 10초간 캡처 - 캔들 방향 vs score 검증
"""
import asyncio
import websockets
import json

async def capture_ws_data():
    uri = "ws://localhost:8000/api/mt5/ws"

    print("=" * 80)
    print("WS 인디케이터 데이터 캡처 (10초간)")
    print("=" * 80)
    print(f"{'Time':<8} {'Buy':>5} {'Sell':>5} {'Score':>7} {'Direction':>10} {'Match':>7}")
    print("-" * 80)

    try:
        async with websockets.connect(uri) as ws:
            start_time = asyncio.get_event_loop().time()
            count = 0
            errors = 0

            while (asyncio.get_event_loop().time() - start_time) < 10:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
                    data = json.loads(msg)

                    buy = data.get('buy_count', 0)
                    sell = data.get('sell_count', 0)
                    score = data.get('base_score', 0)

                    # score 기반 방향
                    if score > 50:
                        score_dir = "BUY"
                    elif score < 50:
                        score_dir = "SELL"
                    else:
                        score_dir = "NEUTRAL"

                    # Buy/Sell 숫자 기반 방향
                    if buy > sell:
                        num_dir = "BUY"
                    elif sell > buy:
                        num_dir = "SELL"
                    else:
                        num_dir = "NEUTRAL"

                    match = score_dir == num_dir
                    elapsed = asyncio.get_event_loop().time() - start_time

                    match_str = "✓" if match else "✗ MISMATCH"
                    if not match:
                        errors += 1

                    print(f"{elapsed:>6.1f}s {buy:>5} {sell:>5} {score:>7.1f} {score_dir:>10} {match_str:>7}")
                    count += 1

                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    print(f"Error: {e}")
                    break

            print("-" * 80)
            print(f"총 {count}개 메시지 수신, {errors}개 불일치")

            if errors == 0:
                print("\n✅ 모든 데이터 일치! score와 Buy/Sell 숫자 동기화됨.")
            else:
                print(f"\n❌ {errors}개 불일치 발견!")

    except Exception as e:
        print(f"연결 오류: {e}")


if __name__ == '__main__':
    asyncio.run(capture_ws_data())

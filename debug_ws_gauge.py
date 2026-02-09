#!/usr/bin/env python3
"""
WS 데이터 10초간 캡처 - 게이지 score vs buy/sell 검증
"""
import asyncio
import websockets
import json

async def capture_ws_data():
    uri = "ws://localhost:8000/api/mt5/ws"

    print("=" * 70)
    print("WS 게이지 데이터 캡처 (10초간)")
    print("=" * 70)
    print(f"{'Time':<10} {'Buy':>5} {'Sell':>5} {'Score':>7} {'Expected':>10} {'Match':>7}")
    print("-" * 70)

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

                    # 예상 score 계산: 50 + (buy - sell) * 0.5
                    diff = buy - sell
                    expected = 50 + int(diff * 0.5)
                    expected = max(5, min(95, expected))

                    # 방향 일치 확인
                    score_direction = "BUY" if score > 50 else ("SELL" if score < 50 else "NEUTRAL")
                    expected_direction = "BUY" if buy > sell else ("SELL" if sell > buy else "NEUTRAL")
                    match = score_direction == expected_direction

                    elapsed = asyncio.get_event_loop().time() - start_time

                    match_str = "✓" if match else "✗ MISMATCH"
                    if not match:
                        errors += 1

                    print(f"{elapsed:>8.1f}s {buy:>5} {sell:>5} {score:>7.1f} {expected:>10} {match_str:>7}")
                    count += 1

                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    print(f"Error: {e}")
                    break

            print("-" * 70)
            print(f"총 {count}개 메시지 수신, {errors}개 불일치")

            if errors == 0:
                print("\n✅ 모든 데이터가 일치합니다! 게이지 방향 버그 수정됨.")
            else:
                print(f"\n❌ {errors}개 불일치 발견! 추가 디버깅 필요.")

    except Exception as e:
        print(f"연결 오류: {e}")


if __name__ == '__main__':
    asyncio.run(capture_ws_data())

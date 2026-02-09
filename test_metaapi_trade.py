#!/usr/bin/env python3
"""
MetaAPI Trade 계정 주문 테스트 스크립트
BTCUSD 0.01 lot BUY 주문 -> 5초 대기 -> 청산
"""

import asyncio
import os
import time
from datetime import datetime
from dotenv import load_dotenv
from metaapi_cloud_sdk import MetaApi

# .env 파일 로드
load_dotenv('/var/www/trading-x/.env')

# MetaAPI 설정
API_TOKEN = os.environ.get('METAAPI_TOKEN')
ACCOUNT_ID = 'ab8b3c02-5390-4d9a-b879-8b8c86f1ebf5'

# 테스트 설정
SYMBOL = 'BTCUSD'
VOLUME = 0.01
ORDER_TYPE = 'ORDER_TYPE_BUY'


async def main():
    start_time = time.time()

    print("=" * 60)
    print("MetaAPI Trade 계정 주문 테스트")
    print("=" * 60)
    print(f"Account ID: {ACCOUNT_ID}")
    print(f"Symbol: {SYMBOL}")
    print(f"Volume: {VOLUME} lot")
    print(f"Type: BUY")
    print("=" * 60)

    if not API_TOKEN:
        print("\n⚠️  API_TOKEN을 .env 파일에 설정해주세요!")
        return

    api = MetaApi(API_TOKEN)
    account = None
    connection = None

    try:
        # 1. 계정 연결
        print("\n[1] 계정 연결 중...")
        account = await api.metatrader_account_api.get_account(ACCOUNT_ID)

        print(f"    계정 상태: {account.state}")
        print(f"    연결 상태: {account.connection_status}")

        # 계정 배포 (필요시)
        if account.state != 'DEPLOYED':
            print("    계정 배포 중...")
            await account.deploy()

        # 계정 연결 대기
        print("    계정 연결 대기 중...")
        await account.wait_connected()

        # RPC 연결 생성 (거래용)
        connection = account.get_rpc_connection()
        await connection.connect()
        await connection.wait_synchronized()

        print("    ✓ 연결 완료")

        # 2. BUY 주문 실행
        print(f"\n[2] {SYMBOL} {VOLUME} lot BUY 주문 실행 중...")
        order_start = time.time()

        order_result = await connection.create_market_buy_order(
            symbol=SYMBOL,
            volume=VOLUME
        )

        order_time = time.time() - order_start

        print("\n    ========== 주문 결과 ==========")
        print(f"    전체 응답: {order_result}")
        print(f"    Order ID: {order_result.get('orderId', 'N/A')}")
        print(f"    Position ID: {order_result.get('positionId', 'N/A')}")
        print(f"    Status: {order_result.get('stringCode', 'N/A')}")
        print(f"    주문 소요시간: {order_time:.3f}초")
        print("    ================================")

        # 포지션 정보 조회
        await asyncio.sleep(0.5)
        positions = await connection.get_positions()
        for pos in positions:
            if str(pos.get('id')) == str(order_result.get('positionId')):
                print(f"\n    ========== 포지션 상세 ==========")
                print(f"    Symbol: {pos.get('symbol')}")
                print(f"    Type: {pos.get('type')}")
                print(f"    Volume: {pos.get('volume')}")
                print(f"    Open Price: {pos.get('openPrice')}")
                print(f"    Current Price: {pos.get('currentPrice')}")
                print(f"    Profit: {pos.get('profit')}")
                print(f"    Commission: {pos.get('commission')}")
                print(f"    Swap: {pos.get('swap')}")
                print("    ==================================")

        position_id = order_result.get('positionId')

        if not position_id:
            print("\n    ⚠️ 포지션 ID를 가져올 수 없습니다.")
            print(f"    전체 응답: {order_result}")
            return

        # 3. 5초 대기
        print("\n[3] 5초 대기 중...")
        for i in range(5, 0, -1):
            print(f"    {i}...", end=" ", flush=True)
            await asyncio.sleep(1)
        print("완료")

        # 4. 포지션 청산
        print(f"\n[4] 포지션 청산 중... (Position ID: {position_id})")
        close_start = time.time()

        close_result = await connection.close_position(position_id)

        close_time = time.time() - close_start

        print("\n    ========== 청산 결과 ==========")
        print(f"    전체 응답: {close_result}")
        print(f"    Order ID: {close_result.get('orderId', 'N/A')}")
        print(f"    Position ID: {close_result.get('positionId', 'N/A')}")
        print(f"    Status: {close_result.get('stringCode', 'N/A')}")
        print(f"    청산 소요시간: {close_time:.3f}초")
        print("    ================================")

        # 거래 히스토리 조회
        print("\n[5] 거래 히스토리 조회 중...")
        await asyncio.sleep(1)  # 히스토리 반영 대기

        try:
            # 최근 거래 조회
            from datetime import timedelta
            start_date = datetime.now() - timedelta(minutes=5)
            end_date = datetime.now() + timedelta(minutes=1)

            history_result = await connection.get_history_orders_by_time_range(start_date, end_date)
            deals_result = await connection.get_deals_by_time_range(start_date, end_date)

            # 응답에서 리스트 추출
            history_orders = history_result.get('historyOrders', []) if isinstance(history_result, dict) else history_result
            deals = deals_result.get('deals', []) if isinstance(deals_result, dict) else deals_result

            print(f"\n    ========== 거래 히스토리 ==========")
            print(f"    최근 주문 수: {len(history_orders)}")
            print(f"    최근 체결 수: {len(deals)}")

            # 이번 거래 관련 deal 찾기
            total_profit = 0
            total_commission = 0
            total_swap = 0
            entry_price = None
            exit_price = None

            for deal in deals:
                deal_position_id = str(deal.get('positionId', ''))
                if deal_position_id == str(position_id):
                    deal_type = deal.get('type', '')
                    price = deal.get('price', 0)
                    profit = deal.get('profit', 0) or 0
                    commission = deal.get('commission', 0) or 0
                    swap = deal.get('swap', 0) or 0

                    total_profit += profit
                    total_commission += commission
                    total_swap += swap

                    if 'BUY' in deal_type:
                        entry_price = price
                    elif 'SELL' in deal_type:
                        exit_price = price

                    print(f"\n    Deal ID: {deal.get('id')}")
                    print(f"    Type: {deal_type}")
                    print(f"    Symbol: {deal.get('symbol')}")
                    print(f"    Volume: {deal.get('volume')}")
                    print(f"    Price: {price}")
                    print(f"    Profit: {profit}")
                    print(f"    Commission: {commission}")
                    print(f"    Swap: {swap}")

            print(f"\n    ---------- 거래 요약 ----------")
            print(f"    Entry Price: {entry_price}")
            print(f"    Exit Price: {exit_price}")
            print(f"    Gross Profit: {total_profit}")
            print(f"    Commission: {total_commission}")
            print(f"    Swap: {total_swap}")
            print(f"    Net P/L: {total_profit + total_commission + total_swap:.2f}")
            print("    ================================")

        except Exception as e:
            print(f"\n    (거래 히스토리 조회 실패: {e})")
            import traceback
            traceback.print_exc()

    except Exception as e:
        print(f"\n오류 발생: {e}")
        import traceback
        traceback.print_exc()

    finally:
        # 연결 종료
        if connection:
            try:
                await connection.close()
            except:
                pass

        # 전체 소요 시간
        total_time = time.time() - start_time
        print("\n" + "=" * 60)
        print(f"전체 소요 시간: {total_time:.2f}초")
        print("=" * 60)
        print("테스트 완료")


if __name__ == '__main__':
    asyncio.run(main())

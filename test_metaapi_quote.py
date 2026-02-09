#!/usr/bin/env python3
"""
MetaAPI Quote 계정 시세 수신 테스트 스크립트
9개 심볼의 실시간 bid/ask 가격을 10초간 수신
"""

import asyncio
import os
from datetime import datetime
from dotenv import load_dotenv
from metaapi_cloud_sdk import MetaApi

# .env 파일 로드
load_dotenv('/var/www/trading-x/.env')

# MetaAPI 설정
API_TOKEN = os.environ.get('METAAPI_TOKEN')
ACCOUNT_ID = '265f13fb-26ae-4505-b13c-13339616c2a2'

# 테스트할 심볼 9개
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

# 수신된 시세 저장
received_quotes = {symbol: [] for symbol in SYMBOLS}


class QuoteListener:
    """시세 수신 리스너"""

    async def on_symbol_price_updated(self, instance_index, price):
        """심볼 가격 업데이트 콜백"""
        symbol = price.get('symbol')
        if symbol in SYMBOLS:
            bid = price.get('bid', 'N/A')
            ask = price.get('ask', 'N/A')
            time = price.get('time', datetime.now().isoformat())

            received_quotes[symbol].append({
                'bid': bid,
                'ask': ask,
                'time': time
            })

            print(f"[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] {symbol:12} | Bid: {bid:>12} | Ask: {ask:>12}")

    async def on_connected(self, instance_index, replicas):
        print(f"✓ 연결됨 (instance: {instance_index})")

    async def on_disconnected(self, instance_index):
        print(f"✗ 연결 해제됨 (instance: {instance_index})")

    async def on_symbol_specifications_updated(self, instance_index, specifications, removed_symbols):
        pass

    async def on_symbol_prices_updated(self, instance_index, prices, equity, margin, free_margin, margin_level, account_currency_exchange_rate):
        pass

    async def on_account_information_updated(self, instance_index, account_information):
        pass

    async def on_positions_replaced(self, instance_index, positions):
        pass

    async def on_positions_synchronized(self, instance_index, synchronization_id):
        pass

    async def on_position_updated(self, instance_index, position):
        pass

    async def on_position_removed(self, instance_index, position_id):
        pass

    async def on_orders_replaced(self, instance_index, orders):
        pass

    async def on_orders_synchronized(self, instance_index, synchronization_id):
        pass

    async def on_order_updated(self, instance_index, order):
        pass

    async def on_order_completed(self, instance_index, order_id):
        pass

    async def on_history_order_added(self, instance_index, history_order):
        pass

    async def on_deal_added(self, instance_index, deal):
        pass

    async def on_deal_synchronization_finished(self, instance_index, synchronization_id):
        pass

    async def on_order_synchronization_finished(self, instance_index, synchronization_id):
        pass

    async def on_broker_connection_status_changed(self, instance_index, connected):
        status = "연결됨" if connected else "연결 끊김"
        print(f"브로커 상태: {status}")

    async def on_health_status(self, instance_index, status):
        pass

    async def on_pending_orders_synchronized(self, instance_index, synchronization_id):
        pass

    async def on_pending_orders_replaced(self, instance_index, orders):
        pass


async def main():
    print("=" * 60)
    print("MetaAPI Quote 계정 시세 수신 테스트")
    print("=" * 60)
    print(f"Account ID: {ACCOUNT_ID}")
    print(f"테스트 심볼: {', '.join(SYMBOLS)}")
    print(f"테스트 시간: 10초")
    print("=" * 60)

    if not API_TOKEN:
        print("\n⚠️  API_TOKEN을 설정해주세요!")
        print("   .env 파일에 METAAPI_TOKEN=your_token_here 추가")
        return

    api = MetaApi(API_TOKEN)
    account = None
    connection = None

    try:
        # 계정 가져오기
        print("\n계정 연결 중...")
        account = await api.metatrader_account_api.get_account(ACCOUNT_ID)

        print(f"계정 상태: {account.state}")
        print(f"연결 상태: {account.connection_status}")

        # 계정 배포 (필요시)
        if account.state != 'DEPLOYED':
            print("계정 배포 중...")
            await account.deploy()

        # 계정 연결 대기
        print("계정 연결 대기 중...")
        await account.wait_connected()

        # 스트리밍 연결 생성
        connection = account.get_streaming_connection()

        # 리스너 등록
        listener = QuoteListener()
        connection.add_synchronization_listener(listener)

        # 연결
        await connection.connect()

        # 동기화 대기
        print("터미널 동기화 대기 중...")
        await connection.wait_synchronized()

        # 심볼 구독
        print("\n심볼 구독 중...")
        for symbol in SYMBOLS:
            try:
                await connection.subscribe_to_market_data(symbol)
                print(f"  ✓ {symbol} 구독 완료")
            except Exception as e:
                print(f"  ✗ {symbol} 구독 실패: {e}")

        # 10초간 시세 수신
        print("\n" + "=" * 60)
        print("실시간 시세 수신 중... (10초)")
        print("=" * 60)

        await asyncio.sleep(10)

        # 결과 출력
        print("\n" + "=" * 60)
        print("수신 결과 요약")
        print("=" * 60)

        total_quotes = 0
        for symbol in SYMBOLS:
            count = len(received_quotes[symbol])
            total_quotes += count

            if count > 0:
                last = received_quotes[symbol][-1]
                print(f"{symbol:12} | 수신: {count:3}회 | 마지막 Bid: {last['bid']:>12} | Ask: {last['ask']:>12}")
            else:
                print(f"{symbol:12} | 수신: {count:3}회 | (시세 없음)")

        print("-" * 60)
        print(f"총 수신 시세: {total_quotes}회")
        print("=" * 60)

    except Exception as e:
        print(f"\n오류 발생: {e}")
        import traceback
        traceback.print_exc()

    finally:
        # 연결 종료
        if connection:
            print("\n연결 종료 중...")
            try:
                # 구독 해제
                for symbol in SYMBOLS:
                    try:
                        await connection.unsubscribe_from_market_data(symbol)
                    except:
                        pass
                await connection.close()
            except:
                pass

        print("테스트 완료")


if __name__ == '__main__':
    asyncio.run(main())

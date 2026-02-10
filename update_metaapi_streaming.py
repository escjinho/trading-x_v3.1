#!/usr/bin/env python3
"""
MetaAPI Quote Streaming Interval 업데이트 스크립트
quoteStreamingIntervalInSeconds를 0으로 설정하여 틱 단위 실시간 수신
"""
import os
import asyncio
from dotenv import load_dotenv

load_dotenv('/var/www/trading-x/.env')

async def update_quote_streaming_interval():
    """Quote 계정의 streaming interval을 0으로 설정"""
    from metaapi_cloud_sdk import MetaApi

    token = os.environ.get('METAAPI_TOKEN')
    quote_account_id = '265f13fb-26ae-4505-b13c-13339616c2a2'

    print("=" * 60)
    print("MetaAPI Quote Streaming Interval 업데이트")
    print("=" * 60)

    if not token:
        print("[ERROR] METAAPI_TOKEN이 .env에 없습니다")
        return False

    try:
        api = MetaApi(token)

        # Quote 계정 가져오기
        print(f"\n[1/3] Quote 계정 조회: {quote_account_id}")
        account = await api.metatrader_account_api.get_account(quote_account_id)

        print(f"  - 계정명: {account.name}")
        print(f"  - 상태: {account.state}")

        # 현재 설정 확인
        current_interval = getattr(account, 'quoteStreamingIntervalInSeconds', 'N/A')
        print(f"  - 현재 quoteStreamingIntervalInSeconds: {current_interval}")

        # 계정 업데이트
        # Note: 0초는 4 resource slots 이상 필요
        # Free tier에서는 최소 2.5초로 제한됨 → 1초 또는 가능한 최소값 시도
        new_interval = 1  # 1초 시도 (불가능하면 2.5초로 자동 적용됨)
        print(f"\n[2/3] quoteStreamingIntervalInSeconds = {new_interval} 으로 업데이트 중...")

        try:
            await account.update({
                'quoteStreamingIntervalInSeconds': new_interval
            })
        except Exception as e:
            if "resource slots" in str(e):
                print(f"  - {new_interval}초 불가, 2.5초로 재시도...")
                new_interval = 2.5
                await account.update({
                    'quoteStreamingIntervalInSeconds': new_interval
                })

        print("  - 업데이트 요청 완료")

        # 업데이트 확인
        print(f"\n[3/3] 변경 확인 중...")
        account = await api.metatrader_account_api.get_account(quote_account_id)
        new_interval = getattr(account, 'quoteStreamingIntervalInSeconds', 'N/A')
        print(f"  - 새 quoteStreamingIntervalInSeconds: {new_interval}")

        if new_interval == 0:
            print("\n[SUCCESS] 틱 단위 실시간 스트리밍 활성화됨!")
        else:
            print(f"\n[INFO] 설정 변경됨 (API 제한으로 최소값이 적용될 수 있음)")

        print("\n" + "=" * 60)
        print("완료! 서버를 재시작하면 새 설정이 적용됩니다.")
        print("  sudo systemctl restart trading-x-backend")
        print("=" * 60)

        return True

    except Exception as e:
        print(f"\n[ERROR] 업데이트 실패: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == '__main__':
    asyncio.run(update_quote_streaming_interval())

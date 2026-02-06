# verify_endpoint.py
# MT5 계정 검증 기능 - mt5_bridge.py에 추가할 코드
#
# 사용법:
# 1. 이 파일의 함수들을 mt5_bridge.py에 복사
# 2. main loop에서 process_pending_verifications() 호출 추가
#
# =====================================================

import MetaTrader5 as mt5
import requests

SERVER_URL = "https://trading-x.ai"  # Linux 서버 주소


def fetch_pending_verifications():
    """서버에서 대기 중인 계정 검증 요청 가져오기"""
    try:
        url = f"{SERVER_URL}/api/mt5/bridge/verify/pending"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            return data.get("verifications", [])
    except Exception as e:
        print(f"[Verify] 검증 요청 조회 오류: {e}")
    return []


def verify_account(account: str, password: str, server: str):
    """
    MT5 계정 검증
    - mt5.login()으로 실제 로그인 시도
    - 성공 시 계정 정보 반환
    - 실패 시 에러 메시지 반환
    """
    try:
        # 계좌번호를 정수로 변환
        account_int = int(account)

        # MT5 로그인 시도
        # 주의: 이 함수는 현재 로그인된 계정을 변경함
        # 검증 후 원래 계정으로 다시 로그인해야 함

        # 현재 계정 정보 저장 (원복용)
        current_account = mt5.account_info()
        current_login = current_account.login if current_account else None

        # 새 계정으로 로그인 시도
        authorized = mt5.login(account_int, password=password, server=server)

        if authorized:
            # 로그인 성공 - 계정 정보 가져오기
            account_info = mt5.account_info()
            result = {
                "success": True,
                "message": "계정 검증 성공",
                "account_info": {
                    "login": account_info.login,
                    "server": account_info.server,
                    "broker": account_info.company,
                    "balance": account_info.balance,
                    "leverage": account_info.leverage,
                    "currency": account_info.currency,
                    "name": account_info.name
                }
            }

            # 원래 계정으로 복구 (중요!)
            # 주의: 원래 계정의 비밀번호를 모르면 복구 불가
            # 이 경우 브릿지 재시작 필요
            print(f"[Verify] 검증 성공: {account_int} @ {server}")
            print(f"[Verify] 주의: 원래 계정({current_login})으로 복구하려면 브릿지 재시작 필요")

            return result
        else:
            # 로그인 실패
            error = mt5.last_error()
            error_msg = f"로그인 실패: {error[1]}" if error else "계좌번호 또는 비밀번호가 올바르지 않습니다"
            print(f"[Verify] 검증 실패: {account_int} - {error_msg}")

            return {
                "success": False,
                "message": error_msg
            }

    except ValueError:
        return {
            "success": False,
            "message": "계좌번호는 숫자여야 합니다"
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"검증 오류: {str(e)}"
        }


def send_verification_result(verify_id: str, result: dict):
    """검증 결과를 서버로 전송"""
    try:
        result["verify_id"] = verify_id
        url = f"{SERVER_URL}/api/mt5/bridge/verify/result"
        response = requests.post(url, json=result, timeout=5)
        return response.status_code == 200
    except Exception as e:
        print(f"[Verify] 결과 전송 오류: {e}")
        return False


def process_pending_verifications():
    """
    대기 중인 검증 요청 처리
    - main loop에서 호출
    """
    verifications = fetch_pending_verifications()

    for v in verifications:
        verify_id = v.get("verify_id")
        account = v.get("account")
        password = v.get("password")
        server = v.get("server")

        print(f"\n[Verify] 검증 요청: {verify_id} - {account}@{server}")

        # 계정 검증
        result = verify_account(account, password, server)

        # 결과 전송
        send_verification_result(verify_id, result)
        print(f"[Verify] 완료: {verify_id} - {result.get('success')}")


# =====================================================
# mt5_bridge.py 수정 방법
# =====================================================
#
# 방법 1: main() 함수의 while 루프에 추가
# -------------------------------------------
# while True:
#     try:
#         # ... 기존 코드 ...
#
#         # ★ 주문 처리 (기존)
#         process_pending_orders()
#
#         # ★★★ 계정 검증 처리 (추가) ★★★
#         process_pending_verifications()
#
#         # ... 나머지 코드 ...
#
#
# 방법 2: 파일 상단에 함수들 import
# -------------------------------------------
# # mt5_bridge.py 상단에 추가:
# from verify_endpoint import (
#     process_pending_verifications,
#     fetch_pending_verifications,
#     verify_account,
#     send_verification_result
# )
#
# =====================================================


if __name__ == "__main__":
    # 테스트용
    print("계정 검증 테스트...")
    verifications = fetch_pending_verifications()
    print(f"대기 중인 검증 요청: {len(verifications)}개")

    for v in verifications:
        print(f"  - {v.get('verify_id')}: {v.get('account')}@{v.get('server')}")

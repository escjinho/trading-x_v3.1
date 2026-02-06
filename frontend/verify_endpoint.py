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

# ★★★ 브릿지 기본 계정 정보 (mt5_bridge.py의 init_mt5()와 동일) ★★★
BRIDGE_LOGIN = 935001712
BRIDGE_PASSWORD = "Qlrpfwl1!"  # 브릿지 계정 비밀번호
BRIDGE_SERVER = "HedgeHood-MT5"


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
    - 검증 후 브릿지 계정으로 명시적 복구
    """
    result = {"success": False, "message": "알 수 없는 오류"}

    try:
        # 계좌번호를 정수로 변환
        account_int = int(account)

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
            print(f"[Verify] 검증 성공: {account_int} @ {server}")
        else:
            # 로그인 실패
            error = mt5.last_error()
            error_msg = f"로그인 실패: {error[1]}" if error else "계좌번호 또는 비밀번호가 올바르지 않습니다"
            print(f"[Verify] 검증 실패: {account_int} - {error_msg}")
            result = {
                "success": False,
                "message": error_msg
            }

    except ValueError:
        result = {
            "success": False,
            "message": "계좌번호는 숫자여야 합니다"
        }
    except Exception as e:
        result = {
            "success": False,
            "message": f"검증 오류: {str(e)}"
        }
    finally:
        # ★★★ 브릿지 계정으로 명시적 복구 ★★★
        try:
            print(f"[Verify] 브릿지 계정 복구 중: {BRIDGE_LOGIN} @ {BRIDGE_SERVER}")
            restored = mt5.login(BRIDGE_LOGIN, password=BRIDGE_PASSWORD, server=BRIDGE_SERVER)
            if restored:
                restored_info = mt5.account_info()
                print(f"[Verify] ✅ 브릿지 계정 복구 성공: {restored_info.login}")
            else:
                error = mt5.last_error()
                print(f"[Verify] ❌ 브릿지 계정 복구 실패: {error}")
                # 복구 실패 시 MT5 재초기화 시도
                mt5.shutdown()
                mt5.initialize()
                mt5.login(BRIDGE_LOGIN, password=BRIDGE_PASSWORD, server=BRIDGE_SERVER)
                print(f"[Verify] 🔄 MT5 재초기화 후 복구 시도")
        except Exception as e:
            print(f"[Verify] ❌ 복구 오류: {e}")

    return result


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
    print(f"브릿지 계정: {BRIDGE_LOGIN} @ {BRIDGE_SERVER}")

    verifications = fetch_pending_verifications()
    print(f"대기 중인 검증 요청: {len(verifications)}개")

    for v in verifications:
        print(f"  - {v.get('verify_id')}: {v.get('account')}@{v.get('server')}")

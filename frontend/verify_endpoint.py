# verify_endpoint.py
# MT5 계정 검증 기능 - mt5_bridge.py와 함께 사용
#
# ★★★ v3.1.9-fix: 브릿지 계정 자동 감지 ★★★
# - 하드코딩된 계정 정보 제거
# - 검증 전 현재 로그인된 계정 자동 저장
# - 검증 후 저장된 계정으로 복구
#
# =====================================================

import MetaTrader5 as mt5
import requests

SERVER_URL = "https://trading-x.ai"  # Linux 서버 주소

# ★★★ 현재 브릿지 계정 정보 (자동 감지) ★★★
# 브릿지 시작 시 init_bridge_account()로 자동 설정됨
_bridge_account = {
    "login": None,
    "server": None,
    "initialized": False
}


def init_bridge_account():
    """
    현재 MT5에 로그인된 계정 정보를 저장
    - mt5_bridge.py 시작 시 한 번 호출
    - 또는 process_pending_verifications() 첫 호출 시 자동 초기화
    """
    global _bridge_account

    try:
        account_info = mt5.account_info()
        if account_info:
            _bridge_account["login"] = account_info.login
            _bridge_account["server"] = account_info.server
            _bridge_account["initialized"] = True
            print(f"[Verify] ✅ 브릿지 계정 감지: {account_info.login} @ {account_info.server}")
            return True
        else:
            print("[Verify] ⚠️ MT5 계정 정보를 가져올 수 없습니다")
            return False
    except Exception as e:
        print(f"[Verify] ❌ 브릿지 계정 감지 오류: {e}")
        return False


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
    - 검증 전 현재 계정 정보 저장 (자동 감지)
    - mt5.login()으로 실제 로그인 시도
    - 성공 시 계정 정보 반환
    - 실패 시 에러 메시지 반환
    - 검증 후 원래 계정으로 복구 시도
    """
    global _bridge_account
    result = {"success": False, "message": "알 수 없는 오류"}

    # ★★★ 검증 전 현재 계정 정보 저장 ★★★
    original_account = None
    original_server = None

    try:
        current_info = mt5.account_info()
        if current_info:
            original_account = current_info.login
            original_server = current_info.server
            print(f"[Verify] 📌 현재 계정 저장: {original_account} @ {original_server}")
    except Exception as e:
        print(f"[Verify] ⚠️ 현재 계정 정보 조회 실패: {e}")

    try:
        # 계좌번호를 정수로 변환
        account_int = int(account)

        # 새 계정으로 로그인 시도
        print(f"[Verify] 🔄 검증 시도: {account_int} @ {server}")
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
                    "equity": account_info.equity,      # ★ 추가
                    "margin": account_info.margin,      # ★ 추가
                    "free_margin": account_info.margin_free,  # ★ 추가
                    "leverage": account_info.leverage,
                    "currency": account_info.currency,
                    "name": account_info.name
                }
            }
            print(f"[Verify] ✅ 검증 성공: {account_int} @ {server}, Balance: ${account_info.balance}")
        else:
            # 로그인 실패
            error = mt5.last_error()
            error_msg = f"로그인 실패: {error[1]}" if error else "계좌번호 또는 비밀번호가 올바르지 않습니다"
            print(f"[Verify] ❌ 검증 실패: {account_int} - {error_msg}")
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

    # ★★★ 원래 계정으로 복구 시도 (finally 대신 명시적 호출) ★★★
    # 복구 실패해도 브릿지는 계속 동작해야 함
    if original_account and original_server:
        try:
            print(f"[Verify] 🔄 원래 계정 복구 중: {original_account} @ {original_server}")
            # 비밀번호 없이 재로그인 시도 (이미 로그인된 세션 재사용)
            # MT5는 같은 터미널에서 이전에 로그인한 계정은 비밀번호 없이 재연결 가능
            restored = mt5.login(original_account, server=original_server)

            if restored:
                restored_info = mt5.account_info()
                if restored_info:
                    print(f"[Verify] ✅ 계정 복구 성공: {restored_info.login}")
                else:
                    print(f"[Verify] ⚠️ 복구됐으나 계정 정보 조회 실패")
            else:
                error = mt5.last_error()
                print(f"[Verify] ⚠️ 계정 복구 실패 (비밀번호 필요할 수 있음): {error}")
                print(f"[Verify] ℹ️ MT5 터미널에서 수동으로 {original_account} 계정에 로그인해주세요")
                # 복구 실패해도 에러만 로깅하고 계속 진행

        except Exception as e:
            print(f"[Verify] ⚠️ 복구 오류 (무시하고 계속): {e}")
    else:
        print(f"[Verify] ⚠️ 원래 계정 정보가 없어 복구 스킵")

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
    global _bridge_account

    # 첫 호출 시 브릿지 계정 자동 감지
    if not _bridge_account["initialized"]:
        init_bridge_account()

    verifications = fetch_pending_verifications()

    for v in verifications:
        verify_id = v.get("verify_id")
        account = v.get("account")
        password = v.get("password")
        server = v.get("server")

        print(f"\n[Verify] 📋 검증 요청: {verify_id[:8]}... - {account}@{server}")

        # 계정 검증
        result = verify_account(account, password, server)

        # 결과 전송
        send_verification_result(verify_id, result)
        print(f"[Verify] 📤 완료: {verify_id[:8]}... - {'성공' if result.get('success') else '실패'}")


# =====================================================
# 사용법
# =====================================================
#
# mt5_bridge.py에서:
#
# from verify_endpoint import process_pending_verifications
#
# while True:
#     # ... 기존 코드 ...
#     process_pending_verifications()
#     time.sleep(0.5)
#
# =====================================================


if __name__ == "__main__":
    # 테스트용
    print("=" * 50)
    print("계정 검증 모듈 테스트")
    print("=" * 50)

    # MT5 초기화 확인
    if not mt5.initialize():
        print("MT5 초기화 실패")
        exit(1)

    # 현재 계정 감지
    init_bridge_account()

    # 대기 중인 검증 요청 확인
    verifications = fetch_pending_verifications()
    print(f"\n대기 중인 검증 요청: {len(verifications)}개")

    for v in verifications:
        print(f"  - {v.get('verify_id')[:8]}...: {v.get('account')}@{v.get('server')}")

    print("\n테스트 완료")

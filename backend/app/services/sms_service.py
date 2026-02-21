"""
SMS 인증 서비스 (Aligo API)
- ALIGO_ENABLED=False 또는 API키 미설정 → 테스트 모드 (콘솔 출력)
- ALIGO_ENABLED=True + 설정값 존재 → 실제 SMS 발송
"""
import random
import time
import requests
from ..config import settings

# 인증코드 저장소 (메모리 기반 - 이메일과 동일 패턴)
phone_verification_codes: dict = {}

def generate_phone_code(phone: str) -> str:
    """6자리 인증코드 생성 및 저장"""
    code = str(random.randint(100000, 999999))
    phone_verification_codes[phone] = {
        "code": code,
        "created_at": time.time(),
        "attempts": 0,
        "expires_in": 300  # 5분
    }
    return code

def verify_phone_code(phone: str, code: str) -> dict:
    """인증코드 검증"""
    stored = phone_verification_codes.get(phone)
    if not stored:
        return {"success": False, "message": "인증코드를 먼저 요청해주세요"}

    # 만료 체크
    if time.time() - stored["created_at"] > stored["expires_in"]:
        del phone_verification_codes[phone]
        return {"success": False, "message": "인증코드가 만료되었습니다. 다시 요청해주세요"}

    # 시도 횟수 체크
    if stored["attempts"] >= 5:
        del phone_verification_codes[phone]
        return {"success": False, "message": "시도 횟수를 초과했습니다. 다시 요청해주세요"}

    stored["attempts"] += 1

    if stored["code"] == code:
        del phone_verification_codes[phone]
        return {"success": True, "message": "인증이 완료되었습니다"}

    remaining = 5 - stored["attempts"]
    return {"success": False, "message": f"인증코드가 일치하지 않습니다 (남은 시도: {remaining}회)"}

def send_verification_sms(phone: str, code: str) -> dict:
    """SMS 발송 (Aligo API 또는 테스트 모드)"""

    if not settings.ALIGO_ENABLED or not settings.ALIGO_API_KEY:
        # 테스트 모드: 콘솔 출력
        print(f"[SMS TEST] 인증코드 발송 → {phone}: {code}")
        return {"sent": False, "test_mode": True, "test_code": code}

    try:
        # Aligo API 호출
        url = "https://apis.aligo.in/send/"
        data = {
            "key": settings.ALIGO_API_KEY,
            "user_id": settings.ALIGO_USER_ID,
            "sender": settings.ALIGO_SENDER,
            "receiver": phone.replace("-", ""),
            "msg": f"[Trading-X] 인증코드: {code}\n5분 내에 입력해주세요.",
            "msg_type": "SMS",
        }

        response = requests.post(url, data=data)
        result = response.json()

        if result.get("result_code") == "1":
            print(f"[SMS] 인증코드 발송 완료 → {phone}")
            return {"sent": True, "test_mode": False}
        else:
            error_msg = result.get("message", "알 수 없는 오류")
            print(f"[SMS ERROR] {phone}: {error_msg}")
            return {"sent": False, "test_mode": True, "test_code": code, "error": error_msg}

    except Exception as e:
        print(f"[SMS ERROR] {phone}: {e}")
        return {"sent": False, "test_mode": True, "test_code": code, "error": str(e)}

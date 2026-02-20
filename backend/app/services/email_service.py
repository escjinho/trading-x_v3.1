import random
import time
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from ..config import settings

# 인증코드 저장소 (메모리) - {email: {"code": "123456", "expires": timestamp, "attempts": 0}}
verification_codes = {}

# 코드 생성 시 기존 만료된 코드 정리
def _cleanup_expired():
    now = time.time()
    expired = [k for k, v in verification_codes.items() if v["expires"] < now]
    for k in expired:
        del verification_codes[k]

def generate_verification_code(email: str) -> str:
    """6자리 인증코드 생성 및 저장 (5분 유효)"""
    _cleanup_expired()
    code = str(random.randint(100000, 999999))
    verification_codes[email] = {
        "code": code,
        "expires": time.time() + 300,  # 5분
        "attempts": 0
    }
    return code

def verify_code(email: str, code: str) -> dict:
    """인증코드 검증"""
    _cleanup_expired()

    if email not in verification_codes:
        return {"success": False, "message": "인증코드가 만료되었거나 요청되지 않았습니다"}

    stored = verification_codes[email]

    # 만료 체크
    if stored["expires"] < time.time():
        del verification_codes[email]
        return {"success": False, "message": "인증코드가 만료되었습니다. 재발송해주세요"}

    # 시도 횟수 체크 (최대 5회)
    if stored["attempts"] >= 5:
        del verification_codes[email]
        return {"success": False, "message": "입력 횟수를 초과했습니다. 재발송해주세요"}

    stored["attempts"] += 1

    # 코드 일치 확인
    if stored["code"] == code:
        del verification_codes[email]
        return {"success": True, "message": "인증이 완료되었습니다"}

    remaining = 5 - stored["attempts"]
    return {"success": False, "message": f"인증코드가 일치하지 않습니다 (남은 시도: {remaining}회)"}

def send_verification_email(email: str, code: str) -> dict:
    """이메일 발송 (SMTP 설정 시 실제 발송, 미설정 시 테스트 모드)"""

    if not settings.SMTP_ENABLED or not settings.SMTP_HOST:
        # 테스트 모드: 콘솔 출력 + API 응답에 코드 포함
        print(f"[TEST MODE] 인증코드 발송 → {email}: {code}")
        return {"sent": False, "test_mode": True, "test_code": code}

    try:
        # HTML 이메일 본문
        html_body = f"""
        <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#e6edf3;padding:32px;border-radius:12px;">
            <div style="text-align:center;margin-bottom:24px;">
                <div style="display:inline-flex;align-items:center;gap:8px;">
                    <div style="width:32px;height:24px;border-radius:6px;border:2px solid #00d4ff;display:inline-flex;align-items:center;justify-content:center;">
                        <span style="font-size:12px;font-weight:800;color:#e8eaed;">TX</span>
                    </div>
                    <span style="font-size:20px;font-weight:700;color:#e6edf3;">Trading-X</span>
                </div>
            </div>
            <div style="text-align:center;margin-bottom:24px;">
                <div style="font-size:15px;color:#8b949e;margin-bottom:16px;">이메일 인증코드</div>
                <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#00d4ff;background:#161b22;padding:16px 24px;border-radius:8px;border:1px solid #30363d;display:inline-block;">{code}</div>
            </div>
            <div style="text-align:center;font-size:12px;color:#484f58;">
                <p>이 코드는 5분간 유효합니다.</p>
                <p>본인이 요청하지 않았다면 이 메일을 무시해주세요.</p>
            </div>
            <div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #21262d;font-size:10px;color:#30363d;">
                &copy; 2026 GOODFRIENDS CO., LTD &middot; trading-x.ai
            </div>
        </div>
        """

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[Trading-X] 인증코드: {code}"
        msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM}>"
        msg["To"] = email
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_FROM, email, msg.as_string())

        print(f"[EMAIL] 인증코드 발송 완료 → {email}")
        return {"sent": True, "test_mode": False}

    except Exception as e:
        print(f"[EMAIL ERROR] {email}: {e}")
        # 발송 실패 시 테스트 모드로 폴백
        return {"sent": False, "test_mode": True, "test_code": code, "error": str(e)}

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

def send_verification_email(email: str, code: str, name: str = "") -> dict:
    """이메일 발송 (SMTP 설정 시 실제 발송, 미설정 시 테스트 모드)"""

    display_name = name or email.split("@")[0]

    if not settings.SMTP_ENABLED or not settings.SMTP_HOST:
        # 테스트 모드: 콘솔 출력 + API 응답에 코드 포함
        print(f"[TEST MODE] 인증코드 발송 → {email}: {code}")
        return {"sent": False, "test_mode": True, "test_code": code}

    try:
        # HTML 이메일 본문
        html_body = f"""
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;margin:0 auto;">
          <tr>
            <td style="background:linear-gradient(180deg,#0a0e17 0%,#111827 100%);border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding:40px 40px 16px;text-align:center;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                      <tr>
                        <td style="width:38px;height:30px;border-radius:7px;border:2px solid rgba(0,212,255,0.6);background:rgba(0,212,255,0.06);text-align:center;vertical-align:middle;">
                          <span style="font-size:16px;font-weight:800;color:#e8eaed;letter-spacing:0.5px;">TX</span>
                        </td>
                        <td style="padding-left:10px;vertical-align:middle;">
                          <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:1px;">Trading-X</span>
                        </td>
                      </tr>
                    </table>
                    <div style="margin-top:10px;font-size:10px;color:rgba(255,255,255,0.3);letter-spacing:3px;font-weight:500;">PROFESSIONAL TRADING PLATFORM</div>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr><td style="padding:0 40px;"><div style="height:1px;background:linear-gradient(90deg,transparent,rgba(0,212,255,0.25),transparent);"></div></td></tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding:30px 40px 10px;">
                    <div style="font-size:16px;font-weight:600;color:#ffffff;margin-bottom:24px;text-align:center;">이메일 인증코드</div>
                    <div style="font-size:14px;color:rgba(255,255,255,0.7);line-height:1.8;margin-bottom:28px;">
                      <span style="color:#ffffff;font-weight:500;">{display_name}</span>님, 안녕하세요.<br><br>
                      Trading-X 이메일 인증을 위한 코드입니다.<br>
                      아래 인증코드를 입력하여 본인 확인을 완료해주세요.
                    </div>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding:0 40px 10px;text-align:center;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;width:100%;">
                      <tr>
                        <td style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.25);border-radius:12px;padding:24px 20px;text-align:center;">
                          <div style="font-family:'Courier New',Consolas,monospace;font-size:36px;font-weight:700;color:#00d4ff;letter-spacing:12px;">{code}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding:12px 40px 28px;text-align:center;">
                    <div style="font-size:12px;color:rgba(255,255,255,0.4);">이 코드는 <span style="color:#00d4ff;">5분간</span> 유효합니다.</div>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr><td style="padding:0 40px;"><div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent);"></div></td></tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding:24px 40px 16px;">
                    <div style="font-size:12px;color:rgba(255,255,255,0.45);line-height:1.8;">
                      본인이 요청하지 않은 경우, 계정 보안을 위해<br>즉시 비밀번호를 변경하시기 바랍니다.
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 40px 20px;">
                    <div style="font-size:12px;color:rgba(255,255,255,0.45);line-height:1.8;">
                      문의사항이 있으시면 <a href="mailto:support@trading-x.ai" style="color:#00d4ff;text-decoration:none;">support@trading-x.ai</a>로 연락해주세요.<br>
                      감사합니다.<br>
                      <span style="color:rgba(255,255,255,0.6);font-weight:500;">Trading-X 팀</span>
                    </div>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding:4px 40px 20px;text-align:center;">
                    <a href="https://www.trading-x.ai" style="font-size:12px;color:rgba(0,212,255,0.5);text-decoration:none;letter-spacing:0.5px;">www.trading-x.ai</a>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding:16px 40px 24px;text-align:center;border-top:1px solid rgba(255,255,255,0.06);">
                    <div style="font-size:11px;color:rgba(255,255,255,0.35);line-height:1.6;">
                      &copy; 2026 GOODFRIENDS CO., LTD &middot; trading-x.ai
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
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

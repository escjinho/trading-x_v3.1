from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from ..database import get_db
from ..models.user import User
from ..models.grade_config import GradeConfig
from ..models.demo_trade import DemoTrade, DemoPosition
from ..models.live_trade import LiveTrade
from ..schemas.user import UserCreate, UserLogin, UserResponse, Token
from ..utils.security import get_password_hash, verify_password, create_access_token, create_refresh_token, decode_token
from ..services.email_service import generate_verification_code, verify_code, send_verification_email
from ..models.login_history import LoginHistory
from ..utils.ua_parser import parse_user_agent
from ..utils.ip_location import get_ip_location
import uuid
from ..services.sms_service import generate_phone_code, verify_phone_code, send_verification_sms

router = APIRouter(prefix="/auth", tags=["인증"])

@router.post("/register", response_model=UserResponse)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """회원가입"""
    # 이메일 중복 확인
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 등록된 이메일입니다"
        )
    
    # 새 사용자 생성
    new_user = User(
        email=user_data.email,
        password_hash=get_password_hash(user_data.password),
        name=user_data.name
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return new_user

@router.post("/login", response_model=Token)
def login(user_data: UserLogin, request: Request, db: Session = Depends(get_db)):
    """로그인"""
    # 사용자 찾기
    user = db.query(User).filter(User.email == user_data.email).first()
    if not user or not verify_password(user_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 또는 비밀번호가 올바르지 않습니다"
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비활성화된 계정입니다"
        )
    
    # 세션 ID 생성
    session_id = str(uuid.uuid4())[:16]
    
    # 토큰 생성 (세션 ID 포함)
    access_token = create_access_token(data={"sub": str(user.id), "sid": session_id})
    refresh_token = create_refresh_token(data={"sub": str(user.id), "sid": session_id})
    
    # 로그인 기록 저장
    try:
        ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or request.client.host if request.client else "unknown"
        ua_string = request.headers.get("user-agent", "")
        ua_info = parse_user_agent(ua_string)
        
        # IP 위치 조회
        loc_info = get_ip_location(ip)
        
        history = LoginHistory(
            user_id=user.id,
            ip_address=ip,
            user_agent=ua_string,
            browser=ua_info["browser"],
            os_name=ua_info["os"],
            device_type=ua_info["device_type"],
            location=loc_info.get("location", ""),
            country_code=loc_info.get("country_code", ""),
            city=loc_info.get("city", ""),
            session_id=session_id
        )
        db.add(history)
        db.commit()
    except Exception as e:
        print(f"[LOGIN HISTORY] 기록 저장 실패: {e}")
        db.rollback()
    
    return Token(access_token=access_token, refresh_token=refresh_token)

@router.post("/refresh", response_model=Token)
def refresh_token(refresh_token: str, db: Session = Depends(get_db)):
    """토큰 갱신"""
    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 리프레시 토큰입니다"
        )
    
    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다"
        )
    
    # 새 토큰 생성
    new_access_token = create_access_token(data={"sub": str(user.id)})
    new_refresh_token = create_refresh_token(data={"sub": str(user.id)})
    
    return Token(access_token=new_access_token, refresh_token=new_refresh_token)

# ========== 이메일 인증 ==========

security = HTTPBearer()

class EmailVerifyRequest(BaseModel):
    email: str

class CodeVerifyRequest(BaseModel):
    email: str
    code: str

class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)) -> User:
    """현재 로그인한 사용자 반환"""
    token = credentials.credentials
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 토큰입니다"
        )

    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다"
        )
    return user

@router.post("/email/send-code")
def send_email_code(request: EmailVerifyRequest, db: Session = Depends(get_db)):
    """이메일 인증코드 발송"""
    # 이메일 형식 검증 (간단)
    if "@" not in request.email or "." not in request.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="유효하지 않은 이메일 형식입니다"
        )

    # 사용자 이름 조회
    user = db.query(User).filter(User.email == request.email).first()
    user_name = user.name if user and user.name else ""

    # 인증코드 생성 및 발송
    code = generate_verification_code(request.email)
    result = send_verification_email(request.email, code, name=user_name)

    response = {"message": "인증코드가 발송되었습니다", "email": request.email}

    # 테스트 모드일 경우 코드 포함
    if result.get("test_mode"):
        response["test_code"] = result.get("test_code")
        response["test_mode"] = True

    return response

@router.post("/email/verify-code")
def verify_email_code(request: CodeVerifyRequest, db: Session = Depends(get_db)):
    """이메일 인증코드 검증"""
    result = verify_code(request.email, request.code)

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["message"]
        )

    # 사용자가 존재하면 email_verified 플래그 업데이트
    user = db.query(User).filter(User.email == request.email).first()
    if user:
        user.email_verified = True
        db.commit()

    return {"success": True, "message": result["message"]}

@router.post("/password/change")
def change_password(
    request: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """비밀번호 변경 (로그인 필요)"""
    # 현재 비밀번호 확인
    if not verify_password(request.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="현재 비밀번호가 올바르지 않습니다"
        )

    # 새 비밀번호가 현재와 같은지 확인
    if request.current_password == request.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="새 비밀번호는 현재 비밀번호와 달라야 합니다"
        )

    # 비밀번호 업데이트
    current_user.password_hash = get_password_hash(request.new_password)
    db.commit()

    return {"success": True, "message": "비밀번호가 변경되었습니다"}


# ========== 프로필 + 등급 정보 ==========
@router.get("/me")
async def get_my_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """내 프로필 + 등급 + 거래 통계"""

    # 1) 거래 통계 — Demo + Live 완료된 거래의 총 lots 합산
    demo_lots_result = db.query(func.sum(DemoTrade.volume)).filter(
        DemoTrade.user_id == current_user.id
    ).scalar()
    demo_lots = float(demo_lots_result) if demo_lots_result else 0.0

    live_lots_result = db.query(func.sum(LiveTrade.volume)).filter(
        LiveTrade.user_id == current_user.id,
        LiveTrade.is_closed == True
    ).scalar()
    live_lots = float(live_lots_result) if live_lots_result else 0.0

    # 등급은 Live 기준으로만 계산
    total_lots = round(live_lots, 2)

    demo_trades_count = db.query(func.count(DemoTrade.id)).filter(
        DemoTrade.user_id == current_user.id
    ).scalar() or 0

    live_trades_count = db.query(func.count(LiveTrade.id)).filter(
        LiveTrade.user_id == current_user.id,
        LiveTrade.is_closed == True
    ).scalar() or 0

    total_trades = live_trades_count

    # 열린 포지션 수
    open_positions = db.query(func.count(DemoPosition.id)).filter(
        DemoPosition.user_id == current_user.id
    ).scalar() or 0

    # 2) 등급 계산 — grade_config 테이블에서 조건 충족하는 최상위 등급
    grade_configs = db.query(GradeConfig).filter(
        GradeConfig.is_active == True
    ).order_by(GradeConfig.sort_order.asc()).all()

    current_grade = None
    next_grade = None

    for i, gc in enumerate(grade_configs):
        if total_lots >= gc.min_lots:
            current_grade = gc
        else:
            if next_grade is None:
                next_grade = gc

    # 기본값 (grade_config 테이블이 비어있을 경우)
    if current_grade is None:
        current_grade_data = {
            "name": "Standard",
            "self_referral": 0,
            "benefit": "기본 혜택",
            "badge_color": "#9e9e9e"
        }
    else:
        current_grade_data = {
            "name": current_grade.grade_name,
            "self_referral": current_grade.self_referral,
            "benefit": current_grade.benefit_desc,
            "badge_color": current_grade.badge_color
        }

    # 다음 등급까지 남은 lots
    if next_grade:
        remaining_lots = max(next_grade.min_lots - total_lots, 0)
        progress = min((total_lots / next_grade.min_lots) * 100, 100) if next_grade.min_lots > 0 else 100
        next_grade_data = {
            "name": next_grade.grade_name,
            "min_lots": next_grade.min_lots,
            "remaining_lots": round(remaining_lots, 2),
            "progress": round(progress, 1)
        }
    else:
        next_grade_data = None  # 최고 등급 달성

    # 3) 전체 등급 목록 (VIP 페이지용)
    all_grades = []
    for gc in grade_configs:
        all_grades.append({
            "name": gc.grade_name,
            "min_lots": gc.min_lots,
            "self_referral": gc.self_referral,
            "benefit": gc.benefit_desc,
            "badge_color": gc.badge_color,
            "achieved": total_lots >= gc.min_lots
        })

    return {
        "email": current_user.email,
        "name": current_user.name or current_user.email.split("@")[0],
        "real_name": current_user.real_name or "",
        "birth_date": current_user.birth_date or "",
        "nationality": current_user.nationality or "",
        "created_at": str(current_user.created_at) if current_user.created_at else None,
        "email_verified": current_user.email_verified or False,
        "phone": current_user.phone or "",
        "phone_verified": current_user.phone_verified or False,
        "has_mt5_account": current_user.has_mt5_account or False,
        "is_admin": current_user.is_admin or False,

        # 거래 통계
        "total_trades": total_trades,
        "total_lots": round(total_lots, 2),
        "demo_trades": demo_trades_count,
        "demo_lots": round(demo_lots, 2),
        "demo_balance": current_user.demo_balance or 10000.0,
        "live_trades": live_trades_count,
        "live_lots": round(live_lots, 2),
        "open_positions": open_positions,

        # 등급
        "grade": current_grade_data,
        "next_grade": next_grade_data,
        "all_grades": all_grades
    }

# ========== SMS 인증 ==========
class PhoneVerifyRequest(BaseModel):
    phone: str

class PhoneCodeVerifyRequest(BaseModel):
    phone: str
    code: str

@router.post("/phone/send-code")
def send_phone_code(request: PhoneVerifyRequest, db: Session = Depends(get_db)):
    """전화번호 인증코드 발송"""
    phone = request.phone.replace("-", "").replace(" ", "")

    # 전화번호 형식 검증
    if not phone.startswith("01") or len(phone) < 10 or len(phone) > 11:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="유효하지 않은 전화번호 형식입니다"
        )

    # 인증코드 생성 및 발송
    code = generate_phone_code(phone)
    result = send_verification_sms(phone, code)

    response = {"message": "인증코드가 발송되었습니다", "phone": phone}

    # 테스트 모드일 경우 코드 포함
    if result.get("test_mode"):
        response["test_code"] = result.get("test_code")
        response["test_mode"] = True

    return response

@router.post("/phone/verify-code")
def verify_phone_code_endpoint(request: PhoneCodeVerifyRequest, db: Session = Depends(get_db)):
    """전화번호 인증코드 검증"""
    phone = request.phone.replace("-", "").replace(" ", "")
    result = verify_phone_code(phone, request.code)

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["message"]
        )

    # 전화번호로 사용자 찾아서 업데이트
    user = db.query(User).filter(User.phone == phone).first()
    if user:
        user.phone_verified = True
        db.commit()

    return {"success": True, "message": result["message"]}


# ========== 개인정보 관리 ==========
class PasswordVerifyRequest(BaseModel):
    password: str

class PersonalInfoUpdateRequest(BaseModel):
    real_name: str = ""
    name: str = ""
    phone: str = ""
    birth_date: str = ""
    nationality: str = ""
    password: str  # 저장 시 비밀번호 확인

@router.post("/profile/verify-password")
def verify_profile_password(
    request: PasswordVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """개인정보 진입 시 비밀번호 확인"""
    if not verify_password(request.password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="비밀번호가 올바르지 않습니다"
        )
    return {
        "success": True,
        "data": {
            "email": current_user.email,
            "name": current_user.name or "",
            "real_name": current_user.real_name or "",
            "phone": current_user.phone or "",
            "birth_date": current_user.birth_date or "",
            "nationality": current_user.nationality or "",
            "email_verified": current_user.email_verified or False,
            "phone_verified": current_user.phone_verified or False,
            "created_at": str(current_user.created_at) if current_user.created_at else None
        }
    }

@router.put("/profile/personal")
def update_personal_info(
    request: PersonalInfoUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """개인정보 수정 (비밀번호 재확인 필요)"""
    # 비밀번호 확인
    if not verify_password(request.password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="비밀번호가 올바르지 않습니다"
        )

    # 정보 업데이트
    if request.real_name is not None:
        current_user.real_name = request.real_name.strip()
    if request.name is not None:
        current_user.name = request.name.strip()
    if request.phone is not None:
        current_user.phone = request.phone.replace("-", "").replace(" ", "").strip()
    if request.birth_date is not None:
        current_user.birth_date = request.birth_date.strip()
    if request.nationality is not None:
        current_user.nationality = request.nationality.strip()

    db.commit()
    db.refresh(current_user)

    return {
        "success": True,
        "message": "개인정보가 저장되었습니다",
        "data": {
            "email": current_user.email,
            "name": current_user.name or "",
            "real_name": current_user.real_name or "",
            "phone": current_user.phone or "",
            "birth_date": current_user.birth_date or "",
            "nationality": current_user.nationality or "",
            "email_verified": current_user.email_verified or False,
            "phone_verified": current_user.phone_verified or False,
        }
    }


# ========== 로그인 기록 ==========
@router.get("/login-history")
def get_login_history(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """로그인 기록 조회 (최근 20건)"""
    # 현재 세션 ID 추출
    auth_header = request.headers.get("authorization", "")
    current_sid = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        payload = decode_token(token)
        if payload:
            current_sid = payload.get("sid")

    records = db.query(LoginHistory).filter(
        LoginHistory.user_id == current_user.id
    ).order_by(LoginHistory.created_at.desc()).limit(20).all()

    result = []
    for r in records:
        # 시간 표시
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        created = r.created_at
        if created.tzinfo is None:
            from datetime import timezone as tz
            created = created.replace(tzinfo=tz.utc)
        diff = now - created
        
        if diff.total_seconds() < 60:
            time_str = "방금 전"
        elif diff.total_seconds() < 3600:
            time_str = f"{int(diff.total_seconds() // 60)}분 전"
        elif diff.total_seconds() < 86400:
            time_str = f"{int(diff.total_seconds() // 3600)}시간 전"
        elif diff.days < 30:
            time_str = f"{diff.days}일 전"
        else:
            time_str = created.strftime("%Y.%m.%d")

        is_current = (current_sid and r.session_id == current_sid)
        
        result.append({
            "id": r.id,
            "browser": r.browser or "Unknown",
            "os": r.os_name or "Unknown",
            "device_type": r.device_type or "desktop",
            "ip_address": r.ip_address or "",
            "location": r.location or "",
            "country_code": r.country_code or "",
            "city": r.city or "",
            "time_str": time_str,
            "is_current": is_current,
            "created_at": str(r.created_at)
        })

    return {"records": result}


# ========== 닉네임 변경 (간편) ==========
class NameUpdateRequest(BaseModel):
    name: str

@router.post("/profile/update-name")
def update_name(
    request: NameUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """닉네임 변경 (히어로 섹션에서 간편 변경)"""
    new_name = request.name.strip()
    if not new_name or len(new_name) > 30:
        raise HTTPException(status_code=400, detail="닉네임은 1~30자로 입력해주세요")

    current_user.name = new_name
    db.commit()
    return {"success": True, "name": new_name}

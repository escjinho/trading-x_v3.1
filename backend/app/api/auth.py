from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from ..database import get_db
from ..models.user import User
from ..models.grade_config import GradeConfig
from ..models.demo_trade import DemoTrade, DemoPosition
from ..schemas.user import UserCreate, UserLogin, UserResponse, Token
from ..utils.security import get_password_hash, verify_password, create_access_token, create_refresh_token, decode_token
from ..services.email_service import generate_verification_code, verify_code, send_verification_email

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
def login(user_data: UserLogin, db: Session = Depends(get_db)):
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
    
    # 토큰 생성
    access_token = create_access_token(data={"sub": str(user.id)})
    refresh_token = create_refresh_token(data={"sub": str(user.id)})
    
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

    # 인증코드 생성 및 발송
    code = generate_verification_code(request.email)
    result = send_verification_email(request.email, code)

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

    # 1) 거래 통계 — 완료된 거래의 총 lots 합산
    total_lots_result = db.query(func.sum(DemoTrade.volume)).filter(
        DemoTrade.user_id == current_user.id
    ).scalar()
    total_lots = float(total_lots_result) if total_lots_result else 0.0

    total_trades = db.query(func.count(DemoTrade.id)).filter(
        DemoTrade.user_id == current_user.id
    ).scalar() or 0

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
        "created_at": str(current_user.created_at) if current_user.created_at else None,
        "email_verified": current_user.email_verified or False,
        "phone": current_user.phone,
        "phone_verified": current_user.phone_verified or False,
        "has_mt5_account": current_user.has_mt5_account or False,
        "is_admin": current_user.is_admin or False,

        # 거래 통계
        "total_trades": total_trades,
        "total_lots": round(total_lots, 2),
        "open_positions": open_positions,

        # 등급
        "grade": current_grade_data,
        "next_grade": next_grade_data,
        "all_grades": all_grades
    }
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..models.mt5_account import MT5Account
from ..schemas.mt5_account import MT5AccountCreate, MT5AccountResponse, MT5AccountStatus
from ..utils.security import decode_token
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

router = APIRouter(prefix="/accounts", tags=["MT5 계정"])
security = HTTPBearer()

def get_current_user_id(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)):
    """현재 로그인한 사용자 ID 가져오기"""
    token = credentials.credentials
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다")
    return int(payload.get("sub"))

@router.post("/", response_model=MT5AccountResponse)
def add_account(
    account_data: MT5AccountCreate,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    """MT5 계정 추가"""
    # 중복 확인
    existing = db.query(MT5Account).filter(
        MT5Account.user_id == user_id,
        MT5Account.account_number == account_data.account_number,
        MT5Account.server == account_data.server
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="이미 등록된 계정입니다")
    
    # 새 계정 생성
    new_account = MT5Account(
        user_id=user_id,
        account_number=account_data.account_number,
        server=account_data.server,
        password_encrypted=account_data.password,  # 추후 암호화 적용
        broker_name=account_data.broker_name,
        is_demo=account_data.is_demo
    )
    db.add(new_account)
    db.commit()
    db.refresh(new_account)
    
    return new_account

@router.get("/", response_model=List[MT5AccountResponse])
def get_accounts(
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    """내 MT5 계정 목록"""
    accounts = db.query(MT5Account).filter(
        MT5Account.user_id == user_id,
        MT5Account.is_active == True
    ).all()
    return accounts

@router.get("/{account_id}", response_model=MT5AccountStatus)
def get_account_status(
    account_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    """MT5 계정 상태 조회"""
    account = db.query(MT5Account).filter(
        MT5Account.id == account_id,
        MT5Account.user_id == user_id
    ).first()
    
    if not account:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")
    
    # MT5 연결 시도 (추후 실제 구현)
    return MT5AccountStatus(
        id=account.id,
        account_number=account.account_number,
        server=account.server,
        broker_name=account.broker_name,
        is_demo=account.is_demo,
        is_active=account.is_active,
        balance=0.0,
        equity=0.0,
        profit=0.0,
        connected=False
    )

@router.delete("/{account_id}")
def delete_account(
    account_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    """MT5 계정 삭제"""
    account = db.query(MT5Account).filter(
        MT5Account.id == account_id,
        MT5Account.user_id == user_id
    ).first()
    
    if not account:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")
    
    account.is_active = False
    db.commit()
    
    return {"message": "계정이 삭제되었습니다"}
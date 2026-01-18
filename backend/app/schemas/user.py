from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

# 회원가입 요청
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None

# 로그인 요청
class UserLogin(BaseModel):
    email: EmailStr
    password: str

# 사용자 응답 (비밀번호 제외)
class UserResponse(BaseModel):
    id: int
    email: str
    name: Optional[str]
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

# 토큰 응답
class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

# 토큰 데이터
class TokenData(BaseModel):
    user_id: Optional[int] = None
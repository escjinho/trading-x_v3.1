from pydantic import BaseModel
from typing import Optional
from datetime import datetime

# MT5 계정 생성 요청
class MT5AccountCreate(BaseModel):
    account_number: str
    server: str
    password: str
    broker_name: Optional[str] = None
    is_demo: bool = True

# MT5 계정 응답
class MT5AccountResponse(BaseModel):
    id: int
    account_number: str
    server: str
    broker_name: Optional[str]
    is_demo: bool
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

# MT5 계정 상태 (잔액 포함)
class MT5AccountStatus(BaseModel):
    id: int
    account_number: str
    server: str
    broker_name: Optional[str]
    is_demo: bool
    is_active: bool
    balance: float = 0.0
    equity: float = 0.0
    profit: float = 0.0
    connected: bool = False
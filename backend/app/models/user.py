from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float
from sqlalchemy.sql import func
from ..database import Base

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(100))
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # ========== Demo 모드 필드 ==========
    demo_balance = Column(Float, default=10000.0)      # 데모 잔고
    demo_equity = Column(Float, default=10000.0)       # 데모 자산
    demo_today_profit = Column(Float, default=0.0)     # 오늘 수익
    has_mt5_account = Column(Boolean, default=False)   # MT5 계정 연결 여부
    
    # ========== Demo 마틴 모드 필드 ==========
    demo_martin_step = Column(Integer, default=1)           # 현재 마틴 단계
    demo_martin_max_steps = Column(Integer, default=5)      # 최대 마틴 단계
    demo_martin_accumulated_loss = Column(Float, default=0.0)  # 누적 손실
    demo_martin_base_lot = Column(Float, default=0.01)      # 기본 랏 사이즈
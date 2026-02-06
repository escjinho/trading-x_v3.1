from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, Text
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
    mt5_account_number = Column(String(50), nullable=True)  # MT5 계좌번호
    mt5_server = Column(String(100), nullable=True)         # MT5 서버
    mt5_password_encrypted = Column(Text, nullable=True)    # MT5 비밀번호 (AES 암호화)
    mt5_connected_at = Column(DateTime(timezone=True), nullable=True)  # MT5 연결 시각

    # ========== MT5 계정 잔고 (검증 시점 스냅샷) ==========
    mt5_balance = Column(Float, nullable=True)        # MT5 잔고
    mt5_equity = Column(Float, nullable=True)         # MT5 자산
    mt5_leverage = Column(Integer, nullable=True)     # MT5 레버리지
    mt5_currency = Column(String(10), nullable=True)  # MT5 통화 (USD 등)
    
    # ========== Demo 마틴 모드 필드 ==========
    demo_martin_step = Column(Integer, default=1)           # 현재 마틴 단계
    demo_martin_max_steps = Column(Integer, default=5)      # 최대 마틴 단계
    demo_martin_accumulated_loss = Column(Float, default=0.0)  # 누적 손실
    demo_martin_base_lot = Column(Float, default=0.01)      # 기본 랏 사이즈
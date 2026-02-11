from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from ..database import Base

# ========== 데모 거래 내역 ==========
class DemoTrade(Base):
    __tablename__ = "demo_trades"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    symbol = Column(String(50), nullable=False)
    trade_type = Column(String(10), nullable=False)  # BUY / SELL
    volume = Column(Float, nullable=False)
    entry_price = Column(Float, nullable=False)
    exit_price = Column(Float)
    profit = Column(Float, default=0.0)
    is_closed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    closed_at = Column(DateTime(timezone=True))


# ========== 데모 포지션 (열린 거래) ==========
class DemoPosition(Base):
    __tablename__ = "demo_positions"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    symbol = Column(String(50), nullable=False)
    trade_type = Column(String(10), nullable=False)  # BUY / SELL
    volume = Column(Float, nullable=False)
    entry_price = Column(Float, nullable=False)
    target_profit = Column(Float, default=100.0)  # 목표 수익
    magic = Column(Integer, default=100001)  # 패널 구분용 매직넘버
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ========== 데모 마틴 상태 ==========
class DemoMartinState(Base):
    __tablename__ = "demo_martin_states"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    magic = Column(Integer, nullable=False, default=100001)
    step = Column(Integer, default=1)
    max_steps = Column(Integer, default=5)
    accumulated_loss = Column(Float, default=0.0)
    base_lot = Column(Float, default=0.01)
    base_target = Column(Float, default=50.0)
    enabled = Column(Boolean, default=False)
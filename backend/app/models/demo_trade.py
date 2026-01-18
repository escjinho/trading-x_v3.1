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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
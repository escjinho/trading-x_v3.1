from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from ..database import Base

class LiveTrade(Base):
    __tablename__ = "live_trades"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    symbol = Column(String(50), nullable=False)
    trade_type = Column(String(10), nullable=False)   # BUY / SELL
    volume = Column(Float, nullable=False)             # lots (등급 계산용 핵심)
    position_id = Column(String(100), nullable=True, index=True)  # MT5 포지션 ID
    entry_price = Column(Float, default=0.0)
    exit_price = Column(Float, nullable=True)
    profit = Column(Float, default=0.0)
    is_closed = Column(Boolean, default=False)
    magic = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    closed_at = Column(DateTime(timezone=True), nullable=True)

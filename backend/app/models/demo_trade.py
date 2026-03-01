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
    magic = Column(Integer, default=100001)
    tp_price = Column(Float, nullable=True)   # B안: TP 가격
    sl_price = Column(Float, nullable=True)   # B안: SL 가격  # 패널 구분용 매직넘버
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


# ========== 데모 잔고 변동 이력 (거래소 원장) ==========
class DemoTransaction(Base):
    __tablename__ = "demo_transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    tx_type = Column(String(20), nullable=False)  # reset / topup / trade
    amount = Column(Float, nullable=False)          # 변동 금액 (reset: 리셋후잔고, topup: 충전액, trade: 손익)
    balance_before = Column(Float, default=0.0)     # 변동 전 잔고
    balance_after = Column(Float, default=0.0)      # 변동 후 잔고
    description = Column(String(200), default="")   # 설명 (예: "리셋", "충전 $5,000", "BTCUSD BUY +$150")
    reference_id = Column(Integer, nullable=True)    # trade인 경우 DemoTrade.id 참조
    created_at = Column(DateTime(timezone=True), server_default=func.now())
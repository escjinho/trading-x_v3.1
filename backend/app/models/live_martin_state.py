# app/models/live_martin_state.py
"""
라이브 마틴 상태 모델
- DemoMartinState와 동일한 구조
- 유저별/magic별 독립 관리
"""

from sqlalchemy import Column, Integer, Float, Boolean, ForeignKey, DateTime
from sqlalchemy.sql import func
from ..database import Base


class LiveMartinState(Base):
    __tablename__ = "live_martin_states"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    magic = Column(Integer, nullable=False, default=100001)  # 패널별 독립 관리
    step = Column(Integer, default=1)
    max_steps = Column(Integer, default=7)
    accumulated_loss = Column(Float, default=0.0)
    base_lot = Column(Float, default=0.01)
    base_target = Column(Float, default=50.0)
    enabled = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

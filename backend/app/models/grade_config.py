from sqlalchemy import Column, Integer, String, Float, Boolean
from sqlalchemy.sql import func
from sqlalchemy import DateTime
from ..database import Base

class GradeConfig(Base):
    __tablename__ = "grade_configs"

    id = Column(Integer, primary_key=True, index=True)
    grade_name = Column(String(50), nullable=False)        # Standard, Pro, VIP
    sort_order = Column(Integer, default=0)                 # 정렬 순서 (0, 1, 2)
    min_lots = Column(Float, default=0.0)                   # 최소 누적 거래량 (lots)
    self_referral = Column(Float, default=0.0)              # 셀프 리퍼럴 금액 ($)
    benefit_desc = Column(String(200), nullable=True)       # 혜택 설명
    badge_color = Column(String(20), default='#888')        # 뱃지 색상
    is_active = Column(Boolean, default=True)               # 활성 여부
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

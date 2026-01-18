from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base

class MT5Account(Base):
    __tablename__ = "mt5_accounts"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_number = Column(String(50), nullable=False)
    server = Column(String(100), nullable=False)
    password_encrypted = Column(Text)
    broker_name = Column(String(100))
    is_demo = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 관계 설정
    # user = relationship("User", back_populates="mt5_accounts")
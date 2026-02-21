from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.sql import func
from ..database import Base

class LoginHistory(Base):
    __tablename__ = "login_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(Text, nullable=True)
    browser = Column(String(50), nullable=True)
    os_name = Column(String(50), nullable=True)
    device_type = Column(String(20), nullable=True)   # mobile / desktop / tablet
    location = Column(String(100), nullable=True)
    session_id = Column(String(50), nullable=True, index=True)  # JWT sid와 매칭
    country_code = Column(String(5), nullable=True)            # 국가코드 (KR, US, VN 등)
    city = Column(String(100), nullable=True)                  # 도시명
    created_at = Column(DateTime(timezone=True), server_default=func.now())

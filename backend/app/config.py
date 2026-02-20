from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # 데이터베이스
    DATABASE_URL: str
    
    # JWT 설정
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ALGORITHM: str = "HS256"
    
    # 서버 설정
    DEBUG: bool = True
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # MT5 설정
    MT5_ENABLED: bool = True
    mt5_encrypt_key: str = ""  # MT5 비밀번호 AES 암호화 키

    # SMTP 설정 (이메일 인증)
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "noreply@trading-x.ai"
    SMTP_FROM_NAME: str = "Trading-X"
    SMTP_ENABLED: bool = False  # True면 실제 발송, False면 테스트 모드

    class Config:
        env_file = ".env"

@lru_cache()
def get_settings():
    return Settings()

settings = get_settings()
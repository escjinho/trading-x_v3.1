# ★ .env 파일을 os.environ에 로드 (crypto.py보다 먼저 실행되어야 함)
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .api import auth, account, mt5, demo

app = FastAPI(
    title="Trading-X API",
    description="Trading-X 백엔드 API",
    version="1.0.0"
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 등록
app.include_router(auth.router, prefix="/api")
app.include_router(account.router, prefix="/api")
app.include_router(mt5.router, prefix="/api")
app.include_router(demo.router, prefix="/api")

@app.get("/")
def root():
    return {"message": "Trading-X API Server", "status": "running"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.on_event("shutdown")
def shutdown_event():
    """서버 종료 시 MT5 연결 해제"""
    from .services.mt5_service import MT5Service
    MT5Service.shutdown()

# 정적 파일 서비스 (frontend)
frontend_path = Path(__file__).parent.parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")
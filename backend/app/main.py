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

@app.on_event("startup")
async def startup_event():
    """서버 시작 시 MetaAPI 초기화"""
    try:
        from .api.metaapi_service import startup_metaapi
        await startup_metaapi()
        print("[Main] MetaAPI 초기화 완료")
    except Exception as e:
        print(f"[Main] MetaAPI 초기화 실패 (서버는 계속 실행): {e}")

@app.on_event("shutdown")
async def shutdown_event():
    """서버 종료 시 캔들 캐시 저장 + 연결 해제"""
    # ★ 캔들 캐시 파일 저장
    try:
        from .api.metaapi_service import save_candle_cache
        save_candle_cache()
        print("[Main] 캔들 캐시 저장 완료")
    except Exception as e:
        print(f"[Main] 캔들 캐시 저장 오류: {e}")

    # MetaAPI 연결 종료
    try:
        from .api.metaapi_service import metaapi_service
        await metaapi_service.disconnect()
        print("[Main] MetaAPI 연결 종료")
    except Exception as e:
        print(f"[Main] MetaAPI 종료 오류: {e}")

    # 기존 MT5 종료
    from .services.mt5_service import MT5Service
    MT5Service.shutdown()

# 정적 파일 서비스 (frontend)
frontend_path = Path(__file__).parent.parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")
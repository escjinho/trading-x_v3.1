# ★ .env 파일을 os.environ에 로드 (crypto.py보다 먼저 실행되어야 함)
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .api import auth, account, mt5, demo, admin

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
app.include_router(admin.router, prefix="/api")

@app.get("/")
def root():
    return {"message": "Trading-X API Server", "status": "running"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.get("/api/health")
async def api_health_check():
    """Trading-X 종합 헬스체크 — Redis + DB + MetaAPI"""
    from datetime import datetime
    import os

    checks = {}
    overall = "healthy"

    # 1. Redis 상태
    try:
        from app.redis_client import is_redis_available, get_redis
        if is_redis_available():
            r = get_redis()
            redis_mem = r.info("memory").get("used_memory_human", "?")
            redis_keys = r.dbsize()
            checks["redis"] = {"status": "ok", "memory": redis_mem, "keys": redis_keys}
        else:
            checks["redis"] = {"status": "down"}
            overall = "degraded"
    except Exception as e:
        checks["redis"] = {"status": "error", "detail": str(e)[:100]}
        overall = "degraded"

    # 2. DB 상태
    try:
        from app.database import SessionLocal
        from sqlalchemy import text
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        checks["database"] = {"status": "ok"}
    except Exception as e:
        checks["database"] = {"status": "error", "detail": str(e)[:100]}
        overall = "unhealthy"

    # 3. MetaAPI 시세 상태
    try:
        from app.api.metaapi_service import quote_price_cache, quote_connected
        checks["metaapi"] = {
            "status": "ok" if len(quote_price_cache) > 0 else "warning",
            "symbols": len(quote_price_cache),
            "streaming": bool(quote_connected)
        }
    except Exception as e:
        checks["metaapi"] = {"status": "error", "detail": str(e)[:100]}

    # 4. MetaAPI 슬롯
    try:
        from app.database import SessionLocal
        from app.models.user import User
        db2 = SessionLocal()
        deployed = db2.query(User).filter(User.metaapi_status == 'deployed', User.metaapi_account_id.isnot(None)).count()
        total_users = db2.query(User).count()
        db2.close()
        checks["slots"] = {"deployed": deployed, "max": 300, "total_users": total_users}
    except Exception as e:
        checks["slots"] = {"status": "error", "detail": str(e)[:80]}

    # 5. 서버 정보
    checks["worker_pid"] = os.getpid()

    return {
        "status": overall,
        "timestamp": datetime.utcnow().isoformat(),
        "checks": checks
    }

@app.on_event("startup")
async def startup_event():
    """서버 시작 시 MetaAPI 초기화 (백그라운드 — 서버 즉시 응답 가능)"""
    import asyncio

    async def _init_metaapi_background():
        """MetaAPI를 백그라운드에서 초기화 (서버 시작 블로킹 방지)"""
        await asyncio.sleep(2)  # ★ 서버 완전 시작 후 2초 대기
        try:
            from .api.metaapi_service import startup_metaapi
            await asyncio.wait_for(startup_metaapi(), timeout=90.0)
            print("[Main] ✅ MetaAPI 백그라운드 초기화 완료")
        except asyncio.TimeoutError:
            print("[Main] ⚠️ MetaAPI 초기화 타임아웃 (90초) - 서버는 계속 실행")
        except Exception as e:
            print(f"[Main] ⚠️ MetaAPI 초기화 실패 (서버는 계속 실행): {e}")
            import traceback
            traceback.print_exc()

    # ★★★ 핵심: await 대신 create_task로 백그라운드 실행 ★★★
    asyncio.create_task(_init_metaapi_background())
    print("[Main] 서버 시작 완료 — MetaAPI 백그라운드 초기화 중...")

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
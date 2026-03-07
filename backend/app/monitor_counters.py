"""
Trading-X 모니터링 카운터
- WebSocket 접속자 수
- 주문 성공/실패 카운터
- Redis 기반 (워커 간 공유)
"""

def ws_connect(mode="demo"):
    """WebSocket 접속 시 호출"""
    try:
        from app.redis_client import get_redis
        r = get_redis()
        r.incr(f"monitor:ws:{mode}")
    except Exception:
        pass

def ws_disconnect(mode="demo"):
    """WebSocket 해제 시 호출"""
    try:
        from app.redis_client import get_redis
        r = get_redis()
        r.decr(f"monitor:ws:{mode}")
        # 음수 방지
        val = int(r.get(f"monitor:ws:{mode}") or 0)
        if val < 0:
            r.set(f"monitor:ws:{mode}", 0)
    except Exception:
        pass

def order_success():
    """주문 성공 시 호출"""
    try:
        from app.redis_client import get_redis
        r = get_redis()
        r.incr("monitor:order:success")
        # 1시간 후 자동 리셋 (TTL)
        r.expire("monitor:order:success", 3600)
    except Exception:
        pass

def order_fail(reason="unknown"):
    """주문 실패 시 호출"""
    try:
        from app.redis_client import get_redis
        r = get_redis()
        r.incr("monitor:order:fail")
        r.expire("monitor:order:fail", 3600)
        # 최근 실패 사유 저장 (최대 5개)
        r.lpush("monitor:order:fail_reasons", reason[:100])
        r.ltrim("monitor:order:fail_reasons", 0, 4)
        r.expire("monitor:order:fail_reasons", 3600)
    except Exception:
        pass

def get_stats() -> dict:
    """현재 카운터 조회 (리포트 스크립트에서 사용)"""
    try:
        from app.redis_client import get_redis
        r = get_redis()
        return {
            "ws_demo": int(r.get("monitor:ws:demo") or 0),
            "ws_live": int(r.get("monitor:ws:live") or 0),
            "order_success": int(r.get("monitor:order:success") or 0),
            "order_fail": int(r.get("monitor:order:fail") or 0),
            "fail_reasons": r.lrange("monitor:order:fail_reasons", 0, 4) or []
        }
    except Exception:
        return {"ws_demo": 0, "ws_live": 0, "order_success": 0, "order_fail": 0, "fail_reasons": []}

print("[MonitorCounters] 모듈 로드됨")

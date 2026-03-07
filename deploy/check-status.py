#!/usr/bin/env python3
"""Trading-X 종합 상태 조회 (텔레그램 리포트용)"""
import sys, json
sys.path.insert(0, '/var/www/trading-x/backend')

try:
    from dotenv import load_dotenv
    from pathlib import Path
    load_dotenv(Path('/var/www/trading-x/backend/.env'))
except:
    pass

results = {}

# 1. MetaAPI 슬롯
try:
    from app.database import SessionLocal
    from app.models.user import User
    db = SessionLocal()
    deployed = db.query(User).filter(
        User.metaapi_status == 'deployed',
        User.metaapi_account_id.isnot(None)
    ).count()
    total = db.query(User).count()
    db.close()
    results["slots"] = f"{deployed}/298 (전체 {total}명)"
    results["deployed"] = deployed
    results["total_users"] = total
except Exception as e:
    results["slots"] = f"조회실패: {str(e)[:50]}"

# 2. WS 접속자 + 주문 카운터
try:
    from app.monitor_counters import get_stats
    stats = get_stats()
    results["ws_demo"] = stats["ws_demo"]
    results["ws_live"] = stats["ws_live"]
    results["ws_total"] = stats["ws_demo"] + stats["ws_live"]
    results["order_success"] = stats["order_success"]
    results["order_fail"] = stats["order_fail"]
    reasons = stats.get("fail_reasons", [])
    results["fail_reasons"] = ", ".join(reasons[:3]) if reasons else "없음"
except Exception as e:
    results["ws_total"] = 0
    results["ws_demo"] = 0
    results["ws_live"] = 0
    results["order_success"] = 0
    results["order_fail"] = 0
    results["fail_reasons"] = "조회실패"

# 3. 시세 상태 (Redis에서 종목별 확인)
try:
    from app.redis_client import get_redis
    r = get_redis()
    price_keys = [k for k in r.keys("price:*")]
    active_symbols = []
    for k in price_keys:
        sym = k.replace("price:", "")
        data = r.get(k)
        if data:
            active_symbols.append(sym)
    results["price_symbols"] = len(active_symbols)
    results["price_list"] = ", ".join(sorted(active_symbols)) if active_symbols else "없음"

    # 시세 TTL 확인 (마지막 업데이트로부터 얼마나 됐는지)
    ttl_info = []
    for k in price_keys[:3]:
        ttl = r.ttl(k)
        sym = k.replace("price:", "")
        ttl_info.append(f"{sym}:{ttl}s")
    results["price_ttl"] = ", ".join(ttl_info) if ttl_info else "-"
except Exception as e:
    results["price_symbols"] = 0
    results["price_list"] = "조회실패"
    results["price_ttl"] = "-"

# 4. 캔들 상태
try:
    from app.api.metaapi_service import quote_candle_cache
    candle_status = {}
    timeframes = ["M1", "M5", "M15", "H1"]
    for tf in timeframes:
        count = 0
        for sym, data in quote_candle_cache.items():
            if tf in data and len(data[tf]) > 0:
                count += 1
        candle_status[tf] = count
    results["candles"] = candle_status

    total_symbols = len(quote_candle_cache)
    candle_parts = []
    for tf in timeframes:
        c = candle_status.get(tf, 0)
        emoji = "OK" if c >= total_symbols and c > 0 else "!" if c > 0 else "X"
        candle_parts.append(f"{tf}:{c}/{total_symbols}{emoji}")
    results["candle_summary"] = " ".join(candle_parts)
except Exception as e:
    results["candle_summary"] = f"조회실패: {str(e)[:50]}"

# 5. 에러 로그 카운트 (최근 1시간)
try:
    import subprocess
    cmd = "sudo journalctl -u trading-x --since '1 hour ago' --no-pager 2>/dev/null | grep -ci 'error' || echo 0"
    error_count = subprocess.getoutput(cmd).strip()
    results["error_count"] = error_count

    # MetaAPI 관련 에러
    cmd2 = "sudo journalctl -u trading-x --since '1 hour ago' --no-pager 2>/dev/null | grep -ci 'metaapi.*error\\|metaapi.*fail\\|metaapi.*timeout' || echo 0"
    metaapi_errors = subprocess.getoutput(cmd2).strip()
    results["metaapi_errors"] = metaapi_errors
except:
    results["error_count"] = "?"
    results["metaapi_errors"] = "?"

# JSON 출력
print(json.dumps(results, ensure_ascii=False))

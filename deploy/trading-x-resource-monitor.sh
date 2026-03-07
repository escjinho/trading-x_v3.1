#!/bin/bash
# Trading-X 리소스 모니터링 (5분마다 실행)
# 과부하, 메모리 부족, 디스크 부족 시 텔레그램 알림

TELEGRAM_BOT_TOKEN="8457289677:AAHx0tFqpHeTie8d9DFUND74eQrKsH67PMw"
TELEGRAM_CHAT_ID="1051281649"
ALERT_FILE="/tmp/trading-x-resource-alert"

send_telegram() {
    if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d "chat_id=${TELEGRAM_CHAT_ID}" \
            -d "text=$1" \
            -d "parse_mode=HTML" > /dev/null 2>&1
    fi
}

# 메모리 사용률 (%)
MEM_TOTAL=$(free | grep Mem | awk '{print $2}')
MEM_USED=$(free | grep Mem | awk '{print $3}')
MEM_PERCENT=$((MEM_USED * 100 / MEM_TOTAL))

# CPU 사용률 (%)
CPU_PERCENT=$(top -bn1 | grep "Cpu(s)" | awk '{print int($2 + $4)}')

# 디스크 사용률 (%)
DISK_PERCENT=$(df / | tail -1 | awk '{print int($5)}')

# 워커 수 (Uvicorn 마스터 + 워커)
MASTER_PID=$(pgrep -of 'uvicorn.*app.main:app' 2>/dev/null)
if [ -n "$MASTER_PID" ]; then
    WORKER_COUNT=$(pstree -p $MASTER_PID 2>/dev/null | grep -c 'python3([0-9]*)')
else
    WORKER_COUNT=0
fi

# Redis 상태
REDIS_OK=$(redis-cli ping 2>/dev/null)
REDIS_MEM=$(redis-cli INFO memory 2>/dev/null | grep used_memory_human | cut -d: -f2 | tr -d '[:space:]')
REDIS_KEYS=$(redis-cli DBSIZE 2>/dev/null | awk '{print $2}')

# 알림 조건 체크
ALERTS=""

# 메모리 80% 이상
if [ "$MEM_PERCENT" -ge 80 ]; then
    ALERTS="${ALERTS}⚠️ 메모리 과부하: ${MEM_PERCENT}% 사용 중\n"
fi

# CPU 90% 이상
if [ "$CPU_PERCENT" -ge 90 ]; then
    ALERTS="${ALERTS}⚠️ CPU 과부하: ${CPU_PERCENT}% 사용 중\n"
fi

# 디스크 85% 이상
if [ "$DISK_PERCENT" -ge 85 ]; then
    ALERTS="${ALERTS}⚠️ 디스크 부족: ${DISK_PERCENT}% 사용 중\n"
fi

# 워커 5개 미만 (비정상) — Uvicorn 마스터 1 + --workers 4 기준
if [ "$WORKER_COUNT" -lt 5 ]; then
    ALERTS="${ALERTS}⚠️ 워커 부족: ${WORKER_COUNT}/5개 동작 중\n"
fi

# ===== 용량 임계 경고 (슬롯/메모리/워커) =====
VENV_PYTHON="/var/www/trading-x/backend/venv/bin/python3"

# MetaAPI 슬롯 사용률 확인
SLOT_INFO=$($VENV_PYTHON -c "
import sys
sys.path.insert(0, '/var/www/trading-x/backend')
try:
    from dotenv import load_dotenv
    from pathlib import Path
    load_dotenv(Path('/var/www/trading-x/backend/.env'))
    from app.database import SessionLocal
    from app.models.user import User
    db = SessionLocal()
    deployed = db.query(User).filter(User.metaapi_status == 'deployed', User.metaapi_account_id.isnot(None)).count()
    db.close()
    print(deployed)
except:
    print(-1)
" 2>/dev/null)

SLOT_MAX=298

if [ "$SLOT_INFO" != "-1" ] && [ -n "$SLOT_INFO" ]; then
    # 슬롯 90% 이상 → 긴급 경고
    SLOT_THRESHOLD_CRITICAL=$((SLOT_MAX * 90 / 100))
    # 슬롯 70% 이상 → 주의 경고
    SLOT_THRESHOLD_WARNING=$((SLOT_MAX * 70 / 100))

    if [ "$SLOT_INFO" -ge "$SLOT_THRESHOLD_CRITICAL" ]; then
        ALERTS="${ALERTS}🚨 슬롯 긴급: ${SLOT_INFO}/${SLOT_MAX}개 (90% 이상!) 즉시 확장 필요!\n"
    elif [ "$SLOT_INFO" -ge "$SLOT_THRESHOLD_WARNING" ]; then
        ALERTS="${ALERTS}⚠️ 슬롯 주의: ${SLOT_INFO}/${SLOT_MAX}개 (70% 이상) 확장 준비 필요\n"
    fi
fi

# 메모리 60% 경고 (사전 경고), 80%는 위에서 이미 처리
if [ "$MEM_PERCENT" -ge 60 ] && [ "$MEM_PERCENT" -lt 80 ]; then
    ALERTS="${ALERTS}📊 메모리 주의: ${MEM_PERCENT}% 사용 중 (60% 초과)\n"
fi

# 워커 부족 사전 경고 (3개 이하)
if [ "$WORKER_COUNT" -le 3 ] && [ "$WORKER_COUNT" -ge 2 ]; then
    ALERTS="${ALERTS}📊 워커 주의: ${WORKER_COUNT}/5개 동작 중 (일부 워커 다운)\n"
fi

# Redis 다운
if [ "$REDIS_OK" != "PONG" ]; then
    ALERTS="${ALERTS}⚠️ Redis 다운!\n"
fi

# 알림 발송 (중복 방지: 같은 알림은 30분 간격으로만)
if [ -n "$ALERTS" ]; then
    ALERT_HASH=$(echo "$ALERTS" | md5sum | cut -d' ' -f1)
    LAST_ALERT_FILE="${ALERT_FILE}-${ALERT_HASH}"
    
    # 30분(1800초) 이내 같은 알림 보냈으면 스킵
    if [ -f "$LAST_ALERT_FILE" ]; then
        LAST_TIME=$(cat "$LAST_ALERT_FILE")
        NOW=$(date +%s)
        DIFF=$((NOW - LAST_TIME))
        if [ "$DIFF" -lt 1800 ]; then
            exit 0
        fi
    fi
    
    send_telegram "🔴 <b>Trading-X 리소스 경고!</b>

${ALERTS}
📊 현재 상태:
- 메모리: ${MEM_PERCENT}% ($(free -h | grep Mem | awk '{print $3"/"$2}'))
- CPU: ${CPU_PERCENT}%
- 디스크: ${DISK_PERCENT}%
- 워커: ${WORKER_COUNT}/5개
- 슬롯: ${SLOT_INFO:-?}/${SLOT_MAX:-298}개
- Redis: ${REDIS_OK:-DOWN} (${REDIS_MEM:-?}, keys:${REDIS_KEYS:-?})

⏰ $(date '+%Y-%m-%d %H:%M:%S')"

    date +%s > "$LAST_ALERT_FILE"
fi

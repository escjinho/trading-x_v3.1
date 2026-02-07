#!/bin/bash
# Trading-X Health Check Script
# 5분마다 crontab으로 실행되어 서버 상태 확인 및 자동 복구

LOG_FILE="/var/log/trading-x-health.log"
MAX_LOG_SIZE=1048576  # 1MB

# 로그 파일 크기 관리
if [ -f "$LOG_FILE" ] && [ $(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null) -gt $MAX_LOG_SIZE ]; then
    mv "$LOG_FILE" "${LOG_FILE}.old"
fi

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# 헬스체크 URL
HEALTH_URL="http://localhost:8000/"

# curl로 헬스체크 (5초 타임아웃)
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_URL" 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    # 정상
    log "OK - HTTP $HTTP_CODE"
else
    # 실패 - 서비스 재시작
    log "FAIL - HTTP $HTTP_CODE - Restarting trading-x service..."

    # 서비스 재시작
    systemctl restart trading-x

    # 5초 대기 후 재확인
    sleep 5

    HTTP_CODE_AFTER=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_URL" 2>/dev/null)

    if [ "$HTTP_CODE_AFTER" = "200" ]; then
        log "RECOVERED - Service restarted successfully"
    else
        log "CRITICAL - Service restart failed, HTTP $HTTP_CODE_AFTER"
    fi
fi

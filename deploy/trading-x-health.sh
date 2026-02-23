#!/bin/bash
# Trading-X 강화 헬스체크 + 자동 복구 스크립트 v2
# 매 분 crontab으로 실행

LOG_FILE="/var/log/trading-x-health.log"
LOCK_FILE="/tmp/trading-x-health.lock"
MAX_LOG_SIZE=2097152  # 2MB

# ★ 동시 실행 방지 (lock 파일)
if [ -f "$LOCK_FILE" ]; then
    LOCK_AGE=$(($(date +%s) - $(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo 0)))
    if [ "$LOCK_AGE" -lt 120 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] SKIP - Lock exists (${LOCK_AGE}s old)" >> "$LOG_FILE"
        exit 0
    fi
    rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"
trap "rm -f $LOCK_FILE" EXIT

# 로그 로테이션
if [ -f "$LOG_FILE" ] && [ $(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0) -gt $MAX_LOG_SIZE ]; then
    mv "$LOG_FILE" "${LOG_FILE}.old"
fi

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# ★★★ 텔레그램 알림 (봇 토큰 설정 시 활성화) ★★★
TELEGRAM_BOT_TOKEN="8457289677:AAHx0tFqpHeTie8d9DFUND74eQrKsH67PMw"
TELEGRAM_CHAT_ID="1051281649"
send_telegram() {
    if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d "chat_id=${TELEGRAM_CHAT_ID}" \
            -d "text=$1" \
            -d "parse_mode=HTML" > /dev/null 2>&1
    fi
}

# ========== 헬스체크 ==========
HEALTH_URL="http://localhost:8000/"
API_HEALTH_URL="http://localhost:8000/api/health"

# 1차: 메인 엔드포인트
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    # 2차: API 헬스체크 (더 정확)
    API_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$API_HEALTH_URL" 2>/dev/null)
    if [ "$API_CODE" = "200" ]; then
        log "OK - Main:$HTTP_CODE API:$API_CODE"
        exit 0
    fi
fi

# ========== 실패! 복구 시작 ==========
log "⚠️ FAIL - HTTP:$HTTP_CODE - 복구 시작..."
send_telegram "🔴 <b>Trading-X 장애 감지!</b>%0AHTTP: $HTTP_CODE%0A시간: $(date '+%H:%M:%S')%0A복구 시작..."

# Step 1: 정상 재시작 시도
log "Step 1: systemctl restart..."
systemctl restart trading-x
sleep 10

HTTP_AFTER=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null)
if [ "$HTTP_AFTER" = "200" ]; then
    log "✅ RECOVERED - Step 1 성공 (systemctl restart)"
    send_telegram "✅ <b>Trading-X 복구 완료!</b>%0AStep 1: systemctl restart 성공"
    exit 0
fi

# Step 2: 포트 강제 해제 + 재시작
log "Step 2: 포트 강제 해제 + 재시작..."
fuser -k 8000/tcp 2>/dev/null
sleep 2
systemctl restart trading-x
sleep 15

HTTP_AFTER=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null)
if [ "$HTTP_AFTER" = "200" ]; then
    log "✅ RECOVERED - Step 2 성공 (포트 해제 + restart)"
    send_telegram "✅ <b>Trading-X 복구 완료!</b>%0AStep 2: 포트 해제 + restart"
    exit 0
fi

# Step 3: 모든 관련 프로세스 강제 종료 + 재시작
log "Step 3: 전체 프로세스 kill + 재시작..."
pkill -9 -f "uvicorn app.main" 2>/dev/null
fuser -k 8000/tcp 2>/dev/null
sleep 3
systemctl start trading-x
sleep 20

HTTP_AFTER=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null)
if [ "$HTTP_AFTER" = "200" ]; then
    log "✅ RECOVERED - Step 3 성공 (kill all + start)"
    send_telegram "✅ <b>Trading-X 복구 완료!</b>%0AStep 3: kill all + start"
    exit 0
fi

# Step 4: 최후의 수단
log "🔴 CRITICAL - 3차 복구 실패! 30초 후 재시도..."
send_telegram "🔴 <b>Trading-X 복구 실패!</b>%0A3단계 모두 실패%0A30초 후 마지막 시도..."

sleep 30
pkill -9 -f "uvicorn" 2>/dev/null
fuser -k 8000/tcp 2>/dev/null
sleep 5
systemctl start trading-x
sleep 30

HTTP_FINAL=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null)
if [ "$HTTP_FINAL" = "200" ]; then
    log "✅ RECOVERED - Step 4 성공 (최종 시도)"
    send_telegram "✅ <b>Trading-X 최종 복구 성공!</b>"
else
    log "🔴 CRITICAL FAILURE - 모든 복구 실패! HTTP:$HTTP_FINAL"
    send_telegram "🔴🔴🔴 <b>Trading-X 완전 장애!</b>%0A모든 자동 복구 실패%0A수동 확인 필요!"
fi

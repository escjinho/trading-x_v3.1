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

# 워커 수
WORKER_COUNT=$(ps aux | grep 'multiprocessing.spawn' | grep -v grep | wc -l)

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

# 워커 4개 미만 (비정상)
if [ "$WORKER_COUNT" -lt 4 ]; then
    ALERTS="${ALERTS}⚠️ 워커 부족: ${WORKER_COUNT}/4개 동작 중\n"
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
- 워커: ${WORKER_COUNT}/4개

⏰ $(date '+%Y-%m-%d %H:%M:%S')"

    date +%s > "$LAST_ALERT_FILE"
fi

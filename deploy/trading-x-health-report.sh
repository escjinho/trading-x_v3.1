#!/bin/bash
# Trading-X 정기 리포트 (텔레그램) — 강화 버전
# 1시간마다 실행: 서비스 상태 + 시세 + 접속자 + 주문 + 캔들 + 슬롯

TELEGRAM_BOT_TOKEN="8457289677:AAHx0tFqpHeTie8d9DFUND74eQrKsH67PMw"
TELEGRAM_CHAT_ID="1051281649"

send_telegram() {
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${TELEGRAM_CHAT_ID}" \
        -d "text=$1" \
        -d "parse_mode=HTML" > /dev/null 2>&1
}

# ===== 시스템 정보 수집 =====
MEM_TOTAL=$(free -h | grep Mem | awk '{print $2}')
MEM_USED=$(free -h | grep Mem | awk '{print $3}')
MEM_PERCENT=$(($(free | grep Mem | awk '{print $3}') * 100 / $(free | grep Mem | awk '{print $2}')))
CPU_PERCENT=$(top -bn1 | grep "Cpu(s)" | awk '{print int($2 + $4)}')
DISK_PERCENT=$(df / | tail -1 | awk '{print int($5)}')
WORKER_COUNT=$(ps aux | grep 'uvicorn.*app.main:app' | grep -v grep | wc -l)

# ===== Redis 정보 =====
REDIS_OK=$(redis-cli ping 2>/dev/null || echo "DOWN")
REDIS_MEM=$(redis-cli INFO memory 2>/dev/null | grep used_memory_human | cut -d: -f2 | tr -d '[:space:]' || echo "?")
REDIS_KEYS=$(redis-cli DBSIZE 2>/dev/null | awk '{print $2}' || echo "?")

# ===== 서비스 상태 =====
SVC_TX=$(systemctl is-active trading-x 2>/dev/null)
SVC_REDIS=$(systemctl is-active redis-server 2>/dev/null)
SVC_NGINX=$(systemctl is-active nginx 2>/dev/null)

# ===== Python 종합 상태 조회 =====
VENV_PYTHON="/var/www/trading-x/backend/venv/bin/python3"
STATUS_JSON=$($VENV_PYTHON /var/www/trading-x/deploy/check-status.py 2>/dev/null | tail -1 || echo '{}')

# JSON 파싱
parse_json() {
    echo "$STATUS_JSON" | $VENV_PYTHON -c "import sys,json; d=json.load(sys.stdin); print(d.get('$1','$2'))" 2>/dev/null || echo "$2"
}

SLOT_INFO=$(parse_json "slots" "조회실패")
WS_DEMO=$(parse_json "ws_demo" "0")
WS_LIVE=$(parse_json "ws_live" "0")
WS_TOTAL=$(parse_json "ws_total" "0")
ORDER_SUCCESS=$(parse_json "order_success" "0")
ORDER_FAIL=$(parse_json "order_fail" "0")
FAIL_REASONS=$(parse_json "fail_reasons" "없음")
PRICE_COUNT=$(parse_json "price_symbols" "0")
PRICE_LIST=$(parse_json "price_list" "없음")
PRICE_TTL=$(parse_json "price_ttl" "-")
CANDLE_SUMMARY=$(parse_json "candle_summary" "조회실패")
ERROR_COUNT=$(parse_json "error_count" "?")
METAAPI_ERRORS=$(parse_json "metaapi_errors" "?")

# ===== 상태 판정 =====
if [ "$SVC_TX" = "active" ] && [ "$SVC_REDIS" = "active" ] && [ "$SVC_NGINX" = "active" ] && [ "$REDIS_OK" = "PONG" ]; then
    STATUS_EMOJI="🟢"
    STATUS_TEXT="정상 운영 중"
else
    STATUS_EMOJI="🔴"
    STATUS_TEXT="이상 감지!"
fi

# 시세 경고
PRICE_EMOJI="✅"
if [ "$PRICE_COUNT" = "0" ]; then
    PRICE_EMOJI="❌"
    STATUS_EMOJI="🟡"
fi

# 주문 실패 경고
ORDER_EMOJI=""
if [ "$ORDER_FAIL" != "0" ] && [ "$ORDER_FAIL" != "" ]; then
    ORDER_EMOJI=" ⚠️"
fi

# 슬롯 사용률 경고
DEPLOYED_COUNT=$(parse_json "deployed" "0")
SLOT_EMOJI=""
if [ "$DEPLOYED_COUNT" -ge 268 ]; then
    SLOT_EMOJI=" 🚨 긴급!"
elif [ "$DEPLOYED_COUNT" -ge 209 ]; then
    SLOT_EMOJI=" ⚠️ 주의"
fi

# KST 시간
KST_TIME=$(TZ='Asia/Seoul' date '+%Y-%m-%d %H:%M KST')

# ===== 텔레그램 발송 =====
send_telegram "${STATUS_EMOJI} <b>Trading-X</b>  ─  ${STATUS_TEXT}
━━━━━━━━━━━━━━━━━━━━

▸ <b>Service</b>
  TX: ${SVC_TX}  ·  Redis: ${REDIS_OK}  ·  Nginx: ${SVC_NGINX}

▸ <b>Users</b>  ${WS_TOTAL}명
  Demo ${WS_DEMO}  ·  Live ${WS_LIVE}

▸ <b>Orders</b> (1h)
  Success ${ORDER_SUCCESS}  ·  Fail ${ORDER_FAIL}${ORDER_EMOJI}
  ${ORDER_FAIL:+Reason: ${FAIL_REASONS}}

▸ <b>Quotes</b>  ${PRICE_COUNT} symbols ${PRICE_EMOJI}
  ${PRICE_LIST}

▸ <b>Candles</b>
  ${CANDLE_SUMMARY}

▸ <b>MetaAPI</b>
  Slots: ${SLOT_INFO}${SLOT_EMOJI}

▸ <b>System</b>
  Workers: ${WORKER_COUNT}  ·  Redis: ${REDIS_MEM} (${REDIS_KEYS} keys)
  Mem: ${MEM_PERCENT}%  ·  CPU: ${CPU_PERCENT}%  ·  Disk: ${DISK_PERCENT}%

▸ <b>Errors</b> (1h)
  Total: ${ERROR_COUNT}  ·  MetaAPI: ${METAAPI_ERRORS}

━━━━━━━━━━━━━━━━━━━━
${KST_TIME}"

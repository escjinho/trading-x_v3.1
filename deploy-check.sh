#!/bin/bash
# Trading-X 배포 + 검증 스크립트 v2
# 사용법: bash deploy-check.sh

set -e
echo "========================================="
echo "  Trading-X 배포 스크립트 v2"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================="

# 1. 포트 정리
echo ""
echo "▶ [1/6] 포트 8000 정리..."
if fuser 8000/tcp 2>/dev/null; then
    echo "  기존 프로세스 발견 → 강제 종료"
    fuser -k 8000/tcp 2>/dev/null
    sleep 2
else
    echo "  포트 사용 중인 프로세스 없음 ✅"
fi

# 2. 서비스 재시작
echo ""
echo "▶ [2/6] Trading-X 서비스 재시작..."
sudo systemctl restart trading-x
echo "  systemctl restart 완료"

# 3. nginx 설정 테스트 + reload
echo ""
echo "▶ [3/6] nginx 설정 테스트 + reload..."
if sudo nginx -t 2>&1; then
    sudo nginx -s reload
    echo "  nginx reload 완료 ✅"
else
    echo "  ❌ nginx 설정 오류! reload 건너뜀"
fi

# 4. 서버 시작 대기 (MetaAPI 초기화 고려)
echo ""
echo "▶ [4/6] 서버 시작 대기 (최대 60초)..."
for i in $(seq 1 12); do
    sleep 5
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:8000/ 2>/dev/null)
    if [ "$HTTP_CODE" = "200" ]; then
        echo "  서버 응답 확인! ($((i*5))초) ✅"
        break
    fi
    echo "  대기 중... ($((i*5))초, HTTP:$HTTP_CODE)"
done

# 5. 헬스체크
echo ""
echo "▶ [5/6] 최종 헬스체크..."
HTTP_MAIN=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:8000/ 2>/dev/null)
HTTP_API=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:8000/api/health 2>/dev/null)
echo "  메인 페이지: HTTP $HTTP_MAIN"
echo "  API 헬스: HTTP $HTTP_API"

if [ "$HTTP_MAIN" = "200" ]; then
    echo "  ✅ 서버 정상 동작!"
else
    echo "  ❌ 서버 응답 실패! 로그 확인:"
    sudo journalctl -u trading-x --no-pager -n 20
fi

# 6. 시스템 상태 요약
echo ""
echo "▶ [6/6] 시스템 상태 요약"
echo "  ─────────────────────────────"
echo "  서비스: $(systemctl is-active trading-x)"
echo "  메모리: $(free -h | grep Mem | awk '{print $3"/"$2" (가용 "$7")"}')"
echo "  Swap:   $(free -h | grep Swap | awk '{print $3"/"$2}')"
echo "  워커:   $(ps aux | grep "uvicorn app.main" | grep -v grep | wc -l)개"
echo "  포트:   $(ss -tlnp | grep 8000 | wc -l)개 리스닝"
echo "  ─────────────────────────────"

echo ""
echo "========================================="
echo "  배포 완료! $(date '+%H:%M:%S')"
echo "========================================="

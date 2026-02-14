#!/bin/bash
# Trading-X 배포 전 안전 검증
set -e

echo "🔍 [1/3] Python 문법 체크..."
cd /var/www/trading-x/backend
source venv/bin/activate
python3 -c "
import py_compile, sys, os
errors = []
for root, dirs, files in os.walk('app'):
    for f in files:
        if f.endswith('.py'):
            path = os.path.join(root, f)
            try:
                py_compile.compile(path, doraise=True)
            except py_compile.PyCompileError as e:
                errors.append(str(e))
if errors:
    print('❌ 문법 에러 발견!')
    for e in errors:
        print(e)
    sys.exit(1)
print('✅ 문법 OK')
"

echo "🔍 [2/3] Import 검증..."
cd /var/www/trading-x/backend
python3 -c "
import sys
try:
    from app.api import mt5, demo, auth
    print('✅ Import OK')
except Exception as e:
    print(f'❌ Import 에러: {e}')
    sys.exit(1)
"

echo "🔍 [3/3] 서버 재시작..."
sudo systemctl restart trading-x
sleep 3

if systemctl is-active --quiet trading-x; then
    echo "✅ 서버 정상 가동!"
else
    echo "❌ 서버 시작 실패! 로그 확인:"
    journalctl -u trading-x --no-pager -n 10
    exit 1
fi

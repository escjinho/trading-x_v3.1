#!/bin/bash
# Trading-X 일간 백업 (DB + 설정파일, 7일 보관)
BACKUP_DIR="/var/www/trading-x/backups"
DATE=$(date +%Y%m%d_%H%M%S)

echo "[Backup] 시작: $DATE"

# DB 파일 백업
for db in $(find /var/www/trading-x -maxdepth 3 -name "*.db" 2>/dev/null); do
    BASENAME=$(basename "$db")
    cp "$db" "${BACKUP_DIR}/${BASENAME}.${DATE}.bak"
    echo "[Backup] DB: $db"
done

# 중요 설정 파일 백업
cp /var/www/trading-x/backend/.env "${BACKUP_DIR}/dotenv.${DATE}.bak" 2>/dev/null
cp /etc/systemd/system/trading-x.service "${BACKUP_DIR}/service.${DATE}.bak" 2>/dev/null
cp /etc/redis/redis.conf "${BACKUP_DIR}/redis-conf.${DATE}.bak" 2>/dev/null

# 7일 이상 된 백업 자동 삭제
find "$BACKUP_DIR" -name "*.bak" -mtime +7 -delete 2>/dev/null

COUNT=$(ls -1 "$BACKUP_DIR"/*.bak 2>/dev/null | wc -l)
echo "[Backup] 완료: ${COUNT}개 파일 보관 중"

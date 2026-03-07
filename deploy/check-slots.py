#!/usr/bin/env python3
"""MetaAPI 슬롯 현황 조회 (텔레그램 모니터용)"""
import sys
sys.path.insert(0, '/var/www/trading-x/backend')

try:
    from dotenv import load_dotenv
    from pathlib import Path
    load_dotenv(Path('/var/www/trading-x/backend/.env'))

    from app.database import SessionLocal
    from app.models.user import User

    db = SessionLocal()
    deployed = db.query(User).filter(
        User.metaapi_status == 'deployed',
        User.metaapi_account_id.isnot(None)
    ).count()
    total = db.query(User).count()
    db.close()

    # 시스템 계정 2개 제외
    max_slots = 100
    user_slots = max_slots - 2
    print(f"{deployed}/{user_slots} (전체 {total}명)")
except Exception as e:
    print(f"조회실패")

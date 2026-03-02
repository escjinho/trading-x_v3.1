"""
Trading-X Admin API — 데모 계정 관리
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func as sa_func, Integer, desc, asc
from ..database import get_db
from ..models.user import User
from ..models.demo_trade import DemoTrade, DemoPosition, DemoTransaction
from .auth import get_current_user
from datetime import datetime, timedelta
import pytz

router = APIRouter(prefix="/admin", tags=["Admin"])
KST = pytz.timezone('Asia/Seoul')

def _require_admin(user: User):
    """관리자 권한 체크"""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다")

# ========== 데모 계정 목록 ==========
@router.get("/demo-accounts")
async def list_demo_accounts(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: str = Query(None, description="이메일 또는 계좌번호 검색"),
    sort: str = Query("id_asc", description="정렬: id_asc, id_desc, balance_desc, balance_asc, recent"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 계정 목록 조회 + 검색 + 페이징"""
    _require_admin(current_user)

    query = db.query(User).filter(User.is_active == True)

    # 검색
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (User.email.ilike(search_term)) |
            (User.demo_account_number.ilike(search_term)) |
            (User.name.ilike(search_term))
        )

    # 전체 수
    total = query.count()

    # 정렬
    if sort == "id_desc":
        query = query.order_by(desc(User.id))
    elif sort == "balance_desc":
        query = query.order_by(desc(User.demo_balance))
    elif sort == "balance_asc":
        query = query.order_by(asc(User.demo_balance))
    elif sort == "recent":
        query = query.order_by(desc(User.updated_at))
    else:
        query = query.order_by(asc(User.id))

    # 페이징
    users = query.offset((page - 1) * size).limit(size).all()

    accounts = []
    for u in users:
        # 열린 포지션 수
        open_positions = db.query(sa_func.count(DemoPosition.id)).filter(
            DemoPosition.user_id == u.id
        ).scalar() or 0

        # 총 거래 수
        total_trades = db.query(sa_func.count(DemoTrade.id)).filter(
            DemoTrade.user_id == u.id,
            DemoTrade.is_closed == True
        ).scalar() or 0

        accounts.append({
            "id": u.id,
            "email": u.email,
            "name": u.name or "-",
            "demo_account_number": u.demo_account_number or "-",
            "demo_balance": round(u.demo_balance or 0, 2),
            "demo_equity": round(u.demo_equity or 0, 2),
            "open_positions": open_positions,
            "total_trades": total_trades,
            "has_mt5": u.has_mt5_account or False,
            "mt5_account": u.mt5_account_number or "-",
            "is_admin": u.is_admin,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "updated_at": u.updated_at.isoformat() if u.updated_at else None
        })

    return {
        "total": total,
        "page": page,
        "size": size,
        "total_pages": (total + size - 1) // size,
        "accounts": accounts
    }

# ========== 데모 계정 상세 ==========
@router.get("/demo-accounts/{account_number}")
async def get_demo_account_detail(
    account_number: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """특정 데모 계정 상세 조회"""
    _require_admin(current_user)

    user = db.query(User).filter(User.demo_account_number == account_number).first()
    if not user:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")

    # 열린 포지션
    positions = db.query(DemoPosition).filter(DemoPosition.user_id == user.id).all()
    positions_data = [{
        "id": p.id,
        "symbol": p.symbol,
        "trade_type": p.trade_type,
        "volume": p.volume,
        "entry_price": p.entry_price,
        "magic": p.magic,
        "created_at": p.created_at.isoformat() if p.created_at else None
    } for p in positions]

    # 최근 거래 (최근 50건)
    recent_trades = db.query(DemoTrade).filter(
        DemoTrade.user_id == user.id,
        DemoTrade.is_closed == True
    ).order_by(desc(DemoTrade.closed_at)).limit(50).all()

    trades_data = [{
        "id": t.id,
        "symbol": t.symbol,
        "trade_type": t.trade_type,
        "volume": t.volume,
        "entry_price": t.entry_price,
        "exit_price": t.exit_price,
        "profit": round(t.profit or 0, 2),
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "closed_at": t.closed_at.isoformat() if t.closed_at else None
    } for t in recent_trades]

    # 최근 잔고 변동 (최근 30건)
    recent_tx = db.query(DemoTransaction).filter(
        DemoTransaction.user_id == user.id
    ).order_by(desc(DemoTransaction.created_at)).limit(30).all()

    tx_data = [{
        "id": tx.id,
        "tx_type": tx.tx_type,
        "amount": round(tx.amount, 2),
        "balance_before": round(tx.balance_before, 2),
        "balance_after": round(tx.balance_after, 2),
        "description": tx.description,
        "created_at": tx.created_at.isoformat() if tx.created_at else None
    } for tx in recent_tx]

    # 거래 통계
    total_trades = db.query(sa_func.count(DemoTrade.id)).filter(
        DemoTrade.user_id == user.id, DemoTrade.is_closed == True
    ).scalar() or 0

    win_trades = db.query(sa_func.count(DemoTrade.id)).filter(
        DemoTrade.user_id == user.id, DemoTrade.is_closed == True, DemoTrade.profit > 0
    ).scalar() or 0

    total_profit = db.query(sa_func.sum(DemoTrade.profit)).filter(
        DemoTrade.user_id == user.id, DemoTrade.is_closed == True
    ).scalar() or 0

    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name or "-",
            "demo_account_number": user.demo_account_number,
            "demo_balance": round(user.demo_balance or 0, 2),
            "demo_equity": round(user.demo_equity or 0, 2),
            "has_mt5": user.has_mt5_account or False,
            "mt5_account": user.mt5_account_number or "-",
            "is_admin": user.is_admin,
            "created_at": user.created_at.isoformat() if user.created_at else None
        },
        "stats": {
            "total_trades": total_trades,
            "win_trades": win_trades,
            "win_rate": round(win_trades / total_trades * 100, 1) if total_trades > 0 else 0,
            "total_profit": round(total_profit, 2)
        },
        "open_positions": positions_data,
        "recent_trades": trades_data,
        "recent_transactions": tx_data
    }

# ========== 잔고 조정 ==========
@router.post("/demo-accounts/{account_number}/adjust")
async def adjust_demo_balance(
    account_number: str,
    amount: float = Query(..., description="조정 금액 (양수=충전, 음수=차감)"),
    description: str = Query("관리자 잔고 조정", description="사유"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 잔고 수동 조정"""
    _require_admin(current_user)

    user = db.query(User).filter(User.demo_account_number == account_number).first()
    if not user:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")

    before = user.demo_balance or 0
    after = round(before + amount, 2)

    if after < 0:
        raise HTTPException(status_code=400, detail=f"잔고가 음수가 됩니다 (현재: ${before:.2f}, 조정: ${amount:.2f})")

    # 잔고 업데이트
    user.demo_balance = after
    user.demo_equity = after  # equity도 동기화

    # 트랜잭션 기록
    tx = DemoTransaction(
        user_id=user.id,
        tx_type="admin_adjust",
        amount=amount,
        balance_before=before,
        balance_after=after,
        description=f"[Admin: {current_user.email}] {description}"
    )
    db.add(tx)
    db.commit()

    return {
        "success": True,
        "account_number": account_number,
        "balance_before": round(before, 2),
        "balance_after": after,
        "adjusted_amount": amount,
        "description": description
    }

# ========== 통계 대시보드 ==========
@router.get("/demo-stats")
async def get_demo_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 계정 전체 통계"""
    _require_admin(current_user)

    now = datetime.now(KST)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    # 기본 통계
    total_users = db.query(sa_func.count(User.id)).filter(User.is_active == True).scalar() or 0
    demo_accounts = db.query(sa_func.count(User.id)).filter(
        User.demo_account_number.isnot(None)
    ).scalar() or 0
    mt5_users = db.query(sa_func.count(User.id)).filter(User.has_mt5_account == True).scalar() or 0

    # 잔고 통계
    avg_balance = db.query(sa_func.avg(User.demo_balance)).filter(
        User.demo_account_number.isnot(None)
    ).scalar() or 0
    total_balance = db.query(sa_func.sum(User.demo_balance)).filter(
        User.demo_account_number.isnot(None)
    ).scalar() or 0

    # 거래 통계
    total_trades = db.query(sa_func.count(DemoTrade.id)).filter(
        DemoTrade.is_closed == True
    ).scalar() or 0
    today_trades = db.query(sa_func.count(DemoTrade.id)).filter(
        DemoTrade.is_closed == True,
        DemoTrade.closed_at >= today_start
    ).scalar() or 0
    week_trades = db.query(sa_func.count(DemoTrade.id)).filter(
        DemoTrade.is_closed == True,
        DemoTrade.closed_at >= week_ago
    ).scalar() or 0

    # 열린 포지션 수
    open_positions = db.query(sa_func.count(DemoPosition.id)).scalar() or 0

    # 계좌번호 범위
    first_account = db.query(User.demo_account_number).filter(
        User.demo_account_number.isnot(None)
    ).order_by(asc(User.id)).first()
    last_account = db.query(User.demo_account_number).filter(
        User.demo_account_number.isnot(None)
    ).order_by(desc(User.id)).first()

    return {
        "users": {
            "total": total_users,
            "demo_accounts": demo_accounts,
            "mt5_connected": mt5_users,
            "no_demo_account": total_users - demo_accounts
        },
        "balance": {
            "total": round(total_balance, 2),
            "average": round(avg_balance, 2)
        },
        "trades": {
            "total": total_trades,
            "today": today_trades,
            "this_week": week_trades,
            "open_positions": open_positions
        },
        "account_range": {
            "first": first_account[0] if first_account else None,
            "last": last_account[0] if last_account else None
        }
    }

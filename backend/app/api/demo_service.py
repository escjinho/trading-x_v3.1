"""
demo_service.py — 데모 계정 비즈니스 로직 서비스 레이어

모든 데모 잔고 변동(리셋, 충전, 거래)의 핵심 로직을 관리.
API 엔드포인트(demo.py)와 향후 어드민(admin.py)에서 공통 호출.

[구조]
  API Layer (demo.py, admin.py)
      ↓ 호출
  Service Layer (demo_service.py)  ← 이 파일
      ↓ 사용
  Model Layer (DemoTransaction, DemoTrade, User)
"""

from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func as sa_func

from ..models.demo_trade import DemoTrade, DemoPosition, DemoMartinState, DemoTransaction
from ..models.user import User


# ================================================================
# 헬퍼: 타임존 안전 비교 (Python-side only)
# DB에서 읽은 TIMESTAMPTZ는 UTC-aware, datetime.now()는 naive(로컬)
# Python 비교용으로만 사용, SQL 쿼리에는 원본 그대로 전달
# ================================================================
def _make_naive(dt):
    """UTC-aware datetime → naive local time (서버 시간대 기준)"""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        # UTC-aware → 로컬 naive (서버 시간대: KST = UTC+9)
        import time
        utc_offset = timedelta(seconds=-time.timezone if time.daylight == 0 else -time.altzone)
        return dt.replace(tzinfo=None) + utc_offset
    return dt


# ================================================================
# 1) record_transaction — 모든 잔고 변동을 원장에 기록
# ================================================================
def record_transaction(
    db: Session,
    user_id: int,
    tx_type: str,
    amount: float,
    balance_before: float,
    balance_after: float,
    description: str = "",
    reference_id: int = None
) -> DemoTransaction:
    """
    DemoTransaction 원장에 기록.
    tx_type: "reset" | "topup" | "trade"
    reference_id: trade인 경우 DemoTrade.id 참조
    """
    tx = DemoTransaction(
        user_id=user_id,
        tx_type=tx_type,
        amount=round(amount, 2),
        balance_before=round(balance_before, 2),
        balance_after=round(balance_after, 2),
        description=description,
        reference_id=reference_id
    )
    db.add(tx)
    db.flush()
    return tx


# ================================================================
# 2) reset_account — 데모 계정 완전 초기화 + 앵커 포인트 설정
# ================================================================
def reset_account(db: Session, user: User) -> dict:
    """
    데모 계정 리셋:
    - 열린 포지션 삭제
    - 마틴 상태 리셋
    - 잔고 $10,000 초기화
    - 앵커 포인트(demo_reset_at) 설정
    - DemoTransaction 기록
    """
    old_balance = user.demo_balance or 10000.0
    now = datetime.now()

    # 열린 포지션 삭제
    db.query(DemoPosition).filter(
        DemoPosition.user_id == user.id
    ).delete()

    # 마틴 상태 리셋
    db.query(DemoMartinState).filter(
        DemoMartinState.user_id == user.id
    ).delete()

    # 잔고 초기화
    user.demo_balance = 10000.0
    user.demo_equity = 10000.0
    user.demo_today_profit = 0.0

    # 앵커 포인트 설정 (naive local time — DemoTrade.closed_at과 동일 방식)
    user.demo_reset_at = now
    user.demo_reset_balance = 10000.0

    # 원장 기록
    record_transaction(
        db=db,
        user_id=user.id,
        tx_type="reset",
        amount=10000.0,
        balance_before=old_balance,
        balance_after=10000.0,
        description=f"리셋 (이전잔고: ${old_balance:,.2f})"
    )

    db.commit()
    print(f"[RESET] User {user.id}: ${old_balance:,.2f} → $10,000.00 (앵커: {now})")

    return {
        "success": True,
        "old_balance": old_balance,
        "new_balance": 10000.0,
        "reset_at": now.isoformat()
    }


# ================================================================
# 3) topup_account — 데모 잔고 충전 + 원장 기록
# ================================================================
def topup_account(db: Session, user: User, amount: float) -> dict:
    """데모 잔고 충전 + DemoTransaction 기록"""
    allowed_amounts = [5000, 10000, 50000, 100000]
    if amount not in allowed_amounts:
        amount = 10000.0

    current_balance = user.demo_balance or 10000.0
    max_balance = 100000.0

    if current_balance >= max_balance:
        return {
            "success": False,
            "message": f"최대 잔고 ${max_balance:,.0f}에 도달했습니다.",
            "balance": current_balance,
            "added": 0
        }

    new_balance = min(current_balance + amount, max_balance)
    added = new_balance - current_balance

    user.demo_balance = new_balance
    user.demo_equity = new_balance

    record_transaction(
        db=db,
        user_id=user.id,
        tx_type="topup",
        amount=added,
        balance_before=current_balance,
        balance_after=new_balance,
        description=f"충전 ${added:,.0f}"
    )

    db.commit()
    print(f"[TOPUP] User {user.id}: ${current_balance:,.2f} + ${added:,.0f} → ${new_balance:,.2f}")

    return {
        "success": True,
        "message": f"💰 ${added:,.0f} 충전 완료! 잔고: ${new_balance:,.0f}",
        "balance": new_balance,
        "added": added
    }


# ================================================================
# 4) record_trade_transaction — 거래 청산 시 원장 기록
# ================================================================
def record_trade_transaction(
    db: Session,
    user_id: int,
    trade_id: int,
    symbol: str,
    trade_type: str,
    profit: float,
    balance_before: float,
    balance_after: float
) -> DemoTransaction:
    """거래 청산 시 DemoTransaction 원장에 기록."""
    return record_transaction(
        db=db,
        user_id=user_id,
        tx_type="trade",
        amount=profit,
        balance_before=balance_before,
        balance_after=balance_after,
        description=f"{symbol} {trade_type} {'+'if profit>=0 else ''}{profit:.2f}",
        reference_id=trade_id
    )


# ================================================================
# 5) get_anchor_point — 현재 앵커(리셋) 시점 조회
# ================================================================
def get_anchor_point(user: User) -> tuple:
    """
    현재 앵커 포인트 반환.
    Returns: (anchor_time: datetime|None, anchor_balance: float)

    ★ anchor_time은 DB 원본 그대로 반환 (SQL 비교용).
       Python 비교가 필요하면 호출자가 _make_naive() 사용.
    """
    anchor_time = user.demo_reset_at
    anchor_balance = user.demo_reset_balance or 10000.0
    return (anchor_time, anchor_balance)


# ================================================================
# 6) get_period_initial_balance — 정방향 계산
# ================================================================
def get_period_initial_balance(
    db: Session,
    user_id: int,
    period_start: datetime,
    anchor_time: datetime = None,
    anchor_balance: float = 10000.0
) -> float:
    """
    정방향 계산: 앵커 → 기간 시작 시점의 잔고를 정확하게 산출.
    """
    # 앵커가 없으면 전체 기간 (최초 가입 시점부터)
    if anchor_time is None:
        base = 10000.0
        trade_pl = db.query(sa_func.coalesce(sa_func.sum(DemoTrade.profit), 0)).filter(
            DemoTrade.user_id == user_id,
            DemoTrade.is_closed == True,
            DemoTrade.closed_at < period_start
        ).scalar() or 0

        topup_sum = db.query(sa_func.coalesce(sa_func.sum(DemoTransaction.amount), 0)).filter(
            DemoTransaction.user_id == user_id,
            DemoTransaction.tx_type == "topup",
            DemoTransaction.created_at < period_start
        ).scalar() or 0

        initial = round(base + float(trade_pl) + float(topup_sum), 2)
        return max(initial, 0) or 10000.0

    # Python 비교용 naive 변환
    naive_anchor = _make_naive(anchor_time)

    # 앵커가 기간 시작보다 뒤 (리셋이 기간 중에 발생)
    if naive_anchor >= period_start:
        # 앵커 이후 충전도 초기금액에 포함
        topup_after_anchor = db.query(sa_func.coalesce(sa_func.sum(DemoTransaction.amount), 0)).filter(
            DemoTransaction.user_id == user_id,
            DemoTransaction.tx_type == "topup",
            DemoTransaction.created_at >= anchor_time  # ★ SQL에는 원본 전달
        ).scalar() or 0

        initial = round(anchor_balance + float(topup_after_anchor), 2)
        print(f"[INITIAL] User {user_id}: anchor({naive_anchor}) >= start({period_start}) → base={anchor_balance} + topup={topup_after_anchor} = {initial}")
        return initial

    # 앵커 ~ 기간 시작 사이의 변동 합산 (정방향)
    # ★ SQL 쿼리에는 anchor_time 원본 전달 (PostgreSQL이 TIMESTAMPTZ 비교 처리)
    trade_pl = db.query(sa_func.coalesce(sa_func.sum(DemoTrade.profit), 0)).filter(
        DemoTrade.user_id == user_id,
        DemoTrade.is_closed == True,
        DemoTrade.closed_at >= anchor_time,
        DemoTrade.closed_at < period_start
    ).scalar() or 0

    topup_sum = db.query(sa_func.coalesce(sa_func.sum(DemoTransaction.amount), 0)).filter(
        DemoTransaction.user_id == user_id,
        DemoTransaction.tx_type == "topup",
        DemoTransaction.created_at >= anchor_time,
        DemoTransaction.created_at < period_start
    ).scalar() or 0

    initial = round(anchor_balance + float(trade_pl) + float(topup_sum), 2)
    return max(initial, 0) or anchor_balance


# ================================================================
# 7) get_net_deposits — 기간 내 순입금액 (충전 합계)
# ================================================================
def get_net_deposits(
    db: Session,
    user_id: int,
    start_time: datetime,
    end_time: datetime,
    anchor_time: datetime = None
) -> float:
    """기간 내 충전(topup) 합계. 리셋은 입금으로 보지 않음."""
    # 앵커가 기간 시작보다 뒤면 앵커 이후부터 집계
    effective_start = start_time
    if anchor_time:
        naive_anchor = _make_naive(anchor_time)
        if naive_anchor > start_time:
            effective_start = anchor_time  # ★ SQL에는 원본
        else:
            effective_start = start_time

    topup_sum = db.query(sa_func.coalesce(sa_func.sum(DemoTransaction.amount), 0)).filter(
        DemoTransaction.user_id == user_id,
        DemoTransaction.tx_type == "topup",
        DemoTransaction.created_at >= effective_start,
        DemoTransaction.created_at <= end_time
    ).scalar() or 0

    return round(float(topup_sum), 2)


# ================================================================
# 8) get_filtered_trades — 앵커 이후 + 기간 내 거래 필터
# ================================================================
def get_filtered_trades(
    db: Session,
    user_id: int,
    start_time: datetime,
    end_time: datetime,
    anchor_time: datetime = None
) -> list:
    """
    앵커(리셋) 이후 + 기간 내 청산 거래 목록 반환.
    ★ SQL 쿼리에는 anchor_time 원본 전달 (PostgreSQL이 TIMESTAMPTZ 비교 처리)
    """
    query = db.query(DemoTrade).filter(
        DemoTrade.user_id == user_id,
        DemoTrade.is_closed == True,
        DemoTrade.closed_at >= start_time,
        DemoTrade.closed_at <= end_time
    )

    if anchor_time:
        # ★ 원본 그대로 전달 — PostgreSQL이 TIMESTAMPTZ vs TIMESTAMPTZ 비교
        query = query.filter(DemoTrade.closed_at >= anchor_time)

    trades = query.order_by(DemoTrade.closed_at.asc()).all()
    print(f"[FILTER] User {user_id}: start={start_time}, end={end_time}, anchor={anchor_time} → {len(trades)}건")
    return trades

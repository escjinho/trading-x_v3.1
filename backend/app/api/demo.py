# app/api/demo.py
"""
Demo 모드 API - 모의투자 기능
Trading-X Backend
"""

from fastapi import APIRouter, Depends, HTTPException, status, WebSocket
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from datetime import datetime
import MetaTrader5 as mt5
import asyncio
import json
import random

from ..database import get_db
from ..models.user import User
from ..models.demo_trade import DemoTrade, DemoPosition
from ..utils.security import decode_token
from ..services.indicator_service import IndicatorService

router = APIRouter(prefix="/demo", tags=["Demo"])
security = HTTPBearer()


# ========== 인증 함수 ==========
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    token = credentials.credentials
    payload = decode_token(token)
    
    if not payload:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰")
    
    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == int(user_id)).first()
    
    if not user:
        raise HTTPException(status_code=404, detail="사용자 없음")
    
    return user


# ========== 데모 계정 정보 ==========
@router.get("/account-info")
async def get_demo_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 계정 정보 조회"""
    print(f"\n[ACCOUNT-INFO] 🔵 START - User: {current_user.id}")

    # 모든 열린 포지션 조회 (Account 탭용)
    all_positions = db.query(DemoPosition).filter(
        DemoPosition.user_id == current_user.id
    ).all()
    
    # Buy/Sell 패널용 포지션 (magic=100001)
    positions = [p for p in all_positions if p.magic == 100001]

    print(f"[ACCOUNT-INFO] 🔍 Query result - Found {len(positions)} positions")
    for pos in positions:
        print(f"[ACCOUNT-INFO] 📍 Position ID: {pos.id}, Symbol: {pos.symbol}, Type: {pos.trade_type}, User: {pos.user_id}")

    # 기존 로직 호환 (첫 번째 포지션)
    position = positions[0] if positions else None

    if position:
        print(f"[ACCOUNT-INFO] ✅ First position - ID: {position.id}, Symbol: {position.symbol}")
    else:
        print("[ACCOUNT-INFO] ❌ No positions found!")

    position_data = None
    if position:
        # 현재가 조회
        print(f"[DEBUG] Position found: {position.symbol}, target: {position.target_profit}")
        
        if not mt5.initialize():
            print("[DEBUG] MT5 initialize FAILED!")
            # MT5 연결 실패해도 포지션 정보는 반환
            position_data = {
                "id": position.id,
                "type": position.trade_type,
                "symbol": position.symbol,
                "volume": position.volume,
                "entry": position.entry_price,
                "current": position.entry_price,
                "profit": 0,
                "target": position.target_profit
            }
        else:
            tick = mt5.symbol_info_tick(position.symbol)
            if not tick:
                print(f"[DEBUG] Tick FAILED for {position.symbol}!")
                position_data = {
                    "id": position.id,
                    "type": position.trade_type,
                    "symbol": position.symbol,
                    "volume": position.volume,
                    "entry": position.entry_price,
                    "current": position.entry_price,
                    "profit": 0,
                    "target": position.target_profit
                }
            else:
                print(f"[DEBUG] Tick OK - bid: {tick.bid}, ask: {tick.ask}")
                current_price = tick.bid if position.trade_type == "BUY" else tick.ask
                entry_price = position.entry_price
                
                # MT5에서 심볼 정보로 정확한 손익 계산
                symbol_info = mt5.symbol_info(position.symbol)
                if symbol_info:
                    contract_size = symbol_info.trade_contract_size
                    tick_size = symbol_info.trade_tick_size
                    tick_value = symbol_info.trade_tick_value
                    
                    if position.trade_type == "BUY":
                        price_diff = current_price - entry_price
                    else:
                        price_diff = entry_price - current_price
                    
                    if tick_size > 0:
                        ticks = price_diff / tick_size
                        profit = ticks * tick_value * position.volume
                    else:
                        profit = price_diff * contract_size * position.volume
                else:
                    if position.trade_type == "BUY":
                        profit = (current_price - entry_price) * position.volume
                    else:
                        profit = (entry_price - current_price) * position.volume
                
                profit = round(profit, 2)
                target = position.target_profit or 0
                
                print(f"="*50)
                print(f"[DEBUG] Symbol: {position.symbol}")
                print(f"[DEBUG] Type: {position.trade_type}")
                print(f"[DEBUG] Entry: {entry_price}, Current: {current_price}")
                print(f"[DEBUG] Profit: {profit} (type: {type(profit).__name__})")
                print(f"[DEBUG] Target: {target} (type: {type(target).__name__})")
                print(f"[DEBUG] Condition WIN: profit >= target = {profit} >= {target} = {profit >= target}")
                print(f"[DEBUG] Condition LOSE: profit <= -target = {profit} <= -{target} = {profit <= -target}")
                print(f"="*50)
                
                # 목표 수익/손실 도달시 자동 청산! (양방향)
                should_close = False
                is_win = False
                
                if target > 0:
                    if profit >= target:  # 이익 목표 도달 (WIN)
                        should_close = True
                        is_win = True
                        print(f"[DEBUG] WIN! Profit {profit} >= Target {target}")
                    elif profit <= -target:  # 손실 한도 도달 (LOSE)
                        should_close = True
                        is_win = False
                        print(f"[DEBUG] LOSE! Profit {profit} <= -Target {-target}")
                
                if should_close:
                    print(f"[DEBUG] AUTO CLOSING! {'WIN' if is_win else 'LOSE'} - Profit: {profit}")
                    
                    # 마틴 모드 상태 업데이트
                    martin_reset = False
                    martin_step_up = False
                    
                    if current_user.demo_martin_step and current_user.demo_martin_step >= 1:
                        if is_win:
                            # 마틴 모드에서 이익으로 청산 = 성공! 리셋!
                            current_user.demo_martin_step = 1
                            current_user.demo_martin_accumulated_loss = 0.0
                            martin_reset = True
                            print(f"[DEBUG] Martin SUCCESS! Reset to Step 1")
                        else:
                            # 마틴 모드에서 손실로 청산 = 다음 단계로!
                            max_steps = current_user.demo_martin_max_steps or 5
                            current_step = current_user.demo_martin_step or 1
                            accumulated = current_user.demo_martin_accumulated_loss or 0.0
                            
                            new_accumulated = accumulated + abs(profit)
                            new_step = current_step + 1
                            
                            if new_step > max_steps:
                                # 최대 단계 초과: 강제 리셋
                                current_user.demo_martin_step = 1
                                current_user.demo_martin_accumulated_loss = 0.0
                                martin_reset = True
                                print(f"[DEBUG] Martin MAX STEP! Force Reset")
                            else:
                                current_user.demo_martin_step = new_step
                                current_user.demo_martin_accumulated_loss = new_accumulated
                                martin_step_up = True
                                print(f"[DEBUG] Martin STEP UP! Step {current_step} -> {new_step}, AccLoss: {new_accumulated}")
                    
                    # 거래 내역 저장
                    trade = DemoTrade(
                        user_id=current_user.id,
                        symbol=position.symbol,
                        trade_type=position.trade_type,
                        volume=position.volume,
                        entry_price=entry_price,
                        exit_price=current_price,
                        profit=profit,
                        is_closed=True,
                        closed_at=datetime.now()
                    )
                    db.add(trade)
                    
                    # 잔고 업데이트
                    current_user.demo_balance = (current_user.demo_balance or 10000.0) + profit
                    current_user.demo_equity = current_user.demo_balance
                    current_user.demo_today_profit = (current_user.demo_today_profit or 0.0) + profit
                    
                    # 포지션 삭제
                    db.delete(position)
                    db.commit()
                    
                    # 청산된 상태로 반환
                    if is_win:
                        message = f"🎯 목표 도달! +${profit:,.2f}"
                    else:
                        message = f"💔 손절! ${profit:,.2f}"
                    
                    return {
                        "balance": current_user.demo_balance,
                        "equity": current_user.demo_equity,
                        "today_profit": current_user.demo_today_profit,
                        "broker": "Trading-X Demo",
                        "account": f"DEMO-{current_user.id}",
                        "server": "Demo Server",
                        "leverage": 500,
                        "position": None,
                        "positions_count": 0,
                        "has_mt5": current_user.has_mt5_account or False,
                        "auto_closed": True,
                        "closed_profit": profit,
                        "is_win": is_win,
                        "martin_reset": martin_reset,
                        "martin_step_up": martin_step_up if not is_win else False,
                        "message": message
                    }
                
                position_data = {
                    "id": position.id,
                    "type": position.trade_type,
                    "symbol": position.symbol,
                    "volume": position.volume,
                    "entry": entry_price,
                    "current": current_price,
                    "profit": profit,
                    "target": target
                }
    
    # 다중 포지션 데이터 생성 (전체 포지션 - Account 탭용)
    positions_data = []
    total_margin = 0
    leverage = 500  # 데모 레버리지
    
    for pos in all_positions:
        pos_price_data = {"profit": 0, "current": pos.entry_price, "margin": 0}
        
        if mt5.initialize():
            tick = mt5.symbol_info_tick(pos.symbol)
            symbol_info = mt5.symbol_info(pos.symbol)
            
            if tick:
                current_price = tick.bid if pos.trade_type == "BUY" else tick.ask
                
                if symbol_info and symbol_info.trade_tick_size > 0:
                    if pos.trade_type == "BUY":
                        price_diff = current_price - pos.entry_price
                    else:
                        price_diff = pos.entry_price - current_price
                    ticks = price_diff / symbol_info.trade_tick_size
                    profit = ticks * symbol_info.trade_tick_value * pos.volume
                else:
                    if pos.trade_type == "BUY":
                        profit = (current_price - pos.entry_price) * pos.volume
                    else:
                        profit = (pos.entry_price - current_price) * pos.volume
                
                # MT5 함수로 정확한 마진 계산 (종목별 레버리지 자동 적용)
                order_type = mt5.ORDER_TYPE_BUY if pos.trade_type == "BUY" else mt5.ORDER_TYPE_SELL
                margin = mt5.order_calc_margin(order_type, pos.symbol, pos.volume, current_price)
                if margin is None:
                    margin = 0
                
                pos_price_data = {
                    "profit": round(profit, 2), 
                    "current": current_price,
                    "margin": round(margin, 2)
                }
        
        total_margin += pos_price_data["margin"]
        
        positions_data.append({
            "id": pos.id,
            "ticket": pos.id,
            "type": pos.trade_type,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "entry": pos.entry_price,
            "current": pos_price_data["current"],
            "profit": pos_price_data["profit"],
            "target": pos.target_profit,
            "magic": pos.magic,
            "margin": pos_price_data["margin"]
        })

    print(f"[ACCOUNT-INFO] 📦 Returning - position_data: {position_data is not None}, positions_count: {len(positions)}")
    print("[ACCOUNT-INFO] 🔴 END\n")

    return {
        "balance": current_user.demo_balance or 10000.0,
        "equity": current_user.demo_equity or 10000.0,
        "today_profit": current_user.demo_today_profit or 0.0,
        "broker": "Trading-X Demo",
        "account": f"DEMO-{current_user.id}",
        "server": "Demo Server",
        "leverage": 500,
        "position": position_data,
        "positions": positions_data,
        "positions_count": len(all_positions),
        "buysell_count": len(positions),
        "has_mt5": current_user.has_mt5_account or False,
        "margin": round(total_margin, 2),
        "total_margin": round(total_margin, 2)
    }


# ========== 데모 주문 ==========
@router.post("/order")
async def place_demo_order(
    symbol: str = "BTCUSD",
    order_type: str = "BUY",
    volume: float = 0.01,
    target: float = 100,
    magic: int = 100001,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 주문 실행 (다중 포지션 지원)"""
    print(f"\n[DEMO ORDER] 🔵 START - User: {current_user.id}, Symbol: {symbol}, Type: {order_type}, Volume: {volume}, Target: {target}")

    # 중복 주문 허용 - 체크 로직 제거됨

    # 현재가 조회
    if not mt5.initialize():
        print("[DEMO ORDER] ❌ MT5 initialize FAILED!")
        return JSONResponse({"success": False, "message": "MT5 연결 실패"})

    tick = mt5.symbol_info_tick(symbol)
    if not tick:
        print(f"[DEMO ORDER] ❌ Tick FAILED for {symbol}!")
        return JSONResponse({"success": False, "message": "가격 정보 없음"})

    entry_price = tick.ask if order_type.upper() == "BUY" else tick.bid
    print(f"[DEMO ORDER] 📊 Entry price: {entry_price}")

    # 포지션 생성 (Basic/NoLimit 모드용 - target 그대로 사용)
    new_position = DemoPosition(
        user_id=current_user.id,
        symbol=symbol,
        trade_type=order_type.upper(),
        volume=volume,
        entry_price=entry_price,
        target_profit=target,
        magic=magic
    )

    db.add(new_position)
    db.commit()
    db.refresh(new_position)

    print(f"[DEMO ORDER] ✅ Position created! ID: {new_position.id}, User: {new_position.user_id}")
    print(f"[DEMO ORDER] 📦 Position details - Symbol: {new_position.symbol}, Type: {new_position.trade_type}, Entry: {new_position.entry_price}, Target: {new_position.target_profit}")

    # 저장 확인 쿼리
    check_position = db.query(DemoPosition).filter(DemoPosition.id == new_position.id).first()
    print(f"[DEMO ORDER] 🔍 Verification query - Position exists: {check_position is not None}")

    print("[DEMO ORDER] 🔴 END\n")

    return JSONResponse({
        "success": True,
        "message": f"[DEMO] {order_type.upper()} {volume} lot @ {entry_price:,.2f}",
        "position_id": new_position.id
    })

# ========== 데모 포지션 조회 ==========
@router.get("/positions")
async def get_demo_positions(
    magic: int = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 포지션 조회 (magic 필터 옵션)"""
    query = db.query(DemoPosition).filter(
        DemoPosition.user_id == current_user.id
    )
    if magic is not None:
        query = query.filter(DemoPosition.magic == magic)
    
    positions = query.all()
    
    if not mt5.initialize():
        return {"positions": [], "message": "MT5 연결 실패", "total_margin": 0}
    
    leverage = 500  # 데모 기본 레버리지
    
    positions_data = []
    total_margin = 0
    
    for pos in positions:
        tick = mt5.symbol_info_tick(pos.symbol)
        symbol_info = mt5.symbol_info(pos.symbol)
        
        if tick:
            current_price = tick.bid if pos.trade_type == "BUY" else tick.ask
            
            # 손익 계산
            if symbol_info and symbol_info.trade_tick_size > 0:
                if pos.trade_type == "BUY":
                    price_diff = current_price - pos.entry_price
                else:
                    price_diff = pos.entry_price - current_price
                ticks = price_diff / symbol_info.trade_tick_size
                profit = ticks * symbol_info.trade_tick_value * pos.volume
            else:
                if pos.trade_type == "BUY":
                    profit = (current_price - pos.entry_price) * pos.volume
                else:
                    profit = (pos.entry_price - current_price) * pos.volume
            
            profit = round(profit, 2)
        else:
            current_price = pos.entry_price
            profit = 0
        
        # MT5 함수로 정확한 마진 계산 (종목별 레버리지 자동 적용)
        order_type = mt5.ORDER_TYPE_BUY if pos.trade_type == "BUY" else mt5.ORDER_TYPE_SELL
        margin = mt5.order_calc_margin(order_type, pos.symbol, pos.volume, current_price)
        if margin is None:
            margin = 0
        
        margin = round(margin, 2)
        total_margin += margin
        
        positions_data.append({
            "id": pos.id,
            "ticket": pos.id,
            "type": pos.trade_type,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "entry": pos.entry_price,
            "current": current_price,
            "profit": profit,
            "target": pos.target_profit,
            "magic": pos.magic,
            "margin": margin
        })
    
    return {
        "positions": positions_data,
        "count": len(positions_data),
        "total_margin": round(total_margin, 2),
        "leverage": leverage
    }

# ========== 데모 청산 ==========
@router.post("/close")
async def close_demo_position(
    ticket: int = None,
    symbol: str = None,
    magic: int = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 포지션 청산 (ticket 또는 symbol로 지정 가능)"""
    # ticket으로 특정 포지션 청산
    if ticket:
        position = db.query(DemoPosition).filter(
            DemoPosition.id == ticket,
            DemoPosition.user_id == current_user.id
        ).first()
    # symbol + magic으로 해당 종목 포지션 청산
    elif symbol and magic:
        position = db.query(DemoPosition).filter(
            DemoPosition.symbol == symbol,
            DemoPosition.magic == magic,
            DemoPosition.user_id == current_user.id
        ).first()
    # symbol만으로 해당 종목 첫 번째 포지션 청산
    elif symbol:
        position = db.query(DemoPosition).filter(
            DemoPosition.symbol == symbol,
            DemoPosition.user_id == current_user.id
        ).first()
    # magic만으로 해당 패널 포지션 청산
    elif magic:
        position = db.query(DemoPosition).filter(
            DemoPosition.magic == magic,
            DemoPosition.user_id == current_user.id
        ).first()
    # 둘 다 없으면 아무 포지션이나 청산
    else:
        position = db.query(DemoPosition).filter(
            DemoPosition.user_id == current_user.id
        ).first()
    
    if not position:
        return JSONResponse({"success": False, "message": "열린 포지션 없음"})
    
    # 현재가 조회
    if not mt5.initialize():
        return JSONResponse({"success": False, "message": "MT5 연결 실패"})
    
    tick = mt5.symbol_info_tick(position.symbol)
    if not tick:
        return JSONResponse({"success": False, "message": "가격 정보 없음"})
    
    exit_price = tick.bid if position.trade_type == "BUY" else tick.ask
    entry_price = position.entry_price
    
    # MT5에서 심볼 정보 가져와서 정확한 손익 계산
    symbol_info = mt5.symbol_info(position.symbol)
    if symbol_info:
        contract_size = symbol_info.trade_contract_size
        tick_size = symbol_info.trade_tick_size
        tick_value = symbol_info.trade_tick_value
        
        if position.trade_type == "BUY":
            price_diff = exit_price - entry_price
        else:
            price_diff = entry_price - exit_price
        
        # 정확한 손익 계산
        if tick_size > 0:
            ticks = price_diff / tick_size
            profit = ticks * tick_value * position.volume
        else:
            profit = price_diff * contract_size * position.volume
    else:
        # 심볼 정보 없으면 간단 계산
        if position.trade_type == "BUY":
            profit = (exit_price - entry_price) * position.volume
        else:
            profit = (entry_price - exit_price) * position.volume
    
    profit = round(profit, 2)
    
    # 거래 내역 저장
    trade = DemoTrade(
        user_id=current_user.id,
        symbol=position.symbol,
        trade_type=position.trade_type,
        volume=position.volume,
        entry_price=entry_price,
        exit_price=exit_price,
        profit=profit,
        is_closed=True,
        closed_at=datetime.now()
    )
    
    db.add(trade)
    
    # 잔고 업데이트
    current_user.demo_balance = (current_user.demo_balance or 10000.0) + profit
    current_user.demo_equity = current_user.demo_balance
    current_user.demo_today_profit = (current_user.demo_today_profit or 0.0) + profit
    
    # 포지션 삭제
    db.delete(position)
    db.commit()
    
    return JSONResponse({
        "success": True,
        "message": f"[DEMO] 청산 완료! P/L: ${profit:+,.2f}",
        "profit": profit,
        "new_balance": current_user.demo_balance
    })


# ========== 데모 거래 내역 ==========
@router.get("/history")
async def get_demo_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 거래 내역 조회"""
    trades = db.query(DemoTrade).filter(
        DemoTrade.user_id == current_user.id,
        DemoTrade.is_closed == True
    ).order_by(DemoTrade.closed_at.desc()).limit(20).all()
    
    history = []
    for t in trades:
        history.append({
            "id": t.id,
            "symbol": t.symbol,
            "type": t.trade_type,
            "volume": t.volume,
            "entry": t.entry_price,
            "exit": t.exit_price,
            "profit": t.profit,
            "time": t.closed_at.strftime("%m/%d %H:%M") if t.closed_at else ""
        })
    
    return {"history": history}


# ========== 데모 잔고 리셋 ==========
@router.post("/reset")
async def reset_demo_balance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 잔고 초기화"""
    # 열린 포지션 삭제
    db.query(DemoPosition).filter(
        DemoPosition.user_id == current_user.id
    ).delete()
    
    # 잔고 리셋
    current_user.demo_balance = 10000.0
    current_user.demo_equity = 10000.0
    current_user.demo_today_profit = 0.0
    
    db.commit()
    
    return JSONResponse({
        "success": True,
        "message": "데모 계정이 초기화되었습니다. 잔고: $10,000",
        "balance": 10000.0
    })


# ========== 데모 잔고 충전 ==========
@router.post("/topup")
async def topup_demo_balance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 잔고 충전 ($10,000 추가, 최대 $100,000)"""
    current_balance = current_user.demo_balance or 10000.0
    max_balance = 100000.0
    topup_amount = 10000.0
    
    if current_balance >= max_balance:
        return JSONResponse({
            "success": False,
            "message": f"최대 잔고 ${max_balance:,.0f}에 도달했습니다."
        })
    
    new_balance = min(current_balance + topup_amount, max_balance)
    added = new_balance - current_balance
    
    current_user.demo_balance = new_balance
    current_user.demo_equity = new_balance
    db.commit()
    
    return JSONResponse({
        "success": True,
        "message": f"💰 ${added:,.0f} 충전 완료! 잔고: ${new_balance:,.0f}",
        "balance": new_balance
    })

    # ========== 데모 마틴 모드 API ==========
@router.get("/martin/state")
async def get_demo_martin_state(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 마틴 상태 조회"""
    step = current_user.demo_martin_step or 1
    max_steps = current_user.demo_martin_max_steps or 5
    base_lot = current_user.demo_martin_base_lot or 0.01
    accumulated_loss = current_user.demo_martin_accumulated_loss or 0.0
    
    # 현재 랏 계산: base_lot × 2^(step-1)
    current_lot = base_lot * (2 ** (step - 1))
    current_lot = round(current_lot, 2)
    
    return {
        "enabled": step > 1 or accumulated_loss != 0,
        "step": step,
        "max_steps": max_steps,
        "base_lot": base_lot,
        "current_lot": current_lot,
        "accumulated_loss": accumulated_loss
    }


@router.post("/martin/enable")
async def enable_demo_martin(
    base_lot: float = 0.01,
    max_steps: int = 5,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 마틴 모드 활성화"""
    current_user.demo_martin_step = 1
    current_user.demo_martin_max_steps = max_steps
    current_user.demo_martin_base_lot = base_lot
    current_user.demo_martin_accumulated_loss = 0.0
    db.commit()
    
    return JSONResponse({
        "success": True,
        "message": f"마틴 모드 활성화! 기본 랏: {base_lot}, 최대 단계: {max_steps}",
        "state": {
            "step": 1,
            "max_steps": max_steps,
            "base_lot": base_lot,
            "current_lot": base_lot,
            "accumulated_loss": 0.0
        }
    })


@router.post("/martin/disable")
async def disable_demo_martin(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 마틴 모드 비활성화 (리셋)"""
    current_user.demo_martin_step = 1
    current_user.demo_martin_accumulated_loss = 0.0
    db.commit()
    
    return JSONResponse({
        "success": True,
        "message": "마틴 모드 비활성화 및 리셋 완료"
    })


@router.post("/martin/order")
async def place_demo_martin_order(
    symbol: str = "BTCUSD",
    order_type: str = "BUY",
    target: float = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """데모 마틴 주문 (마틴 랏 자동 계산)"""
    # 이미 열린 포지션 확인
    existing = db.query(DemoPosition).filter(
        DemoPosition.user_id == current_user.id
    ).first()
    
    if existing:
        return JSONResponse({
            "success": False,
            "message": "이미 열린 포지션이 있습니다. 먼저 청산해주세요."
        })
    
    # 현재가 조회
    if not mt5.initialize():
        return JSONResponse({"success": False, "message": "MT5 연결 실패"})
    
    tick = mt5.symbol_info_tick(symbol)
    if not tick:
        return JSONResponse({"success": False, "message": "가격 정보 없음"})
    
    entry_price = tick.ask if order_type.upper() == "BUY" else tick.bid
    
    # 마틴 랏 계산
    step = current_user.demo_martin_step or 1
    base_lot = current_user.demo_martin_base_lot or 0.01
    martin_lot = base_lot * (2 ** (step - 1))
    martin_lot = round(martin_lot, 2)
    
    # 마틴 목표 계산: 누적손실 + 기본목표 (손실 복구 + 이익)
    accumulated_loss = current_user.demo_martin_accumulated_loss or 0.0
    real_target = accumulated_loss + target
    print(f"[DEBUG] Martin Order: Step {step}, Lot {martin_lot}, AccLoss {accumulated_loss}, Target {target}, RealTarget {real_target}")
    
    # 포지션 생성
    new_position = DemoPosition(
        user_id=current_user.id,
        symbol=symbol,
        trade_type=order_type.upper(),
        volume=martin_lot,
        entry_price=entry_price,
        target_profit=real_target
    )
    
    db.add(new_position)
    db.commit()
    
    return JSONResponse({
        "success": True,
        "message": f"[MARTIN Step {step}] {order_type.upper()} {martin_lot} lot @ {entry_price:,.2f}",
        "position_id": new_position.id,
        "martin_step": step,
        "martin_lot": martin_lot
    })


@router.post("/martin/update")
async def update_demo_martin_after_close(
    profit: float = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """청산 후 마틴 상태 업데이트"""
    step = current_user.demo_martin_step or 1
    max_steps = current_user.demo_martin_max_steps or 5
    accumulated_loss = current_user.demo_martin_accumulated_loss or 0.0
    
    if profit >= 0:
        # 이익: 마틴 리셋!
        current_user.demo_martin_step = 1
        current_user.demo_martin_accumulated_loss = 0.0
        db.commit()
        
        return JSONResponse({
            "success": True,
            "message": f"🎉 마틴 성공! +${profit:,.2f} → Step 1 리셋",
            "new_step": 1,
            "accumulated_loss": 0.0,
            "reset": True
        })
    else:
        # 손실: 다음 단계로
        new_accumulated = accumulated_loss + abs(profit)
        new_step = step + 1
        
        if new_step > max_steps:
            # 최대 단계 초과: 강제 리셋
            current_user.demo_martin_step = 1
            current_user.demo_martin_accumulated_loss = 0.0
            db.commit()
            
            return JSONResponse({
                "success": False,
                "message": f"❌ 마틴 실패! 최대 단계 도달 → 강제 리셋",
                "new_step": 1,
                "accumulated_loss": 0.0,
                "reset": True,
                "total_loss": new_accumulated
            })
        else:
            current_user.demo_martin_step = new_step
            current_user.demo_martin_accumulated_loss = new_accumulated
            db.commit()
            
            base_lot = current_user.demo_martin_base_lot or 0.01
            next_lot = base_lot * (2 ** (new_step - 1))
            
            return JSONResponse({
                "success": True,
                "message": f"📈 Step {new_step}로 진행! 다음 랏: {next_lot:.2f}",
                "new_step": new_step,
                "accumulated_loss": new_accumulated,
                "next_lot": round(next_lot, 2),
                "reset": False
            })


# ========== 데모 마틴 누적손실 업데이트 ==========
@router.post("/martin/update-loss")
async def update_demo_martin_loss(
    accumulated_loss: float = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """마틴 누적손실만 업데이트 (단계/랏수 유지)"""
    current_user.demo_martin_accumulated_loss = accumulated_loss
    db.commit()
    
    return JSONResponse({
        "success": True,
        "message": f"누적손실 업데이트: ${accumulated_loss:,.2f}",
        "accumulated_loss": accumulated_loss
    })


# ========== 데모 마틴 상태 업데이트 (단계 + 누적손실) ==========
@router.post("/martin/update-state")
async def update_demo_martin_state(
    step: int = 1,
    accumulated_loss: float = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """마틴 단계와 누적손실 업데이트"""
    current_user.demo_martin_step = step
    current_user.demo_martin_accumulated_loss = accumulated_loss
    db.commit()
    
    base_lot = current_user.demo_martin_base_lot or 0.01
    current_lot = base_lot * (2 ** (step - 1))
    
    return JSONResponse({
        "success": True,
        "message": f"마틴 상태 업데이트: Step {step}, 누적손실 ${accumulated_loss:,.2f}",
        "step": step,
        "accumulated_loss": accumulated_loss,
        "current_lot": round(current_lot, 2)
    })


# ========== 데모 마틴 완전 리셋 ==========
@router.post("/martin/reset-full")
async def reset_demo_martin_full(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """마틴 완전 초기화 (1단계, 누적손실 0)"""
    current_user.demo_martin_step = 1
    current_user.demo_martin_accumulated_loss = 0.0
    db.commit()
    
    return JSONResponse({
        "success": True,
        "message": "마틴 초기화 완료",
        "step": 1,
        "accumulated_loss": 0
    })

# ========== 일괄 청산 ==========
@router.post("/close-all")
async def close_all_demo_positions(
    magic: int = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """모든 데모 포지션 일괄 청산 (magic 필터 옵션)"""
    query = db.query(DemoPosition).filter(
        DemoPosition.user_id == current_user.id
    )
    if magic is not None:
        query = query.filter(DemoPosition.magic == magic)
    positions = query.all()
    
    if not positions:
        return JSONResponse({"success": False, "message": "열린 포지션 없음"})
    
    total_profit = 0
    closed_count = 0
    
    if not mt5.initialize():
        return JSONResponse({"success": False, "message": "MT5 연결 실패"})
    
    for position in positions:
        tick = mt5.symbol_info_tick(position.symbol)
        if not tick:
            continue
        
        exit_price = tick.bid if position.trade_type == "BUY" else tick.ask
        entry_price = position.entry_price
        
        # 손익 계산
        symbol_info = mt5.symbol_info(position.symbol)
        if symbol_info and symbol_info.trade_tick_size > 0:
            if position.trade_type == "BUY":
                price_diff = exit_price - entry_price
            else:
                price_diff = entry_price - exit_price
            ticks = price_diff / symbol_info.trade_tick_size
            profit = ticks * symbol_info.trade_tick_value * position.volume
        else:
            if position.trade_type == "BUY":
                profit = (exit_price - entry_price) * position.volume
            else:
                profit = (entry_price - exit_price) * position.volume
        
        profit = round(profit, 2)
        total_profit += profit
        
        # 거래 내역 저장
        trade = DemoTrade(
            user_id=current_user.id,
            symbol=position.symbol,
            trade_type=position.trade_type,
            volume=position.volume,
            entry_price=entry_price,
            exit_price=exit_price,
            profit=profit,
            is_closed=True,
            closed_at=datetime.now()
        )
        db.add(trade)
        db.delete(position)
        closed_count += 1
    
    # 잔고 업데이트
    current_user.demo_balance = (current_user.demo_balance or 10000.0) + total_profit
    current_user.demo_equity = current_user.demo_balance
    current_user.demo_today_profit = (current_user.demo_today_profit or 0.0) + total_profit
    
    db.commit()
    
    return JSONResponse({
        "success": True,
        "message": f"[DEMO] {closed_count}개 포지션 청산 완료! P/L: ${total_profit:+,.2f}",
        "closed_count": closed_count,
        "profit": total_profit,
        "new_balance": current_user.demo_balance
    })


# ========== 타입별 청산 (매수만/매도만) ==========
@router.post("/close-by-type")
async def close_demo_by_type(
    type: str = "BUY",
    magic: int = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """특정 타입(BUY/SELL) 포지션만 청산 (magic 필터 옵션)"""
    query = db.query(DemoPosition).filter(
        DemoPosition.user_id == current_user.id,
        DemoPosition.trade_type == type.upper()
    )
    if magic is not None:
        query = query.filter(DemoPosition.magic == magic)
    positions = query.all()
    
    if not positions:
        return JSONResponse({"success": False, "message": f"{type} 포지션 없음"})
    
    total_profit = 0
    closed_count = 0
    
    if not mt5.initialize():
        return JSONResponse({"success": False, "message": "MT5 연결 실패"})
    
    for position in positions:
        tick = mt5.symbol_info_tick(position.symbol)
        if not tick:
            continue
        
        exit_price = tick.bid if position.trade_type == "BUY" else tick.ask
        entry_price = position.entry_price
        
        # 손익 계산
        symbol_info = mt5.symbol_info(position.symbol)
        if symbol_info and symbol_info.trade_tick_size > 0:
            if position.trade_type == "BUY":
                price_diff = exit_price - entry_price
            else:
                price_diff = entry_price - exit_price
            ticks = price_diff / symbol_info.trade_tick_size
            profit = ticks * symbol_info.trade_tick_value * position.volume
        else:
            if position.trade_type == "BUY":
                profit = (exit_price - entry_price) * position.volume
            else:
                profit = (entry_price - exit_price) * position.volume
        
        profit = round(profit, 2)
        total_profit += profit
        
        # 거래 내역 저장
        trade = DemoTrade(
            user_id=current_user.id,
            symbol=position.symbol,
            trade_type=position.trade_type,
            volume=position.volume,
            entry_price=entry_price,
            exit_price=exit_price,
            profit=profit,
            is_closed=True,
            closed_at=datetime.now()
        )
        db.add(trade)
        db.delete(position)
        closed_count += 1
    
    # 잔고 업데이트
    current_user.demo_balance = (current_user.demo_balance or 10000.0) + total_profit
    current_user.demo_equity = current_user.demo_balance
    current_user.demo_today_profit = (current_user.demo_today_profit or 0.0) + total_profit
    
    db.commit()
    
    return JSONResponse({
        "success": True,
        "message": f"[DEMO] {type} {closed_count}개 청산! P/L: ${total_profit:+,.2f}",
        "closed_count": closed_count,
        "profit": total_profit,
        "new_balance": current_user.demo_balance
    })


# ========== 손익별 청산 (수익만/손실만) ==========
@router.post("/close-by-profit")
async def close_demo_by_profit(
    profit_type: str = "positive",
    magic: int = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """수익/손실 포지션만 청산 (profit_type: positive/negative, magic 필터 옵션)"""
    query = db.query(DemoPosition).filter(
        DemoPosition.user_id == current_user.id
    )
    if magic is not None:
        query = query.filter(DemoPosition.magic == magic)
    positions = query.all()
    
    if not positions:
        return JSONResponse({"success": False, "message": "열린 포지션 없음"})
    
    if not mt5.initialize():
        return JSONResponse({"success": False, "message": "MT5 연결 실패"})
    
    total_profit = 0
    closed_count = 0
    
    for position in positions:
        tick = mt5.symbol_info_tick(position.symbol)
        if not tick:
            continue
        
        exit_price = tick.bid if position.trade_type == "BUY" else tick.ask
        entry_price = position.entry_price
        
        # 손익 계산
        symbol_info = mt5.symbol_info(position.symbol)
        if symbol_info and symbol_info.trade_tick_size > 0:
            if position.trade_type == "BUY":
                price_diff = exit_price - entry_price
            else:
                price_diff = entry_price - exit_price
            ticks = price_diff / symbol_info.trade_tick_size
            profit = ticks * symbol_info.trade_tick_value * position.volume
        else:
            if position.trade_type == "BUY":
                profit = (exit_price - entry_price) * position.volume
            else:
                profit = (entry_price - exit_price) * position.volume
        
        profit = round(profit, 2)
        
        # 조건 체크: positive면 수익만, negative면 손실만
        if profit_type == "positive" and profit <= 0:
            continue
        if profit_type == "negative" and profit >= 0:
            continue
        
        total_profit += profit
        
        # 거래 내역 저장
        trade = DemoTrade(
            user_id=current_user.id,
            symbol=position.symbol,
            trade_type=position.trade_type,
            volume=position.volume,
            entry_price=entry_price,
            exit_price=exit_price,
            profit=profit,
            is_closed=True,
            closed_at=datetime.now()
        )
        db.add(trade)
        db.delete(position)
        closed_count += 1
    
    if closed_count == 0:
        msg = "수익 포지션 없음" if profit_type == "positive" else "손실 포지션 없음"
        return JSONResponse({"success": False, "message": msg})
    
    # 잔고 업데이트
    current_user.demo_balance = (current_user.demo_balance or 10000.0) + total_profit
    current_user.demo_equity = current_user.demo_balance
    current_user.demo_today_profit = (current_user.demo_today_profit or 0.0) + total_profit
    
    db.commit()
    
    type_name = "수익" if profit_type == "positive" else "손실"
    return JSONResponse({
        "success": True,
        "message": f"[DEMO] {type_name} {closed_count}개 청산! P/L: ${total_profit:+,.2f}",
        "closed_count": closed_count,
        "profit": total_profit,
        "new_balance": current_user.demo_balance
    })


# ========== Demo WebSocket ==========
@router.websocket("/ws")
async def demo_websocket_endpoint(websocket: WebSocket):
    """Demo 모드 실시간 데이터 WebSocket"""
    await websocket.accept()

    # Query parameter에서 토큰 가져오기
    token = websocket.query_params.get("token")
    user_id = None

    if token:
        try:
            payload = decode_token(token)
            if payload:
                user_id = int(payload.get("sub"))
                print(f"[DEMO WS] User {user_id} connected")
        except Exception as e:
            print(f"[DEMO WS] Token decode error: {e}")

    symbols_list = ["BTCUSD", "EURUSD.r", "USDJPY.r", "XAUUSD.r", "US100.", "GBPUSD.r", "AUDUSD.r", "USDCAD.r", "ETHUSD"]

    while True:
        try:
            # MT5 초기화 (가격 정보 가져오기 위해)
            if not mt5.initialize():
                await asyncio.sleep(1)
                continue

            # 인디케이터 분석 (실제 계산 로직 사용) - 매번 전송!
            try:
                indicators = IndicatorService.calculate_all_indicators("BTCUSD")
                buy_count = indicators["buy"]
                sell_count = indicators["sell"]
                neutral_count = indicators["neutral"]
                base_score = indicators["score"]

                # 실시간 변동을 위한 랜덤 조정 (±3% 범위로 축소)
                variation = random.randint(-3, 3)
                buy_count = max(5, min(80, buy_count + variation))
                sell_count = max(5, min(80, sell_count - variation // 2))
                neutral_count = 100 - buy_count - sell_count

                # 디버깅용 로그
                print(f"[DEMO WS] 📊 Indicators - Sell: {sell_count}, Neutral: {neutral_count}, Buy: {buy_count}, Score: {base_score:.1f}")
            except Exception as e:
                print(f"[DEMO WS] ⚠️ Indicator calculation error: {e}")
                # 오류 발생 시 랜덤값 사용 (합이 100)
                sell_count = random.randint(20, 40)
                buy_count = random.randint(20, 40)
                neutral_count = 100 - sell_count - buy_count
                base_score = 50.0

            # 모든 심볼 가격 정보
            all_prices = {}
            all_candles = {}

            for symbol in symbols_list:
                tick = mt5.symbol_info_tick(symbol)
                if tick:
                    all_prices[symbol] = {
                        "bid": tick.bid,
                        "ask": tick.ask,
                        "last": tick.last
                    }

                    # 최신 캔들
                    rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_H1, 0, 1)
                    if rates is not None and len(rates) > 0:
                        latest = rates[-1]
                        all_candles[symbol] = {
                            "time": int(latest["time"]),
                            "open": float(latest["open"]),
                            "high": float(latest["high"]),
                            "low": float(latest["low"]),
                            "close": float(latest["close"])
                        }

            # Demo 계정 정보 (DB에서 실제 데이터 가져오기)
            demo_balance = 10000.0
            demo_equity = 10000.0
            demo_position = None
            positions_data = []
            positions_count = 0

            if user_id:
                try:
                    # DB 세션 생성
                    from ..database import SessionLocal
                    db = SessionLocal()

                    try:
                        # 사용자 정보 조회
                        user = db.query(User).filter(User.id == user_id).first()
                        if user:
                            demo_balance = user.demo_balance or 10000.0
                            demo_equity = user.demo_equity or 10000.0

                            # 열린 포지션들 조회 (다중 포지션)
                            positions = db.query(DemoPosition).filter(
                                DemoPosition.user_id == user_id
                            ).all()

                            positions_count = len(positions)

                            # 포지션들의 실시간 profit 계산
                            total_profit = 0.0
                            for pos in positions:
                                if all_prices.get(pos.symbol):
                                    current_price = all_prices[pos.symbol]
                                    entry = pos.entry_price
                                    volume = pos.volume

                                    # 정확한 손익 계산
                                    symbol_info = mt5.symbol_info(pos.symbol)
                                    if symbol_info and symbol_info.trade_tick_size > 0:
                                        if pos.trade_type == "BUY":
                                            price_diff = current_price['bid'] - entry
                                        else:
                                            price_diff = entry - current_price['ask']
                                        ticks = price_diff / symbol_info.trade_tick_size
                                        profit = ticks * symbol_info.trade_tick_value * volume
                                    else:
                                        if pos.trade_type == "BUY":
                                            profit = (current_price['bid'] - entry) * volume
                                        else:
                                            profit = (entry - current_price['ask']) * volume

                                    profit = round(profit, 2)
                                    total_profit += profit

                                    # 포지션 데이터 추가
                                    pos_data = {
                                        "id": pos.id,
                                        "ticket": pos.id,
                                        "type": pos.trade_type,
                                        "symbol": pos.symbol,
                                        "volume": pos.volume,
                                        "entry": entry,
                                        "current": current_price['bid'] if pos.trade_type == "BUY" else current_price['ask'],
                                        "profit": profit,
                                        "target": pos.target_profit
                                    }
                                    positions_data.append(pos_data)

                                    # 첫 번째 포지션을 position으로 설정 (하위 호환성)
                                    if demo_position is None:
                                        demo_position = pos_data

                            # Equity 업데이트
                            demo_equity = demo_balance + total_profit

                            print(f"[DEMO WS] 💼 User {user_id}: Balance=${demo_balance:.2f}, Positions={positions_count}, TotalProfit=${total_profit:.2f}")
                    finally:
                        db.close()

                except Exception as e:
                    print(f"[DEMO WS] ❌ DB fetch error: {e}")
                    import traceback
                    traceback.print_exc()

            data = {
                "broker": "Trading-X Demo",
                "account": "DEMO",
                "balance": demo_balance,
                "equity": demo_equity,
                "free_margin": demo_balance,
                "margin": 0.0,
                "leverage": 500,
                "positions_count": positions_count,
                "buy_count": buy_count,
                "sell_count": sell_count,
                "neutral_count": neutral_count,
                "base_score": base_score,
                "all_prices": all_prices,
                "all_candles": all_candles,
                "position": demo_position,
                "positions": positions_data
            }

            await websocket.send_text(json.dumps(data))
            await asyncio.sleep(1)

        except Exception as e:
            print(f"[DEMO WS] Error: {e}")
            import traceback
            traceback.print_exc()
            break

    await websocket.close()
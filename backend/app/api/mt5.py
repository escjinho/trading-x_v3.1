# app/api/mt5.py
"""
MT5 연동 API - 마틴게일, WebSocket 포함 완벽 버전
Trading-X Backend
"""

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
import MetaTrader5 as mt5
import asyncio
import json
from datetime import datetime, timedelta

from ..database import get_db
from ..models.user import User
from ..utils.security import decode_token
from ..services.indicator_service import IndicatorService
from ..services.martin_service import martin_service

router = APIRouter(prefix="/mt5", tags=["MT5"])
security = HTTPBearer()


# ========== 인증 함수 ==========
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """JWT 토큰에서 현재 사용자 가져오기"""
    token = credentials.credentials
    payload = decode_token(token)
    
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 토큰입니다"
        )
    
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 토큰입니다"
        )
    
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다"
        )
    
    return user


    # ========== 계정 정보 ==========
@router.get("/account-info")
async def get_account_info(current_user: User = Depends(get_current_user)):
    """MT5 계정 정보 + 인디케이터 + 포지션 조회"""
    try:
        if not mt5.initialize():
            raise HTTPException(status_code=500, detail="MT5 초기화 실패")
        
        account = mt5.account_info()
        if not account:
            raise HTTPException(status_code=500, detail="계정 정보 없음")
        
        # 포지션 정보
        positions = mt5.positions_get()
        positions_count = len(positions) if positions else 0
        
        position_data = None
        if positions and len(positions) > 0:
            # Buy/Sell 패널용 포지션 (magic=100001)
            buysell_pos = None
            for pos in positions:
                if pos.magic == 100001:
                    buysell_pos = pos
                    break
            
            if buysell_pos:
                position_data = {
                    "type": "BUY" if buysell_pos.type == 0 else "SELL",
                    "symbol": buysell_pos.symbol,
                    "volume": buysell_pos.volume,
                    "entry": buysell_pos.price_open,
                    "profit": buysell_pos.profit,
                    "ticket": buysell_pos.ticket,
                    "magic": buysell_pos.magic
                }
        
        # 인디케이터 계산
        try:
            indicators = IndicatorService.calculate_all_indicators("BTCUSD")
            buy_count = indicators["buy"]
            sell_count = indicators["sell"]
            neutral_count = indicators["neutral"]
            base_score = indicators["score"]
        except Exception as e:
            print(f"인디케이터 계산 오류: {e}")
            buy_count = 33
            sell_count = 33
            neutral_count = 34
            base_score = 50
        
        # 모든 심볼 가격
        symbols_list = ["BTCUSD", "EURUSD.r", "USDJPY.r", "XAUUSD.r", "US100."]
        prices = {}
        for sym in symbols_list:
            tick = mt5.symbol_info_tick(sym)
            if tick:
                prices[sym] = {"bid": tick.bid, "ask": tick.ask}
        
        return {
            "broker": account.company,
            "account": account.login,
            "server": account.server,
            "balance": account.balance,
            "equity": account.equity,
            "margin": account.margin,
            "free_margin": account.margin_free,
            "leverage": account.leverage,
            "positions_count": positions_count,
            "position": position_data,
            "buy_count": buy_count,
            "sell_count": sell_count,
            "neutral_count": neutral_count,
            "base_score": base_score,
            "prices": prices,
            "martin": martin_service.get_state()
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ========== 캔들 데이터 ==========
@router.get("/candles/{symbol}")
async def get_candles(
    symbol: str,
    timeframe: str = "M1",
    count: int = 200
):
    """캔들 데이터 + 인디케이터 조회"""
    if not mt5.initialize():
        return {"candles": [], "indicators": {}}
    
    tf_map = {
        "M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15, "H1": mt5.TIMEFRAME_H1,
        "H4": mt5.TIMEFRAME_H4, "D1": mt5.TIMEFRAME_D1,
    }
    tf = tf_map.get(timeframe, mt5.TIMEFRAME_M1)
    
    if not mt5.symbol_select(symbol, True):
        import time
        time.sleep(0.5)
        if not mt5.symbol_select(symbol, True):
            return {"candles": [], "indicators": {}}
    
    rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
    
    if rates is None or len(rates) == 0:
        return {"candles": [], "indicators": {}}
    
    candles = []
    closes = []
    highs = []
    lows = []
    
    for r in rates:
        candles.append({
            "time": int(r['time']),
            "open": float(r['open']),
            "high": float(r['high']),
            "low": float(r['low']),
            "close": float(r['close']),
            "volume": int(r['tick_volume'])
        })
        closes.append(r['close'])
        highs.append(r['high'])
        lows.append(r['low'])
    
    # 인디케이터 계산
    indicators = IndicatorService.calculate_chart_indicators(candles, closes, highs, lows)
    
    return {"candles": candles, "indicators": indicators}


# ========== 인디케이터 전용 (인증 불필요) ==========
@router.get("/indicators/{symbol}")
async def get_indicators(symbol: str = "BTCUSD"):
    """인디케이터만 조회 (게스트 모드용)"""
    if not mt5.initialize():
        return {"buy": 0, "sell": 0, "neutral": 0, "score": 50}
    
    try:
        indicators = IndicatorService.calculate_all_indicators(symbol)
        return indicators
    except Exception as e:
        print(f"인디케이터 오류: {e}")
        return {"buy": 33, "sell": 33, "neutral": 34, "score": 50}


# ========== 주문 실행 ==========
@router.post("/order")
async def place_order(
    symbol: str = "BTCUSD",
    order_type: str = "BUY",
    volume: float = 0.01,
    target: int = 100,
    magic: int = 100000,
    current_user: User = Depends(get_current_user)
):
    """일반 주문 실행 (BUY/SELL)"""
    tick = mt5.symbol_info_tick(symbol)
    symbol_info = mt5.symbol_info(symbol)
    
    if not tick or not symbol_info:
        return JSONResponse({"success": False, "message": "가격 정보 없음"})
    
    # TP/SL 계산 (target > 0일 때만)
    if target > 0:
        point_value = symbol_info.trade_tick_value if symbol_info.trade_tick_value > 0 else 1
        tp_points = int(target / (volume * point_value)) if volume * point_value > 0 else 500
        sl_points = tp_points
        
        if order_type.upper() == "BUY":
            tp_price = tick.ask + (tp_points * symbol_info.point)
            sl_price = tick.ask - (sl_points * symbol_info.point)
        else:
            tp_price = tick.bid - (tp_points * symbol_info.point)
            sl_price = tick.bid + (sl_points * symbol_info.point)
    else:
        tp_price = 0
        sl_price = 0
    
    if order_type.upper() == "BUY":
        mt5_type = mt5.ORDER_TYPE_BUY
        price = tick.ask
    else:
        mt5_type = mt5.ORDER_TYPE_SELL
        price = tick.bid
    
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": volume,
        "type": mt5_type,
        "price": price,
        "deviation": 20,
        "magic": magic,
        "comment": f"Trading-X {order_type.upper()}",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    
    # SL/TP가 있을 때만 추가
    if sl_price > 0:
        request["sl"] = sl_price
    if tp_price > 0:
        request["tp"] = tp_price
    
    result = mt5.order_send(request)
    
    if result.retcode == mt5.TRADE_RETCODE_DONE:
        return JSONResponse({
            "success": True,
            "message": f"{order_type.upper()} 성공! {volume} lot @ {result.price:,.2f}",
            "ticket": result.order
        })
    else:
        return JSONResponse({
            "success": False,
            "message": f"실패: {result.retcode} - {result.comment}"
        })


# ========== 포지션 청산 ==========
@router.post("/close")
async def close_position(
    symbol: str = "BTCUSD",
    magic: int = None,
    current_user: User = Depends(get_current_user)
):
    """포지션 청산 (magic 필터 옵션)"""
    positions = mt5.positions_get(symbol=symbol)
    if not positions:
        return JSONResponse({"success": False, "message": "열린 포지션 없음"})
    
    for pos in positions:
        # magic 필터링 (지정된 경우)
        if magic is not None and pos.magic != magic:
            continue
            
        tick = mt5.symbol_info_tick(symbol)
        close_type = mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY
        close_price = tick.bid if pos.type == 0 else tick.ask
        
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": pos.volume,
            "type": close_type,
            "position": pos.ticket,
            "price": close_price,
            "deviation": 20,
            "magic": 123456,
            "comment": "Trading-X CLOSE",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        
        result = mt5.order_send(request)
        
        if result.retcode == mt5.TRADE_RETCODE_DONE:
            return JSONResponse({
                "success": True,
                "message": f"청산 성공! P/L: ${pos.profit:,.2f}",
                "profit": pos.profit
            })
    
    return JSONResponse({"success": False, "message": "청산 실패"})

# ========== 포지션 목록 조회 ==========
@router.get("/positions")
async def get_positions(
    magic: int = None,
    current_user: User = Depends(get_current_user)
):
    """모든 열린 포지션 조회 (magic 필터 옵션)"""
    if not mt5.initialize():
        return {"success": False, "positions": [], "message": "MT5 초기화 실패"}
    
    positions = mt5.positions_get()
    account = mt5.account_info()
    leverage = account.leverage if account else 500
    total_margin = account.margin if account else 0
    
    if not positions:
        return {"success": True, "positions": [], "count": 0, "total_margin": 0}
    
    position_list = []
    for pos in positions:
        # magic 필터링 (지정된 경우)
        if magic is not None and pos.magic != magic:
            continue
        
        # MT5 함수로 정확한 마진 계산 (종목별 레버리지 자동 적용)
        order_type = mt5.ORDER_TYPE_BUY if pos.type == 0 else mt5.ORDER_TYPE_SELL
        tick = mt5.symbol_info_tick(pos.symbol)
        current_price = tick.ask if pos.type == 0 else tick.bid if tick else pos.price_open
        margin = mt5.order_calc_margin(order_type, pos.symbol, pos.volume, current_price)
        if margin is None:
            margin = 0
            
        position_list.append({
            "ticket": pos.ticket,
            "symbol": pos.symbol,
            "type": "BUY" if pos.type == 0 else "SELL",
            "volume": pos.volume,
            "entry": pos.price_open,
            "current": pos.price_current,
            "profit": pos.profit,
            "sl": pos.sl,
            "tp": pos.tp,
            "magic": pos.magic,
            "comment": pos.comment,
            "margin": round(margin, 2)
        })
    
    # 필터된 포지션들의 마진 합계
    filtered_margin = sum(p["margin"] for p in position_list)
    
    return {
        "success": True, 
        "positions": position_list, 
        "count": len(position_list),
        "total_margin": round(filtered_margin, 2),
        "leverage": leverage
    }

# ========== 전체 청산 ==========
@router.post("/close-all")
async def close_all_positions(
    magic: int = None,
    current_user: User = Depends(get_current_user)
):
    """모든 포지션 청산 (magic 필터 옵션)"""
    if not mt5.initialize():
        return JSONResponse({"success": False, "message": "MT5 초기화 실패"})
    
    positions = mt5.positions_get()
    if not positions:
        return JSONResponse({"success": False, "message": "열린 포지션 없음"})
    
    closed_count = 0
    total_profit = 0
    
    for pos in positions:
        # magic 필터링
        if magic is not None and pos.magic != magic:
            continue
            
        tick = mt5.symbol_info_tick(pos.symbol)
        if not tick:
            continue
            
        close_type = mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY
        close_price = tick.bid if pos.type == 0 else tick.ask
        
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": close_type,
            "position": pos.ticket,
            "price": close_price,
            "deviation": 20,
            "magic": 123456,
            "comment": "Trading-X CLOSE ALL",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        
        result = mt5.order_send(request)
        
        if result.retcode == mt5.TRADE_RETCODE_DONE:
            closed_count += 1
            total_profit += pos.profit
    
    if closed_count > 0:
        return JSONResponse({
            "success": True,
            "message": f"{closed_count}개 청산 완료! 총 P/L: ${total_profit:,.2f}",
            "closed_count": closed_count,
            "total_profit": total_profit
        })
    else:
        return JSONResponse({"success": False, "message": "청산 실패"})


# ========== 타입별 청산 (BUY/SELL) ==========
@router.post("/close-by-type")
async def close_by_type(
    type: str = "BUY",
    magic: int = None,
    current_user: User = Depends(get_current_user)
):
    """BUY 또는 SELL 포지션만 청산"""
    if not mt5.initialize():
        return JSONResponse({"success": False, "message": "MT5 초기화 실패"})
    
    positions = mt5.positions_get()
    if not positions:
        return JSONResponse({"success": False, "message": "열린 포지션 없음"})
    
    target_type = 0 if type.upper() == "BUY" else 1
    closed_count = 0
    total_profit = 0
    
    for pos in positions:
        if pos.type != target_type:
            continue
        # magic 필터링
        if magic is not None and pos.magic != magic:
            continue
            
        tick = mt5.symbol_info_tick(pos.symbol)
        if not tick:
            continue
            
        close_type = mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY
        close_price = tick.bid if pos.type == 0 else tick.ask
        
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": close_type,
            "position": pos.ticket,
            "price": close_price,
            "deviation": 20,
            "magic": 123456,
            "comment": f"Trading-X CLOSE {type.upper()}",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        
        result = mt5.order_send(request)
        
        if result.retcode == mt5.TRADE_RETCODE_DONE:
            closed_count += 1
            total_profit += pos.profit
    
    if closed_count > 0:
        return JSONResponse({
            "success": True,
            "message": f"{type.upper()} {closed_count}개 청산! P/L: ${total_profit:,.2f}",
            "closed_count": closed_count,
            "total_profit": total_profit
        })
    else:
        return JSONResponse({"success": False, "message": f"{type.upper()} 포지션 없음"})


# ========== 손익별 청산 (수익/손실) ==========
@router.post("/close-by-profit")
async def close_by_profit(
    profit_type: str = "positive",
    magic: int = None,
    current_user: User = Depends(get_current_user)
):
    """수익 또는 손실 포지션만 청산"""
    if not mt5.initialize():
        return JSONResponse({"success": False, "message": "MT5 초기화 실패"})
    
    positions = mt5.positions_get()
    if not positions:
        return JSONResponse({"success": False, "message": "열린 포지션 없음"})
    
    closed_count = 0
    total_profit = 0
    
    for pos in positions:
        # magic 필터링
        if magic is not None and pos.magic != magic:
            continue
        # 수익/손실 필터링
        if profit_type == "positive" and pos.profit <= 0:
            continue
        if profit_type == "negative" and pos.profit >= 0:
            continue
            
        tick = mt5.symbol_info_tick(pos.symbol)
        if not tick:
            continue
            
        close_type = mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY
        close_price = tick.bid if pos.type == 0 else tick.ask
        
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": close_type,
            "position": pos.ticket,
            "price": close_price,
            "deviation": 20,
            "magic": 123456,
            "comment": f"Trading-X CLOSE {'PROFIT' if profit_type == 'positive' else 'LOSS'}",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        
        result = mt5.order_send(request)
        
        if result.retcode == mt5.TRADE_RETCODE_DONE:
            closed_count += 1
            total_profit += pos.profit
    
    type_name = "수익" if profit_type == "positive" else "손실"
    
    if closed_count > 0:
        return JSONResponse({
            "success": True,
            "message": f"{type_name} {closed_count}개 청산! P/L: ${total_profit:,.2f}",
            "closed_count": closed_count,
            "total_profit": total_profit
        })
    else:
        return JSONResponse({"success": False, "message": f"{type_name} 포지션 없음"})

# ========== 거래 내역 ==========
@router.get("/history")
async def get_history(current_user: User = Depends(get_current_user)):
    """거래 내역 조회"""
    from_date = datetime.now() - timedelta(days=30)
    to_date = datetime.now() + timedelta(days=1)  # 미래 1일 추가 (시간대 문제 방지)
    
    deals = mt5.history_deals_get(from_date, to_date)
    
    print(f"[MT5 History] from: {from_date}, to: {to_date}")
    print(f"[MT5 History] Total deals found: {len(deals) if deals else 0}")
    
    history = []
    if deals:
        # profit이 0이 아닌 거래만 필터링하고 시간순 정렬
        filtered_deals = [d for d in deals if d.profit != 0]
        # 최신순 정렬
        sorted_deals = sorted(filtered_deals, key=lambda x: x.time, reverse=True)
        
        print(f"[MT5 History] Filtered deals: {len(filtered_deals)}")
        
        for deal in sorted_deals[:30]:  # 최근 30개
            # MT5 서버 시간 → 로컬 시간 보정 (2시간 차이 보정)
            trade_time = datetime.fromtimestamp(deal.time) - timedelta(hours=2)
            history.append({
                "ticket": deal.ticket,
                "time": trade_time.strftime("%m/%d %H:%M"),
                "symbol": deal.symbol,
                "type": "BUY" if deal.type == 0 else "SELL",
                "volume": deal.volume,
                "price": deal.price,
                "profit": deal.profit,
                "entry": deal.price,
                "exit": deal.price
            })
            print(f"[MT5 History] Deal: {deal.ticket}, Time: {trade_time}, Symbol: {deal.symbol}, Profit: {deal.profit}")
    
    return {"history": history}


# ========== 마틴게일 API ==========
@router.post("/martin/enable")
async def enable_martin(
    base_lot: float = 0.01,
    target: int = 50,
    max_steps: int = 7,
    current_user: User = Depends(get_current_user)
):
    """마틴게일 모드 활성화"""
    result = martin_service.enable(base_lot, target, max_steps)
    return JSONResponse(result)


@router.post("/martin/disable")
async def disable_martin(current_user: User = Depends(get_current_user)):
    """마틴게일 모드 비활성화"""
    result = martin_service.disable()
    return JSONResponse(result)


@router.get("/martin/state")
async def get_martin_state(current_user: User = Depends(get_current_user)):
    """마틴게일 상태 조회"""
    return martin_service.get_state()


@router.post("/martin/buy")
async def martin_buy(
    symbol: str = "BTCUSD",
    current_user: User = Depends(get_current_user)
):
    """마틴게일 BUY 주문"""
    result = martin_service.place_order(symbol, "BUY")
    return JSONResponse(result)


@router.post("/martin/sell")
async def martin_sell(
    symbol: str = "BTCUSD",
    current_user: User = Depends(get_current_user)
):
    """마틴게일 SELL 주문"""
    result = martin_service.place_order(symbol, "SELL")
    return JSONResponse(result)


@router.post("/martin/update")
async def martin_update(
    profit: float = 0,
    current_user: User = Depends(get_current_user)
):
    """포지션 청산 후 마틴 상태 업데이트"""
    result = martin_service.update_after_close(profit)
    return JSONResponse(result)


@router.post("/martin/update-state")
async def martin_update_state(
    step: int = 1,
    accumulated_loss: float = 0,
    current_user: User = Depends(get_current_user)
):
    """마틴 단계와 누적손실 업데이트"""
    martin_service.state.step = step
    martin_service.state.accumulated_loss = accumulated_loss
    
    return JSONResponse({
        "success": True,
        "message": f"마틴 상태 업데이트: Step {step}, 누적손실 ${accumulated_loss:,.2f}",
        "step": step,
        "accumulated_loss": accumulated_loss,
        "current_lot": martin_service.get_current_lot()
    })


@router.post("/martin/reset-full")
async def martin_reset_full(
    current_user: User = Depends(get_current_user)
):
    """마틴 완전 초기화 (1단계, 누적손실 0)"""
    martin_service.state.step = 1
    martin_service.state.accumulated_loss = 0
    # current_lot은 get_current_lot() 메서드로 자동 계산됨
    
    return JSONResponse({
        "success": True,
        "message": "마틴 초기화 완료",
        "step": 1,
        "accumulated_loss": 0
    })


# ========== 종목 검색 API ==========
def get_symbol_icon(symbol_name: str):
    """심볼에 맞는 아이콘과 색상 반환"""
    symbol_upper = symbol_name.upper()
    
    # 암호화폐
    if "BTC" in symbol_upper:
        return "₿", "#f7931a"
    if "ETH" in symbol_upper:
        return "Ξ", "#627eea"
    if "XRP" in symbol_upper:
        return "✕", "#00aae4"
    if "LTC" in symbol_upper:
        return "Ł", "#bfbbbb"
    if "DOGE" in symbol_upper:
        return "Ð", "#c2a633"
    
    # 귀금속
    if "XAU" in symbol_upper or "GOLD" in symbol_upper:
        return "✦", "#ffd700"
    if "XAG" in symbol_upper or "SILVER" in symbol_upper:
        return "✦", "#c0c0c0"
    
    # 통화
    if "EUR" in symbol_upper:
        return "€", "#0052cc"
    if "GBP" in symbol_upper:
        return "£", "#9c27b0"
    if "JPY" in symbol_upper:
        return "¥", "#dc143c"
    if "AUD" in symbol_upper:
        return "A$", "#00875a"
    if "CAD" in symbol_upper:
        return "C$", "#ff5722"
    if "CHF" in symbol_upper:
        return "₣", "#e91e63"
    if "NZD" in symbol_upper:
        return "NZ$", "#4caf50"
    
    # 지수
    if "US100" in symbol_upper or "NAS" in symbol_upper or "NDX" in symbol_upper:
        return "📈", "#00d4ff"
    if "US500" in symbol_upper or "SPX" in symbol_upper:
        return "◆", "#1976d2"
    if "US30" in symbol_upper or "DJI" in symbol_upper:
        return "◈", "#ff9800"
    if "GER" in symbol_upper or "DAX" in symbol_upper:
        return "▣", "#ffeb3b"
    if "UK100" in symbol_upper:
        return "▤", "#3f51b5"
    if "JP225" in symbol_upper or "NIK" in symbol_upper:
        return "◉", "#f44336"
    
    # 원유/에너지
    if "OIL" in symbol_upper or "WTI" in symbol_upper or "BRENT" in symbol_upper:
        return "🛢", "#795548"
    if "GAS" in symbol_upper:
        return "⛽", "#607d8b"
    
    # 기본값 (Forex)
    return "$", "#9ca3af"


def get_symbol_category(symbol_name: str):
    """심볼 카테고리 분류"""
    symbol_upper = symbol_name.upper()
    
    if any(x in symbol_upper for x in ["BTC", "ETH", "XRP", "LTC", "DOGE", "ADA", "SOL", "DOT"]):
        return "crypto"
    if any(x in symbol_upper for x in ["XAU", "XAG", "GOLD", "SILVER", "PLATINUM", "PALLADIUM"]):
        return "metals"
    if any(x in symbol_upper for x in ["US100", "US500", "US30", "GER", "UK100", "JP225", "NAS", "SPX", "DJI", "DAX"]):
        return "indices"
    if any(x in symbol_upper for x in ["OIL", "WTI", "BRENT", "GAS", "NATGAS"]):
        return "energy"
    
    return "forex"


@router.get("/symbols/search")
def search_symbols(query: str = ""):
    """MT5 종목 검색 API"""
    if not mt5.initialize():
        return {"success": False, "symbols": [], "message": "MT5 not connected"}
    
    try:
        # 모든 심볼 가져오기
        all_symbols = mt5.symbols_get()
        
        if all_symbols is None:
            return {"success": False, "symbols": [], "message": "Failed to get symbols"}
        
        results = []
        query_upper = query.upper()
        
        for symbol in all_symbols:
            # 검색어가 심볼명 또는 설명에 포함되어 있는지 확인
            if query_upper in symbol.name.upper() or query_upper in symbol.description.upper():
                # 심볼 아이콘 및 색상 결정
                icon, color = get_symbol_icon(symbol.name)
                
                results.append({
                    "symbol": symbol.name,
                    "name": symbol.description or symbol.name,
                    "icon": icon,
                    "color": color,
                    "category": get_symbol_category(symbol.name)
                })
        
        # 최대 20개까지만 반환
        return {"success": True, "symbols": results[:20], "total": len(results)}
        
    except Exception as e:
        return {"success": False, "symbols": [], "message": str(e)}


@router.get("/symbols/all")
def get_all_symbols():
    """MT5 전체 종목 목록 API"""
    if not mt5.initialize():
        return {"success": False, "symbols": [], "message": "MT5 not connected"}
    
    try:
        all_symbols = mt5.symbols_get()
        
        if all_symbols is None:
            return {"success": False, "symbols": [], "message": "Failed to get symbols"}
        
        results = []
        for symbol in all_symbols:
            if symbol.visible:  # Market Watch에 있는 것만
                icon, color = get_symbol_icon(symbol.name)
                results.append({
                    "symbol": symbol.name,
                    "name": symbol.description or symbol.name,
                    "icon": icon,
                    "color": color,
                    "category": get_symbol_category(symbol.name)
                })
        
        return {"success": True, "symbols": results, "total": len(results)}
        
    except Exception as e:
        return {"success": False, "symbols": [], "message": str(e)}

# ========== MT5 계정 연결 ==========
from pydantic import BaseModel

class MT5ConnectRequest(BaseModel):
    server: str = "HedgeHood-MT5"
    account: str
    password: str

@router.post("/connect")
async def connect_mt5_account(
    request: MT5ConnectRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """MT5 계정 연결 및 저장"""
    if not request.account or not request.password:
        return JSONResponse({"success": False, "message": "계좌번호와 비밀번호를 입력하세요"})
    
    if not mt5.initialize():
        return JSONResponse({"success": False, "message": "MT5 초기화 실패"})
    
    # DB에 has_mt5_account = True 저장
    current_user.has_mt5_account = True
    current_user.mt5_account_number = request.account
    current_user.mt5_server = request.server
    db.commit()
    
    return JSONResponse({
        "success": True,
        "message": "MT5 계정 연결 완료!",
        "account": request.account,
        "server": request.server
    })
    """MT5 계정 연결 및 저장"""
    if not account or not password:
        return JSONResponse({"success": False, "message": "계좌번호와 비밀번호를 입력하세요"})
    
    if not mt5.initialize():
        return JSONResponse({"success": False, "message": "MT5 초기화 실패"})
    
    # DB에 has_mt5_account = True 저장
    current_user.has_mt5_account = True
    current_user.mt5_account_number = account
    current_user.mt5_server = server
    db.commit()
    
    return JSONResponse({
        "success": True,
        "message": "MT5 계정 연결 완료!",
        "account": account,
        "server": server
    })


@router.post("/disconnect")
async def disconnect_mt5_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """MT5 계정 연결 해제"""
    current_user.has_mt5_account = False
    current_user.mt5_account_number = None
    current_user.mt5_server = None
    db.commit()
    
    return JSONResponse({
        "success": True,
        "message": "MT5 계정 연결이 해제되었습니다"
    })

# ========== WebSocket 실시간 데이터 ==========
@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """실시간 데이터 WebSocket"""
    await websocket.accept()
    
    symbols_list = ["BTCUSD", "EURUSD.r", "USDJPY.r", "XAUUSD.r", "US100.", "GBPUSD.r", "AUDUSD.r", "USDCAD.r", "ETHUSD"]
    
    while True:
        try:
            if not mt5.initialize():
                await asyncio.sleep(1)
                continue
            
            account = mt5.account_info()
            
            # 모든 심볼 가격
            all_prices = {}
            for sym in symbols_list:
                tick = mt5.symbol_info_tick(sym)
                if tick:
                    all_prices[sym] = {"bid": tick.bid, "ask": tick.ask}
            
            # 포지션 정보
            positions = mt5.positions_get()
            positions_count = len(positions) if positions else 0
            
            position_data = None
            if positions and len(positions) > 0:
                # Buy/Sell 패널용 포지션 (magic=100001)
                buysell_pos = None
                for pos in positions:
                    if pos.magic == 100001:
                        buysell_pos = pos
                        break
                
                if buysell_pos:
                    position_data = {
                        "type": "BUY" if buysell_pos.type == 0 else "SELL",
                        "symbol": buysell_pos.symbol,
                        "volume": buysell_pos.volume,
                        "entry": buysell_pos.price_open,
                        "profit": buysell_pos.profit,
                        "ticket": buysell_pos.ticket,
                        "magic": buysell_pos.magic
                    }
            
            # 인디케이터 계산
            try:
                indicators = IndicatorService.calculate_all_indicators("BTCUSD")
                buy_count = indicators["buy"]
                sell_count = indicators["sell"]
                neutral_count = indicators["neutral"]
                base_score = indicators["score"]
            except Exception as e:
                buy_count = 33
                sell_count = 33
                neutral_count = 34
                base_score = 50
            
            # 모든 종목 마지막 캔들
            all_candles = {}
            for sym in symbols_list:
                rates = mt5.copy_rates_from_pos(sym, mt5.TIMEFRAME_M1, 0, 1)
                if rates is not None and len(rates) > 0:
                    r = rates[0]
                    all_candles[sym] = {
                        "time": int(r['time']),
                        "open": float(r['open']),
                        "high": float(r['high']),
                        "low": float(r['low']),
                        "close": float(r['close'])
                    }
            
            # 마틴 상태
            martin_state = martin_service.get_state()
            
            data = {
                "broker": account.company if account else "N/A",
                "account": account.login if account else 0,
                "balance": account.balance if account else 0,
                "equity": account.equity if account else 0,
                "margin": account.margin if account else 0,
                "free_margin": account.margin_free if account else 0,
                "leverage": account.leverage if account else 0,
                "positions_count": positions_count,
                "position": position_data,
                "buy_count": buy_count,
                "sell_count": sell_count,
                "neutral_count": neutral_count,
                "base_score": base_score,
                "all_prices": all_prices,
                "all_candles": all_candles,
                "martin": martin_state
            }
            
            await websocket.send_text(json.dumps(data))
            await asyncio.sleep(1)
            
        except WebSocketDisconnect:
            break
        except Exception as e:
            print(f"WebSocket Error: {e}")
            await asyncio.sleep(1)

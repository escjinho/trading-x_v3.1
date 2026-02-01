import MetaTrader5 as mt5
from typing import Optional, List, Dict
from datetime import datetime, timedelta

# ============================================================
# MT5 비활성화 플래그 (True = MT5 비활성화, False = MT5 활성화)
# 다시 활성화하려면 이 값을 False로 변경하세요
# ============================================================
MT5_DISABLED = False

class MT5Service:
    """MT5 연동 서비스"""

    _initialized = False

    @classmethod
    def initialize(cls) -> bool:
        """MT5 초기화"""
        # === MT5 비활성화됨 (MT5_DISABLED = True) ===
        # 다시 활성화하려면 파일 상단의 MT5_DISABLED = False로 변경
        if MT5_DISABLED:
            print("[MT5 비활성화됨] MT5 초기화를 건너뜁니다.")
            return False
        # === 비활성화 끝 ===

        if cls._initialized:
            return True

        if not mt5.initialize():
            print(f"MT5 초기화 실패: {mt5.last_error()}")
            return False

        cls._initialized = True
        print("MT5 초기화 성공!")
        return True

    @classmethod
    def shutdown(cls):
        """MT5 종료"""
        # === MT5 비활성화됨 ===
        if MT5_DISABLED:
            print("[MT5 비활성화됨] MT5 종료를 건너뜁니다.")
            return
        # === 비활성화 끝 ===

        if cls._initialized:
            mt5.shutdown()
            cls._initialized = False

    @classmethod
    def login(cls, account: int, password: str, server: str) -> bool:
        """MT5 계정 로그인"""
        # === MT5 비활성화됨 ===
        if MT5_DISABLED:
            print("[MT5 비활성화됨] 로그인을 건너뜁니다.")
            return False
        # === 비활성화 끝 ===

        if not cls._initialized:
            cls.initialize()

        authorized = mt5.login(account, password=password, server=server)
        if not authorized:
            print(f"로그인 실패: {mt5.last_error()}")
            return False

        print(f"계정 {account} 로그인 성공!")
        return True
    
    @classmethod
    def get_account_info(cls) -> Optional[Dict]:
        """계정 정보 조회"""
        if not cls._initialized:
            return None
        
        info = mt5.account_info()
        if info is None:
            return None
        
        return {
            "login": info.login,
            "balance": info.balance,
            "equity": info.equity,
            "profit": info.profit,
            "margin": info.margin,
            "margin_free": info.margin_free,
            "leverage": info.leverage,
            "currency": info.currency
        }
    
    @classmethod
    def get_symbols(cls) -> List[str]:
        """사용 가능한 심볼 목록"""
        if not cls._initialized:
            cls.initialize()
        
        symbols = mt5.symbols_get()
        if symbols is None:
            return []
        
        # 모든 visible 심볼 반환 (최대 50개)
        available = []
        for s in symbols:
            if s.visible:
                available.append(s.name)
                if len(available) >= 50:
                    break
        
        return available
    
    @classmethod
    def get_symbol_price(cls, symbol: str) -> Optional[Dict]:
        """심볼 현재가 조회"""
        if not cls._initialized:
            cls.initialize()
        
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            return None
        
        return {
            "symbol": symbol,
            "bid": tick.bid,
            "ask": tick.ask,
            "last": tick.last,
            "time": datetime.fromtimestamp(tick.time).isoformat()
        }
    
    @classmethod
    def get_candles(cls, symbol: str, timeframe: str = "M15", count: int = 100) -> List[Dict]:
        """캔들 데이터 조회"""
        if not cls._initialized:
            cls.initialize()
        
        # 타임프레임 매핑
        tf_map = {
            "M1": mt5.TIMEFRAME_M1,
            "M5": mt5.TIMEFRAME_M5,
            "M15": mt5.TIMEFRAME_M15,
            "M30": mt5.TIMEFRAME_M30,
            "H1": mt5.TIMEFRAME_H1,
            "H4": mt5.TIMEFRAME_H4,
            "D1": mt5.TIMEFRAME_D1,
        }
        
        mt5_tf = tf_map.get(timeframe, mt5.TIMEFRAME_M15)
        
        rates = mt5.copy_rates_from_pos(symbol, mt5_tf, 0, count)
        if rates is None:
            return []
        
        candles = []
        for rate in rates:
            candles.append({
                "time": int(rate['time']),
                "open": float(rate['open']),
                "high": float(rate['high']),
                "low": float(rate['low']),
                "close": float(rate['close']),
                "volume": int(rate['tick_volume'])
            })
        
        return candles
    
    @classmethod
    def get_positions(cls) -> List[Dict]:
        """열린 포지션 조회"""
        if not cls._initialized:
            return []
        
        positions = mt5.positions_get()
        if positions is None:
            return []
        
        result = []
        for pos in positions:
            result.append({
                "ticket": pos.ticket,
                "symbol": pos.symbol,
                "type": "buy" if pos.type == 0 else "sell",
                "volume": pos.volume,
                "open_price": pos.price_open,
                "current_price": pos.price_current,
                "sl": pos.sl,
                "tp": pos.tp,
                "profit": pos.profit,
                "open_time": datetime.fromtimestamp(pos.time).isoformat()
            })
        
        return result
    
    @classmethod
    def place_order(cls, symbol: str, order_type: str, volume: float, 
                   sl_pips: int = 0, tp_pips: int = 0) -> Optional[Dict]:
        """주문 실행"""
        if not cls._initialized:
            return None
        
        symbol_info = mt5.symbol_info(symbol)
        if symbol_info is None:
            return {"error": "심볼을 찾을 수 없습니다"}
        
        point = symbol_info.point
        price = mt5.symbol_info_tick(symbol)
        
        if order_type.lower() == "buy":
            trade_type = mt5.ORDER_TYPE_BUY
            entry_price = price.ask
            sl = entry_price - sl_pips * point * 10 if sl_pips > 0 else 0
            tp = entry_price + tp_pips * point * 10 if tp_pips > 0 else 0
        else:
            trade_type = mt5.ORDER_TYPE_SELL
            entry_price = price.bid
            sl = entry_price + sl_pips * point * 10 if sl_pips > 0 else 0
            tp = entry_price - tp_pips * point * 10 if tp_pips > 0 else 0
        
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": volume,
            "type": trade_type,
            "price": entry_price,
            "sl": sl,
            "tp": tp,
            "deviation": 20,
            "magic": 123456,
            "comment": "Trading-X",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        
        result = mt5.order_send(request)
        
        if result.retcode != mt5.TRADE_RETCODE_DONE:
            return {"error": f"주문 실패: {result.comment}"}
        
        return {
            "ticket": result.order,
            "price": result.price,
            "volume": volume,
            "symbol": symbol,
            "type": order_type
        }
    
    @classmethod
    def close_position(cls, ticket: int) -> Optional[Dict]:
        """포지션 청산"""
        if not cls._initialized:
            return None
        
        position = mt5.positions_get(ticket=ticket)
        if not position:
            return {"error": "포지션을 찾을 수 없습니다"}
        
        pos = position[0]
        
        # 반대 주문으로 청산
        if pos.type == 0:  # Buy -> Sell로 청산
            trade_type = mt5.ORDER_TYPE_SELL
            price = mt5.symbol_info_tick(pos.symbol).bid
        else:  # Sell -> Buy로 청산
            trade_type = mt5.ORDER_TYPE_BUY
            price = mt5.symbol_info_tick(pos.symbol).ask
        
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": trade_type,
            "position": ticket,
            "price": price,
            "deviation": 20,
            "magic": 123456,
            "comment": "Trading-X Close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        
        result = mt5.order_send(request)
        
        if result.retcode != mt5.TRADE_RETCODE_DONE:
            return {"error": f"청산 실패: {result.comment}"}
        
        return {"message": "포지션 청산 완료", "ticket": ticket}
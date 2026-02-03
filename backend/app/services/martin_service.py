# app/services/martin_service.py
"""
마틴게일 전략 서비스
단계별 랏 관리, 손실 누적, 회복 목표 계산
"""

from typing import Dict, List, Optional
from dataclasses import dataclass, field
try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False


@dataclass
class MartinState:
    """마틴게일 상태 데이터"""
    enabled: bool = False
    step: int = 1
    max_steps: int = 7
    base_lot: float = 0.01
    accumulated_loss: float = 0.0
    target_amount: float = 50.0
    history: List[Dict] = field(default_factory=list)


class MartinService:
    """마틴게일 전략 관리 클래스"""
    
    def __init__(self):
        self.state = MartinState()
    
    def enable(self, base_lot: float = 0.01, target: float = 50.0, max_steps: int = 7) -> Dict:
        """마틴게일 모드 활성화"""
        self.state.enabled = True
        self.state.step = 1
        self.state.base_lot = base_lot
        self.state.target_amount = target
        self.state.max_steps = max_steps
        self.state.accumulated_loss = 0.0
        self.state.history = []
        
        return {
            "success": True,
            "message": "Martin mode enabled",
            "state": self.get_state()
        }
    
    def disable(self) -> Dict:
        """마틴게일 모드 비활성화"""
        self.state.enabled = False
        self.state.step = 1
        self.state.accumulated_loss = 0.0
        self.state.history = []
        
        return {
            "success": True,
            "message": "Martin mode disabled"
        }
    
    def get_current_lot(self) -> float:
        """현재 단계의 랏 사이즈 계산: base_lot × 2^(step-1)"""
        lot = self.state.base_lot * (2 ** (self.state.step - 1))
        return round(lot, 2)
    
    def get_recovery_target(self) -> float:
        """회복 목표 금액 계산: 누적손실 + 기본타겟"""
        return self.state.accumulated_loss + self.state.target_amount
    
    def calculate_tp_sl(self, symbol: str, order_type: str) -> Dict:
        """TP/SL 가격 계산"""
        tick = mt5.symbol_info_tick(symbol)
        symbol_info = mt5.symbol_info(symbol)
        
        if not tick or not symbol_info:
            return {"tp": 0, "sl": 0, "error": "Symbol info not found"}
        
        current_lot = self.get_current_lot()
        point_value = symbol_info.trade_tick_value if symbol_info.trade_tick_value > 0 else 1
        
        # TP 포인트 계산: (누적손실 + 목표금액) / (랏 × 포인트가치)
        recovery_target = self.get_recovery_target()
        tp_points = int(recovery_target / (current_lot * point_value)) if current_lot * point_value > 0 else 500
        
        # SL 포인트: 목표금액과 동일한 거리
        sl_points = int(self.state.target_amount / (current_lot * point_value)) if current_lot * point_value > 0 else 500
        
        if order_type.upper() == "BUY":
            tp_price = tick.ask + (tp_points * symbol_info.point)
            sl_price = tick.ask - (sl_points * symbol_info.point)
            entry_price = tick.ask
        else:  # SELL
            tp_price = tick.bid - (tp_points * symbol_info.point)
            sl_price = tick.bid + (sl_points * symbol_info.point)
            entry_price = tick.bid
        
        return {
            "tp": tp_price,
            "sl": sl_price,
            "entry": entry_price,
            "lot": current_lot,
            "tp_points": tp_points,
            "sl_points": sl_points
        }
    
    def place_order(self, symbol: str, order_type: str) -> Dict:
        """마틴게일 주문 실행"""
        if not self.state.enabled:
            return {"success": False, "message": "Martin mode not enabled"}
        
        tick = mt5.symbol_info_tick(symbol)
        symbol_info = mt5.symbol_info(symbol)
        
        if not tick or not symbol_info:
            return {"success": False, "message": "Symbol info not found"}
        
        # TP/SL 계산
        calc = self.calculate_tp_sl(symbol, order_type)
        current_lot = calc["lot"]
        
        # 주문 타입 결정
        if order_type.upper() == "BUY":
            mt5_type = mt5.ORDER_TYPE_BUY
            price = tick.ask
        else:
            mt5_type = mt5.ORDER_TYPE_SELL
            price = tick.bid
        
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": current_lot,
            "type": mt5_type,
            "price": price,
            "sl": calc["sl"],
            "tp": calc["tp"],
            "deviation": 20,
            "magic": 123456,
            "comment": f"MARTIN {order_type.upper()} Step {self.state.step}",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        
        result = mt5.order_send(request)
        
        if result.retcode == mt5.TRADE_RETCODE_DONE:
            return {
                "success": True,
                "message": f"Martin {order_type.upper()} Step {self.state.step} - {current_lot} lot @ {result.price:,.2f}",
                "step": self.state.step,
                "lot": current_lot,
                "tp": calc["tp"],
                "sl": calc["sl"],
                "ticket": result.order
            }
        else:
            return {
                "success": False,
                "message": f"Failed: {result.retcode} - {result.comment}"
            }
    
    def update_after_close(self, profit: float) -> Dict:
        """포지션 청산 후 마틴 상태 업데이트"""
        if not self.state.enabled:
            return {"success": False, "message": "Martin mode not enabled"}
        
        current_lot = self.get_current_lot()
        
        # 히스토리 기록
        self.state.history.append({
            "step": self.state.step,
            "lot": current_lot,
            "profit": profit
        })
        
        if profit >= 0:
            # 이익 → 리셋
            self.state.step = 1
            self.state.accumulated_loss = 0.0
            return {
                "success": True,
                "message": "WIN! Martin reset to Step 1",
                "action": "reset",
                "state": self.get_state()
            }
        else:
            # 손실 → 다음 단계
            self.state.accumulated_loss += abs(profit)
            
            if self.state.step >= self.state.max_steps:
                # 최대 단계 도달 → 리셋
                total_loss = self.state.accumulated_loss
                self.state.step = 1
                self.state.accumulated_loss = 0.0
                return {
                    "success": True,
                    "message": "Max steps reached! Martin reset",
                    "action": "max_reached",
                    "total_loss": total_loss,
                    "state": self.get_state()
                }
            else:
                # 다음 단계로
                self.state.step += 1
                next_lot = self.get_current_lot()
                return {
                    "success": True,
                    "message": f"LOSS! Moving to Step {self.state.step}",
                    "action": "next_step",
                    "next_lot": next_lot,
                    "accumulated_loss": self.state.accumulated_loss,
                    "state": self.get_state()
                }
    
    def get_state(self) -> Dict:
        """현재 마틴 상태 반환"""
        return {
            "enabled": self.state.enabled,
            "step": self.state.step,
            "max_steps": self.state.max_steps,
            "base_lot": self.state.base_lot,
            "current_lot": self.get_current_lot(),
            "accumulated_loss": self.state.accumulated_loss,
            "target_amount": self.state.target_amount,
            "recovery_target": self.get_recovery_target(),
            "history": self.state.history
        }
    
    def calculate_max_steps_for_balance(self, balance: float) -> Dict:
        """잔고 기준 최대 가능 단계 계산"""
        max_possible = 1
        
        for n in range(1, 21):
            # 필요 금액: base_lot × target × (2^n - 1)
            required = self.state.base_lot * self.state.target_amount * (2 ** n - 1)
            if balance >= required:
                max_possible = n
            else:
                break
        
        required_for_max = self.state.base_lot * self.state.target_amount * (2 ** max_possible - 1)
        
        return {
            "max_steps": max_possible,
            "required_balance": required_for_max,
            "current_balance": balance
        }


# 싱글톤 인스턴스
martin_service = MartinService()
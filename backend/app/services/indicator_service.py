# app/services/indicator_service.py
"""
기술적 지표 계산 서비스
RSI, MACD, Bollinger Band, Stochastic 등 10개 인디케이터
"""

from typing import Dict, List, Optional
try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False


class IndicatorService:
    """기술적 지표 계산 클래스"""
    
    @staticmethod
    def calculate_rsi(closes: List[float], period: int = 14) -> float:
        """RSI 계산"""
        if len(closes) < period + 1:
            return 50.0
        
        gains = []
        losses = []
        
        for i in range(1, len(closes)):
            change = closes[i] - closes[i-1]
            gains.append(max(0, change))
            losses.append(max(0, -change))
        
        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period
        
        if avg_loss == 0:
            return 100.0
        
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
        return rsi
    
    @staticmethod
    def calculate_ema(closes: List[float], period: int) -> float:
        """EMA 계산"""
        if len(closes) < period:
            return closes[-1] if closes else 0
        
        multiplier = 2 / (period + 1)
        ema = sum(closes[:period]) / period
        
        for price in closes[period:]:
            ema = (price - ema) * multiplier + ema
        
        return ema
    
    @staticmethod
    def calculate_macd(closes: List[float], fast: int = 12, slow: int = 26, signal_period: int = 9) -> tuple:
        """MACD 계산"""
        if len(closes) < slow + signal_period:
            return 0, 0
        
        ema_fast = IndicatorService.calculate_ema(closes, fast)
        ema_slow = IndicatorService.calculate_ema(closes, slow)
        macd_line = ema_fast - ema_slow
        
        macd_values = []
        for i in range(slow - 1, len(closes)):
            ef = IndicatorService.calculate_ema(closes[:i+1], fast)
            es = IndicatorService.calculate_ema(closes[:i+1], slow)
            macd_values.append(ef - es)
        
        if len(macd_values) >= signal_period:
            signal_line = sum(macd_values[-signal_period:]) / signal_period
        else:
            signal_line = macd_line
        
        return macd_line, signal_line
    
    @staticmethod
    def calculate_stochastic(closes: List[float], highs: List[float], lows: List[float], 
                            k_period: int = 14, d_period: int = 3) -> tuple:
        """Stochastic 계산"""
        if len(closes) < k_period:
            return 50.0, 50.0
        
        highest_high = max(highs[-k_period:])
        lowest_low = min(lows[-k_period:])
        
        if highest_high == lowest_low:
            k = 50.0
        else:
            k = ((closes[-1] - lowest_low) / (highest_high - lowest_low)) * 100
        
        d = k
        return k, d
    
    @staticmethod
    def calculate_cci(closes: List[float], highs: List[float], lows: List[float], period: int = 20) -> float:
        """CCI 계산"""
        if len(closes) < period:
            return 0
        
        tp_list = [(highs[i] + lows[i] + closes[i]) / 3 for i in range(len(closes))]
        tp = tp_list[-1]
        tp_sma = sum(tp_list[-period:]) / period
        
        mean_deviation = sum(abs(tp_list[i] - tp_sma) for i in range(-period, 0)) / period
        
        if mean_deviation == 0:
            return 0
        
        cci = (tp - tp_sma) / (0.015 * mean_deviation)
        return cci
    
    @staticmethod
    def calculate_williams_r(closes: List[float], highs: List[float], lows: List[float], period: int = 14) -> float:
        """Williams %R 계산"""
        if len(closes) < period:
            return -50.0
        
        highest_high = max(highs[-period:])
        lowest_low = min(lows[-period:])
        
        if highest_high == lowest_low:
            return -50.0
        
        willr = ((highest_high - closes[-1]) / (highest_high - lowest_low)) * -100
        return willr
    
    @staticmethod
    def calculate_adx(closes: List[float], highs: List[float], lows: List[float], period: int = 14) -> tuple:
        """ADX 계산"""
        if len(closes) < period + 1:
            return 25.0, 25.0, 25.0
        
        plus_dm = []
        minus_dm = []
        tr_list = []
        
        for i in range(1, len(closes)):
            high_diff = highs[i] - highs[i-1]
            low_diff = lows[i-1] - lows[i]
            
            plus_dm.append(high_diff if high_diff > low_diff and high_diff > 0 else 0)
            minus_dm.append(low_diff if low_diff > high_diff and low_diff > 0 else 0)
            
            tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
            tr_list.append(tr)
        
        if len(tr_list) < period:
            return 25.0, 25.0, 25.0
        
        atr = sum(tr_list[-period:]) / period
        
        if atr == 0:
            return 25.0, 25.0, 25.0
        
        plus_di = (sum(plus_dm[-period:]) / period) / atr * 100
        minus_di = (sum(minus_dm[-period:]) / period) / atr * 100
        
        dx = abs(plus_di - minus_di) / (plus_di + minus_di) * 100 if (plus_di + minus_di) > 0 else 0
        adx = dx
        
        return adx, plus_di, minus_di
    
    @staticmethod
    def calculate_bollinger(closes: List[float], period: int = 20, std_dev: int = 2) -> tuple:
        """Bollinger Band 계산"""
        if len(closes) < period:
            return closes[-1], closes[-1], closes[-1]
        
        sma = sum(closes[-period:]) / period
        variance = sum((c - sma) ** 2 for c in closes[-period:]) / period
        std = variance ** 0.5
        
        upper = sma + std_dev * std
        lower = sma - std_dev * std
        
        return upper, sma, lower
    
    @staticmethod
    def calculate_lwma(closes: List[float], period: int) -> float:
        """LWMA 계산"""
        if len(closes) < period:
            return closes[-1] if closes else 0
        
        weights = list(range(1, period + 1))
        weighted_sum = sum(w * c for w, c in zip(weights, closes[-period:]))
        weight_total = sum(weights)
        
        return weighted_sum / weight_total
    
    @staticmethod
    def calculate_current_candle_score(symbol: str) -> float:
        """현재 캔들 실시간 분석 (0~100)"""
        score = 50.0
        
        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 1)
        if rates is None or len(rates) < 1:
            return score
        
        candle = rates[0]
        open_price = candle['open']
        close_price = candle['close']
        high_price = candle['high']
        low_price = candle['low']
        
        if open_price <= 0 or close_price <= 0:
            return score
        
        body = close_price - open_price
        candle_range = high_price - low_price
        if candle_range <= 0:
            candle_range = 0.00001
        
        move_percent = abs(body) / open_price * 10000
        
        if body > 0:
            if move_percent < 5:
                score = 55 + (move_percent / 5) * 10
            elif move_percent < 15:
                score = 65 + ((move_percent - 5) / 10) * 15
            else:
                score = 80 + min((move_percent - 15) / 10, 1.0) * 15
        elif body < 0:
            if move_percent < 5:
                score = 45 - (move_percent / 5) * 10
            elif move_percent < 15:
                score = 35 - ((move_percent - 5) / 10) * 15
            else:
                score = 20 - min((move_percent - 15) / 10, 1.0) * 15
        
        upper_wick = high_price - max(open_price, close_price)
        lower_wick = min(open_price, close_price) - low_price
        
        if candle_range > 0:
            wick_ratio = (lower_wick - upper_wick) / candle_range
            score += wick_ratio * 10
        
        return max(5, min(95, score))
    
    @staticmethod
    def calculate_past_candle_score(symbol: str) -> float:
        """과거 5개 캔들 분석 (0~100)"""
        score = 50.0
        
        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 6)
        if rates is None or len(rates) < 6:
            return score
        
        bull_count = 0
        bear_count = 0
        total_strength = 0.0
        
        for i in range(5):
            candle = rates[i]
            body = candle['close'] - candle['open']
            body_size = abs(body)
            
            if body > 0:
                bull_count += 1
                total_strength += body_size
            elif body < 0:
                bear_count += 1
                total_strength -= body_size
        
        direction_score = (bull_count - bear_count) * 10.0
        
        avg_price = sum(r['close'] for r in rates[:5]) / 5
        strength_ratio = 0
        if avg_price > 0:
            strength_ratio = total_strength / avg_price * 1000
            strength_ratio = max(-15, min(15, strength_ratio))
        
        continuity_bonus = 0
        if bull_count >= 4:
            continuity_bonus = 10
        elif bear_count >= 4:
            continuity_bonus = -10
        
        score = 50.0 + direction_score + strength_ratio + continuity_bonus
        return max(5, min(95, score))
    
    @staticmethod
    def calculate_all_indicators(symbol: str) -> Dict:
        """10개 인디케이터 종합 계산"""
        
        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M5, 0, 200)
        if rates is None or len(rates) < 50:
            return {"buy": 33, "sell": 33, "neutral": 34, "score": 50}
        
        closes = [r['close'] for r in rates]
        highs = [r['high'] for r in rates]
        lows = [r['low'] for r in rates]
        
        buy_count = 0
        sell_count = 0
        neutral_count = 0
        
        # 1. RSI (7)
        rsi = IndicatorService.calculate_rsi(closes, 7)
        if rsi > 70:
            sell_count += 1
        elif rsi < 30:
            buy_count += 1
        else:
            neutral_count += 1
        
        # 2. MACD (6, 13, 5)
        macd, signal = IndicatorService.calculate_macd(closes, 6, 13, 5)
        if macd > signal:
            buy_count += 1
        elif macd < signal:
            sell_count += 1
        else:
            neutral_count += 1
        
        # 3. Stochastic (7, 3)
        k, d = IndicatorService.calculate_stochastic(closes, highs, lows, 7, 3)
        if k > 80:
            sell_count += 1
        elif k < 20:
            buy_count += 1
        else:
            neutral_count += 1
        
        # 4. CCI (9)
        cci = IndicatorService.calculate_cci(closes, highs, lows, 9)
        if cci > 100:
            sell_count += 1
        elif cci < -100:
            buy_count += 1
        else:
            neutral_count += 1
        
        # 5. Williams %R (7)
        willr = IndicatorService.calculate_williams_r(closes, highs, lows, 7)
        if willr > -20:
            sell_count += 1
        elif willr < -80:
            buy_count += 1
        else:
            neutral_count += 1
        
        # 6. ADX (7)
        adx, plus_di, minus_di = IndicatorService.calculate_adx(closes, highs, lows, 7)
        if adx > 20:
            if plus_di > minus_di:
                buy_count += 1
            else:
                sell_count += 1
        else:
            neutral_count += 1
        
        # 7. MA Cross (SMA 5 vs 10)
        sma5 = sum(closes[-5:]) / 5 if len(closes) >= 5 else closes[-1]
        sma10 = sum(closes[-10:]) / 10 if len(closes) >= 10 else closes[-1]
        if sma5 > sma10:
            buy_count += 1
        elif sma5 < sma10:
            sell_count += 1
        else:
            neutral_count += 1
        
        # 8. Bollinger Band Position (10)
        upper, middle, lower = IndicatorService.calculate_bollinger(closes, 10, 2)
        current_price = closes[-1]
        if current_price > upper:
            sell_count += 1
        elif current_price < lower:
            buy_count += 1
        else:
            neutral_count += 1
        
        # 9. EMA Cross (3 vs 8)
        ema3 = IndicatorService.calculate_ema(closes, 3)
        ema8 = IndicatorService.calculate_ema(closes, 8)
        if ema3 > ema8:
            buy_count += 1
        elif ema3 < ema8:
            sell_count += 1
        else:
            neutral_count += 1
        
        # 10. Momentum (5)
        if len(closes) >= 6:
            mom_now = closes[-1] - closes[-6]
            mom_prev = closes[-2] - closes[-7] if len(closes) >= 7 else mom_now
            if mom_now > mom_prev:
                buy_count += 1
            elif mom_now < mom_prev:
                sell_count += 1
            else:
                neutral_count += 1
        else:
            neutral_count += 1
        
        # 가중치 적용
        total = buy_count + sell_count + neutral_count
        if total > 0:
            indicator_score = (buy_count / total) * 100
        else:
            indicator_score = 50.0
        
        # 캔들 점수
        current_candle = IndicatorService.calculate_current_candle_score(symbol)
        past_candle = IndicatorService.calculate_past_candle_score(symbol)
        
        # 최종 점수
        base_score = current_candle * 0.5 + past_candle * 0.2 + indicator_score * 0.3
        base_score = max(5, min(95, base_score))
        
        # 100개 환산
        if base_score >= 50:
            ratio = (base_score - 50) / 50.0
            disp_buy = 25 + int(ratio * 55)
            disp_sell = 25 - int(ratio * 20)
        else:
            ratio = (50 - base_score) / 50.0
            disp_sell = 25 + int(ratio * 55)
            disp_buy = 25 - int(ratio * 20)
        
        disp_buy = max(5, min(80, disp_buy))
        disp_sell = max(5, min(80, disp_sell))
        disp_neutral = 100 - disp_buy - disp_sell
        
        return {
            "buy": disp_buy,
            "sell": disp_sell,
            "neutral": disp_neutral,
            "score": base_score
        }
    
    @staticmethod
    def calculate_chart_indicators(candles: List[Dict], closes: List[float], 
                                   highs: List[float], lows: List[float]) -> Dict:
        """차트용 인디케이터 계산"""
        n = len(closes)
        if n < 20:
            return {}
        
        bb_period = 20
        bb_std = 2
        bb_upper = []
        bb_middle = []
        bb_lower = []
        
        for i in range(n):
            if i < bb_period - 1:
                bb_upper.append(None)
                bb_middle.append(None)
                bb_lower.append(None)
            else:
                window = closes[i - bb_period + 1:i + 1]
                sma = sum(window) / bb_period
                variance = sum((x - sma) ** 2 for x in window) / bb_period
                std = variance ** 0.5
                bb_middle.append({"time": candles[i]["time"], "value": sma})
                bb_upper.append({"time": candles[i]["time"], "value": sma + bb_std * std})
                bb_lower.append({"time": candles[i]["time"], "value": sma - bb_std * std})
        
        lwma_period = 20
        lwma = []
        for i in range(n):
            if i < lwma_period - 1:
                lwma.append(None)
            else:
                window = closes[i - lwma_period + 1:i + 1]
                weights = list(range(1, lwma_period + 1))
                weighted_sum = sum(w * c for w, c in zip(weights, window))
                weight_total = sum(weights)
                lwma.append({"time": candles[i]["time"], "value": weighted_sum / weight_total})
        
        return {
            "bb_upper": [x for x in bb_upper if x],
            "bb_middle": [x for x in bb_middle if x],
            "bb_lower": [x for x in bb_lower if x],
            "lwma": [x for x in lwma if x]
        }


# 싱글톤 인스턴스
indicator_service = IndicatorService()
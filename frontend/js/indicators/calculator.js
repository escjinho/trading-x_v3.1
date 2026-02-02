/* ========================================
   Indicator Calculator
   모든 지표 계산 로직 (프론트엔드)
   ======================================== */

const IndicatorCalculator = {

    // ========== 이동평균 계산 ==========

    /**
     * Simple Moving Average (SMA)
     */
    sma(closes, times, period) {
        const result = [];
        for (let i = 0; i < closes.length; i++) {
            if (i < period - 1) continue;

            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += closes[i - j];
            }
            result.push({
                time: times[i],
                value: sum / period
            });
        }
        return result;
    },

    /**
     * Exponential Moving Average (EMA)
     */
    ema(closes, times, period) {
        const result = [];
        const multiplier = 2 / (period + 1);

        // 첫 EMA는 SMA로 계산
        let sum = 0;
        for (let i = 0; i < period; i++) {
            sum += closes[i];
        }
        let ema = sum / period;

        result.push({
            time: times[period - 1],
            value: ema
        });

        // 이후 EMA 계산
        for (let i = period; i < closes.length; i++) {
            ema = (closes[i] - ema) * multiplier + ema;
            result.push({
                time: times[i],
                value: ema
            });
        }

        return result;
    },

    /**
     * Weighted Moving Average (WMA)
     */
    wma(closes, times, period) {
        const result = [];
        const weightSum = (period * (period + 1)) / 2;

        for (let i = period - 1; i < closes.length; i++) {
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += closes[i - j] * (period - j);
            }
            result.push({
                time: times[i],
                value: sum / weightSum
            });
        }
        return result;
    },

    /**
     * Linear Weighted Moving Average (LWMA)
     * WMA와 동일
     */
    lwma(closes, times, period) {
        return this.wma(closes, times, period);
    },

    // ========== 밴드/채널 지표 ==========

    /**
     * Bollinger Bands
     */
    bollingerBands(closes, times, period, stdDev) {
        const upper = [];
        const middle = [];
        const lower = [];

        for (let i = period - 1; i < closes.length; i++) {
            // SMA 계산
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += closes[i - j];
            }
            const sma = sum / period;

            // 표준편차 계산
            let variance = 0;
            for (let j = 0; j < period; j++) {
                variance += Math.pow(closes[i - j] - sma, 2);
            }
            const std = Math.sqrt(variance / period);

            middle.push({ time: times[i], value: sma });
            upper.push({ time: times[i], value: sma + stdDev * std });
            lower.push({ time: times[i], value: sma - stdDev * std });
        }

        return { upper, middle, lower };
    },

    /**
     * Parabolic SAR (TradingView 공식)
     * 상승: SAR = SAR(prev) + AF × (EP - SAR(prev)), SAR ≤ min(Low[-1], Low[-2])
     * 하락: SAR = SAR(prev) + AF × (EP - SAR(prev)), SAR ≥ max(High[-1], High[-2])
     */
    parabolicSAR(highs, lows, closes, times, params) {
        const { start, increment, maximum } = params;
        const result = [];

        if (highs.length < 2) return result;

        // 초기 트렌드 결정
        let isUpTrend = highs[1] > highs[0];
        let af = start;
        let ep = isUpTrend ? highs[1] : lows[1];
        let sar = isUpTrend ? lows[0] : highs[0];

        // 첫 번째 SAR 값
        result.push({
            time: times[1],
            value: sar,
            color: isUpTrend ? '#00E676' : '#FF5252'
        });

        for (let i = 2; i < closes.length; i++) {
            let newSar = sar + af * (ep - sar);

            if (isUpTrend) {
                // 상승 추세: SAR은 이전 2개 저점 이하로 제한
                newSar = Math.min(newSar, lows[i - 1], lows[i - 2]);

                if (lows[i] < newSar) {
                    // 하락 전환
                    isUpTrend = false;
                    newSar = ep;  // 새 SAR = 이전 EP
                    ep = lows[i];
                    af = start;
                } else {
                    if (highs[i] > ep) {
                        ep = highs[i];
                        af = Math.min(af + increment, maximum);
                    }
                }
            } else {
                // 하락 추세: SAR은 이전 2개 고점 이상으로 제한
                newSar = Math.max(newSar, highs[i - 1], highs[i - 2]);

                if (highs[i] > newSar) {
                    // 상승 전환
                    isUpTrend = true;
                    newSar = ep;  // 새 SAR = 이전 EP
                    ep = highs[i];
                    af = start;
                } else {
                    if (lows[i] < ep) {
                        ep = lows[i];
                        af = Math.min(af + increment, maximum);
                    }
                }
            }

            sar = newSar;
            result.push({
                time: times[i],
                value: sar,
                color: isUpTrend ? '#00E676' : '#FF5252'
            });
        }

        return result;
    },

    /**
     * Ichimoku Cloud (TradingView 공식)
     * Tenkan-sen (전환선) = (9일 최고가 + 9일 최저가) / 2
     * Kijun-sen (기준선) = (26일 최고가 + 26일 최저가) / 2
     * Senkou Span A = (Tenkan + Kijun) / 2, 26일 선행
     * Senkou Span B = (52일 최고가 + 최저가) / 2, 26일 선행
     */
    ichimoku(highs, lows, closes, times, params) {
        const { conversionPeriod, basePeriod, spanPeriod, displacement } = params;

        const conversion = [];
        const base = [];
        const spanA = [];
        const spanB = [];

        // 기간 내 최고/최저 평균 계산
        const getHighLowAvg = (endIndex, period) => {
            const startIndex = Math.max(0, endIndex - period + 1);
            let high = -Infinity;
            let low = Infinity;
            for (let i = startIndex; i <= endIndex; i++) {
                high = Math.max(high, highs[i]);
                low = Math.min(low, lows[i]);
            }
            return (high + low) / 2;
        };

        // 미래 시간 생성 (선행 스팬용)
        const getDisplacedTime = (baseTime, offset) => {
            // 타임프레임에 따라 다르지만, 단순히 인덱스 오프셋 사용
            const baseIndex = times.indexOf(baseTime);
            if (baseIndex + offset < times.length) {
                return times[baseIndex + offset];
            }
            // 미래 시간 추정 (마지막 캔들 간격 기준)
            const lastInterval = times.length > 1 ? times[times.length - 1] - times[times.length - 2] : 60;
            return times[times.length - 1] + lastInterval * (baseIndex + offset - times.length + 1);
        };

        for (let i = 0; i < closes.length; i++) {
            // Conversion Line (Tenkan-sen) - 9일
            if (i >= conversionPeriod - 1) {
                conversion.push({
                    time: times[i],
                    value: getHighLowAvg(i, conversionPeriod)
                });
            }

            // Base Line (Kijun-sen) - 26일
            if (i >= basePeriod - 1) {
                base.push({
                    time: times[i],
                    value: getHighLowAvg(i, basePeriod)
                });
            }
        }

        // Senkou Span A & B (26일 선행 - 미래로 이동)
        for (let i = basePeriod - 1; i < closes.length; i++) {
            const convVal = conversion[i - conversionPeriod + 1]?.value;
            const baseVal = base[i - basePeriod + 1]?.value;

            if (convVal !== undefined && baseVal !== undefined) {
                spanA.push({
                    time: getDisplacedTime(times[i], displacement),
                    value: (convVal + baseVal) / 2
                });
            }
        }

        for (let i = spanPeriod - 1; i < closes.length; i++) {
            spanB.push({
                time: getDisplacedTime(times[i], displacement),
                value: getHighLowAvg(i, spanPeriod)
            });
        }

        return { conversion, base, spanA, spanB };
    },

    /**
     * VWAP (Volume Weighted Average Price) - TradingView 공식
     * VWAP = Σ(Typical Price × Volume) / Σ(Volume)
     * Typical Price = (High + Low + Close) / 3
     *
     * anchorPeriod: 'session'(일별), 'week', 'month' 리셋
     */
    vwap(highs, lows, closes, volumes, times, anchorPeriod = 'session') {
        const result = [];
        let cumulativeTPV = 0;
        let cumulativeVolume = 0;
        let lastResetDate = null;

        const getDateKey = (timestamp, period) => {
            const date = new Date(timestamp * 1000);
            switch (period) {
                case 'week':
                    // 주의 시작일 (일요일 = 0)
                    const dayOfWeek = date.getUTCDay();
                    const weekStart = new Date(date);
                    weekStart.setUTCDate(date.getUTCDate() - dayOfWeek);
                    return `${weekStart.getUTCFullYear()}-W${Math.ceil(weekStart.getUTCDate() / 7)}`;
                case 'month':
                    return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
                case 'session':
                default:
                    return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
            }
        };

        for (let i = 0; i < closes.length; i++) {
            const currentDateKey = getDateKey(times[i], anchorPeriod);

            // 새 세션 시작 시 리셋
            if (lastResetDate !== currentDateKey) {
                cumulativeTPV = 0;
                cumulativeVolume = 0;
                lastResetDate = currentDateKey;
            }

            const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
            const volume = volumes[i] || 0;

            cumulativeTPV += typicalPrice * volume;
            cumulativeVolume += volume;

            if (cumulativeVolume > 0) {
                result.push({
                    time: times[i],
                    value: cumulativeTPV / cumulativeVolume
                });
            }
        }

        return result;
    },

    // ========== 오실레이터 지표 ==========

    /**
     * RSI (Relative Strength Index)
     */
    rsi(closes, times, period) {
        const result = [];
        const gains = [];
        const losses = [];

        for (let i = 1; i < closes.length; i++) {
            const change = closes[i] - closes[i - 1];
            gains.push(change > 0 ? change : 0);
            losses.push(change < 0 ? -change : 0);

            if (i >= period) {
                let avgGain, avgLoss;

                if (i === period) {
                    // 첫 번째 평균
                    avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
                    avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
                } else {
                    // Wilder's smoothing
                    const prevAvgGain = result[result.length - 1]?._avgGain || 0;
                    const prevAvgLoss = result[result.length - 1]?._avgLoss || 0;
                    avgGain = (prevAvgGain * (period - 1) + gains[i - 1]) / period;
                    avgLoss = (prevAvgLoss * (period - 1) + losses[i - 1]) / period;
                }

                const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                const rsi = 100 - (100 / (1 + rs));

                result.push({
                    time: times[i],
                    value: rsi,
                    _avgGain: avgGain,
                    _avgLoss: avgLoss
                });
            }
        }

        return result;
    },

    /**
     * MACD (Moving Average Convergence Divergence)
     */
    macd(closes, times, fastPeriod, slowPeriod, signalPeriod) {
        const fastEMA = this.ema(closes, times, fastPeriod);
        const slowEMA = this.ema(closes, times, slowPeriod);

        const macdLine = [];
        const signalLine = [];
        const histogram = [];

        // MACD Line = Fast EMA - Slow EMA
        const startIndex = slowPeriod - 1;

        for (let i = 0; i < slowEMA.length; i++) {
            const slowVal = slowEMA[i];
            const fastVal = fastEMA.find(f => f.time === slowVal.time);

            if (fastVal) {
                macdLine.push({
                    time: slowVal.time,
                    value: fastVal.value - slowVal.value
                });
            }
        }

        // Signal Line = EMA of MACD
        if (macdLine.length >= signalPeriod) {
            const macdValues = macdLine.map(m => m.value);
            const macdTimes = macdLine.map(m => m.time);
            const signalData = this.ema(macdValues, macdTimes, signalPeriod);

            signalData.forEach(s => signalLine.push(s));

            // Histogram = MACD - Signal
            signalLine.forEach(sig => {
                const macdVal = macdLine.find(m => m.time === sig.time);
                if (macdVal) {
                    histogram.push({
                        time: sig.time,
                        value: macdVal.value - sig.value
                    });
                }
            });
        }

        return { macd: macdLine, signal: signalLine, histogram };
    },

    /**
     * Stochastic Oscillator
     */
    stochastic(highs, lows, closes, times, kPeriod, dPeriod, smooth) {
        const kLine = [];
        const dLine = [];

        // Raw %K
        const rawK = [];
        for (let i = kPeriod - 1; i < closes.length; i++) {
            let highestHigh = -Infinity;
            let lowestLow = Infinity;

            for (let j = 0; j < kPeriod; j++) {
                highestHigh = Math.max(highestHigh, highs[i - j]);
                lowestLow = Math.min(lowestLow, lows[i - j]);
            }

            const range = highestHigh - lowestLow;
            const k = range === 0 ? 50 : ((closes[i] - lowestLow) / range) * 100;

            rawK.push({ time: times[i], value: k });
        }

        // Smoothed %K (SMA of raw %K)
        for (let i = smooth - 1; i < rawK.length; i++) {
            let sum = 0;
            for (let j = 0; j < smooth; j++) {
                sum += rawK[i - j].value;
            }
            kLine.push({
                time: rawK[i].time,
                value: sum / smooth
            });
        }

        // %D (SMA of %K)
        for (let i = dPeriod - 1; i < kLine.length; i++) {
            let sum = 0;
            for (let j = 0; j < dPeriod; j++) {
                sum += kLine[i - j].value;
            }
            dLine.push({
                time: kLine[i].time,
                value: sum / dPeriod
            });
        }

        return { k: kLine, d: dLine };
    },

    /**
     * CCI (Commodity Channel Index)
     */
    cci(highs, lows, closes, times, period) {
        const result = [];

        for (let i = period - 1; i < closes.length; i++) {
            // Typical Price
            const tpList = [];
            for (let j = 0; j < period; j++) {
                const idx = i - j;
                tpList.push((highs[idx] + lows[idx] + closes[idx]) / 3);
            }

            const tp = tpList[0];
            const tpSMA = tpList.reduce((a, b) => a + b, 0) / period;

            // Mean Deviation
            const meanDev = tpList.reduce((a, b) => a + Math.abs(b - tpSMA), 0) / period;

            const cci = meanDev === 0 ? 0 : (tp - tpSMA) / (0.015 * meanDev);

            result.push({
                time: times[i],
                value: cci
            });
        }

        return result;
    },

    /**
     * Williams %R
     */
    williamsR(highs, lows, closes, times, period) {
        const result = [];

        for (let i = period - 1; i < closes.length; i++) {
            let highestHigh = -Infinity;
            let lowestLow = Infinity;

            for (let j = 0; j < period; j++) {
                highestHigh = Math.max(highestHigh, highs[i - j]);
                lowestLow = Math.min(lowestLow, lows[i - j]);
            }

            const range = highestHigh - lowestLow;
            const wr = range === 0 ? -50 : ((highestHigh - closes[i]) / range) * -100;

            result.push({
                time: times[i],
                value: wr
            });
        }

        return result;
    },

    /**
     * ATR (Average True Range)
     */
    atr(highs, lows, closes, times, period) {
        const result = [];
        const trList = [];

        for (let i = 1; i < closes.length; i++) {
            const tr = Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            );
            trList.push(tr);

            if (i >= period) {
                let atr;
                if (i === period) {
                    atr = trList.slice(-period).reduce((a, b) => a + b, 0) / period;
                } else {
                    const prevAtr = result[result.length - 1]?.value || 0;
                    atr = (prevAtr * (period - 1) + tr) / period;
                }

                result.push({
                    time: times[i],
                    value: atr
                });
            }
        }

        return result;
    },

    /**
     * Volume with colors (TradingView 방식)
     * 현재 캔들의 시가/종가 비교 (양봉: 초록, 음봉: 빨강)
     */
    volume(candles, style) {
        const volume = candles.map((c) => {
            // TradingView: 현재 캔들이 양봉이면 초록, 음봉이면 빨강
            const isUp = c.close >= c.open;
            return {
                time: c.time,
                value: c.volume || 0,
                color: isUp ? style.upColor : style.downColor
            };
        });

        return { volume };
    }
};

// 전역 등록
if (typeof window !== 'undefined') {
    window.IndicatorCalculator = IndicatorCalculator;
}

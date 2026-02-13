/* ========================================
   Chart Panel Module
   TradingView Lightweight Charts 렌더링 및 관리
   ======================================== */

const ChartPanel = {
    // 마지막 캔들 데이터 저장
    lastCandleTime: 0,
    lastCandleData: null,

    // ★ 부드러운 가격 보간을 위한 속성
    _animTarget: null,
    _animCurrent: null,
    _animFrameId: null,
    _bidTarget: null,
    _bidCurrent: null,
    _bidAnimFrameId: null,

    /**
     * 차트 패널 초기화
     */
    init() {
        this.initChart();
        this.setupTimeframeButtons();
        this.lastCandleTime = 0;
        this.lastCandleData = null;
        setTimeout(() => this.loadCandles(), 500);  // ★ 초기 차트 캔들 로딩 (WS보다 늦게)
        console.log('[ChartPanel] Initialized');
    },

    /**
     * 안전한 캔들 업데이트 (모든 타임프레임 지원)
     * 현재 캔들의 close 가격을 실시간으로 업데이트하고, high/low도 조정
     * ★ 부드러운 보간 적용
     */
    safeUpdateCandle(candleData) {
        if (!candleData || !chart || !candleSeries || !candleData.close) {
            return false;
        }

        try {
            const newClose = candleData.close;

            // ★ lastCandleData가 없으면 WebSocket 데이터로 초기화
            if (!this.lastCandleData || this.lastCandleTime === 0) {
                if (candleData.time && candleData.open) {
                    this.lastCandleTime = candleData.time;
                    this.lastCandleData = {
                        time: candleData.time,
                        open: candleData.open,
                        high: candleData.high || candleData.open,
                        low: candleData.low || candleData.open,
                        close: newClose || candleData.open
                    };
                    this._animCurrent = newClose;
                    this._animTarget = newClose;
                    console.log('[ChartPanel] lastCandleData initialized from WebSocket');
                }
                return false;
            }

            // ★ high/low는 즉시 반영
            this.lastCandleData.high = Math.max(this.lastCandleData.high, newClose);
            this.lastCandleData.low = Math.min(this.lastCandleData.low, newClose);

            // ★ close는 부드럽게 보간
            this._animTarget = newClose;
            if (this._animCurrent === null) {
                this._animCurrent = newClose;
            }

            // 애니메이션 시작
            if (!this._animFrameId) {
                this._animatePrice();
            }

            return true;
        } catch (e) {
            console.warn('[ChartPanel] Candle update skipped:', e.message);
        }
        return false;
    },

    /**
     * ★ 부드러운 가격 보간 애니메이션
     */
    _animatePrice() {
        if (this._animCurrent === null || this._animTarget === null) {
            this._animFrameId = null;
            return;
        }

        const diff = this._animTarget - this._animCurrent;
        const decimals = typeof getDecimalsForSymbol === 'function' ? getDecimalsForSymbol(chartSymbol) : 2;
        const threshold = Math.pow(10, -decimals);

        // 차이가 작으면 타겟으로 확정
        if (Math.abs(diff) < threshold) {
            this._animCurrent = this._animTarget;
        } else {
            // 부드럽게 이동 (30% 씩 접근)
            this._animCurrent += diff * 0.3;
        }

        // 캔들 업데이트 (★ try-catch로 "Value is null" 에러 방어)
        if (this.lastCandleData && candleSeries && this.lastCandleTime) {
            this.lastCandleData.close = this._animCurrent;
            const updatedCandle = {
                time: this.lastCandleTime,
                open: this.lastCandleData.open,
                high: this.lastCandleData.high,
                low: this.lastCandleData.low,
                close: this._animCurrent
            };

            try {
                if (typeof ChartTypeManager !== 'undefined') {
                    ChartTypeManager.updateLastCandle(updatedCandle);
                } else {
                    candleSeries.update(updatedCandle);
                }
            } catch (e) {
                // lightweight-charts "Value is null" 에러 무시
            }
        }

        // 타겟에 도달하지 않았으면 계속 애니메이션
        if (Math.abs(this._animTarget - this._animCurrent) >= threshold) {
            this._animFrameId = requestAnimationFrame(() => this._animatePrice());
        } else {
            this._animFrameId = null;
        }
    },

    /**
     * 타임프레임 표시 형식 변환 (API → UI)
     */
    getTimeframeDisplay(tf) {
        const displayMap = {
            'M1': '1m', 'M5': '5m', 'M15': '15m', 'M30': '30m',
            'H1': '1H', 'H4': '4H', 'D1': '1D', 'W1': '1W', 'MN1': 'MN'
        };
        return displayMap[tf] || tf;
    },

    /**
     * TradingView Lightweight Chart 초기화
     */
    initChart() {
        const container = document.getElementById('chart-container');
        if (!container) {
            console.warn('[ChartPanel] Chart container not found');
            return;
        }

    // ★ 컨테이너 크기 체크 - 0이면 기본값 사용
    const containerWidth = container.clientWidth || 800;
        const containerHeight = window.innerWidth <= 480 ? 530 : 720;

        console.log('[ChartPanel] Init chart - width:', containerWidth, 'height:', containerHeight);

        const decimals = typeof getDecimalsForSymbol === 'function' ? getDecimalsForSymbol(chartSymbol) : 2;

        chart = LightweightCharts.createChart(container, {
            width: containerWidth,
            height: containerHeight, // 모바일: 500px, PC: 720px
            layout: {
                background: { color: '#000000' },
                textColor: '#b0b0b0'  // 더 밝은 회색
            },
            grid: {
                vertLines: { visible: false },
                horzLines: { visible: false }
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal
            },
            rightPriceScale: {
                borderColor: 'rgba(255,255,255,0.2)',
                borderVisible: false,  // Y축 경계선 제거
                autoScale: true,
                visible: true,
                scaleMargins: { top: 0.1, bottom: 0.2 },
            },
            timeScale: {
                borderColor: 'rgba(255,255,255,0.4)',
                borderVisible: false,    // CSS로 연장 구분선 처리 (#chart-wrapper::after)
                timeVisible: true,
                rightOffset: 5,
                shiftVisibleRangeOnNewBar: true,
                fixRightEdge: false,
                fixLeftEdge: false
            },
            localization: {
                priceFormatter: (price) => price.toFixed(getDecimalsForSymbol(chartSymbol)),
            },
        });

        // ChartTypeManager 초기화 및 시리즈 생성
        if (typeof ChartTypeManager !== 'undefined') {
            ChartTypeManager.init(chart);
            // 차트 스타일 오버라이드 (제로마켓 색상)
            ChartTypeManager.styles.candlestick = {
                upColor: '#00b894',
                downColor: '#dc3545',
                borderUpColor: '#00b894',
                borderDownColor: '#dc3545',
                wickUpColor: '#00b894',
                wickDownColor: '#dc3545',
                priceFormat: {
                    type: 'price',
                    precision: decimals,
                    minMove: decimals === 5 ? 0.00001 : decimals === 3 ? 0.001 : 0.01,
                }
            };
            ChartTypeManager.styles.hollowCandle = {
                upColor: 'transparent',
                downColor: 'transparent',
                borderUpColor: '#00b894',
                borderDownColor: '#dc3545',
                wickUpColor: '#00b894',
                wickDownColor: '#dc3545',
                priceFormat: {
                    type: 'price',
                    precision: decimals,
                    minMove: decimals === 5 ? 0.00001 : decimals === 3 ? 0.001 : 0.01,
                }
            };
            ChartTypeManager.styles.line.priceFormat = {
                type: 'price',
                precision: decimals,
                minMove: decimals === 5 ? 0.00001 : decimals === 3 ? 0.001 : 0.01,
            };
            ChartTypeManager.styles.bar = {
                upColor: '#00b894',
                downColor: '#dc3545',
                openVisible: true,
                thinBars: false,
                priceFormat: {
                    type: 'price',
                    precision: decimals,
                    minMove: decimals === 5 ? 0.00001 : decimals === 3 ? 0.001 : 0.01,
                }
            };
            candleSeries = ChartTypeManager.createSeries();
        } else {
            // ChartTypeManager 없으면 기본 캔들스틱
            candleSeries = chart.addCandlestickSeries({
                upColor: '#00b894',
                downColor: '#dc3545',
                borderUpColor: '#00b894',
                borderDownColor: '#dc3545',
                wickUpColor: '#00b894',
                wickDownColor: '#dc3545',
                priceFormat: {
                    type: 'price',
                    precision: decimals,
                    minMove: decimals === 5 ? 0.00001 : decimals === 3 ? 0.001 : 0.01,
                },
            });
        }

        // 볼린저 밴드 및 LWMA 지표
        bbUpperSeries = chart.addLineSeries({
            color: '#00bfff',
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false
        });
        bbMiddleSeries = chart.addLineSeries({
            color: '#00bfff',
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false
        });
        bbLowerSeries = chart.addLineSeries({
            color: '#00bfff',
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false
        });
        lwmaSeries = chart.addLineSeries({
            color: '#ffff00',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false
        });

        // 반응형 리사이즈
        window.addEventListener('resize', () => {
            if (chart) {
                chart.applyOptions({ width: container.clientWidth });
            }
        });

        // IndicatorManager 초기화
        if (typeof IndicatorManager !== 'undefined') {
            IndicatorManager.init(chart, candleSeries);
            console.log('[ChartPanel] IndicatorManager initialized');
        }
    },

    /**
     * 캔들 데이터 로드
     */
    async loadCandles() {
        // ★ 보간 상태 초기화 (종목/타임프레임 변경 시 늘어남 방지)
        this._animTarget = null;
        this._animCurrent = null;
        this._bidTarget = null;
        this._bidCurrent = null;
        if (this._animFrameId) cancelAnimationFrame(this._animFrameId);
        if (this._bidAnimFrameId) cancelAnimationFrame(this._bidAnimFrameId);
        this._animFrameId = null;
        this._bidAnimFrameId = null;

        try {
            const data = await apiCall(`/mt5/candles/${chartSymbol}?timeframe=${currentTimeframe}&count=1000`);

            if (data && data.candles && data.candles.length > 0) {
                // ChartTypeManager를 통해 데이터 설정
                if (typeof ChartTypeManager !== 'undefined') {
                    ChartTypeManager.setData(data.candles);
                    candleSeries = ChartTypeManager.series;
                } else if (candleSeries) {
                    candleSeries.setData(data.candles);
                }

                // 마지막 캔들 데이터 저장 (실시간 업데이트용)
                const lastCandle = data.candles[data.candles.length - 1];
                this.lastCandleTime = lastCandle.time;
                this.lastCandleData = { ...lastCandle };

                // 기준가격 설정 (첫 번째 캔들의 시가)
                this.referencePrice = data.candles[0].open;

                // 인디케이터 데이터 설정 (★ null 체크 + try-catch)
                if (data.indicators) {
                    try {
                        if (data.indicators.bb_upper && data.indicators.bb_upper.length > 0 && bbUpperSeries) bbUpperSeries.setData(data.indicators.bb_upper);
                        if (data.indicators.bb_middle && data.indicators.bb_middle.length > 0 && bbMiddleSeries) bbMiddleSeries.setData(data.indicators.bb_middle);
                        if (data.indicators.bb_lower && data.indicators.bb_lower.length > 0 && bbLowerSeries) bbLowerSeries.setData(data.indicators.bb_lower);
                        if (data.indicators.lwma && data.indicators.lwma.length > 0 && lwmaSeries) lwmaSeries.setData(data.indicators.lwma);
                    } catch (e) {
                        console.warn('[ChartPanel] 인디케이터 setData 에러 (무시):', e.message);
                    }
                }

                // ★ 보이는 범위 명시적 설정 (최근 150개 캔들)
                const visibleBars = 150;
                if (data.candles.length > visibleBars) {
                    const from = data.candles[data.candles.length - visibleBars].time;
                    const to = data.candles[data.candles.length - 1].time;
                    try {
                        chart.timeScale().setVisibleRange({ from, to });
                    } catch (e) {
                        console.warn('[ChartPanel] setVisibleRange failed, using fitContent:', e.message);
                        chart.timeScale().fitContent();
                    }
                } else {
                    chart.timeScale().fitContent();
                }

                // 마지막 가격 업데이트
                if (data.candles.length > 0) {
                    this.updateChartPrice(data.candles[data.candles.length - 1].close);
                }

                // IndicatorManager에 캔들 데이터 전달
                if (typeof IndicatorManager !== 'undefined') {
                    IndicatorManager.updateCandleData(data.candles);
                }
            }
        } catch (e) {
            console.error('[ChartPanel] 캔들 로드 실패:', e);
        }
    },

    // ★ 인디케이터만 갱신 (차트 리셋 없이 - 번쩍임 방지)
    async loadIndicatorsOnly() {
        try {
            const data = await apiCall(`/mt5/candles/${chartSymbol}?timeframe=${currentTimeframe}&count=100`);
            if (data && data.indicators) {
                // 인디케이터 데이터만 업데이트
                if (data.indicators.bb_upper && bbUpperSeries) bbUpperSeries.setData(data.indicators.bb_upper);
                if (data.indicators.bb_middle && bbMiddleSeries) bbMiddleSeries.setData(data.indicators.bb_middle);
                if (data.indicators.bb_lower && bbLowerSeries) bbLowerSeries.setData(data.indicators.bb_lower);
                if (data.indicators.lwma && lwmaSeries) lwmaSeries.setData(data.indicators.lwma);
            }
        } catch (e) {
            console.error('[ChartPanel] 인디케이터 갱신 실패:', e);
        }
    },

    // 기준가격 (첫 번째 캔들의 시가 또는 이전 종가)
    referencePrice: null,

    /**
     * ★ 부드러운 bid/ask 보간 애니메이션
     */
    _animateBid(decimals, spread) {
        if (this._bidCurrent === null || this._bidTarget === null) {
            this._bidAnimFrameId = null;
            return;
        }

        const diff = this._bidTarget - this._bidCurrent;
        const threshold = Math.pow(10, -decimals);

        // 차이가 작으면 타겟으로 확정
        if (Math.abs(diff) < threshold) {
            this._bidCurrent = this._bidTarget;
        } else {
            // 부드럽게 이동 (30% 씩 접근)
            this._bidCurrent += diff * 0.3;
        }

        // bid/ask 표시 업데이트
        const bidEl = document.getElementById('chartBid');
        const askEl = document.getElementById('chartAsk');
        if (bidEl) bidEl.textContent = this.formatWithComma(this._bidCurrent, decimals);
        if (askEl) askEl.textContent = this.formatWithComma(this._bidCurrent + spread, decimals);

        // 타겟에 도달하지 않았으면 계속 애니메이션
        if (Math.abs(this._bidTarget - this._bidCurrent) >= threshold) {
            this._bidAnimFrameId = requestAnimationFrame(() => this._animateBid(decimals, spread));
        } else {
            this._bidAnimFrameId = null;
        }
    },

    /**
     * 숫자에 천 단위 콤마 추가
     */
    formatWithComma(num, decimals) {
        const parts = num.toFixed(decimals).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return parts.join('.');
    },

    /**
     * 차트 가격 업데이트 (제로마켓 스타일)
     * ★ 부드러운 bid/ask 보간 적용
     */
    updateChartPrice(price) {
        const decimals = getDecimalsForSymbol(chartSymbol);
        const spread = chartSymbol === 'BTCUSD' ? 15 :
                      chartSymbol === 'XAUUSD.r' ? 0.50 : 0.00020;

        // ★ bid 보간 타겟 설정
        this._bidTarget = price;
        if (this._bidCurrent === null) {
            this._bidCurrent = price;
        }

        // 애니메이션 시작
        if (!this._bidAnimFrameId) {
            this._animateBid(decimals, spread);
        }

        // 오버레이 요소들
        const overlaySymbol = document.getElementById('overlaySymbol');
        const overlayTimeframe = document.getElementById('overlayTimeframe');
        const overlayCategory = document.getElementById('overlayCategory');
        const overlayMarketStatus = document.getElementById('overlayMarketStatus');
        const overlayPrice = document.getElementById('overlayPrice');
        const overlayChange = document.getElementById('overlayChange');

        // 심볼 정보 가져오기
        const symbolInfo = typeof getSymbolInfo === 'function' ? getSymbolInfo(chartSymbol) : null;

        // 2줄: 심볼, 타임프레임, 카테고리
        if (overlaySymbol) {
            overlaySymbol.textContent = chartSymbol;
        }
        if (overlayTimeframe && typeof currentTimeframe !== 'undefined') {
            // 버튼과 동일한 형식으로 표시 (1m, 5m, 1H 등)
            overlayTimeframe.textContent = this.getTimeframeDisplay(currentTimeframe);
        }
        if (overlayCategory && symbolInfo) {
            overlayCategory.textContent = symbolInfo.category || 'Currency';
        }

        // 장 운영 상태 (CSS 클래스로 처리)
        if (overlayMarketStatus) {
            const now = new Date();
            const hour = now.getUTCHours();
            // Crypto는 24시간, 나머지는 대략적인 시장 시간
            const isCrypto = symbolInfo && symbolInfo.category === 'Crypto Currency';
            const isMarketOpen = isCrypto || (hour >= 0 && hour < 22); // 대략적인 FX 시간
            overlayMarketStatus.classList.toggle('closed', !isMarketOpen);
        }

        // 1줄: 현재가 (천 단위 콤마)
        if (overlayPrice) {
            overlayPrice.textContent = this.formatWithComma(price, decimals);
        }

        // 변동폭/변동률 계산 (천 단위 콤마)
        if (overlayChange && this.referencePrice) {
            const change = price - this.referencePrice;
            const changePercent = (change / this.referencePrice) * 100;
            const isPositive = change >= 0;
            const color = isPositive ? '#00b894' : '#dc3545';
            const sign = isPositive ? '+' : '';

            const changeFormatted = this.formatWithComma(Math.abs(change), decimals);
            overlayChange.textContent = sign + changeFormatted + ' (' + sign + changePercent.toFixed(2) + '%)';
            overlayChange.style.color = color;
        }
    },

    /**
     * 타임프레임 버튼 설정 (기존 호환 + 드롭다운)
    */
    setupTimeframeButtons() {
        // 기존 버튼 방식 호환
        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentTimeframe = btn.dataset.tf;
                this.loadCandles();
            });
        });
    
        // 드롭다운 외부 클릭 시 닫기
        document.addEventListener('click', (e) => {
            const container = document.querySelector('.timeframe-dropdown-container');
            const dropdown = document.getElementById('tfDropdown');
            const btn = document.getElementById('tfDropdownBtn');
        
            if (container && !container.contains(e.target)) {
                dropdown?.classList.remove('show');
                btn?.classList.remove('open');
            }
        });
    },

    /**
     * 외부에서 데이터 업데이트
     */
    update(data) {
        // 실시간 캔들 업데이트는 connection.js에서 처리
        // 필요 시 추가 로직 구현
    },

    /**
     * 차트 재초기화
     */
    reinit() {
        if (chart) {
            chart.remove();
            chart = null;
        }
        this.initChart();
        this.loadCandles();
    },

    /**
 * 보조지표 설정
 */
setIndicators(settings) {
    console.log('[ChartPanel] Indicator settings:', settings);
    
    // 볼린저 밴드 표시/숨김
    if (bbUpperSeries) {
        bbUpperSeries.applyOptions({ visible: settings.bb });
        bbMiddleSeries.applyOptions({ visible: settings.bb });
        bbLowerSeries.applyOptions({ visible: settings.bb });
    }
    
    // LWMA 표시/숨김
    if (lwmaSeries) {
        lwmaSeries.applyOptions({ visible: settings.lwma });
    }
    
    // EMA (새로 추가 필요 시)
    if (settings.ema && !this.emaSeries) {
        this.emaSeries = chart.addLineSeries({
            color: '#ff6b6b',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false
        });
        // EMA 데이터는 서버에서 받아와야 함 - 임시로 비워둠
    } else if (this.emaSeries) {
        this.emaSeries.applyOptions({ visible: settings.ema });
    }
    
    // SMA (새로 추가 필요 시)
    if (settings.sma && !this.smaSeries) {
        this.smaSeries = chart.addLineSeries({
            color: '#4ecdc4',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false
        });
        // SMA 데이터는 서버에서 받아와야 함 - 임시로 비워둠
    } else if (this.smaSeries) {
        this.smaSeries.applyOptions({ visible: settings.sma });
    }
},

/**
     * 차트 타입 변경
     */
    changeChartType(newType) {
        if (typeof ChartTypeManager !== 'undefined') {
            const changed = ChartTypeManager.changeType(newType);
            if (changed) {
                candleSeries = ChartTypeManager.series;
                console.log('[ChartPanel] Chart type changed to:', newType);

                // 차트 타입 버튼 UI 업데이트
                this.updateChartTypeUI(newType);
            }
            return changed;
        }
        return false;
    },

    /**
     * 차트 타입 UI 업데이트
     */
    updateChartTypeUI(activeType) {
        document.querySelectorAll('.chart-type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === activeType);
        });
    },

    /**
     * 현재 차트 타입 가져오기
     */
    getChartType() {
        if (typeof ChartTypeManager !== 'undefined') {
            return ChartTypeManager.getType();
        }
        return 'candlestick';
    },

/**
 * 패널 정리
 */
destroy() {
        if (chart) {
            chart.remove();
            chart = null;
        }
        console.log('[ChartPanel] Destroyed');
    }
};

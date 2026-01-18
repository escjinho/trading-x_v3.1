/* ========================================
   Chart Panel Module
   TradingView Lightweight Charts 렌더링 및 관리
   ======================================== */

const ChartPanel = {
    /**
     * 차트 패널 초기화
     */
    init() {
        this.initChart();
        this.setupTimeframeButtons();
        console.log('[ChartPanel] Initialized');
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

        const decimals = getDecimalsForSymbol(chartSymbol);

        chart = LightweightCharts.createChart(container, {
            width: container.clientWidth,
            height: 720,
            layout: {
                background: { color: '#0d1421' },
                textColor: '#8899a6'
            },
            grid: {
                vertLines: { color: '#1e2d3d' },
                horzLines: { color: '#1e2d3d' }
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal
            },
            rightPriceScale: {
                borderColor: '#2d3f50',
                autoScale: true,
                visible: true,
                scaleMargins: { top: 0.1, bottom: 0.1 },
            },
            timeScale: {
                borderColor: '#2d3f50',
                timeVisible: true
            },
            localization: {
                priceFormatter: (price) => price.toFixed(getDecimalsForSymbol(chartSymbol)),
            },
        });

        // 캔들스틱 시리즈
        candleSeries = chart.addCandlestickSeries({
            upColor: '#00c853',
            downColor: '#ff5252',
            borderUpColor: '#00c853',
            borderDownColor: '#ff5252',
            wickUpColor: '#00c853',
            wickDownColor: '#ff5252',
            priceFormat: {
                type: 'price',
                precision: decimals,
                minMove: decimals === 5 ? 0.00001 : decimals === 3 ? 0.001 : 0.01,
            },
        });

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
    },

    /**
     * 캔들 데이터 로드
     */
    async loadCandles() {
        try {
            const data = await apiCall(`/mt5/candles/${chartSymbol}?timeframe=${currentTimeframe}&count=200`);

            if (candleSeries && data && data.candles && data.candles.length > 0) {
                // 캔들 데이터 설정
                candleSeries.setData(data.candles);

                // 인디케이터 데이터 설정
                if (data.indicators) {
                    if (data.indicators.bb_upper) bbUpperSeries.setData(data.indicators.bb_upper);
                    if (data.indicators.bb_middle) bbMiddleSeries.setData(data.indicators.bb_middle);
                    if (data.indicators.bb_lower) bbLowerSeries.setData(data.indicators.bb_lower);
                    if (data.indicators.lwma) lwmaSeries.setData(data.indicators.lwma);
                }

                // 보이는 범위 설정 (최근 50개 캔들)
                const visibleBars = 50;
                if (data.candles.length > visibleBars) {
                    const from = data.candles[data.candles.length - visibleBars].time;
                    const to = data.candles[data.candles.length - 1].time;
                    chart.timeScale().setVisibleRange({ from, to });
                }

                // 마지막 가격 업데이트
                if (data.candles.length > 0) {
                    this.updateChartPrice(data.candles[data.candles.length - 1].close);
                }
            }
        } catch (e) {
            console.error('[ChartPanel] 캔들 로드 실패:', e);
        }
    },

    /**
     * 차트 가격 업데이트
     */
    updateChartPrice(price) {
        const decimals = getDecimalsForSymbol(chartSymbol);
        const spread = chartSymbol === 'BTCUSD' ? 15 :
                      chartSymbol === 'XAUUSD.r' ? 0.50 : 0.00020;

        document.getElementById('chartBid').textContent = price.toFixed(decimals);
        document.getElementById('chartAsk').textContent = (price + spread).toFixed(decimals);
    },

    /**
     * 타임프레임 버튼 설정
     */
    setupTimeframeButtons() {
        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentTimeframe = btn.dataset.tf;
                this.loadCandles();
            });
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

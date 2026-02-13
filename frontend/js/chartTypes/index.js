/* ========================================
   Chart Type Manager
   차트 종류 선택 및 변경 관리
   ======================================== */

const ChartTypeManager = {
    // 지원하는 차트 타입
    TYPES: {
        CANDLESTICK: 'candlestick',
        LINE: 'line',
        HOLLOW_CANDLE: 'hollowCandle',
        BAR: 'bar'
    },

    // 현재 차트 타입
    currentType: 'candlestick',

    // 차트 및 시리즈 참조
    chart: null,
    series: null,
    candleData: [],

    // 차트 스타일 설정
    styles: {
        candlestick: {
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderUpColor: '#26a69a',
            borderDownColor: '#ef5350',
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350'
        },
        hollowCandle: {
            upColor: 'transparent',
            downColor: 'transparent',
            borderUpColor: '#26a69a',
            borderDownColor: '#ef5350',
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350'
        },
        line: {
            color: '#2196F3',
            lineWidth: 2,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4
        },
        bar: {
            upColor: '#26a69a',
            downColor: '#ef5350',
            openVisible: true,
            thinBars: false
        }
    },

    /**
     * 초기화
     */
    init(chart) {
        this.chart = chart;
        this.loadSavedType();
        console.log('[ChartTypeManager] Initialized with type:', this.currentType);
    },

    /**
     * 저장된 차트 타입 로드
     */
    loadSavedType() {
        const saved = localStorage.getItem('chart_type');
        if (saved && Object.values(this.TYPES).includes(saved)) {
            this.currentType = saved;
        }
    },

    /**
     * 차트 타입 저장
     */
    saveType() {
        localStorage.setItem('chart_type', this.currentType);
    },

    /**
     * 현재 차트 타입 가져오기
     */
    getType() {
        return this.currentType;
    },

    /**
     * 차트 타입 변경
     */
    changeType(newType) {
        if (!Object.values(this.TYPES).includes(newType)) {
            console.warn('[ChartTypeManager] Unknown chart type:', newType);
            return false;
        }

        if (this.currentType === newType) {
            return false;
        }

        console.log('[ChartTypeManager] Changing type:', this.currentType, '->', newType);
        this.currentType = newType;
        this.saveType();

        // 시리즈 재생성
        if (this.chart && this.candleData.length > 0) {
            this.recreateSeries();
        }

        return true;
    },

    /**
     * 시리즈 생성
     */
    createSeries() {
        if (!this.chart) {
            console.warn('[ChartTypeManager] Chart not initialized');
            return null;
        }

        const type = this.currentType;
        let series = null;

        switch (type) {
            case this.TYPES.CANDLESTICK:
                series = this.chart.addCandlestickSeries(this.styles.candlestick);
                break;

            case this.TYPES.HOLLOW_CANDLE:
                series = this.chart.addCandlestickSeries(this.styles.hollowCandle);
                break;

            case this.TYPES.LINE:
                series = this.chart.addLineSeries(this.styles.line);
                break;

            case this.TYPES.BAR:
                series = this.chart.addBarSeries(this.styles.bar);
                break;

            default:
                series = this.chart.addCandlestickSeries(this.styles.candlestick);
        }

        this.series = series;
        console.log('[ChartTypeManager] Series created for type:', type);
        return series;
    },

    /**
     * 시리즈 재생성 (타입 변경 시)
     */
    recreateSeries() {
        if (!this.chart) return null;

        // 기존 시리즈 제거
        if (this.series) {
            try {
                this.chart.removeSeries(this.series);
            } catch (e) {
                console.warn('[ChartTypeManager] Failed to remove series:', e.message);
            }
        }

        // 새 시리즈 생성
        const newSeries = this.createSeries();

        // 데이터 적용
        if (newSeries && this.candleData.length > 0) {
            const formattedData = this.formatDataForType(this.candleData);
            newSeries.setData(formattedData);
        }

        // IndicatorManager에 새 시리즈 알림
        if (typeof IndicatorManager !== 'undefined') {
            IndicatorManager.mainSeries = newSeries;
            IndicatorManager.recalculateAll();
        }

        return newSeries;
    },

    /**
     * 차트 타입에 맞게 데이터 포맷
     */
    formatDataForType(candles) {
        const type = this.currentType;

        if (type === this.TYPES.LINE) {
            // 라인 차트는 종가만 사용
            return candles.map(c => ({
                time: c.time,
                value: c.close
            }));
        }

        // 캔들스틱, Hollow Candle, Bar는 OHLC 사용
        return candles.map(c => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
        }));
    },

    /**
     * 캔들 데이터 설정
     */
    setData(candles) {
        this.candleData = candles;

        if (this.series) {
            const formattedData = this.formatDataForType(candles);
            this.series.setData(formattedData);
        }
    },

    /**
     * 실시간 캔들 업데이트
     */
    updateLastCandle(candle) {
        if (!this.series || !candle) return;

        try {
            // candleData 업데이트
            if (this.candleData.length > 0) {
                const lastIndex = this.candleData.length - 1;
                if (this.candleData[lastIndex].time === candle.time) {
                    this.candleData[lastIndex] = candle;
                } else {
                    this.candleData.push(candle);
                }
            }

            // 시리즈 업데이트
            const type = this.currentType;

            if (type === this.TYPES.LINE) {
                this.series.update({
                    time: candle.time,
                    value: candle.close
                });
            } else {
                this.series.update({
                    time: candle.time,
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close
                });
            }
        } catch (e) {
            // lightweight-charts "Value is null" 무시
        }
    },

    /**
     * 차트 타입 이름 가져오기 (UI용)
     */
    getTypeName(type) {
        const names = {
            candlestick: '캔들',
            line: '라인',
            hollowCandle: '할로우 캔들',
            bar: 'OHLC 바'
        };
        return names[type] || type;
    },

    /**
     * 모든 타입 목록 가져오기
     */
    getAllTypes() {
        return Object.values(this.TYPES).map(type => ({
            id: type,
            name: this.getTypeName(type),
            active: type === this.currentType
        }));
    }
};

// 전역 등록
if (typeof window !== 'undefined') {
    window.ChartTypeManager = ChartTypeManager;
}

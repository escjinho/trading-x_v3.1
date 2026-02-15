/* ========================================
   Indicator Manager
   지표 등록/해제/토글 및 레이아웃 관리
   ======================================== */

const IndicatorManager = {
    // 활성 지표 인스턴스 저장
    activeIndicators: {},

    // 패널 차트 인스턴스
    panelCharts: {},

    // 캔들 데이터 캐시
    candleData: [],

    // 메인 차트 참조
    mainChart: null,
    mainSeries: null,

    // 시간축 동기화 플래그 (무한 루프 방지)
    isSyncingTimeScale: false,

    // 저장된 시간 범위 (패널 삭제 시 복원용)
    savedVisibleRange: null,

    /**
     * 초기화
     */
    init(chart, candleSeries) {
        console.log('[IndicatorManager] init called, chart:', chart ? 'OK' : 'NULL');

        this.mainChart = chart;
        this.mainSeries = candleSeries;

        // 메인 차트 시간축 동기화 설정
        this.setupMainChartTimeSync();

        // 저장된 설정 로드
        IndicatorConfig.load();

        console.log('[IndicatorManager] Initialized successfully');
    },

    /**
     * 메인 차트 시간축 동기화 설정
     */
    setupMainChartTimeSync() {
        if (!this.mainChart) {
            console.warn('[IndicatorManager] setupMainChartTimeSync: mainChart is null');
            return;
        }

        console.log('[IndicatorManager] Setting up main chart time sync');

        this.mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (this.isSyncingTimeScale || !range) return;

            const panelCount = Object.keys(this.panelCharts).length;
            if (panelCount === 0) return;

            this.isSyncingTimeScale = true;

            // 모든 패널 차트에 시간 범위 적용
            Object.entries(this.panelCharts).forEach(([id, panelChart]) => {
                try {
                    panelChart.timeScale().setVisibleLogicalRange(range);
                } catch (e) {
                    console.warn(`[IndicatorManager] Failed to sync panel ${id}:`, e.message);
                }
            });

            this.isSyncingTimeScale = false;
        });

        console.log('[IndicatorManager] Main chart time sync ready');
    },

    /**
     * 저장된 활성 지표 복원
     */
    restoreSavedIndicators() {
        const enabledIndicators = IndicatorConfig.getEnabled();
        console.log('[IndicatorManager] Restoring saved indicators:', enabledIndicators.map(i => i.id));

        enabledIndicators.forEach(config => {
            // 이미 활성화된 지표는 건너뛰기
            if (!this.activeIndicators[config.id]) {
                this.addIndicator(config.id);
                // 모달 체크박스 동기화
                this.syncModalCheckbox(config.id, true);
            }
        });

        // 레이아웃 업데이트
        this.updateLayout();
    },

    /**
     * 캔들 데이터 업데이트
     */
    updateCandleData(candles) {
        this.candleData = candles;

        // 처음 캔들 데이터 로드 시 저장된 지표 복원
        if (Object.keys(this.activeIndicators).length === 0) {
            this.restoreSavedIndicators();
        }

        // 모든 활성 지표 재계산
        this.recalculateAll();
    },

    /**
     * 실시간 캔들 업데이트
     */
    updateLastCandle(candle) {
        if (this.candleData.length === 0) return;

        const lastIndex = this.candleData.length - 1;
        if (this.candleData[lastIndex].time === candle.time) {
            this.candleData[lastIndex] = candle;
        } else {
            this.candleData.push(candle);
        }

        // 오버레이 지표만 실시간 업데이트 (성능)
        this.updateOverlayIndicators();
    },

    /**
     * 지표 토글 (활성화/비활성화)
     */
    toggle(indicatorId) {
        // ID 정규화
        const normalizedId = IndicatorConfig.normalizeId(indicatorId);
        const config = IndicatorConfig.get(normalizedId);
        if (!config) {
            console.warn(`[IndicatorManager] Unknown indicator: ${normalizedId}`);
            return false;
        }

        // 패널 지표 최대 개수 체크
        if (config.type === 'panel' && !config.enabled) {
            const panelCount = IndicatorConfig.getEnabledPanelCount();
            if (panelCount >= IndicatorConfig.layout.panelMaxCount) {
                console.warn('[IndicatorManager] Max panel count reached');
                this.showToast(`최대 ${IndicatorConfig.layout.panelMaxCount}개 패널만 추가 가능합니다`);
                return false;
            }
        }

        config.enabled = !config.enabled;

        // 패널 삭제 시 현재 시간 범위 저장
        if (!config.enabled && this.mainChart) {
            try {
                this.savedVisibleRange = this.mainChart.timeScale().getVisibleLogicalRange();
            } catch (e) {
                this.savedVisibleRange = null;
            }
        }

        if (config.enabled) {
            this.addIndicator(normalizedId);
        } else {
            this.removeIndicator(normalizedId);
        }

        // 모달 체크박스 동기화
        this.syncModalCheckbox(indicatorId, config.enabled);

        // 설정 저장
        IndicatorConfig.save();

        // 레이아웃 업데이트 (DOM 렌더링 후 실행되도록 지연)
        requestAnimationFrame(() => {
            this.updateLayout();
            // DOM 완전 반영 후 한번 더 리사이즈
            setTimeout(() => this.updateLayout(), 150);
        });

        // 패널 카운트 업데이트
        if (typeof updatePanelCount === 'function') {
            updatePanelCount();
        }

        return config.enabled;
    },

    /**
     * 모달 체크박스 동기화
     */
    syncModalCheckbox(indicatorId, enabled) {
        // 모달 ID 가져오기 (정규화된 ID → 모달 ID)
        const modalId = IndicatorConfig.getModalId(indicatorId);

        const item = document.querySelector(`.ind-item[data-ind="${modalId}"]`);
        if (item) {
            const checkbox = item.querySelector('.ind-checkbox');
            if (checkbox) {
                if (enabled) {
                    checkbox.classList.add('checked');
                } else {
                    checkbox.classList.remove('checked');
                }
            }
        }
    },

    /**
     * 지표 추가
     */
    addIndicator(indicatorId) {
        // ID 정규화
        const normalizedId = IndicatorConfig.normalizeId(indicatorId);
        const config = IndicatorConfig.get(normalizedId);
        if (!config) {
            console.warn(`[IndicatorManager] Unknown indicator: ${indicatorId}`);
            return;
        }

        console.log(`[IndicatorManager] Adding indicator: ${normalizedId}`);

        // enabled 상태 설정
        config.enabled = true;

        if (config.type === 'overlay') {
            this.addOverlayIndicator(normalizedId, config);
        } else if (config.type === 'panel') {
            this.addPanelIndicator(normalizedId, config);
        }
    },

    /**
     * 지표 제거
     */
    removeIndicator(indicatorId) {
        // ID 정규화
        const normalizedId = IndicatorConfig.normalizeId(indicatorId);
        const indicator = this.activeIndicators[normalizedId];
        if (!indicator) return;

        console.log(`[IndicatorManager] Removing indicator: ${normalizedId}`);

        const config = IndicatorConfig.get(normalizedId);

        if (config.type === 'overlay') {
            this.removeOverlayIndicator(normalizedId);
        } else if (config.type === 'panel') {
            this.removePanelIndicator(normalizedId);
        }

        delete this.activeIndicators[normalizedId];
    },

    /**
     * 모든 지표 제거
     */
    removeAll() {
        console.log('[IndicatorManager] Removing all indicators');
        const ids = Object.keys(this.activeIndicators);
        ids.forEach(id => {
            this.removeIndicator(id);
        });

        // IndicatorConfig의 enabled 상태도 초기화
        Object.values(IndicatorConfig.overlay).forEach(ind => ind.enabled = false);
        Object.values(IndicatorConfig.panel).forEach(ind => ind.enabled = false);

        // 메인 차트 높이 복원
        this.restoreMainChartHeight();
    },

    /**
     * 메인 차트 높이를 원래 크기로 복원
     */
    restoreMainChartHeight() {
        const _h = document.querySelector('.header');
        const _s = document.querySelector('.chart-symbol-row');
        const totalHeight = Math.max(window.innerHeight - (_h?_h.offsetHeight:45) - (_s?_s.offsetHeight:40) - 127, 300);

        // ★ 패널 높이를 빼서 메인 차트 높이 계산
        const panelsEl = document.getElementById('indicator-panels');
        const panelHeight = panelsEl ? panelsEl.offsetHeight : 0;
        const targetHeight = totalHeight - panelHeight;

        console.log('[IndicatorManager] Restoring main chart height to ' + targetHeight + 'px (total:' + totalHeight + ' panels:' + panelHeight + ')');

        const container = document.getElementById('chart-container');
        if (container) {
            container.style.height = targetHeight + 'px';
        }
        const wrapper = document.getElementById('chart-wrapper');
        if (wrapper) {
            wrapper.className = '';
            wrapper.style.height = totalHeight + 'px';
        }

        if (this.mainChart && container) {
            const containerWidth = container.clientWidth;

            this.mainChart.applyOptions({
                height: targetHeight,
                width: containerWidth,
                timeScale: {
                    visible: true,
                    borderVisible: false
                }
            });

            // resize() 강제 호출
            this.mainChart.resize(containerWidth, targetHeight);

            console.log(`[IndicatorManager] Chart resized to ${containerWidth}x${targetHeight}`);

            // 4. 약간의 딜레이 후 한번 더 resize (DOM 반영 보장)
            setTimeout(() => {
                if (this.mainChart && container) {
                    this.mainChart.resize(container.clientWidth, targetHeight);
                    this.mainChart.timeScale().scrollToRealTime();
                    console.log('[IndicatorManager] Chart resize confirmed');
                }
            }, 50);
        }

        console.log('[IndicatorManager] Main chart height restored');
    },

    /**
     * 오버레이 지표 추가
     */
    addOverlayIndicator(indicatorId, config) {
        if (!this.mainChart) {
            console.warn('[IndicatorManager] mainChart not initialized, cannot add overlay:', indicatorId);
            return;
        }

        const indicator = {
            id: indicatorId,
            config: config,
            series: []
        };

        // 지표별 시리즈 생성
        switch (indicatorId) {
            case 'sma':
            case 'ema':
            case 'wma':
            case 'lwma':
                indicator.series.push(this.mainChart.addLineSeries({
                    color: config.style.color,
                    lineWidth: config.style.lineWidth,
                    lineStyle: config.style.lineStyle,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false
                }));
                break;

            case 'bb':
                // Upper band
                indicator.series.push(this.mainChart.addLineSeries({
                    color: config.style.upperColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: false
                }));
                // Middle band (dashed)
                indicator.series.push(this.mainChart.addLineSeries({
                    color: config.style.middleColor,
                    lineWidth: config.style.lineWidth,
                    lineStyle: config.style.middleLineStyle,
                    priceLineVisible: false,
                    lastValueVisible: false
                }));
                // Lower band
                indicator.series.push(this.mainChart.addLineSeries({
                    color: config.style.lowerColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: false
                }));
                break;

            case 'psar':
                indicator.series.push(this.mainChart.addLineSeries({
                    color: config.style.upColor,
                    lineWidth: 0,
                    pointMarkersVisible: true,
                    pointMarkersRadius: config.style.size,
                    priceLineVisible: false,
                    lastValueVisible: false
                }));
                break;

            case 'vwap':
                indicator.series.push(this.mainChart.addLineSeries({
                    color: config.style.color,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: false
                }));
                break;

            case 'ichimoku':
                // Conversion Line (Tenkan-sen)
                indicator.series.push(this.mainChart.addLineSeries({
                    color: config.style.conversionColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: false
                }));
                // Base Line (Kijun-sen)
                indicator.series.push(this.mainChart.addLineSeries({
                    color: config.style.baseColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: false
                }));
                // Leading Span A (Senkou Span A)
                indicator.series.push(this.mainChart.addLineSeries({
                    color: config.style.spanAColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: false
                }));
                // Leading Span B (Senkou Span B)
                indicator.series.push(this.mainChart.addLineSeries({
                    color: config.style.spanBColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: false
                }));
                break;
        }

        this.activeIndicators[indicatorId] = indicator;

        // 데이터 계산 및 설정
        this.calculateOverlayIndicator(indicatorId);
    },

    /**
     * 오버레이 지표 제거
     */
    removeOverlayIndicator(indicatorId) {
        const indicator = this.activeIndicators[indicatorId];
        if (!indicator || !this.mainChart) return;

        indicator.series.forEach(series => {
            try {
                this.mainChart.removeSeries(series);
            } catch (e) {
                console.warn(`[IndicatorManager] Failed to remove series:`, e);
            }
        });
    },

    /**
     * 패널 지표 추가
     */
    addPanelIndicator(indicatorId, config) {
        const panelsContainer = document.getElementById('indicator-panels');
        if (!panelsContainer) {
            console.warn('[IndicatorManager] Panels container not found');
            return;
        }

        // 패널 DOM 생성
        const panelEl = document.createElement('div');
        panelEl.id = `panel-${indicatorId}`;
        panelEl.className = 'indicator-panel';
        panelEl.innerHTML = `
            <div class="indicator-panel-header">
                <div class="indicator-panel-title">
                    <span class="color-dot" style="background: ${config.style.lineColor || config.style.macdColor || '#fff'}"></span>
                    <span>${config.name}</span>
                </div>
                <button class="indicator-panel-close" onclick="IndicatorManager.toggle('${indicatorId}')">&times;</button>
            </div>
            <div class="indicator-panel-chart" id="panel-chart-${indicatorId}"></div>
        `;
        panelsContainer.appendChild(panelEl);

        // 차트 생성 (시간축은 나중에 updateTimeScaleVisibility에서 관리)
        const chartContainer = document.getElementById(`panel-chart-${indicatorId}`);
        const panelChart = LightweightCharts.createChart(chartContainer, {
            width: chartContainer.clientWidth,
            height: config.panelHeight || 80,
            layout: {
                background: { color: '#000000' },
                textColor: '#808080'
            },
            grid: {
                vertLines: { visible: false },
                horzLines: { color: 'rgba(255, 255, 255, 0.05)', style: 1 }
            },
            rightPriceScale: {
                borderVisible: false,
                scaleMargins: { top: 0.15, bottom: 0.1 },
                textColor: 'rgba(255, 255, 255, 0.5)'
            },
            timeScale: {
                visible: false,
                borderVisible: false,
                timeVisible: true,
                rightOffset: 5
            },
            crosshair: {
                horzLine: { visible: false },
                vertLine: { visible: true, color: 'rgba(255, 255, 255, 0.2)', style: 2 }
            }
        });

        // 패널 차트 → 메인 차트 및 다른 패널 동기화
        panelChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (this.isSyncingTimeScale || !range) return;

            this.isSyncingTimeScale = true;

            // 메인 차트에 적용
            if (this.mainChart) {
                try {
                    this.mainChart.timeScale().setVisibleLogicalRange(range);
                } catch (e) {
                    // 무시
                }
            }

            // 다른 패널 차트에도 적용
            Object.entries(this.panelCharts).forEach(([id, chart]) => {
                if (chart !== panelChart) {
                    try {
                        chart.timeScale().setVisibleLogicalRange(range);
                    } catch (e) {
                        // 무시
                    }
                }
            });

            this.isSyncingTimeScale = false;
        });

        // 초기 시간 범위 동기화 (메인 차트 범위 적용)
        if (this.mainChart) {
            try {
                const mainRange = this.mainChart.timeScale().getVisibleLogicalRange();
                if (mainRange) {
                    panelChart.timeScale().setVisibleLogicalRange(mainRange);
                }
            } catch (e) {
                // 무시
            }
        }

        const indicator = {
            id: indicatorId,
            config: config,
            chart: panelChart,
            series: [],
            referenceLines: [],  // 기준선 시리즈 저장
            element: panelEl
        };

        // 지표별 시리즈 생성
        switch (indicatorId) {
            case 'rsi':
                // 기준선 추가 (70, 30, 50)
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, 70, 'rgba(255, 82, 82, 0.5)', 1));
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, 30, 'rgba(76, 175, 80, 0.5)', 1));
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, 50, 'rgba(255, 255, 255, 0.2)', 1, 2));
                // RSI 라인
                indicator.series.push(panelChart.addLineSeries({
                    color: config.style.lineColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: true
                }));
                break;

            case 'cci':
                // 기준선 추가 (+100, -100, 0)
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, 100, 'rgba(255, 82, 82, 0.5)', 1));
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, -100, 'rgba(76, 175, 80, 0.5)', 1));
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, 0, 'rgba(255, 255, 255, 0.2)', 1, 2));
                // CCI 라인
                indicator.series.push(panelChart.addLineSeries({
                    color: config.style.lineColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: true
                }));
                break;

            case 'williamsR':
                // 기준선 추가 (-20, -80, -50)
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, -20, 'rgba(255, 82, 82, 0.5)', 1));
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, -80, 'rgba(76, 175, 80, 0.5)', 1));
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, -50, 'rgba(255, 255, 255, 0.2)', 1, 2));
                // Williams %R 라인
                indicator.series.push(panelChart.addLineSeries({
                    color: config.style.lineColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: true
                }));
                break;

            case 'atr':
                indicator.series.push(panelChart.addLineSeries({
                    color: config.style.lineColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: true
                }));
                break;

            case 'macd':
                // 0 기준선
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, 0, 'rgba(255, 255, 255, 0.3)', 1, 2));
                // Histogram
                indicator.series.push(panelChart.addHistogramSeries({
                    color: config.style.histogramUpColor,
                    priceLineVisible: false,
                    lastValueVisible: false
                }));
                // MACD Line
                indicator.series.push(panelChart.addLineSeries({
                    color: config.style.macdColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: true
                }));
                // Signal Line
                indicator.series.push(panelChart.addLineSeries({
                    color: config.style.signalColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: true
                }));
                break;

            case 'stochastic':
                // 기준선 추가 (80, 20, 50)
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, 80, 'rgba(255, 82, 82, 0.5)', 1));
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, 20, 'rgba(76, 175, 80, 0.5)', 1));
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, 50, 'rgba(255, 255, 255, 0.2)', 1, 2));
                // %K Line
                indicator.series.push(panelChart.addLineSeries({
                    color: config.style.kColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: true
                }));
                // %D Line
                indicator.series.push(panelChart.addLineSeries({
                    color: config.style.dColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: true
                }));
                break;

            case 'volume':
                indicator.series.push(panelChart.addHistogramSeries({
                    color: config.style.upColor,
                    priceLineVisible: false,
                    lastValueVisible: true,
                    priceFormat: { type: 'volume' }
                }));
                if (config.params.maEnabled) {
                    indicator.series.push(panelChart.addLineSeries({
                        color: config.style.maColor,
                        lineWidth: config.style.maLineWidth,
                        priceLineVisible: false,
                        lastValueVisible: false
                    }));
                }
                break;

            case 'mfi':
                // 기준선 추가 (80, 20, 50)
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, 80, 'rgba(255, 82, 82, 0.5)', 1));
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, 20, 'rgba(76, 175, 80, 0.5)', 1));
                indicator.referenceLines.push(this.addPanelReferenceLine(panelChart, 50, 'rgba(255, 255, 255, 0.2)', 1, 2));
                // MFI 라인
                indicator.series.push(panelChart.addLineSeries({
                    color: config.style.lineColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: true
                }));
                break;

            case 'adx':
                // ADX 라인
                indicator.series.push(panelChart.addLineSeries({
                    color: config.style.lineColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: true
                }));
                break;

            case 'obv':
                // OBV 라인
                indicator.series.push(panelChart.addLineSeries({
                    color: config.style.lineColor,
                    lineWidth: config.style.lineWidth,
                    priceLineVisible: false,
                    lastValueVisible: true
                }));
                break;
        }

        this.activeIndicators[indicatorId] = indicator;
        this.panelCharts[indicatorId] = panelChart;

        // 데이터 계산 및 설정
        this.calculatePanelIndicator(indicatorId);

        // 메인 차트 시간 범위를 패널에 즉시 동기화
        if (this.mainChart) {
            try {
                const mainRange = this.mainChart.timeScale().getVisibleLogicalRange();
                if (mainRange) {
                    panelChart.timeScale().setVisibleLogicalRange(mainRange);
                    console.log(`[IndicatorManager] Panel ${indicatorId} synced to main chart range`);
                }
            } catch (e) {
                console.warn(`[IndicatorManager] Failed to sync panel ${indicatorId}:`, e.message);
            }
        }
    },

    /**
     * 패널 차트에 수평 기준선 추가 (TradingView 스타일)
     * @param {object} chart - Lightweight Charts 인스턴스
     * @param {number} value - 기준선 값
     * @param {string} color - 선 색상
     * @param {number} lineWidth - 선 두께
     * @param {number} lineStyle - 선 스타일 (0: solid, 1: dotted, 2: dashed)
     */
    addPanelReferenceLine(chart, value, color, lineWidth = 1, lineStyle = 2) {
        const series = chart.addLineSeries({
            color: color,
            lineWidth: lineWidth,
            lineStyle: lineStyle,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            autoscaleInfoProvider: () => ({
                priceRange: { minValue: value, maxValue: value }
            })
        });

        // 기준선 데이터는 calculatePanelIndicator에서 설정
        // 여기서는 시리즈만 생성
        series._isReferenceLine = true;
        series._referenceValue = value;

        return series;
    },

    /**
     * 패널 지표 제거
     */
    removePanelIndicator(indicatorId) {
        const indicator = this.activeIndicators[indicatorId];
        if (!indicator) return;

        // 차트 제거
        if (this.panelCharts[indicatorId]) {
            this.panelCharts[indicatorId].remove();
            delete this.panelCharts[indicatorId];
        }

        // DOM 제거
        if (indicator.element) {
            indicator.element.remove();
        }
    },

    /**
     * 오버레이 지표 계산
     */
    calculateOverlayIndicator(indicatorId) {
        const indicator = this.activeIndicators[indicatorId];
        if (!indicator || this.candleData.length === 0) return;

        const config = indicator.config;
        const closes = this.candleData.map(c => c.close);
        const highs = this.candleData.map(c => c.high);
        const lows = this.candleData.map(c => c.low);
        const times = this.candleData.map(c => c.time);

        let data;

        switch (indicatorId) {
            case 'sma':
                data = IndicatorCalculator.sma(closes, times, config.params.period);
                indicator.series[0].setData(data);
                break;

            case 'ema':
                data = IndicatorCalculator.ema(closes, times, config.params.period);
                indicator.series[0].setData(data);
                break;

            case 'wma':
                data = IndicatorCalculator.wma(closes, times, config.params.period);
                indicator.series[0].setData(data);
                break;

            case 'lwma':
                data = IndicatorCalculator.lwma(closes, times, config.params.period);
                indicator.series[0].setData(data);
                break;

            case 'bb':
                data = IndicatorCalculator.bollingerBands(closes, times, config.params.period, config.params.stdDev);
                indicator.series[0].setData(data.upper);
                indicator.series[1].setData(data.middle);
                indicator.series[2].setData(data.lower);
                break;

            case 'psar':
                data = IndicatorCalculator.parabolicSAR(highs, lows, closes, times, config.params);
                indicator.series[0].setData(data);
                break;

            case 'vwap':
                const volumes = this.candleData.map(c => c.volume || 0);
                const anchorPeriod = config.params.anchorPeriod || 'session';
                data = IndicatorCalculator.vwap(highs, lows, closes, volumes, times, anchorPeriod);
                indicator.series[0].setData(data);
                break;

            case 'ichimoku':
                data = IndicatorCalculator.ichimoku(highs, lows, closes, times, config.params);
                indicator.series[0].setData(data.conversion);
                indicator.series[1].setData(data.base);
                indicator.series[2].setData(data.spanA);
                indicator.series[3].setData(data.spanB);
                break;
        }
    },

    /**
     * 패널 지표 계산
     */
    calculatePanelIndicator(indicatorId) {
        const indicator = this.activeIndicators[indicatorId];
        if (!indicator || this.candleData.length === 0) return;

        const config = indicator.config;
        const closes = this.candleData.map(c => c.close);
        const highs = this.candleData.map(c => c.high);
        const lows = this.candleData.map(c => c.low);
        const volumes = this.candleData.map(c => c.volume || 0);
        const times = this.candleData.map(c => c.time);

        // 디버깅: 메인 캔들 데이터 정보
        console.log(`[calculatePanelIndicator] ${indicatorId}`);
        console.log('  Main candle count:', this.candleData.length);
        console.log('  Main candle first time:', times[0]);
        console.log('  Main candle last time:', times[times.length - 1]);

        let data;

        switch (indicatorId) {
            case 'rsi':
                data = IndicatorCalculator.rsi(closes, times, config.params.period);
                indicator.series[0].setData(data);
                break;

            case 'macd':
                data = IndicatorCalculator.macd(closes, times, config.params.fastPeriod, config.params.slowPeriod, config.params.signalPeriod);
                // Histogram with colors
                const histogram = data.histogram.map(h => ({
                    time: h.time,
                    value: h.value,
                    color: h.value >= 0 ? config.style.histogramUpColor : config.style.histogramDownColor
                }));
                indicator.series[0].setData(histogram);
                indicator.series[1].setData(data.macd);
                indicator.series[2].setData(data.signal);
                break;

            case 'stochastic':
                data = IndicatorCalculator.stochastic(highs, lows, closes, times, config.params.kPeriod, config.params.dPeriod, config.params.smooth);
                indicator.series[0].setData(data.k);
                indicator.series[1].setData(data.d);
                break;

            case 'volume':
                data = IndicatorCalculator.volume(this.candleData, config.style);
                indicator.series[0].setData(data.volume);
                if (config.params.maEnabled && indicator.series[1]) {
                    const volumeMA = IndicatorCalculator.sma(volumes, times, config.params.maPeriod);
                    indicator.series[1].setData(volumeMA);
                }
                break;

            case 'atr':
                data = IndicatorCalculator.atr(highs, lows, closes, times, config.params.period);
                indicator.series[0].setData(data);
                break;

            case 'cci':
                data = IndicatorCalculator.cci(highs, lows, closes, times, config.params.period);
                indicator.series[0].setData(data);
                break;

            case 'williamsR':
                data = IndicatorCalculator.williamsR(highs, lows, closes, times, config.params.period);
                indicator.series[0].setData(data);
                break;

            case 'mfi':
                data = IndicatorCalculator.mfi(highs, lows, closes, volumes, times, config.params.period);
                indicator.series[0].setData(data);
                break;

            case 'adx':
                data = IndicatorCalculator.adx(highs, lows, closes, times, config.params.period);
                indicator.series[0].setData(data);
                break;

            case 'obv':
                data = IndicatorCalculator.obv(closes, volumes, times);
                indicator.series[0].setData(data);
                break;
        }

        // 디버깅: 패널 데이터 정보
        if (data) {
            const panelData = Array.isArray(data) ? data : (data.k || data.macd || data.volume || []);
            console.log('  Panel data count:', panelData.length);
            console.log('  Panel data first time:', panelData[0]?.time);
            console.log('  Panel data last time:', panelData[panelData.length - 1]?.time);
            console.log('  Time diff (candle - panel):', this.candleData.length - panelData.length);
        }

        // 기준선 시리즈 업데이트 (캔들 시간 범위에 맞춤)
        this.updatePanelReferenceLines(indicatorId);

        // 패널 차트 시간 범위를 메인 차트와 동기화
        const panelChart = this.panelCharts[indicatorId];
        if (panelChart && this.mainChart) {
            try {
                const mainRange = this.mainChart.timeScale().getVisibleLogicalRange();
                if (mainRange) {
                    panelChart.timeScale().setVisibleLogicalRange(mainRange);
                }
            } catch (e) {
                // 무시
            }
        }
    },

    /**
     * 패널 기준선 시리즈 업데이트
     */
    updatePanelReferenceLines(indicatorId) {
        const indicator = this.activeIndicators[indicatorId];
        if (!indicator || !indicator.referenceLines || this.candleData.length === 0) return;

        const times = this.candleData.map(c => c.time);
        const firstTime = times[0];
        const lastTime = times[times.length - 1];

        // 기준선 시리즈에 데이터 설정
        indicator.referenceLines.forEach(series => {
            if (series && series._referenceValue !== undefined) {
                try {
                    series.setData([
                        { time: firstTime, value: series._referenceValue },
                        { time: lastTime, value: series._referenceValue }
                    ]);
                } catch (e) {
                    // 무시
                }
            }
        });
    },

    /**
     * 모든 활성 지표 재계산
     */
    recalculateAll() {
        Object.keys(this.activeIndicators).forEach(id => {
            const config = IndicatorConfig.get(id);
            if (config.type === 'overlay') {
                this.calculateOverlayIndicator(id);
            } else {
                this.calculatePanelIndicator(id);
            }
        });
    },

    /**
     * 오버레이 지표만 업데이트 (실시간용)
     */
    updateOverlayIndicators() {
        Object.keys(this.activeIndicators).forEach(id => {
            const config = IndicatorConfig.get(id);
            if (config && config.type === 'overlay') {
                this.calculateOverlayIndicator(id);
            }
        });
    },

    /**
     * 레이아웃 업데이트 (차트 높이 조정 + 시간축 관리)
     */
    updateLayout() {
        const _h2 = document.querySelector('.header');
        const _s2 = document.querySelector('.chart-symbol-row');
        const totalHeight = Math.max(window.innerHeight - (_h2?_h2.offsetHeight:45) - (_s2?_s2.offsetHeight:40) - 127, 300);

        const panelCount = IndicatorConfig.getEnabledPanelCount();

        // 패널 높이 설정 (마지막 패널은 시간축 공간 추가)
        const basePanelHeight = IndicatorConfig.layout.panelHeight || 80;
        const lastPanelHeight = IndicatorConfig.layout.lastPanelHeight || 100;

        // 패널 총 높이 계산
        const panelIds = Object.keys(this.panelCharts);
        let totalPanelHeight = 0;
        panelIds.forEach((id, index) => {
            const isLast = index === panelIds.length - 1;
            totalPanelHeight += isLast ? lastPanelHeight : basePanelHeight;
        });

        // 메인 차트 높이 계산
        const mainChartHeight = Math.max(
            IndicatorConfig.layout.mainChartMinHeight,
            totalHeight - totalPanelHeight
        );

        if (this.mainChart) {
            const container = document.getElementById('chart-container');
            if (container) {
                // ★ container 높이를 차트 높이와 동일하게 명시 (공백 방지)
                container.style.height = mainChartHeight + 'px';
                this.mainChart.applyOptions({
                    height: mainChartHeight,
                    timeScale: {
                        visible: panelCount === 0,
                        borderVisible: false
                    }
                });
                // flex 레이아웃 계산 후 실제 높이로 resize
                requestAnimationFrame(() => {
                    const actualH = container.clientHeight || mainChartHeight;
                    this.mainChart.resize(container.clientWidth, actualH);
                });
            }
            // chart-wrapper 높이 고정
            const wrapper = document.getElementById('chart-wrapper');
            if (wrapper) {
                wrapper.style.height = totalHeight + 'px';
            }
        }

        // 패널 차트 리사이즈 및 시간축 관리
        panelIds.forEach((id, index) => {
            const chart = this.panelCharts[id];
            const container = document.getElementById(`panel-chart-${id}`);
            const isLast = index === panelIds.length - 1;
            const height = isLast ? lastPanelHeight : basePanelHeight;

            if (container && chart) {
                chart.applyOptions({
                    width: container.clientWidth,
                    height: height,
                    timeScale: {
                        visible: isLast, // 마지막 패널에만 시간축 표시
                        borderVisible: false,
                        timeVisible: true
                    }
                });
            }
        });

        // chart-wrapper 클래스 업데이트 + 높이 고정
        const wrapper = document.getElementById('chart-wrapper');
        if (wrapper) {
            wrapper.className = `panels-${panelCount}`;
            wrapper.style.height = totalHeight + 'px';
        }

        // 차트 강제 리사이즈 (초기화 후 즉시 반영)
        this.forceChartResize();

        // ★ 메인 차트 즉시 리사이즈 (보조지표 추가 시 갭 방지)
        setTimeout(() => {
            const _ct = document.getElementById('chart-container');
            if (this.mainChart && _ct) {
                const _h = parseInt(_ct.style.height) || mainChartHeight;
                this.mainChart.resize(_ct.clientWidth, _h);
            }
            // 패널 차트도 강제 리사이즈
            Object.keys(this.panelCharts).forEach(id => {
                const pc = this.panelCharts[id];
                const pe = document.getElementById('panel-chart-' + id);
                if (pc && pe) pc.resize(pe.clientWidth, pe.clientHeight);
            });
        }, 100);

        console.log(`[IndicatorManager] Layout updated - Main: ${mainChartHeight}px, Panels: ${panelCount}`);
    },

    /**
     * 차트 강제 리사이즈 (크기 즉시 반영)
     */
    forceChartResize() {
        // 메인 차트 리사이즈 (width + height 모두)
        if (this.mainChart) {
            const container = document.getElementById('chart-container');
            if (container) {
                requestAnimationFrame(() => {
                    const h = container.clientHeight || 400;
                    const w = container.clientWidth;
                    this.mainChart.resize(w, h);
                });

                // 저장된 시간 범위가 있으면 복원, 없으면 현재 위치 유지
                if (this.savedVisibleRange) {
                    try {
                        this.mainChart.timeScale().setVisibleLogicalRange(this.savedVisibleRange);
                    } catch (e) {
                        this.mainChart.timeScale().scrollToRealTime();
                    }
                    this.savedVisibleRange = null;
                }
            }
        }

        // 패널 차트 리사이즈 (width + height 모두)
        Object.keys(this.panelCharts).forEach(id => {
            const chart = this.panelCharts[id];
            const container = document.getElementById(`panel-chart-${id}`);
            if (container && chart) {
                chart.resize(container.clientWidth, container.clientHeight || 80);
            }
        });

        // 시간축 동기화 (메인 차트 → 패널)
        this.syncTimeScaleToAllPanels();
    },

    /**
     * 메인 차트 시간 범위를 모든 패널에 동기화
     */
    syncTimeScaleToAllPanels() {
        if (!this.mainChart) return;

        const panelCount = Object.keys(this.panelCharts).length;
        if (panelCount === 0) return;

        try {
            const range = this.mainChart.timeScale().getVisibleLogicalRange();
            if (!range) return;

            console.log(`[IndicatorManager] Syncing time scale to ${panelCount} panels`);

            this.isSyncingTimeScale = true;

            Object.entries(this.panelCharts).forEach(([id, panelChart]) => {
                try {
                    panelChart.timeScale().setVisibleLogicalRange(range);
                } catch (e) {
                    // 무시
                }
            });

            this.isSyncingTimeScale = false;
        } catch (e) {
            console.warn('[IndicatorManager] syncTimeScaleToAllPanels error:', e.message);
        }
    },

    /**
     * 토스트 메시지 표시
     */
    showToast(message) {
        if (typeof showToast === 'function') {
            showToast(message, '');
        } else {
            console.log('[Toast]', message);
        }
    },

    /**
     * 윈도우 리사이즈 핸들러
     */
    handleResize() {
        this.updateLayout();

        // 패널 차트도 리사이즈
        Object.keys(this.panelCharts).forEach(id => {
            const container = document.getElementById(`panel-chart-${id}`);
            if (container && this.panelCharts[id]) {
                this.panelCharts[id].applyOptions({
                    width: container.clientWidth
                });
            }
        });
    },

    /**
     * 정리
     */
    destroy() {
        // 모든 지표 제거
        Object.keys(this.activeIndicators).forEach(id => {
            this.removeIndicator(id);
        });

        this.activeIndicators = {};
        this.panelCharts = {};
        this.candleData = [];
        this.mainChart = null;
        this.mainSeries = null;

        console.log('[IndicatorManager] Destroyed');
    }
};

// 전역 등록
if (typeof window !== 'undefined') {
    window.IndicatorManager = IndicatorManager;

    // 리사이즈 이벤트 등록
    window.addEventListener('resize', () => {
        IndicatorManager.handleResize();
    });
}

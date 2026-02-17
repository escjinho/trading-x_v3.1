/**
 * Quick & Easy — Tick Chart (Area Chart)
 * lightweight-charts + MetaAPI 실시간 틱
 */

const QeTickChart = {
    chart: null,
    areaSeries: null,
    tickData: [],
    maxTicks: 80,           // 화면에 보이는 최대 포인트
    lastPrice: 0,
    openPrice: 0,           // 당일 시가 (등락 계산용)
    prevPrice: 0,           // 보간용
    targetPrice: 0,
    animFrameId: null,
    animating: false,
    priceLine: null,         // 진입가격 라인
    initialized: false,

    // 종목별 카테고리
    CATEGORIES: {
        'BTCUSD': 'Crypto Currency',
        'ETHUSD': 'Crypto Currency',
        'EURUSD.r': 'Forex',
        'USDJPY.r': 'Forex',
        'GBPUSD.r': 'Forex',
        'AUDUSD.r': 'Forex',
        'USDCAD.r': 'Forex',
        'XAUUSD.r': 'Commodities',
        'US100.': 'Indices'
    },

    // 종목별 소수점
    DECIMALS: {
        'BTCUSD': 2,
        'ETHUSD': 2,
        'EURUSD.r': 5,
        'USDJPY.r': 3,
        'GBPUSD.r': 5,
        'XAUUSD.r': 2,
        'US100.': 2
    },

    init() {
        if (this.initialized) return;
        const container = document.getElementById('qeChartContainer');
        if (!container || typeof LightweightCharts === 'undefined') {
            console.warn('[QeTickChart] container 또는 LightweightCharts 없음');
            return;
        }

        this.chart = LightweightCharts.createChart(container, {
            layout: {
                background: { type: 'solid', color: '#0a0a0f' },
                textColor: 'rgba(255, 255, 255, 0.4)',
                fontSize: 10
            },
            grid: {
                vertLines: { color: 'transparent' },
                horzLines: { color: 'transparent' }
            },
            rightPriceScale: {
                borderColor: 'rgba(255, 255, 255, 0.06)',
                scaleMargins: { top: 0.1, bottom: 0.1 },
                minimumWidth: 80
            },
            timeScale: {
                borderColor: 'rgba(255, 255, 255, 0.06)',
                timeVisible: true,
                secondsVisible: true,
                rightOffset: 6,
                fixLeftEdge: false,
                fixRightEdge: false
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: { color: 'rgba(255, 255, 255, 0.15)', width: 1, style: 2 },
                horzLine: { color: 'rgba(255, 255, 255, 0.15)', width: 1, style: 2 }
            },
            handleScroll: false,
            handleScale: false
        });

        this.areaSeries = this.chart.addAreaSeries({
            topColor: 'rgba(0, 210, 255, 0.25)',
            bottomColor: 'rgba(0, 210, 255, 0.02)',
            lineColor: '#00d2ff',
            lineWidth: 2,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
            crosshairMarkerBorderColor: '#00d2ff',
            crosshairMarkerBackgroundColor: '#0a0a0f',
            priceFormat: {
                type: 'price',
                precision: this.getDecimals(),
                minMove: Math.pow(10, -this.getDecimals())
            }
        });

        // 리사이즈 대응
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.resize(), 300);
        });

        this.initialized = true;
        console.log('[QeTickChart] 초기화 완료');
    },

    getDecimals() {
        const symbol = window.currentSymbol || 'BTCUSD';
        return this.DECIMALS[symbol] || 2;
    },

    // ========== 틱 데이터 추가 (보간 애니메이션) ==========
    addTick(price) {
        if (!this.areaSeries || price <= 0) return;

        // 첫 틱이면 openPrice 설정
        if (this.openPrice === 0) {
            this.openPrice = price;
        }

        this.prevPrice = this.lastPrice || price;
        this.targetPrice = price;

        // 보간 시작
        if (!this.animating) {
            this.animating = true;
            this.interpolate();
        }

        // 호가 업데이트 (즉시)
        this.updateQuote(price);
        this.updateColor(price);
    },

    // ========== 60fps 보간 애니메이션 ==========
    interpolate() {
        if (!this.areaSeries) { this.animating = false; return; }

        const diff = this.targetPrice - (this.lastPrice || this.targetPrice);
        const step = diff * 0.08;  // 이징: 30%씩 접근

        if (Math.abs(diff) < 0.001) {
            // 도착 — 최종값 적용
            this.lastPrice = this.targetPrice;
            this.commitTick(this.targetPrice);
            this.animating = false;
            return;
        }

        this.lastPrice = (this.lastPrice || this.targetPrice) + step;
        this.commitTick(this.lastPrice);

        this.animFrameId = requestAnimationFrame(() => this.interpolate());
    },

    // ========== 차트에 실제 데이터 반영 ==========
    commitTick(price) {
        const now = Math.floor(Date.now() / 1000);

        this.tickData.push({ time: now, value: price });

        this.areaSeries.update({ time: now, value: price });

        // 최대 틱 수 유지
        if (this.tickData.length > this.maxTicks * 2) {
            this.tickData = this.tickData.slice(-this.maxTicks);
        }

        // 펄스 마커 위치 업데이트
        this.updatePulse(now, price);
    },

    // ========== 현재가 펄스 마커 ==========
    updatePulse(time, price) {
        const marker = document.getElementById('qePulseMarker');
        if (!marker || !this.chart || !this.areaSeries) return;

        try {
            const timeCoord = this.chart.timeScale().timeToCoordinate(time);
            const priceCoord = this.areaSeries.priceToCoordinate(price);

            if (timeCoord !== null && priceCoord !== null && timeCoord > 0 && priceCoord > 0) {
                marker.style.display = 'block';
                marker.style.left = timeCoord + 'px';
                marker.style.top = priceCoord + 'px';
            }
        } catch (e) {
            // 좌표 변환 실패 시 무시
        }
    },

    // ========== 호가 영역 업데이트 ==========
    updateQuote(price) {
        const symbol = window.currentSymbol || 'BTCUSD';
        const decimals = this.getDecimals();

        // 현재가
        const priceEl = document.getElementById('qeQuotePrice');
        if (priceEl) {
            priceEl.textContent = price.toLocaleString('en-US', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            });
        }

        // 등락
        if (this.openPrice > 0) {
            const change = price - this.openPrice;
            const changePct = (change / this.openPrice) * 100;
            const sign = change >= 0 ? '+' : '';
            const isNeg = change < 0;

            const changeEl = document.getElementById('qeChangeValue');
            const pctEl = document.getElementById('qeChangePct');
            if (changeEl) {
                changeEl.textContent = sign + change.toFixed(decimals);
                changeEl.className = 'qe-change-value' + (isNeg ? ' negative' : '');
            }
            if (pctEl) {
                pctEl.textContent = '(' + sign + changePct.toFixed(2) + '%)';
                pctEl.className = 'qe-change-pct' + (isNeg ? ' negative' : '');
            }
        }

        // 종목 정보
        const symbolEl = document.getElementById('qeInfoSymbol');
        const catEl = document.getElementById('qeInfoCategory');
        if (symbolEl) symbolEl.textContent = symbol.replace('.r', '').replace('.', '');
        if (catEl) catEl.textContent = this.CATEGORIES[symbol] || 'Market';
    },

    // ========== 색상 (항상 초록) ==========
    updateColor(price) {
        // 항상 초록색 유지
    },

    // ========== 진입가격 라인 ==========
    showEntryLine(price, side) {
        this.removeEntryLine();
        if (!this.areaSeries) return;

        const color = side === 'buy' ? '#00d4a4' : '#ff4d5a';
        const label = side === 'buy' ? '● BUY' : '● SELL';

        this.priceLine = this.areaSeries.createPriceLine({
            price: price,
            color: color,
            lineWidth: 1,
            lineStyle: 2,  // 점선
            axisLabelVisible: true,
            title: label
        });
    },

    removeEntryLine() {
        if (this.priceLine && this.areaSeries) {
            this.areaSeries.removePriceLine(this.priceLine);
            this.priceLine = null;
        }
    },

    // ========== 종목 변경 시 리셋 ==========
    reset() {
        this.tickData = [];
        this.lastPrice = 0;
        this.openPrice = 0;
        this.prevPrice = 0;
        this.targetPrice = 0;
        this.removeEntryLine();

        if (this.areaSeries) {
            // 시리즈 데이터 클리어
            this.areaSeries.setData([]);

            // 소수점 업데이트
            this.areaSeries.applyOptions({
                priceFormat: {
                    type: 'price',
                    precision: this.getDecimals(),
                    minMove: Math.pow(10, -this.getDecimals())
                }
            });
        }

        // 호가 초기화
        const priceEl = document.getElementById('qeQuotePrice');
        const changeEl = document.getElementById('qeChangeValue');
        const pctEl = document.getElementById('qeChangePct');
        if (priceEl) priceEl.textContent = '0.00';
        if (changeEl) { changeEl.textContent = '+0.00'; changeEl.className = 'qe-change-value'; }
        if (pctEl) { pctEl.textContent = '(0.00%)'; pctEl.className = 'qe-change-pct'; }

        console.log('[QeTickChart] 리셋 완료');
    },

    // ========== 리사이즈 ==========
    resize() {
        const container = document.getElementById('qeChartContainer');
        const wrap = document.getElementById('qeChartWrap');
        if (!this.chart || !container || !wrap) return;

        // wrap의 실제 렌더링 높이 사용 (CSS flex가 계산한 값)
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;

        if (w > 0 && h > 0) {
            this.chart.applyOptions({ width: w, height: h });
        }
    },

    destroy() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }
        if (this.chart) {
            this.chart.remove();
            this.chart = null;
        }
        this.areaSeries = null;
        this.initialized = false;
    }
};

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
    tpPriceLine: null,       // TP 라인
    slPriceLine: null,       // SL 라인
    _autoReturnTimer: null,  // 자동복귀 타이머
    _userInteracting: false, // 사용자 조작 중
    _customPriceRange: null, // 줌아웃 시 커스텀 가격 범위 (플래그)
    initialized: false,
    _loadingHistory: false,  // 히스토리 로딩 중 플래그
    _progressCanvas: null,   // SL/TP 진행도 바 캔버스
    _entryData: null,        // { price, side, tp, sl }
    _entryOverlay: null,     // ◉ BUY/SELL 커스텀 라벨
    _tpOverlay: null,        // Win 커스텀 라벨
    _slOverlay: null,        // Lose 커스텀 라벨

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
                fontSize: 9
            },
            grid: {
                vertLines: { color: 'transparent' },
                horzLines: { color: 'transparent' }
            },
            rightPriceScale: {
                borderColor: 'rgba(255, 255, 255, 0.06)',
                scaleMargins: { top: 0.1, bottom: 0.1 },
                minimumWidth: 100
            },
            timeScale: {
                borderColor: 'rgba(255, 255, 255, 0.06)',
                timeVisible: true,
                secondsVisible: true,
                rightOffset: 8,
                fixLeftEdge: false,
                fixRightEdge: false
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: { color: 'rgba(255, 255, 255, 0.15)', width: 1, style: 2 },
                horzLine: { color: 'rgba(255, 255, 255, 0.15)', width: 1, style: 2 }
            },
            handleScroll: true,
            handleScale: true
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
            },
            // ★ 한 번만 설정, 절대 제거/교체 안 함 (3.8.0 안정성)
            autoscaleInfoProvider: (baseImpl) => {
                if (this._customPriceRange) {
                    return { priceRange: this._customPriceRange };
                }
                return baseImpl ? baseImpl() : null;
            }
        });

        // 사용자 조작 감지 → 5초 후 자동 현재가 복귀
        this.chart.timeScale().subscribeVisibleTimeRangeChange(() => {
            if (this._entryOverlay) this.updateEntryOverlay();
            if (this._entryData) this.drawProgressBars();
            if (this._userInteracting) return;
            this._userInteracting = true;
            if (this._autoReturnTimer) clearTimeout(this._autoReturnTimer);
            this._autoReturnTimer = setTimeout(() => {
                this._userInteracting = false;
                this.resetChartView();
            }, 5000);
        });

        // ★ requestAnimationFrame 루프로 오버레이/진행바 실시간 추적
        this._rafTrackingId = null;
        const trackOverlays = () => {
            if (this._entryOverlay) this.updateEntryOverlay();
            if (this._entryData) this.drawProgressBars();
            // 포지션 있을 때만 루프 유지
            if (this._entryOverlay || this._entryData) {
                this._rafTrackingId = requestAnimationFrame(trackOverlays);
            } else {
                this._rafTrackingId = null;
            }
        };
        // 포지션 생성 시 루프 시작을 위한 메서드
        this._startTracking = () => {
            if (!this._rafTrackingId) {
                this._rafTrackingId = requestAnimationFrame(trackOverlays);
            }
        };

        // 터치/마우스 조작 감지
        container.addEventListener('touchstart', () => {
            this._userInteracting = true;
            if (this._autoReturnTimer) clearTimeout(this._autoReturnTimer);
        }, { passive: true });
        container.addEventListener('touchend', () => {
            this._autoReturnTimer = setTimeout(() => {
                this._userInteracting = false;
                this.resetChartView();
            }, 5000);
        }, { passive: true });
        container.addEventListener('mouseup', () => {
            if (this._autoReturnTimer) clearTimeout(this._autoReturnTimer);
            this._autoReturnTimer = setTimeout(() => {
                this._userInteracting = false;
                this.resetChartView();
            }, 5000);
        });

        // 리사이즈 대응
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.resize(), 300);
        });

        this.initialized = true;
        console.log('[QeTickChart] 초기화 완료');

        // ★ 초기 히스토리 로딩 (차트 빈 화면 방지)
        this.loadInitialHistory().then(() => {
            // ★ pending 진입 라인이 있으면 히스토리 로딩 후 그리기
            if (this._pendingEntryLine) {
                const p = this._pendingEntryLine;
                console.log('[QeTickChart] ★ pending 라인 그리기:', p);
                this.showEntryLine(p.price, p.side, p.tp, p.sl);
                this._pendingEntryLine = null;
            }
        });
    },

    async loadInitialHistory() {
        this._loadingHistory = true;
        // ★ 안전장치: 5초 후 강제 해제 (API 지연/실패 대비)
        this._loadingTimeout = setTimeout(() => {
            if (this._loadingHistory) {
                console.warn('[QeTickChart] ⚠️ 히스토리 로딩 타임아웃 → 강제 해제');
                this._loadingHistory = false;
            }
        }, 5000);
        const symbol = window.currentSymbol || 'BTCUSD';
        const KST_OFFSET = 9 * 3600;
        try {
            if (typeof apiCall !== 'function') return;
            const data = await apiCall('/mt5/candles/' + symbol + '?timeframe=M1&count=10');
            if (data && data.candles && data.candles.length > 0) {
                const historyTicks = [];
                const candles = data.candles.slice(-10);
                candles.forEach(c => {
                    // 각 캔들의 open, high, low, close를 4개 틱으로 분해
                    const baseTime = c.time + KST_OFFSET;
                    historyTicks.push({ time: baseTime, value: c.open });
                    historyTicks.push({ time: baseTime + 15, value: c.high });
                    historyTicks.push({ time: baseTime + 30, value: c.low });
                    historyTicks.push({ time: baseTime + 45, value: c.close });
                });
                // 시간순 정렬 + 중복 제거
                historyTicks.sort((a, b) => a.time - b.time);
                const unique = [];
                let lastTime = 0;
                historyTicks.forEach(t => {
                    if (t.time > lastTime) {
                        unique.push(t);
                        lastTime = t.time;
                    }
                });
                if (unique.length > 0 && this.areaSeries) {
                    this.areaSeries.setData(unique);
                    this.tickData = unique;
                    this.lastPrice = unique[unique.length - 1].value;
                    this.openPrice = unique[0].value;
                    this.prevPrice = this.lastPrice;
                    this._lastHistoryTime = unique[unique.length - 1].time; // ★ 히스토리 마지막 시간 기록
                    console.log('[QeTickChart] ★ 초기 히스토리 로딩:', unique.length, '틱');
                    // ★ 5초 후 최근 구간으로 줌인
                    setTimeout(() => {
                        if (this.chart && this.tickData.length > 0) {
                            const totalBars = this.tickData.length;
                            const visibleBars = Math.min(40, totalBars);
                            this.chart.timeScale().setVisibleLogicalRange({
                                from: totalBars - visibleBars,
                                to: totalBars + 5
                            });
                        }
                    }, 5000);
                }
            }
        } catch (e) {
            console.warn('[QeTickChart] 히스토리 로딩 실패:', e);
        } finally {
            this._loadingHistory = false;
            if (this._loadingTimeout) {
                clearTimeout(this._loadingTimeout);
                this._loadingTimeout = null;
            }
        }
    },

    getDecimals() {
        const symbol = window.currentSymbol || 'BTCUSD';
        return this.DECIMALS[symbol] || 2;
    },

    // ========== 틱 데이터 추가 (보간 애니메이션) ==========
    addTick(price) {
        if (!this.areaSeries || price <= 0) return;
        if (this._loadingHistory) return; // 히스토리 로딩 중 무시

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

        // Win/Lose 실시간 업데이트 (틱마다, 깜빡임 없음)
        if (typeof QuickEasyPanel !== 'undefined' && QuickEasyPanel._posEntryPrice > 0) {
            QuickEasyPanel.updateWinLose();
        }
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
        const now = Math.floor(Date.now() / 1000) + 9 * 3600; // KST 표시

        // ★ 시간 역전/중복 방지: 마지막보다 작거나 같으면 update만 (새 포인트 추가 안 함)
        if (this.tickData.length > 0) {
            const lastTime = this.tickData[this.tickData.length - 1].time;
            if (now <= lastTime) {
                // 같은 초: 가격만 업데이트
                this.tickData[this.tickData.length - 1].value = price;
                this.areaSeries.update({ time: lastTime, value: price });
                this.updatePulse(lastTime, price);
                if (this._entryData) this.drawProgressBars();
                return;
            }
        }

        this.tickData.push({ time: now, value: price });

        this.areaSeries.update({ time: now, value: price });

        // 최대 틱 수 유지
        if (this.tickData.length > this.maxTicks * 2) {
            this.tickData = this.tickData.slice(-this.maxTicks);
        }

        // 펄스 마커 위치 업데이트
        this.updatePulse(now, price);

        // ★ 진입가 오버레이 위치 업데이트
        if (this._entryOverlay) this.updateEntryOverlay();

        // ★ SL/TP 진행도 바 업데이트
        if (this._entryData) this.drawProgressBars();
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

    // ========== 진입가격 + SL/TP 라인 ==========
    showEntryLine(price, side, tpPrice, slPrice) {
        this.removeEntryLine();
        if (!this.areaSeries) return;

        const sideColor = side === 'buy' ? '#00d4a4' : '#ff4d5a';
        const label = side === 'buy' ? '◉ BUY' : '◉ SELL';

        // 진입가 점선 (호가 박스 제거)
        this.priceLine = this.areaSeries.createPriceLine({
            price: price,
            color: sideColor,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: false,
            title: ''
        });

        // ★ 커스텀 ◉ BUY/SELL 오버레이
        if (this._entryOverlay) this._entryOverlay.remove();
        const wrap = document.getElementById('qeChartWrap');
        if (wrap) {
            const ov = document.createElement('div');
            ov.className = 'qe-entry-overlay';
            ov.innerHTML = '<span class="qe-entry-dot" style="color:' + sideColor + '">◉</span> <span class="qe-entry-label">' + (side === 'buy' ? 'BUY' : 'SELL') + '</span>';
            ov.style.cssText = 'position:absolute;right:80px;pointer-events:none;z-index:6;' +
                'font-size:9px;font-weight:700;letter-spacing:0.5px;' +
                'color:' + sideColor + ';' +
                'background:rgba(10,10,15,0.7);padding:1px 5px;border-radius:3px;' +
                'white-space:nowrap;transform:translateY(-50%);';
            wrap.appendChild(ov);
            this._entryOverlay = ov;
            this._entryOverlayPrice = price;
            this.updateEntryOverlay();
        }

        // TP 라인 (라벨 숨김 → 커스텀 오버레이)
        if (tpPrice && tpPrice > 0) {
            this.tpPriceLine = this.areaSeries.createPriceLine({
                price: tpPrice,
                color: '#00d4a4',
                lineWidth: 1,
                lineStyle: 0,
                axisLabelVisible: false,
                title: ''
            });
            // ★ Win 커스텀 오버레이
            if (this._tpOverlay) this._tpOverlay.remove();
            if (wrap) {
                const tpOv = document.createElement('div');
                tpOv.className = 'qe-tp-overlay';
                tpOv.innerHTML = '<span style="font-size:7px;margin-right:2px;">▲</span>Win';
                tpOv.style.cssText = 'position:absolute;right:4px;pointer-events:none;z-index:6;' +
                    'font-size:8px;font-weight:700;letter-spacing:0.3px;' +
                    'color:#00d4a4;' +
                    'background:rgba(0,212,164,0.12);border:1px solid rgba(0,212,164,0.4);' +
                    'padding:1px 6px;border-radius:3px;' +
                    'min-width:32px;text-align:center;' +
                    'white-space:nowrap;transform:translateY(-50%);';
                wrap.appendChild(tpOv);
                this._tpOverlay = tpOv;
                this._tpOverlayPrice = tpPrice;
            }
        }

        // SL 라인 (라벨 숨김 → 커스텀 오버레이)
        if (slPrice && slPrice > 0) {
            this.slPriceLine = this.areaSeries.createPriceLine({
                price: slPrice,
                color: '#ff4d5a',
                lineWidth: 1,
                lineStyle: 0,
                axisLabelVisible: false,
                title: ''
            });
            // ★ Lose 커스텀 오버레이
            if (this._slOverlay) this._slOverlay.remove();
            if (wrap) {
                const slOv = document.createElement('div');
                slOv.className = 'qe-sl-overlay';
                slOv.innerHTML = '<span style="font-size:7px;margin-right:2px;">▼</span>Lose';
                slOv.style.cssText = 'position:absolute;right:4px;pointer-events:none;z-index:6;' +
                    'font-size:8px;font-weight:700;letter-spacing:0.3px;' +
                    'color:#ff4d5a;' +
                    'background:rgba(255,77,90,0.12);border:1px solid rgba(255,77,90,0.4);' +
                    'padding:1px 6px;border-radius:3px;' +
                    'min-width:32px;text-align:center;' +
                    'white-space:nowrap;transform:translateY(-50%);';
                wrap.appendChild(slOv);
                this._slOverlay = slOv;
                this._slOverlayPrice = slPrice;
            }
        }

        // 진입 시 줌아웃 연출: SL/TP 전체 보이도록
        if (tpPrice && slPrice) {
            this.zoomToShowTPSL(price, tpPrice, slPrice);
        }

        // ★ SL/TP 진행도 바 시작
        this._entryData = { price, side, tp: tpPrice, sl: slPrice };
        this.initProgressCanvas();
        this.drawProgressBars();

        // ★ rAF 트래킹 루프 시작
        if (this._startTracking) this._startTracking();
    },

    removeEntryLine() {
        if (this.priceLine && this.areaSeries) {
            this.areaSeries.removePriceLine(this.priceLine);
            this.priceLine = null;
        }
        if (this.tpPriceLine && this.areaSeries) {
            this.areaSeries.removePriceLine(this.tpPriceLine);
            this.tpPriceLine = null;
        }
        if (this.slPriceLine && this.areaSeries) {
            this.areaSeries.removePriceLine(this.slPriceLine);
            this.slPriceLine = null;
        }
        // ★ 오버레이 제거 + 트래킹 중지
        if (this._rafTrackingId) {
            cancelAnimationFrame(this._rafTrackingId);
            this._rafTrackingId = null;
        }
        if (this._entryOverlay) {
            this._entryOverlay.remove();
            this._entryOverlay = null;
        }
        if (this._tpOverlay) {
            this._tpOverlay.remove();
            this._tpOverlay = null;
        }
        if (this._slOverlay) {
            this._slOverlay.remove();
            this._slOverlay = null;
        }
        // ★ 진행도 바 제거
        this._entryData = null;
        if (this._progressCanvas) {
            this._progressCanvas.remove();
            this._progressCanvas = null;
        }
    },

    // ========== 진입가 커스텀 오버레이 위치 업데이트 ==========
    updateEntryOverlay() {
        if (!this.areaSeries) return;
        // ◉ BUY/SELL
        if (this._entryOverlay && this._entryOverlayPrice) {
            const y = this.areaSeries.priceToCoordinate(this._entryOverlayPrice);
            if (y !== null && y > 0) {
                this._entryOverlay.style.top = y + 'px';
                this._entryOverlay.style.display = 'block';
            } else {
                this._entryOverlay.style.display = 'none';
            }
        }
        // Win
        if (this._tpOverlay && this._tpOverlayPrice) {
            const ty = this.areaSeries.priceToCoordinate(this._tpOverlayPrice);
            if (ty !== null && ty > 0) {
                this._tpOverlay.style.top = ty + 'px';
                this._tpOverlay.style.display = 'block';
            } else {
                this._tpOverlay.style.display = 'none';
            }
        }
        // Lose
        if (this._slOverlay && this._slOverlayPrice) {
            const sy = this.areaSeries.priceToCoordinate(this._slOverlayPrice);
            if (sy !== null && sy > 0) {
                this._slOverlay.style.top = sy + 'px';
                this._slOverlay.style.display = 'block';
            } else {
                this._slOverlay.style.display = 'none';
            }
        }
    },

    // ========== SL/TP 진행도 바 ==========
    initProgressCanvas() {
        if (this._progressCanvas) this._progressCanvas.remove();
        const wrap = document.getElementById('qeChartWrap');
        if (!wrap) return;
        const canvas = document.createElement('canvas');
        canvas.id = 'qeProgressCanvas';
        canvas.style.cssText = 'position:absolute;top:0;right:0;width:100%;height:100%;pointer-events:none;z-index:5;';
        wrap.appendChild(canvas);
        this._progressCanvas = canvas;
    },

    drawProgressBars() {
        const canvas = this._progressCanvas;
        const ed = this._entryData;
        if (!canvas || !ed || !this.areaSeries || !this.chart) return;

        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Y축 경계 = 차트 플롯 영역 끝
        let plotW = 0;
        try { plotW = this.chart.timeScale().width(); } catch(e) {}
        if (!plotW || plotW <= 0) plotW = canvas.width - 100; // fallback
        const barX = plotW - 2;
        const barWidth = 4;

        // 가격 → 픽셀 좌표 변환
        const entryY = this.areaSeries.priceToCoordinate(ed.price);
        const tpY = this.areaSeries.priceToCoordinate(ed.tp);
        const slY = this.areaSeries.priceToCoordinate(ed.sl);
        if (entryY === null || tpY === null || slY === null) return;

        // 현재 가격의 진행도 계산
        const currentPrice = this.lastPrice || ed.price;
        const tpProgress = Math.max(0, Math.min(1,
            (currentPrice - ed.price) / (ed.tp - ed.price)
        ));
        const slProgress = Math.max(0, Math.min(1,
            (currentPrice - ed.price) / (ed.sl - ed.price)
        ));

        // TP 바 (초록): entry → TP, 진행도에 따라 진해짐
        const tpTop = Math.min(entryY, tpY);
        const tpBottom = Math.max(entryY, tpY);
        const tpHeight = tpBottom - tpTop;
        if (tpHeight > 0) {
            const tpGrad = ctx.createLinearGradient(0, entryY, 0, tpY);
            const tpAlphaBase = 0.5;
            const tpAlphaMax = 0.5 + tpProgress * 0.45;
            tpGrad.addColorStop(0, 'rgba(50, 255, 160, ' + tpAlphaBase + ')');
            tpGrad.addColorStop(1, 'rgba(50, 255, 160, ' + tpAlphaMax + ')');
            ctx.fillStyle = tpGrad;
            ctx.fillRect(barX, tpTop, barWidth, tpHeight);
        }

        // SL 바 (빨강): entry → SL, 진행도에 따라 진해짐
        const slTop = Math.min(entryY, slY);
        const slBottom = Math.max(entryY, slY);
        const slHeight = slBottom - slTop;
        if (slHeight > 0) {
            const slGrad = ctx.createLinearGradient(0, entryY, 0, slY);
            const slAlphaBase = 0.5;
            const slAlphaMax = 0.5 + slProgress * 0.45;
            slGrad.addColorStop(0, 'rgba(255, 110, 120, ' + slAlphaBase + ')');
            slGrad.addColorStop(1, 'rgba(255, 110, 120, ' + slAlphaMax + ')');
            ctx.fillStyle = slGrad;
            ctx.fillRect(barX, slTop, barWidth, slHeight);
        }
    },

    // ========== 진입 시 줌아웃 → 자동 복귀 ==========
    zoomToShowTPSL(entry, tp, sl) {
        if (!this.chart || !this.areaSeries) return;

        const margin = Math.abs(tp - sl) * 0.15;
        const high = Math.max(tp, sl) + margin;
        const low = Math.min(tp, sl) - margin;

        // 플래그만 세팅 → provider가 자동 반영 (applyOptions 불필요)
        this._customPriceRange = { minValue: low, maxValue: high };

        // 3초 후 복원
        setTimeout(() => this.resetChartView(), 3000);
    },

    // ========== 차트 초기 상태 완벽 복원 ==========
    resetChartView() {
        if (!this.chart || !this.areaSeries) return;

        // 1. 커스텀 가격 범위 해제 → provider가 baseImpl() 호출 → 현재가 중심 autoScale
        this._customPriceRange = null;

        // 2. 가격축 자동스케일 + 마진 복원
        this.chart.priceScale('right').applyOptions({
            autoScale: true,
            scaleMargins: { top: 0.1, bottom: 0.1 }
        });

        // 3. 시간축 복원 (현재가 중심)
        this.chart.timeScale().scrollToRealTime();
        this.chart.timeScale().applyOptions({
            rightOffset: 8
        });
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

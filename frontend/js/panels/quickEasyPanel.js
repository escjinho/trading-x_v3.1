/**
 * Quick & Easy Panel
 * 간편 트레이딩 패널 — magic=100003
 */

const QE_MAGIC_NUMBER = 100003;

const QE_SYMBOL_SPECS = {
    "BTCUSD":   { contract_size: 1 },
    "ETHUSD":   { contract_size: 1 },
    "XAUUSD.r": { contract_size: 100 },
    "EURUSD.r": { contract_size: 100000 },
    "USDJPY.r": { contract_size: 100000 },
    "GBPUSD.r": { contract_size: 100000 },
    "AUDUSD.r": { contract_size: 100000 },
    "USDCAD.r": { contract_size: 100000 },
    "US100.":   { contract_size: 20 }
};

const QE_SYMBOL_INFO = {
    "BTCUSD":   { icon: "₿", color: "#f7931a", name: "Bitcoin" },
    "EURUSD.r": { icon: "€", color: "#0052cc", name: "EUR/USD" },
    "USDJPY.r": { icon: "¥", color: "#dc143c", name: "USD/JPY" },
    "XAUUSD.r": { icon: "✦", color: "#ffd700", name: "Gold" },
    "US100.":   { icon: "⬡", color: "#00b450", name: "NASDAQ" }
};

const QuickEasyPanel = {
    initialized: false,
    dropdownOpen: false,

    target: 100,
    targetStep: 5,
    targetMin: 5,
    targetMax: 10000,

    lotSize: 0.50,
    lotStep: 0.10,
    lotMin: 0.01,
    lotMax: 100.00,

    init() {
        if (this.initialized) return;
        console.log('[QuickEasy] 패널 초기화');
        this.setupEventListeners();
        this.updateDisplay();
        this.updatePayout();
        this.updateAccount();
        this.updateSymbolDisplay();
        window.addEventListener('resize', () => this.calcPanelHeight());
        this.initialized = true;
    },

    setupEventListeners() {
        const sellBtn = document.getElementById('qeSellBtn');
        const buyBtn = document.getElementById('qeBuyBtn');
        if (sellBtn) sellBtn.addEventListener('click', () => this.placeSell());
        if (buyBtn) buyBtn.addEventListener('click', () => this.placeBuy());

        // -/+ 버튼은 setupLongPress에서 탭+롱프레스 모두 처리

        this.setupLongPress('qeTargetMinus', () => this.adjustTarget(-1));
        this.setupLongPress('qeTargetPlus', () => this.adjustTarget(1));
        this.setupLongPress('qeLotMinus', () => this.adjustLot(-1));
        this.setupLongPress('qeLotPlus', () => this.adjustLot(1));

        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('qeSymbolDropdown');
            const btn = document.getElementById('qeSymbolBtn');
            if (dropdown && btn && !btn.contains(e.target) && !dropdown.contains(e.target)) {
                this.closeSymbolDropdown();
            }
        });
    },

    setupLongPress(elementId, callback) {
        const el = document.getElementById(elementId);
        if (!el) return;
        let interval = null, timeout = null, didLongPress = false;
        const start = (e) => {
            e.preventDefault();
            didLongPress = false;
            callback(); // 즉시 1회 실행 (탭)
            timeout = setTimeout(() => {
                didLongPress = true;
                interval = setInterval(callback, 100);
            }, 400);
        };
        const stop = () => {
            if (timeout) { clearTimeout(timeout); timeout = null; }
            if (interval) { clearInterval(interval); interval = null; }
        };
        el.addEventListener('touchstart', start, { passive: false });
        el.addEventListener('touchend', stop);
        el.addEventListener('touchcancel', stop);
        el.addEventListener('mousedown', start);
        el.addEventListener('mouseup', stop);
        el.addEventListener('mouseleave', stop);
    },

    // ========== 종목 셀렉터 ==========
    toggleSymbolDropdown() {
        this.dropdownOpen = !this.dropdownOpen;
        const dropdown = document.getElementById('qeSymbolDropdown');
        const arrow = document.querySelector('.qe-symbol-arrow');
        if (dropdown) dropdown.classList.toggle('open', this.dropdownOpen);
        if (arrow) arrow.classList.toggle('open', this.dropdownOpen);
    },

    closeSymbolDropdown() {
        this.dropdownOpen = false;
        const dropdown = document.getElementById('qeSymbolDropdown');
        const arrow = document.querySelector('.qe-symbol-arrow');
        if (dropdown) dropdown.classList.remove('open');
        if (arrow) arrow.classList.remove('open');
    },

    selectSymbol(symbol) {
        const prevSymbol = window.currentSymbol || 'BTCUSD';

        // ★ 현재 포지션 상태 저장 (타이머 시간 포함)
        if (this._posEntryPrice > 0 && this._posSymbol) {
            this._positions[this._posSymbol] = {
                side: this._posSide,
                entry: this._posEntryPrice,
                volume: this._posVolume,
                target: this._posTarget,
                tpsl: this._posTPSL,
                startTime: this._posStartTime,
                openedAt: this._posOpenedAt
            };
        }

        // ★ 현재 차트 라인/타이머 정리 (UI만, 딕셔너리는 유지)
        if (this._posTimer) { clearInterval(this._posTimer); this._posTimer = null; }
        if (typeof QeTickChart !== 'undefined') QeTickChart.removeEntryLine();
        const posView = document.getElementById('qePositionView');
        const orderSection = document.querySelector('.qe-order-section');
        const tradeButtons = document.querySelector('.qe-trade-buttons');
        if (posView) posView.style.display = 'none';
        if (orderSection) orderSection.style.display = 'flex';
        if (tradeButtons) tradeButtons.style.display = 'flex';

        // 기존 상태 변수 초기화
        this._posEntryPrice = 0;
        this._autoClosing = false;
        this._posSide = '';
        this._posSymbol = '';
        this._posVolume = 0;
        this._posTarget = 0;
        this._posTPSL = null;

        // 종목 전환
        if (prevSymbol !== symbol) {
            window.currentSymbol = symbol;
            if (typeof changeSymbol === 'function') {
                changeSymbol(symbol);
            }
        }
        this.updateSymbolDisplay();
        this.updatePayout();
        this.closeSymbolDropdown();

        // 틱차트 리셋 + 새 종목 히스토리 로딩
        if (typeof QeTickChart !== 'undefined') {
            QeTickChart.reset();
        }

        // ★ 새 종목에 저장된 포지션 있으면 복원
        const savedPos = this._positions[symbol];
        if (savedPos) {
            this.showPositionView(
                savedPos.side,
                savedPos.entry,
                savedPos.volume,
                savedPos.target
            );
            // 타이머 시작 시간 복원 (경과시간 연속)
            this._posStartTime = savedPos.startTime;
        }

        // Win/Lose 초기화
        const wlEl = document.getElementById('qeWinLose');
        if (wlEl && !savedPos) { wlEl.textContent = '--%'; wlEl.style.color = ''; }
    },

    // ★ 포지션 보유 뱃지 업데이트
    _updatePositionBadge() {
        const count = Object.keys(this._positions).length;
        let badge = document.getElementById('qePosBadge');
        if (!badge) {
            // 뱃지 생성
            const symbolCard = document.querySelector('.qe-symbol-cell');
            if (symbolCard) {
                symbolCard.style.position = 'relative';
                badge = document.createElement('span');
                badge.id = 'qePosBadge';
                badge.style.cssText = 'position:absolute;top:0px;right:-4px;' +
                    'min-width:16px;height:16px;border-radius:8px;' +
                    'background:#00d4a4;color:#000;font-size:10px;font-weight:700;' +
                    'display:none;align-items:center;justify-content:center;padding:1px 4px 0 4px;';
                symbolCard.appendChild(badge);
            }
        }
        if (badge) {
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }

        // ★ 드롭다운 종목 옆 포지션 표시
        document.querySelectorAll('.qe-symbol-option').forEach(item => {
            const sym = item.dataset.symbol;
            if (!sym) return;
            let dot = item.querySelector('.qe-pos-dot');
            if (this._positions[sym]) {
                if (!dot) {
                    dot = document.createElement('span');
                    dot.className = 'qe-pos-dot';
                    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;margin-left:auto;flex-shrink:0;box-shadow:0 0 6px currentColor;';
                    item.style.display = 'flex';
                    item.style.alignItems = 'center';
                    item.appendChild(dot);
                }
                const color = this._positions[sym].side === 'BUY' ? '#00b450' : '#dc3246';
                dot.style.background = color;
                dot.style.color = color;
                dot.style.display = 'block';
            } else if (dot) {
                dot.style.display = 'none';
            }
        });
    },

    updateSymbolDisplay() {
        const symbol = window.currentSymbol || 'BTCUSD';
        const info = QE_SYMBOL_INFO[symbol];
        const iconEl = document.getElementById('qeSymbolIcon');
        const nameEl = document.getElementById('qeSymbolName');
        if (iconEl) {
            iconEl.textContent = info ? info.icon : '📊';
            iconEl.style.color = info ? info.color : '#ffffff';
        }
        if (nameEl) {
            nameEl.textContent = info ? info.name : symbol.replace('.r', '').replace('.', '');
        }
    },

    // ========== 어카운트 데이터 갱신 ==========
    updateAccount() {
        this.updateSymbolDisplay();

        const homeEquity = document.getElementById('homeEquity');
        const qeEquity = document.getElementById('qeEquity');
        if (homeEquity && qeEquity) {
            qeEquity.textContent = homeEquity.textContent;
        }

        // 포지션 활성 중이면 Win/Lose 덮어쓰기 방지
        if (this._posEntryPrice > 0) return;

        const qeWinLose = document.getElementById('qeWinLose');
        if (qeWinLose) {
            qeWinLose.textContent = '--%';
        }
    },

    // ========== Target / Lot ==========
    adjustTarget(direction) {
        this.target += direction * this.targetStep;
        this.target = Math.max(this.targetMin, Math.min(this.targetMax, this.target));
        this.updateDisplay();
        this.updatePayout();
    },

    adjustLot(direction) {
        this.lotSize += direction * this.lotStep;
        this.lotSize = Math.max(this.lotMin, Math.min(this.lotMax, this.lotSize));
        this.lotSize = Math.round(this.lotSize * 100) / 100;
        this.updateDisplay();
        this.updatePayout();
    },

    updateDisplay() {
        const targetEl = document.getElementById('qeTargetValue');
        const lotEl = document.getElementById('qeLotValue');
        if (targetEl) targetEl.textContent = '$' + this.target;
        if (lotEl) lotEl.textContent = this.lotSize.toFixed(2);
    },

    // ========== Payout % ==========
    getSpreadCost() {
        const symbol = window.currentSymbol || 'BTCUSD';
        const spec = this.SYMBOL_SPECS[symbol] || { tick_size: 0.01, tick_value: 0.01 };

        let bid = 0, ask = 0;
        if (window.allPrices && window.allPrices[symbol]) {
            bid = window.allPrices[symbol].bid || 0;
            ask = window.allPrices[symbol].ask || 0;
        }
        if (bid <= 0 || ask <= 0) return 0;

        const spread = ask - bid;
        // ★ 백엔드 공식과 일치: (spread / tick_size) * tick_value * volume
        return (spread / spec.tick_size) * spec.tick_value * this.lotSize;
    },

    updatePayout() {
        const spreadCost = this.getSpreadCost();
        let payout = 0;
        if (this.target > 0 && spreadCost >= 0) {
            payout = ((this.target - spreadCost) / this.target) * 100;
            payout = Math.max(0, Math.min(100, payout));
        }
        const payoutText = spreadCost > 0 ? payout.toFixed(1) + '%' : '--%';
        const sellPayout = document.getElementById('qeSellPayout');
        const buyPayout = document.getElementById('qeBuyPayout');
        if (sellPayout) sellPayout.textContent = payoutText;
        if (buyPayout) buyPayout.textContent = payoutText;
    },

    // ========== Show / Hide ==========
    show() {
        const panel = document.getElementById('quickPanel');
        const bottomBar = document.getElementById('qeBottomBar');
        if (panel) panel.style.display = 'flex';
        if (bottomBar) bottomBar.style.display = 'block';

        // 동적 높이 계산: 실제 DOM 요소 측정
        setTimeout(() => {
            this.calcPanelHeight();
            if (typeof QeTickChart !== 'undefined') {
                QeTickChart.init();
                QeTickChart.resize();
            }
        }, 100);
        setTimeout(() => {
            this.calcPanelHeight();
            if (typeof QeTickChart !== 'undefined') {
                QeTickChart.resize();
            }
        }, 300);
        this.updatePayout();
        this.updateAccount();
        this._payoutInterval = setInterval(() => {
            this.updatePayout();
            this.updateAccount();
        }, 1000);
    },

    hide() {
        const panel = document.getElementById('quickPanel');
        const bottomBar = document.getElementById('qeBottomBar');
        if (panel) panel.style.display = 'none';
        if (bottomBar) bottomBar.style.display = 'none';
        this.closeSymbolDropdown();
        if (this._payoutInterval) {
            clearInterval(this._payoutInterval);
            this._payoutInterval = null;
        }
    },

    async placeSell() {
        await this.placeOrder('SELL');
    },

    calcPanelHeight() {
        const panel = document.getElementById('quickPanel');
        const bottomBar = document.getElementById('qeBottomBar');
        const nav = document.querySelector('.bottom-nav');
        const header = document.querySelector('.hero-section');
        if (!panel) return;

        const vh = window.innerHeight;
        const navH = nav ? nav.offsetHeight : 58;
        const headerH = header ? header.offsetHeight : 60;
        const bottomH = bottomBar ? bottomBar.offsetHeight : 0;

        const panelH = vh - headerH - navH - bottomH;
        panel.style.height = panelH + 'px';
    },

    placeBuy() {
        this.placeOrder('BUY');
    },

    // ========== 실제 주문 실행 ==========
    async placeOrder(side) {
        const symbol = window.currentSymbol || 'BTCUSD';
        const volume = this.lotSize;
        const target = this.target;
        const token = localStorage.getItem('access_token');

        // 게스트 체크
        if (typeof checkGuestAction === 'function' && !checkGuestAction('trade')) {
            return;
        }

        if (!token) {
            if (typeof showToast === 'function') showToast('로그인이 필요합니다', 'error');
            return;
        }

        // 버튼 비활성화 (중복 주문 방지)
        const sellBtn = document.getElementById('qeSellBtn');
        const buyBtn = document.getElementById('qeBuyBtn');
        if (sellBtn) sellBtn.disabled = true;
        if (buyBtn) buyBtn.disabled = true;

        try {
            const _isDemo = (typeof isDemo !== 'undefined') ? isDemo : false;
            const baseUrl = window.API_URL || '';
            const endpoint = _isDemo
                ? `/demo/order?symbol=${symbol}&order_type=${side}&volume=${volume}&target=${target}&magic=${QE_MAGIC_NUMBER}`
                : `/mt5/order?symbol=${symbol}&order_type=${side}&volume=${volume}&target=${target}&magic=${QE_MAGIC_NUMBER}`;

            let result;
            if (typeof apiCall === 'function') {
                result = await apiCall(endpoint, 'POST');
            } else {
                const response = await fetch(baseUrl + endpoint, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                result = await response.json();
            }

            if (result && result.success) {
                // 성공 사운드
                if (typeof playSound === 'function') {
                    playSound(side.toLowerCase());
                }

                // 성공 토스트
                const payout = this.getCurrentPayout();
                const expectedProfit = (target * payout / 100).toFixed(0);
                if (typeof showToast === 'function') {
                    showToast(
                        '⚡ ' + side + ' 주문 체결! Target $' + target + ' (예상수익 $' + expectedProfit + ')',
                        'success'
                    );
                }

                // 포지션 뷰로 전환 (진입가격 + SL/TP 라인 표시 포함)
                const entryPrice = this.getEntryPrice();
                this.showPositionView(side, entryPrice);
                // 버튼 4초 비활성화 (중복 진입 방지)
                const buyBtn = document.getElementById('qeBuyBtn');
                const sellBtn = document.getElementById('qeSellBtn');
                if (buyBtn) buyBtn.disabled = true;
                if (sellBtn) sellBtn.disabled = true;
                setTimeout(() => {
                    if (buyBtn) buyBtn.disabled = false;
                    if (sellBtn) sellBtn.disabled = false;
                }, 4000);

                // 데모 데이터 새로고침
                if (isDemo && typeof fetchDemoData === 'function') {
                    fetchDemoData();
                }

                console.log('[QuickEasy] ' + side + ' 주문 성공:', result);
            } else {
                const msg = (result && result.message) ? result.message : '주문 실패';
                if (typeof showToast === 'function') showToast(msg, 'error');
                console.error('[QuickEasy] 주문 실패:', result);
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('네트워크 오류', 'error');
            console.error('[QuickEasy] 주문 에러:', e);
        } finally {
            // 버튼 재활성화
            if (sellBtn) sellBtn.disabled = false;
            if (buyBtn) buyBtn.disabled = false;
        }
    },

    // 현재 payout % 가져오기
    getCurrentPayout() {
        const el = document.getElementById('qeSellPayout') || document.getElementById('qeBuyPayout');
        if (el) {
            const text = el.textContent.replace('%', '');
            const val = parseFloat(text);
            if (!isNaN(val)) return val;
        }
        return 86; // 기본값
    },

    // 종목별 스펙 (백엔드 DEFAULT_SYMBOL_SPECS와 동일)
    SYMBOL_SPECS: {
        'BTCUSD':   { tick_size: 0.01, tick_value: 0.01, contract_size: 1 },
        'ETHUSD':   { tick_size: 0.01, tick_value: 0.01, contract_size: 1 },
        'EURUSD.r': { tick_size: 0.00001, tick_value: 1.0, contract_size: 100000 },
        'USDJPY.r': { tick_size: 0.001, tick_value: 0.67, contract_size: 100000 },
        'GBPUSD.r': { tick_size: 0.00001, tick_value: 1.0, contract_size: 100000 },
        'XAUUSD.r': { tick_size: 0.01, tick_value: 1.0, contract_size: 100 },
        'US100.':   { tick_size: 0.01, tick_value: 0.2, contract_size: 20 },
        'AUDUSD.r': { tick_size: 0.00001, tick_value: 1.0, contract_size: 100000 },
        'USDCAD.r': { tick_size: 0.00001, tick_value: 0.74, contract_size: 100000 }
    },

    // profit 계산 (백엔드 calculate_demo_profit 동일)
    calcProfit(entryPrice, currentPrice, side, volume, symbol) {
        const spec = this.SYMBOL_SPECS[symbol] || { tick_size: 0.01, tick_value: 0.01, contract_size: 1 };
        let priceDiff = currentPrice - entryPrice;
        if (side === 'SELL') priceDiff = -priceDiff;
        return priceDiff * volume * spec.tick_value / spec.tick_size;
    },

    // TP/SL 가격 계산
    calcTPSL(entryPrice, side, volume, target, symbol) {
        const spec = this.SYMBOL_SPECS[symbol] || { tick_size: 0.01, tick_value: 0.01, contract_size: 1 };
        const profitPerPoint = volume * spec.tick_value / spec.tick_size;
        if (profitPerPoint <= 0) return { tp: 0, sl: 0 };

        // ★ TP/SL 대칭: 동일 거리
        // TP 도달 시: WIN = target - spread (payout %)
        // SL 도달 시: LOSE = -target (전액 손실)
        const tpDiff = target / profitPerPoint;
        const slDiff = target / profitPerPoint;  // ★ TP와 동일 거리

        if (side === 'BUY') {
            return { tp: entryPrice + tpDiff, sl: entryPrice - slDiff };
        } else {
            return { tp: entryPrice - tpDiff, sl: entryPrice + slDiff };
        }
    },

    // 현재 진입가 가져오기
    getEntryPrice() {
        const symbol = window.currentSymbol || 'BTCUSD';
        if (window.allPrices && window.allPrices[symbol]) {
            return window.allPrices[symbol].bid || 0;
        }
        return 0;
    },

    // ========== 포지션 뷰 ==========
    _posTimer: null,
    _posStartTime: 0,
    _posOrderId: null,

    showPositionView(side, entryPrice, volume = null, target = null) {
        const orderSection = document.querySelector('.qe-order-section');
        const tradeButtons = document.querySelector('.qe-trade-buttons');
        const posView = document.getElementById('qePositionView');
        if (!posView) return;

        // 주문 섹션 숨기기
        if (orderSection) orderSection.style.display = 'none';
        if (tradeButtons) tradeButtons.style.display = 'none';
        posView.style.display = 'block';

        // 포지션 정보 표시
        const typeEl = document.getElementById('qePosType');
        const entryEl = document.getElementById('qePosEntry');
        const timeEl = document.getElementById('qePosTime');

        if (typeEl) {
            typeEl.textContent = side;
            typeEl.className = 'qe-pos-value ' + (side === 'BUY' ? 'buy-type' : 'sell-type');
        }
        // ★ 카드 배경색 BUY/SELL 전환
        const posInfo = document.querySelector('.qe-position-info');
        if (posInfo) {
            posInfo.classList.remove('sell-pos');
            if (side === 'SELL') posInfo.classList.add('sell-pos');
        }
        if (entryEl) {
            const _t = target !== null ? target : this.target;
            entryEl.textContent = '$' + _t;
        }

        // 경과시간 카운터 시작
        this._posStartTime = Date.now();
        if (this._posTimer) clearInterval(this._posTimer);
        this._posTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this._posStartTime) / 1000);
            const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const ss = String(elapsed % 60).padStart(2, '0');
            if (timeEl) timeEl.textContent = mm + ':' + ss;
        }, 1000);

        // Win/Lose 실시간 업데이트
        // ★ 복구 시 volume/target이 전달되면 사용, 아니면 현재 UI 값 사용
        const posVolume = volume !== null ? volume : this.lotSize;
        const posTarget = target !== null ? target : this.target;

        this._posEntryPrice = entryPrice;
        this._posOpenedAt = Date.now();  // No position 안전장치 쿨다운용
        this._posSide = side;
        this._posSymbol = window.currentSymbol || 'BTCUSD';
        this._posVolume = posVolume;
        this._posTarget = posTarget;
        // ★ 서버 TP/SL 우선 사용 (spread 변동으로 인한 불일치 방지)
        if (window._serverTPSL && window._serverTPSL.tp > 0 && window._serverTPSL.sl > 0) {
            this._posTPSL = { tp: window._serverTPSL.tp, sl: window._serverTPSL.sl };
            console.log('[QE] ★ 서버 TP/SL 사용:', this._posTPSL);
            window._serverTPSL = null;
        } else {
            this._posTPSL = this.calcTPSL(entryPrice, side, posVolume, posTarget, this._posSymbol);
            console.log('[QE] calcTPSL fallback:', this._posTPSL);
        }

        // ★ 차트에 진입가 + TP/SL 라인 그리기 (복구 시에도 표시)
        if (typeof QeTickChart !== 'undefined' && this._posTPSL) {
            if (QeTickChart.initialized && QeTickChart.areaSeries) {
                // 차트 준비됨 → 즉시 그리기
                QeTickChart.showEntryLine(entryPrice, side.toLowerCase(), this._posTPSL.tp, this._posTPSL.sl);
            } else {
                // ★ 차트 미초기화 → pending 저장 (init 완료 후 그림)
                console.log('[QuickEasy] 차트 미초기화 → pending 라인 저장');
                QeTickChart._pendingEntryLine = {
                    price: entryPrice,
                    side: side.toLowerCase(),
                    tp: this._posTPSL.tp,
                    sl: this._posTPSL.sl
                };
            }
        }

        // Win/Lose는 addTick에서 실시간 업데이트 (깜빡임 방지)
        this.updateWinLose(); // 즉시 1회

        // CLOSE 버튼 이벤트
        const closeBtn = document.getElementById('qeCloseBtn');
        if (closeBtn) {
            closeBtn.onclick = () => this.closePosition();
        }

        // ★ 종목별 포지션 저장
        this._positions[this._posSymbol] = {
            side: side,
            entry: entryPrice,
            volume: this._posVolume,
            target: this._posTarget,
            tpsl: this._posTPSL,
            startTime: this._posStartTime,
            openedAt: this._posOpenedAt
        };
        this._updatePositionBadge();
    },

    hidePositionView(actualClose = true) {
        const orderSection = document.querySelector('.qe-order-section');
        const tradeButtons = document.querySelector('.qe-trade-buttons');
        const posView = document.getElementById('qePositionView');

        if (posView) posView.style.display = 'none';
        if (orderSection) orderSection.style.display = 'flex';
        if (tradeButtons) tradeButtons.style.display = 'flex';

        if (this._posTimer) {
            clearInterval(this._posTimer);
            this._posTimer = null;
        }

        // ★ 실제 청산일 때만 딕셔너리에서 제거 (종목 전환은 제거하지 않음)
        if (actualClose && this._posSymbol) {
            delete this._positions[this._posSymbol];
            this._updatePositionBadge();
        }
        this._posEntryPrice = 0;
        this._autoClosing = false;
        this._posSide = '';
        this._posSymbol = '';
        this._posVolume = 0;
        this._posTarget = 0;
        this._posTPSL = null;

        // Win/Lose 초기화
        const wlEl = document.getElementById('qeWinLose');
        if (wlEl) { wlEl.textContent = '--%'; wlEl.style.color = ''; }

        // 진입라인 제거
        if (typeof QeTickChart !== 'undefined') {
            QeTickChart.removeEntryLine();
        }
    },

    updateWinLose() {
        // ★ 백그라운드: 안 보는 종목도 자동청산 체크
        this._checkBackgroundAutoClose();

        const symbol = this._posSymbol;
        const currentPrice = (window.allPrices && window.allPrices[symbol])
            ? (window.allPrices[symbol].bid || 0) : 0;
        if (currentPrice <= 0 || !this._posEntryPrice || !this._posTPSL) return;

        const entry = this._posEntryPrice;
        const tp = this._posTPSL.tp;
        const sl = this._posTPSL.sl;
        const side = this._posSide;

        // 가격 기반 이동 거리 계산
        let tpDist, slDist, movement;
        if (side === 'BUY') {
            tpDist = tp - entry;
            slDist = entry - sl;
            movement = currentPrice - entry;
        } else {
            tpDist = entry - tp;
            slDist = sl - entry;
            movement = entry - currentPrice;
        }

        const wlEl = document.getElementById('qeWinLose');
        if (!wlEl) return;

        if (tpDist <= 0 || slDist <= 0) {
            wlEl.textContent = '0%';
            wlEl.style.color = 'rgba(255,255,255,0.5)';
            return;
        }

        if (movement >= 0) {
            // Win 방향
            const pct = Math.min(Math.round((movement / tpDist) * 100), 100);
            wlEl.textContent = 'Win +' + pct + '%';
            wlEl.style.color = '#00d4a4';
            // ★ TP 도달: 프론트에서 직접 청산
            if (pct >= 100 && !this._autoClosing) {
                this._autoClosing = true;
                console.log('[QE] 🎯 TP 도달! 자동청산 실행');
                this.closePosition();
            }
        } else {
            // Lose 방향
            const pct = Math.min(Math.round((Math.abs(movement) / slDist) * 100), 100);
            wlEl.textContent = 'Lose -' + pct + '%';
            wlEl.style.color = '#ff4d5a';
            // ★ SL 도달: 프론트에서 직접 청산
            if (pct >= 100 && !this._autoClosing) {
                this._autoClosing = true;
                console.log('[QE] 💔 SL 도달! 자동청산 실행');
                this.closePosition();
            }
        }
    },

    _winLoseTimer: null,
    _posEntryPrice: 0,
    _posSide: '',
    _posSymbol: '',
    _posVolume: 0,
    _posTarget: 0,
    _posTPSL: null,
    _positions: {},  // ★ 종목별 포지션 딕셔너리

    // ★ 안 보는 종목도 TP/SL 자동청산 체크
    _checkBackgroundAutoClose() {
        if (!window.allPrices) return;
        const currentSym = window.currentSymbol || 'BTCUSD';
        Object.keys(this._positions).forEach(sym => {
            if (sym === currentSym) return; // 현재 종목은 updateWinLose에서 처리
            const pos = this._positions[sym];
            if (!pos || !pos.tpsl) return;
            const price = (window.allPrices[sym] && window.allPrices[sym].bid) || 0;
            if (price <= 0) return;

            let movement;
            if (pos.side === 'BUY') movement = price - pos.entry;
            else movement = pos.entry - price;

            const tpDist = pos.side === 'BUY' ? (pos.tpsl.tp - pos.entry) : (pos.entry - pos.tpsl.tp);
            const slDist = pos.side === 'BUY' ? (pos.entry - pos.tpsl.sl) : (pos.tpsl.sl - pos.entry);

            if (tpDist > 0 && movement >= tpDist) {
                console.log('[QE] 🎯 백그라운드 TP:', sym);
                this._backgroundClose(sym);
            } else if (slDist > 0 && Math.abs(movement) >= slDist && movement < 0) {
                console.log('[QE] 💔 백그라운드 SL:', sym);
                this._backgroundClose(sym);
            }
        });
    },

    async _backgroundClose(symbol) {
        try {
            const isLive = typeof TradingState !== 'undefined' && TradingState.isLive;
            const endpoint = isLive
                ? '/mt5/close-all?symbol=' + symbol + '&magic=' + QE_MAGIC_NUMBER
                : '/demo/close-all?symbol=' + symbol + '&magic=' + QE_MAGIC_NUMBER;
            await apiCall(endpoint, 'POST');
            delete this._positions[symbol];
            this._updatePositionBadge();
            console.log('[QE] ✅ 백그라운드 청산 완료:', symbol);
        } catch(e) {
            console.error('[QE] 백그라운드 청산 실패:', symbol, e);
        }
    },

    async closePosition() {
        const symbol = window.currentSymbol || 'BTCUSD';
        const token = localStorage.getItem('access_token');
        if (!token) return;

        const closeBtn = document.getElementById('qeCloseBtn');
        if (closeBtn) closeBtn.disabled = true;

        try {
            const _isDemo = (typeof isDemo !== 'undefined') ? isDemo : false;

            if (_isDemo) {
                // 데모: 전체 청산 API
                const endpoint = '/demo/close-all?symbol=' + symbol + '&magic=' + QE_MAGIC_NUMBER;
                if (typeof apiCall === 'function') {
                    await apiCall(endpoint, 'POST');
                }
            } else {
                // 라이브: 심볼별 청산
                const endpoint = '/mt5/close-all?symbol=' + symbol + '&magic=' + QE_MAGIC_NUMBER;
                if (typeof apiCall === 'function') {
                    await apiCall(endpoint, 'POST');
                }
            }

            if (typeof showToast === 'function') {
                showToast('포지션 청산 완료', 'success');
            }
            if (typeof playSound === 'function') {
                playSound('close');
            }

            // 데모 데이터 갱신
            if (isDemo && typeof fetchDemoData === 'function') {
                fetchDemoData();
            }
        } catch (e) {
            if (typeof showToast === 'function') {
                showToast('청산 실패', 'error');
            }
            console.error('[QuickEasy] 청산 에러:', e);
        } finally {
            if (closeBtn) closeBtn.disabled = false;
            this.hidePositionView();
        }
    }
};

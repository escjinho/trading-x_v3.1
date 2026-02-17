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
        if (window.currentSymbol !== symbol) {
            window.currentSymbol = symbol;
            if (typeof changeSymbol === 'function') {
                changeSymbol(symbol);
            }
        }
        this.updateSymbolDisplay();
        this.updatePayout();
        this.closeSymbolDropdown();
        // 틱차트 리셋
        if (typeof QeTickChart !== 'undefined') {
            QeTickChart.reset();
        }
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
        const spec = QE_SYMBOL_SPECS[symbol];
        if (!spec) return 0;

        let bid = 0, ask = 0;
        if (window.allPrices && window.allPrices[symbol]) {
            bid = window.allPrices[symbol].bid || 0;
            ask = window.allPrices[symbol].ask || 0;
        }
        if (bid <= 0 || ask <= 0) return 0;

        const spread = ask - bid;
        return spread * spec.contract_size * this.lotSize;
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
            const isDemo = window.isDemo || false;
            const baseUrl = window.API_URL || '';
            const endpoint = isDemo 
                ? `/demo/order?symbol=${symbol}&order_type=${side}&volume=${volume}&target=${target}`
                : `/mt5/order?symbol=${symbol}&order_type=${side}&volume=${volume}&target=${target}`;

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

                // 차트에 진입가격 라인 표시
                const entryPrice = this.getEntryPrice();
                if (entryPrice > 0 && typeof QeTickChart !== 'undefined') {
                    QeTickChart.showEntryLine(entryPrice, side.toLowerCase());
                }

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

    // 현재 진입가 가져오기
    getEntryPrice() {
        const symbol = window.currentSymbol || 'BTCUSD';
        if (window.allPrices && window.allPrices[symbol]) {
            return window.allPrices[symbol].bid || 0;
        }
        return 0;
    }
};

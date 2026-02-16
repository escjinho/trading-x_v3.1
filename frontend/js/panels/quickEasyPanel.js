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

const QE_POPULAR_SYMBOLS = {
    "BTCUSD":   { icon: "₿", name: "Bitcoin" },
    "ETHUSD":   { icon: "Ξ", name: "Ethereum" },
    "XAUUSD.r": { icon: "🥇", name: "Gold" },
    "EURUSD.r": { icon: "€", name: "EUR/USD" },
    "US100.":   { icon: "📈", name: "NASDAQ" }
};

const QuickEasyPanel = {
    initialized: false,
    accountExpanded: false,  // 접힌 상태가 기본
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
        this.initialized = true;
    },

    setupEventListeners() {
        const sellBtn = document.getElementById('qeSellBtn');
        const buyBtn = document.getElementById('qeBuyBtn');
        if (sellBtn) sellBtn.addEventListener('click', () => this.placeSell());
        if (buyBtn) buyBtn.addEventListener('click', () => this.placeBuy());

        const targetMinus = document.getElementById('qeTargetMinus');
        const targetPlus = document.getElementById('qeTargetPlus');
        if (targetMinus) targetMinus.addEventListener('click', () => this.adjustTarget(-1));
        if (targetPlus) targetPlus.addEventListener('click', () => this.adjustTarget(1));

        const lotMinus = document.getElementById('qeLotMinus');
        const lotPlus = document.getElementById('qeLotPlus');
        if (lotMinus) lotMinus.addEventListener('click', () => this.adjustLot(-1));
        if (lotPlus) lotPlus.addEventListener('click', () => this.adjustLot(1));

        this.setupLongPress('qeTargetMinus', () => this.adjustTarget(-1));
        this.setupLongPress('qeTargetPlus', () => this.adjustTarget(1));
        this.setupLongPress('qeLotMinus', () => this.adjustLot(-1));
        this.setupLongPress('qeLotPlus', () => this.adjustLot(1));

        // 드롭다운 외부 클릭 닫기
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
        let interval = null, timeout = null;
        const start = (e) => {
            e.preventDefault();
            timeout = setTimeout(() => { interval = setInterval(callback, 100); }, 400);
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

    // ========== 어카운트 토글 ==========
    toggleAccount() {
        this.accountExpanded = !this.accountExpanded;
        const bar = document.getElementById('qeAccountBar');
        const icon = document.getElementById('qeToggleIcon');
        if (bar) {
            bar.classList.toggle('expanded', this.accountExpanded);
        }
        if (icon) {
            icon.textContent = this.accountExpanded ? '▸' : '◂';
        }
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

    selectSymbol(symbol, icon, name) {
        // 글로벌 종목 변경
        if (window.currentSymbol !== symbol) {
            window.currentSymbol = symbol;
            // 차트 등 다른 패널 종목도 변경
            if (typeof changeSymbol === 'function') {
                changeSymbol(symbol);
            }
        }
        this.updateSymbolDisplay();
        this.updatePayout();
        this.closeSymbolDropdown();
    },

    updateSymbolDisplay() {
        const symbol = window.currentSymbol || 'BTCUSD';
        const info = QE_POPULAR_SYMBOLS[symbol];
        const iconEl = document.getElementById('qeSymbolIcon');
        const nameEl = document.getElementById('qeSymbolName');
        if (iconEl) iconEl.textContent = info ? info.icon : '📊';
        if (nameEl) nameEl.textContent = info ? info.name : symbol.replace('.r', '').replace('.', '');
    },

    // ========== 어카운트 데이터 갱신 ==========
    updateAccount() {
        this.updateSymbolDisplay();

        const homeEquity = document.getElementById('homeEquity');
        const qeEquity = document.getElementById('qeEquity');
        if (homeEquity && qeEquity) {
            qeEquity.textContent = homeEquity.textContent;
        }

        const qeTodayPL = document.getElementById('qeTodayPL');
        if (qeTodayPL) {
            const pl = window._todayPLFixed || 0;
            const sign = pl >= 0 ? '+' : '';
            qeTodayPL.textContent = sign + '$' + Math.abs(pl).toFixed(2);
            qeTodayPL.className = 'qe-account-value ' + (pl > 0 ? 'positive' : pl < 0 ? 'negative' : '');
        }

        const qeWinLose = document.getElementById('qeWinLose');
        if (qeWinLose) {
            // 포지션 없으면 --%, 있으면 실시간 도달률 (추후 구현)
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
        if (window._lastPrices && window._lastPrices[symbol]) {
            bid = window._lastPrices[symbol].bid || 0;
            ask = window._lastPrices[symbol].ask || 0;
        } else if (window.lastBid && window.lastAsk) {
            bid = window.lastBid;
            ask = window.lastAsk;
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
        if (panel) panel.style.display = 'block';
        if (bottomBar) bottomBar.style.display = 'block';
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

    placeSell() {
        console.log('[QuickEasy] SELL — target:', this.target, 'lot:', this.lotSize);
    },

    placeBuy() {
        console.log('[QuickEasy] BUY — target:', this.target, 'lot:', this.lotSize);
    }
};

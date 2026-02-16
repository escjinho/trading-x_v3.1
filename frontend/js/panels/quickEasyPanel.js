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

const QuickEasyPanel = {
    initialized: false,
    accountExpanded: true,  // 펼침 상태 (기본: 펼침)

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
        if (bar) {
            if (this.accountExpanded) {
                bar.classList.remove('collapsed');
            } else {
                bar.classList.add('collapsed');
            }
        }
        this.updateSymbolName();
    },

    updateSymbolName() {
        const el = document.getElementById('qeSymbolName');
        if (el) {
            const symbol = window.currentSymbol || 'BTCUSD';
            // .r 제거, . 제거해서 깔끔하게 표시
            el.textContent = symbol.replace('.r', '').replace('.', '');
        }
    },

    // ========== 어카운트 데이터 갱신 ==========
    updateAccount() {
        this.updateSymbolName();
        // Equity
        const homeEquity = document.getElementById('homeEquity');
        const qeEquity = document.getElementById('qeEquity');
        if (homeEquity && qeEquity) {
            qeEquity.textContent = homeEquity.textContent;
        }

        // Today P/L
        const qeTodayPL = document.getElementById('qeTodayPL');
        if (qeTodayPL) {
            const pl = window._todayPLFixed || 0;
            const sign = pl >= 0 ? '+' : '';
            qeTodayPL.textContent = sign + '$' + Math.abs(pl).toFixed(2);
            qeTodayPL.className = 'qe-account-value ' + (pl > 0 ? 'positive' : pl < 0 ? 'negative' : '');
        }

        // Win / Lose (%)
        const qeWinLose = document.getElementById('qeWinLose');
        if (qeWinLose) {
            const wins = window.todayWins || 0;
            const losses = window.todayLosses || 0;
            const total = wins + losses;
            const rate = total > 0 ? Math.round((wins / total) * 100) : 0;
            qeWinLose.textContent = wins + ' / ' + losses + ' (' + rate + '%)';
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

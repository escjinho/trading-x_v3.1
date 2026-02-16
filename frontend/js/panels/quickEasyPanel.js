/**
 * Quick & Easy Panel
 * 간편 트레이딩 패널 — magic=100003
 * 바이너리 옵션 스타일
 */

const QE_MAGIC_NUMBER = 100003;

// 종목별 스프레드 비용 계산에 필요한 contract_size
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

    // 주문 설정 상태
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
        this.initialized = true;
    },

    setupEventListeners() {
        // SELL / BUY
        const sellBtn = document.getElementById('qeSellBtn');
        const buyBtn = document.getElementById('qeBuyBtn');
        if (sellBtn) sellBtn.addEventListener('click', () => this.placeSell());
        if (buyBtn) buyBtn.addEventListener('click', () => this.placeBuy());

        // Target -/+
        const targetMinus = document.getElementById('qeTargetMinus');
        const targetPlus = document.getElementById('qeTargetPlus');
        if (targetMinus) targetMinus.addEventListener('click', () => this.adjustTarget(-1));
        if (targetPlus) targetPlus.addEventListener('click', () => this.adjustTarget(1));

        // Lot Size -/+
        const lotMinus = document.getElementById('qeLotMinus');
        const lotPlus = document.getElementById('qeLotPlus');
        if (lotMinus) lotMinus.addEventListener('click', () => this.adjustLot(-1));
        if (lotPlus) lotPlus.addEventListener('click', () => this.adjustLot(1));

        // 길게 누르기 (연속 조정)
        this.setupLongPress('qeTargetMinus', () => this.adjustTarget(-1));
        this.setupLongPress('qeTargetPlus', () => this.adjustTarget(1));
        this.setupLongPress('qeLotMinus', () => this.adjustLot(-1));
        this.setupLongPress('qeLotPlus', () => this.adjustLot(1));
    },

    setupLongPress(elementId, callback) {
        const el = document.getElementById(elementId);
        if (!el) return;

        let interval = null;
        let timeout = null;

        const start = (e) => {
            e.preventDefault();
            timeout = setTimeout(() => {
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

    /**
     * Payout % 계산
     * 공식: payout = ((target - spreadCost) / target) * 100
     * spreadCost = (ask - bid) * contract_size * lotSize
     */
    getSpreadCost() {
        // 현재 선택된 종목의 bid/ask 가져오기
        const symbol = window.currentSymbol || 'BTCUSD';
        const spec = QE_SYMBOL_SPECS[symbol];
        if (!spec) return 0;

        // WebSocket에서 받은 최신 bid/ask
        let bid = 0, ask = 0;

        // connection.js의 가격 데이터 접근
        if (window._lastPrices && window._lastPrices[symbol]) {
            bid = window._lastPrices[symbol].bid || 0;
            ask = window._lastPrices[symbol].ask || 0;
        } else if (window.lastBid && window.lastAsk) {
            bid = window.lastBid;
            ask = window.lastAsk;
        }

        if (bid <= 0 || ask <= 0) return 0;

        const spread = ask - bid;
        const spreadCost = spread * spec.contract_size * this.lotSize;
        return spreadCost;
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

    show() {
        const panel = document.getElementById('quickPanel');
        const bottomBar = document.getElementById('qeBottomBar');
        if (panel) panel.style.display = 'block';
        if (bottomBar) bottomBar.style.display = 'block';
        this.updatePayout();

        // 1초마다 payout 갱신 (스프레드 변동 반영)
        this._payoutInterval = setInterval(() => this.updatePayout(), 1000);
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
        console.log('[QuickEasy] SELL — target:', this.target, 'lot:', this.lotSize, 'spread:', this.getSpreadCost().toFixed(2));
        // TODO: 주문 기능 구현
    },

    placeBuy() {
        console.log('[QuickEasy] BUY — target:', this.target, 'lot:', this.lotSize, 'spread:', this.getSpreadCost().toFixed(2));
        // TODO: 주문 기능 구현
    }
};

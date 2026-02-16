/**
 * Quick & Easy Panel
 * 간편 트레이딩 패널 — magic=100003
 */

const QE_MAGIC_NUMBER = 100003;

const QuickEasyPanel = {
    initialized: false,

    // Target 설정
    target: 100,
    targetStep: 5,
    targetMin: 5,
    targetMax: 10000,

    // Lot Size 설정
    lotSize: 0.50,
    lotStep: 0.10,
    lotMin: 0.01,
    lotMax: 100.00,

    // Long-press 타이머
    longPressTimer: null,
    longPressInterval: null,

    init() {
        if (this.initialized) return;
        console.log('[QuickEasy] 패널 초기화');
        this.setupEventListeners();
        this.updateDisplay();
        this.initialized = true;
    },

    setupEventListeners() {
        // SELL/BUY 버튼
        const sellBtn = document.getElementById('qeSellBtn');
        const buyBtn = document.getElementById('qeBuyBtn');

        if (sellBtn) {
            sellBtn.addEventListener('click', () => this.placeSell());
        }
        if (buyBtn) {
            buyBtn.addEventListener('click', () => this.placeBuy());
        }

        // Target 조절 버튼 (길게 누르기 지원)
        this.setupLongPress('qeTargetMinus', () => this.adjustTarget(-1));
        this.setupLongPress('qeTargetPlus', () => this.adjustTarget(1));

        // Lot 조절 버튼 (길게 누르기 지원)
        this.setupLongPress('qeLotMinus', () => this.adjustLot(-1));
        this.setupLongPress('qeLotPlus', () => this.adjustLot(1));
    },

    setupLongPress(elementId, callback) {
        const el = document.getElementById(elementId);
        if (!el) return;

        const startPress = (e) => {
            e.preventDefault();
            callback(); // 즉시 1회 실행

            // 500ms 후 연속 실행 시작
            this.longPressTimer = setTimeout(() => {
                this.longPressInterval = setInterval(callback, 80);
            }, 500);
        };

        const endPress = () => {
            clearTimeout(this.longPressTimer);
            clearInterval(this.longPressInterval);
            this.longPressTimer = null;
            this.longPressInterval = null;
        };

        // 마우스 이벤트
        el.addEventListener('mousedown', startPress);
        el.addEventListener('mouseup', endPress);
        el.addEventListener('mouseleave', endPress);

        // 터치 이벤트
        el.addEventListener('touchstart', startPress, { passive: false });
        el.addEventListener('touchend', endPress);
        el.addEventListener('touchcancel', endPress);
    },

    adjustTarget(direction) {
        const newVal = this.target + (direction * this.targetStep);
        if (newVal >= this.targetMin && newVal <= this.targetMax) {
            this.target = newVal;
            this.updateDisplay();
        }
    },

    adjustLot(direction) {
        const newVal = Math.round((this.lotSize + (direction * this.lotStep)) * 100) / 100;
        if (newVal >= this.lotMin && newVal <= this.lotMax) {
            this.lotSize = newVal;
            this.updateDisplay();
        }
    },

    updateDisplay() {
        const targetEl = document.getElementById('qeTargetValue');
        const lotEl = document.getElementById('qeLotValue');

        if (targetEl) {
            targetEl.textContent = '$' + this.target;
        }
        if (lotEl) {
            lotEl.textContent = this.lotSize.toFixed(2);
        }
    },

    show() {
        const panel = document.getElementById('quickPanel');
        const bottomBar = document.getElementById('qeBottomBar');
        if (panel) panel.style.display = 'block';
        if (bottomBar) bottomBar.style.display = 'block';
    },

    hide() {
        const panel = document.getElementById('quickPanel');
        const bottomBar = document.getElementById('qeBottomBar');
        if (panel) panel.style.display = 'none';
        if (bottomBar) bottomBar.style.display = 'none';
    },

    placeSell() {
        console.log(`[QuickEasy] SELL — Target: $${this.target}, Lot: ${this.lotSize.toFixed(2)}`);
        // TODO: 주문 기능 구현
    },

    placeBuy() {
        console.log(`[QuickEasy] BUY — Target: $${this.target}, Lot: ${this.lotSize.toFixed(2)}`);
        // TODO: 주문 기능 구현
    }
};

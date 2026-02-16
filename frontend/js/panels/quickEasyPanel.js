/**
 * Quick & Easy Panel
 * 간편 트레이딩 패널 — magic=100003
 */

const QE_MAGIC_NUMBER = 100003;

const QuickEasyPanel = {
    initialized: false,

    init() {
        if (this.initialized) return;
        console.log('[QuickEasy] 패널 초기화');
        this.setupEventListeners();
        this.initialized = true;
    },

    setupEventListeners() {
        const sellBtn = document.getElementById('qeSellBtn');
        const buyBtn = document.getElementById('qeBuyBtn');
        
        if (sellBtn) {
            sellBtn.addEventListener('click', () => this.placeSell());
        }
        if (buyBtn) {
            buyBtn.addEventListener('click', () => this.placeBuy());
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
        console.log('[QuickEasy] SELL 클릭 — 기능 구현 예정');
        // TODO: 주문 기능 구현
    },

    placeBuy() {
        console.log('[QuickEasy] BUY 클릭 — 기능 구현 예정');
        // TODO: 주문 기능 구현
    }
};

/* ========================================
   Trading-X Navigation
   탭 전환, 서브메뉴, 길게 누르기
   ======================================== */

// ========== Constants ==========
const LONG_PRESS_DURATION = 500; // 0.5초

// ========== Helper Functions ==========
// 마지막으로 수신한 WebSocket 데이터 저장
if (typeof lastWebSocketData === 'undefined') {
    var lastWebSocketData = null;
}

// 인디케이터 강제 업데이트 함수
function forceUpdateIndicators() {
    const data = lastWebSocketData || window.lastWebSocketData;

    if (data) {
        console.log('[Navigation] Force updating indicators:', data.sell_count, data.neutral_count, data.buy_count);

        // Trade 탭 인디케이터
        if (data.sell_count !== undefined) {
            document.getElementById('indSell').textContent = data.sell_count || 0;
            document.getElementById('indNeutral').textContent = data.neutral_count || 0;
            document.getElementById('indBuy').textContent = data.buy_count || 0;
        }

        // Chart 탭 인디케이터
        if (data.sell_count !== undefined) {
            document.getElementById('chartIndSell').textContent = data.sell_count || 0;
            document.getElementById('chartIndNeutral').textContent = data.neutral_count || 0;
            document.getElementById('chartIndBuy').textContent = data.buy_count || 0;
        }
    } else {
        console.log('[Navigation] No WebSocket data available yet for indicator update');
    }
}

// ========== Nav Tab Click ==========
document.querySelectorAll('.nav-item').forEach(item => {
    if (item.dataset.page !== 'chart' && item.dataset.page !== 'trade') {
        item.addEventListener('click', function() {
            const page = this.dataset.page;
            
            // 게스트 모드 제한
            if (isGuest && (page === 'account' || page === 'my')) {
                showGuestPopup();
                return;
            }
            
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            this.classList.add('active');
            
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById('page-' + page).classList.add('active');
            
            // 페이지별 초기화
            if (page === 'account') {
                loadHistory();
            }
        });
    }
});

// ========== Chart Submenu ==========
let submenuLongPressTimer = null;
let submenuCurrentItem = null;

function openChartSubmenu() {
    const defaultView = localStorage.getItem('chart_default_view') || null;
    
    const watchlistBadge = document.getElementById('submenuWatchlistBadge');
    const chartBadge = document.getElementById('submenuChartBadge');
    
    if (defaultView === 'watchlist') {
        watchlistBadge.style.display = 'block';
        chartBadge.style.display = 'none';
    } else if (defaultView === 'chart') {
        watchlistBadge.style.display = 'none';
        chartBadge.style.display = 'block';
    } else {
        watchlistBadge.style.display = 'none';
        chartBadge.style.display = 'none';
    }
    
    document.getElementById('chartSubmenuOverlay').classList.add('show');
}

function closeChartSubmenu() {
    document.getElementById('chartSubmenuOverlay').classList.remove('show');
}

function selectSubmenuItem(view) {
    closeChartSubmenu();

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('.nav-item[data-page="chart"]').classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-chart').classList.add('active');

    if (view === 'watchlist') {
        showWatchlist();
        renderWatchlist();
    } else if (view === 'chart') {
        const lastSymbol = localStorage.getItem('last_chart_symbol') || 'BTCUSD';
        const symbolInfo = getSymbolInfo(lastSymbol);

        chartSymbol = lastSymbol;
        document.getElementById('chartSymbolIcon').textContent = symbolInfo.icon;
        document.getElementById('chartSymbolIcon').style.color = symbolInfo.color;
        document.getElementById('chartSymbolName').textContent = symbolInfo.name;
        document.getElementById('chartSymbolId').textContent = lastSymbol;

        showChartDetail();

        if (chart) {
            chart.remove();
            chart = null;
        }
        initChart();
        loadCandles();
    }

    // Chart 탭으로 전환 시 인디케이터 강제 업데이트
    forceUpdateIndicators();
}

function submenuItemPressStart(view, element) {
    submenuCurrentItem = element;
    element.classList.add('pressing');
    
    submenuLongPressTimer = setTimeout(() => {
        registerDefaultView(view);
        element.classList.remove('pressing');
    }, LONG_PRESS_DURATION);
}

function submenuItemPressEnd() {
    if (submenuLongPressTimer) {
        clearTimeout(submenuLongPressTimer);
        submenuLongPressTimer = null;
    }
    if (submenuCurrentItem) {
        submenuCurrentItem.classList.remove('pressing');
        submenuCurrentItem = null;
    }
}

function registerDefaultView(view) {
    localStorage.setItem('chart_default_view', view);
    
    const watchlistBadge = document.getElementById('submenuWatchlistBadge');
    const chartBadge = document.getElementById('submenuChartBadge');
    
    if (view === 'watchlist') {
        watchlistBadge.style.display = 'block';
        chartBadge.style.display = 'none';
    } else {
        watchlistBadge.style.display = 'none';
        chartBadge.style.display = 'block';
    }
    
    const viewName = view === 'watchlist' ? '종목 목록' : '차트 보기';
    showSubmenuToast(viewName);
    
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
}

function showSubmenuToast(viewName) {
    const toast = document.getElementById('submenuToast');
    document.getElementById('submenuToastViewName').textContent = viewName;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2500);
}

// ========== Trade Submenu ==========
let tradeSubmenuLongPressTimer = null;
let tradeSubmenuCurrentItem = null;

function openTradeSubmenu() {
    const defaultView = localStorage.getItem('trade_default_view') || null;
    
    const buysellBadge = document.getElementById('submenuBuysellBadge');
    const quickBadge = document.getElementById('submenuQuickBadge');
    
    if (defaultView === 'buysell') {
        buysellBadge.style.display = 'block';
        quickBadge.style.display = 'none';
    } else if (defaultView === 'quick') {
        buysellBadge.style.display = 'none';
        quickBadge.style.display = 'block';
    } else {
        buysellBadge.style.display = 'none';
        quickBadge.style.display = 'none';
    }
    
    document.getElementById('tradeSubmenuOverlay').classList.add('show');
}

function closeTradeSubmenu() {
    document.getElementById('tradeSubmenuOverlay').classList.remove('show');
}

function selectTradeSubmenuItem(view) {
    closeTradeSubmenu();

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('.nav-item[data-page="trade"]').classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-trade').classList.add('active');

    showTradePanel(view);

    // Trade 탭으로 전환 시 인디케이터 강제 업데이트
    forceUpdateIndicators();
}

function showTradePanel(panel) {
    const buysellPanel = document.getElementById('buysellPanel');
    const quickPanel = document.getElementById('quickPanel');
    
    if (panel === 'buysell') {
        buysellPanel.style.display = 'block';
        quickPanel.classList.remove('active');
        quickPanel.style.display = 'none';
    } else if (panel === 'quick') {
        buysellPanel.style.display = 'none';
        quickPanel.classList.add('active');
        quickPanel.style.display = 'block';
        updateQuickPanel();
    }
}

function tradeSubmenuItemPressStart(view, element) {
    tradeSubmenuCurrentItem = element;
    element.classList.add('pressing');
    
    tradeSubmenuLongPressTimer = setTimeout(() => {
        registerTradeDefaultView(view);
        element.classList.remove('pressing');
    }, LONG_PRESS_DURATION);
}

function tradeSubmenuItemPressEnd() {
    if (tradeSubmenuLongPressTimer) {
        clearTimeout(tradeSubmenuLongPressTimer);
        tradeSubmenuLongPressTimer = null;
    }
    if (tradeSubmenuCurrentItem) {
        tradeSubmenuCurrentItem.classList.remove('pressing');
        tradeSubmenuCurrentItem = null;
    }
}

function registerTradeDefaultView(view) {
    localStorage.setItem('trade_default_view', view);
    
    const buysellBadge = document.getElementById('submenuBuysellBadge');
    const quickBadge = document.getElementById('submenuQuickBadge');
    
    if (view === 'buysell') {
        buysellBadge.style.display = 'block';
        quickBadge.style.display = 'none';
    } else {
        buysellBadge.style.display = 'none';
        quickBadge.style.display = 'block';
    }
    
    const viewName = view === 'buysell' ? 'Buy/Sell 패널' : 'Quick & Easy 패널';
    showSubmenuToast(viewName);
    
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
}

// ========== Nav Long Press ==========
let navLongPressTimer = null;
let navPressedItem = null;
let currentNavTab = 'chart';

function setupNavLongPress() {
    const chartNavItem = document.querySelector('.nav-item[data-page="chart"]');
    if (chartNavItem) {
        chartNavItem.removeAttribute('onclick');
        chartNavItem.addEventListener('touchstart', (e) => navTouchStart(e, 'chart'), { passive: true });
        chartNavItem.addEventListener('touchend', (e) => navTouchEnd(e, 'chart'));
        chartNavItem.addEventListener('touchcancel', (e) => navTouchEnd(e, 'chart'));
        chartNavItem.addEventListener('mousedown', (e) => navMouseDown(e, 'chart'));
        chartNavItem.addEventListener('mouseup', (e) => navMouseUp(e, 'chart'));
        chartNavItem.addEventListener('mouseleave', (e) => navMouseUp(e, 'chart'));
    }
    
    const tradeNavItem = document.querySelector('.nav-item[data-page="trade"]');
    if (tradeNavItem) {
        tradeNavItem.removeAttribute('onclick');
        tradeNavItem.addEventListener('touchstart', (e) => navTouchStart(e, 'trade'), { passive: true });
        tradeNavItem.addEventListener('touchend', (e) => navTouchEnd(e, 'trade'));
        tradeNavItem.addEventListener('touchcancel', (e) => navTouchEnd(e, 'trade'));
        tradeNavItem.addEventListener('mousedown', (e) => navMouseDown(e, 'trade'));
        tradeNavItem.addEventListener('mouseup', (e) => navMouseUp(e, 'trade'));
        tradeNavItem.addEventListener('mouseleave', (e) => navMouseUp(e, 'trade'));
    }
}

function navTouchStart(e, tab) {
    currentNavTab = tab;
    navPressedItem = e.currentTarget;
    navPressedItem.classList.add('long-pressing');
    
    navLongPressTimer = setTimeout(() => {
        navLongPressAction(tab);
    }, LONG_PRESS_DURATION);
}

function navTouchEnd(e, tab) {
    const wasLongPress = navLongPressTimer === null;
    
    if (navLongPressTimer) {
        clearTimeout(navLongPressTimer);
        navLongPressTimer = null;
    }
    
    if (navPressedItem) {
        navPressedItem.classList.remove('long-pressing');
    }
    
    if (!wasLongPress) {
        e.preventDefault();
        if (tab === 'chart') {
            openChartSubmenu();
        } else if (tab === 'trade') {
            openTradeSubmenu();
        }
    }
    
    navPressedItem = null;
}

function navMouseDown(e, tab) {
    currentNavTab = tab;
    navPressedItem = e.currentTarget;
    navPressedItem.classList.add('long-pressing');
    
    navLongPressTimer = setTimeout(() => {
        navLongPressAction(tab);
    }, LONG_PRESS_DURATION);
}

function navMouseUp(e, tab) {
    const wasLongPress = navLongPressTimer === null;
    
    if (navLongPressTimer) {
        clearTimeout(navLongPressTimer);
        navLongPressTimer = null;
    }
    
    if (navPressedItem) {
        navPressedItem.classList.remove('long-pressing');
    }
    
    if (!wasLongPress && e.type === 'mouseup') {
        if (tab === 'chart') {
            openChartSubmenu();
        } else if (tab === 'trade') {
            openTradeSubmenu();
        }
    }
    
    navPressedItem = null;
}

function navLongPressAction(tab) {
    navLongPressTimer = null;
    
    if (navPressedItem) {
        navPressedItem.classList.remove('long-pressing');
    }
    
    if (tab === 'chart') {
        const defaultView = localStorage.getItem('chart_default_view');
        
        if (defaultView) {
            selectSubmenuItem(defaultView);
            if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
            showToast('🚀 ' + (defaultView === 'watchlist' ? '종목 목록' : '차트') + '으로 이동!', 'success');
        } else {
            openChartSubmenu();
            showToast('💡 화면을 길게 눌러 기본 화면으로 등록하세요', '');
        }
    } else if (tab === 'trade') {
        const defaultView = localStorage.getItem('trade_default_view');
        
        if (defaultView) {
            selectTradeSubmenuItem(defaultView);
            if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
            showToast('🚀 ' + (defaultView === 'buysell' ? 'Buy/Sell 패널' : 'Quick & Easy 패널') + '으로 이동!', 'success');
        } else {
            openTradeSubmenu();
            showToast('💡 화면을 길게 눌러 기본 화면으로 등록하세요', '');
        }
    }
}

// Setup on load
document.addEventListener('DOMContentLoaded', setupNavLongPress);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setupNavLongPress();
}

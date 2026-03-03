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

// ★★★ 인디케이터 업데이트 (1~3초 랜덤 간격 큐에 위임) ★★★
function forceUpdateIndicators() {
    const data = lastWebSocketData || window.lastWebSocketData;

    if (data && data.sell_count !== undefined && typeof queueIndicatorUpdate === 'function') {
        queueIndicatorUpdate(data.buy_count || 33, data.sell_count || 33, data.neutral_count || 34);
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

            // 차트 모드 클래스 제거 (차트 탭이 아닌 경우)
            document.body.classList.remove('chart-mode');

            // 페이지별 초기화
            if (page === 'trade') {
                if (typeof GaugePanel !== 'undefined' && GaugePanel.initGaugeArcs) {
                    GaugePanel.initGaugeArcs();
                }
                // ★★★ Trading 탭 진입 시 softRefresh ★★★
                if (typeof softRefresh === 'function') {
                    softRefresh('nav_trade');
                }
            } else if (page === 'account') {
                // ★★★ Account 탭 진입 시 softRefresh ★★★
                if (typeof softRefresh === 'function') {
                    softRefresh('nav_account');
                }
                // ★ 데모 리포트 버튼 표시/숨김
                var _btn = document.getElementById('accDemoReportBtn');
                if (_btn) _btn.style.display = (typeof isDemo !== 'undefined' && isDemo) ? 'flex' : 'none';
            } else if (page === 'home') {
                // ★★★ Home 탭 진입 시 softRefresh ★★★
                if (typeof softRefresh === 'function') {
                    softRefresh('nav_home');
                }
            } else if (page === 'my') {
                // ★★★ My 탭 진입 시 메인 뷰로 리셋 ★★★
                if (typeof resetMyTab === 'function') {
                    resetMyTab();
                }
                if (typeof initMyTab === 'function') {
                    initMyTab();
                }
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

    // 차트 모드 활성화 (헤더 축소용)
    document.body.classList.add('chart-mode');

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

        // ★ Chart Order: 포지션 있으면 높이 축소 상태 복원
        if (typeof ChartOrderPanel !== 'undefined') {
            setTimeout(function() {
                if (ChartOrderPanel._allChartPositions && ChartOrderPanel._allChartPositions.length > 0) {
                    ChartOrderPanel._shrinkChartHeight();
                    ChartOrderPanel._renderPositions();
                    ChartOrderPanel._updatePriceLines();
                    ChartOrderPanel._updatePLOverlay();
                    ChartOrderPanel._updateEntryBadges();
                }
            }, 300);
        }
    }

    // Chart 탭으로 전환 시 게이지 arc 재초기화 + 인디케이터 강제 업데이트
    if (typeof ChartGaugePanel !== 'undefined' && ChartGaugePanel.initChartGaugeArcs) {
        ChartGaugePanel.initChartGaugeArcs();
    }
    forceUpdateIndicators();

    // ★★★ Chart 탭 진입 시 softRefresh ★★★
    if (typeof softRefresh === 'function') {
        softRefresh('nav_chart');
    }
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
    const multiV5Badge = document.getElementById('submenuMultiV5Badge');
    const quickBadge = document.getElementById('submenuMultiBadge');
    
    // 모든 배지 숨기기
    if (buysellBadge) buysellBadge.style.display = 'none';
    if (multiV5Badge) multiV5Badge.style.display = 'none';
    if (quickBadge) quickBadge.style.display = 'none';
    
    // 기본 패널 배지 표시
    if (defaultView === 'buysell' && buysellBadge) {
        buysellBadge.style.display = 'block';
    } else if (defaultView === 'multiV5' && multiV5Badge) {
        multiV5Badge.style.display = 'block';
    } else if (defaultView === 'multi' && quickBadge) {
        quickBadge.style.display = 'block';
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

    // Trade 탭으로 전환 시 게이지 arc 재초기화 + 인디케이터 강제 업데이트
    if (typeof GaugePanel !== 'undefined' && GaugePanel.initGaugeArcs) {
        GaugePanel.initGaugeArcs();
    }
    forceUpdateIndicators();

    // ★★★ Trade 탭 진입 시 softRefresh ★★★
    if (typeof softRefresh === 'function') {
        softRefresh('nav_trade_submenu');
    }
}

function showTradePanel(panel) {
    const buysellPanel = document.getElementById('buysellPanel');
    const multiOrderPanelV5 = document.getElementById('multiOrderPanelV5');
    const multiV5ComingSoon = document.getElementById('multiV5ComingSoon');
    const quickPanel = document.getElementById('quickPanel');
    
    // 모든 패널 숨기기
    buysellPanel.style.display = 'none';
    if (multiOrderPanelV5) {
        multiOrderPanelV5.classList.remove('active');
        multiOrderPanelV5.style.display = 'none';
    }
    if (multiV5ComingSoon) {
        multiV5ComingSoon.style.display = 'none';
    }
    if (quickPanel) {
        quickPanel.style.display = 'none';
    }
    // Quick&Easy 하단 버튼바 숨기기
    if (typeof QuickEasyPanel !== 'undefined') {
        QuickEasyPanel.hide();
    }
    
    // 선택된 패널만 표시
    if (panel === 'buysell') {
        buysellPanel.style.display = 'block';
        syncAccountInfoToPanels();
    } else if (panel === 'multiV5') {
        // ★ Multi Order V5 — 준비중 표시
        if (multiV5ComingSoon) {
            multiV5ComingSoon.style.display = 'block';
        }
    } else if (panel === 'multi') {
        // ★ Quick & Easy 패널
        if (quickPanel) {
            quickPanel.style.display = 'block';
            syncAccountInfoToPanels();
            if (typeof QuickEasyPanel !== 'undefined') {
                QuickEasyPanel.init();
                QuickEasyPanel.show();
            }
        }
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
    const multiV5Badge = document.getElementById('submenuMultiV5Badge');
    const quickBadge = document.getElementById('submenuMultiBadge');
    
    // 모든 배지 숨기기
    if (buysellBadge) buysellBadge.style.display = 'none';
    if (multiV5Badge) multiV5Badge.style.display = 'none';
    if (quickBadge) quickBadge.style.display = 'none';
    
    // 선택된 패널 배지 표시
    if (view === 'buysell' && buysellBadge) {
        buysellBadge.style.display = 'block';
    } else if (view === 'multiV5' && multiV5Badge) {
        multiV5Badge.style.display = 'block';
    } else if (view === 'multi' && quickBadge) {
        quickBadge.style.display = 'block';
    }
    
    let viewName = 'Buy/Sell 패널';
    if (view === 'multiV5') viewName = 'Multi Order V5 패널';
    else if (view === 'multi') viewName = 'Quick & Easy 패널';
    
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
            showToast('📊 ' + (defaultView === 'watchlist' ? '종목 목록' : '차트') + '으로 이동!', 'success');
        } else {
            openChartSubmenu();
            showToast('💡 화면을 길게 눌러 기본 화면으로 등록하세요', '');
        }
    } else if (tab === 'trade') {
        const defaultView = localStorage.getItem('trade_default_view');
        
        if (defaultView) {
            selectTradeSubmenuItem(defaultView);
            if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
            showToast('⇄ ' + (defaultView === 'buysell' ? 'Buy/Sell 패널' : 'Quick & Easy 패널') + '으로 이동!', 'success');
        } else {
            openTradeSubmenu();
            showToast('💡 화면을 길게 눌러 기본 화면으로 등록하세요', '');
        }
    }
}

// ========== 차트 종목 초기화 ==========
function initChartSymbolFromStorage() {
    const lastSymbol = localStorage.getItem('last_chart_symbol') || 'BTCUSD';
    const symbolInfo = getSymbolInfo(lastSymbol);
    
    // 전역 변수 업데이트
    if (typeof chartSymbol !== 'undefined') {
        chartSymbol = lastSymbol;
    }
    
    // 차트 상단 종목 표시 업데이트
    const iconEl = document.getElementById('chartSymbolIcon');
    const nameEl = document.getElementById('chartSymbolName');
    const idEl = document.getElementById('chartSymbolId');
    
    if (iconEl) {
        iconEl.textContent = symbolInfo.icon;
        iconEl.style.color = symbolInfo.color;
    }
    if (nameEl) nameEl.textContent = symbolInfo.name;
    if (idEl) idEl.textContent = lastSymbol;
    
    // ★ 하단 "종목 정보" 섹션도 업데이트
    if (typeof updateSymbolInfo === 'function') {
        updateSymbolInfo(lastSymbol);
    }
    
    console.log('[Navigation] Chart symbol initialized:', lastSymbol);
}

// Setup on load
document.addEventListener('DOMContentLoaded', function() {
    setupNavLongPress();
    initChartSymbolFromStorage();  // ★ 종목 정보 초기화 추가
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setupNavLongPress();
    initChartSymbolFromStorage();  // ★ 종목 정보 초기화 추가
}

// ========== Account Info → 패널 동기화 ==========
function syncAccountInfoToPanels() {
    // Account 탭에서 값 가져오기
    const accBalance = document.getElementById('accBalance');
    const accTodayPL = document.getElementById('accTodayPL');
    const accFree = document.getElementById('accFree');
    const accCurrentPL = document.getElementById('accCurrentPL');
    
    // Buy/Sell 패널 동기화
    const tradeBalance = document.getElementById('tradeBalance');
    const tradeTodayPL = document.getElementById('tradeTodayPL');
    
    if (tradeBalance && accBalance) {
        const balText = accBalance.textContent.replace(/[$,]/g, '');
        const bal = parseFloat(balText) || 0;
        tradeBalance.textContent = '$' + Math.round(bal).toLocaleString();
    }
    
    if (tradeTodayPL && accTodayPL) {
        tradeTodayPL.textContent = accTodayPL.textContent;
        tradeTodayPL.style.color = accTodayPL.style.color || 'var(--text-muted)';
    }
    
    // V5 Multi Order 패널 동기화
    const v5Balance = document.getElementById('v5Balance');
    const v5TodayPL = document.getElementById('v5TodayPL');
    const v5Margin = document.getElementById('v5Margin');
    
    if (v5Balance && accBalance) {
        const balText = accBalance.textContent.replace(/[$,]/g, '');
        const bal = parseFloat(balText) || 0;
        v5Balance.textContent = '$' + Math.round(bal).toLocaleString();
    }
    
    if (v5TodayPL && accTodayPL) {
        v5TodayPL.textContent = accTodayPL.textContent;
        v5TodayPL.style.color = accTodayPL.style.color || 'var(--text-muted)';
    }
    
    if (v5Margin && accFree) {
        v5Margin.textContent = accFree.textContent;
    }
    
    console.log('[syncAccountInfoToPanels] 패널 동기화 완료');
}

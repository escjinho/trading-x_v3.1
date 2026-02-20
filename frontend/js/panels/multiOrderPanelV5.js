// ========================================
// Multi Order Panel V5 - 다중 패널 지원
// ========================================

// V5 전용 상수
const V5_MAGIC_NUMBER = 100002;
const V5_MAX_PANELS = 5;

// 패널 데이터 배열
let v5Panels = [
    { 
        id: 1, 
        symbol: 'BTCUSD', 
        lot: 0.01, 
        isLimit: false,
        symbolInfo: { icon: '₿', color: '#f7931a', name: 'Bitcoin' }
    }
];

// 기본 종목 목록 (패널 추가 시 순서대로 사용)
const v5DefaultSymbols = [
    { symbol: 'BTCUSD', icon: '₿', color: '#f7931a', name: 'Bitcoin' },
    { symbol: 'XAUUSD.r', icon: '✦', color: '#ffd700', name: 'Gold' },
    { symbol: 'EURUSD.r', icon: '€', color: '#0052cc', name: 'Euro/Dollar' },
    { symbol: 'ETHUSD', icon: 'Ξ', color: '#627eea', name: 'Ethereum' },
    { symbol: 'US100.', icon: '⬡', color: '#00b450', name: 'NASDAQ' }
];

// V5 포지션 데이터
let v5Positions = [];

// ========== 초기화 ==========
function initMultiOrderPanelV5() {
    console.log('[V5] Panel initialized');
    updateV5AccountInfo();
    updateAllV5Prices();
    fetchV5Positions();
    updateV5PanelCount();
}

// ========== 패널 카운트 업데이트 ==========
function updateV5PanelCount() {
    const countEl = document.getElementById('v5PanelsCount');
    if (countEl) {
        countEl.textContent = `${v5Panels.length}/${V5_MAX_PANELS}`;
    }
}

// ========== 패널 추가 ==========
function addV5Panel() {
    if (v5Panels.length >= V5_MAX_PANELS) {
        showToast('⚠️ 최대 5개까지만 추가할 수 있습니다', 'error');
        return;
    }
    
    // 다음 패널 ID
    const newId = Math.max(...v5Panels.map(p => p.id)) + 1;
    
    // 사용되지 않은 종목 찾기
    const usedSymbols = v5Panels.map(p => p.symbol);
    const availableSymbol = v5DefaultSymbols.find(s => !usedSymbols.includes(s.symbol)) 
        || v5DefaultSymbols[1]; // 기본값: XAUUSD.r
    
    // 새 패널 데이터 추가
    const newPanel = {
        id: newId,
        symbol: availableSymbol.symbol,
        lot: 0.01,
        isLimit: false,
        symbolInfo: {
            icon: availableSymbol.icon,
            color: availableSymbol.color,
            name: availableSymbol.name
        }
    };
    v5Panels.push(newPanel);
    
    // HTML 생성 및 삽입
    const container = document.querySelector('.v5-order-section');
    const addBtn = container.querySelector('.v5-add-panel-btn');
    
    const panelHTML = createV5PanelHTML(newPanel);
    addBtn.insertAdjacentHTML('beforebegin', panelHTML);
    
    // 카운트 업데이트
    updateV5PanelCount();
    
    // 가격 업데이트
    updateV5PanelPrices(newId);
    
    showToast(`✅ ${availableSymbol.name} 패널 추가됨!`, 'success');
}

// ========== 패널 삭제 ==========
function removeV5Panel(panelId) {
    if (v5Panels.length <= 1) {
        showToast('⚠️ 최소 1개의 패널은 필요합니다', 'error');
        return;
    }
    
    // 배열에서 제거
    const panelIndex = v5Panels.findIndex(p => p.id === panelId);
    if (panelIndex === -1) return;
    
    const removedPanel = v5Panels[panelIndex];
    v5Panels.splice(panelIndex, 1);
    
    // DOM에서 제거
    const panelEl = document.getElementById(`v5OrderPanel${panelId}`);
    if (panelEl) {
        panelEl.remove();
    }
    
    // 카운트 업데이트
    updateV5PanelCount();
    
    showToast(`🗑️ ${removedPanel.symbolInfo.name} 패널 삭제됨`, '');
}

// ========== 패널 HTML 생성 ==========
function createV5PanelHTML(panel) {
    const { id, symbol, lot, symbolInfo } = panel;
    
    return `
        <div class="v5-order-panel" id="v5OrderPanel${id}">
            <!-- 종목 헤더 + Market/Limit 토글 + 삭제 버튼 -->
            <div class="v5-order-header">
                <div class="v5-symbol-simple" onclick="openV5SymbolPopupFor(${id})">
                    <span class="v5-symbol-icon" id="v5SymbolIcon${id}" style="color: ${symbolInfo.color};">${symbolInfo.icon}</span>
                    <span class="v5-symbol-id">
                        <span id="v5SymbolName${id}">${symbol}</span>
                        <span class="material-icons-round">expand_more</span>
                    </span>
                </div>
                <div class="v5-header-right">
                    <div class="v5-type-toggle">
                        <span class="v5-toggle-label active" id="v5MarketLabel${id}">Market</span>
                        <div class="v5-toggle-switch" id="v5TypeToggle${id}" onclick="toggleV5OrderTypeFor(${id})"></div>
                        <span class="v5-toggle-label" id="v5LimitLabel${id}">Limit</span>
                    </div>
                    <button class="v5-panel-delete-btn-inline" onclick="removeV5Panel(${id})" title="패널 삭제">
                        <span class="material-icons-round">close</span>
                    </button>
                </div>
            </div>
            
            <!-- 지정가 입력 -->
            <div class="v5-limit-section" id="v5LimitSection${id}">
                <div class="v5-limit-row">
                    <label>Price:</label>
                    <input type="text" class="v5-limit-input" id="v5LimitPrice${id}" placeholder="0.00">
                </div>
            </div>
            
            <!-- 랏수 영역 -->
            <div class="v5-lot-section">
                <div class="v5-lot-row">
                    <div class="v5-lot-control">
                        <button class="v5-lot-btn" onclick="adjustV5LotFor(${id}, -0.01)">−</button>
                        <input type="text" class="v5-lot-input" id="v5LotInput${id}" value="${lot.toFixed(2)}" onclick="this.select()" onchange="validateV5LotFor(${id}, this)">
                        <button class="v5-lot-btn" onclick="adjustV5LotFor(${id}, 0.01)">+</button>
                    </div>
                    <button class="v5-lot-settings" onclick="openV5LotPopupFor(${id})">
                        <span class="material-icons-round">settings</span>
                    </button>
                </div>
            </div>
            
            <!-- 주문 버튼 -->
            <div class="v5-order-buttons">
                <div class="v5-order-buttons-row">
                    <button class="v5-order-btn sell" onclick="v5SellFor(${id})">
                        SELL
                        <span class="v5-order-btn-price" id="v5BidPrice${id}">0.00</span>
                    </button>
                    <button class="v5-order-btn buy" onclick="v5BuyFor(${id})">
                        BUY
                        <span class="v5-order-btn-price" id="v5AskPrice${id}">0.00</span>
                    </button>
                </div>
                <button class="v5-order-btn close-position" onclick="v5CloseSymbolFor(${id})">
                    CLOSE POSITION
                </button>
            </div>
            
            <!-- 포지션 리스트 -->
            <div class="v5-position-list" id="v5PositionListWrapper${id}">
                <div class="v5-position-header">
                    <div class="v5-position-title">
                        <span class="material-icons-round" style="font-size: 14px;">list_alt</span>
                        OPEN POSITIONS
                    </div>
                    <button class="v5-sltp-btn" onclick="openV5SltpPopupFor(${id})">SL/TP</button>
                </div>
                <div id="v5PositionList${id}"></div>
            </div>
        </div>
    `;
}

// ========== 첫 번째 패널은 삭제 버튼 없음 ==========
function updateFirstPanelWithDeleteButton() {
    // 첫 번째 패널은 삭제 불가 - 아무것도 하지 않음
}

// ========== 계좌 정보 업데이트 ==========
async function updateV5AccountInfo() {
    const balanceEl = document.getElementById('v5Balance');
    const todayPLEl = document.getElementById('v5TodayPL');
    const marginEl = document.getElementById('v5Margin');
    const currentPLEl = document.getElementById('v5CurrentPL');
    
    if (balanceEl) {
        const accBalance = document.getElementById('accBalance');
        if (accBalance) {
            const balText = accBalance.textContent.replace(/[$,]/g, '');
            const bal = parseFloat(balText) || 0;
            balanceEl.textContent = '$' + Math.round(bal).toLocaleString();
        } else {
            const bal = typeof balance !== 'undefined' ? balance : 0;
            balanceEl.textContent = '$' + Math.round(bal).toLocaleString();
        }
    }
    
    if (todayPLEl) {
        const accTodayPL = document.getElementById('accTodayPL');
        if (accTodayPL) {
            todayPLEl.textContent = accTodayPL.textContent;
            todayPLEl.style.color = accTodayPL.style.color || 'var(--text-muted)';
        }
    }
    
    if (marginEl) {
        const accFree = document.getElementById('accFree');
        if (accFree) {
            marginEl.textContent = accFree.textContent;
        }
    }
    
    let currentPL = 0;
    if (v5Positions && v5Positions.length > 0) {
        v5Positions.forEach(pos => currentPL += pos.profit || 0);
    }
    
    if (currentPLEl) {
        if (currentPL >= 0) {
            currentPLEl.textContent = '+$' + Math.abs(currentPL).toFixed(2);
            currentPLEl.className = 'v5-account-value positive';
        } else {
            currentPLEl.textContent = '-$' + Math.abs(currentPL).toFixed(2);
            currentPLEl.className = 'v5-account-value negative';
        }
    }
}

// ========== 모든 패널 가격 업데이트 ==========
function updateAllV5Prices() {
    v5Panels.forEach(panel => {
        updateV5PanelPrices(panel.id);
    });
}

// ========== 개별 패널 가격 업데이트 ==========
function updateV5PanelPrices(panelId) {
    const panel = v5Panels.find(p => p.id === panelId);
    if (!panel) return;
    
    // 첫 번째 패널은 숫자 없는 ID 사용 (HTML 호환)
    const idSuffix = panelId === 1 ? '' : panelId;
    const bidEl = document.getElementById(`v5BidPrice${idSuffix}`);
    const askEl = document.getElementById(`v5AskPrice${idSuffix}`);
    
    if (!bidEl || !askEl) return;
    
    const prices = window.allPrices?.[panel.symbol] || watchlistPrices[panel.symbol] || demoQuotes[panel.symbol];
    if (prices) {
        const decimals = getDecimalsForSymbol(panel.symbol);
        bidEl.textContent = prices.bid.toFixed(decimals);
        askEl.textContent = prices.ask.toFixed(decimals);
    }
}

// ========== 레거시 함수 (첫 번째 패널용) ==========
function updateV5Prices() {
    updateV5PanelPrices(1);
}

// ========== 종목 관련 ==========
let currentV5PopupPanelId = 1;

function openV5SymbolPopupFor(panelId) {
    currentV5PopupPanelId = panelId;
    renderV5SymbolListFor(panelId);
    document.getElementById('v5SymbolPopup').classList.add('show');
}

function openV5SymbolPopup() {
    openV5SymbolPopupFor(1);
}

function renderV5SymbolListFor(panelId) {
    const container = document.getElementById('v5SymbolList');
    if (!container) return;
    
    const panel = v5Panels.find(p => p.id === panelId);
    const currentSymbol = panel ? panel.symbol : 'BTCUSD';
    
    const symbols = [
        { id: 'BTCUSD', name: 'Bitcoin', icon: '₿', color: '#f7931a' },
        { id: 'ETHUSD', name: 'Ethereum', icon: 'Ξ', color: '#627eea' },
        { id: 'EURUSD.r', name: 'Euro/Dollar', icon: '€', color: '#0052cc' },
        { id: 'USDJPY.r', name: 'Dollar/Yen', icon: '¥', color: '#dc143c' },
        { id: 'XAUUSD.r', name: 'Gold', icon: '✦', color: '#ffd700' },
        { id: 'US100.', name: 'NASDAQ', icon: '⬡', color: '#00b450' }
    ];
    
    container.innerHTML = symbols.map(s => `
        <div class="v5-symbol-item ${s.id === currentSymbol ? 'selected' : ''}" 
             onclick="selectV5SymbolFor(${panelId}, '${s.id}', '${s.icon}', '${s.color}', '${s.name}')"
             style="display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 10px; cursor: pointer; transition: all 0.2s; border: 1px solid ${s.id === currentSymbol ? 'var(--accent-cyan)' : 'transparent'}; background: ${s.id === currentSymbol ? 'rgba(0, 212, 255, 0.1)' : 'transparent'};">
            <div style="width: 36px; height: 36px; background: var(--bg-tertiary); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 18px; color: ${s.color};">${s.icon}</div>
            <div style="flex: 1;">
                <div style="font-size: 14px; font-weight: 700;">${s.name}</div>
                <div style="font-size: 10px; color: var(--text-muted);">${s.id}</div>
            </div>
            ${s.id === currentSymbol ? '<span class="material-icons-round" style="color: var(--accent-cyan);">check_circle</span>' : ''}
        </div>
    `).join('');
}

function renderV5SymbolList() {
    renderV5SymbolListFor(1);
}

function selectV5SymbolFor(panelId, symbol, icon, color, name) {
    const panel = v5Panels.find(p => p.id === panelId);
    if (!panel) return;
    
    panel.symbol = symbol;
    panel.symbolInfo = { icon, color, name };
    
    // 첫 번째 패널은 숫자 없는 ID 사용 (HTML 호환)
    const idSuffix = panelId === 1 ? '' : panelId;
    const iconEl = document.getElementById(`v5SymbolIcon${idSuffix}`);
    const nameEl = document.getElementById(`v5SymbolName${idSuffix}`);
    
    if (iconEl) {
        iconEl.textContent = icon;
        iconEl.style.color = color;
    }
    if (nameEl) {
        nameEl.textContent = symbol;
    }
    
    closeV5SymbolPopup();
    updateV5PanelPrices(panelId);
    updateV5PositionListFor(panelId);
    
    showToast(`📊 ${name} 선택됨`, 'success');
}

function selectV5Symbol(symbol) {
    const symbolInfo = getSymbolInfo(symbol);
    selectV5SymbolFor(1, symbol, symbolInfo.icon, symbolInfo.color, symbolInfo.name);
}

function closeV5SymbolPopup(event) {
    if (!event || event.target === document.getElementById('v5SymbolPopup')) {
        document.getElementById('v5SymbolPopup').classList.remove('show');
    }
}

// ========== Market/Limit 토글 ==========
function toggleV5OrderTypeFor(panelId) {
    const panel = v5Panels.find(p => p.id === panelId);
    if (!panel) return;
    
    // 첫 번째 패널은 숫자 없는 ID 사용 (HTML 호환)
    const idSuffix = panelId === 1 ? '' : panelId;
    const toggle = document.getElementById(`v5TypeToggle${idSuffix}`);
    const limitSection = document.getElementById(`v5LimitSection${idSuffix}`);
    const marketLabel = document.getElementById(`v5MarketLabel${idSuffix}`);
    const limitLabel = document.getElementById(`v5LimitLabel${idSuffix}`);
    
    panel.isLimit = !panel.isLimit;
    
    if (panel.isLimit) {
        toggle.classList.add('limit');
        limitSection.classList.add('show');
        marketLabel.classList.remove('active');
        limitLabel.classList.add('active');
    } else {
        toggle.classList.remove('limit');
        limitSection.classList.remove('show');
        marketLabel.classList.add('active');
        limitLabel.classList.remove('active');
    }
}

function toggleV5OrderType() {
    toggleV5OrderTypeFor(1);
}

// ========== 랏수 관련 ==========
function adjustV5LotFor(panelId, delta) {
    const panel = v5Panels.find(p => p.id === panelId);
    if (!panel) return;
    
    // 첫 번째 패널은 숫자 없는 ID 사용 (HTML 호환)
    const idSuffix = panelId === 1 ? '' : panelId;
    const input = document.getElementById(`v5LotInput${idSuffix}`);
    let value = parseFloat(input.value) || 0.01;
    value = Math.max(0.01, Math.min(10, value + delta));
    value = Math.round(value * 100) / 100;
    input.value = value.toFixed(2);
    panel.lot = value;
}

function adjustV5Lot(delta) {
    adjustV5LotFor(1, delta);
}

function validateV5LotFor(panelId, input) {
    const panel = v5Panels.find(p => p.id === panelId);
    if (!panel) return;
    
    let value = parseFloat(input.value);
    if (isNaN(value) || value < 0.01) value = 0.01;
    if (value > 10) value = 10;
    value = Math.round(value * 100) / 100;
    input.value = value.toFixed(2);
    panel.lot = value;
}

function validateV5Lot(input) {
    validateV5LotFor(1, input);
}

let currentV5LotPanelId = 1;

function openV5LotPopupFor(panelId) {
    currentV5LotPanelId = panelId;
    document.getElementById('v5LotPopup').classList.add('show');
}

function openV5LotPopup() {
    openV5LotPopupFor(1);
}

function setV5Lot(value) {
    const panel = v5Panels.find(p => p.id === currentV5LotPanelId);
    if (!panel) return;
    
    // 첫 번째 패널은 숫자 없는 ID 사용 (HTML 호환)
    const idSuffix = currentV5LotPanelId === 1 ? '' : currentV5LotPanelId;
    const input = document.getElementById(`v5LotInput${idSuffix}`);
    if (input) {
        input.value = value.toFixed(2);
        panel.lot = value;
    }
    closeV5LotPopup();
    showToast(`랏수 ${value.toFixed(2)} 설정됨`, 'success');
}

function closeV5LotPopup(event) {
    if (!event || event.target === document.getElementById('v5LotPopup')) {
        document.getElementById('v5LotPopup').classList.remove('show');
    }
}

// ========== 주문 기능 ==========
async function v5BuyFor(panelId) {
    if (!checkGuestAction('trade')) return;
    
    const panel = v5Panels.find(p => p.id === panelId);
    if (!panel) return;
    
    showToast(`⚡ ${panel.symbol} BUY 실행!`, 'success');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/order?symbol=${panel.symbol}&order_type=BUY&volume=${panel.lot}&target=0&magic=${V5_MAGIC_NUMBER}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) {
                playSound('buy');
                fetchDemoData();
                setTimeout(() => updateMultiOrderPanelV5(), 500);
            } else {
                showToast(result?.message || 'Error', 'error');
            }
        } else {
            const result = await apiCall(`/mt5/order?symbol=${panel.symbol}&order_type=BUY&volume=${panel.lot}&target=0&magic=${V5_MAGIC_NUMBER}`, 'POST');
            if (result?.success) {
                playSound('buy');
                showToast(`✅ [Chart] ${panel.symbol} BUY ${panel.lot}lot 체결`, 'success');
                setTimeout(() => updateMultiOrderPanelV5(), 500);
            } else {
                showToast(result?.message || '주문 실패', 'error');
            }
        }
    } catch (e) {
        console.error('[V5] BUY error:', e);
        showToast('Network error', 'error');
    }
}

function v5Buy() {
    v5BuyFor(1);
}

async function v5SellFor(panelId) {
    if (!checkGuestAction('trade')) return;
    
    const panel = v5Panels.find(p => p.id === panelId);
    if (!panel) return;
    
    showToast(`⚡ ${panel.symbol} SELL 실행!`, 'success');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/order?symbol=${panel.symbol}&order_type=SELL&volume=${panel.lot}&target=0&magic=${V5_MAGIC_NUMBER}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) {
                playSound('sell');
                fetchDemoData();
                setTimeout(() => updateMultiOrderPanelV5(), 500);
            } else {
                showToast(result?.message || 'Error', 'error');
            }
        } else {
            const result = await apiCall(`/mt5/order?symbol=${panel.symbol}&order_type=SELL&volume=${panel.lot}&target=0&magic=${V5_MAGIC_NUMBER}`, 'POST');
            if (result?.success) {
                playSound('sell');
                showToast(`✅ [Chart] ${panel.symbol} SELL ${panel.lot}lot 체결`, 'success');
                setTimeout(() => updateMultiOrderPanelV5(), 500);
            } else {
                showToast(result?.message || '주문 실패', 'error');
            }
        }
    } catch (e) {
        console.error('[V5] SELL error:', e);
        showToast('Network error', 'error');
    }
}

function v5Sell() {
    v5SellFor(1);
}

// ========== 청산 기능 ==========
async function v5CloseSymbolFor(panelId) {
    if (!checkGuestAction('trade')) return;
    
    const panel = v5Panels.find(p => p.id === panelId);
    if (!panel) return;
    
    showToast(`🟠 ${panel.symbol} 청산!`, 'error');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close?symbol=${panel.symbol}&magic=${V5_MAGIC_NUMBER}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) {
                playSound('close');
                fetchDemoData();
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.profit || 0);
                }
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            } else {
                showToast(result?.message || '청산 실패', 'error');
            }
        } else {
            const result = await apiCall(`/mt5/close?symbol=${panel.symbol}&magic=${V5_MAGIC_NUMBER}`, 'POST');
            if (result?.success) {
                playSound('close');
                showToast('✅ 청산 완료!', 'success');
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.profit || 0);
                }
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            } else {
                showToast(result?.message || '청산 실패', 'error');
            }
        }
    } catch (e) {
        console.error('[V5] CloseSymbol error:', e);
        showToast('Network error', 'error');
    }
}

function v5CloseSymbol() {
    v5CloseSymbolFor(1);
}

async function v5CloseAll() {
    if (!checkGuestAction('trade')) return;
    if (!confirm('모든 포지션을 청산하시겠습니까?')) return;
    
    showToast('🔴 일괄 청산 실행!', 'error');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close-all?magic=${V5_MAGIC_NUMBER}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) {
                playSound('close');
                fetchDemoData();
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            } else {
                showToast(result?.message || '청산 실패', 'error');
            }
        } else {
            const result = await apiCall(`/mt5/close-all?magic=${V5_MAGIC_NUMBER}`, 'POST');
            if (result?.success) {
                playSound('close');
                showToast('✅ 전체 청산 완료!', 'success');
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            } else {
                showToast(result?.message || '청산 실패', 'error');
            }
        }
    } catch (e) {
        console.error('[V5] CloseAll error:', e);
        showToast('Network error', 'error');
    }
}

async function v5CloseBuy() {
    if (!checkGuestAction('trade')) return;
    showToast('🟢 매수 포지션 청산!', 'success');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close-by-type?type=BUY&magic=${V5_MAGIC_NUMBER}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) { 
                playSound('close'); 
                fetchDemoData(); 
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            } else {
                showToast(result?.message || '청산 실패', 'error');
            }
        } else {
            const result = await apiCall(`/mt5/close-by-type?type=BUY&magic=${V5_MAGIC_NUMBER}`, 'POST');
            if (result?.success) { 
                playSound('close'); 
                showToast('✅ 매수 청산 완료!', 'success');
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            } else {
                showToast(result?.message || '청산 실패', 'error');
            }
        }
    } catch (e) { 
        showToast('Network error', 'error'); 
    }
}

async function v5CloseSell() {
    if (!checkGuestAction('trade')) return;
    showToast('🔴 매도 포지션 청산!', 'error');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close-by-type?type=SELL&magic=${V5_MAGIC_NUMBER}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) { 
                playSound('close'); 
                fetchDemoData(); 
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            } else {
                showToast(result?.message || '청산 실패', 'error');
            }
        } else {
            const result = await apiCall(`/mt5/close-by-type?type=SELL&magic=${V5_MAGIC_NUMBER}`, 'POST');
            if (result?.success) { 
                playSound('close'); 
                showToast('✅ 매도 청산 완료!', 'success');
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            } else {
                showToast(result?.message || '청산 실패', 'error');
            }
        }
    } catch (e) { 
        showToast('Network error', 'error'); 
    }
}

async function v5CloseProfit() {
    if (!checkGuestAction('trade')) return;
    showToast('💰 수익 포지션 청산!', 'success');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close-by-profit?profit_type=positive&magic=${V5_MAGIC_NUMBER}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) { 
                playSound('close'); 
                fetchDemoData(); 
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            } else {
                showToast(result?.message || '청산 실패', 'error');
            }
        } else {
            const result = await apiCall(`/mt5/close-by-profit?profit_type=positive&magic=${V5_MAGIC_NUMBER}`, 'POST');
            if (result?.success) { 
                playSound('close'); 
                showToast('✅ 수익 청산 완료!', 'success');
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            } else {
                showToast(result?.message || '청산 실패', 'error');
            }
        }
    } catch (e) { 
        showToast('Network error', 'error'); 
    }
}

async function v5CloseLoss() {
    if (!checkGuestAction('trade')) return;
    showToast('💔 손실 포지션 청산!', 'error');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close-by-profit?profit_type=negative&magic=${V5_MAGIC_NUMBER}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) { 
                playSound('close'); 
                fetchDemoData(); 
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            } else {
                showToast(result?.message || '청산 실패', 'error');
            }
        } else {
            const result = await apiCall(`/mt5/close-by-profit?profit_type=negative&magic=${V5_MAGIC_NUMBER}`, 'POST');
            if (result?.success) { 
                playSound('close'); 
                showToast('✅ 손실 청산 완료!', 'success');
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            } else {
                showToast(result?.message || '청산 실패', 'error');
            }
        }
    } catch (e) { 
        showToast('Network error', 'error'); 
    }
}

async function v5ClosePosition(ticket) {
    if (!checkGuestAction('trade')) return;
    showToast(`🔴 포지션 #${ticket} 청산!`, 'error');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close?ticket=${ticket}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) { 
                playSound('close'); 
                fetchDemoData(); 
                setTimeout(() => updateMultiOrderPanelV5(), 500);
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.profit || 0);
                }
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            }
        } else {
            const result = await apiCall(`/mt5/close?ticket=${ticket}`, 'POST');
            if (result?.success) { 
                playSound('close'); 
                setTimeout(() => updateMultiOrderPanelV5(), 500);
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.profit || 0);
                }
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            }
        }
    } catch (e) { 
        showToast('Network error', 'error'); 
    }
}

// ========== SL/TP ==========
let currentV5SltpPanelId = 1;

function openV5SltpPopupFor(panelId) {
    currentV5SltpPanelId = panelId;
    document.getElementById('v5SltpPopup').classList.add('show');
}

function openV5SltpPopup() {
    openV5SltpPopupFor(1);
}

function closeV5SltpPopup(event) {
    if (!event || event.target === document.getElementById('v5SltpPopup')) {
        document.getElementById('v5SltpPopup').classList.remove('show');
    }
}

async function applyV5SLTP() {
    if (!checkGuestAction('trade')) return;
    
    const panel = v5Panels.find(p => p.id === currentV5SltpPanelId);
    if (!panel) return;
    
    const tp = document.getElementById('v5TPInput').value;
    const sl = document.getElementById('v5SLInput').value;
    
    if (!tp && !sl) {
        showToast('SL 또는 TP 값을 입력하세요', 'error');
        return;
    }
    
    showToast(`✅ SL: ${sl || '-'} / TP: ${tp || '-'} 적용!`, 'success');
    closeV5SltpPopup();
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/set-sltp?symbol=${panel.symbol}&sl=${sl || 0}&tp=${tp || 0}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) fetchDemoData();
        } else {
            await apiCall(`/mt5/set-sltp?symbol=${panel.symbol}&sl=${sl || 0}&tp=${tp || 0}`, 'POST');
        }
    } catch (e) { 
        showToast('Network error', 'error'); 
    }
}

// ========== V5 전용 포지션 조회 ==========
async function fetchV5Positions() {
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/positions?magic=${V5_MAGIC_NUMBER}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.positions) {
                v5Positions = result.positions;
            } else {
                v5Positions = [];
            }
            updateAllV5PositionLists();
            return;
        }
        
        const result = await apiCall(`/mt5/positions?magic=${V5_MAGIC_NUMBER}`);
        
        if (result?.positions) {
            v5Positions = result.positions;
        } else {
            v5Positions = [];
        }
        
        updateAllV5PositionLists();
    } catch (e) {
        console.error('[V5] Position fetch error:', e);
        updateAllV5PositionLists();
    }
}

// ========== 모든 패널 포지션 리스트 업데이트 ==========
function updateAllV5PositionLists() {
    v5Panels.forEach(panel => {
        updateV5PositionListFor(panel.id);
    });
}

// ========== 개별 패널 포지션 리스트 업데이트 ==========
function updateV5PositionListFor(panelId) {
    const panel = v5Panels.find(p => p.id === panelId);
    if (!panel) return;
    
    // 첫 번째 패널은 숫자 없는 ID 사용 (HTML 호환)
    const idSuffix = panelId === 1 ? '' : panelId;
    const container = document.getElementById(`v5PositionList${idSuffix}`);
    const listWrapper = document.getElementById(`v5PositionListWrapper${idSuffix}`);
    
    if (!container) return;
    
    // 해당 패널 종목의 포지션만 필터링
    const panelPositions = v5Positions.filter(pos => pos.symbol === panel.symbol);
    
    if (panelPositions.length > 0) {
        if (listWrapper) listWrapper.classList.add('has-positions');
        container.innerHTML = panelPositions.map((pos, idx) => {
            // ★★★ 포지션 타입 정규화 (POSITION_TYPE_BUY → BUY) ★★★
            const posType = String(pos.type || '').toUpperCase();
            const isBuy = posType === 'BUY' || posType.includes('BUY') || pos.type === 0;
            const typeText = isBuy ? 'BUY' : 'SELL';
            const profitClass = pos.profit >= 0 ? 'positive' : 'negative';
            const profitSign = pos.profit >= 0 ? '+' : '';
            const decimals = getDecimalsForSymbol(pos.symbol || panel.symbol);
            const hasSLTP = pos.sl || pos.tp;
            
            return `
                <div class="v5-position-wrapper">
                    <div class="v5-position-item ${isBuy ? '' : 'sell'} ${hasSLTP ? 'has-sltp' : ''}">
                        <span class="v5-position-type ${isBuy ? 'buy' : 'sell'}">${typeText}</span>
                        <div class="v5-position-info">
                            <div><span>${pos.volume?.toFixed(2) || '0.01'}</span> lot</div>
                            <div>@ <span>${pos.entry?.toFixed(decimals) || '-'}</span></div>
                        </div>
                        <div class="v5-position-profit ${profitClass}">${profitSign}$${pos.profit?.toFixed(2) || '0.00'}</div>
                        <button class="v5-position-close" onclick="v5ClosePosition(${pos.ticket || idx})">
                            <span class="material-icons-round" style="font-size: 14px;">close</span>
                        </button>
                    </div>
                    ${hasSLTP ? `
                    <div class="v5-position-sltp">
                        ${pos.sl ? `<span><span class="label">SL:</span> <span class="sl">${pos.sl}</span></span>` : ''}
                        ${pos.tp ? `<span><span class="label">TP:</span> <span class="tp">${pos.tp}</span></span>` : ''}
                    </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    } else {
        if (listWrapper) listWrapper.classList.remove('has-positions');
        container.innerHTML = '';
    }
}

// 레거시 함수
function updateV5PositionList() {
    updateV5PositionListFor(1);
}

// ========== 데이터 업데이트 (외부 호출용) ==========
async function updateMultiOrderPanelV5() {
    await fetchV5Positions();
    await updateV5AccountInfo();
    updateAllV5Prices();
}

function updateV5PanelFromData(data) {
    if (!data) return;
    
    balance = data.balance || balance;
    updateV5AccountInfo();
    
    if (data.positions && Array.isArray(data.positions)) {
        v5Positions = data.positions.filter(p => p.magic === V5_MAGIC_NUMBER);
    } else {
        v5Positions = [];
    }
    
    updateAllV5PositionLists();
    updateAllV5Prices();
}

// ========== 초기화 ==========
document.addEventListener('DOMContentLoaded', function() {
    // 첫 번째 패널에 삭제 버튼 추가
    setTimeout(() => {
        updateFirstPanelWithDeleteButton();
    }, 500);
    
    // 주기적 가격 업데이트
    setInterval(() => {
        const panel = document.getElementById('multiOrderPanelV5');
        if (panel && panel.classList.contains('active')) {
            updateAllV5Prices();
        }
    }, 500);
});

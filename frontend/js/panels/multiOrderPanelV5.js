// ========================================
// Multi Order Panel V5
// ========================================

// V5 전용 변수
let v5Symbol = 'BTCUSD';
let v5Lot = 0.01;
let v5Positions = [];
let v5IsLimit = false;
const V5_MAGIC_NUMBER = 100002;  // V5 패널 전용 매직넘버

// ========== 초기화 ==========
function initMultiOrderPanelV5() {
    console.log('[V5] Panel initialized');
    updateV5AccountInfo();
    updateV5Prices();
    fetchV5Positions();
    renderV5SymbolList();
}

// ========== 계좌 정보 업데이트 ==========
async function updateV5AccountInfo() {
    const balanceEl = document.getElementById('v5Balance');
    const todayPLEl = document.getElementById('v5TodayPL');
    const marginEl = document.getElementById('v5Margin');
    const currentPLEl = document.getElementById('v5CurrentPL');
    
    // Balance, Today P/L, Margin은 Account 탭과 동일한 전역 값 사용
    // (WebSocket 또는 fetchDemoData에서 이미 업데이트된 값)
    
    if (balanceEl) {
        // Account 탭의 balance 값을 직접 읽어오기 (가장 정확)
        const accBalance = document.getElementById('accBalance');
        if (accBalance) {
            const balText = accBalance.textContent.replace(/[$,]/g, '');
            const bal = parseFloat(balText) || 0;
            balanceEl.textContent = '$' + Math.round(bal).toLocaleString();
        } else {
            // fallback: 전역 변수
            const bal = typeof balance !== 'undefined' ? balance : 0;
            balanceEl.textContent = '$' + Math.round(bal).toLocaleString();
        }
    }
    
    // Today P/L - Account 탭의 값과 동일
    if (todayPLEl) {
        const accTodayPL = document.getElementById('accTodayPL');
        if (accTodayPL) {
            todayPLEl.textContent = accTodayPL.textContent;
            // 색상도 Account 탭과 동일하게
            todayPLEl.style.color = accTodayPL.style.color || 'var(--text-muted)';
        }
    }
    
    // Margin - Account 탭의 값과 동일
    if (marginEl) {
        const accFree = document.getElementById('accFree');
        if (accFree) {
            marginEl.textContent = accFree.textContent;
        }
    }
    
    // Current P/L - V5 포지션만 계산
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

// ========== 가격 업데이트 ==========
function updateV5Prices() {
    const bidEl = document.getElementById('v5BidPrice');
    const askEl = document.getElementById('v5AskPrice');
    
    if (!bidEl || !askEl) return;
    
    const prices = watchlistPrices[v5Symbol] || demoQuotes[v5Symbol];
    if (prices) {
        const decimals = getDecimalsForSymbol(v5Symbol);
        bidEl.textContent = prices.bid.toFixed(decimals);
        askEl.textContent = prices.ask.toFixed(decimals);
    }
}

// ========== 종목 관련 ==========
function renderV5SymbolList() {
    const container = document.getElementById('v5SymbolList');
    if (!container) return;
    
    const symbols = [
        { id: 'BTCUSD', name: 'Bitcoin', icon: '₿', color: '#f7931a' },
        { id: 'ETHUSD', name: 'Ethereum', icon: 'Ξ', color: '#627eea' },
        { id: 'EURUSD.r', name: 'Euro/Dollar', icon: '€', color: '#0052cc' },
        { id: 'USDJPY.r', name: 'Dollar/Yen', icon: '¥', color: '#dc143c' },
        { id: 'XAUUSD.r', name: 'Gold', icon: '✦', color: '#ffd700' },
        { id: 'US100.', name: 'NASDAQ', icon: '⬡', color: '#00b450' }
    ];
    
    container.innerHTML = symbols.map(s => `
        <div class="v5-symbol-item ${s.id === v5Symbol ? 'selected' : ''}" 
             onclick="selectV5Symbol('${s.id}')"
             style="display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 10px; cursor: pointer; transition: all 0.2s; border: 1px solid ${s.id === v5Symbol ? 'var(--accent-cyan)' : 'transparent'}; background: ${s.id === v5Symbol ? 'rgba(0, 212, 255, 0.1)' : 'transparent'};">
            <div style="width: 36px; height: 36px; background: var(--bg-tertiary); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 18px; color: ${s.color};">${s.icon}</div>
            <div style="flex: 1;">
                <div style="font-size: 14px; font-weight: 700;">${s.name}</div>
                <div style="font-size: 10px; color: var(--text-muted);">${s.id}</div>
            </div>
            ${s.id === v5Symbol ? '<span class="material-icons-round" style="color: var(--accent-cyan);">check_circle</span>' : ''}
        </div>
    `).join('');
}

function selectV5Symbol(symbol) {
    v5Symbol = symbol;
    const symbolInfo = getSymbolInfo(symbol);
    
    document.getElementById('v5SymbolIcon').textContent = symbolInfo.icon;
    document.getElementById('v5SymbolIcon').style.color = symbolInfo.color;
    document.getElementById('v5SymbolName').textContent = symbol;
    
    closeV5SymbolPopup();
    updateV5Prices();
    renderV5SymbolList();
    
    showToast(`📊 ${symbolInfo.name} 선택됨`, 'success');
}

function openV5SymbolPopup() {
    document.getElementById('v5SymbolPopup').classList.add('show');
}

function closeV5SymbolPopup(event) {
    if (!event || event.target === document.getElementById('v5SymbolPopup')) {
        document.getElementById('v5SymbolPopup').classList.remove('show');
    }
}

// ========== Market/Limit 토글 ==========
function toggleV5OrderType() {
    const toggle = document.getElementById('v5TypeToggle');
    const limitSection = document.getElementById('v5LimitSection');
    const marketLabel = document.getElementById('v5MarketLabel');
    const limitLabel = document.getElementById('v5LimitLabel');
    
    v5IsLimit = !v5IsLimit;
    
    if (v5IsLimit) {
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

// ========== 랏수 관련 ==========
function adjustV5Lot(delta) {
    const input = document.getElementById('v5LotInput');
    let value = parseFloat(input.value) || 0.01;
    value = Math.max(0.01, Math.min(10, value + delta));
    value = Math.round(value * 100) / 100;
    input.value = value.toFixed(2);
    v5Lot = value;
}

function validateV5Lot(input) {
    let value = parseFloat(input.value);
    if (isNaN(value) || value < 0.01) value = 0.01;
    if (value > 10) value = 10;
    value = Math.round(value * 100) / 100;
    input.value = value.toFixed(2);
    v5Lot = value;
}

function setV5Lot(value) {
    document.getElementById('v5LotInput').value = value.toFixed(2);
    v5Lot = value;
    closeV5LotPopup();
    showToast(`랏수 ${value.toFixed(2)} 설정됨`, 'success');
}

function openV5LotPopup() {
    document.getElementById('v5LotPopup').classList.add('show');
}

function closeV5LotPopup(event) {
    if (!event || event.target === document.getElementById('v5LotPopup')) {
        document.getElementById('v5LotPopup').classList.remove('show');
    }
}

// ========== 주문 기능 ==========
async function v5Buy() {
    if (!checkGuestAction('trade')) return;
    
    showToast('⚡ V5 BUY 실행!', 'success');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/order?symbol=${v5Symbol}&order_type=BUY&volume=${v5Lot}&target=0&magic=${V5_MAGIC_NUMBER}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            console.log('[V5] BUY response:', result);
            if (result?.success) {
                playSound('buy');
                fetchDemoData();
                setTimeout(() => updateMultiOrderPanelV5(), 500);
            } else {
                showToast(result?.message || 'Error', 'error');
            }
        } else {
            console.log('[V5] LIVE BUY - calling apiCall...');
            const result = await apiCall(`/mt5/order?symbol=${v5Symbol}&order_type=BUY&volume=${v5Lot}&target=0&magic=${V5_MAGIC_NUMBER}`, 'POST');
            console.log('[V5] LIVE BUY response:', result);
            if (result?.success) {
                playSound('buy');
                showToast('✅ 주문 성공!', 'success');
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

async function v5Sell() {
    if (!checkGuestAction('trade')) return;
    
    showToast('⚡ V5 SELL 실행!', 'success');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/order?symbol=${v5Symbol}&order_type=SELL&volume=${v5Lot}&target=0&magic=${V5_MAGIC_NUMBER}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            console.log('[V5] SELL response:', result);
            if (result?.success) {
                playSound('sell');
                fetchDemoData();
                setTimeout(() => updateMultiOrderPanelV5(), 500);
            } else {
                showToast(result?.message || 'Error', 'error');
            }
        } else {
            console.log('[V5] LIVE SELL - calling apiCall...');
            const result = await apiCall(`/mt5/order?symbol=${v5Symbol}&order_type=SELL&volume=${v5Lot}&target=0&magic=${V5_MAGIC_NUMBER}`, 'POST');
            console.log('[V5] LIVE SELL response:', result);
            if (result?.success) {
                playSound('sell');
                showToast('✅ 주문 성공!', 'success');
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

// ========== 청산 기능 ==========
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
            console.log('[V5] CloseAll response:', result);
            if (result?.success) {
                playSound('close');
                fetchDemoData();
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                
                // 즉시 윈/로스 업데이트
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                
                // 히스토리 갱신 (서버 반영 대기)
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            } else {
                showToast(result?.message || '청산 실패', 'error');
            }
        } else {
            console.log('[V5] LIVE CloseAll - calling apiCall...');
            const result = await apiCall(`/mt5/close-all?magic=${V5_MAGIC_NUMBER}`, 'POST');
            console.log('[V5] LIVE CloseAll response:', result);
            if (result?.success) {
                playSound('close');
                showToast('✅ 전체 청산 완료!', 'success');
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                
                // 즉시 윈/로스 업데이트
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                
                // 히스토리 갱신 (서버 반영 대기)
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

async function v5CloseSymbol() {
    if (!checkGuestAction('trade')) return;
    
    showToast(`🟠 ${v5Symbol} 청산!`, 'error');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close?symbol=${v5Symbol}&magic=${V5_MAGIC_NUMBER}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            console.log('[V5] CloseSymbol response:', result);
            if (result?.success) {
                playSound('close');
                fetchDemoData();
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                
                // 즉시 윈/로스 업데이트
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.profit || 0);
                }
                
                // 히스토리 갱신 (서버 반영 대기)
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            } else {
                showToast(result?.message || '청산 실패', 'error');
            }
        } else {
            console.log('[V5] LIVE CloseSymbol - calling apiCall...');
            const result = await apiCall(`/mt5/close?symbol=${v5Symbol}&magic=${V5_MAGIC_NUMBER}`, 'POST');
            console.log('[V5] LIVE CloseSymbol response:', result);
            if (result?.success) {
                playSound('close');
                showToast('✅ 청산 완료!', 'success');
                setTimeout(() => updateMultiOrderPanelV5(), 800);
                
                // 즉시 윈/로스 업데이트
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.profit || 0);
                }
                
                // 히스토리 갱신 (서버 반영 대기)
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
                
                // 즉시 윈/로스 업데이트
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                
                // 히스토리 갱신 (서버 반영 대기)
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
                
                // 즉시 윈/로스 업데이트
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                
                // 히스토리 갱신 (서버 반영 대기)
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
                
                // 즉시 윈/로스 업데이트
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                
                // 히스토리 갱신 (서버 반영 대기)
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
                
                // 즉시 윈/로스 업데이트
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                
                // 히스토리 갱신 (서버 반영 대기)
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
                
                // 즉시 윈/로스 업데이트
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                
                // 히스토리 갱신 (서버 반영 대기)
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
                
                // 즉시 윈/로스 업데이트
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                
                // 히스토리 갱신 (서버 반영 대기)
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
                
                // 즉시 윈/로스 업데이트
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                
                // 히스토리 갱신 (서버 반영 대기)
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
                
                // 즉시 윈/로스 업데이트
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.total_profit || 0);
                }
                
                // 히스토리 갱신 (서버 반영 대기)
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
                
                // 즉시 윈/로스 업데이트
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.profit || 0);
                }
                
                // 히스토리 갱신 (서버 반영 대기)
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            }
        } else {
            const result = await apiCall(`/mt5/close?ticket=${ticket}`, 'POST');
            if (result?.success) { 
                playSound('close'); 
                setTimeout(() => updateMultiOrderPanelV5(), 500);
                
                // 즉시 윈/로스 업데이트
                if (typeof updateWinLossImmediate === 'function') {
                    updateWinLossImmediate(result.profit || 0);
                }
                
                // 히스토리 갱신 (서버 반영 대기)
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
function openV5SltpPopup() {
    document.getElementById('v5SltpPopup').classList.add('show');
}

function closeV5SltpPopup(event) {
    if (!event || event.target === document.getElementById('v5SltpPopup')) {
        document.getElementById('v5SltpPopup').classList.remove('show');
    }
}

async function applyV5SLTP() {
    if (!checkGuestAction('trade')) return;
    
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
            const response = await fetch(`${API_URL}/demo/set-sltp?symbol=${v5Symbol}&sl=${sl || 0}&tp=${tp || 0}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) fetchDemoData();
        } else {
            await apiCall(`/mt5/set-sltp?symbol=${v5Symbol}&sl=${sl || 0}&tp=${tp || 0}`, 'POST');
        }
    } catch (e) { 
        showToast('Network error', 'error'); 
    }
}

// ========== V5 전용 포지션 조회 ==========
async function fetchV5Positions() {
    try {
        if (isDemo) {
            // 데모 모드: V5 전용 포지션 조회
            const response = await fetch(`${API_URL}/demo/positions?magic=${V5_MAGIC_NUMBER}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.positions) {
                v5Positions = result.positions;
            } else {
                v5Positions = [];
            }
            updateV5PositionList();
            return;
        }
        
        // 라이브: magic 파라미터로 V5 포지션만 조회
        const result = await apiCall(`/mt5/positions?magic=${V5_MAGIC_NUMBER}`);
        console.log('[V5] Positions fetch:', result);
        
        if (result?.positions) {
            v5Positions = result.positions;
        } else {
            v5Positions = [];
        }
        
        updateV5PositionList();
    } catch (e) {
        console.error('[V5] Position fetch error:', e);
        updateV5PositionList();
    }
}

// ========== 포지션 리스트 렌더링 ==========
function updateV5PositionList() {
    const container = document.getElementById('v5PositionList');
    if (!container) return;
    
    if (v5Positions && v5Positions.length > 0) {
        container.innerHTML = v5Positions.map((pos, idx) => {
            const isBuy = pos.type === 'BUY' || pos.type === 0;
            const typeText = isBuy ? 'BUY' : 'SELL';
            const profitClass = pos.profit >= 0 ? 'positive' : 'negative';
            const profitSign = pos.profit >= 0 ? '+' : '';
            const decimals = getDecimalsForSymbol(pos.symbol || v5Symbol);
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
        container.innerHTML = `
            <div class="v5-position-empty">
                <span class="material-icons-round" style="font-size: 32px; opacity: 0.3;">inbox</span>
                <div>열린 포지션이 없습니다</div>
            </div>
        `;
    }
}

// ========== 패널 추가 (미구현) ==========
function addV5Panel() {
    showToast('🚧 다중 패널 기능은 준비 중입니다', '');
}

// ========== 데이터 업데이트 (외부 호출용) ==========
async function updateMultiOrderPanelV5() {
    await fetchV5Positions();
    await updateV5AccountInfo();
    updateV5Prices();
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
    
    updateV5PositionList();
    updateV5Prices();
}

// ========== 초기화 ==========
document.addEventListener('DOMContentLoaded', function() {
    // 주기적 가격 업데이트
    setInterval(() => {
        if (document.getElementById('multiOrderPanelV5')?.style.display !== 'none') {
            updateV5Prices();
        }
    }, 1000);
});
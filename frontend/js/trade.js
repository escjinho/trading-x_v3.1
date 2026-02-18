/* ========================================
   Trading-X Trade Tab
   EA 패널, Quick 패널, 거래 함수
   ======================================== */

// ========== Trade Variables ==========
let currentSymbol = 'BTCUSD';
let currentMode = 'basic';
let targetAmount = 50;
let leverage = 10;
let lotSize = 0.01;
let hasPosition = false;
let positionData = null;
let positionStartTime = null;
let positionTimer = null;
let todayPL = 0;
let isClosing = false;

// ========== Symbol Selection ==========
function toggleSymbolDropdown() {
    const dropdown = document.getElementById('symbolDropdown');
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

function selectSymbol(symbol, name, icon, color) {
    currentSymbol = symbol;
    document.getElementById('symbolIcon').textContent = icon;
    document.getElementById('symbolIcon').style.color = color;
    document.getElementById('symbolText').textContent = name;
    document.getElementById('symbolDropdown').style.display = 'none';
}

// Click outside dropdown
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('symbolDropdown');
    const trigger = document.querySelector('.symbol-info');
    if (dropdown && trigger && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});

// ========== Target & Leverage Sliders ==========
function adjustTarget(delta) {
    const slider = document.getElementById('targetSlider');
    let value = parseInt(slider.value) + delta;
    value = Math.max(parseInt(slider.min), Math.min(parseInt(slider.max), value));
    slider.value = value;
    targetAmount = value;
    updateTargetUI();
}

function updateTargetUI() {
    document.getElementById('targetValue').textContent = '$' + targetAmount;
    updateSliderBackground(document.getElementById('targetSlider'));
}

function updateTargetFromSlider(value) {
    targetAmount = parseInt(value);
    updateTargetUI();
}

function updateLeverageFromSlider(value) {
    leverage = parseInt(value);
    const lot = calculateLot();
    document.getElementById('leverageValue').textContent = 'x' + leverage;
    document.getElementById('tradeLotSize').textContent = lot.toFixed(2);
    updateSliderBackground(document.getElementById('leverageSlider'));
}

// ========== Mode Panel UI ==========
function updateMainPanelForMode() {
    const martinModeUI = document.getElementById('martinModeUI');
    const normalModeUI = document.getElementById('normalModeUI');
    const targetSlider = document.getElementById('targetSlider');
    const leverageSlider = document.getElementById('leverageSlider');
    const targetLabelsDiv = targetSlider.parentElement.querySelector('.slider-labels');
    const levLabelsDiv = leverageSlider.parentElement.querySelector('.slider-labels');
    
    if (currentMode === 'martin' && martinEnabled) {
        martinModeUI.style.display = 'block';
        normalModeUI.style.display = 'none';
        updateMartinUI();
    } else {
        martinModeUI.style.display = 'none';
        normalModeUI.style.display = 'block';
        
        if (currentMode === 'basic') {
            targetSlider.max = 200;
            targetSlider.min = 0;
            leverageSlider.max = 20;
            leverageSlider.min = 0;
            
            if (targetLabelsDiv) {
                targetLabelsDiv.innerHTML = '<span>$0</span><span>$50</span><span>$100</span><span>$150</span><span>$200</span>';
            }
            if (levLabelsDiv) {
                levLabelsDiv.innerHTML = '<span>x0</span><span>x5</span><span>x10</span><span>x15</span><span>x20</span>';
            }
        } else if (currentMode === 'noLimit') {
            const maxTarget = Math.floor(balance * 0.5);
            targetSlider.max = maxTarget;
            targetSlider.min = 0;
            leverageSlider.max = 50;
            leverageSlider.min = 0;
            
            if (targetLabelsDiv) {
                targetLabelsDiv.innerHTML = '<span>0%</span><span>10%</span><span>25%</span><span>40%</span><span>50%</span>';
            }
            if (levLabelsDiv) {
                levLabelsDiv.innerHTML = '<span>x0</span><span>x10</span><span>x25</span><span>x40</span><span>x50</span>';
            }
        }
        
        targetSlider.value = targetAmount;
        leverageSlider.value = leverage;
    }
}

// ========== Today P/L ==========
function updateTodayPL(profit) {
    todayPL += profit;
    const el = document.getElementById('tradeTodayPL');
    if (todayPL >= 0) {
        el.textContent = '+$' + Math.abs(todayPL).toFixed(0);
        el.style.color = 'var(--buy-color)';
    } else {
        el.textContent = '-$' + Math.abs(todayPL).toFixed(0);
        el.style.color = 'var(--sell-color)';
    }
}

// ========== P/L Gauge ==========
function updatePLGauge(currentPL, target = null) {
    const actualTarget = target || targetAmount;
    const plPercent = Math.min(1, Math.max(-1, currentPL / actualTarget));
    const plPercentDisplay = Math.round(Math.abs(plPercent) * 100);
    
    const fill = document.getElementById('plBarFill');
    const diamond = document.getElementById('plDiamond');
    const percentText = document.getElementById('plPercent');
    
    const isProfit = currentPL >= 0;
    const color = isProfit ? '#00b450' : '#dc3246';
    
    if (fill) {
        fill.style.background = isProfit 
            ? 'linear-gradient(to right, rgba(0,180,80,0.5), #00b450)'
            : 'linear-gradient(to left, rgba(220,50,70,0.5), #dc3246)';
        fill.style.left = isProfit ? '50%' : (50 + plPercent * 50) + '%';
        fill.style.width = Math.abs(plPercent) * 50 + '%';
        fill.style.borderRadius = isProfit ? '0 6px 6px 0' : '6px 0 0 6px';
        fill.style.boxShadow = '0 0 10px ' + color + '80';
    }
    
    if (diamond) {
        diamond.style.left = (50 + plPercent * 50) + '%';
        diamond.style.background = color;
        diamond.style.boxShadow = '0 0 8px ' + color;
    }
    
    if (percentText) {
        percentText.textContent = plPercentDisplay + '%';
        percentText.style.color = color;
    }
}

// ========== Position UI ==========
function updatePositionUI(hasPos, posData) {
    hasPosition = hasPos;
    positionData = posData;
    
    if (hasPos && posData) {
        document.getElementById('targetSection').style.display = 'none';
        document.getElementById('positionSection').style.display = 'block';
        document.getElementById('tradeButtonsNoPos').style.display = 'none';
        document.getElementById('tradeButtonsHasPos').style.display = 'block';
        
        const isBuy = posData.type === 'BUY';
        const posCard = document.getElementById('positionCard');
        posCard.className = isBuy ? 'position-card buy-pos' : 'position-card sell-pos';
        
        document.getElementById('posType').textContent = posData.type;
        document.getElementById('posType').style.color = isBuy ? '#00b450' : '#dc3246';
        document.getElementById('posType').style.textShadow = '0 0 10px ' + (isBuy ? 'rgba(0,180,80,0.5)' : 'rgba(220,50,70,0.5)');
        document.getElementById('posEntry').textContent = posData.entry.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
        
        if (!positionStartTime) {
            positionStartTime = Date.now();
            startPositionTimer();
        }
        
        const actualTarget = posData.target || targetAmount;
        updatePLGauge(posData.profit, actualTarget);
        
        document.getElementById('plMin').textContent = '-$' + actualTarget;
        document.getElementById('plMax').textContent = '+$' + actualTarget;
    } else {
        document.getElementById('targetSection').style.display = 'block';
        document.getElementById('positionSection').style.display = 'none';
        document.getElementById('tradeButtonsNoPos').style.display = 'block';
        document.getElementById('tradeButtonsHasPos').style.display = 'none';
        
        stopPositionTimer();
    }
}

function startPositionTimer() {
    if (positionTimer) return;
    
    positionTimer = setInterval(() => {
        if (!positionStartTime) return;
        
        const elapsed = Math.floor((Date.now() - positionStartTime) / 1000);
        const hours = Math.floor(elapsed / 3600);
        const mins = Math.floor((elapsed % 3600) / 60);
        const secs = elapsed % 60;
        
        if (hours > 0) {
            document.getElementById('posTime').textContent = hours + ':' + mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
        } else {
            document.getElementById('posTime').textContent = mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
        }
    }, 1000);
}

function stopPositionTimer() {
    if (positionTimer) {
        clearInterval(positionTimer);
        positionTimer = null;
    }
    positionStartTime = null;
    document.getElementById('posTime').textContent = '00:00';
}

// ========== Trade Functions ==========
async function placeBuy() {
    if (!checkGuestAction('trade')) return;
    
    if (isDemo) {
        placeDemoOrder('BUY');
        return;
    }
    
    showToast('Processing...', '');
    try {
        let result;
        if (currentMode === 'martin' && martinEnabled) {
            result = await apiCall(`/mt5/martin/buy?symbol=${currentSymbol}`, 'POST');
        } else {
            const lot = calculateLot();
            result = await apiCall(`/mt5/order?symbol=${currentSymbol}&order_type=BUY&volume=${lot}&target=${targetAmount}`, 'POST');
        }
        showToast(result?.message || 'Error', result?.success ? 'success' : 'error');
        if (result?.success) playSound('buy');
    } catch (e) { showToast('Network error', 'error'); }
}

async function placeSell() {
    if (!checkGuestAction('trade')) return;
    
    if (isDemo) {
        placeDemoOrder('SELL');
        return;
    }
    
    showToast('Processing...', '');
    try {
        let result;
        if (currentMode === 'martin' && martinEnabled) {
            result = await apiCall(`/mt5/martin/sell?symbol=${currentSymbol}`, 'POST');
        } else {
            const lot = calculateLot();
            result = await apiCall(`/mt5/order?symbol=${currentSymbol}&order_type=SELL&volume=${lot}&target=${targetAmount}`, 'POST');
        }
        showToast(result?.message || 'Error', result?.success ? 'success' : 'error');
        if (result?.success) playSound('sell');
    } catch (e) { showToast('Network error', 'error'); }
}

async function closePosition() {
    if (isDemo) {
        closeDemoPosition();
        return;
    }
    
    showToast('Closing...', '');
    try {
        const result = await apiCall(`/mt5/close?symbol=${currentSymbol}`, 'POST');
        
        if (result?.success) {
            playSound('close');
            const profit = result.profit || 0;
            
            // 마틴 모드 처리
            if (currentMode === 'martin' && martinEnabled) {
                const baseTarget = 50;
                const currentDisplayTarget = baseTarget * Math.pow(2, martinStep - 1) + martinAccumulatedLoss;
                
                // Case 1: 수익으로 청산
                if (profit > 0) {
                    if (profit >= martinAccumulatedLoss && martinAccumulatedLoss > 0) {
                        // 전액 회복 → 마틴 성공!
                        await apiCall('/mt5/martin/reset-full', 'POST');
                        martinStep = 1;
                        martinAccumulatedLoss = 0;
                        martinHistory = [];
                        updateMartinUI();
                        updateTodayPL(profit);
                        showMartinSuccessPopup(profit);
                    } else {
                        // 일부 회복 → 단계 유지
                        const remainingLoss = Math.max(0, martinAccumulatedLoss - profit);
                        await apiCall(`/mt5/martin/update-state?step=${martinStep}&accumulated_loss=${remainingLoss}`, 'POST');
                        martinAccumulatedLoss = remainingLoss;
                        updateMartinUI();
                        updateTodayPL(profit);
                        if (remainingLoss > 0) {
                            showToast(`💰 일부 회복! +$${profit.toFixed(2)} (남은 손실: $${remainingLoss.toFixed(2)})`, 'success');
                        } else {
                            showMartinSuccessPopup(profit);
                        }
                    }
                }
                // Case 2: 손실로 청산
                else if (profit < 0) {
                    const lossAmount = Math.abs(profit);
                    const halfTarget = currentDisplayTarget / 2;
                    
                    if (lossAmount >= halfTarget) {
                        // 손실 >= 50% → 다음 단계 확인 팝업
                        const newStep = Math.min(martinStep + 1, martinLevel);
                        
                        if (newStep > martinLevel) {
                            // 최대 단계 초과 → 강제 리셋
                            const totalLoss = martinAccumulatedLoss + lossAmount;
                            await apiCall('/mt5/martin/reset-full', 'POST');
                            showMaxPopup(totalLoss);
                            martinStep = 1;
                            martinAccumulatedLoss = 0;
                            martinHistory = [];
                            updateMartinUI();
                        } else {
                            // ★ 마틴 팝업 표시
                            updateTodayPL(profit);
                            showMartinPopup(profit);
                        }
                    } else {
                        // 손실 < 50% → 단계 유지
                        const newAccumulatedLoss = martinAccumulatedLoss + lossAmount;
                        await apiCall(`/mt5/martin/update-state?step=${martinStep}&accumulated_loss=${newAccumulatedLoss}`, 'POST');
                        martinAccumulatedLoss = newAccumulatedLoss;
                        showToast(`📊 단계 유지! 손실: -$${lossAmount.toFixed(2)} (누적: $${newAccumulatedLoss.toFixed(2)})`, 'error');
                        updateTodayPL(profit);
                        updateMartinUI();
                    }
                }
                // Case 3: 손익 0
                else {
                    showToast('청산 완료 (손익 없음)', 'success');
                }
            } else {
                // Basic/NoLimit 모드
                updateTodayPL(profit);
                showToast(result.message, 'success');
            }
        } else {
            showToast(result?.message || 'Error', 'error');
        }
    } catch (e) { showToast('Network error', 'error'); }
}

// ========== Quick Panel Variables ==========
let quickSymbol = 'BTCUSD';
let quickLot = 0.01;
let quickPositions = [];

// ========== Quick Panel Functions ==========
function updateQuickPanel() {
    const symbolInfo = getSymbolInfo(quickSymbol);
    document.getElementById('quickSymbolIcon').textContent = symbolInfo.icon;
    document.getElementById('quickSymbolIcon').style.color = symbolInfo.color;
    document.getElementById('quickSymbolName').textContent = symbolInfo.name;
    document.getElementById('quickSymbolId').textContent = quickSymbol;
    
    updateQuickAccountInfo();
    updateQuickSpread();
    updateQuickPositionList();
    updateQuickPrices();
}

function updateQuickAccountInfo() {
    const quickBalance = document.getElementById('quickBalance');
    const quickEquity = document.getElementById('quickEquity');
    const quickMargin = document.getElementById('quickMargin');
    const quickTodayPL = document.getElementById('quickTodayPL');
    
    if (quickBalance) quickBalance.textContent = '$' + Math.round(balance).toLocaleString();
    if (quickEquity) quickEquity.textContent = '$' + Math.round(balance).toLocaleString();
    if (quickMargin) quickMargin.textContent = '$0';
    
    if (quickTodayPL) {
        if (todayPL > 0) {
            quickTodayPL.textContent = '+$' + Math.abs(todayPL).toFixed(0);
            quickTodayPL.style.color = 'var(--buy-color)';
        } else if (todayPL < 0) {
            quickTodayPL.textContent = '-$' + Math.abs(todayPL).toFixed(0);
            quickTodayPL.style.color = 'var(--sell-color)';
        } else {
            quickTodayPL.textContent = '$0';
            quickTodayPL.style.color = 'var(--text-primary)';
        }
    }
}

function updateQuickSpread() {
    const spreadEl = document.getElementById('quickSpreadValue');
    if (!spreadEl) return;
    
    const spreads = {
        'BTCUSD': '$15.00',
        'EURUSD.r': '0.00020',
        'USDJPY.r': '0.030',
        'XAUUSD.r': '$0.50',
        'US100.': '$1.50'
    };
    
    spreadEl.textContent = spreads[quickSymbol] || '-';
}

function updateQuickPrices() {
    const bidEl = document.getElementById('quickBidPrice');
    const askEl = document.getElementById('quickAskPrice');
    
    if (!bidEl || !askEl) return;
    
    const prices = watchlistPrices[quickSymbol] || demoQuotes[quickSymbol];
    if (prices) {
        const decimals = getDecimalsForSymbol(quickSymbol);
        bidEl.textContent = prices.bid.toFixed(decimals);
        askEl.textContent = prices.ask.toFixed(decimals);
    }
}

function toggleQuickSymbolDropdown() {
    const dropdown = document.getElementById('quickSymbolDropdown');
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

function selectQuickSymbol(symbol) {
    quickSymbol = symbol;
    
    const symbolInfo = getSymbolInfo(symbol);
    document.getElementById('quickSymbolIcon').textContent = symbolInfo.icon;
    document.getElementById('quickSymbolIcon').style.color = symbolInfo.color;
    document.getElementById('quickSymbolName').textContent = symbolInfo.name;
    document.getElementById('quickSymbolId').textContent = symbol;
    
    document.getElementById('quickSymbolDropdown').style.display = 'none';
    
    updateQuickSpread();
    updateQuickPrices();
    
    showToast(`📊 ${symbolInfo.name} 선택됨`, 'success');
}

function adjustQuickLot(delta) {
    const input = document.getElementById('quickLotInput');
    let value = parseFloat(input.value) || 0.01;
    value = Math.max(0.01, Math.min(10, value + delta));
    value = Math.round(value * 100) / 100;
    input.value = value.toFixed(2);
    quickLot = value;
}

function validateQuickLot(input) {
    let value = parseFloat(input.value);
    if (isNaN(value) || value < 0.01) {
        value = 0.01;
    } else if (value > 10) {
        value = 10;
    }
    value = Math.round(value * 100) / 100;
    input.value = value.toFixed(2);
    quickLot = value;
}

async function quickBuy() {
    if (!checkGuestAction('trade')) return;
    
    showToast('⚡ Quick BUY 실행!', 'success');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/order?symbol=${quickSymbol}&order_type=BUY&volume=${quickLot}&target=0`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            
            if (result?.success) {
                playSound('buy');
                fetchDemoData();
            } else {
                showToast(result?.message || 'Error', 'error');
            }
        } else {
            const result = await apiCall(`/mt5/order?symbol=${quickSymbol}&order_type=BUY&volume=${quickLot}&target=0`, 'POST');
            if (result?.success) playSound('buy');
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

async function quickSell() {
    if (!checkGuestAction('trade')) return;
    
    showToast('⚡ Quick SELL 실행!', 'success');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/order?symbol=${quickSymbol}&order_type=SELL&volume=${quickLot}&target=0`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            
            if (result?.success) {
                playSound('sell');
                fetchDemoData();
            } else {
                showToast(result?.message || 'Error', 'error');
            }
        } else {
            const result = await apiCall(`/mt5/order?symbol=${quickSymbol}&order_type=SELL&volume=${quickLot}&target=0`, 'POST');
            if (result?.success) playSound('sell');
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

async function quickCloseAll() {
    if (!checkGuestAction('trade')) return;
    if (!confirm('모든 포지션을 청산하시겠습니까?')) return;
    
    showToast('🔴 일괄 청산 실행!', 'error');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close-all`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) {
                playSound('close');
                fetchDemoData();
            }
        } else {
            const result = await apiCall('/mt5/close-all', 'POST');
            if (result?.success) playSound('close');
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

async function quickCloseSymbol() {
    if (!checkGuestAction('trade')) return;
    
    showToast(`🟠 ${quickSymbol} 청산 실행!`, 'error');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close?symbol=${quickSymbol}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) {
                playSound('close');
                if (result.profit) updateTodayPL(result.profit);
                fetchDemoData();
            }
        } else {
            const result = await apiCall(`/mt5/close?symbol=${quickSymbol}`, 'POST');
            if (result?.success) {
                playSound('close');
                if (result.profit) updateTodayPL(result.profit);
            }
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

async function quickClosePosition(ticket) {
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
                if (result.profit) updateTodayPL(result.profit);
                fetchDemoData();
            }
        } else {
            const result = await apiCall(`/mt5/close?ticket=${ticket}`, 'POST');
            if (result?.success) {
                playSound('close');
                if (result.profit) updateTodayPL(result.profit);
            }
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

async function quickCloseBuy() {
    if (!checkGuestAction('trade')) return;
    showToast('🟢 매수 포지션 청산!', 'success');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close-by-type?type=BUY`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
            const result = await response.json();
            if (result?.success) { playSound('close'); fetchDemoData(); }
        } else {
            const result = await apiCall('/mt5/close-by-type?type=BUY', 'POST');
            if (result?.success) playSound('close');
        }
    } catch (e) { showToast('Network error', 'error'); }
}

async function quickCloseSell() {
    if (!checkGuestAction('trade')) return;
    showToast('🔴 매도 포지션 청산!', 'error');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close-by-type?type=SELL`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
            const result = await response.json();
            if (result?.success) { playSound('close'); fetchDemoData(); }
        } else {
            const result = await apiCall('/mt5/close-by-type?type=SELL', 'POST');
            if (result?.success) playSound('close');
        }
    } catch (e) { showToast('Network error', 'error'); }
}

async function quickCloseProfit() {
    if (!checkGuestAction('trade')) return;
    showToast('💰 수익 포지션 청산!', 'success');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close-by-profit?profit_type=positive`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
            const result = await response.json();
            if (result?.success) { playSound('close'); fetchDemoData(); }
        } else {
            const result = await apiCall('/mt5/close-by-profit?profit_type=positive', 'POST');
            if (result?.success) playSound('close');
        }
    } catch (e) { showToast('Network error', 'error'); }
}

async function quickCloseLoss() {
    if (!checkGuestAction('trade')) return;
    showToast('💔 손실 포지션 청산!', 'error');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close-by-profit?profit_type=negative`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
            const result = await response.json();
            if (result?.success) { playSound('close'); fetchDemoData(); }
        } else {
            const result = await apiCall('/mt5/close-by-profit?profit_type=negative', 'POST');
            if (result?.success) playSound('close');
        }
    } catch (e) { showToast('Network error', 'error'); }
}

async function applyQuickSLTP() {
    if (!checkGuestAction('trade')) return;
    const sl = document.getElementById('quickSLInput').value;
    const tp = document.getElementById('quickTPInput').value;
    
    if (!sl && !tp) {
        showToast('SL 또는 TP 값을 입력하세요', 'error');
        return;
    }
    
    showToast(`✅ SL: ${sl || '-'} / TP: ${tp || '-'} 적용!`, 'success');
    
    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/set-sltp?symbol=${quickSymbol}&sl=${sl || 0}&tp=${tp || 0}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
            const result = await response.json();
            if (result?.success) fetchDemoData();
        } else {
            await apiCall(`/mt5/set-sltp?symbol=${quickSymbol}&sl=${sl || 0}&tp=${tp || 0}`, 'POST');
        }
    } catch (e) { showToast('Network error', 'error'); }
}

function updateQuickPositionList() {
    const container = document.getElementById('quickPositionList');
    if (!container) return;
    
    if (quickPositions && quickPositions.length > 0) {
        let totalProfit = 0;
        quickPositions.forEach(pos => { totalProfit += pos.profit || 0; });
        
        const totalProfitClass = totalProfit >= 0 ? 'positive' : 'negative';
        const totalProfitSign = totalProfit >= 0 ? '+' : '';
        
        let html = `<div class="quick-total-pl"><span class="quick-total-pl-label">📊 총 ${quickPositions.length}개 포지션</span><span class="quick-total-pl-value ${totalProfitClass}">${totalProfitSign}$${totalProfit.toFixed(2)}</span></div>`;
        
        quickPositions.forEach((pos, index) => {
            const isBuy = pos.type === 'BUY';
            const profitClass = pos.profit >= 0 ? 'positive' : 'negative';
            const profitSign = pos.profit >= 0 ? '+' : '';
            const positionClass = isBuy ? 'buy-position' : 'sell-position';
            const symbolInfo = getSymbolInfo(pos.symbol);
            const decimals = getDecimalsForSymbol(pos.symbol);
            
            html += `
                <div class="quick-position-item ${positionClass}">
                    <div class="quick-position-symbol">
                        <div class="quick-position-symbol-name" style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 16px; color: ${symbolInfo.color};">${symbolInfo.icon}</span>
                            ${pos.symbol}
                        </div>
                        <div class="quick-position-symbol-info">${pos.volume?.toFixed(2) || '0.01'} lot • ${pos.entry?.toFixed(decimals) || '-'}</div>
                    </div>
                    <span class="quick-position-type ${isBuy ? 'buy' : 'sell'}">${pos.type}</span>
                    <div class="quick-position-profit ${profitClass}">${profitSign}$${pos.profit?.toFixed(2) || '0.00'}</div>
                    <button class="quick-position-close" onclick="quickClosePosition(${pos.ticket || index})">
                        <span class="material-icons-round">close</span>
                    </button>
                </div>
            `;
        });
        
        container.innerHTML = html;
    } else if (positionData && hasPosition) {
        const isBuy = positionData.type === 'BUY';
        const profitClass = positionData.profit >= 0 ? 'positive' : 'negative';
        const profitSign = positionData.profit >= 0 ? '+' : '';
        const positionClass = isBuy ? 'buy-position' : 'sell-position';
        const symbolInfo = getSymbolInfo(currentSymbol);
        const decimals = getDecimalsForSymbol(currentSymbol);
        
        container.innerHTML = `
            <div class="quick-total-pl"><span class="quick-total-pl-label">📊 총 1개 포지션</span><span class="quick-total-pl-value ${profitClass}">${profitSign}$${positionData.profit?.toFixed(2) || '0.00'}</span></div>
            <div class="quick-position-item ${positionClass}">
                <div class="quick-position-symbol">
                    <div class="quick-position-symbol-name" style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 16px; color: ${symbolInfo.color};">${symbolInfo.icon}</span>
                        ${currentSymbol}
                    </div>
                    <div class="quick-position-symbol-info">${positionData.volume?.toFixed(2) || lotSize.toFixed(2)} lot • ${positionData.entry?.toFixed(decimals) || '-'}</div>
                </div>
                <span class="quick-position-type ${isBuy ? 'buy' : 'sell'}">${positionData.type}</span>
                <div class="quick-position-profit ${profitClass}">${profitSign}$${positionData.profit?.toFixed(2) || '0.00'}</div>
                <button class="quick-position-close" onclick="quickCloseSymbol()">
                    <span class="material-icons-round">close</span>
                </button>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="quick-position-empty">
                <span class="material-icons-round">inbox</span>
                <div>열린 포지션이 없습니다</div>
            </div>
        `;
    }
}

function updateQuickPanelFromData(data) {
    if (!data) return;
    
    balance = data.balance || balance;
    updateQuickAccountInfo();
    
    if (data.positions && Array.isArray(data.positions)) {
        quickPositions = data.positions;
    } else if (data.position) {
        quickPositions = [data.position];
    } else {
        quickPositions = [];
    }
    
    updateQuickPositionList();
    updateQuickPrices();
}

// Click outside Quick dropdown
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('quickSymbolDropdown');
    const selector = document.getElementById('quickSymbolSelector');
    if (dropdown && selector && !selector.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});

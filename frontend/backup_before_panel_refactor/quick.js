// ========================================
// Quick & Easy Panel Module
// ========================================

// Quick 패널 전용 변수
let quickSymbol = 'BTCUSD';
let quickLot = 0.01;
let quickPositions = []; // 다중 포지션 배열

// Quick 패널 업데이트
function updateQuickPanel() {
    // 현재 심볼 정보 반영
    const symbolInfo = getSymbolInfo(quickSymbol);
    document.getElementById('quickSymbolIcon').textContent = symbolInfo.icon;
    document.getElementById('quickSymbolIcon').style.color = symbolInfo.color;
    document.getElementById('quickSymbolName').textContent = symbolInfo.name;
    document.getElementById('quickSymbolId').textContent = quickSymbol;

    // 계좌 정보 업데이트
    updateQuickAccountInfo();

    // 스프레드 업데이트
    updateQuickSpread();

    // 포지션 리스트 업데이트
    updateQuickPositionList();

    // 가격 업데이트
    updateQuickPrices();
}

// Quick 계좌 정보 업데이트
function updateQuickAccountInfo() {
    const quickBalance = document.getElementById('quickBalance');
    const quickEquity = document.getElementById('quickEquity');
    const quickMargin = document.getElementById('quickMargin');
    const quickTodayPL = document.getElementById('quickTodayPL');

    if (quickBalance) quickBalance.textContent = '$' + Math.round(balance).toLocaleString();
    if (quickEquity) quickEquity.textContent = '$' + Math.round(balance).toLocaleString();
    if (quickMargin) quickMargin.textContent = '$0';

    if (quickTodayPL) {
        if (todayPL >= 0) {
            quickTodayPL.textContent = '+$' + Math.abs(todayPL).toFixed(0);
            quickTodayPL.style.color = 'var(--buy-color)';
        } else {
            quickTodayPL.textContent = '-$' + Math.abs(todayPL).toFixed(0);
            quickTodayPL.style.color = 'var(--sell-color)';
        }
    }
}

// Quick 스프레드 업데이트
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

// Quick 가격 업데이트
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

// 종목 드롭다운 토글
function toggleQuickSymbolDropdown() {
    const dropdown = document.getElementById('quickSymbolDropdown');
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

// 종목 선택
function selectQuickSymbol(symbol) {
    quickSymbol = symbol;

    const symbolInfo = getSymbolInfo(symbol);
    document.getElementById('quickSymbolIcon').textContent = symbolInfo.icon;
    document.getElementById('quickSymbolIcon').style.color = symbolInfo.color;
    document.getElementById('quickSymbolName').textContent = symbolInfo.name;
    document.getElementById('quickSymbolId').textContent = symbol;

    // 드롭다운 닫기
    document.getElementById('quickSymbolDropdown').style.display = 'none';

    // 스프레드 및 가격 업데이트
    updateQuickSpread();
    updateQuickPrices();

    showToast(`📊 ${symbolInfo.name} 선택됨`, 'success');
}

// 랏수 조절
function adjustQuickLot(delta) {
    const input = document.getElementById('quickLotInput');
    let value = parseFloat(input.value) || 0.01;
    value = Math.max(0.01, Math.min(10, value + delta));
    value = Math.round(value * 100) / 100;
    input.value = value.toFixed(2);
    quickLot = value;
}

// 랏수 유효성 검사
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

// Quick 매수
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

// Quick 매도
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

// 일괄 청산 (전종목)
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

// 현종목 청산
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

// 개별 포지션 청산 (티켓 번호로)
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

// 매수만 청산
async function quickCloseBuy() {
    if (!checkGuestAction('trade')) return;

    showToast('🟢 매수 포지션 청산!', 'success');

    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close-by-type?type=BUY`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) {
                playSound('close');
                fetchDemoData();
            }
        } else {
            const result = await apiCall('/mt5/close-by-type?type=BUY', 'POST');
            if (result?.success) playSound('close');
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

// 매도만 청산
async function quickCloseSell() {
    if (!checkGuestAction('trade')) return;

    showToast('🔴 매도 포지션 청산!', 'error');

    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close-by-type?type=SELL`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) {
                playSound('close');
                fetchDemoData();
            }
        } else {
            const result = await apiCall('/mt5/close-by-type?type=SELL', 'POST');
            if (result?.success) playSound('close');
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

// 수익만 청산
async function quickCloseProfit() {
    if (!checkGuestAction('trade')) return;

    showToast('💰 수익 포지션 청산!', 'success');

    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close-by-profit?profit_type=positive`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) {
                playSound('close');
                fetchDemoData();
            }
        } else {
            const result = await apiCall('/mt5/close-by-profit?profit_type=positive', 'POST');
            if (result?.success) playSound('close');
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

// 손실만 청산
async function quickCloseLoss() {
    if (!checkGuestAction('trade')) return;

    showToast('💔 손실 포지션 청산!', 'error');

    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close-by-profit?profit_type=negative`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) {
                playSound('close');
                fetchDemoData();
            }
        } else {
            const result = await apiCall('/mt5/close-by-profit?profit_type=negative', 'POST');
            if (result?.success) playSound('close');
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

// SL/TP 적용
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
            const response = await fetch(`${API_URL}/demo/set-sltp?symbol=${quickSymbol}&sl=${sl || 0}&tp=${tp || 0}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) fetchDemoData();
        } else {
            await apiCall(`/mt5/set-sltp?symbol=${quickSymbol}&sl=${sl || 0}&tp=${tp || 0}`, 'POST');
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

// Quick 포지션 리스트 업데이트 (다중 포지션 지원)
function updateQuickPositionList() {
    const container = document.getElementById('quickPositionList');
    if (!container) return;

    // quickPositions 배열에 데이터가 있으면 표시
    if (quickPositions && quickPositions.length > 0) {
        // 총 손익 계산
        let totalProfit = 0;
        quickPositions.forEach(pos => {
            totalProfit += pos.profit || 0;
        });

        const totalProfitClass = totalProfit >= 0 ? 'positive' : 'negative';
        const totalProfitSign = totalProfit >= 0 ? '+' : '';

        let html = `
            <div class="quick-total-pl">
                <span class="quick-total-pl-label">📊 총 ${quickPositions.length}개 포지션</span>
                <span class="quick-total-pl-value ${totalProfitClass}">${totalProfitSign}$${totalProfit.toFixed(2)}</span>
            </div>
        `;

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
    }
    // 기존 단일 포지션 호환
    else if (positionData && hasPosition) {
        const isBuy = positionData.type === 'BUY';
        const profitClass = positionData.profit >= 0 ? 'positive' : 'negative';
        const profitSign = positionData.profit >= 0 ? '+' : '';
        const positionClass = isBuy ? 'buy-position' : 'sell-position';
        const symbolInfo = getSymbolInfo(currentSymbol);
        const decimals = getDecimalsForSymbol(currentSymbol);

        container.innerHTML = `
            <div class="quick-total-pl">
                <span class="quick-total-pl-label">📊 총 1개 포지션</span>
                <span class="quick-total-pl-value ${profitClass}">${profitSign}$${positionData.profit?.toFixed(2) || '0.00'}</span>
            </div>
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
    }
    else {
        container.innerHTML = `
            <div class="quick-position-empty">
                <span class="material-icons-round">inbox</span>
                <div>열린 포지션이 없습니다</div>
            </div>
        `;
    }
}

// Quick 패널 실시간 업데이트 (fetchDemoData에서 호출)
function updateQuickPanelFromData(data) {
    if (!data) return;

    // 계좌 정보 업데이트
    balance = data.balance || balance;
    updateQuickAccountInfo();

    // 다중 포지션 업데이트
    if (data.positions && Array.isArray(data.positions)) {
        quickPositions = data.positions;
    } else if (data.position) {
        quickPositions = [data.position];
    } else {
        quickPositions = [];
    }

    // 포지션 리스트 업데이트
    updateQuickPositionList();

    // 가격 업데이트
    updateQuickPrices();
}

// ========== 초기화 ==========
document.addEventListener('DOMContentLoaded', function() {
    // 드롭다운 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('quickSymbolDropdown');
        const selector = document.getElementById('quickSymbolSelector');
        if (dropdown && selector && !selector.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
});

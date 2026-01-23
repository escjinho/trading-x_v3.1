// ========================================
// MultiOrder & Easy Panel Module
// ========================================

// MultiOrder 패널 전용 변수
let multiOrderSymbol = 'BTCUSD';
let multiOrderLot = 0.01;
let multiOrderPositions = []; // 다중 포지션 배열

// MultiOrder 패널 업데이트
function updateMultiOrderPanel() {
    // 현재 심볼 정보 반영
    const symbolInfo = getSymbolInfo(multiOrderSymbol);
    document.getElementById('multiOrderSymbolIcon').textContent = symbolInfo.icon;
    document.getElementById('multiOrderSymbolIcon').style.color = symbolInfo.color;
    document.getElementById('multiOrderSymbolName').textContent = symbolInfo.name;
    document.getElementById('multiOrderSymbolId').textContent = multiOrderSymbol;

    // 계좌 정보 업데이트
    updateMultiOrderAccountInfo();

    // 스프레드 업데이트
    updateMultiOrderSpread();

    // 포지션 리스트 업데이트
    updateMultiOrderPositionList();

    // 가격 업데이트
    updateMultiOrderPrices();
}

// MultiOrder 계좌 정보 업데이트
function updateMultiOrderAccountInfo() {
    const multiOrderBalance = document.getElementById('multiOrderBalance');
    const multiOrderEquity = document.getElementById('multiOrderEquity');
    const multiOrderMargin = document.getElementById('multiOrderMargin');
    const multiOrderTodayPL = document.getElementById('multiOrderTodayPL');

    if (multiOrderBalance) multiOrderBalance.textContent = '$' + Math.round(balance).toLocaleString();
    if (multiOrderEquity) multiOrderEquity.textContent = '$' + Math.round(balance).toLocaleString();
    if (multiOrderMargin) multiOrderMargin.textContent = '$0';

    if (multiOrderTodayPL) {
        if (todayPL >= 0) {
            multiOrderTodayPL.textContent = '+$' + Math.abs(todayPL).toFixed(0);
            multiOrderTodayPL.style.color = 'var(--buy-color)';
        } else {
            multiOrderTodayPL.textContent = '-$' + Math.abs(todayPL).toFixed(0);
            multiOrderTodayPL.style.color = 'var(--sell-color)';
        }
    }
}

// MultiOrder 스프레드 업데이트
function updateMultiOrderSpread() {
    const spreadEl = document.getElementById('multiOrderSpreadValue');
    if (!spreadEl) return;

    const spreads = {
        'BTCUSD': '$15.00',
        'EURUSD.r': '0.00020',
        'USDJPY.r': '0.030',
        'XAUUSD.r': '$0.50',
        'US100.': '$1.50'
    };

    spreadEl.textContent = spreads[multiOrderSymbol] || '-';
}

// MultiOrder 가격 업데이트
function updateMultiOrderPrices() {
    const bidEl = document.getElementById('multiOrderBidPrice');
    const askEl = document.getElementById('multiOrderAskPrice');

    if (!bidEl || !askEl) return;

    const prices = watchlistPrices[multiOrderSymbol] || demoQuotes[multiOrderSymbol];
    if (prices) {
        const decimals = getDecimalsForSymbol(multiOrderSymbol);
        bidEl.textContent = prices.bid.toFixed(decimals);
        askEl.textContent = prices.ask.toFixed(decimals);
    }
}

// 종목 드롭다운 토글
function toggleMultiOrderSymbolDropdown() {
    const dropdown = document.getElementById('multiOrderSymbolDropdown');
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

// 종목 선택
function selectMultiOrderSymbol(symbol) {
    multiOrderSymbol = symbol;

    const symbolInfo = getSymbolInfo(symbol);
    document.getElementById('multiOrderSymbolIcon').textContent = symbolInfo.icon;
    document.getElementById('multiOrderSymbolIcon').style.color = symbolInfo.color;
    document.getElementById('multiOrderSymbolName').textContent = symbolInfo.name;
    document.getElementById('multiOrderSymbolId').textContent = symbol;

    // 드롭다운 닫기
    document.getElementById('multiOrderSymbolDropdown').style.display = 'none';

    // 스프레드 및 가격 업데이트
    updateMultiOrderSpread();
    updateMultiOrderPrices();

    showToast(`📊 ${symbolInfo.name} 선택됨`, 'success');
}

// 랏수 조절
function adjustMultiOrderLot(delta) {
    const input = document.getElementById('multiOrderLotInput');
    let value = parseFloat(input.value) || 0.01;
    value = Math.max(0.01, Math.min(10, value + delta));
    value = Math.round(value * 100) / 100;
    input.value = value.toFixed(2);
    multiOrderLot = value;
}

// 랏수 유효성 검사
function validateMultiOrderLot(input) {
    let value = parseFloat(input.value);
    if (isNaN(value) || value < 0.01) {
        value = 0.01;
    } else if (value > 10) {
        value = 10;
    }
    value = Math.round(value * 100) / 100;
    input.value = value.toFixed(2);
    multiOrderLot = value;
}

// MultiOrder 매수
async function multiOrderBuy() {
    if (!checkGuestAction('trade')) return;

    showToast('⚡ MultiOrder BUY 실행!', 'success');

    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/order?symbol=${multiOrderSymbol}&order_type=BUY&volume=${multiOrderLot}&target=0`, {
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
            const result = await apiCall(`/mt5/order?symbol=${multiOrderSymbol}&order_type=BUY&volume=${multiOrderLot}&target=0`, 'POST');
            if (result?.success) playSound('buy');
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

// MultiOrder 매도
async function multiOrderSell() {
    if (!checkGuestAction('trade')) return;

    showToast('⚡ MultiOrder SELL 실행!', 'success');

    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/order?symbol=${multiOrderSymbol}&order_type=SELL&volume=${multiOrderLot}&target=0`, {
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
            const result = await apiCall(`/mt5/order?symbol=${multiOrderSymbol}&order_type=SELL&volume=${multiOrderLot}&target=0`, 'POST');
            if (result?.success) playSound('sell');
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

// 일괄 청산 (전종목)
async function multiOrderCloseAll() {
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
async function multiOrderCloseSymbol() {
    if (!checkGuestAction('trade')) return;

    showToast(`🟠 ${multiOrderSymbol} 청산 실행!`, 'error');

    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/close?symbol=${multiOrderSymbol}`, {
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
            const result = await apiCall(`/mt5/close?symbol=${multiOrderSymbol}`, 'POST');
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
async function multiOrderClosePosition(ticket) {
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
async function multiOrderCloseBuy() {
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
async function multiOrderCloseSell() {
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
async function multiOrderCloseProfit() {
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
async function multiOrderCloseLoss() {
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
async function applyMultiOrderSLTP() {
    if (!checkGuestAction('trade')) return;
    const sl = document.getElementById('multiOrderSLInput').value;
    const tp = document.getElementById('multiOrderTPInput').value;

    if (!sl && !tp) {
        showToast('SL 또는 TP 값을 입력하세요', 'error');
        return;
    }

    showToast(`✅ SL: ${sl || '-'} / TP: ${tp || '-'} 적용!`, 'success');

    try {
        if (isDemo) {
            const response = await fetch(`${API_URL}/demo/set-sltp?symbol=${multiOrderSymbol}&sl=${sl || 0}&tp=${tp || 0}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (result?.success) fetchDemoData();
        } else {
            await apiCall(`/mt5/set-sltp?symbol=${multiOrderSymbol}&sl=${sl || 0}&tp=${tp || 0}`, 'POST');
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

// MultiOrder 포지션 리스트 업데이트 (다중 포지션 지원)
function updateMultiOrderPositionList() {
    const container = document.getElementById('multiOrderPositionList');
    if (!container) return;

    // multiOrderPositions 배열에 데이터가 있으면 표시
    if (multiOrderPositions && multiOrderPositions.length > 0) {
        // 총 손익 계산
        let totalProfit = 0;
        multiOrderPositions.forEach(pos => {
            totalProfit += pos.profit || 0;
        });

        const totalProfitClass = totalProfit >= 0 ? 'positive' : 'negative';
        const totalProfitSign = totalProfit >= 0 ? '+' : '';

        let html = `
            <div class="multi-order-total-pl">
                <span class="multi-order-total-pl-label">📊 총 ${multiOrderPositions.length}개 포지션</span>
                <span class="multi-order-total-pl-value ${totalProfitClass}">${totalProfitSign}$${totalProfit.toFixed(2)}</span>
            </div>
        `;

        multiOrderPositions.forEach((pos, index) => {
            const isBuy = pos.type === 'BUY';
            const profitClass = pos.profit >= 0 ? 'positive' : 'negative';
            const profitSign = pos.profit >= 0 ? '+' : '';
            const positionClass = isBuy ? 'buy-position' : 'sell-position';
            const symbolInfo = getSymbolInfo(pos.symbol);
            const decimals = getDecimalsForSymbol(pos.symbol);

            html += `
                <div class="multi-order-position-item ${positionClass}">
                    <div class="multi-order-position-symbol">
                        <div class="multi-order-position-symbol-name" style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 16px; color: ${symbolInfo.color};">${symbolInfo.icon}</span>
                            ${pos.symbol}
                        </div>
                        <div class="multi-order-position-symbol-info">${pos.volume?.toFixed(2) || '0.01'} lot • ${pos.entry?.toFixed(decimals) || '-'}</div>
                    </div>
                    <span class="multi-order-position-type ${isBuy ? 'buy' : 'sell'}">${pos.type}</span>
                    <div class="multi-order-position-profit ${profitClass}">${profitSign}$${pos.profit?.toFixed(2) || '0.00'}</div>
                    <button class="multi-order-position-close" onclick="multiOrderClosePosition(${pos.ticket || index})">
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
            <div class="multi-order-total-pl">
                <span class="multi-order-total-pl-label">📊 총 1개 포지션</span>
                <span class="multi-order-total-pl-value ${profitClass}">${profitSign}$${positionData.profit?.toFixed(2) || '0.00'}</span>
            </div>
            <div class="multi-order-position-item ${positionClass}">
                <div class="multi-order-position-symbol">
                    <div class="multi-order-position-symbol-name" style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 16px; color: ${symbolInfo.color};">${symbolInfo.icon}</span>
                        ${currentSymbol}
                    </div>
                    <div class="multi-order-position-symbol-info">${positionData.volume?.toFixed(2) || lotSize.toFixed(2)} lot • ${positionData.entry?.toFixed(decimals) || '-'}</div>
                </div>
                <span class="multi-order-position-type ${isBuy ? 'buy' : 'sell'}">${positionData.type}</span>
                <div class="multi-order-position-profit ${profitClass}">${profitSign}$${positionData.profit?.toFixed(2) || '0.00'}</div>
                <button class="multi-order-position-close" onclick="multiOrderCloseSymbol()">
                    <span class="material-icons-round">close</span>
                </button>
            </div>
        `;
    }
    else {
        container.innerHTML = `
            <div class="multi-order-position-empty">
                <span class="material-icons-round">inbox</span>
                <div>열린 포지션이 없습니다</div>
            </div>
        `;
    }
}

// MultiOrder 패널 실시간 업데이트 (fetchDemoData에서 호출)
function updateMultiOrderPanelFromData(data) {
    if (!data) return;

    // 계좌 정보 업데이트
    balance = data.balance || balance;
    updateMultiOrderAccountInfo();

    // 다중 포지션 업데이트
    if (data.positions && Array.isArray(data.positions)) {
        multiOrderPositions = data.positions;
    } else if (data.position) {
        multiOrderPositions = [data.position];
    } else {
        multiOrderPositions = [];
    }

    // 포지션 리스트 업데이트
    updateMultiOrderPositionList();

    // 가격 업데이트
    updateMultiOrderPrices();
}

// ========== 초기화 ==========
document.addEventListener('DOMContentLoaded', function() {
    // 드롭다운 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('multiOrderSymbolDropdown');
        const selector = document.getElementById('multiOrderSymbolSelector');
        if (dropdown && selector && !selector.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
});

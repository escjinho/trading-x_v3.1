/* ========================================
   Trading-X Account Tab
   Account Info 업데이트 + 거래내역 로드
   ======================================== */

// ========== 거래내역 로드 ==========
async function loadHistory() {
    const container = document.getElementById('historyList');
    if (!container) return;
    
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">Loading...</div>';
    
    console.log('[loadHistory] isDemo:', isDemo, 'token:', token ? 'exists' : 'none');
    
    try {
        // Demo/Live 모드에 따라 다른 API 호출
        const endpoint = isDemo ? '/demo/history' : '/mt5/history';
        console.log('[loadHistory] Fetching from:', endpoint);
        
        const response = await fetch(`${API_URL}${endpoint}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log('[loadHistory] Response:', data);
        
        if (data.history && data.history.length > 0) {
            let html = '';
            data.history.forEach(item => {
                const profit = item.profit || 0;
                const profitClass = profit >= 0 ? 'profit-positive' : 'profit-negative';
                const profitSign = profit >= 0 ? '+' : '';
                const typeClass = (item.type === 'BUY' || item.type === 0) ? 'type-buy' : 'type-sell';
                const typeText = (item.type === 'BUY' || item.type === 0) ? 'BUY' : 'SELL';
                
                // Live 모드에서는 entry/exit 대신 price만 있을 수 있음
                const entryPrice = item.entry || item.price || 0;
                const exitPrice = item.exit || item.price || 0;
                
                html += `
                    <div class="history-item">
                        <div class="history-symbol-type">
                            <span class="history-symbol">${item.symbol || '-'}</span>
                            <span class="history-type ${typeClass}">${typeText}</span>
                        </div>
                        <div class="history-datetime-lot">
                            <span class="history-time">${item.time || '-'}</span>
                            <span class="history-divider-text">|</span>
                            <span class="history-volume">${item.volume || 0} lot</span>
                        </div>
                        <div class="history-profit ${profitClass}">${profitSign}$${profit.toFixed(2)}</div>
                    </div>
                `;
            });
            container.innerHTML = html;
            
            // Account Info 업데이트
            updateAccountInfoFromHistory(data.history);
        } else {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">거래 내역이 없습니다</div>';
            resetAccountInfo();
        }
    } catch (error) {
        console.error('[loadHistory] Error:', error);
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">거래 내역을 불러올 수 없습니다</div>';
        resetAccountInfo();
    }
    
    // 히스토리 로드 완료 후 패널 동기화
    if (typeof syncAccountInfoToPanels === 'function') {
        syncAccountInfoToPanels();
    }
}

// Account Info 업데이트 함수 (오늘 기준)
function updateAccountInfoFromHistory(historyData) {
    if (!historyData || historyData.length === 0) {
        resetAccountInfo();
        return;
    }
    
    // 오늘 날짜 (MM/DD 형식)
    const today = new Date();
    const todayStr = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;
    
    // 오늘 거래만 필터링
    let todayTrades = historyData.filter(item => item.time && item.time.startsWith(todayStr));
    
    // 전체 통계도 계산 (오늘 거래가 없을 경우 대비)
    let allWins = 0;
    let allLosses = 0;
    let allPL = 0;
    
    historyData.forEach(item => {
        const profit = item.profit || 0;
        allPL += profit;
        if (profit >= 0) {
            allWins++;
        } else {
            allLosses++;
        }
    });
    
    // 오늘 통계 계산
    let todayWins = 0;
    let todayLosses = 0;
    let todayPL = 0;
    
    todayTrades.forEach(item => {
        const profit = item.profit || 0;
        todayPL += profit;
        if (profit >= 0) {
            todayWins++;
        } else {
            todayLosses++;
        }
    });
    
    // Account Info UI 업데이트
    const winLoseEl = document.getElementById('accWinLose');
    const todayPLEl = document.getElementById('accTodayPL');
    const currentPLEl = document.getElementById('accCurrentPL');
    
    // 오늘 거래가 있으면 오늘 통계, 없으면 전체 통계
    const displayWins = todayTrades.length > 0 ? todayWins : allWins;
    const displayLosses = todayTrades.length > 0 ? todayLosses : allLosses;
    // ★★★ Today P/L은 항상 _todayPLFixed 사용 ★★★
    const displayPL = window._todayPLFixed || 0;
    
    if (winLoseEl) {
        winLoseEl.textContent = `${displayWins} / ${displayLosses}`;
    }
    
    if (todayPLEl) {
        if (displayPL > 0) {
            todayPLEl.textContent = '+$' + displayPL.toFixed(2);
            todayPLEl.style.color = 'var(--buy-color)';
        } else if (displayPL < 0) {
            todayPLEl.textContent = '-$' + Math.abs(displayPL).toFixed(2);
            todayPLEl.style.color = 'var(--sell-color)';
        } else {
            todayPLEl.textContent = '$0.00';
            todayPLEl.style.color = 'var(--text-primary)';
        }
    }
    
    if (currentPLEl) {
        currentPLEl.textContent = '$0.00';
        currentPLEl.style.color = 'var(--text-primary)';
    }
    
    console.log('[updateAccountInfoFromHistory] Today trades:', todayTrades.length, 'Total trades:', historyData.length);
}

// Account Info 초기화
function resetAccountInfo() {
    const winLoseEl = document.getElementById('accWinLose');
    const todayPLEl = document.getElementById('accTodayPL');
    const currentPLEl = document.getElementById('accCurrentPL');
    
    if (winLoseEl) winLoseEl.textContent = '0 / 0';
    if (todayPLEl) {
        todayPLEl.textContent = '+$0.00';
        todayPLEl.style.color = 'var(--buy-color)';
    }
    if (currentPLEl) {
        currentPLEl.textContent = '+$0.00';
        currentPLEl.style.color = 'var(--buy-color)';
    }
}

// Account 탭 전환 시 자동 로드
function initAccountTab() {
    loadHistory();
}

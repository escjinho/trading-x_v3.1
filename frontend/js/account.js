/* ========================================
   Trading-X Account Tab
   Account Info 업데이트
   ======================================== */

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
    
    // 오늘 통계 계산
    let todayWins = 0;
    let todayLosses = 0;
    let todayPL = 0;
    
    todayTrades.forEach(item => {
        todayPL += item.profit;
        if (item.profit >= 0) {
            todayWins++;
        } else {
            todayLosses++;
        }
    });
    
    // Account Info UI 업데이트
    const winLoseEl = document.getElementById('accWinLose');
    const todayPLEl = document.getElementById('accTodayPL');
    const currentPLEl = document.getElementById('accCurrentPL');
    
    if (winLoseEl) {
        winLoseEl.textContent = `${todayWins} / ${todayLosses}`;
    }
    
    if (todayPLEl) {
        if (todayPL >= 0) {
            todayPLEl.textContent = '+$' + todayPL.toFixed(2);
            todayPLEl.style.color = 'var(--buy-color)';
        } else {
            todayPLEl.textContent = '-$' + Math.abs(todayPL).toFixed(2);
            todayPLEl.style.color = 'var(--sell-color)';
        }
    }
    
    if (currentPLEl) {
        currentPLEl.textContent = '$0.00';
    }
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
    if (currentPLEl) currentPLEl.textContent = '$0.00';
}
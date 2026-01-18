/* ========================================
   Trading-X Account Tab
   거래 내역 로드
   ======================================== */

// ========== Load History ==========
async function loadHistory() {
    const container = document.getElementById('historyList');
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">Loading...</div>';
    
    try {
        const endpoint = isDemo ? '/demo/history' : '/mt5/history';
        const response = await fetch(`${API_URL}${endpoint}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (data.history && data.history.length > 0) {
            let html = '';
            data.history.forEach(item => {
                const profitClass = item.profit >= 0 ? 'positive' : 'negative';
                const profitSign = item.profit >= 0 ? '+' : '';
                const typeClass = item.type === 'BUY' ? 'buy' : 'sell';
                
                html += `
                    <div class="history-item">
                        <div>
                            <div class="history-symbol">${item.symbol}</div>
                            <div class="history-time">
                                <span style="color: ${item.type === 'BUY' ? 'var(--buy-color)' : 'var(--sell-color)'}">${item.type}</span>
                                • ${item.volume} lot • ${new Date(item.close_time).toLocaleString()}
                            </div>
                        </div>
                        <div class="history-profit ${profitClass}">${profitSign}$${item.profit.toFixed(2)}</div>
                    </div>
                `;
            });
            container.innerHTML = html;
        } else {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                    <span class="material-icons-round" style="font-size: 48px; opacity: 0.5; margin-bottom: 10px;">history</span>
                    <div>거래 내역이 없습니다</div>
                </div>
            `;
        }
    } catch (e) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                <span class="material-icons-round" style="font-size: 48px; opacity: 0.5; margin-bottom: 10px;">error_outline</span>
                <div>내역을 불러올 수 없습니다</div>
            </div>
        `;
    }
}

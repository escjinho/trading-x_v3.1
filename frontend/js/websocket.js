/* ========================================
   Trading-X WebSocket
   실시간 데이터 연결
   ======================================== */

// ========== WebSocket Variables ==========
let ws = null;
let wsRetryCount = 0;
const maxRetries = 5;
let balance = 10000;

// ========== Connect WebSocket ==========
function connectWebSocket() {
    // Demo 모드와 Live 모드에 따라 다른 WebSocket URL 사용
    const wsUrl = isDemo ? 'ws://localhost:8000/api/demo/ws' : 'ws://localhost:8000/api/mt5/ws';
    console.log(`[WebSocket] Connecting to: ${wsUrl} (Demo: ${isDemo})`);
    ws = new WebSocket(wsUrl);
    
    ws.onopen = function() {
        console.log('WebSocket connected');
        document.getElementById('statusDot').classList.remove('disconnected');
        document.getElementById('headerStatus').textContent = 'Connected';
        wsRetryCount = 0;
    };
    
    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);

        // 마지막 WebSocket 데이터 저장 (navigation.js에서 사용)
        if (typeof lastWebSocketData !== 'undefined') {
            lastWebSocketData = data;
        } else {
            window.lastWebSocketData = data;
        }

        // Demo 모드면 차트/시세만 업데이트
        if (isDemo) {
            // Chart prices
            if (data.all_prices && data.all_prices[chartSymbol]) {
                const symbolPrice = data.all_prices[chartSymbol];
                const decimals = getDecimalsForSymbol(chartSymbol);
                document.getElementById('chartBid').textContent = symbolPrice.bid.toFixed(decimals);
                document.getElementById('chartAsk').textContent = symbolPrice.ask.toFixed(decimals);
            }

            // Realtime candle update + indicators
            if (candleSeries && data.all_candles && data.all_candles[chartSymbol]) {
                candleSeries.update(data.all_candles[chartSymbol]);

                if (!window.lastIndicatorUpdate || Date.now() - window.lastIndicatorUpdate > 30000) {
                    window.lastIndicatorUpdate = Date.now();
                    loadCandles();
                }
            }

            // Signal score
            if (data.base_score !== undefined) {
                baseScore = data.base_score;
            }

            // 인디케이터 업데이트 (Trade 탭)
            document.getElementById('indSell').textContent = data.sell_count;
            document.getElementById('indNeutral').textContent = data.neutral_count;
            document.getElementById('indBuy').textContent = data.buy_count;

            // Chart 탭 게이지 및 인디케이터 업데이트
            chartTargetScore = targetScore;
            document.getElementById('chartIndSell').textContent = data.sell_count;
            document.getElementById('chartIndNeutral').textContent = data.neutral_count;
            document.getElementById('chartIndBuy').textContent = data.buy_count;

            return;
        }
        
        balance = data.balance;
        
        // Home
        document.getElementById('homeBalance').textContent = '$' + data.balance.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('homeBroker').textContent = data.broker;
        document.getElementById('homeAccount').textContent = data.account;
        document.getElementById('homeLeverage').textContent = '1:' + data.leverage;
        document.getElementById('homeEquity').textContent = '$' + data.equity.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('homeFreeMargin').textContent = '$' + data.free_margin.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('homePositions').textContent = data.positions_count;
        
        // Chart prices
        if (data.all_prices && data.all_prices[chartSymbol]) {
            const symbolPrice = data.all_prices[chartSymbol];
            const decimals = getDecimalsForSymbol(chartSymbol);
            document.getElementById('chartBid').textContent = symbolPrice.bid.toFixed(decimals);
            document.getElementById('chartAsk').textContent = symbolPrice.ask.toFixed(decimals);
        }
        
        // Realtime candle update
        if (candleSeries && data.all_candles && data.all_candles[chartSymbol]) {
            candleSeries.update(data.all_candles[chartSymbol]);
            
            if (!window.lastIndicatorUpdate || Date.now() - window.lastIndicatorUpdate > 30000) {
                window.lastIndicatorUpdate = Date.now();
                loadCandles();
            }
        }
        
        // Trade tab
        document.getElementById('tradeBalance').textContent = '$' + Math.round(data.balance).toLocaleString();
        
        // Signal score
        if (data.base_score !== undefined) {
            baseScore = data.base_score;
        }
        
        document.getElementById('indSell').textContent = data.sell_count;
        document.getElementById('indNeutral').textContent = data.neutral_count;
        document.getElementById('indBuy').textContent = data.buy_count;
        
        chartTargetScore = targetScore;
        document.getElementById('chartIndSell').textContent = data.sell_count;
        document.getElementById('chartIndNeutral').textContent = data.neutral_count;
        document.getElementById('chartIndBuy').textContent = data.buy_count;
        
        // Position
        if (data.position) {
            updatePositionUI(true, data.position);
            
            const pos = data.position;
            console.log(`[FRONTEND] Position - Profit: ${pos.profit}, Target: ${pos.target}, Should close: ${pos.profit >= pos.target}`);
            
            if (pos.target > 0 && pos.profit >= pos.target && !isClosing) {
                console.log('[FRONTEND] Target reached! Triggering close...');
                isClosing = true;
                closeDemoPosition();
            }
        } else {
            updatePositionUI(false, null);
        }
        
        // Account tab
        document.getElementById('accBalance').textContent = '$' + Math.round(data.balance).toLocaleString();
        document.getElementById('accEquity').textContent = '$' + Math.round(data.equity).toLocaleString();
        document.getElementById('accMargin').textContent = '$' + Math.round(data.margin).toLocaleString();
        document.getElementById('accFree').textContent = '$' + Math.round(data.free_margin).toLocaleString();
        
        // Martin state
        if (data.martin) {
            martinEnabled = data.martin.enabled;
            martinLevel = data.martin.max_steps;
            martinStep = data.martin.step;
            martinAccumulatedLoss = data.martin.accumulated_loss;
            
            if (currentMode === 'martin' && martinEnabled) {
                if (martinAccumulatedLoss > 0) {
                    targetAmount = Math.ceil((martinAccumulatedLoss + 11 + data.martin.target_amount) / 10) * 10;
                } else {
                    targetAmount = data.martin.target_amount;
                }
                
                document.getElementById('tradeLotSize').textContent = data.martin.current_lot.toFixed(2);
                updateMartinUI();
            }
        }
    };
    
    ws.onclose = function() {
        console.log('WebSocket disconnected');
        document.getElementById('statusDot').classList.add('disconnected');
        document.getElementById('headerStatus').textContent = 'Disconnected';
        
        if (wsRetryCount < maxRetries) {
            wsRetryCount++;
            setTimeout(connectWebSocket, 3000);
        }
    };
    
    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
}

// ========== Fallback Polling ==========
async function fetchAccountData() {
    if (isDemo) return;
    
    try {
        const data = await apiCall('/mt5/account-info');
        if (data) {
            balance = data.balance;
            
            document.getElementById('homeBalance').textContent = '$' + (data.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            document.getElementById('homeBroker').textContent = data.broker || '-';
            document.getElementById('homeAccount').textContent = data.account || '-';
            document.getElementById('homeLeverage').textContent = '1:' + (data.leverage || 0);
            document.getElementById('homeServer').textContent = data.server || '-';
            document.getElementById('homeEquity').textContent = '$' + (data.equity || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            document.getElementById('homeFreeMargin').textContent = '$' + (data.free_margin || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            document.getElementById('homePositions').textContent = data.positions_count || 0;
            
            document.getElementById('tradeBalance').textContent = '$' + Math.round(data.balance || 0).toLocaleString();
            
            document.getElementById('accBalance').textContent = '$' + Math.round(data.balance || 0).toLocaleString();
            document.getElementById('accEquity').textContent = '$' + Math.round(data.equity || 0).toLocaleString();
            document.getElementById('accMargin').textContent = '$' + Math.round(data.margin || 0).toLocaleString();
            document.getElementById('accFree').textContent = '$' + Math.round(data.free_margin || 0).toLocaleString();
            
            if (data.buy_count !== undefined) {
                document.getElementById('indSell').textContent = data.sell_count;
                document.getElementById('indNeutral').textContent = data.neutral_count;
                document.getElementById('indBuy').textContent = data.buy_count;
                document.getElementById('chartIndSell').textContent = data.sell_count;
                document.getElementById('chartIndNeutral').textContent = data.neutral_count;
                document.getElementById('chartIndBuy').textContent = data.buy_count;
                
                baseScore = data.base_score || 50;
            }
            
            if (data.prices && data.prices[chartSymbol]) {
                const price = data.prices[chartSymbol];
                const decimals = getDecimalsForSymbol(chartSymbol);
                document.getElementById('chartBid').textContent = price.bid.toFixed(decimals);
                document.getElementById('chartAsk').textContent = price.ask.toFixed(decimals);
            }
            
            if (data.position) {
                updatePositionUI(true, data.position);
            } else {
                updatePositionUI(false, null);
            }
            
            document.getElementById('statusDot').classList.remove('disconnected');
            document.getElementById('headerStatus').textContent = 'Connected';
        }
    } catch (error) {
        console.error('Fetch error:', error);
        document.getElementById('statusDot').classList.add('disconnected');
        document.getElementById('headerStatus').textContent = 'Disconnected';
    }
}

// ========== Check User Mode ==========
async function checkUserMode() {
    try {
        const response = await fetch(`${API_URL}/demo/account-info`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (data.has_mt5) {
            isDemo = false;
            document.getElementById('headerStatus').textContent = 'Connected';
            document.getElementById('statusDot').style.background = '#00ff88';
            
            const badge = document.getElementById('modeBadge');
            badge.textContent = 'LIVE';
            badge.className = 'mode-badge-live';
            badge.style.display = 'inline';
            connectWebSocket();
            fetchAccountData();
            setInterval(fetchAccountData, 2000);
        } else {
            isDemo = true;
            document.getElementById('headerStatus').textContent = 'Connected';
            document.getElementById('demoControlCard').style.display = 'block';
            document.getElementById('statusDot').style.background = '#00d4ff';
            
            const badge = document.getElementById('modeBadge');
            badge.textContent = 'DEMO';
            badge.className = 'mode-badge-demo';
            badge.style.display = 'inline';
            connectWebSocket();
            fetchDemoData();
            setInterval(fetchDemoData, 500);
            
            setTimeout(() => {
                showToast('📊 Demo 모드로 접속했습니다', '가상 $10,000로 연습하세요!');
            }, 1000);
        }
    } catch (error) {
        console.error('Mode check error:', error);
        isDemo = true;
        fetchDemoData();
    }
}

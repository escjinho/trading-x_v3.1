/* ========================================
   Trading-X WebSocket
   실시간 데이터 연결
   ======================================== */

// ========== WebSocket Variables ==========
let ws = null;
let wsRetryCount = 0;
const maxRetries = 5;
let balance = 0;

// ========== Connect WebSocket ==========
function connectWebSocket() {
    // Demo 모드와 Live 모드에 따라 다른 WebSocket URL 사용
    const wsPath = isDemo ? '/api/demo/ws' : '/api/mt5/ws';
    let wsUrl = typeof getWsUrl === 'function' ? getWsUrl(wsPath) : `ws://localhost:8000${wsPath}`;

    // Demo 모드면 토큰 추가
    if (isDemo && token) {
        wsUrl += `?token=${token}`;
    }

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
            // Balance 업데이트
            if (data.balance !== undefined) {
                balance = data.balance;
                document.getElementById('tradeBalance').textContent = '$' + Math.round(data.balance).toLocaleString();
                document.getElementById('accBalance').textContent = '$' + Math.round(data.balance).toLocaleString();
                if (data.equity !== undefined) {
                    document.getElementById('accEquity').textContent = '$' + Math.round(data.equity).toLocaleString();
                }
            }

            // Chart prices - ChartPanel.updateChartPrice()로 오버레이 업데이트
            if (data.all_prices && data.all_prices[chartSymbol]) {
                const symbolPrice = data.all_prices[chartSymbol];
                if (typeof ChartPanel !== 'undefined' && ChartPanel.updateChartPrice) {
                    ChartPanel.updateChartPrice(symbolPrice.bid);
                }
            }

            // Realtime candle update + indicators (안전한 업데이트)
            if (data.all_candles && data.all_candles[chartSymbol]) {
                if (typeof ChartPanel !== 'undefined' && ChartPanel.safeUpdateCandle) {
                    ChartPanel.safeUpdateCandle(data.all_candles[chartSymbol]);
                }

                if (!window.lastIndicatorUpdate || Date.now() - window.lastIndicatorUpdate > 30000) {
                    window.lastIndicatorUpdate = Date.now();
                    // ★ 장 마감 시 캔들 리로드 중단
                    const _si2 = typeof getSymbolInfo === 'function' ? getSymbolInfo(chartSymbol) : null;
                    const _isCrypto2 = _si2 && _si2.category === 'Crypto Currency';
                    const _now2 = new Date();
                    const _day2 = _now2.getUTCDay();
                    const _hour2 = _now2.getUTCHours();
                    const _marketClosed2 = !_isCrypto2 && (_day2 === 0 || _day2 === 6 || (_day2 === 5 && _hour2 >= 22));
                    if (!_marketClosed2) {
                        loadCandles();
                    }
                }
            }

            // Signal score - 게이지 업데이트 (핵심!)
            if (data.base_score !== undefined) {
                baseScore = data.base_score;
                targetScore = data.base_score;           // ✅ 추가: Trade 탭 게이지용
                chartTargetScore = data.base_score;      // ✅ 추가: Chart 탭 게이지용
            }

            // ★★★ 시그널 게이지 + 인디케이터 (1~3초 랜덤 간격 큐에 위임) ★★★
            if (data.sell_count !== undefined && typeof queueIndicatorUpdate === 'function') {
                queueIndicatorUpdate(data.buy_count, data.sell_count, data.neutral_count);
            }

            // ✅ Demo 모드 포지션 업데이트 (단일 포지션) — 있을 때만 갱신
            if (data.position) {
                updatePositionUI(true, data.position);

                const pos = data.position;
                console.log(`[DEMO] Position - Profit: ${pos.profit}, Target: ${pos.target}`);

                // 타겟 도달시 자동 청산
                if (pos.target > 0 && pos.profit >= pos.target && !isClosing) {
                    console.log('[DEMO] Target reached! Triggering close...');
                    isClosing = true;
                    closeDemoPosition();
                }
            }

            // ✅ Demo 모드 다중 포지션 업데이트 (Quick 패널용)
            if (data.positions && Array.isArray(data.positions)) {
                console.log(`[WS] 💼 Received ${data.positions.length} positions`);

                // multiOrderPositions 배열 업데이트
                if (typeof multiOrderPositions !== 'undefined') {
                    multiOrderPositions = data.positions;

                    // Multi Order 패널이 열려있으면 업데이트
                    if (typeof updateMultiOrderPositionList === 'function') {
                        updateMultiOrderPositionList();
                    }

                    // trading.js의 updateMultiOrderPanelFromData 호출
                    if (typeof updateMultiOrderPanelFromData === 'function') {
                        updateMultiOrderPanelFromData(data);
                    }
                }
            }

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
        
        // Chart prices - ChartPanel.updateChartPrice()로 오버레이 업데이트
        if (data.all_prices && data.all_prices[chartSymbol]) {
            const symbolPrice = data.all_prices[chartSymbol];
            if (typeof ChartPanel !== 'undefined' && ChartPanel.updateChartPrice) {
                ChartPanel.updateChartPrice(symbolPrice.bid);
            }
        }

        // Realtime candle update (안전한 업데이트)
        if (data.all_candles && data.all_candles[chartSymbol]) {
            if (typeof ChartPanel !== 'undefined' && ChartPanel.safeUpdateCandle) {
                ChartPanel.safeUpdateCandle(data.all_candles[chartSymbol]);
            }

            if (!window.lastIndicatorUpdate || Date.now() - window.lastIndicatorUpdate > 30000) {
                window.lastIndicatorUpdate = Date.now();
                // ★ 장 마감 시 캔들 리로드 중단
                const _si3 = typeof getSymbolInfo === 'function' ? getSymbolInfo(chartSymbol) : null;
                const _isCrypto3 = _si3 && _si3.category === 'Crypto Currency';
                const _now3 = new Date();
                const _day3 = _now3.getUTCDay();
                const _hour3 = _now3.getUTCHours();
                const _marketClosed3 = !_isCrypto3 && (_day3 === 0 || _day3 === 6 || (_day3 === 5 && _hour3 >= 22));
                if (!_marketClosed3) {
                    loadCandles();
                }
            }
        }

        // Trade tab
        document.getElementById('tradeBalance').textContent = '$' + Math.round(data.balance).toLocaleString();

        // Signal score
        if (data.base_score !== undefined) {
            baseScore = data.base_score;
            targetScore = data.base_score;           // ✅ 추가: Trade 탭 게이지용
            chartTargetScore = data.base_score;      // ✅ 추가: Chart 탭 게이지용
        }

        // ★★★ 시그널 게이지 + 인디케이터 (1~3초 랜덤 간격 큐에 위임) ★★★
        if (typeof queueIndicatorUpdate === 'function') {
            queueIndicatorUpdate(data.buy_count, data.sell_count, data.neutral_count);
        }
        
        // Position — 있을 때만 갱신
        if (data.position) {
            updatePositionUI(true, data.position);

            const pos = data.position;
            console.log(`[FRONTEND] Position - Profit: ${pos.profit}, Target: ${pos.target}, Should close: ${pos.profit >= pos.target}`);

            if (pos.target > 0 && pos.profit >= pos.target && !isClosing) {
                console.log('[FRONTEND] Target reached! Triggering close...');
                isClosing = true;
                closeDemoPosition();
            }
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
            
            // ★★★ 시그널 게이지 + 인디케이터 (1~3초 랜덤 간격 큐에 위임) ★★★
            if (data.buy_count !== undefined && typeof queueIndicatorUpdate === 'function') {
                queueIndicatorUpdate(data.buy_count, data.sell_count, data.neutral_count);
            }
            
            if (data.prices && data.prices[chartSymbol]) {
                const price = data.prices[chartSymbol];
                const decimals = getDecimalsForSymbol(chartSymbol);
                document.getElementById('chartBid').textContent = price.bid.toFixed(decimals);
                document.getElementById('chartAsk').textContent = price.ask.toFixed(decimals);
            }
            
            if (data.position) {
                updatePositionUI(true, data.position);
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
            setInterval(fetchDemoData, 2000);
            
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

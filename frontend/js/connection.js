// ========== WebSocket ==========
let ws = null;
let wsRetryCount = 0;
const maxRetries = 5;
let pollingInterval = null;  // ★ 폴링 인터벌 저장용

// ========== MT5 자동 백오프 재연결 ==========
const RECONNECT_DELAYS = [1000, 5000, 30000, 60000, 300000]; // 1초, 5초, 30초, 1분, 5분
let reconnectAttempt = 0;
let reconnectTimer = null;

function reconnectWithBackoff() {
    if (reconnectAttempt >= 5) {
        console.log('[MT5] 5회 연속 실패 - 자동 재연결 중지');
        updateConnectionStatus('disconnected');
        return;
    }

    const delay = RECONNECT_DELAYS[reconnectAttempt] || 300000;
    console.log(`[MT5] 연결 실패 (${reconnectAttempt + 1}/5) - ${delay/1000}초 후 재시도`);

    reconnectTimer = setTimeout(() => {
        reconnectAttempt++;
        connectMT5();
    }, delay);
}

// 연결 상태 업데이트 헬퍼 함수
function updateConnectionStatus(status) {
    const statusDot = document.getElementById('statusDot');
    const headerStatus = document.getElementById('headerStatus');

    if (status === 'disconnected') {
        if (statusDot) statusDot.classList.add('disconnected');
        if (headerStatus) headerStatus.textContent = 'Disconnected';
    } else if (status === 'connected') {
        if (statusDot) statusDot.classList.remove('disconnected');
        if (headerStatus) headerStatus.textContent = 'Connected';
    }
}

// MT5 연결 함수 (기존 connectWebSocket을 감싸는 래퍼)
function connectMT5() {
    console.log(`[MT5] 연결 시도 (${reconnectAttempt + 1}/5)`);

    try {
        connectWebSocket();
        // 연결 성공 시 카운터 리셋은 ws.onopen에서 처리
    } catch (e) {
        console.error('[MT5] 연결 오류:', e);
        reconnectWithBackoff();
    }
}

// 테스트용 전역 함수
window.testDisconnect = function() {
    console.log('[TEST] 강제 연결 끊김 시뮬레이션');
    if (ws) ws.close();
    reconnectWithBackoff();
};

window.manualReconnect = function() {
    console.log('[TEST] 수동 재연결');
    reconnectAttempt = 0;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    connectMT5();
};

window.getReconnectStatus = function() {
    return {
        attempt: reconnectAttempt,
        maxAttempts: 5,
        nextDelay: RECONNECT_DELAYS[reconnectAttempt] || 300000
    };
};

function connectWebSocket() {
    // Demo 모드와 Live 모드에 따라 다른 WebSocket URL 사용
    const wsPath = isDemo ? '/api/demo/ws' : '/api/mt5/ws';
    const wsUrl = typeof getWsUrl === 'function' ? getWsUrl(wsPath) : `ws://localhost:8000${wsPath}`;
    console.log(`[connection.js] Connecting to: ${wsUrl} (Demo: ${isDemo})`);
    ws = new WebSocket(wsUrl);
    
    ws.onopen = function() {
        console.log('WebSocket connected');
        document.getElementById('statusDot').classList.remove('disconnected');
        document.getElementById('headerStatus').textContent = 'Connected';
        wsRetryCount = 0;
        reconnectAttempt = 0; // 백오프 카운터 리셋
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        // ★ WebSocket 연결 성공 시 폴링 중지
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
            console.log('[WS] Polling stopped - WebSocket connected');
        }
    };

    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        // console.log('[WebSocket] Received data:', data);  // 너무 많은 로그 방지

        // MT5 연결 상태 확인 (가격 업데이트는 계속 진행)
        if (data.mt5_connected === false) {
            document.getElementById('statusDot').classList.add('disconnected');
            document.getElementById('headerStatus').textContent = 'Disconnected';
            // ★ return 제거 - 가격 데이터는 계속 업데이트
        } else if (data.mt5_connected === true) {
            document.getElementById('statusDot').classList.remove('disconnected');
            document.getElementById('headerStatus').textContent = 'Connected';
        }

        // 마지막 WebSocket 데이터 저장 (navigation.js에서 사용)
        if (typeof lastWebSocketData !== 'undefined') {
            lastWebSocketData = data;
        } else {
            window.lastWebSocketData = data;
        }

        // Demo 모드면 차트/시세만 업데이트하고 계정 정보는 건너뛰기
        if (isDemo) {
            // ★ 전역 가격 저장 (V5 패널에서 사용)
            if (data.all_prices) {
                window.allPrices = data.all_prices;
            }
            
            // Chart prices만 업데이트
            if (data.all_prices && data.all_prices[chartSymbol]) {
                const symbolPrice = data.all_prices[chartSymbol];
                // ChartPanel.updateChartPrice()로 오버레이 업데이트 (천 단위 콤마 포함)
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

            // ★ Demo 모드에서도 포지션 실시간 업데이트
            fetchDemoData();
            
            // ★ V5 패널도 실시간 업데이트
            if (typeof updateMultiOrderPanelV5 === 'function') {
                updateMultiOrderPanelV5();
            }
            
            return;
        }
        
        balance = data.balance;
        
        // Home (null 체크 추가)
        const homeBalance = document.getElementById('homeBalance');
        const homeBroker = document.getElementById('homeBroker');
        const homeAccount = document.getElementById('homeAccount');
        const homeLeverage = document.getElementById('homeLeverage');
        const homeEquity = document.getElementById('homeEquity');
        const homeFreeMargin = document.getElementById('homeFreeMargin');
        const homePositions = document.getElementById('homePositions');
        
        if (homeBalance) homeBalance.textContent = '$' + data.balance.toLocaleString(undefined, {minimumFractionDigits: 2});
        if (homeBroker) homeBroker.textContent = data.broker;
        if (homeAccount) homeAccount.textContent = data.account;
        if (homeLeverage) homeLeverage.textContent = '1:' + data.leverage;

        // ★ homeServer 추가
        const homeServer = document.getElementById('homeServer');
        if (homeServer) homeServer.textContent = data.server || '-';

        if (homeEquity) homeEquity.textContent = '$' + data.equity.toLocaleString(undefined, {minimumFractionDigits: 2});
        if (homeFreeMargin) homeFreeMargin.textContent = '$' + data.free_margin.toLocaleString(undefined, {minimumFractionDigits: 2});
        if (homePositions) homePositions.textContent = data.positions_count;

        // ★ MT5 Account 섹션 업데이트
        const mt5Broker = document.getElementById('mt5Broker');
        const mt5Account = document.getElementById('mt5Account');
        const mt5Server = document.getElementById('mt5Server');
        const mt5Leverage = document.getElementById('mt5Leverage');

        if (mt5Broker) mt5Broker.textContent = data.broker || '-';
        if (mt5Account) mt5Account.textContent = data.account || '-';
        if (mt5Server) mt5Server.textContent = data.server || '-';
        if (mt5Leverage) mt5Leverage.textContent = data.leverage ? `1:${data.leverage}` : '-';

        // ★ 전역 가격 저장 (V5 패널에서 사용)
        if (data.all_prices) {
            window.allPrices = data.all_prices;
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

            // 보조지표도 함께 업데이트 (30초마다)
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

        // 인디케이터 업데이트 (Trade 탭)
        document.getElementById('indSell').textContent = data.sell_count;
        document.getElementById('indNeutral').textContent = data.neutral_count;
        document.getElementById('indBuy').textContent = data.buy_count;

        // Chart 탭 게이지 및 인디케이터 업데이트
        chartTargetScore = targetScore;
        document.getElementById('chartIndSell').textContent = data.sell_count;
        document.getElementById('chartIndNeutral').textContent = data.neutral_count;
        document.getElementById('chartIndBuy').textContent = data.buy_count;
        
        // 포지션 정보
            if (data.position) {
                updatePositionUI(true, data.position);
                window.lastLivePosition = data.position;
                
                // 프론트엔드에서도 목표 도달 체크 (백엔드 보완)
                const pos = data.position;
                console.log(`[FRONTEND] Position - Profit: ${pos.profit}, Target: ${pos.target}, Should close: ${pos.profit >= pos.target}`);
                
                if (pos.target > 0 && pos.profit >= pos.target && !isClosing) {
                    console.log('[FRONTEND] Target reached! Triggering close...');
                    isClosing = true;  // 중복 방지
                    closeDemoPosition();
                }
            } else {
                // Live 모드에서 포지션 청산 감지
                if (!isDemo && window.lastLivePosition) {
                    const lastProfit = window.lastLivePosition.profit || 0;
                    playSound('close');
                    
                    if (lastProfit >= 0) {
                        showToast(`🎯 청산 완료! +$${lastProfit.toFixed(2)}`, 'success');
                    } else {
                        showToast(`💔 청산 완료! $${lastProfit.toFixed(2)}`, 'error');
                    }
                    
                    if (typeof updateTodayPL === 'function') {
                        updateTodayPL(lastProfit);
                    }
                    if (typeof loadHistory === 'function') {
                        loadHistory();
                    }
                    
                    window.lastLivePosition = null;
                }
                updatePositionUI(false, null);
            }
        
        // Account tab (null 체크 + HTML ID에 맞게 수정)
        const accBalance = document.getElementById('accBalance');
        const accEquity = document.getElementById('accEquity');
        const accFree = document.getElementById('accFree');
        const accCurrentPL = document.getElementById('accCurrentPL');
        
        if (accBalance) accBalance.textContent = '$' + data.balance.toLocaleString(undefined, {minimumFractionDigits: 2});
        if (accEquity) accEquity.textContent = '$' + data.equity.toLocaleString(undefined, {minimumFractionDigits: 2});
        // 마진: MT5에서 직접 가져온 값 사용 (소수점 둘째자리, 깜빡임 방지)
        if (accFree) {
            const newMarginText = '$' + (data.margin || 0).toFixed(2);
            if (accFree.textContent !== newMarginText) {
                accFree.textContent = newMarginText;
            }
        }
        // Current P&L 업데이트 (전체 포지션 손익 합계)
        if (accCurrentPL) {
            let currentProfit = 0;
            
            // Buy/Sell 포지션 손익 (magic=100001)
            if (data.position) {
                currentProfit += data.position.profit || 0;
            }
            
            // V5 포지션 손익 (magic=100002)
            if (typeof v5Positions !== 'undefined' && v5Positions && v5Positions.length > 0) {
                v5Positions.forEach(pos => {
                    currentProfit += pos.profit || 0;
                });
            }
            
            // 깜빡임 방지: 값이 변경된 경우에만 업데이트
            const newText = currentProfit >= 0 
                ? '+$' + currentProfit.toFixed(2) 
                : '-$' + Math.abs(currentProfit).toFixed(2);
            const newColor = currentProfit >= 0 ? 'var(--buy-color)' : 'var(--sell-color)';
            
            if (accCurrentPL.textContent !== newText) {
                accCurrentPL.textContent = newText;
                accCurrentPL.style.color = newColor;
            }
        }
        
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
        
        // ★ V5 패널 실시간 업데이트 (라이브 모드)
        if (typeof updateMultiOrderPanelV5 === 'function') {
            updateMultiOrderPanelV5();
        }
        
        // 패널 동기화 (Today P/L 등)
        if (typeof syncAccountInfoToPanels === 'function') {
            syncAccountInfoToPanels();
        }
    };
    
    ws.onclose = function() {
        console.log('WebSocket disconnected');
        document.getElementById('statusDot').classList.add('disconnected');
        document.getElementById('headerStatus').textContent = 'Disconnected';

        // ★ WebSocket 끊어지면 폴링 시작 (Live 모드일 때만)
        if (!isDemo && !pollingInterval) {
            pollingInterval = setInterval(fetchAccountData, 2000);
            console.log('[WS] Polling started - WebSocket disconnected');
        }

        // 백오프 로직으로 재연결
        reconnectWithBackoff();
    };

    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
}

// Fallback polling
async function fetchAccountData() {
    // Demo 모드면 실행 안 함
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
            
            const accBalance = document.getElementById('accBalance');
            const accEquity = document.getElementById('accEquity');
            const accFree = document.getElementById('accFree');
            const accCurrentPL = document.getElementById('accCurrentPL');
            
            if (accBalance) accBalance.textContent = '$' + (data.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            if (accEquity) accEquity.textContent = '$' + (data.equity || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            // 마진: 소수점 둘째자리 (WebSocket과 동일 형식)
            if (accFree) {
                const newMarginText = '$' + (data.margin || 0).toFixed(2);
                if (accFree.textContent !== newMarginText) {
                    accFree.textContent = newMarginText;
                }
            }
            
            // Current P&L 업데이트 (전체 포지션 손익 합계)
            if (accCurrentPL) {
                let currentProfit = 0;
                
                // Buy/Sell 포지션 손익 (magic=100001)
                if (data.position) {
                    currentProfit += data.position.profit || 0;
                }
                
                // V5 포지션 손익 (magic=100002) - 전역 변수에서 가져오기
                if (typeof v5Positions !== 'undefined' && v5Positions && v5Positions.length > 0) {
                    v5Positions.forEach(pos => {
                        currentProfit += pos.profit || 0;
                    });
                }
                
                // 값이 변경된 경우에만 업데이트 (깜빡임 방지)
                const newText = currentProfit >= 0 
                    ? '+$' + currentProfit.toFixed(2) 
                    : '-$' + Math.abs(currentProfit).toFixed(2);
                
                if (accCurrentPL.textContent !== newText) {
                    accCurrentPL.textContent = newText;
                    accCurrentPL.style.color = currentProfit >= 0 ? 'var(--buy-color)' : 'var(--sell-color)';
                }
            }
            
            if (data.buy_count !== undefined) {
                console.log('[fetchAccountData] Updating indicators:', data.sell_count, data.neutral_count, data.buy_count);
                document.getElementById('indSell').textContent = data.sell_count || 0;
                document.getElementById('indNeutral').textContent = data.neutral_count || 0;
                document.getElementById('indBuy').textContent = data.buy_count || 0;
                document.getElementById('chartIndSell').textContent = data.sell_count || 0;
                document.getElementById('chartIndNeutral').textContent = data.neutral_count || 0;
                document.getElementById('chartIndBuy').textContent = data.buy_count || 0;

                baseScore = data.base_score || 50;
            }
            
            if (data.prices && data.prices[chartSymbol]) {
                const price = data.prices[chartSymbol];
                const decimals = getDecimalsForSymbol(chartSymbol);
                document.getElementById('chartBid').textContent = price.bid.toFixed(decimals);
                document.getElementById('chartAsk').textContent = price.ask.toFixed(decimals);
            }
            
            // 포지션 상태 변화 감지 (청산 감지)
            if (data.position) {
                updatePositionUI(true, data.position);
                window.lastLivePosition = data.position;
            } else {
                // 이전에 포지션이 있었는데 지금 없으면 = 청산됨!
                if (window.lastLivePosition) {
                    const lastProfit = window.lastLivePosition.profit || 0;
                    playSound('close');
                    
                    if (lastProfit >= 0) {
                        showToast(`🎯 청산 완료! +$${lastProfit.toFixed(2)}`, 'success');
                    } else {
                        showToast(`💔 청산 완료! $${lastProfit.toFixed(2)}`, 'error');
                    }
                    
                    // Today P/L 업데이트
                    const accTodayPL = document.getElementById('accTodayPL');
                    if (accTodayPL) {
                        const currentPL = parseFloat(accTodayPL.textContent.replace(/[^0-9.-]/g, '')) || 0;
                        const newPL = currentPL + lastProfit;
                        if (newPL >= 0) {
                            accTodayPL.textContent = '+$' + newPL.toFixed(2);
                            accTodayPL.style.color = 'var(--buy-color)';
                        } else {
                            accTodayPL.textContent = '-$' + Math.abs(newPL).toFixed(2);
                            accTodayPL.style.color = 'var(--sell-color)';
                        }
                    }
                    
                    // 거래내역 새로고침 (약간 딜레이 후)
                    setTimeout(() => {
                        if (typeof loadHistory === 'function') {
                            loadHistory();
                        }
                    }, 500);
                    
                    window.lastLivePosition = null;
                }
                updatePositionUI(false, null);
            }
            
            document.getElementById('statusDot').classList.remove('disconnected');
            document.getElementById('headerStatus').textContent = 'Connected';
        }
    } catch (error) {
        console.error('Fetch error:', error);
        // 에러가 나도 바로 Disconnected로 바꾸지 않음 (일시적 오류일 수 있음)
        console.log('Fetch error, will retry...');
    }
}

// ========== Demo/Live 모드 확인 ==========
async function checkUserMode() {
    try {
        // 먼저 Demo 계정 정보 조회
        const response = await fetch(`${API_URL}/demo/account-info`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (data.has_mt5) {
            // MT5 계정 연결됨 → Live 모드
            isDemo = false;
            document.getElementById('headerStatus').textContent = 'Connected';
            document.getElementById('statusDot').style.background = '#00ff88';
            document.getElementById('statusDot').classList.remove('disconnected');
            
            // Live 배지 표시
            const badge = document.getElementById('modeBadge');
            badge.textContent = 'LIVE';
            badge.className = 'mode-badge-live';
            badge.style.display = 'inline';
            
            // ★ Trading Mode UI를 Live로 설정
            const liveBtn = document.getElementById('modeLiveBtn');
            const demoBtn = document.getElementById('modeDemoBtn');
            const liveCheck = document.getElementById('liveCheck');
            const demoCheck = document.getElementById('demoCheck');
            const modeStatus = document.getElementById('modeStatus');
            const demoControl = document.getElementById('demoControlCard');
            
            if (liveBtn && demoBtn) {
                liveBtn.classList.add('active', 'live-active');
                demoBtn.classList.remove('active');
                liveCheck.style.display = 'flex';
                demoCheck.style.display = 'none';
                modeStatus.className = 'mode-status live';
                modeStatus.innerHTML = '<span class="mode-status-dot live"></span><span>Currently in <strong>Live Mode</strong> - Real trading active</span>';
            }
            if (demoControl) demoControl.style.display = 'none';
            
            // Hero 배지도 업데이트
            const heroBadge = document.getElementById('heroModeBadge');
            if (heroBadge) {
                heroBadge.textContent = 'Trading-X Live';
                heroBadge.style.background = 'linear-gradient(135deg, rgba(0, 255, 136, 0.2) 0%, rgba(0, 255, 136, 0.05) 100%)';
                heroBadge.style.borderColor = 'rgba(0, 255, 136, 0.4)';
                heroBadge.style.color = '#ffffff';
            }
            
            updateHeroCTA('live');
            
            // WebSocket 연결 (실패해도 폴링으로 대체)
            try {
                connectWebSocket();
            } catch (e) {
                console.log('WebSocket connection failed, using polling');
                // ★ WebSocket 실패 시에만 폴링 시작
                if (!pollingInterval) {
                    pollingInterval = setInterval(fetchAccountData, 2000);
                }
            }

            fetchAccountData();  // 초기 데이터 1회 로드

            // ★ 히스토리 로드 (Today P/L 계산)
            if (typeof loadHistory === 'function') {
                loadHistory();
            }

            // ★ 폴링은 ws.onclose에서 자동 시작됨 (여기서는 시작하지 않음)
            
        } else {
            // MT5 없음 → Demo 모드
            isDemo = true;
            document.getElementById('headerStatus').textContent = 'Connected';
            document.getElementById('statusDot').style.background = '#00d4ff';
            
            // ★ Trading Mode UI를 Demo로 설정
            const liveBtn = document.getElementById('modeLiveBtn');
            const demoBtn = document.getElementById('modeDemoBtn');
            const liveCheck = document.getElementById('liveCheck');
            const demoCheck = document.getElementById('demoCheck');
            const modeStatus = document.getElementById('modeStatus');
            const demoControl = document.getElementById('demoControlCard');
            
            if (liveBtn && demoBtn) {
                demoBtn.classList.add('active');
                demoBtn.classList.remove('live-active');
                liveBtn.classList.remove('active', 'live-active');
                demoCheck.style.display = 'flex';
                liveCheck.style.display = 'none';
                modeStatus.className = 'mode-status';
                modeStatus.innerHTML = '<span class="mode-status-dot demo"></span><span>Currently in <strong>Demo Mode</strong> - Practice with virtual $10,000</span>';
            }
            if (demoControl) demoControl.style.display = 'block';
            
            // Hero 배지도 업데이트
            const heroBadge = document.getElementById('heroModeBadge');
            if (heroBadge) {
                heroBadge.textContent = 'Trading-X Demo';
                heroBadge.style.background = 'linear-gradient(135deg, rgba(0, 212, 255, 0.2) 0%, rgba(0, 212, 255, 0.05) 100%)';
                heroBadge.style.borderColor = 'rgba(0, 212, 255, 0.4)';
                heroBadge.style.color = '#ffffff';
            }
            
            updateHeroCTA('demo');

            // Demo 배지 표시
            const badge = document.getElementById('modeBadge');
            badge.textContent = 'DEMO';
            badge.className = 'mode-badge-demo';
            badge.style.display = 'inline';
            
            connectWebSocket();

            // ★ Demo 데이터 즉시 로드 (Account Overview 업데이트)
            if (token) {
                await fetchDemoData();  // await 추가하여 즉시 실행
                
                // ★ 히스토리 로드 (Today P/L 계산)
                if (typeof loadHistory === 'function') {
                    loadHistory();
                }
                
                setInterval(fetchDemoData, 500);
            }

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

// ========== Demo 데이터 조회 ==========
async function fetchDemoData() {
    // Demo 모드가 아니면 실행 안 함
    if (!isDemo) {
        console.log('[fetchDemoData] ⚠️ Not in Demo mode, skipping');
        return;
    }

    console.log('[fetchDemoData] 🔵 START - Fetching account info...');
    try {
        const response = await fetch(`${API_URL}/demo/account-info`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        console.log('[fetchDemoData] 📦 Received data:', data);
        console.log('[fetchDemoData] 📍 Position data:', data.position);
        console.log('[fetchDemoData] 📊 Positions count:', data.positions_count);
        
        if (data) {
            // 백엔드에서 자동 청산된 경우
            if (data.auto_closed) {
                playSound('close');
                
                const profit = data.closed_profit || 0;
                const isWin = data.is_win !== false && profit >= 0;
                
                // 마틴 모드인 경우
                if (currentMode === 'martin' && martinEnabled) {
                    if (data.martin_reset || isWin) {
                        // 마틴 성공! 리셋 또는 성공 확인 팝업
                        martinStep = 1;
                        martinAccumulatedLoss = 0;
                        martinHistory = [];
                        updateMartinUI();
                        showMartinSuccessPopup(profit);
                    } else if (data.martin_step_up) {
                        // 마틴 손실 → 다음 단계로
                        showMartinPopup(profit);
                    } else {
                        showToast(data.message || `💔 손절! ${profit.toFixed(2)}`, 'error');
                    }
                } else {
                    // Basic/NoLimit 모드
                    if (isWin) {
                        showToast(data.message || `🎯 목표 도달! +$${profit.toFixed(2)}`, 'success');
                    } else {
                        showToast(data.message || `💔 손절! $${profit.toFixed(2)}`, 'error');
                    }
                }
                
                // Today P/L 업데이트
                updateTodayPL(profit);
                
                // 포지션 UI 업데이트
                updatePositionUI(false, null);
            }
            
            // Home 탭 업데이트 (null 체크 추가)
            const homeBalance = document.getElementById('homeBalance');
            const homeBroker = document.getElementById('homeBroker');
            const homeAccount = document.getElementById('homeAccount');
            const homeLeverage = document.getElementById('homeLeverage');
            const homeServer = document.getElementById('homeServer');
            const homeEquity = document.getElementById('homeEquity');
            const homeFreeMargin = document.getElementById('homeFreeMargin');
            const homePositions = document.getElementById('homePositions');
            const tradeBalance = document.getElementById('tradeBalance');

            if (homeBalance) homeBalance.textContent = '$' + (data.balance || 10000).toLocaleString(undefined, {minimumFractionDigits: 2});
            if (homeBroker) homeBroker.textContent = data.broker || 'Demo';
            if (homeAccount) homeAccount.textContent = data.account || 'DEMO';
            if (homeLeverage) homeLeverage.textContent = '1:' + (data.leverage || 500);
            if (homeServer) homeServer.textContent = data.server || 'Demo';
            if (homeEquity) homeEquity.textContent = '$' + (data.equity || 10000).toLocaleString(undefined, {minimumFractionDigits: 2});
            if (homeFreeMargin) homeFreeMargin.textContent = '$' + (data.balance || 10000).toLocaleString(undefined, {minimumFractionDigits: 2});
            if (homePositions) homePositions.textContent = data.positions_count || 0;
            if (tradeBalance) tradeBalance.textContent = '$' + Math.round(data.balance || 10000).toLocaleString();

            // Account 탭 업데이트 (null 체크 추가)
            const accBalance = document.getElementById('accBalance');
            const accEquity = document.getElementById('accEquity');
            const accFree = document.getElementById('accFree');
            const accCurrentPL = document.getElementById('accCurrentPL');

            if (accBalance) accBalance.textContent = '$' + (data.balance || 10000).toLocaleString(undefined, {minimumFractionDigits: 2});
            if (accEquity) accEquity.textContent = '$' + (data.equity || 10000).toLocaleString(undefined, {minimumFractionDigits: 2});
            
            // Demo 마진: 포지션에서 직접 합산
            if (accFree) {
                let totalMargin = 0;
                
                if (data.position && data.position.margin) {
                    totalMargin = data.position.margin;
                } else if (data.positions && data.positions.length > 0) {
                    data.positions.forEach(pos => {
                        totalMargin += pos.margin || 0;
                    });
                }
                
                accFree.textContent = '$' + totalMargin.toFixed(2);
            }
            
            // Current P&L 업데이트 (현재 포지션 손익)
            if (accCurrentPL) {
                let currentProfit = 0;
                if (data.position) {
                    currentProfit = data.position.profit || 0;
                } else if (data.positions && data.positions.length > 0) {
                    // 다중 포지션인 경우 합계
                    currentProfit = data.positions.reduce((sum, pos) => sum + (pos.profit || 0), 0);
                }
                
                if (currentProfit >= 0) {
                    accCurrentPL.textContent = '+$' + currentProfit.toFixed(2);
                    accCurrentPL.style.color = 'var(--buy-color)';
                } else {
                    accCurrentPL.textContent = '-$' + Math.abs(currentProfit).toFixed(2);
                    accCurrentPL.style.color = 'var(--sell-color)';
                }
            }
            
            // 포지션 정보
            if (data.position) {
                console.log('[fetchDemoData] ✅ Position exists!');
                console.log('[fetchDemoData] 📞 Calling updatePositionUI(true, posData)');
                
                // ★ P/L 게이지용 profit 값 저장
                window.currentProfit = data.position.profit || 0;
                window.currentTarget = data.position.target || targetAmount;
                console.log('[fetchDemoData] Position details:', {
                    type: data.position.type,
                    symbol: data.position.symbol,
                    entry: data.position.entry,
                    profit: data.position.profit,
                    target: data.position.target
                });
                updatePositionUI(true, data.position);

                // 프론트엔드에서도 목표 도달 체크 (빠른 청산)
                const pos = data.position;
                const currentTarget = pos.target || targetAmount;

                // WIN 또는 LOSE 조건 체크
                if (currentTarget > 0 && !isClosing) {
                    if (pos.profit >= currentTarget) {
                        // WIN 조건
                        console.log('[fetchDemoData] 🎯 WIN Target reached! Profit:', pos.profit, '>=', currentTarget);
                        isClosing = true;
                        closeDemoPosition();
                    } else if (pos.profit <= -currentTarget) {
                        // LOSE 조건
                        console.log('[fetchDemoData] 💔 LOSE Target reached! Profit:', pos.profit, '<=', -currentTarget);
                        isClosing = true;
                        closeDemoPosition();
                    }
                }
            } else {
                console.log('[fetchDemoData] ❌ No position');
                console.log('[fetchDemoData] 📞 Calling updatePositionUI(false, null)');
                
                // ★ 포지션 없을 때 profit 초기화
                window.currentProfit = 0;
                window.currentTarget = 0;
                
                updatePositionUI(false, null);
                isClosing = false;  // 포지션 없으면 플래그 해제
            }
            
            // Quick 패널 업데이트 (Quick 패널이 활성화된 경우)
            const quickPanel = document.getElementById('quickPanel');
            if (quickPanel && quickPanel.classList.contains('active')) {
                updateQuickPanelFromData(data);
            }

            // ========== 인디케이터 업데이트 추가 ==========
            try {
                const indResponse = await fetch(`${API_URL}/mt5/indicators/${currentSymbol || 'BTCUSD'}`);
                const indData = await indResponse.json();
                if (indData) {
                    document.getElementById('indSell').textContent = indData.sell || 0;
                    document.getElementById('indNeutral').textContent = indData.neutral || 0;
                    document.getElementById('indBuy').textContent = indData.buy || 0;
                    document.getElementById('chartIndSell').textContent = indData.sell || 0;
                    document.getElementById('chartIndNeutral').textContent = indData.neutral || 0;
                    document.getElementById('chartIndBuy').textContent = indData.buy || 0;
                    
                    if (indData.score !== undefined) {
                        baseScore = indData.score;
                        targetScore = indData.score;
                        chartTargetScore = indData.score;
                    }
                }
            } catch (e) {
                console.log('[fetchDemoData] Indicator fetch error:', e);
            }
            // ========== 인디케이터 업데이트 끝 ==========
            
            // Demo 마틴 상태 조회 (변경된 경우에만 업데이트)
            if (currentMode === 'martin' && martinEnabled) {
                try {
                    const martinRes = await fetch(`${API_URL}/demo/martin/state`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const martinData = await martinRes.json();
                    
                    if (martinData) {
                        // 값이 변경된 경우에만 업데이트 (깜빡임 방지)
                        const newStep = martinData.step || 1;
                        const newLoss = martinData.accumulated_loss || 0;
                        
                        if (martinStep !== newStep || martinAccumulatedLoss !== newLoss) {
                            martinStep = newStep;
                            martinAccumulatedLoss = newLoss;
                            martinLevel = martinData.max_steps || 5;
                            lotSize = martinData.base_lot || 0.01;
                            
                            document.getElementById('tradeLotSize').textContent = martinData.current_lot?.toFixed(2) || lotSize.toFixed(2);
                            updateMartinUI();
                        }
                    }
                } catch (e) {
                    console.log('Martin state error:', e);
                }
            }
        }
    } catch (error) {
        console.error('[fetchDemoData] ❌ ERROR:', error);
    }

    console.log('[fetchDemoData] 🔴 END');
    
    // 패널 동기화 (Today P/L 등)
    if (typeof syncAccountInfoToPanels === 'function') {
        syncAccountInfoToPanels();
    }
}

// Initialize
if (!isGuest && token) {
    // 로그인 사용자 - Demo인지 Live인지 확인
    checkUserMode();
} else if (isGuest) {
    // 게스트 모드 - 데모 데이터 표시
    document.getElementById('homeBalance').textContent = '$10,000.00';
    document.getElementById('homeBroker').textContent = 'Demo Broker';
    document.getElementById('homeAccount').textContent = 'GUEST';
    document.getElementById('homeLeverage').textContent = '1:500';
    document.getElementById('homeServer').textContent = 'Demo Server';
    document.getElementById('homeEquity').textContent = '$10,000.00';
    document.getElementById('homeFreeMargin').textContent = '$10,000.00';
    document.getElementById('homePositions').textContent = '0';
    document.getElementById('tradeBalance').textContent = '$10,000';
    document.getElementById('headerStatus').textContent = 'Guest Mode';
    document.getElementById('statusDot').style.background = '#ffa500';
    
    // 게스트 모드 인디케이터 업데이트
    async function fetchGuestIndicators() {
        try {
            const response = await fetch(`${API_URL}/mt5/indicators/BTCUSD`);
            const data = await response.json();
            if (data) {
                document.getElementById('indSell').textContent = data.sell || 0;
                document.getElementById('indNeutral').textContent = data.neutral || 0;
                document.getElementById('indBuy').textContent = data.buy || 0;
                document.getElementById('chartIndSell').textContent = data.sell || 0;
                document.getElementById('chartIndNeutral').textContent = data.neutral || 0;
                document.getElementById('chartIndBuy').textContent = data.buy || 0;
                console.log('Guest indicators updated:', data.sell, data.neutral, data.buy);
                baseScore = data.score || 50;
            }
        } catch (e) {
            console.log('Guest indicator error:', e);
        }
    }
    
    fetchGuestIndicators();
    setInterval(fetchGuestIndicators, 3000);
    
    // 게스트 안내 토스트
    setTimeout(() => {
        showToast('👋 게스트 모드로 둘러보는 중입니다', '');
    }, 1000);
    
    updateHeroCTA('guest');
}

// Profile name
const userEmail = localStorage.getItem('user_email');
if (userEmail) {
    document.getElementById('profileName').textContent = userEmail.split('@')[0];
}

// 인사말 업데이트
updateGreeting();
setInterval(updateGreeting, 60000);

// 프로모션 슬라이더 이벤트
document.getElementById('promoSlider')?.addEventListener('scroll', function() {
    const slider = this;
    const scrollLeft = slider.scrollLeft;
    const cardWidth = slider.querySelector('.promo-card')?.offsetWidth || 0;
    const gap = 12;
    const index = Math.round(scrollLeft / (cardWidth + gap));
    updatePromoDots(index);
});

// ========== Trading Mode 전환 ==========
function switchTradingMode(mode) {
    const demoBtn = document.getElementById('modeDemoBtn');
    const liveBtn = document.getElementById('modeLiveBtn');
    const demoCheck = document.getElementById('demoCheck');
    const liveCheck = document.getElementById('liveCheck');
    const modeStatus = document.getElementById('modeStatus');
    const modeBadge = document.getElementById('modeBadge');
    
    if (mode === 'demo') {
        // Demo 모드로 전환
        demoBtn.classList.add('active');
        demoBtn.classList.remove('live-active');
        liveBtn.classList.remove('active', 'live-active');
        demoCheck.style.display = 'flex';
        liveCheck.style.display = 'none';
        
        modeStatus.className = 'mode-status';
        modeStatus.innerHTML = '<span class="mode-status-dot demo"></span><span>Currently in <strong>Demo Mode</strong> - Practice with virtual $10,000</span>';
        
        // 배지 업데이트
        if (modeBadge) {
            modeBadge.textContent = 'DEMO';
            modeBadge.className = 'mode-badge-demo';
            modeBadge.style.display = 'inline';
        }
        
        // ★ Hero 배지 업데이트 추가
        const heroBadge = document.getElementById('heroModeBadge');
        if (heroBadge) {
            heroBadge.textContent = 'Trading-X Demo';
            heroBadge.style.color = '#ffffff';
        }
        
        // Demo Control 표시
        const demoControl = document.getElementById('demoControlCard');
        if (demoControl) demoControl.style.display = 'block';
        
        isDemo = true;
        showToast('🎮 Demo 모드로 전환되었습니다', 'success');
        updateHeroCTA('demo_with_live');
        fetchDemoData();
        
        // 패널 동기화
        setTimeout(() => {
            if (typeof loadHistory === 'function') loadHistory();
            if (typeof updateMultiOrderPanelV5 === 'function') updateMultiOrderPanelV5();
            if (typeof syncTradeTodayPL === 'function') syncTradeTodayPL();
        }, 500);
        
    } else if (mode === 'live') {
        // Live 모드 전환 시도
        // MT5 계정 연결 확인 필요
        if (!token) {
            showToast('로그인이 필요합니다', 'error');
            return;
        }
        
        // MT5 연결 확인 API 호출
        checkMT5Connection().then(hasMT5 => {
            if (hasMT5) {
                // Live 모드로 전환
                liveBtn.classList.add('active', 'live-active');
                demoBtn.classList.remove('active');
                liveCheck.style.display = 'flex';
                demoCheck.style.display = 'none';
                
                modeStatus.className = 'mode-status live';
                modeStatus.innerHTML = '<span class="mode-status-dot live"></span><span>Currently in <strong>Live Mode</strong> - Real trading active</span>';
                
                // 배지 업데이트
                if (modeBadge) {
                    modeBadge.textContent = 'LIVE';
                    modeBadge.className = 'mode-badge-live';
                    modeBadge.style.display = 'inline';
                }
                
                // ★ Hero 배지 업데이트 추가
                const heroBadge = document.getElementById('heroModeBadge');
                if (heroBadge) {
                    heroBadge.textContent = 'Trading-X Live';
                    heroBadge.style.color = '#ffffff';
                }
                
                // Demo Control 숨기기
                const demoControl = document.getElementById('demoControlCard');
                if (demoControl) demoControl.style.display = 'none';
                
                isDemo = false;
                showToast('💎 Live 모드로 전환되었습니다', 'success');
                updateHeroCTA('live');
                fetchAccountData();
                
                // 패널 동기화
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                    if (typeof updateMultiOrderPanelV5 === 'function') updateMultiOrderPanelV5();
                    if (typeof syncTradeTodayPL === 'function') syncTradeTodayPL();
                }, 500);
                
            } else {
                showToast('MT5 계정을 먼저 연결해주세요', 'error');
                // MT5 연결 섹션으로 스크롤
                document.getElementById('mt5AccountSection')?.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }
}

async function checkMT5Connection() {
    try {
        const response = await fetch(`${API_URL}/demo/account-info`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        return data.has_mt5 || false;
    } catch (e) {
        return false;
    }
}

// 초기 모드 상태 반영
function initTradingModeUI() {
    if (isDemo) {
        switchTradingMode('demo');
    } else {
        const liveBtn = document.getElementById('modeLiveBtn');
        const demoBtn = document.getElementById('modeDemoBtn');
        const liveCheck = document.getElementById('liveCheck');
        const demoCheck = document.getElementById('demoCheck');
        const modeStatus = document.getElementById('modeStatus');
        
        if (liveBtn && demoBtn) {
            liveBtn.classList.add('active', 'live-active');
            demoBtn.classList.remove('active');
            liveCheck.style.display = 'flex';
            demoCheck.style.display = 'none';
            
            modeStatus.className = 'mode-status live';
            modeStatus.innerHTML = '<span class="mode-status-dot live"></span><span>Currently in <strong>Live Mode</strong> - Real trading active</span>';
        }
    }
}

// ========== MT5 Account 관리 ==========
function updateMT5AccountUI(hasMT5, mt5Data = null) {
    const notConnected = document.getElementById('mt5NotConnected');
    const connected = document.getElementById('mt5Connected');
    
    if (hasMT5 && mt5Data) {
        // 연결됨 상태 표시
        notConnected.style.display = 'none';
        connected.style.display = 'block';
        
        document.getElementById('mt5Broker').textContent = mt5Data.broker || '-';
        document.getElementById('mt5Account').textContent = mt5Data.account || '-';
        document.getElementById('mt5Server').textContent = mt5Data.server || '-';
        document.getElementById('mt5Leverage').textContent = mt5Data.leverage ? `1:${mt5Data.leverage}` : '-';
    } else {
        // 연결 안 됨 상태 표시
        notConnected.style.display = 'block';
        connected.style.display = 'none';
    }
}

async function disconnectMT5() {
    if (!confirm('MT5 계좌 연결을 해제하시겠습니까?')) return;
    
    try {
        const response = await fetch(`${API_URL}/mt5/disconnect`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (data.success) {
            updateMT5AccountUI(false);
            switchTradingMode('demo');
            showToast('MT5 계좌 연결이 해제되었습니다', 'success');
        } else {
            showToast(data.message || '연결 해제 실패', 'error');
        }
    } catch (e) {
        console.error('Disconnect error:', e);
        showToast('연결 해제 실패', 'error');
    }
}

// MT5 상태 확인 및 UI 업데이트
async function checkAndUpdateMT5Status() {
    try {
        const response = await fetch(`${API_URL}/demo/account-info`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (data.has_mt5) {
            // MT5 정보 조회
            const mt5Response = await fetch(`${API_URL}/mt5/account-info`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const mt5Data = await mt5Response.json();
            
            updateMT5AccountUI(true, {
                broker: mt5Data.broker,
                account: mt5Data.account,
                server: mt5Data.server,
                leverage: mt5Data.leverage
            });
        } else {
            updateMT5AccountUI(false);
        }
    } catch (e) {
        updateMT5AccountUI(false);
    }
}

// 페이지 로드 시 MT5 상태 확인
if (token && !isGuest) {
    checkAndUpdateMT5Status();
}

// ========== MT5 연결 모달 ==========
function openMT5ConnectModal() {
    document.getElementById('mt5ConnectModal').classList.add('show');
    showMT5Step1();
}

function closeMT5ConnectModal() {
    document.getElementById('mt5ConnectModal').classList.remove('show');
}

function showMT5Step1() {
    document.getElementById('mt5Step1').style.display = 'block';
    document.getElementById('mt5Step2Existing').style.display = 'none';
    document.getElementById('mt5Step2New').style.display = 'none';
}

function showMT5Step2(type) {
    document.getElementById('mt5Step1').style.display = 'none';
    if (type === 'existing') {
        document.getElementById('mt5Step2Existing').style.display = 'block';
        document.getElementById('mt5Step2New').style.display = 'none';
    } else {
        document.getElementById('mt5Step2Existing').style.display = 'none';
        document.getElementById('mt5Step2New').style.display = 'block';
    }
}

function openMT5GuideModal() {
    openMT5ConnectModal();
    showMT5Step2('new');
}

async function connectMT5Account() {
    const server = document.getElementById('mt5Server').value;
    const account = document.getElementById('mt5AccountNumber').value;
    const password = document.getElementById('mt5Password').value;
    
    if (!account || !password) {
        showToast('계좌번호와 비밀번호를 입력하세요', 'error');
        return;
    }
    
    showToast('연결 중...', '');
    
    try {
        // 실제 API 호출
        const response = await fetch(`${API_URL}/mt5/connect`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ server, account, password })
        });
        const result = await response.json();
        
        if (result.success) {
            closeMT5ConnectModal();
            
            // 성공 모달 표시
            document.getElementById('successAccount').textContent = account;
            document.getElementById('successServer').textContent = server || 'HedgeHood-MT5';
            document.getElementById('mt5SuccessModal').classList.add('show');
            
            // MT5 연결 상태 업데이트
            updateMT5AccountUI(true, {
                broker: 'HedgeHood Pty Ltd',
                account: account,
                server: server || 'HedgeHood-MT5',
                leverage: 500
            });
            
            // Live 모드로 전환
            isDemo = false;
            
            // 배지 업데이트
            const modeBadge = document.getElementById('modeBadge');
            if (modeBadge) {
                modeBadge.textContent = 'LIVE';
                modeBadge.className = 'mode-badge-live';
            }
            
            // Hero 배지 업데이트
            const heroBadge = document.getElementById('heroModeBadge');
            if (heroBadge) {
                heroBadge.textContent = 'Trading-X Live';
                heroBadge.style.background = 'linear-gradient(135deg, rgba(0, 255, 136, 0.2) 0%, rgba(0, 255, 136, 0.05) 100%)';
                heroBadge.style.borderColor = 'rgba(0, 255, 136, 0.4)';
                heroBadge.style.color = '#00ff88';
            }
            
            // Trading Mode UI 업데이트
            const liveBtn = document.getElementById('modeLiveBtn');
            const demoBtn = document.getElementById('modeDemoBtn');
            const liveCheck = document.getElementById('liveCheck');
            const demoCheck = document.getElementById('demoCheck');
            const modeStatus = document.getElementById('modeStatus');
            const demoControl = document.getElementById('demoControlCard');
            
            if (liveBtn && demoBtn) {
                liveBtn.classList.add('active', 'live-active');
                demoBtn.classList.remove('active');
                liveCheck.style.display = 'flex';
                demoCheck.style.display = 'none';
                modeStatus.className = 'mode-status live';
                modeStatus.innerHTML = '<span class="mode-status-dot live"></span><span>Currently in <strong>Live Mode</strong> - Real trading active</span>';
            }
            if (demoControl) demoControl.style.display = 'none';
            
            // WebSocket 재연결 (Demo → Live URL로 변경)
            if (ws) {
                ws.close();
            }
            connectWebSocket();
            
            // Live 데이터 조회 시작
            fetchAccountData();
            // ★ 폴링은 ws.onclose에서 자동 시작됨 (중복 방지)

            showToast('🎉 MT5 계정 연결 완료!', 'success');
            
        } else {
            showToast(result.message || '연결 실패', 'error');
        }
        
    } catch (error) {
        console.error('MT5 Connect error:', error);
        showToast('연결 실패: ' + error.message, 'error');
    }
}

function closeMT5SuccessModal() {
    document.getElementById('mt5SuccessModal').classList.remove('show');
}

// ========== 히어로 섹션 CTA 업데이트 ==========
function updateHeroCTA(mode) {
    const ctaDesc = document.querySelector('.live-cta-desc');
    const ctaBtn = document.querySelector('.live-cta-btn');
    if (!ctaDesc || !ctaBtn) return;
    
    if (mode === 'guest') {
        // 게스트 모드
        ctaDesc.innerHTML = '<span style="color: #ffffff; font-size: 16px; font-weight: 600;">부담 없이 체험해보세요!</span><br>가입 후 데모자금으로 자유롭게 연습 해 보세요!';
        ctaBtn.innerHTML = '<span class="material-icons-round">person_add</span>무료체험 시작';
        ctaBtn.className = 'live-cta-btn';
        ctaBtn.onclick = function() { window.location.href = 'register.html'; };
    } else if (mode === 'demo') {
        // 로그인 + 라이브 미연결
        ctaDesc.innerHTML = '라이브 계좌를 연결하고<br>실거래를 시작하세요!';
        ctaBtn.innerHTML = '<span class="material-icons-round">link</span>라이브 계좌 연결';
        ctaBtn.className = 'live-cta-btn';
        ctaBtn.onclick = function() { scrollToMT5Section(); };
    } else if (mode === 'demo_with_live') {
        // 로그인 + 라이브 연결 O + 데모 모드 (랜덤 멘트)
        const messages = [
            {
                desc: '안전하게 연습 중! 💪<br>실거래 준비되면 라이브로 전환하세요',
                btn: '라이브 모드 시작'
            },
            {
                desc: '좋아요! 충분히 연습하고 계시네요 👍<br>준비되면 실거래를 시작해보세요',
                btn: '라이브 모드 전환'
            }
        ];
        const random = messages[Math.floor(Math.random() * messages.length)];
        ctaDesc.innerHTML = random.desc;
        ctaBtn.innerHTML = '<span class="material-icons-round">swap_horiz</span>' + random.btn;
        ctaBtn.className = 'live-cta-btn';
        ctaBtn.onclick = function() { switchTradingMode('live'); };
    } else if (mode === 'live') {
        // 로그인 + 라이브 연결
        ctaDesc.innerHTML = '실거래 준비 완료!<br>오늘도 성공적인 트레이딩 되세요 💪';
        ctaBtn.innerHTML = '<span class="material-icons-round">trending_up</span>거래 시작하기';
        ctaBtn.className = 'live-cta-btn success';
        ctaBtn.onclick = function() { switchTab('trading'); };
    }
}
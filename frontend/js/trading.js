// ========== Buy/Sell 패널 매직넘버 ==========
const BUYSELL_MAGIC_NUMBER = 100001;

// ========== 마틴 팝업 ==========
function showMartinPopup(currentLoss) {
    pendingLoss = Math.abs(currentLoss);
    const nextStep = martinStep + 1;
    const nextLot = lotSize * Math.pow(2, martinStep);
    const accumulated = martinAccumulatedLoss + pendingLoss;
    const recoveryTarget = Math.ceil((accumulated + 11 + targetAmount) / 10) * 10;
    
    document.getElementById('popupCurrentStep').textContent = martinStep;
    document.getElementById('popupCurrentStepKr').textContent = martinStep;
    document.getElementById('popupCurrentLoss').textContent = '-$' + pendingLoss.toFixed(2);
    document.getElementById('popupAccumulatedLoss').textContent = '-$' + accumulated.toFixed(2);
    document.getElementById('popupNextLot').textContent = nextLot.toFixed(2) + ' lot';
    document.getElementById('popupRecoveryTarget').textContent = '+$' + recoveryTarget;
    document.getElementById('popupNextStep').textContent = nextStep;
    document.getElementById('popupNextStepKr').textContent = nextStep;
    
    document.getElementById('martinPopup').style.display = 'flex';
}

function hideMartinPopup() {
    document.getElementById('martinPopup').style.display = 'none';
}

function martinPopupSettings() {
    document.getElementById('martinPopup').style.display = 'none';
    martinStep = 1;
    martinAccumulatedLoss = 0;
    martinHistory = [];
    openSettings();
}

async function martinPopupContinue() {
    martinHistory[martinStep - 1] = -1;
    
    const result = await apiCall(`/mt5/martin/update?profit=${-pendingLoss}`, 'POST');
    
    if (result && result.success && result.action === 'next_step') {
        martinStep = result.state.step;
        martinAccumulatedLoss = result.state.accumulated_loss;
        
        const newTarget = Math.ceil((martinAccumulatedLoss + 11 + 50) / 10) * 10;
        targetAmount = newTarget;
        
        updateMartinUI();
        showToast('Step ' + martinStep + '으로 이동 (Lot: ' + (lotSize * Math.pow(2, martinStep - 1)).toFixed(2) + ')', 'error');
    }
    
    hideMartinPopup();
}

function showMaxPopup(totalLoss) {
    document.getElementById('maxPopupTotalLoss').textContent = '-$' + totalLoss.toFixed(2);
    document.getElementById('maxPopupStepsUsed').textContent = martinLevel + ' / ' + martinLevel;
    document.getElementById('martinMaxPopup').style.display = 'flex';
}

function closeMaxPopup() {
    document.getElementById('martinMaxPopup').style.display = 'none';
    
    // 마틴 리셋
    martinStep = 1;
    martinAccumulatedLoss = 0;
    martinHistory = [];
    updateMartinUI();
    
    showToast('마틴이 1단계로 초기화되었습니다', '');
}

// ========== 마틴 성공 팝업 ==========
function showMartinSuccessPopup(profit) {
    const recovered = martinAccumulatedLoss;
    
    document.getElementById('successPopupProfit').textContent = '+$' + profit.toFixed(2);
    document.getElementById('successPopupRecovered').textContent = '$' + recovered.toFixed(2);
    
    document.getElementById('martinSuccessPopup').style.display = 'flex';
}

function martinSuccessToSettings() {
    document.getElementById('martinSuccessPopup').style.display = 'none';
    openSettings();
}

function martinSuccessContinue() {
    document.getElementById('martinSuccessPopup').style.display = 'none';
    
    // 1단계로 리셋 (이미 백엔드에서 처리됨)
    martinStep = 1;
    martinAccumulatedLoss = 0;
    martinHistory = [];
    targetAmount = 50;  // 기본 목표로 리셋
    
    updateMartinUI();
    showToast('🚀 1단계로 다시 시작합니다!', 'success');
}

// ========== Today P/L ==========
function updateTodayPL(profit) {
    // 1. Account 탭 Today P/L 즉시 업데이트
    const accTodayPL = document.getElementById('accTodayPL');
    if (accTodayPL) {
        // 현재 값 파싱
        let currentPL = 0;
        const text = accTodayPL.textContent.replace(/[^0-9.-]/g, '');
        if (text) {
            currentPL = parseFloat(text) || 0;
            // 음수 체크
            if (accTodayPL.textContent.includes('-$')) {
                currentPL = -Math.abs(currentPL);
            }
        }
        
        // 새 값 계산
        const newPL = currentPL + profit;
        
        // Account 탭 업데이트
        if (newPL >= 0) {
            accTodayPL.textContent = '+$' + newPL.toFixed(2);
            accTodayPL.style.color = 'var(--buy-color)';
        } else {
            accTodayPL.textContent = '-$' + Math.abs(newPL).toFixed(2);
            accTodayPL.style.color = 'var(--sell-color)';
        }
        
        console.log(`[updateTodayPL] Profit: ${profit}, Current: ${currentPL}, New: ${newPL}`);
    }
    
    // 2. Buy/Sell 패널도 즉시 동기화
    syncTradeTodayPL();
    
    // 3. V5 패널도 즉시 동기화
    if (typeof updateV5AccountInfo === 'function') {
        updateV5AccountInfo();
    }
    
    // 4. 윈/로스 즉시 업데이트
    updateWinLossImmediate(profit);
    
    // 5. 나중에 히스토리로 정확한 값 검증 (서버 동기화)
    setTimeout(() => {
        if (typeof loadHistory === 'function') loadHistory();
    }, 1000);
}

// Buy/Sell 패널 Today P/L을 Account 탭과 동기화
function syncTradeTodayPL() {
    const accTodayPL = document.getElementById('accTodayPL');
    const tradeTodayPL = document.getElementById('tradeTodayPL');
    
    if (accTodayPL && tradeTodayPL) {
        tradeTodayPL.textContent = accTodayPL.textContent;
        tradeTodayPL.style.color = accTodayPL.style.color;
    }
}

// 청산 직후 윈/로스 즉시 업데이트
function updateWinLossImmediate(profit) {
    const winLoseEl = document.getElementById('accWinLose');
    if (!winLoseEl) return;
    
    const current = winLoseEl.textContent.split(' / ');
    let wins = parseInt(current[0]) || 0;
    let losses = parseInt(current[1]) || 0;
    
    if (profit > 0) {
        wins++;
    } else if (profit < 0) {
        losses++;
    }
    
    winLoseEl.textContent = `${wins} / ${losses}`;
    console.log(`[updateWinLossImmediate] Profit: ${profit}, Wins: ${wins}, Losses: ${losses}`);
}

// ========== P/L Gauge ==========
function updatePLGauge(currentPL, target = null) {
    // ★ 디버깅 로그 추가
    console.log(`[updatePLGauge] Called with PL: ${currentPL}, Target: ${target}`);
    
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

// ========== 포지션 UI ==========
function updatePositionUI(hasPos, posData) {
    hasPosition = hasPos;
    positionData = posData;

    if (hasPos && posData) {
        console.log('[updatePositionUI] ✅ Showing position view');
        console.log('[updatePositionUI] Hiding targetSection, showing positionSection');

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
            console.log('[updatePositionUI] ⏱️ Started position timer');
        }

        const actualTarget = posData.target || targetAmount;
        updatePLGauge(posData.profit, actualTarget);

        document.getElementById('plMin').textContent = '-$' + actualTarget;
        document.getElementById('plMax').textContent = '+$' + actualTarget;

        console.log('[updatePositionUI] ✅ Position view displayed successfully');
    } else {
        console.log('[updatePositionUI] ❌ Showing target view (no position)');
        console.log('[updatePositionUI] Showing targetSection, hiding positionSection');

        document.getElementById('targetSection').style.display = 'block';
        document.getElementById('positionSection').style.display = 'none';
        document.getElementById('tradeButtonsNoPos').style.display = 'block';
        document.getElementById('tradeButtonsHasPos').style.display = 'none';

        stopPositionTimer();
        console.log('[updatePositionUI] ⏱️ Stopped position timer');
    }

    console.log('[updatePositionUI] 🔴 END');
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

// ========== 거래 함수 ==========
function calculateLot() {
    if (currentMode === 'martin') return lotSize;
    let lot = leverage * 0.1;
    return Math.round(lot * 100) / 100;  // 0.01 단위로 반올림
}

// ★★★ Bridge 주문 결과 폴링 함수 ★★★
async function pollOrderResult(orderId, orderType) {
    const maxAttempts = 8;  // 2초 간격 × 8 = 최대 16초
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
            const res = await apiCall(`/mt5/bridge/orders/result/${orderId}`, 'GET');
            if (res && res.status !== 'pending') {
                showToast(res.message || (res.success ? 'Order Success!' : 'Order Failed'), res.success ? 'success' : 'error');
                if (res.success) {
                    playSound(orderType.toLowerCase());
                    if (typeof fetchDemoData === 'function') fetchDemoData();
                }
                return res;
            }
        } catch (e) { /* continue polling */ }
    }
    showToast('Order timeout - check positions', 'warning');
    return null;
}

async function placeBuy() {
    if (!checkGuestAction('trade')) return;

    // Demo 모드면 Demo API 사용
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
            result = await apiCall(`/mt5/order?symbol=${currentSymbol}&order_type=BUY&volume=${lot}&target=${targetAmount}&magic=100001`, 'POST');
        }

        // ★★★ Bridge 모드: 결과 폴링 ★★★
        if (result?.bridge_mode && result?.order_id) {
            showToast('Order sent to MT5...', '');
            pollOrderResult(result.order_id, 'BUY');
            return;
        }

        showToast(result?.message || 'Error', result?.success ? 'success' : 'error');
        if (result?.success) playSound('buy');
    } catch (e) { showToast('Network error', 'error'); }
}

async function placeSell() {
    if (!checkGuestAction('trade')) return;

    // Demo 모드면 Demo API 사용
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
            result = await apiCall(`/mt5/order?symbol=${currentSymbol}&order_type=SELL&volume=${lot}&target=${targetAmount}&magic=100001`, 'POST');
        }

        // ★★★ Bridge 모드: 결과 폴링 ★★★
        if (result?.bridge_mode && result?.order_id) {
            showToast('Order sent to MT5...', '');
            pollOrderResult(result.order_id, 'SELL');
            return;
        }

        showToast(result?.message || 'Error', result?.success ? 'success' : 'error');
        if (result?.success) playSound('sell');
    } catch (e) { showToast('Network error', 'error'); }
}

async function closePosition() {
    // Demo 모드면 Demo API 사용
    if (isDemo) {
        closeDemoPosition();
        return;
    }
    
    showToast('Closing...', '');
    try {
        const result = await apiCall(`/mt5/close?symbol=${currentSymbol}&magic=${BUYSELL_MAGIC_NUMBER}`, 'POST');
        
        if (result?.success) {
            playSound('close');
            const profit = result.profit || 0;
            
            // 마틴 모드 처리
            if (currentMode === 'martin' && martinEnabled) {
                const baseTarget = 50;  // 1단계 기본 타겟
                const currentDisplayTarget = baseTarget * Math.pow(2, martinStep - 1) + martinAccumulatedLoss;
                
                // Case 1: 수익으로 청산
                if (profit > 0) {
                    if (profit >= martinAccumulatedLoss && martinAccumulatedLoss > 0) {
                        // Case 1-A: 전액 회복 → 마틴 성공!
                        await apiCall('/mt5/martin/reset-full', 'POST');
                        
                        martinStep = 1;
                        martinAccumulatedLoss = 0;
                        martinHistory = [];
                        updateMartinUI();
                        updateTodayPL(profit);
                        showMartinSuccessPopup(profit);
                    } else if (profit < martinAccumulatedLoss || martinAccumulatedLoss === 0) {
                        // Case 1-B: 일부 회복 → 단계 유지, 타겟만 조정
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
                // Case 2: 손실로 청산 (Close 버튼)
                else if (profit < 0) {
                    const lossAmount = Math.abs(profit);
                    const halfTarget = currentDisplayTarget / 2;
                    
                    if (lossAmount >= halfTarget) {
                        // Case 2-A: 손실 >= 50% → 다음 단계로
                        const newStep = Math.min(martinStep + 1, martinLevel);
                        const newAccumulatedLoss = martinAccumulatedLoss + lossAmount;
                        
                        if (newStep > martinLevel) {
                            // 최대 단계 초과 → 강제 리셋
                            await apiCall('/mt5/martin/reset-full', 'POST');
                            
                            showMaxPopup(newAccumulatedLoss);
                            martinStep = 1;
                            martinAccumulatedLoss = 0;
                            martinHistory = [];
                        } else {
                            await apiCall(`/mt5/martin/update-state?step=${newStep}&accumulated_loss=${newAccumulatedLoss}`, 'POST');
                            
                            martinStep = newStep;
                            martinAccumulatedLoss = newAccumulatedLoss;
                            showToast(`📈 Step ${newStep}로 진행! 손실: -$${lossAmount.toFixed(2)}`, 'error');
                        }
                    } else {
                        // Case 2-B: 손실 < 50% → 단계 유지, 타겟만 조정
                        const newAccumulatedLoss = martinAccumulatedLoss + lossAmount;
                        
                        await apiCall(`/mt5/martin/update-state?step=${martinStep}&accumulated_loss=${newAccumulatedLoss}`, 'POST');
                        
                        martinAccumulatedLoss = newAccumulatedLoss;
                        showToast(`📊 단계 유지! 손실: -$${lossAmount.toFixed(2)} (누적: $${newAccumulatedLoss.toFixed(2)})`, 'error');
                    }
                    
                    updateTodayPL(profit);
                    updateMartinUI();
                }
                // Case 3: 손익 0 (Break-even)
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

// ========== Demo 모드 주문 ==========
async function placeDemoOrder(orderType) {
    console.log(`[placeDemoOrder] 🔵 START - Order: ${orderType}, Symbol: ${currentSymbol}, Target: ${targetAmount}`);
    showToast('Processing...', '');
    try {
        let response;

        // 마틴 모드면 마틴 API 사용
        if (currentMode === 'martin' && martinEnabled) {
            console.log('[placeDemoOrder] Using Martin API');
            response = await fetch(`${API_URL}/demo/martin/order?symbol=${currentSymbol}&order_type=${orderType}&target=${targetAmount}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } else {
            const lot = calculateLot();
            console.log(`[placeDemoOrder] Using Basic API, Lot: ${lot}`);
            response = await fetch(`${API_URL}/demo/order?symbol=${currentSymbol}&order_type=${orderType}&volume=${lot}&target=${targetAmount}&magic=${BUYSELL_MAGIC_NUMBER}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        }

        const result = await response.json();
        console.log('[placeDemoOrder] 📦 Server response:', result);

        showToast(result?.message || 'Error', result?.success ? 'success' : 'error');
        if (result?.success) {
            playSound(orderType.toLowerCase());

            // 마틴 모드면 단계 정보 업데이트
            if (result.martin_step) {
                martinStep = result.martin_step;
                updateMartinUI();
            }

            console.log('[placeDemoOrder] ✅ Order success - calling fetchDemoData()');
            fetchDemoData();
        } else {
            console.error('[placeDemoOrder] ❌ Order failed:', result?.message);
        }
    } catch (e) {
        console.error('[placeDemoOrder] ❌ Network error:', e);
        showToast('Network error', 'error');
    }
    console.log('[placeDemoOrder] 🔴 END');
}

// ========== Demo 모드 청산 ==========
async function closeDemoPosition() {
    showToast('Closing...', '');
    try {
        const response = await fetch(`${API_URL}/demo/close?magic=${BUYSELL_MAGIC_NUMBER}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await response.json();
        
        if (result?.success) {
            playSound('close');
            const profit = result.profit || 0;
            
            // 마틴 모드 처리
            if (currentMode === 'martin' && martinEnabled) {
                const baseTarget = 50;  // 1단계 기본 타겟
                const currentDisplayTarget = baseTarget * Math.pow(2, martinStep - 1) + martinAccumulatedLoss;
                
                // Case 1: 수익으로 청산
                if (profit > 0) {
                    if (profit >= martinAccumulatedLoss && martinAccumulatedLoss > 0) {
                        // Case 1-A: 전액 회복 → 마틴 성공!
                        await fetch(`${API_URL}/demo/martin/reset-full`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        
                        martinStep = 1;
                        martinAccumulatedLoss = 0;
                        martinHistory = [];
                        updateMartinUI();
                        updateTodayPL(profit);
                        showMartinSuccessPopup(profit);
                    } else if (profit < martinAccumulatedLoss || martinAccumulatedLoss === 0) {
                        // Case 1-B: 일부 회복 → 단계 유지, 타겟만 조정
                        const remainingLoss = Math.max(0, martinAccumulatedLoss - profit);
                        
                        await fetch(`${API_URL}/demo/martin/update-state?step=${martinStep}&accumulated_loss=${remainingLoss}`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        
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
                // Case 2: 손실로 청산 (Close 버튼)
                else if (profit < 0) {
                    const lossAmount = Math.abs(profit);
                    const halfTarget = currentDisplayTarget / 2;
                    
                    if (lossAmount >= halfTarget) {
                        // Case 2-A: 손실 >= 50% → 다음 단계로
                        const newStep = Math.min(martinStep + 1, martinLevel);
                        const newAccumulatedLoss = martinAccumulatedLoss + lossAmount;
                        
                        if (newStep > martinLevel) {
                            // 최대 단계 초과 → 강제 리셋
                            await fetch(`${API_URL}/demo/martin/reset-full`, {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${token}` }
                            });
                            
                            showMaxPopup(newAccumulatedLoss);
                            martinStep = 1;
                            martinAccumulatedLoss = 0;
                            martinHistory = [];
                        } else {
                            await fetch(`${API_URL}/demo/martin/update-state?step=${newStep}&accumulated_loss=${newAccumulatedLoss}`, {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${token}` }
                            });
                            
                            martinStep = newStep;
                            martinAccumulatedLoss = newAccumulatedLoss;
                            showToast(`📈 Step ${newStep}로 진행! 손실: -$${lossAmount.toFixed(2)}`, 'error');
                        }
                    } else {
                        // Case 2-B: 손실 < 50% → 단계 유지, 타겟만 조정
                        const newAccumulatedLoss = martinAccumulatedLoss + lossAmount;
                        
                        await fetch(`${API_URL}/demo/martin/update-state?step=${martinStep}&accumulated_loss=${newAccumulatedLoss}`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        
                        martinAccumulatedLoss = newAccumulatedLoss;
                        showToast(`📊 단계 유지! 손실: -$${lossAmount.toFixed(2)} (누적: $${newAccumulatedLoss.toFixed(2)})`, 'error');
                    }
                    
                    updateTodayPL(profit);
                    updateMartinUI();
                }
                // Case 3: 손익 0 (Break-even)
                else {
                    showToast('청산 완료 (손익 없음)', 'success');
                }
            } else {
                // Basic/NoLimit 모드
                updateTodayPL(profit);
                showToast(result?.message || 'Closed!', 'success');
            }
            
            updatePositionUI(false, null);
            fetchDemoData();
        } else {
            showToast(result?.message || 'Error', 'error');
        }
    } catch (e) {
        showToast('Network error', 'error');
    } finally {
        isClosing = false;
    }
}

// ========== Demo 충전 ==========
async function topupDemo() {
    try {
        const response = await fetch(`${API_URL}/demo/topup`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await response.json();
        showToast(result.message, result.success ? 'success' : 'error');
        if (result.success) fetchDemoData();
    } catch (e) {
        showToast('충전 실패', 'error');
    }
}

// ========== Demo 리셋 ==========
async function resetDemo() {
    if (!confirm('정말 잔고를 $10,000로 초기화하시겠습니까?\n모든 포지션과 거래 기록이 삭제됩니다.')) return;
    
    try {
        const response = await fetch(`${API_URL}/demo/reset`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await response.json();
        showToast(result.message, result.success ? 'success' : 'error');
        if (result.success) fetchDemoData();
    } catch (e) {
        showToast('리셋 실패', 'error');
    }
}

// ========== 거래 내역 ==========
let allHistoryData = [];
let currentPeriod = 'week';  // 기본값: 1주일
let currentFilter = 'all';

async function loadHistory() {
    const endpoint = isDemo ? '/demo/history' : '/mt5/history';
    const data = await apiCall(endpoint);
    
    if (data?.history) {
        allHistoryData = data.history;
        
        // 시간순 정렬 (최신순)
        allHistoryData.sort((a, b) => new Date(b.time) - new Date(a.time));
        
        updateAccountStats(allHistoryData);
        renderFilteredHistory();
        updateHistorySummary();
        
        // Account Info 업데이트 추가
        if (typeof updateAccountInfoFromHistory === 'function') {
            updateAccountInfoFromHistory(allHistoryData);
        }
    } else {
        document.getElementById('historyList').innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">No trade history</p>';
    }
}

function updateAccountStats(history) {
    // 오늘 날짜 (MM/DD 형식)
    const now = new Date();
    const todayStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
    
    let todayWins = 0;
    let todayLosses = 0;
    let todayPL = 0;
    
    history.forEach(h => {
        // MM/DD 형식으로 오늘 거래만 필터링
        if (h.time && h.time.startsWith(todayStr)) {
            todayPL += h.profit;
            if (h.profit >= 0) {
                todayWins++;
            } else {
                todayLosses++;
            }
        }
    });
    
    // Win/Lose 업데이트
    const winLoseEl = document.getElementById('accWinLose');
    if (winLoseEl) {
        winLoseEl.textContent = `${todayWins} / ${todayLosses}`;
    }
    
    // Today P&L 업데이트
    const todayPLEl = document.getElementById('accTodayPL');
    if (todayPLEl) {
        if (todayPL >= 0) {
            todayPLEl.textContent = '+$' + todayPL.toFixed(2);
            todayPLEl.style.color = 'var(--buy-color)';
        } else {
            todayPLEl.textContent = '-$' + Math.abs(todayPL).toFixed(2);
            todayPLEl.style.color = 'var(--sell-color)';
        }
    }
    
    console.log(`[updateAccountStats] Today: ${todayStr}, Wins: ${todayWins}, Losses: ${todayLosses}, PL: ${todayPL}`);
    
    // 전역 변수에 저장 (다른 곳에서 사용 가능)
    window.todayWins = todayWins;
    window.todayLosses = todayLosses;
    
    // Buy/Sell 패널 Today P/L 동기화
    if (typeof syncTradeTodayPL === 'function') {
        syncTradeTodayPL();
    }
}

// 청산 직후 윈/로스 즉시 업데이트 (히스토리 API 대기 없이)
function updateWinLossImmediate(profit) {
    const winLoseEl = document.getElementById('accWinLose');
    if (!winLoseEl) return;
    
    // 현재 값 파싱
    const current = winLoseEl.textContent.split(' / ');
    let wins = parseInt(current[0]) || 0;
    let losses = parseInt(current[1]) || 0;
    
    // 수익/손실에 따라 증가
    if (profit > 0) {
        wins++;
    } else if (profit < 0) {
        losses++;
    }
    
    winLoseEl.textContent = `${wins} / ${losses}`;
    console.log(`[updateWinLossImmediate] Profit: ${profit}, Wins: ${wins}, Losses: ${losses}`);
}

// 기간 드롭다운 토글
function togglePeriodDropdown() {
    const dropdown = document.getElementById('periodDropdown');
    dropdown.classList.toggle('show');
}

// 기간 선택
function selectPeriod(period, text) {
    currentPeriod = period;
    document.getElementById('selectedPeriodText').textContent = text;
    
    // 옵션 활성화 상태 업데이트
    document.querySelectorAll('.period-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.period === period);
    });
    
    // 드롭다운 닫기
    document.getElementById('periodDropdown').classList.remove('show');
    
    renderFilteredHistory();
    updateHistorySummary();
}

// 타입 필터 (All/수익/손실)
function filterHistoryByType(filter) {
    currentFilter = filter;
    
    document.querySelectorAll('.history-tab-inline').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filter === filter);
    });
    
    renderFilteredHistory();
}

// MT5 서버 시간 기준으로 "오늘"의 시작 시간 계산
// MT5 서버: GMT+2 (서머타임 시 GMT+3)
// 한국: GMT+9 → 차이: 7시간 (서머타임 시 6시간)
function getMT5TodayStart() {
    const now = new Date();
    
    // MT5 서버 시간 오프셋 (GMT+2 = 120분, 서머타임 GMT+3 = 180분)
    // 서머타임 체크 (대략 3월 마지막 일요일 ~ 10월 마지막 일요일)
    const month = now.getMonth(); // 0-11
    const isSummerTime = month >= 2 && month <= 9; // 3월~10월 (대략적)
    const mt5OffsetMinutes = isSummerTime ? 180 : 120; // GMT+3 or GMT+2
    
    // 현재 UTC 시간
    const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000);
    
    // MT5 서버 시간
    const mt5Now = new Date(utcNow + (mt5OffsetMinutes * 60000));
    
    // MT5 서버 기준 오늘 00:00
    const mt5TodayStart = new Date(mt5Now.getFullYear(), mt5Now.getMonth(), mt5Now.getDate());
    
    // 다시 로컬 시간으로 변환
    const localTodayStart = new Date(mt5TodayStart.getTime() - (mt5OffsetMinutes * 60000) - (now.getTimezoneOffset() * 60000));
    
    return localTodayStart;
}

// MT5 서버 시간 기준으로 N일 전 시작 시간 계산
function getMT5DaysAgoStart(days) {
    const todayStart = getMT5TodayStart();
    return new Date(todayStart.getTime() - (days * 24 * 60 * 60 * 1000));
}

// 날짜 비교 헬퍼 함수
function parseTradeDate(timeStr) {
    // "01/19 04:39" 형식 또는 다른 형식 처리
    try {
        // 년도가 없으면 현재 년도 추가
        if (timeStr.match(/^\d{2}\/\d{2}/)) {
            const currentYear = new Date().getFullYear();
            const [monthDay, time] = timeStr.split(' ');
            const [month, day] = monthDay.split('/');
            return new Date(currentYear, parseInt(month) - 1, parseInt(day));
        }
        return new Date(timeStr);
    } catch (e) {
        return new Date();
    }
}

// 기간별 데이터 필터링
function getFilteredByPeriod() {
    let filtered = [...allHistoryData];
    
    // 오늘 날짜 (MM/DD 형식)
    const now = new Date();
    const todayStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
    
    // 1주일 전 날짜
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekAgoStr = `${String(weekAgo.getMonth() + 1).padStart(2, '0')}/${String(weekAgo.getDate()).padStart(2, '0')}`;
    
    // 1달 전 날짜
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const monthAgoStr = `${String(monthAgo.getMonth() + 1).padStart(2, '0')}/${String(monthAgo.getDate()).padStart(2, '0')}`;
    
    if (currentPeriod === 'today') {
        // 오늘 거래만 필터링 (MM/DD 형식으로 비교)
        filtered = filtered.filter(h => {
            if (!h.time) return false;
            return h.time.startsWith(todayStr);
        });
    } else if (currentPeriod === 'week') {
        // 최근 7일 거래 필터링
        filtered = filtered.filter(h => {
            if (!h.time) return false;
            const tradeDate = parseTradeDate(h.time);
            return tradeDate >= weekAgo;
        });
    } else if (currentPeriod === 'month') {
        // 최근 30일 거래 필터링
        filtered = filtered.filter(h => {
            if (!h.time) return false;
            const tradeDate = parseTradeDate(h.time);
            return tradeDate >= monthAgo;
        });
    }
    // 'all'이면 필터링 없음
    
    return filtered;
}

// 기간별 서머리 업데이트
function updateHistorySummary() {
    // 선택된 기간의 거래 내역
    const filtered = getFilteredByPeriod();
    
    // 통계 계산
    let wins = 0;
    let losses = 0;
    let totalVolume = 0;
    let totalPL = 0;
    
    filtered.forEach(h => {
        if (h.profit >= 0) {
            wins++;
        } else {
            losses++;
        }
        totalVolume += h.volume || 0;
        totalPL += h.profit;
    });
    
    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;
    
    // UI 업데이트
    const winRateEl = document.getElementById('summaryWinRate');
    const volumeEl = document.getElementById('summaryVolume');
    const plEl = document.getElementById('summaryPL');
    
    if (winRateEl) {
        winRateEl.textContent = winRate.toFixed(1) + '%';
        // 승률에 따른 색상 (50% 이상이면 녹색, 미만이면 빨간색)
        if (winRate >= 50) {
            winRateEl.className = 'history-summary-value positive';
        } else if (totalTrades > 0) {
            winRateEl.className = 'history-summary-value negative';
        } else {
            winRateEl.className = 'history-summary-value';
        }
    }
    
    if (volumeEl) {
        volumeEl.textContent = totalVolume.toFixed(2) + ' lot';
    }
    
    if (plEl) {
        if (totalPL >= 0) {
            plEl.textContent = '+$' + totalPL.toFixed(2);
            plEl.className = 'history-summary-value positive';
        } else {
            plEl.textContent = '-$' + Math.abs(totalPL).toFixed(2);
            plEl.className = 'history-summary-value negative';
        }
    }
}

// 필터링된 히스토리 렌더링
function renderFilteredHistory() {
    const container = document.getElementById('historyList');
    let filtered = getFilteredByPeriod();
    
    // 타입 필터링 (수익/손실)
    if (currentFilter === 'profit') {
        filtered = filtered.filter(h => h.profit >= 0);
    } else if (currentFilter === 'loss') {
        filtered = filtered.filter(h => h.profit < 0);
    }
    
    // 렌더링
    if (filtered.length > 0) {
        let html = '';
        filtered.forEach(h => {
            const profitClass = h.profit >= 0 ? 'positive' : 'negative';
            const profitSign = h.profit >= 0 ? '+' : '';
            const typeColor = h.type === 'BUY' ? 'var(--buy-color)' : 'var(--sell-color)';
            
            // 가격 포맷팅 (종목별 소수점 자릿수)
            let entryPrice = h.entry || 0;
            let exitPrice = h.exit || 0;
            let decimals = 2;
            
            if (h.symbol) {
                if (h.symbol.includes('JPY')) {
                    decimals = 3;  // JPY 페어
                } else if (h.symbol.includes('XAU') || h.symbol.includes('XAG')) {
                    decimals = 2;  // 금, 은
                } else if (h.symbol.includes('BTC') || h.symbol.includes('ETH')) {
                    decimals = 2;  // 암호화폐
                } else if (h.symbol.includes('US100') || h.symbol.includes('US30') || h.symbol.includes('US500') || h.symbol.includes('GER') || h.symbol.includes('UK100')) {
                    decimals = 2;  // 지수
                } else if (h.symbol.includes('USD') || h.symbol.includes('EUR') || h.symbol.includes('GBP') || h.symbol.includes('AUD') || h.symbol.includes('NZD') || h.symbol.includes('CAD') || h.symbol.includes('CHF')) {
                    decimals = 5;  // 메이저 FX 페어
                } else {
                    decimals = 2;  // 기본값
                }
            }
            
            const entryStr = entryPrice.toFixed(decimals);
            const exitStr = exitPrice.toFixed(decimals);
            
            html += `<div class="history-item">
                <div style="flex:1;display:flex;align-items:center;gap:8px;margin-left:5px;">
                    <span style="font-size:15px;font-weight:600;min-width:130px;">${h.symbol} <span style="color:${typeColor};font-weight:600;font-size:15px;">${h.type}</span></span>
                    <span class="history-time">${h.time}</span>
                    <span style="color:rgba(255,255,255,0.2);">|</span>
                    <span class="history-time">${h.volume} lot</span>
                </div>
                <span class="history-profit ${profitClass}" style="min-width:80px;text-align:right;font-size:15px;margin-right:5px;">${profitSign}$${h.profit.toFixed(2)}</span>
            </div>`;
        });
        container.innerHTML = html;
    } else {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">해당 조건의 거래 내역이 없습니다</p>';
    }
}

// 드롭다운 외부 클릭 시 닫기
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('periodDropdown');
    const btn = document.querySelector('.period-dropdown-btn');
    if (dropdown && btn && !btn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('show');
    }
});

// ========== 슬라이더 로직 (v2에서 복원) ==========
function updateSliderBackground(slider, value, max) {
    const percent = (value / max) * 100;
    slider.style.background = `linear-gradient(to right, #00d4ff 0%, #00d4ff ${percent}%, #2d3139 ${percent}%, #2d3139 100%)`;
}

function updateTargetUI() {
    const targetSlider = document.getElementById('targetSlider');
    const leverageSlider = document.getElementById('leverageSlider');

    if (!targetSlider || !leverageSlider) return;

    let targetMax = 200;
    let leverageMax = 20;

    // 무제한 모드면 잔고 기준 50%, 레버리지 최대 50
    if (currentMode === 'noLimit') {
        // 항상 DOM에서 현재 잔고 가져오기 (balance 변수가 동기화 안 될 수 있음)
        let currentBalance = 10000;
        const balanceEl = document.getElementById('tradeBalance');
        if (balanceEl) {
            const balanceText = balanceEl.textContent.replace(/[$,]/g, '');
            currentBalance = parseFloat(balanceText) || 10000;
        }
        targetMax = Math.floor(currentBalance * 0.5);
        leverageMax = 50;
    }

    // 슬라이더 max 값 업데이트
    targetSlider.max = targetMax;
    leverageSlider.max = leverageMax;

    // 타겟 값 업데이트 (정수로 표시)
    document.getElementById('targetValue').textContent = '$' + Math.round(targetAmount);
    targetSlider.value = targetAmount;
    updateSliderBackground(targetSlider, targetAmount, targetMax);

    // 레버리지 값 업데이트
    document.getElementById('leverageDisplay').textContent = 'x' + leverage;
    leverageSlider.value = leverage;
    updateSliderBackground(leverageSlider, leverage, leverageMax);

    // Lot 계산 및 표시
    let calculatedLot = currentMode === 'martin' ? lotSize : leverage * 0.1;
    calculatedLot = Math.round(calculatedLot * 100) / 100;

    const lotDisplayEl = document.getElementById('lotDisplay');
    if (lotDisplayEl) {
        lotDisplayEl.textContent = calculatedLot.toFixed(2) + ' lot (x' + leverage + ')';
    }

    const tradeLotSizeEl = document.getElementById('tradeLotSize');
    if (tradeLotSizeEl) {
        tradeLotSizeEl.textContent = calculatedLot.toFixed(2);
    }
}

function adjustTarget(delta) {
    let targetMax = 200;
    if (currentMode === 'noLimit') {
        targetMax = Math.floor(balance * 0.5);
    }

    let amount = targetAmount + delta;
    // 5 단위로 반올림, 최소값 5, 최대값 targetMax
    amount = Math.round(amount / 5) * 5;
    amount = Math.max(5, Math.min(targetMax, amount));
    targetAmount = amount;
    updateTargetUI();
}

function updateTargetFromSlider(value) {
    let amount = parseInt(value);
    // 5 단위로 반올림, 최소값 5
    amount = Math.round(amount / 5) * 5;
    if (amount < 5) amount = 5;
    targetAmount = amount;
    updateTargetUI();
}

function updateLeverageFromSlider(value) {
    leverage = parseInt(value);
    updateTargetUI();
}

// 초기화 시 슬라이더 UI 업데이트
setTimeout(() => {
    updateTargetUI();
}, 500);


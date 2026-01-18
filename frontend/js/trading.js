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

// ========== 포지션 UI ==========
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

// ========== 거래 함수 ==========
function calculateLot() {
    if (currentMode === 'martin') return lotSize;
    let lot = leverage * 0.1;
    return Math.round(lot * 100) / 100;  // 0.01 단위로 반올림
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
            result = await apiCall(`/mt5/order?symbol=${currentSymbol}&order_type=BUY&volume=${lot}&target=${targetAmount}`, 'POST');
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
            result = await apiCall(`/mt5/order?symbol=${currentSymbol}&order_type=SELL&volume=${lot}&target=${targetAmount}`, 'POST');
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
        const result = await apiCall(`/mt5/close?symbol=${currentSymbol}`, 'POST');
        
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
    showToast('Processing...', '');
    try {
        let response;
        
        // 마틴 모드면 마틴 API 사용
        if (currentMode === 'martin' && martinEnabled) {
            response = await fetch(`${API_URL}/demo/martin/order?symbol=${currentSymbol}&order_type=${orderType}&target=${targetAmount}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } else {
            const lot = calculateLot();
            response = await fetch(`${API_URL}/demo/order?symbol=${currentSymbol}&order_type=${orderType}&volume=${lot}&target=${targetAmount}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        }
        
        const result = await response.json();
        
        showToast(result?.message || 'Error', result?.success ? 'success' : 'error');
        if (result?.success) {
            playSound(orderType.toLowerCase());
            
            // 마틴 모드면 단계 정보 업데이트
            if (result.martin_step) {
                martinStep = result.martin_step;
                updateMartinUI();
            }
            
            fetchDemoData();
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

// ========== Demo 모드 청산 ==========
async function closeDemoPosition() {
    showToast('Closing...', '');
    try {
        const response = await fetch(`${API_URL}/demo/close`, {
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
async function loadHistory() {
    // Demo 모드면 Demo API 사용
    const endpoint = isDemo ? '/demo/history' : '/mt5/history';
    const data = await apiCall(endpoint);
    const container = document.getElementById('historyList');
    
    if (data?.history?.length > 0) {
        let html = '';
        data.history.forEach(h => {
            const profitClass = h.profit >= 0 ? 'positive' : 'negative';
            const profitSign = h.profit >= 0 ? '+' : '';
            html += `<div class="history-item">
                <div style="display:flex;flex-direction:column;gap:3px;">
                    <span class="history-symbol">${h.symbol} ${h.type}</span>
                    <span class="history-time">${h.time} | ${h.volume} lot</span>
                </div>
                <span class="history-profit ${profitClass}">${profitSign}$${h.profit.toFixed(2)}</span>
            </div>`;
        });
        container.innerHTML = html;
    } else {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">No trade history</p>';
    }
}


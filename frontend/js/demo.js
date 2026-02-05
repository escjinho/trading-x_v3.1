/* ========================================
   Trading-X Demo Mode
   데모 모드 전용 함수
   ======================================== */

// ========== Demo Order ==========
async function placeDemoOrder(orderType) {
    console.log(`[placeDemoOrder] 🔵 START - Order: ${orderType}, Symbol: ${currentSymbol}, Target: ${targetAmount}`);
    showToast('Processing...', '');
    try {
        let response;

        if (currentMode === 'martin' && martinEnabled) {
            console.log('[placeDemoOrder] Using Martin API');
            response = await fetch(`${API_URL}/demo/martin/order?symbol=${currentSymbol}&order_type=${orderType}&target=${targetAmount}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } else {
            const lot = calculateLot();
            console.log(`[placeDemoOrder] Using Basic API, Lot: ${lot}`);
            response = await fetch(`${API_URL}/demo/order?symbol=${currentSymbol}&order_type=${orderType}&volume=${lot}&target=${targetAmount}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        }

        const result = await response.json();
        console.log('[placeDemoOrder] 📦 Server response:', result);

        showToast(result?.message || 'Error', result?.success ? 'success' : 'error');
        if (result?.success) {
            playSound(orderType.toLowerCase());

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

// ========== Demo Close ==========
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
            
            if (currentMode === 'martin' && martinEnabled) {
                handleDemoMartinClose(profit);
            } else {
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

function handleDemoMartinClose(profit) {
    const baseTarget = 50;
    const currentDisplayTarget = baseTarget * Math.pow(2, martinStep - 1) + martinAccumulatedLoss;
    
    if (profit > 0) {
        if (profit >= martinAccumulatedLoss && martinAccumulatedLoss > 0) {
            fetch(`${API_URL}/demo/martin/reset-full`, {
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
            const remainingLoss = Math.max(0, martinAccumulatedLoss - profit);
            
            fetch(`${API_URL}/demo/martin/update-state?step=${martinStep}&accumulated_loss=${remainingLoss}`, {
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
    } else if (profit < 0) {
        const lossAmount = Math.abs(profit);
        const halfTarget = currentDisplayTarget / 2;
        
        if (lossAmount >= halfTarget) {
            const newStep = Math.min(martinStep + 1, martinLevel);
            const newAccumulatedLoss = martinAccumulatedLoss + lossAmount;
            
            if (newStep > martinLevel) {
                fetch(`${API_URL}/demo/martin/reset-full`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                showMaxPopup(newAccumulatedLoss);
                martinStep = 1;
                martinAccumulatedLoss = 0;
                martinHistory = [];
            } else {
                fetch(`${API_URL}/demo/martin/update-state?step=${newStep}&accumulated_loss=${newAccumulatedLoss}`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                martinStep = newStep;
                martinAccumulatedLoss = newAccumulatedLoss;
                showToast(`📈 Step ${newStep}로 진행! 손실: -$${lossAmount.toFixed(2)}`, 'error');
            }
        } else {
            const newAccumulatedLoss = martinAccumulatedLoss + lossAmount;
            
            fetch(`${API_URL}/demo/martin/update-state?step=${martinStep}&accumulated_loss=${newAccumulatedLoss}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            martinAccumulatedLoss = newAccumulatedLoss;
            showToast(`📊 단계 유지! 손실: -$${lossAmount.toFixed(2)} (누적: $${newAccumulatedLoss.toFixed(2)})`, 'error');
        }
        
        updateTodayPL(profit);
        updateMartinUI();
    } else {
        showToast('청산 완료 (손익 없음)', 'success');
    }
}

// ========== Demo Topup & Reset ==========
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

// ========== Fetch Demo Data ==========
async function fetchDemoData() {
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
            // Auto-closed position
            if (data.auto_closed) {
                console.log('[fetchDemoData] 🔒 Position auto-closed');
                playSound('close');

                const profit = data.closed_profit || 0;
                const isWin = data.is_win !== false && profit >= 0;

                if (currentMode === 'martin' && martinEnabled) {
                    if (data.martin_reset || isWin) {
                        martinStep = 1;
                        martinAccumulatedLoss = 0;
                        martinHistory = [];
                        updateMartinUI();
                        showMartinSuccessPopup(profit);
                    } else if (data.martin_step_up) {
                        showMartinPopup(profit);
                    } else {
                        showToast(data.message || `💔 손절! ${profit.toFixed(2)}`, 'error');
                    }
                } else {
                    if (isWin) {
                        showToast(data.message || `🎯 목표 도달! +$${profit.toFixed(2)}`, 'success');
                    } else {
                        showToast(data.message || `💔 손절! $${profit.toFixed(2)}`, 'error');
                    }
                }

                updateTodayPL(profit);
                console.log('[fetchDemoData] 📞 Calling updatePositionUI(false, null) - auto closed');
                updatePositionUI(false, null);
            }
            
            // Update UI — fallback을 0으로 (10000 깜빡임 방지)
            document.getElementById('homeBalance').textContent = '$' + (data.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            document.getElementById('homeBroker').textContent = data.broker || 'Demo';
            document.getElementById('homeAccount').textContent = data.account || 'DEMO';
            document.getElementById('homeLeverage').textContent = '1:' + (data.leverage || 500);
            document.getElementById('homeServer').textContent = data.server || 'Demo';
            document.getElementById('homeEquity').textContent = '$' + (data.equity || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            document.getElementById('homeFreeMargin').textContent = '$' + (data.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            document.getElementById('homePositions').textContent = data.positions_count || 0;
            document.getElementById('tradeBalance').textContent = '$' + Math.round(data.balance || 0).toLocaleString();

            document.getElementById('accBalance').textContent = '$' + Math.round(data.balance || 0).toLocaleString();
            document.getElementById('accEquity').textContent = '$' + Math.round(data.equity || 0).toLocaleString();
            document.getElementById('accMargin').textContent = '$0';
            document.getElementById('accFree').textContent = '$' + Math.round(data.balance || 0).toLocaleString();
            
            // Position — 폴링에서는 UI 리셋하지 않음 (WS에서만 갱신)
            if (data.position) {
                updatePositionUI(true, data.position);

                const pos = data.position;
                const currentTarget = pos.target || targetAmount;

                if (currentTarget > 0 && !isClosing) {
                    if (pos.profit >= currentTarget) {
                        isClosing = true;
                        closeDemoPosition();
                    } else if (pos.profit <= -currentTarget) {
                        isClosing = true;
                        closeDemoPosition();
                    }
                }
            }
            
            // Multi Order Panel
            const multiOrderPanel = document.getElementById('multiOrderPanel');
            if (multiOrderPanel && multiOrderPanel.classList.contains('active')) {
                updateMultiOrderPanelFromData(data);
            }
            
            // Martin state
            if (currentMode === 'martin' && martinEnabled) {
                try {
                    const martinRes = await fetch(`${API_URL}/demo/martin/state`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const martinData = await martinRes.json();
                    
                    if (martinData) {
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
}

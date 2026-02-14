// ========== Buy/Sell 패널 매직넘버 ==========
const BUYSELL_MAGIC_NUMBER = 100001;

// ★★★ MetaAPI 에러 메시지 → 사용자 친화적 메시지 변환 ★★★
function friendlyError(msg) {
    if (!msg) return '일시적 오류가 발생했습니다';
    const m = msg.toLowerCase();
    if (m.includes('timed out')) return '주문 처리 시간 초과\n잠시 후 다시 시도해주세요';
    if (m.includes('not connected to broker')) return '브로커 연결 준비 중\n잠시 후 다시 시도해주세요';
    if (m.includes('no trading permissions')) return '거래 권한이 없습니다\nMT5 계정을 확인해주세요';
    if (m.includes('market is closed')) return '현재 시장이 닫혀있습니다';
    if (m.includes('not enough money')) return '증거금이 부족합니다';
    if (m.includes('invalid volume')) return '유효하지 않은 랏 사이즈입니다';
    if (m.includes('off quotes')) return '현재 호가를 받을 수 없습니다\n잠시 후 다시 시도해주세요';
    if (m.includes('trade not allowed')) return '거래가 허용되지 않습니다';
    if (m.includes('position not found') || m.includes('포지션 없음')) return '포지션이 이미 청산되었습니다';
    if (msg.length > 60) return '일시적 오류가 발생했습니다\n잠시 후 다시 시도해주세요';
    return msg;
}

// ★★★ 모드 전환 시 패널 완전 초기화 ★★★
function resetTradingPanel() {
    console.log('[resetTradingPanel] 패널 초기화');
    // 마틴 상태 초기화
    martinStep = 1;
    martinAccumulatedLoss = 0;
    martinBaseTarget = 0;
    martinHistory = [];
    // 포지션 UI 초기화
    if (typeof updatePositionUI === 'function') updatePositionUI(false, null);
    if (typeof updateMartinUI === 'function') updateMartinUI();
    // 플래그 초기화
    window._closeConfirmedAt = null;
    window._userClosing = false;
    window._plGaugeFrozen = false;
    window._orderCooldown = false;
    window._martinStateUpdating = false;
    // 버튼 복원
    document.querySelectorAll('.trade-btn.buy-btn, .trade-btn.sell-btn').forEach(b => {
        b.style.opacity = '1';
        b.style.pointerEvents = 'auto';
    });
    // P/L 게이지 초기화
    const plBar = document.getElementById('plBar');
    const plText = document.getElementById('plText');
    const plPercent = document.getElementById('plPercent');
    if (plBar) plBar.style.width = '50%';
    if (plText) plText.textContent = '$0.00';
    if (plPercent) plPercent.textContent = '0%';
}

// ========== 마틴 팝업 ==========
// ★★★ 임시 저장: 팝업 표시 중 유저 선택 대기 ★★★
let _martinPendingLoss = 0;        // 이번 청산 손실 (양수)
let _martinPendingAccLoss = 0;     // 새 누적손실 (기존 + 이번)
let _martinPendingProfit = 0;      // 이번 청산 손익 (원본, 음수 가능)

async function showMartinPopup(profit) {
    // ★★★ 히스토리에서 정확한 profit 폴링 (히스토리 탭과 동일) ★★★
    const maxRetries = 6;
    const interval = 300;
    let found = false;

    await new Promise(r => setTimeout(r, 1000));  // 1초 대기 후 폴링 시작
    for (let i = 0; i < maxRetries; i++) {
        try {
            const lastTradeUrl = isDemo
                ? `/demo/last-trade?magic=${BUYSELL_MAGIC_NUMBER}`
                : `/mt5/last-trade?magic=${BUYSELL_MAGIC_NUMBER}`;
            const resp = await apiCall(lastTradeUrl, 'GET');
            if (resp && resp.success && resp.trade) {
                const tradeProfit = resp.trade.profit;
                const tradeTime = resp.trade.time;
                if (tradeProfit !== undefined && tradeProfit < 0) {
                    console.log(`[MartinPopup] last-trade profit (${i+1}회): ${tradeProfit}, time: ${tradeTime}`);
                    profit = tradeProfit;
                    found = true;
                    break;
                }
            }
        } catch (e) {
            console.log(`[MartinPopup] 히스토리 폴링 ${i+1}회 실패`);
        }
        await new Promise(r => setTimeout(r, interval));
    }

    if (!found) {
        console.log('[MartinPopup] 히스토리 폴링 실패, raw_profit 사용:', profit);
    }

    const lossAmount = Math.abs(profit);

    // ★★★ DB에서 현재 마틴 상태 조회 ★★★
    let dbAccLoss = martinAccumulatedLoss;
    try {
        const stateUrl = isDemo
            ? `/demo/martin/state?magic=${BUYSELL_MAGIC_NUMBER}`
            : `/mt5/martin/state`;
        const stateResp = await apiCall(stateUrl, 'GET');
        if (stateResp && stateResp.success !== false) {
            const state = stateResp.state || stateResp;
            if (state.step !== undefined) {
                martinStep = state.step || martinStep;
            }
            if (state.accumulated_loss !== undefined) {
                dbAccLoss = state.accumulated_loss || 0;
            }
        }
    } catch (e) {
        console.log('[MartinPopup] DB 조회 실패, 현재 값 사용');
    }

    martinAccumulatedLoss = dbAccLoss;
    const newAccLoss = dbAccLoss + lossAmount;
    _martinPendingAccLoss = newAccLoss;

    const nextStep = martinStep + 1;
    const nextLot = lotSize * Math.pow(2, martinStep);
    const martinTarget = martinBaseTarget || targetAmount;
    const recoveryTarget = newAccLoss + martinTarget;

    // ★★★ 팝업 DOM 업데이트 ★★★
    document.getElementById('popupCurrentStep').textContent = martinStep;
    document.getElementById('popupCurrentStepKr').textContent = martinStep;
    document.getElementById('popupNextStep').textContent = nextStep;
    document.getElementById('popupNextStepKr').textContent = nextStep;
    document.getElementById('popupCurrentLoss').textContent = `-${lossAmount.toFixed(2)}`;
    document.getElementById('popupAccumulatedLoss').textContent = `-${newAccLoss.toFixed(2)}`;
    document.getElementById('popupNextLot').textContent = `${nextLot.toFixed(2)} lot`;
    document.getElementById('popupRecoveryTarget').textContent = `+${recoveryTarget.toFixed(0)}`;

    // 팝업 표시
    document.getElementById('martinPopup').style.display = 'flex';
}

function hideMartinPopup() {
    document.getElementById('martinPopup').style.display = 'none';
    window._martinStateUpdating = false;
}

function martinPopupSettings() {
    hideMartinPopup();
    // 마틴 리셋 후 설정으로
    if (isDemo) {
        apiCall(`/demo/martin/reset-full?magic=${BUYSELL_MAGIC_NUMBER}`, 'POST');
    } else {
        apiCall('/mt5/martin/reset-full', 'POST');
    }
    martinStep = 1;
    martinAccumulatedLoss = 0;
    martinHistory = [];
    updateMartinUI();
    openSettings();
}

async function martinPopupStay() {
    // ★★★ 단계 유지: step 그대로, accumulated_loss만 업데이트 ★★★
    hideMartinPopup();
    martinAccumulatedLoss = _martinPendingAccLoss;

    if (isDemo) {
        await fetch(`${API_URL}/demo/martin/update-state?step=${martinStep}&accumulated_loss=${martinAccumulatedLoss}&magic=${BUYSELL_MAGIC_NUMBER}`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
        });
    } else {
        await apiCall(`/mt5/martin/update-state?step=${martinStep}&accumulated_loss=${martinAccumulatedLoss}`, 'POST');
    }

    updateMartinUI();
    updateTodayPL(_martinPendingProfit);
    showToast(`Step ${martinStep} 유지\n누적손실: -$${martinAccumulatedLoss.toFixed(2)}`, 'warning');
}

async function martinPopupContinue() {
    // ★★★ 다음 단계로: step up + accumulated_loss 업데이트 ★★★
    hideMartinPopup();
    martinHistory[martinStep - 1] = -1;

    const newStep = Math.min(martinStep + 1, martinLevel);
    martinAccumulatedLoss = _martinPendingAccLoss;

    if (newStep > martinLevel) {
        // 최대 단계 초과 → 강제 리셋
        if (isDemo) {
            await fetch(`${API_URL}/demo/martin/reset-full?magic=${BUYSELL_MAGIC_NUMBER}`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
            });
        } else {
            await apiCall('/mt5/martin/reset-full', 'POST');
        }
        showMaxPopup(martinAccumulatedLoss);
        martinStep = 1;
        martinAccumulatedLoss = 0;
        martinHistory = [];
    } else {
        martinStep = newStep;
        if (isDemo) {
            await fetch(`${API_URL}/demo/martin/update-state?step=${martinStep}&accumulated_loss=${martinAccumulatedLoss}&magic=${BUYSELL_MAGIC_NUMBER}`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
            });
        } else {
            await apiCall(`/mt5/martin/update-state?step=${martinStep}&accumulated_loss=${martinAccumulatedLoss}`, 'POST');
        }
        showToast(`Step ${martinStep}로 진행\nLot: ${(lotSize * Math.pow(2, martinStep - 1)).toFixed(2)}`, 'warning');
    }

    updateMartinUI();
    updateTodayPL(_martinPendingProfit);
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
    
    showToast('마틴이 1단계로 초기화되었습니다', 'info');
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
    // targetAmount은 변경하지 않음 (사용자 설정 유지)

    updateMartinUI();
    showToast('1단계로 다시 시작합니다', 'success');
}

// ========== Today P/L ==========
function updateTodayPL(profit) {
    // ★★★ _todayPLFixed에 profit 추가 ★★★
    if (window._todayPLFixed === null) {
        window._todayPLFixed = 0;
    }
    window._todayPLFixed += profit;
    const fixedPL = window._todayPLFixed;

    // 1. Account 탭 Today P/L 업데이트 (_todayPLFixed 사용)
    const todayPLEl = document.getElementById('accTodayPL');
    if (todayPLEl) {
        todayPLEl.textContent = (fixedPL >= 0 ? '+$' : '-$') + Math.abs(fixedPL).toFixed(2);
        todayPLEl.style.color = fixedPL >= 0 ? 'var(--buy-color)' : 'var(--sell-color)';
    }

    console.log(`[updateTodayPL] Profit: ${profit}, FixedPL: ${fixedPL}`);

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
    const tradeTodayPL = document.getElementById('tradeTodayPL');
    if (!tradeTodayPL) return;

    // ★★★ 항상 _todayPLFixed 값 직접 사용 ★★★
    const fixedPL = window._todayPLFixed || 0;
    if (fixedPL >= 0) {
        tradeTodayPL.textContent = '+$' + fixedPL.toFixed(2);
        tradeTodayPL.style.color = 'var(--buy-color)';
    } else {
        tradeTodayPL.textContent = '-$' + Math.abs(fixedPL).toFixed(2);
        tradeTodayPL.style.color = 'var(--sell-color)';
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
// ★★★ 손익 게이지 부드러운 애니메이션 시스템 ★★★
let _plAnimCurrent = 0;    // 현재 표시 중인 위치
let _plAnimTarget = 0;     // 목표 위치
let _plAnimFrame = null;   // requestAnimationFrame ID
let _plPrevPercent = 0;    // 이전 퍼센트 (변화 감지용)

function updatePLGauge(currentPL, target = null) {
    // ★ 청산 중이면 게이지 프리즈
    if (window._plGaugeFrozen) return;
    
    const actualTarget = target || targetAmount;
    _plAnimTarget = Math.min(1, Math.max(-1, currentPL / actualTarget));
    
    // 애니메이션 루프가 없으면 시작
    if (!_plAnimFrame) {
        _plAnimFrame = requestAnimationFrame(_plAnimStep);
    }
}

function _plAnimStep() {
    // ★ 보간 (lerp) - 0.15 = 빠르고 민감, 부드러움
    const diff = _plAnimTarget - _plAnimCurrent;
    
    if (Math.abs(diff) < 0.0005) {
        _plAnimCurrent = _plAnimTarget;
    } else {
        _plAnimCurrent += diff * 0.15;
    }
    
    // ★ DOM 업데이트
    const fill = document.getElementById('plBarFill');
    const diamond = document.getElementById('plDiamond');
    const percentText = document.getElementById('plPercent');
    
    const plPercent = _plAnimCurrent;
    const plPercentDisplay = Math.round(Math.abs(plPercent) * 100);
    const isProfit = plPercent >= 0;
    const color = isProfit ? '#00b450' : '#dc3246';
    const glowColor = isProfit ? 'rgba(0,180,80,' : 'rgba(220,50,70,';
    
    // ★ 변화량에 따른 글로우 강도 (변화 클수록 강한 글로우)
    const changeSpeed = Math.abs(diff);
    const glowIntensity = Math.min(20, 8 + changeSpeed * 80);
    
    if (fill) {
        fill.style.background = isProfit 
            ? `linear-gradient(to right, ${glowColor}0.3), ${color})`
            : `linear-gradient(to left, ${glowColor}0.3), ${color})`;
        fill.style.left = isProfit ? '50%' : (50 + plPercent * 50) + '%';
        fill.style.width = Math.abs(plPercent) * 50 + '%';
        fill.style.borderRadius = isProfit ? '0 6px 6px 0' : '6px 0 0 6px';
        fill.style.boxShadow = `0 0 ${glowIntensity}px ${color}80`;
    }
    
    if (diamond) {
        diamond.style.left = (50 + plPercent * 50) + '%';
        diamond.style.background = color;
        diamond.style.boxShadow = `0 0 ${glowIntensity}px ${color}`;
        
        // ★ 큰 변화 시 펄스 애니메이션
        if (Math.abs(plPercentDisplay - _plPrevPercent) >= 5) {
            diamond.style.animation = 'plPulse 0.3s ease';
            setTimeout(() => { diamond.style.animation = ''; }, 300);
            _plPrevPercent = plPercentDisplay;
        }
    }
    
    if (percentText) {
        percentText.textContent = plPercentDisplay + '%';
        percentText.style.color = color;
        percentText.style.textShadow = `0 0 ${glowIntensity}px ${glowColor}0.6)`;
    }
    
    // ★ 목표에 도달할 때까지 계속 애니메이션
    if (Math.abs(_plAnimTarget - _plAnimCurrent) > 0.0003) {
        _plAnimFrame = requestAnimationFrame(_plAnimStep);
    } else {
        _plAnimFrame = null;
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
                if (res.success) {
                    showToast('주문 성공!', orderType.toLowerCase() === 'buy' ? 'buy' : 'sell');
                    playSound(orderType.toLowerCase());
                    if (typeof fetchDemoData === 'function') fetchDemoData();
                } else {
                    showToast(friendlyError(res.message), 'error');
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

    // ★★★ 중복 주문 방지 ★★★
    if (!isDemo && window.lastLivePosition) {
        showToast('이미 포지션이 있습니다', 'error');
        return;
    }

    // ★★★ MetaAPI 연결 상태 체크 (공유+유저별 모두 WS에서 반영됨) ★★★
    if (window._metaapiConnected === false) {
        showToast('Trading API 연결 중입니다\n잠시 후 다시 시도해주세요', 'warning', 5000);
        return;
    }

    // ★★★ 버튼 쿨다운 (이중 클릭 방지 - 5초) ★★★
    if (window._orderCooldown) {
        showToast('주문 처리 중입니다. 잠시만 기다려주세요.', 'error');
        return;
    }
    // ★★★ 새 주문 시 이전 청산 플래그 해제 ★★★
    window._closeConfirmedAt = null;
    window._userClosing = false;
    window._plGaugeFrozen = false;
    window._orderCooldown = true;
    // ★★★ BUY/SELL 버튼만 비활성화 (CLOSE 버튼은 제외) ★★★
    document.querySelectorAll('.trade-btn.buy-btn, .trade-btn.sell-btn').forEach(b => { b.style.opacity = '0.5'; b.style.pointerEvents = 'none'; });
    setTimeout(() => {
        window._orderCooldown = false;
        document.querySelectorAll('.trade-btn.buy-btn, .trade-btn.sell-btn').forEach(b => { b.style.opacity = '1'; b.style.pointerEvents = 'auto'; });
    }, 3000);

    showToast('처리 중...', 'info');
    try {
        let result;
        if (currentMode === 'martin' && martinEnabled) {
            // ★★★ 라이브 마틴: is_martin=true, 백엔드에서 랏/타겟 계산 ★★★
            const lot = calculateLot();  // base_lot 전달
            result = await apiCall(`/mt5/order?symbol=${currentSymbol}&order_type=BUY&volume=${lot}&target=${targetAmount}&magic=${BUYSELL_MAGIC_NUMBER}&is_martin=true`, 'POST');
        } else {
            const lot = calculateLot();
            result = await apiCall(`/mt5/order?symbol=${currentSymbol}&order_type=BUY&volume=${lot}&target=${targetAmount}&magic=${BUYSELL_MAGIC_NUMBER}`, 'POST');
        }

        // ★★★ Bridge 모드: 결과 폴링 ★★★
        if (result?.bridge_mode && result?.order_id) {
            showToast('MT5로 주문 전송 중...', 'info');
            pollOrderResult(result.order_id, 'BUY');
            return;
        }

        // ★★★ 연결 에러 시 포지션 재확인 ★★★
        const msg = (result?.message || '').toLowerCase();
        if (!result?.success && (msg.includes('not connected') || msg.includes('region') || msg.includes('timeout'))) {
            showToast('주문 확인 중...', 'info');
            setTimeout(async () => {
                try {
                    const posResult = await apiCall('/mt5/positions');
                    if (posResult?.position || (posResult?.positions && posResult.positions.length > 0)) {
                        showToast('주문 성공!', 'buy');
                        playSound('buy');
                    } else {
                        showToast('주문 실패', 'error');
                    }
                } catch (e) {
                    showToast('주문 확인 실패', 'error');
                }
            }, 3000);
            return;
        }

        // ★★★ 스프레드 거부 + TP/SL 실패 특별 처리 ★★★
        if (result?.spread_rejected) {
            showToast('스프레드 비용이 너무 높습니다\n타겟 금액을 높이거나 랏 사이즈를 줄여주세요', 'warning', 5000);
            return;
        }
        if (result?.tp_sl_failed) {
            showToast('TP/SL 설정 실패\n안전을 위해 주문이 취소되었습니다', 'error', 5000);
            return;
        }
        // ★★★ MetaAPI 연결 끊김 처리 ★★★
        if (result?.metaapi_disconnected) {
            showToast('MetaAPI 연결이 불안정합니다\n잠시 후 다시 시도해주세요', 'warning', 5000);
            return;
        }
        // ★★★ 증거금 부족 처리 ★★★
        if (result?.margin_insufficient) {
            showToast(`증거금이 부족합니다\n가용마진: $${result.free_margin?.toFixed(0) || 0}, 필요마진: $${result.required_margin?.toFixed(0) || 0}`, 'warning', 5000);
            return;
        }
        showToast(result?.success ? '주문 성공!' : friendlyError(result?.message), result?.success ? 'buy' : 'error');
        if (result?.success) {
            playSound('buy');
            // ★★★ 포지션 확인 → 쿨다운 즉시 해제 ★★★
            window._orderCooldown = false;
            document.querySelectorAll('.trade-btn.buy-btn, .trade-btn.sell-btn').forEach(b => { b.style.opacity = '1'; b.style.pointerEvents = 'auto'; });
            // ★★★ 주문 성공 후 히스토리/P&L만 갱신 (WS가 실시간 처리하므로 softRefresh 불필요) ★★★
            setTimeout(() => {
                if (typeof loadHistory === 'function') loadHistory();
                if (typeof syncTradeTodayPL === 'function') syncTradeTodayPL();
            }, 2000);
        }
    } catch (e) { showToast('Network error', 'error'); }
}

async function placeSell() {
    if (!checkGuestAction('trade')) return;

    // Demo 모드면 Demo API 사용
    if (isDemo) {
        placeDemoOrder('SELL');
        return;
    }

    // ★★★ 중복 주문 방지 ★★★
    if (!isDemo && window.lastLivePosition) {
        showToast('이미 포지션이 있습니다', 'error');
        return;
    }

    // ★★★ MetaAPI 연결 상태 체크 (공유+유저별 모두 WS에서 반영됨) ★★★
    if (window._metaapiConnected === false) {
        showToast('Trading API 연결 중입니다\n잠시 후 다시 시도해주세요', 'warning', 5000);
        return;
    }

    // ★★★ 버튼 쿨다운 (이중 클릭 방지 - 5초) ★★★
    if (window._orderCooldown) {
        showToast('주문 처리 중입니다. 잠시만 기다려주세요.', 'error');
        return;
    }
    // ★★★ 새 주문 시 이전 청산 플래그 해제 ★★★
    window._closeConfirmedAt = null;
    window._userClosing = false;
    window._plGaugeFrozen = false;
    window._orderCooldown = true;
    // ★★★ BUY/SELL 버튼만 비활성화 (CLOSE 버튼은 제외) ★★★
    document.querySelectorAll('.trade-btn.buy-btn, .trade-btn.sell-btn').forEach(b => { b.style.opacity = '0.5'; b.style.pointerEvents = 'none'; });
    setTimeout(() => {
        window._orderCooldown = false;
        document.querySelectorAll('.trade-btn.buy-btn, .trade-btn.sell-btn').forEach(b => { b.style.opacity = '1'; b.style.pointerEvents = 'auto'; });
    }, 3000);

    showToast('처리 중...', 'info');
    try {
        let result;
        if (currentMode === 'martin' && martinEnabled) {
            // ★★★ 라이브 마틴: is_martin=true, 백엔드에서 랏/타겟 계산 ★★★
            const lot = calculateLot();  // base_lot 전달
            result = await apiCall(`/mt5/order?symbol=${currentSymbol}&order_type=SELL&volume=${lot}&target=${targetAmount}&magic=${BUYSELL_MAGIC_NUMBER}&is_martin=true`, 'POST');
        } else {
            const lot = calculateLot();
            result = await apiCall(`/mt5/order?symbol=${currentSymbol}&order_type=SELL&volume=${lot}&target=${targetAmount}&magic=${BUYSELL_MAGIC_NUMBER}`, 'POST');
        }

        // ★★★ Bridge 모드: 결과 폴링 ★★★
        if (result?.bridge_mode && result?.order_id) {
            showToast('MT5로 주문 전송 중...', 'info');
            pollOrderResult(result.order_id, 'SELL');
            return;
        }

        // ★★★ 연결 에러 시 포지션 재확인 ★★★
        const msg = (result?.message || '').toLowerCase();
        if (!result?.success && (msg.includes('not connected') || msg.includes('region') || msg.includes('timeout'))) {
            showToast('주문 확인 중...', 'info');
            setTimeout(async () => {
                try {
                    const posResult = await apiCall('/mt5/positions');
                    if (posResult?.position || (posResult?.positions && posResult.positions.length > 0)) {
                        showToast('주문 성공!', 'sell');
                        playSound('sell');
                    } else {
                        showToast('주문 실패', 'error');
                    }
                } catch (e) {
                    showToast('주문 확인 실패', 'error');
                }
            }, 3000);
            return;
        }

        // ★★★ 스프레드 거부 + TP/SL 실패 특별 처리 ★★★
        if (result?.spread_rejected) {
            showToast('스프레드 비용이 너무 높습니다\n타겟 금액을 높이거나 랏 사이즈를 줄여주세요', 'warning', 5000);
            return;
        }
        if (result?.tp_sl_failed) {
            showToast('TP/SL 설정 실패\n안전을 위해 주문이 취소되었습니다', 'error', 5000);
            return;
        }
        // ★★★ MetaAPI 연결 끊김 처리 ★★★
        if (result?.metaapi_disconnected) {
            showToast('MetaAPI 연결이 불안정합니다\n잠시 후 다시 시도해주세요', 'warning', 5000);
            return;
        }
        // ★★★ 증거금 부족 처리 ★★★
        if (result?.margin_insufficient) {
            showToast(`증거금이 부족합니다\n가용마진: $${result.free_margin?.toFixed(0) || 0}, 필요마진: $${result.required_margin?.toFixed(0) || 0}`, 'warning', 5000);
            return;
        }
        showToast(result?.success ? '주문 성공!' : friendlyError(result?.message), result?.success ? 'sell' : 'error');
        if (result?.success) {
            playSound('sell');
            // ★★★ 포지션 확인 → 쿨다운 즉시 해제 ★★★
            window._orderCooldown = false;
            document.querySelectorAll('.trade-btn.buy-btn, .trade-btn.sell-btn').forEach(b => { b.style.opacity = '1'; b.style.pointerEvents = 'auto'; });
            // ★★★ 주문 성공 후 히스토리/P&L만 갱신 ★★★
            setTimeout(() => {
                if (typeof loadHistory === 'function') loadHistory();
                if (typeof syncTradeTodayPL === 'function') syncTradeTodayPL();
            }, 2000);
        }
    } catch (e) { showToast('Network error', 'error'); }
}

async function closePosition() {
    // Demo 모드면 Demo API 사용
    if (isDemo) {
        closeDemoPosition();
        return;
    }

    // ★★★ 게이지 프리즈 + 이중 팝업 방지 ★★★
    window._userClosing = true;
    window._plGaugeFrozen = true;  // 손익 게이지 애니메이션 정지

    showToast('청산 중...', 'info');
    try {
        let result = await apiCall(`/mt5/close?symbol=${currentSymbol}&magic=${BUYSELL_MAGIC_NUMBER}`, 'POST');

        // ★★★ Bridge 모드: 결과 폴링 ★★★
        if (result?.bridge_mode && result?.order_id) {
            showToast('포지션 청산 중...', 'info');
            const pollResult = await pollOrderResult(result.order_id, 'CLOSE');
            if (pollResult) {
                result = pollResult;  // MT5 실제 결과로 교체
            } else {
                showToast('Close timeout - check positions', 'warning');
                window._userClosing = false;
                window._plGaugeFrozen = false;
                return;
            }
        }

        if (result?.success) {
            playSound('close');
            const apiProfit = result.profit || 0;
            const rawProfit = result.raw_profit !== undefined ? result.raw_profit : apiProfit;

            // ★★★ 청산 확인 타임스탬프 — WS 포지션 데이터 무시용 ★★★
            window._closeConfirmedAt = Date.now();

            // ★ 포지션 UI 즉시 초기화
            window.lastLivePosition = null;
            updatePositionUI(false, null);

            if (currentMode === 'martin' && martinEnabled) {
                // ★★★ 마틴 모드: 즉시 알림 → 팝업 내부에서 2초 대기 ★★★
                showToast('포지션이 청산되었습니다', 'success');

                setTimeout(async () => {
                    window._martinStateUpdating = true;
                    try {
                        const profit = apiProfit;
                        const martinProfit = rawProfit;  // ★ raw_profit: 수수료 미포함
                        console.log(`[Martin Close] apiProfit: ${profit}, rawProfit: ${martinProfit}`);

                        if (typeof loadHistory === 'function') loadHistory();
                        if (typeof syncTradeTodayPL === 'function') syncTradeTodayPL();

                        // ★ DB에서 최신 accumulated_loss 조회
                        try {
                            const mState = await apiCall('/mt5/martin/state', 'GET');
                            if (mState && mState.accumulated_loss !== undefined) {
                                martinAccumulatedLoss = mState.accumulated_loss;
                                martinStep = mState.step || martinStep;
                            }
                        } catch (e) {}

                        if (profit > 0) {
                            // 수익 청산
                            if (profit >= martinAccumulatedLoss && martinAccumulatedLoss > 0) {
                                // 전액 회복 → 마틴 성공!
                                await apiCall('/mt5/martin/reset-full', 'POST');
                                updateTodayPL(profit);
                                showMartinSuccessPopup(profit);
                                martinStep = 1;
                                martinAccumulatedLoss = 0;
                                martinHistory = [];
                                updateMartinUI();
                                window._martinStateUpdating = false;
                            } else {
                                // 일부 회복 → 누적손실 감소
                                const remainingLoss = Math.max(0, martinAccumulatedLoss - profit);
                                await apiCall(`/mt5/martin/update-state?step=${martinStep}&accumulated_loss=${remainingLoss}`, 'POST');
                                martinAccumulatedLoss = remainingLoss;
                                updateMartinUI();
                                updateTodayPL(profit);
                                window._martinStateUpdating = false;
                                if (remainingLoss > 0) {
                                    showToast(`일부 회복! +$${profit.toFixed(2)}\n남은 손실: $${remainingLoss.toFixed(2)}`, 'success');
                                } else {
                                    showMartinSuccessPopup(profit);
                                }
                            }
                        } else if (profit < 0) {
                            // ★★★ 손실 → 팝업으로 유저 선택 (raw_profit: 수수료 미포함) ★★★
                            showMartinPopup(martinProfit);
                        } else {
                            updateTodayPL(0);
                            window._martinStateUpdating = false;
                            showToast('청산 완료 (손익 없음)', 'success');
                        }
                    } catch (e) {
                        console.error('[Martin Close] 실패:', e);
                        updateTodayPL(apiProfit);
                        window._martinStateUpdating = false;
                    }
                }, 0);

            } else {
                // Basic/NoLimit 모드 — close API profit 바로 사용
                if (apiProfit >= 0) {
                    showToast(`청산 손익: +$${apiProfit.toFixed(2)}`, 'success');
                } else {
                    showToast(`청산 손익: -$${Math.abs(apiProfit).toFixed(2)}`, 'error');
                }
                updateTodayPL(apiProfit);
                setTimeout(() => {
                    if (typeof syncTradeTodayPL === 'function') syncTradeTodayPL();
                    if (typeof loadHistory === 'function') loadHistory();
                }, 1000);
            }
        } else {
            const errMsg = result?.message || 'Error';
            // ★★★ "포지션 없음" 응답 시 UI 강제 초기화 (MT5에서 이미 청산된 경우) ★★★
            if (errMsg.includes('포지션 없음') || errMsg.includes('이미 청산') || result?.force_sync) {
                console.log('[closePosition] ⚠️ 포지션 이미 청산됨 → UI 강제 초기화');
                window.lastLivePosition = null;
                window._closeConfirmedAt = Date.now();
                updatePositionUI(false, null);
                showToast('포지션이 이미 청산되었습니다', 'success');
                // ★★★ 히스토리/P&L만 갱신 ★★★
                setTimeout(() => {
                    if (typeof loadHistory === 'function') loadHistory();
                    if (typeof syncTradeTodayPL === 'function') syncTradeTodayPL();
                }, 3000);
                // 20초 후 플래그 해제
                setTimeout(() => {
                    window._closeConfirmedAt = null;
                    window._userClosing = false;
                    window._plGaugeFrozen = false;
                }, 20000);
            } else {
                showToast(friendlyError(errMsg), 'error');
            }
        }
    } catch (e) { showToast('Network error', 'error'); }

    // ★★★ 15초 후 플래그 완전 해제 (MetaAPI 캐시 동기화 완료 대기) ★★★
    setTimeout(() => {
        window._userClosing = false;
        window._plGaugeFrozen = false;
        window._closeConfirmedAt = null;
        console.log('[closePosition] 🔓 모든 청산 플래그 해제 (20초 후)');
    }, 20000);
}

// ========== Demo 모드 주문 ==========
async function placeDemoOrder(orderType) {
    console.log(`[placeDemoOrder] 🔵 START - Order: ${orderType}, Symbol: ${currentSymbol}, Target: ${targetAmount}`);
    showToast('처리 중...', 'info');
    try {
        let response;

        // 마틴 모드면 마틴 API 사용
        if (currentMode === 'martin' && martinEnabled) {
            console.log('[placeDemoOrder] Using Martin API');
            response = await fetch(`${API_URL}/demo/martin/order?symbol=${currentSymbol}&order_type=${orderType}&target=${targetAmount}&magic=${BUYSELL_MAGIC_NUMBER}`, {
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

        showToast(result?.success ? '주문 성공!' : friendlyError(result?.message), result?.success ? (orderType.toLowerCase() === 'buy' ? 'buy' : 'sell') : 'error');
        if (result?.success) {
            playSound(orderType.toLowerCase());

            // 마틴 모드면 단계 정보 업데이트
            if (result.martin_step) {
                martinStep = result.martin_step;
                updateMartinUI();
            }

            console.log('[placeDemoOrder] ✅ Order success - calling fetchDemoData()');
            fetchDemoData();
            // ★★★ 주문 성공 후 히스토리/P&L만 갱신 ★★★
            setTimeout(() => {
                if (typeof loadHistory === 'function') loadHistory();
                if (typeof syncTradeTodayPL === 'function') syncTradeTodayPL();
            }, 2000);
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
    try {
        const response = await fetch(`${API_URL}/demo/close?magic=${BUYSELL_MAGIC_NUMBER}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await response.json();
        
        if (result?.success) {
            playSound('close');
            const profit = result.profit || 0;
            const rawProfit = result.raw_profit !== undefined ? result.raw_profit : profit;

            // 마틴 모드 처리
            if (currentMode === 'martin' && martinEnabled) {
                if (profit > 0) {
                    if (profit >= martinAccumulatedLoss && martinAccumulatedLoss > 0) {
                        await fetch(`${API_URL}/demo/martin/reset-full?magic=${BUYSELL_MAGIC_NUMBER}`, {
                            method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
                        });
                        martinStep = 1;
                        martinAccumulatedLoss = 0;
                        martinHistory = [];
                        updateMartinUI();
                        updateTodayPL(profit);
                        showMartinSuccessPopup(profit);
                    } else {
                        const remainingLoss = Math.max(0, martinAccumulatedLoss - profit);
                        await fetch(`${API_URL}/demo/martin/update-state?step=${martinStep}&accumulated_loss=${remainingLoss}&magic=${BUYSELL_MAGIC_NUMBER}`, {
                            method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
                        });
                        martinAccumulatedLoss = remainingLoss;
                        updateMartinUI();
                        updateTodayPL(profit);
                        if (remainingLoss > 0) {
                            showToast(`일부 회복! +$${profit.toFixed(2)}\n남은 손실: $${remainingLoss.toFixed(2)}`, 'success');
                        } else {
                            showMartinSuccessPopup(profit);
                        }
                    }
                } else if (profit < 0) {
                    // ★★★ 손실 → 팝업으로 유저 선택 (raw_profit: 수수료 미포함) ★★★
                    updateTodayPL(profit);
                    showMartinPopup(rawProfit);
                } else {
                    showToast('청산 완료 (손익 없음)', 'success');
                }
            } else {
                // Basic/NoLimit 모드
                updateTodayPL(profit);
                if (profit >= 0) {
                    showToast(`청산 손익: +$${profit.toFixed(2)}`, 'success');
                } else {
                    showToast(`청산 손익: -$${Math.abs(profit).toFixed(2)}`, 'error');
                }
            }
            
            updatePositionUI(false, null);
            fetchDemoData();
            // ★★★ 청산 성공 후 히스토리/P&L만 갱신 ★★★
            setTimeout(() => {
                if (typeof loadHistory === 'function') loadHistory();
                if (typeof syncTradeTodayPL === 'function') syncTradeTodayPL();
            }, 3000);
        } else {
            showToast(friendlyError(result?.message), 'error');
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
let currentPeriod = 'week';  // 기본값: 1주일 (MetaAPI 500개 제한 고려)
let currentFilter = 'all';

// ★★★ Today P/L 고정값 및 Week 데이터 보존 ★★★
if (window._todayPLFixed === undefined) window._todayPLFixed = null;      // 오늘 P/L 고정값
if (window._weekHistoryData === undefined) window._weekHistoryData = null;   // Week 데이터 보존

async function loadHistory(period = null) {
    // ★★★ 중복 호출 방지 (5초 타임아웃) ★★★
    if (window._historyLoading && window._historyLoadingTime) {
        if (Date.now() - window._historyLoadingTime > 5000) {
            window._historyLoading = false;
        }
    }
    if (window._historyLoading) { return; }
    window._historyLoading = true;
    window._historyLoadingTime = Date.now();

    // period 미지정 시 항상 'week' 사용 (MetaAPI 500개 제한 고려)
    const requestPeriod = period || 'week';

    console.log('[loadHistory] ★ 시작 - isDemo:', isDemo, 'requestPeriod:', requestPeriod);

    // ★★★ 서버에 period 파라미터 전달 ★★★
    let endpoint = isDemo ? '/demo/history' : '/mt5/history';
    if (!isDemo) {
        endpoint += `?period=${requestPeriod}`;
    }
    console.log('[loadHistory] endpoint:', endpoint);

    try {
        const data = await apiCall(endpoint);
        console.log('[loadHistory] ★ API 응답:', data ? `history=${data.history?.length || 0}개` : 'null');

        if (data?.history) {
            allHistoryData = data.history;
            console.log('[loadHistory] ✅ 데이터 수신:', allHistoryData.length, '개');

            // 시간순 정렬 (최신순)
            allHistoryData.sort((a, b) => new Date(b.time) - new Date(a.time));

            // ★★★ Week 데이터 매번 갱신 ★★★
            if (requestPeriod === 'week') {
                window._weekHistoryData = [...allHistoryData];
                console.log('[loadHistory] ✅ Week 데이터 갱신:', window._weekHistoryData.length, '개');
            }

            // ★★★ Today P/L 매번 재계산 ★★★
            const now_pl = new Date();
            const todayStr_pl = `${String(now_pl.getMonth() + 1).padStart(2, '0')}/${String(now_pl.getDate()).padStart(2, '0')}`;
            let todayPL = 0;
            allHistoryData.forEach(h => {
                if (h.time && h.time.startsWith(todayStr_pl)) {
                    todayPL += h.profit || 0;
                }
            });
            window._todayPLFixed = todayPL;
            console.log('[loadHistory] ✅ Today P/L 갱신:', window._todayPLFixed);

            updateAccountStats(allHistoryData);
            renderFilteredHistory();
            updateHistorySummary();

            // Account Info 업데이트 추가
            if (typeof updateAccountInfoFromHistory === 'function') {
                updateAccountInfoFromHistory(allHistoryData);
            }
            console.log('[loadHistory] ✅ 렌더링 완료');
        } else {
            console.log('[loadHistory] ⚠️ 데이터 없음 또는 에러:', data);
            document.getElementById('historyList').innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 80px; font-size: 0.85em;">No trade history</p>';
        }
    } finally {
        window._historyLoading = false;
    }
}

function updateAccountStats(history) {
    // 오늘 날짜 (MM/DD 형식)
    const now = new Date();
    const todayStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;

    // ★★★ Today P/L — _todayPLFixed 사용 (loadHistory에서 매번 갱신됨) ★★★
    if (window._todayPLFixed === null) {
        let calcTodayPL = 0;
        history.forEach(h => {
            if (h.time && h.time.startsWith(todayStr)) {
                calcTodayPL += h.profit || 0;
            }
        });
        window._todayPLFixed = calcTodayPL;
        console.log('[updateAccountStats] Today P/L fallback 계산:', window._todayPLFixed);
    }

    // Win/Lose 통계 (인자 history 기준 - 필터에 따라 변경됨)
    let totalWins = 0;
    let totalLosses = 0;

    history.forEach(h => {
        const profit = h.profit || 0;
        if (profit >= 0) {
            totalWins++;
        } else {
            totalLosses++;
        }
    });

    // Win/Lose 업데이트
    const winLoseEl = document.getElementById('accWinLose');
    if (winLoseEl) {
        winLoseEl.textContent = `${totalWins} / ${totalLosses}`;
    }

    // ★★★ Today P/L은 항상 _todayPLFixed 사용 (절대 변하지 않음) ★★★
    const fixedPL = window._todayPLFixed;
    const todayPLEl = document.getElementById('accTodayPL');
    const todayPLLabel = todayPLEl?.closest('.summary-box-v2')?.querySelector('.summary-label');

    if (todayPLEl) {
        if (fixedPL >= 0) {
            todayPLEl.textContent = '+$' + fixedPL.toFixed(2);
            todayPLEl.style.color = 'var(--buy-color)';
        } else {
            todayPLEl.textContent = '-$' + Math.abs(fixedPL).toFixed(2);
            todayPLEl.style.color = 'var(--sell-color)';
        }
    }

    // 라벨은 항상 Today P/L
    if (todayPLLabel) {
        todayPLLabel.textContent = 'Today P/L';
    }

    console.log(`[updateAccountStats] FixedPL: ${fixedPL}, Win/Lose: ${totalWins}/${totalLosses}`);

    // 전역 변수에 저장
    window.todayWins = totalWins;
    window.todayLosses = totalLosses;

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

// 기간 선택 - 조건부 서버 요청
function selectPeriod(period, text) {
    currentPeriod = period;
    // "전체" → "3개월"로 표시
    const displayText = (period === 'all') ? '3개월' : text;
    document.getElementById('selectedPeriodText').textContent = displayText;

    // 옵션 활성화 상태 업데이트
    document.querySelectorAll('.period-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.period === period);
    });

    // 드롭다운 닫기
    document.getElementById('periodDropdown').classList.remove('show');

    // ★★★ 'today', 'week': 프론트 필터링만 / 'month', 'all': 서버 재요청 ★★★
    if (period === 'month' || period === 'all') {
        // 30일 이상은 서버에서 다시 조회 필요
        console.log('[selectPeriod] 서버 재요청:', period);

        // ★★★ 로딩 표시 ★★★
        const historyList = document.getElementById('historyList');
        if (historyList) {
            historyList.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 80px; font-size: 0.85em;">Loading...</p>';
        }

        loadHistory(period);
    } else {
        // ★★★ 'today', 'week': week 데이터에서 필터링 ★★★
        console.log('[selectPeriod] 프론트 필터링:', period);

        // week 데이터 복원 (month/all에서 돌아온 경우)
        if (window._weekHistoryData && window._weekHistoryData.length > 0) {
            allHistoryData = [...window._weekHistoryData];
            console.log('[selectPeriod] Week 데이터 복원:', allHistoryData.length, '개');
        }

        // ★★★ accTodayPL은 항상 _todayPLFixed로 고정 ★★★
        const fixedPL = window._todayPLFixed || 0;
        const todayPLEl = document.getElementById('accTodayPL');
        if (todayPLEl) {
            if (fixedPL >= 0) {
                todayPLEl.textContent = '+$' + fixedPL.toFixed(2);
                todayPLEl.style.color = 'var(--buy-color)';
            } else {
                todayPLEl.textContent = '-$' + Math.abs(fixedPL).toFixed(2);
                todayPLEl.style.color = 'var(--sell-color)';
            }
        }
        syncTradeTodayPL();

        renderFilteredHistory();
        updateHistorySummary();
    }
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
    console.log('[renderFilteredHistory] ★ 시작 - allHistoryData:', allHistoryData?.length || 0, '개');
    const container = document.getElementById('historyList');
    console.log('[renderFilteredHistory] container:', container ? 'exists' : 'NOT FOUND');
    let filtered = getFilteredByPeriod();

    // ★★★ 시간 역순 정렬 (최신 먼저) ★★★
    filtered.sort((a, b) => new Date(b.time) - new Date(a.time));

    // ★★★ 500개 제한 (최신 500개만 표시) ★★★
    if (filtered.length > 500) {
        console.log('[renderFilteredHistory] 500개 제한 적용:', filtered.length, '→ 500');
        filtered = filtered.slice(0, 500);
    }
    console.log('[renderFilteredHistory] filtered:', filtered?.length || 0, '개 (period:', currentPeriod, ')');

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
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 80px; font-size: 0.85em;">해당 조건의 거래 내역이 없습니다</p>';
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


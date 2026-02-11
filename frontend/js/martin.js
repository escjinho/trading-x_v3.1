/* ========================================
   Trading-X Martin Mode
   마틴 게일 전략 관련 함수
   ======================================== */

// ========== Martin Variables ==========
let martinEnabled = false;
let martinLevel = 5;
let martinStep = 1;
let martinAccumulatedLoss = 0;
let martinHistory = [];
let pendingLoss = 0;

// ========== Martin UI Update ==========
function updateMartinUI() {
    // ★★★ 마틴 타겟 계산: ceil((누적손실 + 기본타겟) / 5) * 5 ★★★
    // 백엔드 공식과 동일: 타겟 = ceil((accumulated_loss + base_target) / 5) * 5
    let displayTarget = Math.ceil((martinAccumulatedLoss + targetAmount) / 5) * 5;
    
    document.getElementById('martinTargetDisplay').textContent = '$' + displayTarget;
    document.getElementById('martinTargetInfo').textContent = displayTarget;
    
    const currentLot = lotSize * Math.pow(2, martinStep - 1);
    let lotText = currentLot.toFixed(2) + ' lot';
    if (martinStep > 1) {
        lotText += ' <span style="color: var(--accent-cyan);">(x' + Math.pow(2, martinStep - 1) + ')</span>';
    }
    document.getElementById('martinLotDisplay').innerHTML = lotText;
    
    document.getElementById('martinCurrentStep').textContent = martinStep;
    document.getElementById('martinMaxStepsDisplay').textContent = martinLevel;
    
    const badge = document.getElementById('martinStepBadge');
    if (martinStep > 1) {
        badge.style.display = 'inline';
        badge.textContent = 'Step ' + martinStep + ' / 누적손실: -$' + martinAccumulatedLoss.toFixed(0);
    } else {
        badge.style.display = 'none';
    }
    
    renderMartinDots();
}

function renderMartinDots() {
    const container = document.getElementById('martinDotsContainer');
    const displaySteps = 8;
    const hasMoreSteps = martinLevel > displaySteps;
    
    let html = '';
    
    for (let i = 0; i < displaySteps; i++) {
        const stepNum = i + 1;
        const isCurrent = stepNum === martinStep;
        const isPast = stepNum < martinStep;
        const isActive = stepNum <= martinLevel;
        
        let bgColor = '#2d3139';
        let content = '';
        let opacity = isActive ? 1 : 0.25;
        let boxShadow = 'none';
        
        if (isActive) {
            if (isPast) {
                bgColor = '#dc3246';
                content = '✗';
                boxShadow = '0 0 8px #dc3246';
            } else if (isCurrent) {
                bgColor = '#00d4ff';
                content = stepNum;
                boxShadow = '0 0 10px #00d4ff';
            } else {
                bgColor = '#646473';
            }
        }
        
        html += `<div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">`;
        html += `<div style="width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: white; background-color: ${bgColor}; opacity: ${opacity}; box-shadow: ${boxShadow};">${content}</div>`;
        html += isActive ? `<span style="font-size: 8px; color: #9ca3af;">L${stepNum}</span>` : `<span style="font-size: 8px; color: transparent;">L${stepNum}</span>`;
        html += '</div>';
    }
    
    if (hasMoreSteps) {
        html += `<div style="display: flex; flex-direction: column; align-items: center; gap: 2px; margin-left: 4px;">`;
        html += `<div style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; color: #00d4ff; font-size: 14px;">▶</div>`;
        html += `<span style="font-size: 8px; color: #9ca3af;">+${martinLevel - displaySteps}</span>`;
        html += '</div>';
    }
    
    container.innerHTML = html;
}

// ========== Martin Popups ==========
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
    
    martinStep = 1;
    martinAccumulatedLoss = 0;
    martinHistory = [];
    updateMartinUI();
    
    showToast('마틴이 1단계로 초기화되었습니다', '');
}

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
    
    martinStep = 1;
    martinAccumulatedLoss = 0;
    martinHistory = [];
    targetAmount = 50;
    
    updateMartinUI();
    showToast('🚀 1단계로 다시 시작합니다!', 'success');
}

// ========== Martin Close Handler ==========
function handleMartinClose(profit, result) {
    const baseTarget = 50;
    const currentDisplayTarget = baseTarget * Math.pow(2, martinStep - 1) + martinAccumulatedLoss;
    
    if (profit > 0) {
        if (profit >= martinAccumulatedLoss && martinAccumulatedLoss > 0) {
            apiCall('/mt5/martin/reset-full', 'POST');
            
            martinStep = 1;
            martinAccumulatedLoss = 0;
            martinHistory = [];
            updateMartinUI();
            updateTodayPL(profit);
            showMartinSuccessPopup(profit);
        } else if (profit < martinAccumulatedLoss || martinAccumulatedLoss === 0) {
            const remainingLoss = Math.max(0, martinAccumulatedLoss - profit);
            
            apiCall(`/mt5/martin/update-state?step=${martinStep}&accumulated_loss=${remainingLoss}`, 'POST');
            
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
                apiCall('/mt5/martin/reset-full', 'POST');
                
                showMaxPopup(newAccumulatedLoss);
                martinStep = 1;
                martinAccumulatedLoss = 0;
                martinHistory = [];
            } else {
                apiCall(`/mt5/martin/update-state?step=${newStep}&accumulated_loss=${newAccumulatedLoss}`, 'POST');
                
                martinStep = newStep;
                martinAccumulatedLoss = newAccumulatedLoss;
                showToast(`📈 Step ${newStep}로 진행! 손실: -$${lossAmount.toFixed(2)}`, 'error');
            }
        } else {
            const newAccumulatedLoss = martinAccumulatedLoss + lossAmount;
            
            apiCall(`/mt5/martin/update-state?step=${martinStep}&accumulated_loss=${newAccumulatedLoss}`, 'POST');
            
            martinAccumulatedLoss = newAccumulatedLoss;
            showToast(`📊 단계 유지! 손실: -$${lossAmount.toFixed(2)} (누적: $${newAccumulatedLoss.toFixed(2)})`, 'error');
        }
        
        updateTodayPL(profit);
        updateMartinUI();
    } else {
        showToast('청산 완료 (손익 없음)', 'success');
    }
}

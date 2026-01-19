// ========================================
// Settings Module
// ========================================

// Settings 관련 변수
let settingsSymbol = 'BTCUSD';
let settingsTarget = 100;
let settingsLeverage = 5;
let settingsLotSize = 0.10;
let settingsMode = 'basic';
let settingsMartinLevel = 3;
let settingsMartinEnabled = false;

// ========== 슬라이더 ==========
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

    if (currentMode === 'noLimit') {
        targetMax = Math.floor(balance * 0.5);
        leverageMax = 50;
    }

    // 슬라이더 max 값 업데이트
    targetSlider.max = targetMax;
    leverageSlider.max = leverageMax;

    document.getElementById('targetValue').textContent = '$' + targetAmount;
    targetSlider.value = targetAmount;
    updateSliderBackground(targetSlider, targetAmount, targetMax);

    document.getElementById('leverageDisplay').textContent = 'x' + leverage;
    leverageSlider.value = leverage;
    updateSliderBackground(leverageSlider, leverage, leverageMax);

    let calculatedLot = currentMode === 'martin' ? lotSize : leverage * 0.1;
    calculatedLot = Math.round(calculatedLot * 100) / 100;
    document.getElementById('lotDisplay').textContent = calculatedLot.toFixed(2) + ' lot (x' + leverage + ')';
    document.getElementById('tradeLotSize').textContent = calculatedLot.toFixed(2);
}

function adjustTarget(delta) {
    targetAmount = Math.max(0, Math.min(200, targetAmount + delta));
    updateTargetUI();
}

function updateTargetFromSlider(value) {
    targetAmount = parseInt(value);
    updateTargetUI();
}

function updateLeverageFromSlider(value) {
    leverage = parseInt(value);
    updateTargetUI();
}

// ========== Symbol 선택 ==========
function toggleSymbolDropdown() {
    const dropdown = document.getElementById('symbolDropdown');
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

function selectSymbol(el) {
    currentSymbol = el.dataset.symbol;
    document.getElementById('tradeSymbolIcon').textContent = el.dataset.icon;
    document.getElementById('tradeSymbolIcon').style.color = el.dataset.color;
    document.getElementById('tradeSymbolName').textContent = el.dataset.name;
    document.getElementById('tradeSymbolId').textContent = el.dataset.symbol;

    document.querySelectorAll('#symbolDropdown .symbol-option').forEach(opt => {
        opt.classList.remove('selected');
        const check = opt.querySelector('.symbol-option-check');
        if (check) check.style.display = 'none';
    });
    el.classList.add('selected');
    const check = el.querySelector('.symbol-option-check');
    if (check) check.style.display = 'block';
    document.getElementById('symbolDropdown').style.display = 'none';
}

function toggleChartSymbolDropdown() {
    const dropdown = document.getElementById('chartSymbolDropdown');
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

function selectChartSymbol(el) {
    chartSymbol = el.dataset.symbol;
    document.getElementById('chartSymbolIcon').textContent = el.dataset.icon;
    document.getElementById('chartSymbolIcon').style.color = el.dataset.color;
    document.getElementById('chartSymbolName').textContent = el.dataset.name;
    document.getElementById('chartSymbolId').textContent = el.dataset.symbol;
    document.getElementById('chartSymbolDropdown').style.display = 'none';

    if (chart) {
        chart.remove();
        chart = null;
        initChart();
        loadCandles();
    }
}

// ========== Settings Modal ==========
function openSettings() {
    settingsSymbol = currentSymbol;
    settingsTarget = targetAmount;
    settingsLeverage = leverage;
    settingsLotSize = lotSize;
    settingsMode = currentMode;
    settingsMartinLevel = martinLevel;
    settingsMartinEnabled = martinEnabled;

    updateSettingsUI();
    document.getElementById('settingsModal').classList.add('show');
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('show');
}

function updateSettingsUI() {
    document.getElementById('settingsSymbolText').textContent = settingsSymbol;
    document.getElementById('settingsSymbolDesc').textContent = symbolData[settingsSymbol]?.desc || '';

    document.querySelectorAll('.mode-option').forEach(opt => {
        const isSelected = opt.dataset.mode === settingsMode;
        opt.classList.toggle('selected', isSelected);
        opt.querySelector('.mode-radio').textContent = isSelected ? '●' : '○';
    });

    if (settingsMode === 'martin') {
        document.getElementById('settingsTargetValue').textContent = '$' + settingsTarget;
        document.getElementById('leverageLotLabel').textContent = 'Lot Size';
        document.getElementById('leverageLotHint').textContent = '(Range: 0.01 ~ 10.00)';
        document.getElementById('settingsLeverageValue').value = settingsLotSize.toFixed(2);
   } else if (settingsMode === 'noLimit') {
        // DOM에서 현재 잔고 가져오기
        let currentBalance = 10000;
        const balanceEl = document.getElementById('tradeBalance');
        if (balanceEl) {
            const balanceText = balanceEl.textContent.replace(/[$,]/g, '');
            currentBalance = parseFloat(balanceText) || 10000;
        }
        const percent = Math.round((settingsTarget / currentBalance) * 100);
        document.getElementById('settingsTargetValue').textContent = percent + '%';
        document.getElementById('targetHint').textContent = '(Range: 1% ~ 50%)';
        document.getElementById('leverageLotLabel').textContent = 'Leverage';
        document.getElementById('leverageLotHint').textContent = '(Range: x1 ~ x50)';
        document.getElementById('settingsLeverageValue').value = 'x' + settingsLeverage;
    } else {
        document.getElementById('settingsTargetValue').textContent = '$' + settingsTarget;
        document.getElementById('targetHint').textContent = '(Range: $10 ~ $200)';
        document.getElementById('leverageLotLabel').textContent = 'Leverage';
        document.getElementById('leverageLotHint').textContent = '(Range: x1 ~ x20)';
        document.getElementById('settingsLeverageValue').value = 'x' + settingsLeverage;
    }

    const martinRow = document.getElementById('martinLevelRow');
    const martinCheckbox = document.getElementById('martinCheckbox');
    const martinMaxInfo = document.getElementById('martinMaxInfo');

    if (settingsMode === 'martin') {
        martinRow.style.opacity = '1';
        martinCheckbox.disabled = false;
        martinCheckbox.checked = settingsMartinEnabled;

        if (settingsMartinEnabled) {
            document.getElementById('martinDownBtn').disabled = false;
            document.getElementById('martinUpBtn').disabled = false;
            martinMaxInfo.style.display = 'flex';
            updateMartinMaxInfo();
        } else {
            document.getElementById('martinDownBtn').disabled = true;
            document.getElementById('martinUpBtn').disabled = true;
            martinMaxInfo.style.display = 'none';
        }
    } else {
        martinRow.style.opacity = '0.4';
        martinCheckbox.disabled = true;
        martinCheckbox.checked = false;
        document.getElementById('martinDownBtn').disabled = true;
        document.getElementById('martinUpBtn').disabled = true;
        martinMaxInfo.style.display = 'none';
    }

    document.getElementById('martinLevelValue').textContent = settingsMartinLevel;
}

function selectMode(el) {
    settingsMode = el.dataset.mode;

    if (settingsMode === 'basic') {
        settingsTarget = 100;
        settingsLeverage = 5;
    } else if (settingsMode === 'noLimit') {
        // DOM에서 현재 잔고 가져오기
        let currentBalance = 10000;
        const balanceEl = document.getElementById('tradeBalance');
        if (balanceEl) {
            const balanceText = balanceEl.textContent.replace(/[$,]/g, '');
            currentBalance = parseFloat(balanceText) || 10000;
        }
        settingsTarget = Math.floor(currentBalance * 0.1);
        // 5 단위로 반올림
        settingsTarget = Math.round(settingsTarget / 5) * 5;
        settingsLeverage = 5;
    } else if (settingsMode === 'martin') {
        // Martin 모드 기본값
        settingsTarget = 50;
        settingsLotSize = 0.01;
        settingsMartinLevel = 5;
        settingsMartinEnabled = false;
    }

    updateSettingsUI();
}

function toggleSettingsSymbol() {
    const dropdown = document.getElementById('settingsSymbolDropdown');
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

function setSettingsSymbol(symbol) {
    settingsSymbol = symbol;
    document.getElementById('settingsSymbolText').textContent = symbol;
    document.getElementById('settingsSymbolDesc').textContent = symbolData[symbol]?.desc || '';
    document.getElementById('settingsSymbolDropdown').style.display = 'none';
}

function adjustSettingsTarget(delta) {
    if (settingsMode === 'noLimit') {
        // DOM에서 현재 잔고 가져오기
        let currentBalance = 10000;
        const balanceEl = document.getElementById('tradeBalance');
        if (balanceEl) {
            const balanceText = balanceEl.textContent.replace(/[$,]/g, '');
            currentBalance = parseFloat(balanceText) || 10000;
        }
        const onePercent = currentBalance * 0.01;
        settingsTarget = Math.max(onePercent, Math.min(currentBalance * 0.5, settingsTarget + (delta > 0 ? onePercent : -onePercent)));
        // 5 단위로 반올림
        settingsTarget = Math.round(settingsTarget / 5) * 5;
    } else {
        settingsTarget = Math.max(10, Math.min(200, settingsTarget + delta));
    }
    updateSettingsUI();
}

// 마틴 모드 랏수 직접 입력
function updateSettingsLotFromInput(value) {
    const num = parseFloat(value);
    if (!isNaN(num) && num >= 0.01 && num <= 10) {
        settingsLotSize = Math.round(num * 100) / 100;
        updateSettingsUI();
    } else {
        showToast('0.01 ~ 10 범위로 입력하세요', 'error');
        updateSettingsUI();
    }
}

// 레버리지/랏수 직접 입력 (통합)
function updateSettingsLeverageFromInput(value) {
    if (settingsMode === 'martin') {
        // 마틴 모드: 랏수 입력
        updateSettingsLotFromInput(value);
    } else {
        // Basic/NoLimit 모드: 레버리지 입력
        const num = parseInt(value.replace(/[^0-9]/g, ''));
        const max = settingsMode === 'noLimit' ? 50 : 20;

        if (!isNaN(num) && num >= 1 && num <= max) {
            settingsLeverage = num;
            updateSettingsUI();
        } else {
            showToast(`1 ~ ${max} 범위로 입력하세요`, 'error');
            updateSettingsUI();
        }
    }
}

// 레버리지/랏수 버튼 조절
function adjustSettingsLeverage(delta) {
    if (settingsMode === 'martin') {
        // 마틴 모드: 랏수 조절 (0.01 단위)
        settingsLotSize = Math.max(0.01, Math.min(10, Math.round((settingsLotSize + delta * 0.01) * 100) / 100));
    } else {
        // Basic/NoLimit 모드: 레버리지 조절
        const max = settingsMode === 'noLimit' ? 50 : 20;
        settingsLeverage = Math.max(1, Math.min(max, settingsLeverage + delta));
    }
    updateSettingsUI();
}

function toggleMartinLevel() {
    settingsMartinEnabled = document.getElementById('martinCheckbox').checked;
    updateSettingsUI();
}

function adjustMartinLevel(delta) {
    const maxAvailable = calculateMartinMax();
    settingsMartinLevel = Math.max(1, Math.min(Math.min(20, maxAvailable), settingsMartinLevel + delta));
    updateSettingsUI();
}

function calculateMartinMax() {
    for (let n = 20; n >= 1; n--) {
        const required = settingsLotSize * settingsTarget * (Math.pow(2, n) - 1);
        if (balance >= required) return n;
    }
    return 1;
}

function updateMartinMaxInfo() {
    const maxStep = calculateMartinMax();
    const required = settingsLotSize * settingsTarget * (Math.pow(2, maxStep) - 1);
    document.getElementById('martinMaxStep').textContent = maxStep;
    document.getElementById('martinRequired').textContent = '$' + Math.round(required).toLocaleString() + '+';
}

function setMartinMax() {
    settingsMartinLevel = calculateMartinMax();
    updateSettingsUI();
}

async function applySettings() {
    if (settingsMode === 'martin' && !settingsMartinEnabled) {
        showToast('Martin Level 체크박스를 활성화하세요!', 'error');
        return;
    }

    currentSymbol = settingsSymbol;
    currentMode = settingsMode;
    targetAmount = settingsTarget;
    leverage = settingsLeverage;
    lotSize = settingsLotSize;
    martinLevel = settingsMartinLevel;
    martinEnabled = settingsMartinEnabled;

    if (currentMode === 'martin' && martinEnabled) {
        if (isDemo) {
            await apiCall(`/demo/martin/enable?base_lot=${lotSize}&max_steps=${martinLevel}`, 'POST');
        } else {
            await apiCall(`/mt5/martin/enable?base_lot=${lotSize}&target=${targetAmount}&max_steps=${martinLevel}`, 'POST');
        }
    } else {
        if (isDemo) {
            await apiCall('/demo/martin/disable', 'POST');
        } else {
            await apiCall('/mt5/martin/disable', 'POST');
        }
    }

    const sData = symbolData[currentSymbol];
    document.getElementById('tradeSymbolIcon').textContent = sData.icon;
    document.getElementById('tradeSymbolIcon').style.color = sData.color;
    document.getElementById('tradeSymbolName').textContent = sData.name;
    document.getElementById('tradeSymbolId').textContent = currentSymbol;

    updateMainPanelForMode();
    updateTargetUI();
    
    // 무제한 모드면 딜레이 후 다시 UI 업데이트 (balance 동기화 대기)
    if (currentMode === 'noLimit') {
        setTimeout(() => {
            updateTargetUI();
        }, 500);
    }
    
    closeSettings();
    showToast('Settings applied!', 'success');
}

function resetSettings() {
    if (settingsMode === 'basic') {
        // Basic 모드 기본값
        settingsTarget = 100;
        settingsLeverage = 5;
    } else if (settingsMode === 'noLimit') {
        // No Limit 모드 기본값 - DOM에서 현재 잔고 가져오기
        let currentBalance = 10000;
        const balanceEl = document.getElementById('tradeBalance');
        if (balanceEl) {
            const balanceText = balanceEl.textContent.replace(/[$,]/g, '');
            currentBalance = parseFloat(balanceText) || 10000;
        }
        settingsTarget = Math.floor(currentBalance * 0.1);
        // 5 단위로 반올림
        settingsTarget = Math.round(settingsTarget / 5) * 5;
        settingsLeverage = 5;
    } else if (settingsMode === 'martin') {
        settingsTarget = 50;
        settingsLotSize = 0.01;
        settingsMartinLevel = 5;
        settingsMartinEnabled = false;
    }

    // UI 업데이트
    updateSettingsUI();
    showToast('기본값으로 초기화됨', 'success');
}

// ========== 모드별 패널 UI ==========
function updateMainPanelForMode() {
    const martinModeUI = document.getElementById('martinModeUI');
    const normalModeUI = document.getElementById('normalModeUI');
    const targetSlider = document.getElementById('targetSlider');
    const leverageSlider = document.getElementById('leverageSlider');

    if (!martinModeUI || !normalModeUI || !targetSlider || !leverageSlider) return;

    const targetLabelsDiv = targetSlider.parentElement.querySelector('.slider-labels');
    const levLabelsDiv = leverageSlider.parentElement.querySelector('.slider-labels');

    if (currentMode === 'martin' && martinEnabled) {
        martinModeUI.style.display = 'block';
        normalModeUI.style.display = 'none';
        updateMartinUI();
    } else {
        martinModeUI.style.display = 'none';
        normalModeUI.style.display = 'block';

        if (currentMode === 'basic') {
            targetSlider.max = 200;
            targetSlider.min = 0;
            leverageSlider.max = 20;
            leverageSlider.min = 0;

            if (targetLabelsDiv) {
                targetLabelsDiv.innerHTML = '<span>$0</span><span>$50</span><span>$100</span><span>$150</span><span>$200</span>';
            }
            if (levLabelsDiv) {
                levLabelsDiv.innerHTML = '<span>x0</span><span>x5</span><span>x10</span><span>x15</span><span>x20</span>';
            }
        } else if (currentMode === 'noLimit') {
            const maxTarget = Math.floor(balance * 0.5);
            targetSlider.max = maxTarget;
            targetSlider.min = 0;
            leverageSlider.max = 50;
            leverageSlider.min = 0;

            if (targetLabelsDiv) {
                targetLabelsDiv.innerHTML = '<span>0%</span><span>10%</span><span>25%</span><span>40%</span><span>50%</span>';
            }
            if (levLabelsDiv) {
                levLabelsDiv.innerHTML = '<span>x0</span><span>x10</span><span>x25</span><span>x40</span><span>x50</span>';
            }
        }

        targetSlider.value = targetAmount;
        leverageSlider.value = leverage;
    }
}

function updateMartinUI() {
    // 마틴 타겟 계산: 단계별 2배 + 누적손실 회복
    let displayTarget = targetAmount;  // 기본 목표

    if (martinStep > 1) {
        // 단계 진행 시: 기본목표 × 2^(step-1) + 누적손실
        displayTarget = targetAmount * Math.pow(2, martinStep - 1) + martinAccumulatedLoss;
    } else if (martinAccumulatedLoss > 0) {
        // 1단계인데 누적손실이 있는 경우 (중간 청산 후)
        displayTarget = targetAmount + martinAccumulatedLoss;
    }

    displayTarget = Math.ceil(displayTarget);

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
    if (!container) return;

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
            // 마틴은 손실 후 다음 단계로 가니까, 이전 단계는 모두 손실!
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

// ========== 초기화 ==========
// 페이지 로드 시 실행
document.addEventListener('DOMContentLoaded', function() {
    // Symbol 드롭다운 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.symbol-row')) {
            const symbolDropdown = document.getElementById('symbolDropdown');
            if (symbolDropdown) symbolDropdown.style.display = 'none';
        }
        if (!e.target.closest('.chart-symbol-row')) {
            const chartSymbolDropdown = document.getElementById('chartSymbolDropdown');
            if (chartSymbolDropdown) chartSymbolDropdown.style.display = 'none';
        }
    });

    // 초기 UI 업데이트 (요소가 존재할 때만)
    if (document.getElementById('targetSlider')) {
        updateTargetUI();
    }
});

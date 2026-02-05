/* ========================================
   Trading-X App Initialization
   앱 초기화 및 이벤트 바인딩
   ======================================== */

// ========== Initialize App ==========
function initApp() {
    // Load saved settings
    loadSavedSettings();
    
    // Initialize Home
    initHome();
    
    // Initialize Chart module (단 1회만 실행)
    if (!window._chartModuleInitialized) {
        window._chartModuleInitialized = true;
        initChartModule();
    }
    
    // Initialize sliders
    const targetSlider = document.getElementById('targetSlider');
    const leverageSlider = document.getElementById('leverageSlider');
    
    if (targetSlider) {
        targetSlider.value = targetAmount;
        updateSliderBackground(targetSlider);
        targetSlider.addEventListener('input', function() {
            updateTargetFromSlider(this.value);
        });
    }
    
    if (leverageSlider) {
        leverageSlider.value = leverage;
        updateSliderBackground(leverageSlider);
        leverageSlider.addEventListener('input', function() {
            updateLeverageFromSlider(this.value);
        });
    }
    
    // Update UI based on mode
    updateMainPanelForMode();
    
    // Start user mode check or guest mode
    if (!isGuest && token) {
        checkUserMode();
    } else if (isGuest) {
        initGuestMode();
    }
}

// ========== Guest Mode Initialization ==========
function initGuestMode() {
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
    
    // Guest indicators
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
                baseScore = data.score || 50;
            }
        } catch (e) {
            console.log('Guest indicator error:', e);
        }
    }
    
    fetchGuestIndicators();
    setInterval(fetchGuestIndicators, 3000);
    
    setTimeout(() => {
        showToast('👋 게스트 모드로 둘러보는 중입니다', '');
    }, 1000);
}

// ========== DOMContentLoaded ==========
document.addEventListener('DOMContentLoaded', function() {
    initApp();
});

// If already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initApp();
}

/* ========================================
   Trading-X Chart Tab
   패널 모듈 통합 및 초기화
   ======================================== */

// ========== 이전 버전 호환성을 위한 전역 함수 노출 ==========
// ChartPanel의 함수들을 전역으로 노출
function initChart() {
    if (typeof ChartPanel !== 'undefined') {
        ChartPanel.initChart();
    }
}

async function loadCandles() {
    if (typeof ChartPanel !== 'undefined') {
        await ChartPanel.loadCandles();
    }
}

function updateChartPrice(price) {
    if (typeof ChartPanel !== 'undefined') {
        ChartPanel.updateChartPrice(price);
    }
}

// ========== Chart Module 초기화 ==========
function initChartModule() {
    console.log('[ChartModule] Initializing all panels...');

    // 각 패널 초기화
    if (typeof GaugePanel !== 'undefined') {
        GaugePanel.init();
    }

    if (typeof ChartGaugePanel !== 'undefined') {
        ChartGaugePanel.init();
    }

    if (typeof ChartPanel !== 'undefined') {
        ChartPanel.init();
    }

    if (typeof SymbolSelectorPanel !== 'undefined') {
        SymbolSelectorPanel.init();
    }

    if (typeof RandomWalkPanel !== 'undefined') {
        RandomWalkPanel.init();
    }

    console.log('[ChartModule] All panels initialized');
}

// ========== 모든 패널 정리 ==========
function destroyChartModule() {
    console.log('[ChartModule] Destroying all panels...');

    if (typeof GaugePanel !== 'undefined') {
        GaugePanel.destroy();
    }

    if (typeof ChartGaugePanel !== 'undefined') {
        ChartGaugePanel.destroy();
    }

    if (typeof ChartPanel !== 'undefined') {
        ChartPanel.destroy();
    }

    if (typeof SymbolSelectorPanel !== 'undefined') {
        SymbolSelectorPanel.destroy();
    }

    if (typeof RandomWalkPanel !== 'undefined') {
        RandomWalkPanel.destroy();
    }

    console.log('[ChartModule] All panels destroyed');
}

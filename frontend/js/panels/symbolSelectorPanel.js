/* ========================================
   Symbol Selector Panel Module
   차트 심볼 선택 드롭다운
   ======================================== */

const SymbolSelectorPanel = {
    /**
     * 심볼 선택 패널 초기화
     */
    init() {
        console.log('[SymbolSelectorPanel] Initialized');
    },

    /**
     * 심볼 드롭다운 토글
     */
    toggleDropdown() {
        const dropdown = document.getElementById('chartSymbolDropdown');
        if (dropdown) {
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
        }
    },

    /**
     * 심볼 선택
     */
    selectSymbol(symbol, name, icon, color) {
        // 전역 변수 업데이트
        chartSymbol = symbol;
        localStorage.setItem('last_chart_symbol', symbol);

        // UI 업데이트
        const iconEl = document.getElementById('chartSymbolIcon');
        const nameEl = document.getElementById('chartSymbolName');
        const idEl = document.getElementById('chartSymbolId');
        const dropdown = document.getElementById('chartSymbolDropdown');

        if (iconEl) {
            iconEl.textContent = icon;
            iconEl.style.color = color;
        }
        if (nameEl) nameEl.textContent = name;
        if (idEl) idEl.textContent = symbol;
        if (dropdown) dropdown.style.display = 'none';

        // 차트 재초기화
        if (typeof ChartPanel !== 'undefined') {
            ChartPanel.reinit();
        }
    },

    /**
     * 외부에서 데이터 업데이트
     */
    update(data) {
        // 특별히 할 작업 없음
    },

    /**
     * 패널 정리
     */
    destroy() {
        console.log('[SymbolSelectorPanel] Destroyed');
    }
};

// 전역 함수로 노출 (HTML onclick에서 호출)
function toggleChartSymbolDropdown() {
    SymbolSelectorPanel.toggleDropdown();
}

function selectChartSymbol(symbol, name, icon, color) {
    SymbolSelectorPanel.selectSymbol(symbol, name, icon, color);
}

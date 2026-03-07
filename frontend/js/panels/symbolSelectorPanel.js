/* ========================================
   Symbol Selector Panel Module
   차트 심볼 선택 드롭다운
   ======================================== */

// ★ 종목 정보 데이터 — window.SYMBOL_CONFIG 사용 (symbol-config.js)
function getSymbolInfoData(symbol) {
    if (typeof window.SYMBOL_CONFIG !== 'undefined' && window.SYMBOL_CONFIG[symbol]) {
        const cfg = window.SYMBOL_CONFIG[symbol];
        return {
            icon: cfg.icon,
            iconColor: cfg.iconColor,
            name: cfg.name,
            desc: cfg.fullName,
            lotSize: cfg.lotSize,
            tickSize: cfg.tickSizeStr,
            minLot: cfg.minLot,
            maxLot: cfg.maxLot,
            pipSize: cfg.pipSize,
            stopLevel: cfg.stopLevel,
            spread: cfg.spread,
            spreadPips: cfg.spreadPips,
            swapLong: cfg.swapLong,
            swapLongClass: cfg.swapLongClass,
            swapShort: cfg.swapShort,
            swapShortClass: cfg.swapShortClass,
            swap3Day: cfg.swap3Day,
            hours: cfg.schedule
        };
    }
    return null;
}

// 하위 호환용 (기존 코드에서 symbolInfoDatabase[symbol] 접근 시)
const symbolInfoDatabase = new Proxy({}, {
    get: function(target, symbol) {
        return getSymbolInfoData(symbol);
    }
});

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
        console.log('[SymbolSelectorPanel] 종목 선택:', symbol);
        
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
        
        // 종목 정보 섹션 업데이트
        this.updateSymbolInfoSection(symbol);
    },
    
    /**
     * 종목 정보 섹션 업데이트
     */
    updateSymbolInfoSection(symbol) {
        console.log('[SymbolSelectorPanel] 종목 정보 업데이트:', symbol);
        
        const data = symbolInfoDatabase[symbol];
        if (!data) {
            console.log('[SymbolSelectorPanel] 종목 데이터 없음:', symbol);
            return;
        }
        
        // 아이콘 및 기본 정보
        const infoSymbolIcon = document.getElementById('infoSymbolIcon');
        if (infoSymbolIcon) {
            infoSymbolIcon.textContent = data.icon;
            infoSymbolIcon.style.color = data.iconColor;
        }
        
        const infoSymbolName = document.getElementById('infoSymbolName');
        if (infoSymbolName) infoSymbolName.textContent = data.name;
        
        const infoSymbolDesc = document.getElementById('infoSymbolDesc');
        if (infoSymbolDesc) infoSymbolDesc.textContent = data.desc;
        
        const infoSymbolId = document.getElementById('infoSymbolId');
        if (infoSymbolId) infoSymbolId.textContent = symbol;
        
        // 기본 정보
        const infoLotSize = document.getElementById('infoLotSize');
        if (infoLotSize) infoLotSize.textContent = data.lotSize;
        
        const infoTickSize = document.getElementById('infoTickSize');
        if (infoTickSize) infoTickSize.textContent = data.tickSize;
        
        const infoMinLot = document.getElementById('infoMinLot');
        if (infoMinLot) infoMinLot.textContent = data.minLot;
        
        const infoMaxLot = document.getElementById('infoMaxLot');
        if (infoMaxLot) infoMaxLot.textContent = data.maxLot;
        
        const infoPipSize = document.getElementById('infoPipSize');
        if (infoPipSize) infoPipSize.textContent = data.pipSize;
        
        const infoStopLevel = document.getElementById('infoStopLevel');
        if (infoStopLevel) infoStopLevel.textContent = data.stopLevel;
        
        // 스프레드 & 스왑
        const infoSpread = document.getElementById('infoSpread');
        if (infoSpread) infoSpread.textContent = data.spread;
        
        const infoSpreadPips = document.getElementById('infoSpreadPips');
        if (infoSpreadPips) infoSpreadPips.textContent = data.spreadPips;
        
        const swapLongEl = document.getElementById('infoSwapLong');
        if (swapLongEl) {
            swapLongEl.textContent = data.swapLong;
            swapLongEl.className = 'info-value ' + data.swapLongClass;
        }
        
        const swapShortEl = document.getElementById('infoSwapShort');
        if (swapShortEl) {
            swapShortEl.textContent = data.swapShort;
            swapShortEl.className = 'info-value ' + data.swapShortClass;
        }
        
        const infoSwap3Day = document.getElementById('infoSwap3Day');
        if (infoSwap3Day) infoSwap3Day.textContent = data.swap3Day;
        
        // 거래 시간 (전역 formatHoursWithKST 사용)
        const dayMap = {
            'Sun': 'sun', 'Mon': 'mon', 'Tue': 'tue',
            'Wed': 'wed', 'Thu': 'thu', 'Fri': 'fri', 'Sat': 'sat'
        };

        Object.keys(dayMap).forEach(day => {
            const key = dayMap[day];
            const el = document.getElementById('infoHours' + day);
            if (el && data.hours) {
                if (typeof formatHoursWithKST === 'function') {
                    formatHoursWithKST(el, data.hours[key] || '—');
                } else {
                    el.textContent = data.hours[key] || '—';
                }
            }
        });
        
        console.log('[SymbolSelectorPanel] 종목 정보 업데이트 완료:', symbol);
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

function selectChartSymbol(element) {
    const symbol = element.dataset.symbol;
    const name = element.dataset.name;
    const icon = element.dataset.icon;
    const color = element.dataset.color;
    
    console.log('[selectChartSymbol] 드롭다운에서 종목 선택:', symbol);
    
    SymbolSelectorPanel.selectSymbol(symbol, name, icon, color);
    
    // 종목 정보 섹션 직접 업데이트 (확실하게)
    SymbolSelectorPanel.updateSymbolInfoSection(symbol);
}
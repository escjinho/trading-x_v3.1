/* ========================================
   Symbol Selector Panel Module
   차트 심볼 선택 드롭다운
   ======================================== */

// 종목 정보 데이터 (MT5 실제 데이터 기준)
const symbolInfoDatabase = {
    'BTCUSD': {
        icon: '₿', iconColor: '#f7931a', name: 'Bitcoin', desc: 'Bitcoin vs US Dollar',
        lotSize: '1 Contract', tickSize: '0.01', minLot: '0.01 lot', maxLot: '10.00 lot',
        pipSize: '0.01 (2 digits)', stopLevel: '0',
        spread: '유동 스프레드', spreadPips: '~15 pips',
        swapLong: '-17.76%', swapLongClass: 'negative',
        swapShort: '-11.84%', swapShortClass: 'negative',
        swap3Day: 'Wednesday',
        hours: { sun: '00:02 - 23:57', mon: '00:02 - 23:57', tue: '00:02 - 23:57', wed: '00:02 - 23:57', thu: '00:02 - 23:57', fri: '00:02 - 23:57', sat: '00:02 - 09:30, 12:30 - 14:00, 15:00 - 23:57' }
    },
    'EURUSD.r': {
        icon: '€', iconColor: '#0052cc', name: 'Euro/Dollar', desc: 'Euro vs US Dollar',
        lotSize: '100,000 EUR', tickSize: '0.00001', minLot: '0.01 lot', maxLot: '50.00 lot',
        pipSize: '0.00001 (5 digits)', stopLevel: '0',
        spread: '유동 스프레드', spreadPips: '~1.0 pips',
        swapLong: '-8.9 points', swapLongClass: 'negative',
        swapShort: '+3.3 points', swapShortClass: 'positive',
        swap3Day: 'Wednesday',
        hours: { sun: '—', mon: '00:02 - 23:58', tue: '00:02 - 23:58', wed: '00:02 - 23:58', thu: '00:02 - 23:58', fri: '00:02 - 23:58', sat: '—' }
    },
    'USDJPY.r': {
        icon: '¥', iconColor: '#dc143c', name: 'Dollar/Yen', desc: 'US Dollar vs Japanese Yen',
        lotSize: '100,000 USD', tickSize: '0.001', minLot: '0.01 lot', maxLot: '50.00 lot',
        pipSize: '0.001 (3 digits)', stopLevel: '0',
        spread: '유동 스프레드', spreadPips: '~1.0 pips',
        swapLong: '+9.0 points', swapLongClass: 'positive',
        swapShort: '-19.5 points', swapShortClass: 'negative',
        swap3Day: 'Wednesday',
        hours: { sun: '—', mon: '00:02 - 23:58', tue: '00:02 - 23:58', wed: '00:02 - 23:58', thu: '00:02 - 23:58', fri: '00:02 - 23:58', sat: '—' }
    },
    'XAUUSD.r': {
        icon: '✦', iconColor: '#ffd700', name: 'Gold', desc: 'Gold vs US Dollar',
        lotSize: '100 oz', tickSize: '0.01', minLot: '0.01 lot', maxLot: '20.00 lot',
        pipSize: '0.01 (2 digits)', stopLevel: '0',
        spread: '유동 스프레드', spreadPips: '~16 pips',
        swapLong: '-53.5 points', swapLongClass: 'negative',
        swapShort: '+27.6 points', swapShortClass: 'positive',
        swap3Day: 'Wednesday',
        hours: { sun: '—', mon: '01:02 - 23:58', tue: '01:02 - 23:58', wed: '01:02 - 23:58', thu: '01:02 - 23:58', fri: '01:02 - 23:58', sat: '—' }
    },
    'US100.': {
        icon: '⬡', iconColor: '#00b450', name: 'NASDAQ', desc: 'US Tech 100 Index Cash',
        lotSize: '20 Contract', tickSize: '0.01', minLot: '0.01 lot', maxLot: '200.00 lot',
        pipSize: '0.01 (2 digits)', stopLevel: '0',
        spread: '유동 스프레드', spreadPips: '~100 pips',
        swapLong: '-165 USD', swapLongClass: 'negative',
        swapShort: '+43.4 USD', swapShortClass: 'positive',
        swap3Day: 'Friday',
        hours: { sun: '—', mon: '01:02 - 23:58', tue: '01:02 - 23:58', wed: '01:02 - 23:58', thu: '01:02 - 23:58', fri: '01:02 - 23:55', sat: '—' }
    },
    'GBPUSD.r': {
        icon: '£', iconColor: '#9c27b0', name: 'Pound/Dollar', desc: 'British Pound vs US Dollar',
        lotSize: '100,000 GBP', tickSize: '0.00001', minLot: '0.01 lot', maxLot: '50.00 lot',
        pipSize: '0.00001 (5 digits)', stopLevel: '0',
        spread: '유동 스프레드', spreadPips: '~1.2 pips',
        swapLong: '-4.2 points', swapLongClass: 'negative',
        swapShort: '+0.8 points', swapShortClass: 'positive',
        swap3Day: 'Wednesday',
        hours: { sun: '—', mon: '00:02 - 23:58', tue: '00:02 - 23:58', wed: '00:02 - 23:58', thu: '00:02 - 23:58', fri: '00:02 - 23:58', sat: '—' }
    },
    'ETHUSD': {
        icon: 'Ξ', iconColor: '#627eea', name: 'Ethereum', desc: 'Ethereum vs US Dollar',
        lotSize: '1 Contract', tickSize: '0.01', minLot: '0.01 lot', maxLot: '10.00 lot',
        pipSize: '0.01 (2 digits)', stopLevel: '0',
        spread: '유동 스프레드', spreadPips: '~150 pips',
        swapLong: '-12.16%', swapLongClass: 'negative',
        swapShort: '-8.11%', swapShortClass: 'negative',
        swap3Day: 'Wednesday',
        hours: { sun: '00:02 - 23:57', mon: '00:02 - 23:57', tue: '00:02 - 23:57', wed: '00:02 - 23:57', thu: '00:02 - 23:57', fri: '00:02 - 23:57', sat: '00:02 - 09:30, 12:30 - 14:00, 15:00 - 23:57' }
    }
};

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
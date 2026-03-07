/**
 * Trading-X 심볼 설정 단일 관리 파일 (Frontend)
 * ★★★ 심볼 추가/수정은 SYMBOL_CONFIG만 변경하면 됩니다 ★★★
 */

window.SYMBOL_CONFIG = {
    // ===== 크립토 =====
    'BTCUSD': {
        icon: '₿', iconColor: '#f7931a', name: 'Bitcoin', fullName: 'Bitcoin vs US Dollar',
        digits: 2, tick_size: 0.01, tick_value: 0.01, contract_size: 1, marginPerLot: 673,
        watchlistTab: 'crypto', inPopular: true, inTradePanel: true,
        schedule: { sun:'00:02 - 23:57', mon:'00:02 - 23:57', tue:'00:02 - 23:57', wed:'00:02 - 23:57', thu:'00:02 - 23:57', fri:'00:02 - 23:57', sat:'00:02 - 14:00, 15:00 - 23:57' },
        lotSize:'1 Contract', tickSizeStr:'0.01', minLot:'0.01 lot', maxLot:'10.00 lot', pipSize:'0.01 (2 digits)', stopLevel:'0',
        spread:'유동 스프레드', spreadPips:'~15 pips', swapLong:'-17.76%', swapLongClass:'negative', swapShort:'-11.84%', swapShortClass:'negative', swap3Day:'Wednesday',
    },
    'ETHUSD': {
        icon: '⟠', iconColor: '#627eea', name: 'Ethereum', fullName: 'Ethereum vs US Dollar',
        digits: 2, tick_size: 0.01, tick_value: 0.01, contract_size: 1, marginPerLot: 39,
        watchlistTab: 'crypto', inPopular: false, inTradePanel: false,
        schedule: { sun:'00:02 - 23:57', mon:'00:02 - 23:57', tue:'00:02 - 23:57', wed:'00:02 - 23:57', thu:'00:02 - 23:57', fri:'00:02 - 23:57', sat:'00:02 - 14:00, 15:00 - 23:57' },
        lotSize:'1 Contract', tickSizeStr:'0.01', minLot:'0.01 lot', maxLot:'10.00 lot', pipSize:'0.01 (2 digits)', stopLevel:'0',
        spread:'유동 스프레드', spreadPips:'~150 pips', swapLong:'-12.16%', swapLongClass:'negative', swapShort:'-8.11%', swapShortClass:'negative', swap3Day:'Wednesday',
    },
    // ===== FX =====
    'EURUSD.r': {
        icon: '€', iconColor: '#0052cc', name: 'Euro/Dollar', fullName: 'Euro vs US Dollar',
        digits: 5, tick_size: 0.00001, tick_value: 1.0, contract_size: 100000, marginPerLot: 260,
        watchlistTab: 'forex', inPopular: true, inTradePanel: true,
        schedule: { sun:'—', mon:'00:02 - 23:58', tue:'00:02 - 23:58', wed:'00:02 - 23:58', thu:'00:02 - 23:58', fri:'00:02 - 23:58', sat:'—' },
        lotSize:'100,000 EUR', tickSizeStr:'0.00001', minLot:'0.01 lot', maxLot:'50.00 lot', pipSize:'0.00001 (5 digits)', stopLevel:'0',
        spread:'유동 스프레드', spreadPips:'~1.0 pips', swapLong:'-8.9 points', swapLongClass:'negative', swapShort:'+3.3 points', swapShortClass:'positive', swap3Day:'Wednesday',
    },
    'USDJPY.r': {
        icon: '¥', iconColor: '#dc143c', name: 'Dollar/Yen', fullName: 'US Dollar vs Japanese Yen',
        digits: 3, tick_size: 0.001, tick_value: 0.67, contract_size: 100000, marginPerLot: 260,
        watchlistTab: 'forex', inPopular: true, inTradePanel: true,
        schedule: { sun:'—', mon:'00:02 - 23:58', tue:'00:02 - 23:58', wed:'00:02 - 23:58', thu:'00:02 - 23:58', fri:'00:02 - 23:58', sat:'—' },
        lotSize:'100,000 USD', tickSizeStr:'0.001', minLot:'0.01 lot', maxLot:'50.00 lot', pipSize:'0.001 (3 digits)', stopLevel:'0',
        spread:'유동 스프레드', spreadPips:'~1.0 pips', swapLong:'+9.0 points', swapLongClass:'positive', swapShort:'-19.5 points', swapShortClass:'negative', swap3Day:'Wednesday',
    },
    'GBPUSD.r': {
        icon: '£', iconColor: '#9c27b0', name: 'Pound/Dollar', fullName: 'Pound vs US Dollar',
        digits: 5, tick_size: 0.00001, tick_value: 1.0, contract_size: 100000, marginPerLot: 320,
        watchlistTab: 'forex', inPopular: false, inTradePanel: false,
        schedule: { sun:'—', mon:'00:02 - 23:58', tue:'00:02 - 23:58', wed:'00:02 - 23:58', thu:'00:02 - 23:58', fri:'00:02 - 23:58', sat:'—' },
        lotSize:'100,000 GBP', tickSizeStr:'0.00001', minLot:'0.01 lot', maxLot:'50.00 lot', pipSize:'0.00001 (5 digits)', stopLevel:'0',
        spread:'유동 스프레드', spreadPips:'~1.2 pips', swapLong:'-4.2 points', swapLongClass:'negative', swapShort:'+0.8 points', swapShortClass:'positive', swap3Day:'Wednesday',
    },
    'AUDUSD.r': {
        icon: 'A$', iconColor: '#00875a', name: 'Aussie/Dollar', fullName: 'Australian vs US Dollar',
        digits: 5, tick_size: 0.00001, tick_value: 1.0, contract_size: 100000, marginPerLot: 200,
        watchlistTab: 'forex', inPopular: false, inTradePanel: false,
        schedule: { sun:'—', mon:'00:02 - 23:58', tue:'00:02 - 23:58', wed:'00:02 - 23:58', thu:'00:02 - 23:58', fri:'00:02 - 23:58', sat:'—' },
        lotSize:'100,000 AUD', tickSizeStr:'0.00001', minLot:'0.01 lot', maxLot:'50.00 lot', pipSize:'0.00001 (5 digits)', stopLevel:'0',
        spread:'유동 스프레드', spreadPips:'~1.2 pips', swapLong:'-3.5 points', swapLongClass:'negative', swapShort:'+0.5 points', swapShortClass:'positive', swap3Day:'Wednesday',
    },
    'USDCAD.r': {
        icon: 'C$', iconColor: '#ff5722', name: 'Dollar/CAD', fullName: 'US Dollar vs Canadian',
        digits: 5, tick_size: 0.00001, tick_value: 0.74, contract_size: 100000, marginPerLot: 200,
        watchlistTab: 'forex', inPopular: false, inTradePanel: false,
        schedule: { sun:'—', mon:'00:02 - 23:58', tue:'00:02 - 23:58', wed:'00:02 - 23:58', thu:'00:02 - 23:58', fri:'00:02 - 23:58', sat:'—' },
        lotSize:'100,000 USD', tickSizeStr:'0.00001', minLot:'0.01 lot', maxLot:'50.00 lot', pipSize:'0.00001 (5 digits)', stopLevel:'0',
        spread:'유동 스프레드', spreadPips:'~1.5 pips', swapLong:'-5.0 points', swapLongClass:'negative', swapShort:'+1.2 points', swapShortClass:'positive', swap3Day:'Wednesday',
    },
    // ===== 귀금속 =====
    'XAUUSD.r': {
        icon: '✦', iconColor: '#ffd700', name: 'Gold', fullName: 'Gold vs US Dollar',
        digits: 2, tick_size: 0.01, tick_value: 1.0, contract_size: 100, marginPerLot: 2400,
        watchlistTab: 'metals', inPopular: true, inTradePanel: true,
        schedule: { sun:'—', mon:'01:02 - 23:58', tue:'01:02 - 23:58', wed:'01:02 - 23:58', thu:'01:02 - 23:58', fri:'01:02 - 23:55', sat:'—' },
        lotSize:'100 oz', tickSizeStr:'0.01', minLot:'0.01 lot', maxLot:'20.00 lot', pipSize:'0.01 (2 digits)', stopLevel:'0',
        spread:'유동 스프레드', spreadPips:'~16 pips', swapLong:'-53.5 points', swapLongClass:'negative', swapShort:'+27.6 points', swapShortClass:'positive', swap3Day:'Wednesday',
    },
    'XAGUSD.r': {
        icon: '✧', iconColor: '#c0c0c0', name: 'Silver', fullName: 'Silver vs US Dollar',
        digits: 3, tick_size: 0.001, tick_value: 5.0, contract_size: 5000, marginPerLot: 2500,
        watchlistTab: 'metals', inPopular: false, inTradePanel: false,
        schedule: { sun:'—', mon:'01:02 - 23:58', tue:'01:02 - 23:58', wed:'01:02 - 23:58', thu:'01:02 - 23:58', fri:'01:02 - 23:55', sat:'—' },
        lotSize:'5,000 oz', tickSizeStr:'0.001', minLot:'0.01 lot', maxLot:'20.00 lot', pipSize:'0.001 (3 digits)', stopLevel:'0',
        spread:'유동 스프레드', spreadPips:'~20 pips', swapLong:'-5.0 points', swapLongClass:'negative', swapShort:'+2.0 points', swapShortClass:'positive', swap3Day:'Wednesday',
    },
    // ===== 지수 =====
    'US100.': {
        icon: '⬡', iconColor: '#00b450', name: 'NASDAQ', fullName: 'Nasdaq 100 Index',
        digits: 2, tick_size: 0.01, tick_value: 0.2, contract_size: 20, marginPerLot: 2466,
        watchlistTab: 'indices', inPopular: true, inTradePanel: true,
        schedule: { sun:'—', mon:'01:02 - 23:58', tue:'01:02 - 23:58', wed:'01:02 - 23:58', thu:'01:02 - 23:58', fri:'01:02 - 23:55', sat:'—' },
        lotSize:'20 Contract', tickSizeStr:'0.01', minLot:'0.01 lot', maxLot:'200.00 lot', pipSize:'0.01 (2 digits)', stopLevel:'0',
        spread:'유동 스프레드', spreadPips:'~100 pips', swapLong:'-164.55 USD', swapLongClass:'negative', swapShort:'+42.95 USD', swapShortClass:'positive', swap3Day:'Friday',
    },
    'US500.': {
        icon: '◆', iconColor: '#1976d2', name: 'S&P 500', fullName: 'S&P 500 Index',
        digits: 2, tick_size: 0.01, tick_value: 0.1, contract_size: 10, marginPerLot: 500,
        watchlistTab: 'indices', inPopular: false, inTradePanel: false,
        schedule: { sun:'—', mon:'01:02 - 23:58', tue:'01:02 - 23:58', wed:'01:02 - 23:58', thu:'01:02 - 23:58', fri:'01:02 - 23:55', sat:'—' },
        lotSize:'10 Contract', tickSizeStr:'0.01', minLot:'0.01 lot', maxLot:'200.00 lot', pipSize:'0.01 (2 digits)', stopLevel:'0',
        spread:'유동 스프레드', spreadPips:'~50 pips', swapLong:'-30 USD', swapLongClass:'negative', swapShort:'+8 USD', swapShortClass:'positive', swap3Day:'Friday',
    },
    'US30.': {
        icon: '◈', iconColor: '#ff9800', name: 'Dow Jones', fullName: 'Dow Jones Index',
        digits: 2, tick_size: 0.01, tick_value: 0.05, contract_size: 5, marginPerLot: 250,
        watchlistTab: 'indices', inPopular: false, inTradePanel: false,
        schedule: { sun:'—', mon:'01:02 - 23:58', tue:'01:02 - 23:58', wed:'01:02 - 23:58', thu:'01:02 - 23:58', fri:'01:02 - 23:55', sat:'—' },
        lotSize:'5 Contract', tickSizeStr:'0.01', minLot:'0.01 lot', maxLot:'200.00 lot', pipSize:'0.01 (2 digits)', stopLevel:'0',
        spread:'유동 스프레드', spreadPips:'~100 pips', swapLong:'-20 USD', swapLongClass:'negative', swapShort:'+5 USD', swapShortClass:'positive', swap3Day:'Friday',
    },
    // ===== 에너지 =====
    'XBRUSD': {
        icon: '✺', iconColor: '#8d6e63', name: 'Brent Oil', fullName: 'Brent Crude Oil',
        digits: 2, tick_size: 0.01, tick_value: 10.0, contract_size: 1000, marginPerLot: 906,
        watchlistTab: 'energy', inPopular: false, inTradePanel: false,
        schedule: { sun:'—', mon:'03:02 - 23:53', tue:'03:02 - 23:53', wed:'03:02 - 23:53', thu:'03:02 - 23:53', fri:'03:02 - 23:53', sat:'—' },
        lotSize:'1,000 barrels', tickSizeStr:'0.01', minLot:'0.01 lot', maxLot:'20.00 lot', pipSize:'0.01 (2 digits)', stopLevel:'0',
        spread:'유동 스프레드', spreadPips:'~4 pips', swapLong:'-30 USD', swapLongClass:'negative', swapShort:'+10 USD', swapShortClass:'positive', swap3Day:'Wednesday',
    },
    'XTIUSD': {
        icon: '✺', iconColor: '#e8a045', name: 'WTI Oil', fullName: 'WTI Crude Oil',
        digits: 2, tick_size: 0.01, tick_value: 10.0, contract_size: 1000, marginPerLot: 909,
        watchlistTab: 'energy', inPopular: false, inTradePanel: false,
        schedule: { sun:'—', mon:'01:02 - 23:53', tue:'01:02 - 23:53', wed:'01:02 - 23:53', thu:'01:02 - 23:53', fri:'01:02 - 23:45', sat:'—' },
        lotSize:'1,000 barrels', tickSizeStr:'0.01', minLot:'0.01 lot', maxLot:'20.00 lot', pipSize:'0.01 (2 digits)', stopLevel:'0',
        spread:'유동 스프레드', spreadPips:'~4 pips', swapLong:'-28 USD', swapLongClass:'negative', swapShort:'+8 USD', swapShortClass:'positive', swap3Day:'Wednesday',
    },
};

// ============================================================
// ★★★ 아래는 자동 생성 — 수정하지 마세요 ★★★
// ============================================================
window.SYMBOL_SPECS = {};
Object.keys(window.SYMBOL_CONFIG).forEach(function(sym) {
    var cfg = window.SYMBOL_CONFIG[sym];
    window.SYMBOL_SPECS[sym] = {
        tick_size: cfg.tick_size, tick_value: cfg.tick_value,
        contract_size: cfg.contract_size, digits: cfg.digits
    };
});
window.SYMBOL_LIST = Object.keys(window.SYMBOL_CONFIG);
window.TRADE_PANEL_SYMBOLS = Object.keys(window.SYMBOL_CONFIG).filter(function(sym) {
    return window.SYMBOL_CONFIG[sym].inTradePanel;
});
window.SYMBOL_MARGIN_PER_LOT = {};
Object.keys(window.SYMBOL_CONFIG).forEach(function(sym) {
    window.SYMBOL_MARGIN_PER_LOT[sym] = window.SYMBOL_CONFIG[sym].marginPerLot || 300;
});

console.log('[SymbolConfig] ✅ 로드 완료 — ' + window.SYMBOL_LIST.length + '개 심볼: ' + window.SYMBOL_LIST.join(', '));

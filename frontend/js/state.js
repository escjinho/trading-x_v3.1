// ========== 전역 변수 ==========
let chart = null;
let candleSeries = null;
let bbUpperSeries = null;
let bbMiddleSeries = null;
let bbLowerSeries = null;
let lwmaSeries = null;
let currentTimeframe = 'M1';
let currentSymbol = 'BTCUSD';
let chartSymbol = 'BTCUSD';
let currentMode = 'basic';
let targetAmount = 100;
let leverage = 5;
let lotSize = 0.10;
let martinLevel = 3;
let martinEnabled = false;
let martinStep = 1;
let martinAccumulatedLoss = 0;
let hasPosition = false;
let positionData = null;
let positionStartTime = null;
let positionTimer = null;
let balance = 10000;
let todayPL = 0;
let martinHistory = [];
let pendingLoss = 0;
let isClosing = false;  // 청산 중복 방지 플래그

// 게이지 애니메이션 변수
let displayScore = 50;
let targetScore = 50;
let baseScore = 50;
let velocity = 0;

// 차트 게이지 변수
let chartDisplayScore = 50;
let chartTargetScore = 50;
let chartVelocity = 0;

const symbolData = {
    'BTCUSD': { name: 'Bitcoin', icon: '₿', color: '#f7931a', desc: 'Bitcoin | Spread: ~$11' },
    'EURUSD.r': { name: 'Euro/Dollar', icon: '€', color: '#0052cc', desc: 'Euro/Dollar | Spread: ~$2' },
    'USDJPY.r': { name: 'Dollar/Yen', icon: '¥', color: '#dc143c', desc: 'Dollar/Yen | Spread: ~$3' },
    'XAUUSD.r': { name: 'Gold', icon: '✦', color: '#ffd700', desc: 'Gold | Spread: ~$8' },
    'US100.': { name: 'NASDAQ', icon: '⬡', color: '#00b450', desc: 'NASDAQ | Spread: ~$5' }
};

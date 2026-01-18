// 왓치리스트 초기화
// 브라우저 뒤로가기 지원
window.addEventListener('popstate', function(event) {
    const chartDetail = document.getElementById('chartDetailContainer');
    if (chartDetail && chartDetail.style.display !== 'none') {
        backToWatchlist();
    }
});

// 차트에서 종목 열 때 마지막 종목 저장 (네비게이션 연동)
const originalOpenChartFromWatchlist = openChartFromWatchlist;
openChartFromWatchlist = function(symbol, name, icon, color) {
    localStorage.setItem('last_chart_symbol', symbol);
    originalOpenChartFromWatchlist(symbol, name, icon, color);
};

// 10초마다 시세 업데이트 (데모용)
setInterval(() => {
    const watchlistContainer = document.getElementById('watchlistContainer');
    if (watchlistContainer && watchlistContainer.style.display !== 'none') {
        // 랜덤 변동 시뮬레이션 (실제 API 연동 전)
        Object.keys(demoQuotes).forEach(symbol => {
            const quote = demoQuotes[symbol];
            const variation = (Math.random() - 0.5) * 0.001;
            quote.bid = quote.bid * (1 + variation);
            quote.ask = quote.bid + (quote.ask - quote.bid);
            quote.change = quote.change + (Math.random() - 0.5) * 0.1;
        });
        renderWatchlist();
    }
}, 10000);

// 차트 모듈 초기화
if (typeof initChartModule === 'function') {
    initChartModule();
}

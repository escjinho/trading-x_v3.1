// ========== 왓치리스트 ==========
let watchlistPrices = {};
let currentWatchlistTab = 'popular';

// 즐겨찾기 localStorage에서 불러오기 (종목 정보 전체 저장)
function loadFavorites() {
    const saved = localStorage.getItem('watchlist_favorites_v2');
    if (saved) {
        return JSON.parse(saved);
    }
    // 기본 즐겨찾기
    return [
        { symbol: 'BTCUSD', name: 'BTCUSD', fullName: 'Bitcoin vs US Dollar', icon: '₿', color: '#f7931a' },
        { symbol: 'XAUUSD.r', name: 'XAUUSD', fullName: 'Gold vs US Dollar', icon: '✦', color: '#ffd700' }
    ];
}

function saveFavorites(favorites) {
    localStorage.setItem('watchlist_favorites_v2', JSON.stringify(favorites));
}

let favoriteSymbols = loadFavorites();

// 즐겨찾기 여부 확인
function isFavorite(symbol) {
    return favoriteSymbols.some(item => item.symbol === symbol);
}

const watchlistSymbols = {
    popular: [
        { symbol: 'BTCUSD', name: 'BTCUSD', fullName: 'Bitcoin vs US Dollar', icon: '₿', color: '#f7931a' },
        { symbol: 'EURUSD.r', name: 'EURUSD.r', fullName: 'Euro vs US Dollar', icon: '€', color: '#0052cc' },
        { symbol: 'USDJPY.r', name: 'USDJPY.r', fullName: 'Dollar vs Japanese Yen', icon: '¥', color: '#dc143c' },
        { symbol: 'XAUUSD.r', name: 'XAUUSD.r', fullName: 'Gold vs US Dollar', icon: '✦', color: '#ffd700' },
        { symbol: 'US100.', name: 'US100.', fullName: 'Nasdaq 100 Index', icon: '⬡', color: '#00b450' }
    ],
    forex: [
        { symbol: 'EURUSD.r', name: 'EURUSD.r', fullName: 'Euro vs US Dollar', icon: '€', color: '#0052cc' },
        { symbol: 'USDJPY.r', name: 'USDJPY.r', fullName: 'Dollar vs Japanese Yen', icon: '¥', color: '#dc143c' },
        { symbol: 'GBPUSD.r', name: 'GBPUSD.r', fullName: 'Pound vs US Dollar', icon: '£', color: '#9c27b0' },
        { symbol: 'AUDUSD.r', name: 'AUDUSD.r', fullName: 'Australian vs US Dollar', icon: 'A$', color: '#00875a' },
        { symbol: 'USDCAD.r', name: 'USDCAD.r', fullName: 'US Dollar vs Canadian', icon: 'C$', color: '#ff5722' }
    ],
    crypto: [
        { symbol: 'BTCUSD', name: 'BTCUSD', fullName: 'Bitcoin vs US Dollar', icon: '₿', color: '#f7931a' },
        { symbol: 'ETHUSD', name: 'ETHUSD', fullName: 'Ethereum vs US Dollar', icon: 'Ξ', color: '#627eea' }
    ],
    indices: [
        { symbol: 'US100.', name: 'US100.', fullName: 'Nasdaq 100 Index', icon: '⬡', color: '#00b450' },
        { symbol: 'US500.', name: 'US500.', fullName: 'S&P 500 Index', icon: '◆', color: '#1976d2' },
        { symbol: 'US30.', name: 'US30.', fullName: 'Dow Jones Index', icon: '◈', color: '#ff9800' }
    ],
    metals: [
        { symbol: 'XAUUSD.r', name: 'XAUUSD.r', fullName: 'Gold vs US Dollar', icon: '✦', color: '#ffd700' },
        { symbol: 'XAGUSD.r', name: 'XAGUSD.r', fullName: 'Silver vs US Dollar', icon: '✦', color: '#c0c0c0' }
    ],
    energy: [
        { symbol: 'XBRUSD', name: 'XBRUSD', fullName: 'Brent Crude Oil', icon: '🛢', color: '#795548' },
        { symbol: 'XTIUSD', name: 'XTIUSD', fullName: 'WTI Crude Oil', icon: '🛢', color: '#5d4037' }
    ]
};

// 즐겨찾기 목록 - 저장된 전체 정보 반환
function getFavoritesWatchlist() {
    return favoriteSymbols;
}

// 즐겨찾기 토글 (왓치리스트에서)
function toggleFavorite(symbol, event) {
    event.stopPropagation();

    const index = favoriteSymbols.findIndex(item => item.symbol === symbol);
    if (index > -1) {
        // 제거
        favoriteSymbols.splice(index, 1);
        showToast(`${symbol} 즐겨찾기에서 제거됨`, '');
    } else {
        // 추가 - watchlistSymbols에서 정보 찾기
        const allSymbols = [
            ...watchlistSymbols.popular,
            ...watchlistSymbols.forex,
            ...watchlistSymbols.crypto,
            ...watchlistSymbols.indices,
            ...watchlistSymbols.metals,
            ...watchlistSymbols.energy
        ];
        const found = allSymbols.find(item => item.symbol === symbol);
        if (found) {
            favoriteSymbols.push(found);
            showToast(`⭐ ${symbol} 즐겨찾기 추가!`, 'success');
        }
    }

    saveFavorites(favoriteSymbols);
    renderWatchlist();
}

// 검색에서 즐겨찾기 추가 (종목 정보 전체 저장)
function addToFavorites(symbol, name, icon, color, event) {
    event.stopPropagation();

    if (!isFavorite(symbol)) {
        // 종목 정보 전체 저장
        favoriteSymbols.push({
            symbol: symbol,
            name: symbol.replace('.r', '').replace('.', ''),
            fullName: name,
            icon: icon,
            color: color
        });
        saveFavorites(favoriteSymbols);
        showToast(`⭐ ${symbol} 즐겨찾기 추가!`, 'success');

        // 버튼 상태 변경
        const btn = event.target.closest('.search-add-btn');
        if (btn) {
            btn.classList.add('added');
            btn.textContent = '✓';
        }
    } else {
        showToast(`${symbol}은(는) 이미 즐겨찾기에 있습니다`, '');
    }
}

// 임시 시세 데이터 (API 연동 전)
const demoQuotes = {
    'BTCUSD': { bid: 104250.50, ask: 104265.50, change: 2.35 },
    'EURUSD.r': { bid: 1.08542, ask: 1.08562, change: -0.12 },
    'USDJPY.r': { bid: 157.852, ask: 157.872, change: 0.45 },
    'XAUUSD.r': { bid: 2658.50, ask: 2659.00, change: 1.28 },
    'US100.': { bid: 21542.50, ask: 21545.50, change: 0.85 }
};

function showWatchlist() {
    document.getElementById('watchlistContainer').style.display = 'flex';
    document.getElementById('chartDetailContainer').style.display = 'none';
}

function showChartDetail() {
    document.getElementById('watchlistContainer').style.display = 'none';
    document.getElementById('chartDetailContainer').style.display = 'block';
}

function switchWatchlistTab(tab) {
    currentWatchlistTab = tab;

    // 모든 탭 비활성화 후 선택된 탭만 활성화
    document.querySelectorAll('.watchlist-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });

    renderWatchlist();
}

function renderWatchlist() {
    const container = document.getElementById('watchlistContent');
    if (!container) return;

    // favorites 탭은 동적으로 생성
    const symbols = currentWatchlistTab === 'favorites'
        ? getFavoritesWatchlist()
        : (watchlistSymbols[currentWatchlistTab] || []);

    if (symbols.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                <span class="material-icons-round" style="font-size: 48px; opacity: 0.5;">star_border</span>
                <p style="margin-top: 10px;">${currentWatchlistTab === 'favorites' ? '즐겨찾기가 비어있습니다' : '종목이 없습니다'}</p>
                <p style="font-size: 12px; margin-top: 5px;">🔍 검색에서 종목을 추가해보세요</p>
            </div>
        `;
        return;
    }

    let html = '';
    symbols.forEach(item => {
        const prices = watchlistPrices[item.symbol] || demoQuotes[item.symbol] || { bid: 0, ask: 0, change: 0 };
        const decimals = getDecimalsForSymbol(item.symbol);
        const changeClass = prices.change >= 0 ? 'up' : 'down';
        const changeSign = prices.change >= 0 ? '+' : '';
        const isFav = isFavorite(item.symbol);
        const starClass = isFav ? 'active' : '';
        const starIcon = isFav ? '⭐' : '☆';

        html += `
            <div class="watchlist-item" onclick="openChartFromWatchlist('${item.symbol}', '${item.name}', '${item.icon}', '${item.color}')">
                <div class="watchlist-icon" style="color: ${item.color};">${item.icon}</div>
                <div class="watchlist-info">
                    <div class="watchlist-symbol">${item.name}</div>
                    <div class="watchlist-name">${item.fullName}</div>
                </div>
                <button class="watchlist-favorite ${starClass}" onclick="toggleFavorite('${item.symbol}', event)">${starIcon}</button>
                <div class="watchlist-price-row">
                    <div class="watchlist-bid-box">
                        <span class="watchlist-box-label">매도</span>
                        <span class="watchlist-box-price">${prices.bid.toFixed(decimals)}</span>
                    </div>
                    <span class="watchlist-change-center ${changeClass}">${changeSign}${prices.change.toFixed(2)}%</span>
                    <div class="watchlist-ask-box">
                        <span class="watchlist-box-label">매수</span>
                        <span class="watchlist-box-price">${prices.ask.toFixed(decimals)}</span>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function openChartFromWatchlist(symbol, name, icon, color) {
    chartSymbol = symbol;

    document.getElementById('chartSymbolIcon').textContent = icon;
    document.getElementById('chartSymbolIcon').style.color = color;
    document.getElementById('chartSymbolName').textContent = name;
    document.getElementById('chartSymbolId').textContent = symbol;

    showChartDetail();

    // 히스토리에 상태 추가 (브라우저 뒤로가기 지원)
    history.pushState({ view: 'chart-detail', symbol: symbol }, '', `#chart/${symbol}`);

    if (chart) {
        chart.remove();
        chart = null;
    }
    initChart();
    loadCandles();
    
    // 종목 정보 섹션 업데이트
    if (typeof SymbolSelectorPanel !== 'undefined' && SymbolSelectorPanel.updateSymbolInfoSection) {
        SymbolSelectorPanel.updateSymbolInfoSection(symbol);
    }
    
    // 즐겨찾기 아이콘 상태 업데이트 (DOM 렌더링 후)
    setTimeout(() => {
        updateZmFavoriteIcon();
    }, 100);
}

function backToWatchlist() {
    showWatchlist();
    renderWatchlist();
}

// ========== 종목 검색 ==========
let searchResults = [];
let searchCategory = 'all';
let searchTimeout = null;

function openSymbolSearch() {
    document.getElementById('symbolSearchModal').classList.add('show');
    document.getElementById('symbolSearchInput').value = '';
    document.getElementById('symbolSearchInput').focus();

    // 초기 상태 표시
    document.getElementById('symbolSearchResults').innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
            <span class="material-icons-round" style="font-size: 48px; opacity: 0.5;">search</span>
            <p style="margin-top: 10px;">종목명 또는 심볼을 입력하세요</p>
        </div>
    `;
}

function closeSymbolSearch() {
    document.getElementById('symbolSearchModal').classList.remove('show');
}

function onSymbolSearch(query) {
    // 디바운스 처리 (300ms)
    clearTimeout(searchTimeout);

    if (query.length < 1) {
        document.getElementById('symbolSearchResults').innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                <span class="material-icons-round" style="font-size: 48px; opacity: 0.5;">search</span>
                <p style="margin-top: 10px;">종목명 또는 심볼을 입력하세요</p>
            </div>
        `;
        return;
    }

    searchTimeout = setTimeout(() => {
        performSymbolSearch(query);
    }, 300);
}

async function performSymbolSearch(query) {
    document.getElementById('symbolSearchLoading').style.display = 'block';
    document.getElementById('symbolSearchResults').innerHTML = '';

    try {
        const response = await fetch(`${API_URL}/mt5/symbols/search?query=${encodeURIComponent(query)}`);
        const data = await response.json();

        document.getElementById('symbolSearchLoading').style.display = 'none';

        if (data.success && data.symbols.length > 0) {
            searchResults = data.symbols;
            renderSearchResults();
        } else {
            document.getElementById('symbolSearchResults').innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                    <span class="material-icons-round" style="font-size: 48px; opacity: 0.5;">search_off</span>
                    <p style="margin-top: 10px;">"${query}"에 대한 검색 결과가 없습니다</p>
                </div>
            `;
        }
    } catch (error) {
        document.getElementById('symbolSearchLoading').style.display = 'none';
        document.getElementById('symbolSearchResults').innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--sell-color);">
                <span class="material-icons-round" style="font-size: 48px; opacity: 0.5;">error</span>
                <p style="margin-top: 10px;">검색 중 오류가 발생했습니다</p>
            </div>
        `;
    }
}

function filterSearchCategory(category) {
    searchCategory = category;

    // 버튼 활성화 상태 변경
    document.querySelectorAll('.search-category-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === category);
    });

    renderSearchResults();
}

function renderSearchResults() {
    const container = document.getElementById('symbolSearchResults');

    // 카테고리 필터링
    let filtered = searchResults;
    if (searchCategory !== 'all') {
        filtered = searchResults.filter(item => item.category === searchCategory);
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                <p>해당 카테고리에 검색 결과가 없습니다</p>
            </div>
        `;
        return;
    }

    let html = '';
    filtered.forEach(item => {
        const isFav = isFavorite(item.symbol);
        const btnClass = isFav ? 'added' : '';
        const btnText = isFav ? '✓' : '+';

        html += `
            <div class="search-result-item" onclick="selectSearchSymbol('${item.symbol}', '${item.name}', '${item.icon}', '${item.color}')">
                <div class="search-result-icon" style="color: ${item.color};">${item.icon}</div>
                <div class="search-result-info">
                    <div class="search-result-symbol">${item.symbol}</div>
                    <div class="search-result-name">${item.name}</div>
                </div>
                <span class="search-result-category">${item.category}</span>
                <button class="search-add-btn ${btnClass}" onclick="addToFavorites('${item.symbol}', '${item.name}', '${item.icon}', '${item.color}', event)">${btnText}</button>
            </div>
        `;
    });

    container.innerHTML = html;
}

function selectSearchSymbol(symbol, name, icon, color) {
    // 검색 모달 닫기
    closeSymbolSearch();

    // 심볼 정보 업데이트
    chartSymbol = symbol;
    document.getElementById('chartSymbolIcon').textContent = icon;
    document.getElementById('chartSymbolIcon').style.color = color;
    document.getElementById('chartSymbolName').textContent = name.split(' ')[0] || symbol;
    document.getElementById('chartSymbolId').textContent = symbol;

    // 차트 화면으로 이동
    showChartDetail();

    // 히스토리에 상태 추가
    history.pushState({ view: 'chart-detail', symbol: symbol }, '', `#chart/${symbol}`);

    // 차트 로드
    if (chart) {
        chart.remove();
        chart = null;
    }
    initChart();
    loadCandles();
    
    // 종목 정보 섹션 업데이트
    if (typeof SymbolSelectorPanel !== 'undefined' && SymbolSelectorPanel.updateSymbolInfoSection) {
        SymbolSelectorPanel.updateSymbolInfoSection(symbol);
    }

    showToast(`${symbol} 차트를 로드합니다`, 'success');
}

// 왓치리스트 실시간 시세 업데이트
function updateWatchlistPricesFromData(allPrices) {
    if (!allPrices) return;

    Object.keys(allPrices).forEach(symbol => {
        const price = allPrices[symbol];
        if (price) {
            const prevPrice = watchlistPrices[symbol]?.bid || price.bid;
            const change = prevPrice > 0 ? ((price.bid - prevPrice) / prevPrice) * 100 : 0;
            watchlistPrices[symbol] = {
                bid: price.bid,
                ask: price.ask,
                change: change
            };
        }
    });

    // 왓치리스트가 보이면 다시 렌더링
    const watchlistContainer = document.getElementById('watchlistContainer');
    if (watchlistContainer && watchlistContainer.style.display !== 'none') {
        renderWatchlist();
    }
}

// ========== 제로마켓 스타일 하단 바 함수 ==========

// 더보기 메뉴
function openZmMoreMenu() {
    document.getElementById('zmMoreSheet').classList.add('active');
}

function closeZmMoreMenu() {
    document.getElementById('zmMoreSheet').classList.remove('active');
}

// 타임프레임 메뉴
function openZmTimeframe() {
    document.getElementById('zmTfSheet').classList.add('active');
}

function closeZmTimeframe() {
    document.getElementById('zmTfSheet').classList.remove('active');
}

function selectZmTimeframe(tf) {
    // 버튼 텍스트 업데이트
    document.getElementById('zmTfText').textContent = tf;

    // 활성 버튼 스타일 변경 (기존 + 새 클래스 모두 지원)
    document.querySelectorAll('.zm-tf-item, .zm-center-tf-item').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent === tf) {
            btn.classList.add('active');
        }
    });

    // 타임프레임 형식 변환 (UI → API)
    const tfMap = {
        '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30',
        '1H': 'H1', '4H': 'H4', '1D': 'D1', '1W': 'W1', 'MN': 'MN1'
    };
    const apiTimeframe = tfMap[tf] || tf;

    // 전역 타임프레임 변수 업데이트
    currentTimeframe = apiTimeframe;
    console.log('[Timeframe] Changed to:', apiTimeframe);

    // 차트 데이터 새로 로드
    if (typeof ChartPanel !== 'undefined' && ChartPanel.loadCandles) {
        ChartPanel.loadCandles();
    } else if (typeof loadCandles === 'function') {
        loadCandles();
    }

    closeZmTimeframe();
}

// 매도/매수 버튼
function openSellOrder() {
    // Trading 탭으로 이동하거나 주문 모달 열기
    console.log('매도 주문');
    // TODO: 실제 매도 로직 연결
}

function openBuyOrder() {
    // Trading 탭으로 이동하거나 주문 모달 열기
    console.log('매수 주문');
    // TODO: 실제 매수 로직 연결
}

// 더보기 메뉴 항목들
function openDrawingTools() {
    closeZmMoreMenu();
    console.log('추세선 그리기');
    // TODO: 추세선 기능 연결
}

function openIndicators() {
    closeZmMoreMenu();
    console.log('보조지표');
    // TODO: 보조지표 기능 연결
}

function openChartType() {
    closeZmMoreMenu();
    console.log('차트 종류');
    // TODO: 차트 종류 기능 연결
}

// ========== 제로마켓 상단 아이콘 함수 ==========

// 즐겨찾기 토글 (상단 아이콘용 - 종목목록과 연동)
function zmToggleFavorite() {
    const icon = document.getElementById('zmFavoriteIcon');
    const currentSymbol = document.getElementById('chartSymbolId')?.textContent || 'BTCUSD';
    
    // 기존 isFavorite 함수 사용
    if (isFavorite(currentSymbol)) {
        // 즐겨찾기에서 제거
        const index = favoriteSymbols.findIndex(item => item.symbol === currentSymbol);
        if (index > -1) {
            favoriteSymbols.splice(index, 1);
        }
        icon.textContent = 'star_border';
        icon.style.color = '';
        showToast(currentSymbol + ' 즐겨찾기에서 제거됨', '');
    } else {
        // 즐겨찾기에 추가 - 현재 차트의 정보 가져오기
        const chartIcon = document.getElementById('chartSymbolIcon')?.textContent || '₿';
        const chartColor = document.getElementById('chartSymbolIcon')?.style.color || '#f7931a';
        const chartName = document.getElementById('chartSymbolName')?.textContent || currentSymbol;
        
        favoriteSymbols.push({
            symbol: currentSymbol,
            name: currentSymbol,
            fullName: chartName,
            icon: chartIcon,
            color: chartColor
        });
        
        icon.textContent = 'star';
        icon.style.color = '#00b894';
        showToast('⭐ ' + currentSymbol + ' 즐겨찾기 추가!', 'success');
    }
    
    // localStorage에 저장 (기존 함수 사용)
    saveFavorites(favoriteSymbols);
    
    // 왓치리스트 새로고침
    renderWatchlist();
}

// 차트 종목 변경 시 즐겨찾기 아이콘 상태 업데이트
function updateZmFavoriteIcon() {
    const icon = document.getElementById('zmFavoriteIcon');
    const currentSymbol = document.getElementById('chartSymbolId')?.textContent || 'BTCUSD';
    
    if (!icon) return;
    
    // 기존 isFavorite 함수 사용
    if (isFavorite(currentSymbol)) {
        icon.textContent = 'star';
        icon.style.color = '#00b894';
    } else {
        icon.textContent = 'star_border';
        icon.style.color = '';
    }
}

// 종목 정보 슬라이드 패널 열기
function zmOpenSymbolInfo() {
    const panel = document.getElementById('zmInfoPanel');
    const body = document.getElementById('zmInfoBody');
    const symbolInfoContent = document.getElementById('symbolInfoContent');
    
    if (panel && body && symbolInfoContent) {
        // 종목 정보 내용 복사
        body.innerHTML = symbolInfoContent.innerHTML;
        panel.classList.add('active');
    }
}

// 종목 정보 슬라이드 패널 닫기
function closeZmInfoPanel() {
    const panel = document.getElementById('zmInfoPanel');
    if (panel) {
        panel.classList.remove('active');
    }
}

// 차트 가로보기 (준비중)
function zmRotateScreen() {
    showToast('준비중입니다', '');
}

// Toast 메시지 (없으면 추가)
function showToast(message, type) {
    // 기존 토스트 제거
    const existingToast = document.querySelector('.zm-toast');
    if (existingToast) {
        existingToast.remove();
    }
    
    // 새 토스트 생성
    const toast = document.createElement('div');
    toast.className = 'zm-toast' + (type === 'success' ? ' success' : '');
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // 3초 후 제거
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// 돋보기 버튼 - 왓치리스트로 이동 (상단 아이콘용)
function zmOpenSearch() {
    const watchlistContainer = document.getElementById('watchlistContainer');
    const chartDetailContainer = document.getElementById('chartDetailContainer');
    
    if (watchlistContainer && chartDetailContainer) {
        watchlistContainer.style.display = 'block';
        chartDetailContainer.style.display = 'none';
        
        // 종목 리스트 즉시 렌더링
        if (typeof renderWatchlist === 'function') {
            renderWatchlist();
        } else if (typeof loadWatchlistSymbols === 'function') {
            loadWatchlistSymbols();
        } else if (typeof showWatchlist === 'function') {
            showWatchlist();
        }
    }
}

// 페이지 로드 시 즐겨찾기 아이콘 상태 업데이트
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        updateZmFavoriteIcon();
    }, 500);
});

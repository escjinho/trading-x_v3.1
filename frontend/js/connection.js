// ★★★ 프론트엔드 실시간 P/L 계산 (MetaAPI 캐시 지연 해소) ★★★
const SYMBOL_SPECS = {
    'BTCUSD':   { tick_size: 0.01,    tick_value: 0.01, contract_size: 1 },
    'ETHUSD':   { tick_size: 0.01,    tick_value: 0.01, contract_size: 1 },
    'XAUUSD.r': { tick_size: 0.01,    tick_value: 1.0,  contract_size: 100 },
    'EURUSD.r': { tick_size: 0.00001, tick_value: 1.0,  contract_size: 100000 },
    'USDJPY.r': { tick_size: 0.001,   tick_value: 0.67, contract_size: 100000 },
    'GBPUSD.r': { tick_size: 0.00001, tick_value: 1.0,  contract_size: 100000 },
    'AUDUSD.r': { tick_size: 0.00001, tick_value: 1.0,  contract_size: 100000 },
    'USDCAD.r': { tick_size: 0.00001, tick_value: 0.74, contract_size: 100000 },
    'US100.':   { tick_size: 0.01,    tick_value: 0.2,  contract_size: 20 }
};

// 마지막 MT5 검증 시간
let _lastMT5PLValidation = 0;

function calculateRealtimePL(position, allPrices) {
    if (!position || !allPrices) return null;

    const symbol = position.symbol;
    if (!symbol) return null;

    const priceData = allPrices[symbol];
    if (!priceData) return null;

    const entry = position.entry || position.openPrice || 0;
    const volume = position.volume || 0;
    if (entry <= 0 || volume <= 0) return null;

    // BUY는 bid로, SELL은 ask로 청산 가격 계산
    let posType = position.type || '';
    if (typeof posType === 'number') posType = posType === 0 ? 'BUY' : 'SELL';
    else if (typeof posType === 'string' && posType.includes('BUY')) posType = 'BUY';
    else posType = 'SELL';

    const currentPrice = posType === 'BUY' ? (priceData.bid || 0) : (priceData.ask || priceData.bid || 0);
    if (currentPrice <= 0) return null;

    const priceDiff = posType === 'BUY' ? (currentPrice - entry) : (entry - currentPrice);

    const specs = SYMBOL_SPECS[symbol];
    let profit;
    if (specs && specs.tick_size > 0) {
        const ticks = priceDiff / specs.tick_size;
        profit = ticks * specs.tick_value * volume;
    } else {
        // fallback: 스펙 없는 종목은 기존 MetaAPI 값 사용
        return null;
    }

    return Math.round(profit * 100) / 100; // 소수점 2자리 반올림
}

// ★ WS 데이터에 실시간 P/L 덮어쓰기 + 주기적 MT5 검증
function enrichPositionProfits(data) {
    if (!data || !data.all_prices) return;

    // 1. 메인 포지션 (magic=100001) P/L 실시간 계산
    if (data.position) {
        const calc = calculateRealtimePL(data.position, data.all_prices);
        if (calc !== null) {
            data.position._mt5Profit = data.position.profit; // MT5 원본 보존
            data.position.profit = calc;
        }
    }

    // 2. 전체 positions 배열 P/L 실시간 계산
    if (data.positions && Array.isArray(data.positions)) {
        data.positions.forEach(pos => {
            const calc = calculateRealtimePL(pos, data.all_prices);
            if (calc !== null) {
                pos._mt5Profit = pos.profit; // MT5 원본 보존
                pos.profit = calc;
            }
        });
    }

    // 3. Equity도 실시간 계산 (balance + 전체 포지션 profit 합산)
    if (data.balance !== undefined && data.positions && Array.isArray(data.positions)) {
        let totalProfit = 0;
        data.positions.forEach(pos => { totalProfit += pos.profit || 0; });
        // 메인 포지션이 positions에 없는 경우 별도 합산
        if (data.position && data.position.profit) {
            const inPositions = data.positions.some(p => p.id === data.position.ticket || p.ticket === data.position.ticket);
            if (!inPositions) {
                totalProfit += data.position.profit;
            }
        }
        data._realtimeEquity = data.balance + totalProfit;
    }

    // 4. 30초마다 MT5 값과 비교 검증 (로그만)
    const now = Date.now();
    if (now - _lastMT5PLValidation > 30000) {
        _lastMT5PLValidation = now;
        if (data.position && data.position._mt5Profit !== undefined) {
            const diff = Math.abs(data.position.profit - data.position._mt5Profit);
            if (diff > 1) {
                console.log(`[RealtimePL] ⚠️ MT5 차이: 실시간=${data.position.profit.toFixed(2)}, MT5=${data.position._mt5Profit.toFixed(2)}, 차이=${diff.toFixed(2)}`);
            } else {
                console.log(`[RealtimePL] ✅ MT5 일치: 실시간=${data.position.profit.toFixed(2)}, MT5=${data.position._mt5Profit.toFixed(2)}`);
            }
        }
    }
}

// ========== WebSocket ==========
let ws = null;
let wsRetryCount = 0;
const maxRetries = 5;
let pollingInterval = null;  // ★ 폴링 인터벌 저장용
let intentionalClose = false;  // ★ 의도적 종료 플래그 (재연결 방지)
let isPageVisible = true;  // ★ 페이지 가시성 상태
let lastWsMessageTime = 0;  // ★ 마지막 WS 메시지 수신 시간
let heartbeatTimer = null;  // ★ 하트비트 모니터 타이머
let wsConnectionStartTime = 0;  // ★ WS 연결 시작 시간 (가짜 이벤트 방지)
let _wsHasConnectedBefore = false;  // ★ 재연결 감지용 (최초 연결 vs 재연결 구분)
let _lastSoftRefreshAt = 0;  // ★★★ softRefresh 쿨다운용 타임스탬프 ★★★

// ★ 장 마감 체크 헬퍼 (MarketSchedule 우선 — 공휴일 포함)
function isCurrentMarketClosed() {
    // MarketSchedule 모듈 우선 (정확한 브로커 스케줄)
    if (typeof MarketSchedule !== 'undefined' && MarketSchedule.isMarketOpen) {
        return !MarketSchedule.isMarketOpen(chartSymbol);
    }
    // 폴백: 단순 주말 체크
    const _si = typeof getSymbolInfo === 'function' ? getSymbolInfo(chartSymbol) : null;
    const _isCrypto = _si && _si.category === 'Crypto Currency';
    if (_isCrypto) return false;
    const _now = new Date();
    const _day = _now.getUTCDay();
    const _hour = _now.getUTCHours();
    if (_day === 6) return true;
    if (_day === 0 && _hour < 22) return true;
    if (_day === 5 && _hour >= 22) return true;
    return false;
}

// ★★★ softRefresh() — 화면 전환/이벤트 시 페이지 리로드 없이 데이터만 갱신 ★★★
async function softRefresh(reason = '') {
    // 3초 쿨다운 (스팸 방지)
    const now = Date.now();
    if (now - _lastSoftRefreshAt < 3000) {
        console.log(`[softRefresh] ⏳ 쿨다운 중 (${Math.round((3000 - (now - _lastSoftRefreshAt)) / 1000)}초 남음)`);
        return;
    }
    _lastSoftRefreshAt = now;
    console.log(`[softRefresh] 🔄 실행 - reason: ${reason || 'manual'}`);

    try {
        // 1. 계정 데이터 새로고침
        if (isDemo) {
            if (typeof fetchDemoData === 'function') {
                await fetchDemoData();
            }
        } else {
            if (typeof fetchAccountData === 'function') {
                await fetchAccountData();
            }
        }

        // 2. MetaAPI 상태 확인 (라이브 모드만)
        if (!isDemo && typeof checkMetaAPIStatus === 'function') {
            checkMetaAPIStatus();
        }

        // 3. 거래 내역 새로고침
        if (typeof loadHistory === 'function') {
            loadHistory();
        }

        // 4. Today P/L 동기화
        if (typeof syncTradeTodayPL === 'function') {
            syncTradeTodayPL();
        }

        // 5. 차트 캔들 리로드 (★ 타임프레임 변경 중이 아닐 때만)
        if (typeof loadCandles === 'function' && !window._isChangingTimeframe) {
            loadCandles();
        }

        // 6. 인디케이터 강제 업데이트 (다음 WS 메시지에서 즉시 반영되도록)
        window.lastIndicatorUpdate = 0;

        console.log(`[softRefresh] ✅ 완료`);
    } catch (e) {
        console.error('[softRefresh] ❌ 에러:', e);
    }
}

// 전역 접근 가능하도록
window.softRefresh = softRefresh;

// ★★★ 페이지 가시성 변경 핸들러 (모바일 앱 전환 대응) ★★★
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        // 백그라운드로 갔을 때 - WS 유지, 재연결 안 함
        isPageVisible = false;
        window._backgroundAt = Date.now();
        console.log('[Visibility] 백그라운드로 전환');
    } else {
        // 포그라운드로 돌아왔을 때
        isPageVisible = true;
        const _bgDuration = window._backgroundAt ? (Date.now() - window._backgroundAt) : 0;
        console.log(`[Visibility] 포그라운드로 복귀 (백그라운드 ${Math.round(_bgDuration/1000)}초)`);

        // 60초 이상 백그라운드였으면 전체 리로드
        if (_bgDuration > 60000) {
            console.log('[Visibility] 🔄 60초 이상 백그라운드 — 전체 리로드');
            location.reload();
            return;
        }

        // WS가 끊어져 있으면 재연결
        if (!ws || (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING)) {
            console.log('[Visibility] WS 재연결 필요');
            reconnectAttempt = 0;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            connectWebSocket();
        } else if (ws && ws.readyState === WebSocket.OPEN) {
            // ★★★ WS 연결 유지 중이라도 — softRefresh로 데이터 갱신 ★★★
            console.log('[Visibility] WS 연결됨 — softRefresh 실행');
            softRefresh('visibility_foreground');
        }
    }
});

// ★★★ 시그널 게이지 + 인디케이터 1~3초 랜덤 업데이트 ★★★
let _pendingIndicator = { buy: 33, sell: 33, neutral: 34 };
let _indicatorTimerId = null;

function queueIndicatorUpdate(buy, sell, neutral) {
    // WS에서 받은 값을 저장
    _pendingIndicator = {
        buy: buy || 33,
        sell: sell || 33,
        neutral: neutral || 34
    };
    console.log('[Indicator] 큐에 저장:', _pendingIndicator);

    // 타이머가 없으면 시작
    if (!_indicatorTimerId) {
        console.log('[Indicator] 타이머 시작');
        scheduleIndicatorUpdate();
    }
}

function scheduleIndicatorUpdate() {
    // 1~3초 랜덤 간격
    const delay = Math.random() * 2000 + 1000;

    _indicatorTimerId = setTimeout(() => {
        _indicatorTimerId = null;

        const { buy, sell, neutral } = _pendingIndicator;
        console.log(`[Indicator] 업데이트 실행: Buy=${buy}, Sell=${sell}, Neutral=${neutral}`);

        // 인디케이터 숫자 업데이트
        const indSell = document.getElementById('indSell');
        const indNeutral = document.getElementById('indNeutral');
        const indBuy = document.getElementById('indBuy');
        const chartIndSell = document.getElementById('chartIndSell');
        const chartIndNeutral = document.getElementById('chartIndNeutral');
        const chartIndBuy = document.getElementById('chartIndBuy');

        if (indSell) indSell.textContent = sell;
        if (indNeutral) indNeutral.textContent = neutral;
        if (indBuy) indBuy.textContent = buy;
        if (chartIndSell) chartIndSell.textContent = sell;
        if (chartIndNeutral) chartIndNeutral.textContent = neutral;
        if (chartIndBuy) chartIndBuy.textContent = buy;

        // 시그널 게이지 업데이트 + 애니메이션 시작
        if (typeof GaugePanel !== 'undefined' && GaugePanel.updateGauge) {
            console.log('[Indicator] GaugePanel.updateGauge 호출, animationFrameId:', GaugePanel.animationFrameId);
            GaugePanel.updateGauge(buy, sell, neutral);
            // ★ 애니메이션이 멈췄으면 다시 시작
            if (!GaugePanel.animationFrameId && GaugePanel.startAnimation) {
                console.log('[Indicator] GaugePanel 애니메이션 재시작');
                GaugePanel.startAnimation();
            }
        } else {
            console.log('[Indicator] GaugePanel 없음:', typeof GaugePanel);
        }
        if (typeof ChartGaugePanel !== 'undefined' && ChartGaugePanel.updateGauge) {
            ChartGaugePanel.updateGauge(buy, sell, neutral);
            if (!ChartGaugePanel.animationFrameId && ChartGaugePanel.startAnimation) {
                ChartGaugePanel.startAnimation();
            }
        }

        // 다음 업데이트 예약
        scheduleIndicatorUpdate();
    }, delay);
}
// ★★★ 시그널 게이지 + 인디케이터 끝 ★★★

// ========== WebSocket 자동 재연결 (지수 백오프, 무제한 재시도) ==========
// 재연결 간격: 3초 → 6초 → 12초 → 24초 → 30초 (최대)
const WS_RECONNECT_BASE = 3000;  // 3초 시작
const WS_RECONNECT_MAX = 10000;  // 최대 10초 (서버 복구 시 빠른 재연결)
let reconnectAttempt = 0;
let reconnectTimer = null;

function getReconnectDelay() {
    // 지수 백오프: 3초 * 2^attempt, 최대 30초
    const delay = Math.min(WS_RECONNECT_BASE * Math.pow(2, reconnectAttempt), WS_RECONNECT_MAX);
    return delay;
}

// ★★★ 하트비트 모니터: 10초간 WS 메시지 없으면 좀비 연결 감지 → 강제 재연결 ★★★
function startHeartbeatMonitor() {
    stopHeartbeatMonitor();  // 기존 타이머 정리

    heartbeatTimer = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            stopHeartbeatMonitor();
            return;
        }

        const elapsed = Date.now() - lastWsMessageTime;

        if (elapsed > 10000) {
            // 10초 동안 메시지 없음 = 좀비 연결
            console.warn(`[WS] ⚠️ 하트비트 타임아웃 (${Math.round(elapsed/1000)}초 무응답) → 강제 재연결`);
            stopHeartbeatMonitor();

            // 좀비 연결 강제 종료
            try {
                ws.onclose = null;  // 중복 재연결 방지
                ws.onerror = null;
                ws.close();
            } catch (e) {}

            ws = null;
            window.wsConnected = false;
            updateConnectionStatus('disconnected');

            // 즉시 재연결 (백오프 리셋)
            reconnectAttempt = 0;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            reconnectWithBackoff();

        } else if (elapsed > 5000) {
            // 5초 경과 - 경고 로그만
            console.log(`[WS] 하트비트: ${Math.round(elapsed/1000)}초 경과 (10초 후 재연결)`);
        }
    }, 3000);  // 3초마다 체크
}

function stopHeartbeatMonitor() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

function reconnectWithBackoff() {
    // ★ 의도적 종료면 재연결 안 함
    if (intentionalClose) {
        console.log('[WS] Intentional close - skipping reconnect');
        return;
    }

    // ★ 페이지가 백그라운드면 재연결 안 함 (포그라운드 복귀 시 재연결)
    if (!isPageVisible) {
        console.log('[WS] Page hidden - skipping reconnect');
        return;
    }

    const delay = getReconnectDelay();
    console.log(`[WS] 재연결 시도 ${reconnectAttempt + 1} - ${delay/1000}초 후`);

    // UI 상태: Reconnecting...
    updateConnectionStatus('reconnecting', delay);

    reconnectTimer = setTimeout(() => {
        reconnectAttempt++;
        connectWebSocket();
    }, delay);
}

// 연결 상태 업데이트 헬퍼 함수
function updateConnectionStatus(status, delay = 0) {
    const statusDot = document.getElementById('statusDot');
    const headerStatus = document.getElementById('headerStatus');

    if (status === 'disconnected') {
        if (statusDot) statusDot.classList.add('disconnected');
        if (headerStatus) headerStatus.textContent = 'Disconnected';
    } else if (status === 'connected') {
        if (statusDot) statusDot.classList.remove('disconnected');
        if (headerStatus) headerStatus.textContent = 'Connected';
    } else if (status === 'reconnecting') {
        if (statusDot) statusDot.classList.add('disconnected');
        if (headerStatus) headerStatus.textContent = `Reconnecting... (${Math.round(delay/1000)}s)`;
    }
}

// 재연결 시도 함수
function attemptReconnect() {
    // ★ 30초간 재연결 실패 시 페이지 리로드
    if (window._wsDisconnectedAt && (Date.now() - window._wsDisconnectedAt > 30000)) {
        console.log('[WS] ⚠️ 30초간 재연결 실패 — 페이지 리로드');
        location.reload();
        return;
    }

    console.log(`[WS] 연결 시도 (attempt ${reconnectAttempt + 1})`);

    try {
        connectWebSocket();
    } catch (e) {
        console.error('[WS] 연결 오류:', e);
        reconnectWithBackoff();
    }
}

// 테스트용 전역 함수
window.testDisconnect = function() {
    console.log('[TEST] 강제 연결 끊김 시뮬레이션');
    if (ws) ws.close();
};

window.manualReconnect = function() {
    console.log('[TEST] 수동 재연결');
    reconnectAttempt = 0;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    attemptReconnect();
};

window.getReconnectStatus = function() {
    return {
        attempt: reconnectAttempt,
        nextDelay: getReconnectDelay(),
        maxDelay: WS_RECONNECT_MAX
    };
};

function connectWebSocket() {
    // ★ 기존 WS 정리 (중복 연결 방지)
    stopHeartbeatMonitor();  // ★ 하트비트 정리
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log('[WS] 기존 연결 정리 중...');
        ws.onclose = null;  // onclose 핸들러 제거 (재연결 트리거 방지)
        ws.onerror = null;
        ws.close();
    }

    // Demo 모드와 Live 모드에 따라 다른 WebSocket URL 사용
    const wsPath = isDemo ? '/api/demo/ws' : '/api/mt5/ws';
    let wsUrl = typeof getWsUrl === 'function' ? getWsUrl(wsPath) : `ws://localhost:8000${wsPath}`;
    console.log(`[WS] Connecting to: ${wsUrl} (isDemo: ${isDemo})`);
    console.log(`[WS] getWsUrl defined: ${typeof getWsUrl === 'function'}`);
    // ★ Demo, Live 모두 토큰 + magic 추가
    if (token) {
        wsUrl += (wsUrl.includes("?") ? "&" : "?") + "token=" + token;
    }
    // ★★★ 현재 패널의 magic 넘버 전달 ★★★
    const currentMagic = typeof BUYSELL_MAGIC_NUMBER !== 'undefined' ? BUYSELL_MAGIC_NUMBER : 100001;
    wsUrl += (wsUrl.includes("?") ? "&" : "?") + "magic=" + currentMagic;
    ws = new WebSocket(wsUrl);
    
    ws.onopen = function() {
        console.log('WebSocket connected');
        window.wsConnected = true;  // ★ WS 연결 플래그 (폴링 깜빡임 방지)
        window._wsDisconnectedAt = null;  // ★ 재연결 성공 시 타이머 리셋
        document.getElementById('statusDot').classList.remove('disconnected');
        document.getElementById('headerStatus').textContent = 'Connected';
        wsRetryCount = 0;

        // ★★★ reconnectAttempt 저장 후 리셋 (순서 중요!) ★★★
        const _prevReconnectAttempt = reconnectAttempt;
        reconnectAttempt = 0; // 백오프 카운터 리셋
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        // ★ WebSocket 연결 성공 시 폴링 중지
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
            console.log('[WS] Polling stopped - WebSocket connected');
        }

        // ★★★ 재연결 감지 시 — 서버 다운 복구면 페이지 리로드, 아니면 softRefresh ★★★
        if (_wsHasConnectedBefore) {
            // 서버 다운 후 복구 감지 (2회 이상 재연결 시도 = 서버 다운이었음)
            if (_prevReconnectAttempt >= 2 || window._serverWasDown) {
                console.log(`[WS] 🔄 서버 복구 감지! (시도 ${_prevReconnectAttempt}회) 페이지 전체 리로드...`);
                window._serverWasDown = false;
                location.reload();
                return;
            }
            console.log(`[WS] 🔄 재연결 감지! (시도 ${_prevReconnectAttempt}회) softRefresh 실행...`);
            // ★★★ 라이브 포지션 플래그 초기화 (재연결 후 깨끗한 상태) ★★★
            window._closeConfirmedAt = null;
            window._userClosing = false;
            window._plGaugeFrozen = false;
            // softRefresh로 통합 (쿨다운 리셋하여 즉시 실행)
            _lastSoftRefreshAt = 0;
            setTimeout(() => softRefresh('ws_reconnect'), 300);
        }
        _wsHasConnectedBefore = true;

        // ★★★ 첫 연결 시 히스토리 즉시 로드 (Live 모드) ★★★
        if (!isDemo && typeof loadHistory === 'function') {
            console.log('[WS] 🔄 첫 연결 - 히스토리 로드 시작');
            setTimeout(() => loadHistory(), 500);
        }

        // ★★★ 하트비트 모니터 시작 ★★★
        lastWsMessageTime = Date.now();
        wsConnectionStartTime = Date.now();
        startHeartbeatMonitor();
    };

    ws.onmessage = function(event) {
        lastWsMessageTime = Date.now();  // ★ 하트비트 갱신

        const data = JSON.parse(event.data);

        // ★★★ 서버 ping에 pong 응답 ★★★
        if (data.type === 'ping') {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'pong', ts: data.ts }));
            }
            return;  // ping은 UI 업데이트 불필요
        }

        // ★ 디버깅 로그
        
        // ★ 즉시 호가 업데이트 (최상단에서 처리)
        if (data.all_prices && data.all_prices[chartSymbol]) {
            const price = data.all_prices[chartSymbol];
            const decimals = typeof getDecimalsForSymbol === "function" ? getDecimalsForSymbol(chartSymbol) : 2;
            const bidEl = document.getElementById("chartBid");
            const askEl = document.getElementById("chartAsk");
            if (bidEl) {
                bidEl.textContent = price.bid.toLocaleString(undefined, {minimumFractionDigits: decimals, maximumFractionDigits: decimals});
            }
            if (askEl) {
                askEl.textContent = price.ask.toLocaleString(undefined, {minimumFractionDigits: decimals, maximumFractionDigits: decimals});
            }
        } else {
        }

        // MT5 연결 상태 확인 (가격 업데이트는 계속 진행)
        if (data.mt5_connected === false) {
            document.getElementById('statusDot').classList.add('disconnected');
            document.getElementById('headerStatus').textContent = 'Disconnected';
            // ★ return 제거 - 가격 데이터는 계속 업데이트
        } else if (data.mt5_connected === true) {
            document.getElementById('statusDot').classList.remove('disconnected');
            document.getElementById('headerStatus').textContent = 'Connected';
        }

        // 마지막 WebSocket 데이터 저장 (navigation.js에서 사용)
        if (typeof lastWebSocketData !== 'undefined') {
            lastWebSocketData = data;
        } else {
            window.lastWebSocketData = data;
        }

        // Demo 모드면 차트/시세만 업데이트하고 계정 정보는 건너뛰기
        if (isDemo) {
            // ★ 전역 가격 저장 (V5 패널에서 사용)
            if (data.all_prices) {
                window.allPrices = data.all_prices;
                // Quick&Easy 틱차트 업데이트
                if (typeof QeTickChart !== 'undefined' && QeTickChart.initialized) {
                    const sym = window.currentSymbol || 'BTCUSD';
                    if (window.allPrices && window.allPrices[sym]) {
                        const bid = window.allPrices[sym].bid || 0;
                        if (bid > 0) QeTickChart.addTick(bid);
                    }
                }
            }
            
            // Chart prices만 업데이트 (★ 장 마감 시 업데이트 차단)
            if (!isCurrentMarketClosed() && data.all_prices && data.all_prices[chartSymbol]) {
                const symbolPrice = data.all_prices[chartSymbol];
                if (typeof ChartPanel !== 'undefined' && ChartPanel.updateChartPrice) {
                    ChartPanel.updateChartPrice(symbolPrice.bid);
                }
            }

            // Realtime candle update (★ all_candles는 M1만 — D1/W1은 price fallback)
            if (!isCurrentMarketClosed()) {
                if (currentTimeframe === 'M1' && data.all_candles && data.all_candles[chartSymbol]) {
                    if (typeof ChartPanel !== 'undefined' && ChartPanel.safeUpdateCandle) {
                        ChartPanel.safeUpdateCandle(data.all_candles[chartSymbol]);
                    }
                } else if (data.all_prices && data.all_prices[chartSymbol]) {
                    var bid = data.all_prices[chartSymbol].bid;
                    if (bid && typeof ChartPanel !== 'undefined' && ChartPanel.safeUpdateCandle) {
                        ChartPanel.safeUpdateCandle({close: bid});
                    }
                }
            }

            // ★ 30초마다 인디케이터 갱신 (보조지표 실시간 반영)
            if (!isCurrentMarketClosed()) {
                if (!window._lastCandleRefresh || Date.now() - window._lastCandleRefresh > 30000) {
                    window._lastCandleRefresh = Date.now();
                    if (typeof ChartPanel !== 'undefined' && ChartPanel.loadIndicatorsOnly) {
                        ChartPanel.loadIndicatorsOnly();
                    }
                }
            }

            // Signal score - ★★★ 모든 score 변수 동기화 ★★★
            if (data.base_score !== undefined) {
                baseScore = data.base_score;
                targetScore = data.base_score;
                chartTargetScore = data.base_score;
            }

            // ★★★ 시그널 게이지 + 인디케이터 (1~3초 랜덤 간격 큐에 위임) ★★★
            if (data.sell_count !== undefined) {
                queueIndicatorUpdate(data.buy_count, data.sell_count, data.neutral_count);
            }


            // ★ V5 패널 업데이트 - WS 데이터 직접 사용 (HTTP 요청 제거)
            if (typeof updateV5PanelFromData === 'function' && data.positions) {
                updateV5PanelFromData(data);
            }
            
            // ★ Demo 잔고/자산 업데이트 (WS가 단일 소스)
            if (data.balance !== undefined) {
                balance = data.balance;
                const tradeBalance = document.getElementById('tradeBalance');
                if (tradeBalance) tradeBalance.textContent = '$' + Math.round(data.balance).toLocaleString();
                const homeBalance = document.getElementById('homeBalance');
                if (homeBalance) homeBalance.textContent = '$' + data.balance.toLocaleString(undefined, {minimumFractionDigits: 2});
                const accBalance = document.getElementById('accBalance');
                if (accBalance) accBalance.textContent = '$' + data.balance.toLocaleString(undefined, {minimumFractionDigits: 2});
                const homeFreeMargin = document.getElementById('homeFreeMargin');
                if (homeFreeMargin) homeFreeMargin.textContent = '$' + data.balance.toLocaleString(undefined, {minimumFractionDigits: 2});
            }
            if (data.equity !== undefined) {
                const homeEquity = document.getElementById('homeEquity');
                if (homeEquity) homeEquity.textContent = '$' + data.equity.toLocaleString(undefined, {minimumFractionDigits: 2});
                const accEquity = document.getElementById('accEquity');
                if (accEquity) accEquity.textContent = '$' + data.equity.toLocaleString(undefined, {minimumFractionDigits: 2});
            }

            // ★ Demo Margin / Free Margin / Current P/L 업데이트
            if ('margin' in data) {
                const accMargin = document.getElementById('accMargin');
                if (accMargin) accMargin.textContent = '$' + (data.margin || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
                const accFree = document.getElementById('accFree');
                const freeMargin = (data.balance || 0) - (data.margin || 0);
                if (accFree) accFree.textContent = '$' + Math.round(freeMargin).toLocaleString();
                const homeFreeMargin = document.getElementById('homeFreeMargin');
                if (homeFreeMargin) homeFreeMargin.textContent = '$' + freeMargin.toLocaleString(undefined, {minimumFractionDigits: 2});
            }
            // ★ Current P/L 업데이트 (current_pl 또는 position.profit 사용)
            const accCurrentPL = document.getElementById('accCurrentPL');
            if (accCurrentPL) {
                let pl = 0;
                if ('current_pl' in data) {
                    pl = data.current_pl || 0;
                } else if (data.position && data.position.profit !== undefined) {
                    pl = data.position.profit || 0;
                }
                if (pl > 0) {
                    accCurrentPL.textContent = '+$' + pl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
                    accCurrentPL.style.color = 'var(--buy-color)';
                } else if (pl < 0) {
                    accCurrentPL.textContent = '-$' + Math.abs(pl).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
                    accCurrentPL.style.color = 'var(--sell-color)';
                } else {
                    accCurrentPL.textContent = '$0.00';
                    accCurrentPL.style.color = 'var(--text-primary)';
                }
            }
            if ('leverage' in data) {
                const accLeverage = document.getElementById('accLeverage');
                if (accLeverage) accLeverage.textContent = '1:' + (data.leverage || 500);
            }

            // ★★★ Demo WS 자동청산 처리 (중복 방지 강화) ★★★
            if (data.auto_closed) {
                // ★★★ WS 연결 직후 5초간은 이전 이벤트 무시 (서버 재시작 가짜 팝업 방지) ★★★
                if (Date.now() - wsConnectionStartTime < 5000) {
                    console.log('[WS Demo] ⏳ 연결 직후 청산 이벤트 무시 (가짜 팝업 방지)');
                } else {
                // closed_at이 없으면 현재 시간으로 대체
                const closedAt = data.closed_at || Date.now() / 1000;
                const lastClosedAt = window._lastAutoClosedAt || 0;
                const profit = data.closed_profit || 0;
                // 중복 알림 방지
                if (data.closed_at && data.closed_at === window._lastClosedAlert) return;
                if (data.closed_at) window._lastClosedAlert = data.closed_at;

                // ★ 중복 방지: closed_at 기준 (5초 이내 같은 값이면 무시)
                const timeDiff = Math.abs(closedAt - lastClosedAt);
                const isDuplicate = timeDiff < 1;  // 1초 이내면 중복으로 간주

                if (!isDuplicate) {
                    window._lastAutoClosedAt = closedAt;
                    console.log('[WS Demo] 🎯 AUTO CLOSED!', { profit, closedAt, isWin: data.is_win });

                    // ★ 사운드 재생
                    try {
                        playSound('close');
                    } catch (e) {
                        setTimeout(() => { try { playSound('close'); } catch(e2) {} }, 100);
                    }

                    const isWin = data.is_win !== false && profit >= 0;

                    // 마틴 모드
                    if (currentMode === 'martin' && martinEnabled) {
                        if (isWin) {
                            martinStep = 1;
                            martinAccumulatedLoss = 0;
                            martinHistory = [];
                            updateMartinUI();
                            showMartinSuccessPopup(profit);
                        } else if (data.martin_reset && !isWin) {
                            const totalLoss = data.martin_accumulated_loss || martinAccumulatedLoss;
                            martinStep = 1;
                            martinAccumulatedLoss = 0;
                            martinHistory = [];
                            updateMartinUI();
                            showMaxPopup(totalLoss);
                        } else if (data.martin_step_up) {
                            // ★★★ 유저 청산 or 최근 주문만 팝업 ★★★
                            if (window._userClosing || (Date.now() - (window._lastOrderTime || 0) < 60000)) {
                                showMartinPopup(profit);
                            } else {
                                console.log('[WS Demo] 마틴 팝업 무시 — 유저 청산 아님');
                            }
                        } else {
                            if (window._userClosing || (Date.now() - (window._lastOrderTime || 0) < 60000)) {
                                showMartinPopup(profit);
                            } else {
                                console.log('[WS Demo] 마틴 팝업 무시 — 유저 청산 아님');
                            }
                        }
                    } else {
                        // ★★★ Basic/NoLimit 모드 — 2단계 알림 ★★★
                        showToast('포지션이 청산되었습니다', 'success');
                        setTimeout(async () => {
                            try {
                                const histResp = await apiCall('/demo/history?limit=1');
                                if (histResp && histResp.trades && histResp.trades.length > 0) {
                                    const p = histResp.trades[0].profit || 0;
                                    if (p >= 0) {
                                        showToast(`청산 손익: +$${p.toFixed(2)}`, 'success');
                                    } else {
                                        showToast(`청산 손익: -$${Math.abs(p).toFixed(2)}`, 'error');
                                    }
                                }
                            } catch (e) {}
                        }, 2000);
                    }

                    // Today P/L 업데이트
                    if (typeof updateTodayPL === 'function') {
                        updateTodayPL(profit);
                    }

                    // 포지션 UI 초기화
                    if (typeof updatePositionUI === 'function') {
                        updatePositionUI(false, null);
                    }

                    // ★★★ Quick&Easy 패널 청산 연동 (magic=100003) ★★★
                    if (data.magic == 100003 && typeof QuickEasyPanel !== 'undefined') {
                        // 중복 방지: 같은 closed_at은 1회만 처리
                        if (data.closed_at !== window._lastQEClosedAt) {
                            window._lastQEClosedAt = data.closed_at;
                            const closedSymbol = data.symbol || '';
                            const currentSym = window.currentSymbol || 'BTCUSD';
                            // ★ 현재 보는 종목이면 UI 청산, 아니면 딕셔너리에서만 제거
                            if (closedSymbol === currentSym || QuickEasyPanel._posSymbol === closedSymbol) {
                                console.log('[WS Demo] 🎯 Quick&Easy auto_closed (현재 종목):', closedSymbol);
                                QuickEasyPanel.hidePositionView(true);
                            } else {
                                console.log('[WS Demo] 🎯 Quick&Easy auto_closed (다른 종목):', closedSymbol);
                                delete QuickEasyPanel._positions[closedSymbol];
                                QuickEasyPanel._updatePositionBadge();
                            }
                        }
                    }
                }
                }  // ★ wsConnectionStartTime 체크 else 블록 닫기
            }

            // ★ Demo 포지션 업데이트
            console.log('[WS Demo] Position data received:', data.position);
            if (data.position) {
                console.log('[WS Demo] ✅ Has position - calling updatePositionUI(true)');
                window.currentProfit = data.position.profit || 0;
                window.currentTarget = data.position.target || targetAmount;
                window._demoPositionHeld = true;  // ★ 유령 포지션 감지용
                window._demoNullCount = 0;

                // ★ 포지션의 실제 volume 표시 (lotSize는 변경하지 않음 - 마틴 버그 방지)
                if (data.position.volume) {
                    const tradeLotSize = document.getElementById('tradeLotSize');
                    if (tradeLotSize) tradeLotSize.textContent = data.position.volume.toFixed(2);
                    // lotSize는 base_lot 유지, 마틴 모드에서는 connection.js의 martin state에서 복원
                }

                // magic 기반 패널 구분
                if (typeof updatePositionUI === 'function') {
                    updatePositionUI(true, data.position);  // Buy/Sell 패널용
                }
            } else if (!data.auto_closed) {  // 자동청산이 아닐 때만 포지션 없음 처리
                console.log('[WS Demo] ❌ No position - calling updatePositionUI(false)');

                // ★★★ 유령 포지션 정리: 서버가 null 연속 보내면 프론트엔드 강제 초기화 ★★★
                if (window._demoPositionHeld) {
                    window._demoNullCount = (window._demoNullCount || 0) + 1;
                    if (window._demoNullCount >= 3) {
                        console.log('[WS Demo] 🧹 유령 포지션 정리 (서버 null 3회 연속)');
                        window._demoPositionHeld = false;
                        window._demoNullCount = 0;
                        window.currentProfit = 0;
                        window.currentTarget = 0;
                    }
                }
                if (typeof updatePositionUI === 'function') {
                    updatePositionUI(false, null);
                }
            }

            // ★ Open Positions 탭 실시간 업데이트
            if (typeof OpenPositions !== 'undefined' && data.positions) {
                OpenPositions.updatePositions(data.positions);
            }

            // ★★★ Quick&Easy 포지션 동기화 (완전 교체 방식 — MT5 실제 데이터로) ★★★
            if (typeof QuickEasyPanel !== 'undefined' && data.positions && Array.isArray(data.positions)) {
                const currentSym = window.currentSymbol || 'BTCUSD';

                // ★★★ 1단계: magic=100003 포지션만 모아서 새 객체 생성 ★★★
                const newQePositions = {};
                data.positions.filter(p => p.magic == 100003).forEach(qePos => {
                    const posSym = qePos.symbol || '';
                    const _tp = qePos.tp_price || qePos.tp || 0;
                    const _sl = qePos.sl_price || qePos.sl || 0;
                    newQePositions[posSym] = {
                        id: qePos.id || qePos.ticket,
                        side: qePos.type === 'BUY' ? 'BUY' : 'SELL',
                        entry: qePos.entry || qePos.openPrice || 0,
                        volume: qePos.volume,
                        target: qePos.target || 0,
                        profit: qePos.profit || 0,
                        tpsl: (_tp > 0 && _sl > 0) ? { tp: _tp, sl: _sl } : null,
                        startTime: Date.now(),
                        openedAt: Date.now()
                    };
                });

                // ★★★ 2단계: 기존 _positions 완전 교체 (MT5에서 사라진 포지션 자동 삭제) ★★★
                const prevCount = Object.keys(QuickEasyPanel._positions).length;
                const newCount = Object.keys(newQePositions).length;
                QuickEasyPanel._positions = newQePositions;
                if (prevCount !== newCount) {
                    console.log(`[WS Demo] 🔄 QE 포지션 동기화: ${prevCount}개 → ${newCount}개`);
                }
                QuickEasyPanel._updatePositionBadge();

                // ★★★ 3단계: 현재 보는 종목 UI 복구 (조건 완화) ★★★
                const currentQePos = newQePositions[currentSym];
                if (currentQePos) {
                    // TP/SL 값 설정
                    if (currentQePos.tpsl) {
                        window._serverTPSL = currentQePos.tpsl;
                    }
                    // UI 복구 (항상 최신 데이터로 갱신)
                    if (QuickEasyPanel._posEntryPrice <= 0) {
                        console.log('[WS Demo] 🔄 이지패널 포지션 복구:', currentSym);
                        QuickEasyPanel.showPositionView(
                            currentQePos.side,
                            currentQePos.entry,
                            currentQePos.volume,
                            currentQePos.target
                        );
                    }
                }
            }

            // ★★★ Demo Today P/L — _todayPLFixed 단일 소스 ★★★
            // WS의 data.today_pl(DB값)은 일별 리셋 안 되므로 사용하지 않음
            // _todayPLFixed만 유일한 진실의 소스로 사용
            if (window._todayPLFixed !== null && window._todayPLFixed !== undefined) {
                const fixedPL = window._todayPLFixed;
                const accTodayPL = document.getElementById('accTodayPL');
                if (accTodayPL) {
                    const newText = fixedPL > 0 ? '+$' + fixedPL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : fixedPL < 0 ? '-$' + Math.abs(fixedPL).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '$0.00';
                    const newColor = fixedPL > 0 ? 'var(--buy-color)' : fixedPL < 0 ? 'var(--sell-color)' : 'var(--text-primary)';
                    if (accTodayPL.textContent !== newText) {
                        accTodayPL.textContent = newText;
                        accTodayPL.style.color = newColor;
                    }
                }
                const v5TodayPL = document.getElementById('v5TodayPL');
                if (v5TodayPL) {
                    const newV5 = fixedPL > 0 ? '+$' + fixedPL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : fixedPL < 0 ? '-$' + Math.abs(fixedPL).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '$0.00';
                    const v5Color = fixedPL > 0 ? 'var(--buy-color)' : fixedPL < 0 ? 'var(--sell-color)' : 'var(--text-primary)';
                    if (v5TodayPL.textContent !== newV5) {
                        v5TodayPL.textContent = newV5;
                        v5TodayPL.style.color = v5Color;
                    }
                }
            }

            return;
        }
        
        balance = data.balance;
        
        // Home (null 체크 추가)
        const homeBalance = document.getElementById('homeBalance');
        const homeBroker = document.getElementById('homeBroker');
        const homeAccount = document.getElementById('homeAccount');
        const homeLeverage = document.getElementById('homeLeverage');
        const homeEquity = document.getElementById('homeEquity');
        const homeFreeMargin = document.getElementById('homeFreeMargin');
        const homePositions = document.getElementById('homePositions');
        
        if (homeBalance) homeBalance.textContent = '$' + data.balance.toLocaleString(undefined, {minimumFractionDigits: 2});
        if (homeBroker) homeBroker.textContent = data.broker;
        if (homeAccount) homeAccount.textContent = data.account;
        if (homeLeverage) homeLeverage.textContent = '1:' + data.leverage;

        // ★ homeServer 추가
        const homeServer = document.getElementById('homeServer');
        if (homeServer) homeServer.textContent = data.server || '-';

        if (homeEquity) {
            const displayEquity = data._realtimeEquity || data.equity;
            homeEquity.textContent = '$' + displayEquity.toLocaleString(undefined, {minimumFractionDigits: 2});
        }
        if (homeFreeMargin) homeFreeMargin.textContent = '$' + data.free_margin.toLocaleString(undefined, {minimumFractionDigits: 2});
        if (homePositions) homePositions.textContent = data.positions_count;

        // ★ MT5 Account 섹션 업데이트
        const mt5Broker = document.getElementById('mt5Broker');
        const mt5Account = document.getElementById('mt5Account');
        const mt5Server = document.getElementById('mt5Server');
        const mt5Leverage = document.getElementById('mt5Leverage');

        if (mt5Broker) mt5Broker.textContent = data.broker || '-';
        if (mt5Account) mt5Account.textContent = data.account || '-';
        if (mt5Server) mt5Server.textContent = data.server || '-';
        if (mt5Leverage) mt5Leverage.textContent = data.leverage ? `1:${data.leverage}` : '-';

        // ★ 전역 가격 저장 (V5 패널에서 사용)
        if (data.all_prices) {
            window.allPrices = data.all_prices;
                // Quick&Easy 틱차트 업데이트
                if (typeof QeTickChart !== 'undefined' && QeTickChart.initialized) {
                    const sym = window.currentSymbol || 'BTCUSD';
                    if (window.allPrices && window.allPrices[sym]) {
                        const bid = window.allPrices[sym].bid || 0;
                        if (bid > 0) QeTickChart.addTick(bid);
                    }
                }
        }

        // ★★★ 실시간 P/L 계산 (MetaAPI 캐시 지연 해소) ★★★
        if (!isDemo) {
            enrichPositionProfits(data);
        }

        // Chart prices — ★ 장 마감 시 업데이트 차단
        if (!isCurrentMarketClosed() && data.all_prices && data.all_prices[chartSymbol]) {
            const symbolPrice = data.all_prices[chartSymbol];
            if (typeof ChartPanel !== 'undefined' && ChartPanel.updateChartPrice) {
                ChartPanel.updateChartPrice(symbolPrice.bid);
            }
        }

        // Realtime candle update (★ all_candles는 M1만 — D1/W1은 price fallback)
        if (!isCurrentMarketClosed()) {
            if (currentTimeframe === 'M1' && data.all_candles && data.all_candles[chartSymbol]) {
                if (typeof ChartPanel !== 'undefined' && ChartPanel.safeUpdateCandle) {
                    ChartPanel.safeUpdateCandle(data.all_candles[chartSymbol]);
                }
            } else if (data.all_prices && data.all_prices[chartSymbol]) {
                var bid = data.all_prices[chartSymbol].bid;
                if (bid && typeof ChartPanel !== 'undefined' && ChartPanel.safeUpdateCandle) {
                    ChartPanel.safeUpdateCandle({close: bid});
                }
            }
        }

        // ★ 30초마다 인디케이터 갱신
        if (!isCurrentMarketClosed()) {
            if (!window._lastCandleRefresh || Date.now() - window._lastCandleRefresh > 30000) {
                window._lastCandleRefresh = Date.now();
                if (typeof ChartPanel !== 'undefined' && ChartPanel.loadIndicatorsOnly) {
                    ChartPanel.loadIndicatorsOnly();
                }
            }
        }

        // Trade tab
        document.getElementById('tradeBalance').textContent = '$' + Math.round(data.balance).toLocaleString();
        
        // Signal score - ★★★ 모든 score 변수 동기화 ★★★
        if (data.base_score !== undefined) {
            baseScore = data.base_score;
            targetScore = data.base_score;
            chartTargetScore = data.base_score;
        }

        // ★★★ 시그널 게이지 + 인디케이터 (1~3초 랜덤 간격 큐에 위임) ★★★
        if (data.buy_count !== undefined) {
            queueIndicatorUpdate(data.buy_count, data.sell_count, data.neutral_count);
        }
        
        // ★★★ 포지션 정보 — _closeConfirmedAt 체크로 청산 후 게이지 재출현 방지 ★★★
            if (data.position) {
                // ★★★ 사용자가 청산 확인한 후 15초 이내면 WS 포지션 데이터 무시 ★★★
                if (window._closeConfirmedAt && (Date.now() - window._closeConfirmedAt) < 20000) {
                    console.log('[WS Live] ⏭️ 청산 확인 후 캐시 지연 데이터 무시');
                    // 포지션 UI를 업데이트하지 않음 (이전 청산 상태 유지)
                } else {
                    updatePositionUI(true, data.position);
                    window.lastLivePosition = data.position;
                }
            } else {
                // Live 모드에서 포지션 청산 감지
                if (!isDemo && window.lastLivePosition) {
                    // ★★★ 사용자 청산 확인 완료 시 이중 토스트 완전 차단 ★★★
                    if (window._userClosing || window._closeConfirmedAt) {
                        console.log('[WS Live] ⏭️ 사용자 청산 완료 — WS 청산 토스트 스킵');
                    } else if (currentMode === 'martin' && martinEnabled) {
                        console.log('[WS Live] ⏳ 마틴 모드 — auto_closed 이벤트 대기 중');
                    } else {
                        // ★★★ Basic/NoLimit 모드: 2단계 알림 ★★★
                        playSound('close');
                        showToast('포지션이 청산되었습니다', 'success');
                        setTimeout(async () => {
                            try {
                                const histResp = await apiCall('/mt5/history?period=today');
                                if (histResp && histResp.trades && histResp.trades.length > 0) {
                                    const p = histResp.trades[0].profit || 0;
                                    if (p >= 0) {
                                        showToast(`청산 손익: +$${p.toFixed(2)}`, 'success');
                                    } else {
                                        showToast(`청산 손익: -$${Math.abs(p).toFixed(2)}`, 'error');
                                    }
                                }
                                if (typeof syncTradeTodayPL === 'function') syncTradeTodayPL();
                            } catch (e) {}
                        }, 2000);
                    }
                    window.lastLivePosition = null;
                }
                updatePositionUI(false, null);
            }
        
        // Account tab (null 체크 + HTML ID에 맞게 수정)
        const accBalance = document.getElementById('accBalance');
        const accEquity = document.getElementById('accEquity');
        const accMargin = document.getElementById('accMargin');
        const accFree = document.getElementById('accFree');
        const accCurrentPL = document.getElementById('accCurrentPL');

        if (accBalance) accBalance.textContent = '$' + data.balance.toLocaleString(undefined, {minimumFractionDigits: 2});
        if (accEquity) {
            const displayEquity = data._realtimeEquity || data.equity;
            accEquity.textContent = '$' + displayEquity.toLocaleString(undefined, {minimumFractionDigits: 2});
        }
        // Used Margin (사용중인 마진)
        if (accMargin) {
            const newMarginText = '$' + (data.margin || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            if (accMargin.textContent !== newMarginText) {
                accMargin.textContent = newMarginText;
            }
        }
        // Free Margin (여유 마진 = Balance - Used Margin)
        if (accFree) {
            const freeMargin = (data.free_margin !== undefined) ? data.free_margin : ((data.balance || 0) - (data.margin || 0));
            const newFreeText = '$' + Math.round(freeMargin).toLocaleString();
            if (accFree.textContent !== newFreeText) {
                accFree.textContent = newFreeText;
            }
        }
        // ★ Open Positions 탭 실시간 업데이트
        if (typeof OpenPositions !== 'undefined' && data.positions) {
            OpenPositions.updatePositions(data.positions);
        }

        // ★★★ Quick&Easy 포지션 동기화 (완전 교체 방식 — MT5 실제 데이터로) ★★★
        if (typeof QuickEasyPanel !== 'undefined' && data.positions && Array.isArray(data.positions)) {
            const currentSym = window.currentSymbol || 'BTCUSD';

            // ★★★ 1단계: magic=100003 포지션만 모아서 새 객체 생성 ★★★
            const newQePositions = {};
            data.positions.filter(p => p.magic == 100003).forEach(qePos => {
                const posSym = qePos.symbol || '';
                const _tp = qePos.tp_price || qePos.tp || 0;
                const _sl = qePos.sl_price || qePos.sl || 0;
                newQePositions[posSym] = {
                    id: qePos.id || qePos.ticket,
                    side: qePos.type === 'BUY' ? 'BUY' : 'SELL',
                    entry: qePos.entry || qePos.openPrice || 0,
                    volume: qePos.volume,
                    target: qePos.target || 0,
                    profit: qePos.profit || 0,
                    tpsl: (_tp > 0 && _sl > 0) ? { tp: _tp, sl: _sl } : null,
                    startTime: Date.now(),
                    openedAt: Date.now()
                };
            });

            // ★★★ 2단계: 기존 _positions 완전 교체 (MT5에서 사라진 포지션 자동 삭제) ★★★
            const prevCount = Object.keys(QuickEasyPanel._positions).length;
            const newCount = Object.keys(newQePositions).length;
            QuickEasyPanel._positions = newQePositions;
            if (prevCount !== newCount) {
                console.log(`[WS Live] 🔄 QE 포지션 동기화: ${prevCount}개 → ${newCount}개`);
            }
            QuickEasyPanel._updatePositionBadge();

            // ★★★ 3단계: 현재 보는 종목 UI 복구 (조건 완화) ★★★
            const currentQePos = newQePositions[currentSym];
            if (currentQePos) {
                // TP/SL 값 설정
                if (currentQePos.tpsl) {
                    window._serverTPSL = currentQePos.tpsl;
                }
                // UI 복구 (항상 최신 데이터로 갱신)
                if (QuickEasyPanel._posEntryPrice <= 0) {
                    console.log('[WS Live] 🔄 이지패널 포지션 복구:', currentSym);
                    QuickEasyPanel.showPositionView(
                        currentQePos.side,
                        currentQePos.entry,
                        currentQePos.volume,
                        currentQePos.target
                    );
                }
            }
        }

        // Current P&L 업데이트 (전체 포지션 손익 합계 — BuySell + V5 + QE)
        if (accCurrentPL) {
            let currentProfit = 0;
            let hasAnyPosition = false;

            // Buy/Sell 포지션 손익 (magic=100001)
            if (data.position) {
                currentProfit += data.position.profit || 0;
                hasAnyPosition = true;
            }

            // V5 포지션 손익 (magic=100002)
            if (typeof v5Positions !== 'undefined' && v5Positions && v5Positions.length > 0) {
                v5Positions.forEach(pos => {
                    currentProfit += pos.profit || 0;
                });
                hasAnyPosition = true;
            }

            // ★ QE 포지션 손익 (magic=100003) — positions 배열에서 합산
            if (data.positions && Array.isArray(data.positions)) {
                const qePositions = data.positions.filter(p => p.magic == 100003);
                if (qePositions.length > 0) {
                    qePositions.forEach(pos => {
                        currentProfit += pos.profit || 0;
                    });
                    hasAnyPosition = true;
                }
            }

            // ★ 번쩍임 방지: 포지션 데이터 일시 누락 시 이전 P/L 유지
            if (!hasAnyPosition && window._lastLiveCurrentPL !== undefined && window._lastLiveCurrentPL !== 0) {
                currentProfit = window._lastLiveCurrentPL;
            }
            if (hasAnyPosition) {
                window._lastLiveCurrentPL = currentProfit;
            }

            // 깜빡임 방지: 값이 변경된 경우에만 업데이트
            const newText = currentProfit > 0
                ? '+$' + currentProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})
                : currentProfit < 0 ? '-$' + Math.abs(currentProfit).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '$0.00';
            const newColor = currentProfit > 0 ? 'var(--buy-color)' : currentProfit < 0 ? 'var(--sell-color)' : 'var(--text-primary)';
            
            if (accCurrentPL.textContent !== newText) {
                accCurrentPL.textContent = newText;
                accCurrentPL.style.color = newColor;
            }
        }

        // ★★★ 라이브 모드 Today P/L — _todayPLFixed 단일 소스 ★★★
        // WS의 data.today_pl 대신 _todayPLFixed만 사용 (정확한 히스토리 기반)
        if (window._todayPLFixed !== null && window._todayPLFixed !== undefined) {
            const fixedPL = window._todayPLFixed;
            const accTodayPL = document.getElementById('accTodayPL');
            if (accTodayPL) {
                const newText = fixedPL > 0 ? '+$' + fixedPL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : fixedPL < 0 ? '-$' + Math.abs(fixedPL).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '$0.00';
                const newColor = fixedPL > 0 ? 'var(--buy-color)' : fixedPL < 0 ? 'var(--sell-color)' : 'var(--text-primary)';
                if (accTodayPL.textContent !== newText) {
                    accTodayPL.textContent = newText;
                    accTodayPL.style.color = newColor;
                }
            }
        }

        // ★★★ 라이브 모드 History 업데이트 ★★★
        if (data.history && data.history.length > 0) {
            const container = document.getElementById('historyList');
            if (container) {
                let html = '';
                data.history.slice().reverse().forEach(h => {
                    const profit = h.profit || 0;
                    const profitClass = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'neutral';
                    const profitSign = profit > 0 ? '+' : '';
                    const typeStr = h.type === 0 ? 'BUY' : (h.type === 1 ? 'SELL' : (h.type || ''));
                    const typeColor = (h.type === 0 || h.type === 'BUY') ? 'var(--buy-color)' : 'var(--sell-color)';
                    const symbol = h.symbol || '';
                    const volume = h.volume || 0;
                    // 시간 포맷팅 (Unix timestamp 또는 문자열 모두 지원)
                    let timeStr = '';
                    if (h.time) {
                        if (typeof h.time === 'number') {
                            const date = new Date(h.time * 1000);
                            timeStr = date.toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit'});
                        } else {
                            // 이미 문자열 형식 (MM/DD HH:MM)
                            timeStr = h.time;
                        }
                    }
                    html += `<div class="history-item">
                        <div style="flex:1;display:flex;align-items:center;gap:8px;margin-left:5px;">
                            <span style="font-size:15px;font-weight:600;min-width:130px;">${symbol} <span style="color:${typeColor};font-weight:600;font-size:15px;">${typeStr}</span></span>
                            <span class="history-time">${timeStr}</span>
                            <span style="color:rgba(255,255,255,0.2);">|</span>
                            <span class="history-time">${volume} lot</span>
                        </div>
                        <span class="history-profit ${profitClass}" style="min-width:80px;text-align:right;font-size:15px;margin-right:5px;">${profitSign}$${profit.toFixed(2)}</span>
                    </div>`;
                });
                container.innerHTML = html;

                // ★★★ WS history로부터 Today P/L 계산 (Demo/Live 공통) ★★★
                const now_ws = new Date();
                const todayStr_ws = `${String(now_ws.getMonth() + 1).padStart(2, '0')}/${String(now_ws.getDate()).padStart(2, '0')}`;
                let todayPL_ws = 0;
                data.history.forEach(h => {
                    const timeStr = typeof h.time === 'string' ? h.time : '';
                    if (timeStr.startsWith(todayStr_ws)) {
                        todayPL_ws += h.profit || 0;
                    }
                });
                if (window._todayPLFixed === null || window._todayPLFixed === undefined) {
                    window._todayPLFixed = todayPL_ws;
                    console.log('[WS] Today P/L 초기화:', window._todayPLFixed);
                }
            }
        }

        // ★★★ SL/TP 청산 동기화 이벤트 처리 — 사용자 청산 후 이중 감지 차단 ★★★
        if (data.sync_event && data.sync_event.type === 'sl_tp_closed' && !window._closeConfirmedAt && !window._userClosing && window.lastLivePosition) {
            const profit = data.sync_event.profit || 0;
            console.log('[WS Live] 🎯 SL/TP 청산 감지!', data.sync_event);

            // ★ 게이지 프리즈 (MetaAPI 캐시 지연 대비)
            window._plGaugeFrozen = true;
            window._userClosing = true;

            // 1. 사운드 재생
            try {
                playSound('close');
            } catch (e) {
                setTimeout(() => { try { playSound('close'); } catch(e2) {} }, 100);
            }

            // 2. 포지션 UI 즉시 숨기기
            if (typeof updatePositionUI === 'function') {
                updatePositionUI(false, null);
            }
            window.lastLivePosition = null;

            // ★★★ SL/TP 청산 후에도 _closeConfirmedAt 설정 ★★★
            window._closeConfirmedAt = Date.now();
            setTimeout(() => {
                window._closeConfirmedAt = null;
            }, 20000);

            // 3. 즉시 청산 알림
            showToast('포지션이 청산되었습니다', 'success');

            // 4. 1.5초 후 히스토리에서 실제 체결 금액 조회
            setTimeout(async () => {
                try {
                    if (typeof loadHistory === 'function') loadHistory();
                    let actualProfit = profit;
                    const histResp = await apiCall('/mt5/history?period=today');
                    if (histResp && histResp.trades && histResp.trades.length > 0) {
                        actualProfit = histResp.trades[0].profit || profit;
                    }

                    // ★★★ 마틴 모드: 팝업으로 처리 ★★★
                    if (currentMode === 'martin' && martinEnabled) {
                        window._martinStateUpdating = true;
                        if (actualProfit > 0) {
                            if (actualProfit >= martinAccumulatedLoss && martinAccumulatedLoss > 0) {
                                await apiCall('/mt5/martin/reset-full', 'POST');
                                updateTodayPL(actualProfit);
                                showMartinSuccessPopup(actualProfit);
                                martinStep = 1;
                                martinAccumulatedLoss = 0;
                                martinHistory = [];
                                updateMartinUI();
                                window._martinStateUpdating = false;
                            } else {
                                const remainingLoss = Math.max(0, martinAccumulatedLoss - actualProfit);
                                await apiCall(`/mt5/martin/update-state?step=${martinStep}&accumulated_loss=${remainingLoss}`, 'POST');
                                martinAccumulatedLoss = remainingLoss;
                                updateMartinUI();
                                updateTodayPL(actualProfit);
                                window._martinStateUpdating = false;
                                showToast(`일부 회복! +$${actualProfit.toFixed(2)}`, 'success');
                            }
                        } else if (actualProfit < 0) {
                            // ★★★ 유저 청산 or 최근 주문만 팝업 ★★★
                            if (window._userClosing || (Date.now() - (window._lastOrderTime || 0) < 60000)) {
                                showMartinPopup(actualProfit);
                            } else {
                                console.log('[WS Live SL/TP] 마틴 팝업 무시 — 유저 청산 아님');
                                window._martinStateUpdating = false;
                            }
                        } else {
                            updateTodayPL(0);
                            window._martinStateUpdating = false;
                        }
                    } else {
                        // Basic/NoLimit 모드 — 2단계 알림 (2초 후 정확한 금액)
                        setTimeout(async () => {
                            try {
                                const histResp2 = await apiCall('/mt5/history?period=today');
                                if (histResp2 && histResp2.trades && histResp2.trades.length > 0) {
                                    const p = histResp2.trades[0].profit || 0;
                                    if (p >= 0) {
                                        showToast(`청산 손익: +$${p.toFixed(2)}`, 'success');
                                    } else {
                                        showToast(`청산 손익: -$${Math.abs(p).toFixed(2)}`, 'error');
                                    }
                                }
                                if (typeof syncTradeTodayPL === 'function') syncTradeTodayPL();
                            } catch (e) {}
                        }, 2000);
                    }
                } catch (e) {
                    console.error('[SL/TP] 실패:', e);
                    if (typeof updateTodayPL === 'function') updateTodayPL(profit);
                    window._martinStateUpdating = false;
                }
            }, 1500);

            // ★ 5초 후 프리즈 해제 (MetaAPI 캐시 동기화 대기)
            setTimeout(() => {
                window._plGaugeFrozen = false;
                window._userClosing = false;
            }, 5000);
        }

        // ★★★ 라이브 자동청산 처리 ★★★
        if (data.auto_closed && !window._userClosing && window.lastLivePosition) {
            // ★★★ WS 연결 직후 10초간은 이전 이벤트 무시 (서버 재시작/모드 전환 가짜 팝업 방지) ★★★
            if (Date.now() - wsConnectionStartTime < 10000) {
                console.log('[WS Live] ⏳ 연결 직후 청산 이벤트 무시 (가짜 팝업 방지)');
            } else {
            const closedAt = data.closed_at || Date.now() / 1000;
            const lastClosedAt = window._lastLiveAutoClosedAt || 0;
            const profit = data.closed_profit || 0;

            // ★ 중복 방지: closed_at 기준 (1초 이내면 무시)
            const timeDiff = Math.abs(closedAt - lastClosedAt);
            const isDuplicate = timeDiff < 1;

            // ★★★ 사용자 청산으로 이미 처리된 경우 스킵 ★★★
            if (!isDuplicate && !window._closeConfirmedAt) {
                window._lastLiveAutoClosedAt = closedAt;
                console.log('[WS Live] 🔔 자동 청산 감지!', { profit, closedAt, isWin: data.is_win, mode: currentMode });

                window._plGaugeFrozen = true;

                // 사운드 재생
                try { playSound('close'); } catch(e) {}

                // 포지션 UI 초기화
                if (typeof updatePositionUI === 'function') {
                    updatePositionUI(false, null);
                }
                window.lastLivePosition = null;

                // ★★★ 자동 청산 후에도 _closeConfirmedAt 설정 (WS 포지션 재출현 방지) ★★★
                window._closeConfirmedAt = Date.now();
                setTimeout(() => {
                    window._closeConfirmedAt = null;
                    console.log('[WS Auto] 🔓 자동청산 _closeConfirmedAt 해제 (20초 후)');
                }, 20000);

                const isWin = data.is_win !== false && profit >= 0;

                // ★★★ 라이브 마틴 모드: 팝업 내부에서 2초 대기 + last-trade 조회 ★★★
                if (currentMode === 'martin' && martinEnabled) {
                    window._martinStateUpdating = true;
                    showToast('포지션이 청산되었습니다', 'success');

                    setTimeout(async () => {
                        try {
                            const actualProfit = profit;
                            if (typeof loadHistory === 'function') loadHistory();

                            if (actualProfit > 0) {
                                if (actualProfit >= martinAccumulatedLoss && martinAccumulatedLoss > 0) {
                                    await apiCall('/mt5/martin/reset-full', 'POST');
                                    updateTodayPL(actualProfit);
                                    showMartinSuccessPopup(actualProfit);
                                    martinStep = 1;
                                    martinAccumulatedLoss = 0;
                                    martinHistory = [];
                                    updateMartinUI();
                                    window._martinStateUpdating = false;
                                } else {
                                    const remainingLoss = Math.max(0, martinAccumulatedLoss - actualProfit);
                                    await apiCall(`/mt5/martin/update-state?step=${martinStep}&accumulated_loss=${remainingLoss}`, 'POST');
                                    martinAccumulatedLoss = remainingLoss;
                                    updateMartinUI();
                                    updateTodayPL(actualProfit);
                                    window._martinStateUpdating = false;
                                    showToast(`일부 회복! +$${actualProfit.toFixed(2)}`, 'success');
                                }
                            } else if (actualProfit < 0) {
                                // ★★★ 유저 청산 or 최근 주문만 팝업 ★★★
                                if (window._userClosing || (Date.now() - (window._lastOrderTime || 0) < 60000)) {
                                    showMartinPopup(actualProfit);
                                } else {
                                    console.log('[WS Live auto_closed] 마틴 팝업 무시 — 유저 청산 아님');
                                    window._martinStateUpdating = false;
                                }
                            } else {
                                updateTodayPL(0);
                                window._martinStateUpdating = false;
                            }
                            if (typeof syncTradeTodayPL === 'function') syncTradeTodayPL();
                        } catch (e) {
                            updateTodayPL(profit);
                            window._martinStateUpdating = false;
                        }
                    }, 0);
                } else {
                    // ★★★ Basic/NoLimit 모드: 2단계 알림 ★★★
                    showToast('포지션이 청산되었습니다', 'success');
                    setTimeout(async () => {
                        try {
                            const histResp3 = await apiCall('/mt5/history?period=today');
                            if (histResp3 && histResp3.trades && histResp3.trades.length > 0) {
                                const p = histResp3.trades[0].profit || 0;
                                if (p >= 0) {
                                    showToast(`청산 손익: +$${p.toFixed(2)}`, 'success');
                                } else {
                                    showToast(`청산 손익: -$${Math.abs(p).toFixed(2)}`, 'error');
                                }
                            }
                            if (typeof loadHistory === 'function') loadHistory();
                            if (typeof syncTradeTodayPL === 'function') syncTradeTodayPL();
                        } catch (e) {}
                    }, 2000);
                }

                // 5초 후 프리즈 해제
                setTimeout(() => {
                    window._plGaugeFrozen = false;
                }, 5000);

                // ★★★ Quick&Easy 패널 청산 연동 (magic=100003) ★★★
                if (data.magic == 100003 && typeof QuickEasyPanel !== 'undefined') {
                    const closedSym = data.symbol || '';
                    const curSym = window.currentSymbol || 'BTCUSD';
                    if (closedSym === curSym || QuickEasyPanel._posSymbol === closedSym) {
                        console.log('[WS Live] 🎯 Quick&Easy auto_closed (현재 종목):', closedSym);
                        QuickEasyPanel.hidePositionView(true);
                    } else {
                        console.log('[WS Live] 🎯 Quick&Easy auto_closed (다른 종목):', closedSym);
                        delete QuickEasyPanel._positions[closedSym];
                        QuickEasyPanel._updatePositionBadge();
                    }
                }
            }
            }  // ★ wsConnectionStartTime 체크 else 블록 닫기
        }

        // ★★★ Live Martin state (DB 기반) ★★★
        if (data.martin) {
            if (window._martinStateUpdating) {
                console.log('[WS Martin] ⏳ 마틴 상태 업데이트 중 — WS 무시');
            } else {
                martinEnabled = data.martin.enabled;
                martinLevel = data.martin.max_steps;
                martinStep = data.martin.step;
                martinAccumulatedLoss = data.martin.accumulated_loss;

                if (data.martin.base_target) {
                    martinBaseTarget = data.martin.base_target;
                }

                if (currentMode === 'martin' && martinEnabled) {
                    if (data.martin.current_lot) {
                        const tradeLotSize = document.getElementById('tradeLotSize');
                        if (tradeLotSize) tradeLotSize.textContent = data.martin.current_lot.toFixed(2);
                    }
                    updateMartinUI();
                }
            }
        }

        // ★★★ MetaAPI 연결 상태 체크 (마틴 모드에서 연결 끊김 경고) ★★★
        if (data.metaapi_connected !== undefined) {
            const wasConnected = window._metaapiConnected;
            window._metaapiConnected = data.metaapi_connected;

            // 연결 끊김 감지 (이전에 연결되어 있었는데 끊김)
            if (wasConnected === true && !data.metaapi_connected) {
                console.log('[WS Live] ⚠️ MetaAPI 연결 끊김 감지!');

                // 마틴 모드일 때 경고 토스트
                if (currentMode === 'martin' && martinEnabled) {
                    showToast('MetaAPI 연결이 불안정합니다\n주문이 제한됩니다', 'warning', 5000);

                    // 마틴 주문 버튼 비활성화
                    document.querySelectorAll('.trade-btn').forEach(btn => {
                        btn.style.opacity = '0.5';
                        btn.style.pointerEvents = 'none';
                    });
                }
            }

            // 연결 복구 감지
            if (wasConnected === false && data.metaapi_connected) {
                console.log('[WS Live] ✅ MetaAPI 연결 복구!');

                // 마틴 모드일 때 복구 토스트
                if (currentMode === 'martin' && martinEnabled) {
                    showToast('MetaAPI 연결이 복구되었습니다', 'success', 3000);

                    // 마틴 주문 버튼 활성화
                    document.querySelectorAll('.trade-btn').forEach(btn => {
                        btn.style.opacity = '1';
                        btn.style.pointerEvents = 'auto';
                    });
                }
            }
        }

        // ★ V5 패널 실시간 업데이트 (라이브 모드) - 3초 쓰로틀
        if (typeof updateMultiOrderPanelV5 === 'function') {
            if (!window._lastV5Update || Date.now() - window._lastV5Update > 3000) {
                window._lastV5Update = Date.now();
                updateMultiOrderPanelV5();
            }
        }
        
        // 패널 동기화 (Today P/L 등)
        if (typeof syncAccountInfoToPanels === 'function') {
            syncAccountInfoToPanels();
        }
    };
    
    ws.onclose = function(event) {
        console.log('[WS] WebSocket disconnected, code:', event.code, 'reason:', event.reason);
        window.wsConnected = false;
        window._wsDisconnectedAt = window._wsDisconnectedAt || Date.now();  // ★ 끊긴 시간 기록
        stopHeartbeatMonitor();  // ★ 하트비트 중지

        // ★ 의도적 종료면 재연결하지 않음 (모드 전환 시)
        if (intentionalClose) {
            console.log('[WS] Intentional close - skipping reconnect');
            intentionalClose = false;
            updateConnectionStatus('disconnected');
            return;
        }

        // ★ WebSocket 끊어지면 폴링 시작 (Live 모드일 때만)
        if (!isDemo && !pollingInterval) {
            pollingInterval = setInterval(fetchAccountData, 2000);
            console.log('[WS] Polling started - WebSocket disconnected');
        }

        // ★ 자동 재연결 (지수 백오프, 무제한)
        reconnectWithBackoff();
    };

    ws.onerror = function(error) {
        console.error('[WS] WebSocket error:', error);
        console.log('[WS] readyState:', ws.readyState);
        // onerror 후 onclose가 호출되므로 여기서는 재연결 안 함
    };
}

// Fallback polling
async function fetchAccountData() {
    // Demo 모드면 실행 안 함
    if (isDemo) return;
    
    console.log("[checkUserMode] About to try connectWebSocket - Live mode");
            try {
        const data = await apiCall('/mt5/account-info');
        if (data) {
            // ★ 실시간 P/L 계산 (폴링 모드)
            if (window.allPrices) {
                data.all_prices = window.allPrices;
                enrichPositionProfits(data);
            }
            balance = data.balance;

            const displayEquity = data._realtimeEquity || data.equity || 0;
            document.getElementById('homeBalance').textContent = '$' + (data.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            document.getElementById('homeBroker').textContent = data.broker || '-';
            document.getElementById('homeAccount').textContent = data.account || '-';
            document.getElementById('homeLeverage').textContent = '1:' + (data.leverage || 0);
            document.getElementById('homeServer').textContent = data.server || '-';
            document.getElementById('homeEquity').textContent = '$' + displayEquity.toLocaleString(undefined, {minimumFractionDigits: 2});
            document.getElementById('homeFreeMargin').textContent = '$' + (data.free_margin || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            document.getElementById('homePositions').textContent = data.positions_count || 0;

            document.getElementById('tradeBalance').textContent = '$' + Math.round(data.balance || 0).toLocaleString();

            const accBalance = document.getElementById('accBalance');
            const accEquity = document.getElementById('accEquity');
            const accMargin = document.getElementById('accMargin');
            const accFree = document.getElementById('accFree');
            const accCurrentPL = document.getElementById('accCurrentPL');

            if (accBalance) accBalance.textContent = '$' + (data.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            if (accEquity) accEquity.textContent = '$' + displayEquity.toLocaleString(undefined, {minimumFractionDigits: 2});
            // Used Margin (사용중인 마진)
            if (accMargin) {
                const newMarginText = '$' + (data.margin || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
                if (accMargin.textContent !== newMarginText) {
                    accMargin.textContent = newMarginText;
                }
            }
            // Free Margin (여유 마진)
            if (accFree) {
                const freeMargin = (data.free_margin !== undefined) ? data.free_margin : ((data.balance || 0) - (data.margin || 0));
                const newFreeText = '$' + Math.round(freeMargin).toLocaleString();
                if (accFree.textContent !== newFreeText) {
                    accFree.textContent = newFreeText;
                }
            }

            // ★ Open Positions 탭 업데이트
            if (typeof OpenPositions !== 'undefined' && data.positions) {
                OpenPositions.updatePositions(data.positions);
            }

            // Current P&L 업데이트 (전체 포지션 손익 합계 — BuySell + V5 + QE)
            if (accCurrentPL) {
                let currentProfit = 0;
                
                // Buy/Sell 포지션 손익 (magic=100001)
                if (data.position) {
                    currentProfit += data.position.profit || 0;
                }
                
                // V5 포지션 손익 (magic=100002)
                if (typeof v5Positions !== 'undefined' && v5Positions && v5Positions.length > 0) {
                    v5Positions.forEach(pos => {
                        currentProfit += pos.profit || 0;
                    });
                }
                
                // ★ QE 포지션 손익 (magic=100003)
                if (data.positions && Array.isArray(data.positions)) {
                    data.positions.filter(p => p.magic == 100003).forEach(pos => {
                        currentProfit += pos.profit || 0;
                    });
                }
                
                // 값이 변경된 경우에만 업데이트 (깜빡임 방지)
                const newText = currentProfit > 0
                    ? '+$' + currentProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})
                    : currentProfit < 0 ? '-$' + Math.abs(currentProfit).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '$0.00';
                
                if (accCurrentPL.textContent !== newText) {
                    accCurrentPL.textContent = newText;
                    accCurrentPL.style.color = currentProfit > 0 ? 'var(--buy-color)' : currentProfit < 0 ? 'var(--sell-color)' : 'var(--text-primary)';
                }
            }
            
            // ★★★ 시그널 게이지 + 인디케이터 (1~3초 랜덤 간격 큐에 위임) ★★★
            if (data.buy_count !== undefined) {
                queueIndicatorUpdate(data.buy_count, data.sell_count, data.neutral_count);
            }
            
            if (data.prices && data.prices[chartSymbol]) {
                const price = data.prices[chartSymbol];
                const decimals = getDecimalsForSymbol(chartSymbol);
                document.getElementById('chartBid').textContent = price.bid.toFixed(decimals);
                document.getElementById('chartAsk').textContent = price.ask.toFixed(decimals);
            }
            
            // 포지션 상태 변화 감지 (청산 감지)
            if (data.position) {
                updatePositionUI(true, data.position);
                window.lastLivePosition = data.position;
            } else {
                // 이전에 포지션이 있었는데 지금 없으면 = 청산됨!
                if (window.lastLivePosition) {
                    // ★★★ 유저가 직접 청산한 경우만 알림 (WS 재연결 허위 알림 방지) ★★★
                    // ★★★ 유저가 직접 청산한 경우만 알림 + 손익 조회 ★★★
                    if (window._userClosing || window._closeConfirmedAt) {
                        playSound('close');
                        showToast('포지션이 청산되었습니다', 'success');

                        // 2초 후 실제 손익 조회
                        setTimeout(async () => {
                            try {
                                const histResp = await apiCall('/mt5/history?period=today');
                                if (histResp && histResp.trades && histResp.trades.length > 0) {
                                    const actualProfit = histResp.trades[0].profit || 0;
                                    if (actualProfit >= 0) {
                                        showToast(`청산 손익: +$${actualProfit.toFixed(2)}`, 'success');
                                    } else {
                                        showToast(`청산 손익: -$${Math.abs(actualProfit).toFixed(2)}`, 'error');
                                    }
                                    if (typeof updateTodayPL === 'function') {
                                        updateTodayPL(actualProfit);
                                    }
                                }
                                if (typeof loadHistory === 'function') {
                                    loadHistory();
                                }
                            } catch (e) {
                                console.error('[WS Live Close] History fetch error:', e);
                            }
                        }, 2000);
                    } else {
                        console.log('[WS] 포지션 사라짐 감지 (알림 생략 - 유저 청산 아님)');
                    }

                    window.lastLivePosition = null;
                }
                updatePositionUI(false, null);
            }

            document.getElementById('statusDot').classList.remove('disconnected');
            document.getElementById('headerStatus').textContent = 'Connected';
        }
    } catch (error) {
        console.error("[checkUserMode] Error:", error);
        console.error('Fetch error:', error);
        // 에러가 나도 바로 Disconnected로 바꾸지 않음 (일시적 오류일 수 있음)
        console.log('Fetch error, will retry...');
    }
}

// ========== Demo/Live 모드 확인 ==========
async function checkUserMode() {
    console.log('[checkUserMode] Start');
    console.log("[checkUserMode] About to try connectWebSocket - Live mode");
            try {
        // 먼저 Demo 계정 정보 조회
        const response = await fetch(`${API_URL}/demo/account-info`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        console.log('[checkUserMode] Response:', data);

        if (data.has_mt5) {
            console.log('[checkUserMode] Live mode - has_mt5=true');
            // MT5 계정 연결됨 → Live 모드
            isDemo = false;
            window._checkUserModeRetries = 0;  // ★ 재시도 카운터 리셋
            document.getElementById('headerStatus').textContent = 'Connected';
            document.getElementById('statusDot').style.background = '#00ff88';
            document.getElementById('statusDot').classList.remove('disconnected');

            // Live 배지 표시
            const badge = document.getElementById('modeBadge');
            badge.textContent = 'LIVE';
            badge.className = 'mode-badge-live';
            badge.style.display = 'inline';
            
            // ★ Trading Mode UI를 Live로 설정
            const liveBtn = document.getElementById('modeLiveBtn');
            const demoBtn = document.getElementById('modeDemoBtn');
            const liveCheck = document.getElementById('liveCheck');
            const demoCheck = document.getElementById('demoCheck');
            const modeStatus = document.getElementById('modeStatus');
            const demoControl = document.getElementById('demoControlCard');
            
            if (liveBtn && demoBtn) {
                liveBtn.classList.add('active', 'live-active');
                demoBtn.classList.remove('active');
                liveCheck.style.display = 'flex';
                demoCheck.style.display = 'none';
                modeStatus.className = 'mode-status live';
                modeStatus.innerHTML = '<span class="mode-status-dot live"></span><span>Currently in <strong>Live Mode</strong> - Real trading active</span>';
            }
            if (demoControl) demoControl.style.display = 'none';
            
            // Hero 배지도 업데이트
            const heroBadge = document.getElementById('heroModeBadge');
            if (heroBadge) {
                heroBadge.textContent = 'Trading-X Live';
                heroBadge.style.background = 'linear-gradient(135deg, rgba(0, 255, 136, 0.2) 0%, rgba(0, 255, 136, 0.05) 100%)';
                heroBadge.style.borderColor = 'rgba(0, 255, 136, 0.4)';
                heroBadge.style.color = '#ffffff';
            }
            
            updateHeroCTA('live');
            
            // WebSocket 연결 (실패해도 폴링으로 대체)
            console.log("[checkUserMode] About to try connectWebSocket - Live mode");
            try {
                console.log("[checkUserMode] Calling connectWebSocket...");
            connectWebSocket();
            } catch (e) {
                console.log('WebSocket connection failed, using polling');
                // ★ WebSocket 실패 시에만 폴링 시작
                if (!pollingInterval) {
                    pollingInterval = setInterval(fetchAccountData, 2000);
                }
            }

            fetchAccountData();  // 초기 데이터 1회 로드

            // ★ 히스토리 로드 (Today P/L 계산)
            if (typeof loadHistory === 'function') {
                loadHistory();
            }

            // ★ 폴링은 ws.onclose에서 자동 시작됨 (여기서는 시작하지 않음)
            
        } else {
            // MT5 없음 → Demo 모드
            isDemo = true;
            window._checkUserModeRetries = 0;  // ★ 재시도 카운터 리셋
            document.getElementById('headerStatus').textContent = 'Connected';
            document.getElementById('statusDot').style.background = '#00d4ff';

            // ★ Trading Mode UI를 Demo로 설정
            const liveBtn = document.getElementById('modeLiveBtn');
            const demoBtn = document.getElementById('modeDemoBtn');
            const liveCheck = document.getElementById('liveCheck');
            const demoCheck = document.getElementById('demoCheck');
            const modeStatus = document.getElementById('modeStatus');
            const demoControl = document.getElementById('demoControlCard');
            
            if (liveBtn && demoBtn) {
                demoBtn.classList.add('active');
                demoBtn.classList.remove('live-active');
                liveBtn.classList.remove('active', 'live-active');
                demoCheck.style.display = 'flex';
                liveCheck.style.display = 'none';
                modeStatus.className = 'mode-status';
                modeStatus.innerHTML = '<span class="mode-status-dot demo"></span><span>Currently in <strong>Demo Mode</strong> - Practice with virtual $10,000</span>';
            }
            if (demoControl) demoControl.style.display = 'block';
            
            // Hero 배지도 업데이트
            const heroBadge = document.getElementById('heroModeBadge');
            if (heroBadge) {
                heroBadge.textContent = 'Trading-X Demo';
                heroBadge.style.background = 'linear-gradient(135deg, rgba(0, 212, 255, 0.2) 0%, rgba(0, 212, 255, 0.05) 100%)';
                heroBadge.style.borderColor = 'rgba(0, 212, 255, 0.4)';
                heroBadge.style.color = '#ffffff';
            }
            
            updateHeroCTA('demo');

            // Demo 배지 표시
            const badge = document.getElementById('modeBadge');
            badge.textContent = 'DEMO';
            badge.className = 'mode-badge-demo';
            badge.style.display = 'inline';
            
            console.log("[checkUserMode] Calling connectWebSocket...");
            connectWebSocket();

            // ★ Demo 데이터 즉시 로드 (Account Overview 업데이트)
            if (token) {
                await fetchDemoData();  // await 추가하여 즉시 실행
                
                // ★ 히스토리 로드 (Today P/L 계산)
                if (typeof loadHistory === 'function') {
                    loadHistory();
                }
                
                setInterval(fetchDemoData, 2000);
            }

            setTimeout(() => {
                showToast('Demo 모드로 접속했습니다\n가상 $10,000로 연습하세요', 'demo');
            }, 1000);
        }
    } catch (error) {
        console.error("[checkUserMode] Error:", error);
        console.error('Mode check error:', error);

        // ★★★ 재시도 로직: 서버가 아직 시작 중일 수 있음 ★★★
        if (!window._checkUserModeRetries) window._checkUserModeRetries = 0;
        window._checkUserModeRetries++;

        if (window._checkUserModeRetries <= 3) {
            console.log(`[checkUserMode] 재시도 ${window._checkUserModeRetries}/3 (3초 후)`);
            showToast('서버에 연결하는 중입니다', 'info');
            setTimeout(() => checkUserMode(), 3000);
            return;
        }

        // 3회 실패 → 데모 모드 fallback + 서버 다운 플래그
        console.warn('[checkUserMode] 3회 재시도 실패 → 데모 모드 전환');
        window._serverWasDown = true;
        isDemo = true;
        fetchDemoData();
    }
}

// ========== Demo 데이터 조회 ==========
async function fetchDemoData() {
    // Demo 모드가 아니면 실행 안 함
    if (!isDemo) {
        console.log('[fetchDemoData] ⚠️ Not in Demo mode, skipping');
        return;
    }

    console.log('[fetchDemoData] 🔵 START - Fetching account info...');
    console.log("[checkUserMode] About to try connectWebSocket - Live mode");
            try {
        const response = await fetch(`${API_URL}/demo/account-info`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        console.log('[fetchDemoData] 📦 Received data:', data);
        console.log('[fetchDemoData] 📍 Position data:', data.position);
        console.log('[fetchDemoData] 📊 Positions count:', data.positions_count);
        
        if (data) {
            // ★ WS 연결 중이면 잔고/포지션 업데이트 건너뛰기 (깜빡임 방지)
            // auto_closed와 인디케이터만 항상 처리
            const wsActive = window.wsConnected === true;
            
            // ★★★ 백엔드에서 자동 청산된 경우 (중복 방지 적용) ★★★
            if (data.auto_closed) {
                // ★★★ WS 연결 직후 5초간은 이전 이벤트 무시 (서버 재시작 가짜 팝업 방지) ★★★
                if (Date.now() - wsConnectionStartTime < 5000) {
                    console.log('[fetchDemoData] ⏳ 연결 직후 청산 이벤트 무시 (가짜 팝업 방지)');
                } else {
                const closedAt = data.closed_at || Date.now() / 1000;
                const lastClosedAt = window._lastAutoClosedAt || 0;
                const profit = data.closed_profit || 0;

                // ★ 중복 방지: 1초 이내 같은 청산이면 무시
                const timeDiff = Math.abs(closedAt - lastClosedAt);
                const isDuplicate = timeDiff < 1;

                if (!isDuplicate) {
                    window._lastAutoClosedAt = closedAt;
                    console.log('[fetchDemoData] 🎯 AUTO CLOSED!', { profit, closedAt });

                    playSound('close');

                    const isWin = data.is_win !== false && profit >= 0;

                    // 마틴 모드
                    if (currentMode === 'martin' && martinEnabled) {
                        if (isWin) {
                            martinStep = 1;
                            martinAccumulatedLoss = 0;
                            martinHistory = [];
                            updateMartinUI();
                            showMartinSuccessPopup(profit);
                        } else if (data.martin_reset && !isWin) {
                            const totalLoss = data.martin_accumulated_loss || martinAccumulatedLoss;
                            martinStep = 1;
                            martinAccumulatedLoss = 0;
                            martinHistory = [];
                            updateMartinUI();
                            showMaxPopup(totalLoss);
                        } else if (data.martin_step_up) {
                            // ★★★ 유저 청산 or 최근 주문만 팝업 ★★★
                            if (window._userClosing || (Date.now() - (window._lastOrderTime || 0) < 60000)) {
                                showMartinPopup(profit);
                            } else {
                                console.log('[WS Demo sync] 마틴 팝업 무시 — 유저 청산 아님');
                            }
                        } else {
                            if (window._userClosing || (Date.now() - (window._lastOrderTime || 0) < 60000)) {
                                showMartinPopup(profit);
                            } else {
                                console.log('[WS Demo sync] 마틴 팝업 무시 — 유저 청산 아님');
                            }
                        }
                    } else {
                        // ★★★ Basic/NoLimit 모드 — 2단계 알림 ★★★
                        showToast('포지션이 청산되었습니다', 'success');
                        setTimeout(async () => {
                            try {
                                const histResp = await apiCall('/demo/history?period=today');
                                if (histResp && histResp.trades && histResp.trades.length > 0) {
                                    const actualProfit = histResp.trades[0].profit || 0;
                                    if (actualProfit >= 0) {
                                        showToast(`청산 손익: +$${actualProfit.toFixed(2)}`, 'success');
                                    } else {
                                        showToast(`청산 손익: -$${Math.abs(actualProfit).toFixed(2)}`, 'error');
                                    }
                                }
                                if (typeof loadHistory === 'function') {
                                    loadHistory();
                                }
                            } catch (e) {
                                console.error('[Demo auto_closed] History fetch error:', e);
                            }
                        }, 2000);
                    }

                    // Today P/L 업데이트
                    updateTodayPL(profit);

                    // 포지션 UI 업데이트
                    updatePositionUI(false, null);

                    // ★★★ Quick&Easy 패널 청산 연동 (magic=100003) ★★★
                    if (data.magic == 100003 && typeof QuickEasyPanel !== 'undefined') {
                        const closedSym = data.symbol || '';
                        const curSym = window.currentSymbol || 'BTCUSD';
                        if (closedSym === curSym || QuickEasyPanel._posSymbol === closedSym) {
                            console.log('[fetchDemoData] 🎯 Quick&Easy auto_closed (현재 종목):', closedSym);
                            QuickEasyPanel.hidePositionView(true);
                        } else {
                            console.log('[fetchDemoData] 🎯 Quick&Easy auto_closed (다른 종목):', closedSym);
                            delete QuickEasyPanel._positions[closedSym];
                            QuickEasyPanel._updatePositionBadge();
                        }
                    }
                }
                }  // ★ wsConnectionStartTime 체크 else 블록 닫기
            }

            // Home 탭 업데이트 - ★ WS 연결 중이면 건너뛰기 (깜빡임 방지)
            if (!wsActive) {
            const homeBalance = document.getElementById('homeBalance');
            const homeBroker = document.getElementById('homeBroker');
            const homeAccount = document.getElementById('homeAccount');
            const homeLeverage = document.getElementById('homeLeverage');
            const homeServer = document.getElementById('homeServer');
            const homeEquity = document.getElementById('homeEquity');
            const homeFreeMargin = document.getElementById('homeFreeMargin');
            const homePositions = document.getElementById('homePositions');
            const tradeBalance = document.getElementById('tradeBalance');

            if (homeBalance) homeBalance.textContent = '$' + (data.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            if (homeBroker) homeBroker.textContent = data.broker || 'Demo';
            if (homeAccount) homeAccount.textContent = data.account || 'DEMO';
            if (homeLeverage) homeLeverage.textContent = '1:' + (data.leverage || 500);
            if (homeServer) homeServer.textContent = data.server || 'Demo';
            if (homeEquity) homeEquity.textContent = '$' + (data.equity || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            if (homeFreeMargin) homeFreeMargin.textContent = '$' + (data.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            if (homePositions) homePositions.textContent = data.positions_count || 0;
            if (tradeBalance) tradeBalance.textContent = '$' + Math.round(data.balance || 0).toLocaleString();
            } // ★ end wsActive guard (Home/Trade balance)

            // Account 탭 + 포지션 업데이트 - ★ WS 연결 중이면 건너뛰기
            if (!wsActive) {
            const accBalance = document.getElementById('accBalance');
            const accEquity = document.getElementById('accEquity');
            const accMargin = document.getElementById('accMargin');
            const accFree = document.getElementById('accFree');
            const accCurrentPL = document.getElementById('accCurrentPL');

            if (accBalance) accBalance.textContent = '$' + (data.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            if (accEquity) accEquity.textContent = '$' + (data.equity || 0).toLocaleString(undefined, {minimumFractionDigits: 2});

            // Demo 마진: 포지션에서 직접 합산
            let totalMargin = 0;
            if (data.position && data.position.margin) {
                totalMargin = data.position.margin;
            } else if (data.positions && data.positions.length > 0) {
                data.positions.forEach(pos => {
                    totalMargin += pos.margin || 0;
                });
            }

            // Used Margin (사용중인 마진)
            if (accMargin) {
                accMargin.textContent = '$' + totalMargin.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            }
            // Free Margin (여유 마진 = Balance - Used Margin)
            if (accFree) {
                const freeMargin = (data.balance || 0) - totalMargin;
                accFree.textContent = '$' + Math.round(freeMargin).toLocaleString();
            }

            // ★ Open Positions 탭 업데이트
            if (typeof OpenPositions !== 'undefined' && data.positions) {
                OpenPositions.updatePositions(data.positions);
            }

            // Current P&L 업데이트 (전체 포지션 손익 — positions 배열 전체 합산)
            if (accCurrentPL) {
                let currentProfit = 0;
                if (data.positions && data.positions.length > 0) {
                    currentProfit = data.positions.reduce((sum, pos) => sum + (pos.profit || 0), 0);
                } else if (data.position) {
                    currentProfit = data.position.profit || 0;
                }

                if (currentProfit > 0) {
                    accCurrentPL.textContent = '+$' + currentProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
                    accCurrentPL.style.color = 'var(--buy-color)';
                } else if (currentProfit < 0) {
                    accCurrentPL.textContent = '-$' + Math.abs(currentProfit).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
                    accCurrentPL.style.color = 'var(--sell-color)';
                } else {
                    accCurrentPL.textContent = '$0.00';
                    accCurrentPL.style.color = 'var(--text-primary)';
                }
            }

            // 포지션 정보
            if (data.position) {
                console.log('[fetchDemoData] ✅ Position exists! (polling fallback)');
                window.currentProfit = data.position.profit || 0;
                window.currentTarget = data.position.target || targetAmount;
                updatePositionUI(true, data.position);
            } else {
                console.log('[fetchDemoData] ❌ No position (polling fallback)');
                window.currentProfit = 0;
                window.currentTarget = 0;
                updatePositionUI(false, null);
                isClosing = false;
            }
            } // ★ end wsActive guard (Account + Position)
            
            // Quick 패널 업데이트 (Quick 패널이 활성화된 경우)
            const quickPanel = document.getElementById('quickPanel');
            if (quickPanel && quickPanel.classList.contains('active')) {
                updateQuickPanelFromData(data);
            }

            // ★★★ 인디케이터 업데이트 (1~3초 랜덤 간격 큐에 위임) ★★★
            try {
                const indResponse = await fetch(`${API_URL}/mt5/indicators/${currentSymbol || 'BTCUSD'}`);
                const indData = await indResponse.json();
                if (indData) {
                    queueIndicatorUpdate(indData.buy || 33, indData.sell || 33, indData.neutral || 34);
                }
            } catch (e) {
                console.log('[fetchDemoData] Indicator fetch error:', e);
            }
            
            // Demo 마틴 상태 조회 (변경된 경우에만 업데이트)
            if (currentMode === 'martin' && martinEnabled) {
                console.log("[checkUserMode] About to try connectWebSocket - Live mode");
            try {
                    const martinRes = await fetch(`${API_URL}/demo/martin/state?magic=100001`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const martinData = await martinRes.json();
                    
                    if (martinData) {
                        // 값이 변경된 경우에만 업데이트 (깜빡임 방지)
                        const newStep = martinData.step || 1;
                        const newLoss = martinData.accumulated_loss || 0;
                        
                        if (martinStep !== newStep || martinAccumulatedLoss !== newLoss) {
                            martinStep = newStep;
                            martinAccumulatedLoss = newLoss;
                            martinLevel = martinData.max_steps || 5;
                            lotSize = martinData.base_lot || 0.01;
                            
                            document.getElementById('tradeLotSize').textContent = martinData.current_lot?.toFixed(2) || lotSize.toFixed(2);
                            updateMartinUI();
                        }
                    }
                } catch (e) {
                    console.log('Martin state error:', e);
                }
            }
        }
    } catch (error) {
        console.error("[checkUserMode] Error:", error);
        console.error('[fetchDemoData] ❌ ERROR:', error);
    }

    console.log('[fetchDemoData] 🔴 END');
    
    // 패널 동기화 (Today P/L 등)
    if (typeof syncAccountInfoToPanels === 'function') {
        syncAccountInfoToPanels();
    }
}

// Initialize
console.log('[Init] Starting connection.js - isGuest:', isGuest, 'token:', !!token);
if (!isGuest && token) {
    // 로그인 사용자 - Demo인지 Live인지 확인
    console.log('[Init] Calling checkUserMode()');
    checkUserMode();
} else if (isGuest) {
    console.log('[Init] Guest mode');
    // 게스트 모드 - 데모 데이터 표시
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
    
    // 게스트 모드 인디케이터 업데이트
    // ★★★ 게스트 모드 인디케이터 (1~3초 랜덤 간격 큐에 위임) ★★★
    async function fetchGuestIndicators() {
        try {
            const response = await fetch(`${API_URL}/mt5/indicators/BTCUSD`);
            const data = await response.json();
            if (data) {
                queueIndicatorUpdate(data.buy || 33, data.sell || 33, data.neutral || 34);
            }
        } catch (e) {
            console.log('Guest indicator error:', e);
        }
    }

    fetchGuestIndicators();
    setInterval(fetchGuestIndicators, 5000);  // 5초마다 API 조회
    
    // 게스트 안내 토스트
    setTimeout(() => {
        showToast('게스트 모드로 둘러보는 중입니다', 'info');
    }, 1000);
    
    updateHeroCTA('guest');
}

// Profile name
const userEmail = localStorage.getItem('user_email');
if (userEmail) {
    document.getElementById('profileName').textContent = userEmail.split('@')[0];
}

// 인사말 업데이트
updateGreeting();
setInterval(updateGreeting, 60000);

// 프로모션 슬라이더 이벤트
document.getElementById('promoSlider')?.addEventListener('scroll', function() {
    const slider = this;
    const scrollLeft = slider.scrollLeft;
    const cardWidth = slider.querySelector('.promo-card')?.offsetWidth || 0;
    const gap = 12;
    const index = Math.round(scrollLeft / (cardWidth + gap));
    updatePromoDots(index);
});

// ========== Trading Mode 전환 ==========
function switchTradingMode(mode) {
    const demoBtn = document.getElementById('modeDemoBtn');
    const liveBtn = document.getElementById('modeLiveBtn');
    const demoCheck = document.getElementById('demoCheck');
    const liveCheck = document.getElementById('liveCheck');
    const modeStatus = document.getElementById('modeStatus');
    const modeBadge = document.getElementById('modeBadge');
    
    if (mode === 'demo') {
        // Demo 모드로 전환
        demoBtn.classList.add('active');
        demoBtn.classList.remove('live-active');
        liveBtn.classList.remove('active', 'live-active');
        demoCheck.style.display = 'flex';
        liveCheck.style.display = 'none';
        
        modeStatus.className = 'mode-status';
        modeStatus.innerHTML = '<span class="mode-status-dot demo"></span><span>Currently in <strong>Demo Mode</strong> - Practice with virtual $10,000</span>';
        
        // 배지 업데이트
        if (modeBadge) {
            modeBadge.textContent = 'DEMO';
            modeBadge.className = 'mode-badge-demo';
            modeBadge.style.display = 'inline';
        }
        
        // ★ Hero 배지 업데이트 추가
        const heroBadge = document.getElementById('heroModeBadge');
        if (heroBadge) {
            heroBadge.textContent = 'Trading-X Demo';
            heroBadge.style.color = '#ffffff';
        }
        
        // Demo Control 표시
        const demoControl = document.getElementById('demoControlCard');
        if (demoControl) demoControl.style.display = 'block';
        
        isDemo = true; window.isDemo = true;
        // ★★★ 모드 전환 시 히스토리 캐시 + 패널 리셋 ★★★
        window._weekHistoryData = null;
        window._todayPLFixed = null;
        if (typeof resetTradingPanel === 'function') resetTradingPanel();
        // ★★★ Open Positions 초기화 (이전 모드 포지션 잔류 방지) ★★★
        if (typeof OpenPositions !== 'undefined' && OpenPositions.clearAll) {
            OpenPositions.clearAll();
        }
        // ★ 이지패널 포지션 뷰 초기화 (이전 모드 포지션 잔류 방지)
        if (typeof QuickEasyPanel !== 'undefined') {
            QuickEasyPanel._positions = {};  // ★ 모든 종목 포지션 초기화
            if (typeof QuickEasyPanel._updatePositionBadge === 'function') {
                QuickEasyPanel._updatePositionBadge();  // ★ 뱃지 숫자 초기화
            }
            QuickEasyPanel.hidePositionView();
            if (typeof QeTickChart !== 'undefined') QeTickChart._pendingEntryLine = null;
        }
        showToast('Demo 모드로 전환되었습니다', 'demo');
        updateHeroCTA('demo_with_live');

        // ★ WebSocket 재연결 (Live → Demo URL로 변경)
        if (ws) {
            intentionalClose = true;
            ws.close();
        }
        reconnectAttempt = 0;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        console.log("[WS] Switching to Demo WebSocket...");
        setTimeout(() => {
            connectWebSocket();
            // ★★★ softRefresh로 통합 (쿨다운 리셋) ★★★
            _lastSoftRefreshAt = 0;
            softRefresh('mode_switch_demo');
        }, 100);

        // V5 패널 업데이트
        setTimeout(() => {
            if (typeof updateMultiOrderPanelV5 === 'function') updateMultiOrderPanelV5();
        }, 500);
        
    } else if (mode === 'live') {
        // Live 모드 전환 시도
        // MT5 계정 연결 확인 필요
        if (!token) {
            showToast('로그인이 필요합니다', 'error');
            return;
        }
        
        // MT5 연결 확인 API 호출
        checkMT5Connection().then(hasMT5 => {
            if (hasMT5) {
                // Live 모드로 전환
                liveBtn.classList.add('active', 'live-active');
                demoBtn.classList.remove('active');
                liveCheck.style.display = 'flex';
                demoCheck.style.display = 'none';
                
                modeStatus.className = 'mode-status live';
                modeStatus.innerHTML = '<span class="mode-status-dot live"></span><span>Currently in <strong>Live Mode</strong> - Real trading active</span>';
                
                // 배지 업데이트
                if (modeBadge) {
                    modeBadge.textContent = 'LIVE';
                    modeBadge.className = 'mode-badge-live';
                    modeBadge.style.display = 'inline';
                }
                
                // ★ Hero 배지 업데이트 추가
                const heroBadge = document.getElementById('heroModeBadge');
                if (heroBadge) {
                    heroBadge.textContent = 'Trading-X Live';
                    heroBadge.style.color = '#ffffff';
                }
                
                // Demo Control 숨기기
                const demoControl = document.getElementById('demoControlCard');
                if (demoControl) demoControl.style.display = 'none';
                
                isDemo = false; window.isDemo = false;
                // ★★★ 모드 전환 시 히스토리 캐시 + 패널 리셋 ★★★
                window._weekHistoryData = null;
                window._todayPLFixed = null;
                if (typeof resetTradingPanel === 'function') resetTradingPanel();
                // ★★★ Open Positions 초기화 (이전 모드 포지션 잔류 방지) ★★★
                if (typeof OpenPositions !== 'undefined' && OpenPositions.clearAll) {
                    OpenPositions.clearAll();
                }
                // ★ 이지패널 포지션 뷰 초기화 (이전 모드 포지션 잔류 방지)
                if (typeof QuickEasyPanel !== 'undefined') {
                    QuickEasyPanel._positions = {};  // ★ 모든 종목 포지션 초기화
                    if (typeof QuickEasyPanel._updatePositionBadge === 'function') {
                        QuickEasyPanel._updatePositionBadge();  // ★ 뱃지 숫자 초기화
                    }
                    QuickEasyPanel.hidePositionView();
                    if (typeof QeTickChart !== 'undefined') QeTickChart._pendingEntryLine = null;
                }
                showToast('Live 모드로 전환되었습니다', 'success');
                updateHeroCTA('live');

                // ★★★ MT5 계정 연결 상태 UI 즉시 갱신 ★★★
                setTimeout(function() {
                    if (typeof checkAndUpdateMT5Status === 'function') {
                        checkAndUpdateMT5Status();
                    }
                }, 500);

                // ★ WebSocket 재연결 (Demo → Live URL로 변경)
                if (ws) {
                    intentionalClose = true;
                    ws.close();
                }
                reconnectAttempt = 0;
                if (reconnectTimer) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }
                console.log("[WS] Switching to Live WebSocket...");
                setTimeout(() => {
                    connectWebSocket();
                    // ★★★ softRefresh로 통합 (쿨다운 리셋) ★★★
                    _lastSoftRefreshAt = 0;
                    softRefresh('mode_switch_live');
                }, 100);

                // V5 패널 업데이트
                setTimeout(() => {
                    if (typeof updateMultiOrderPanelV5 === 'function') updateMultiOrderPanelV5();
                }, 500);
                
            } else {
                showToast('MT5 계정을 먼저 연결해주세요', 'error');
                // MT5 연결 섹션으로 스크롤
                document.getElementById('mt5AccountSection')?.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }
}

async function checkMT5Connection() {
    try {
        const response = await fetch(`${API_URL}/demo/account-info`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (data.has_mt5) {
            try {
                const mt5Response = await fetch(`${API_URL}/mt5/account-info`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const mt5Data = await mt5Response.json();
                updateMT5AccountUI(true, {
                    broker: mt5Data.broker,
                    account: mt5Data.account,
                    server: mt5Data.server,
                    leverage: mt5Data.leverage
                });
            } catch (e2) {
                updateMT5AccountUI(true, {
                    broker: data.broker || 'Live Account',
                    account: data.account || '-',
                    server: data.server || '-',
                    leverage: data.leverage || 500
                });
            }
        }

        return data.has_mt5 || false;
    } catch (e) {
        return false;
    }
}

// 초기 모드 상태 반영
function initTradingModeUI() {
    if (isDemo) {
        switchTradingMode('demo');
    } else {
        const liveBtn = document.getElementById('modeLiveBtn');
        const demoBtn = document.getElementById('modeDemoBtn');
        const liveCheck = document.getElementById('liveCheck');
        const demoCheck = document.getElementById('demoCheck');
        const modeStatus = document.getElementById('modeStatus');
        
        if (liveBtn && demoBtn) {
            liveBtn.classList.add('active', 'live-active');
            demoBtn.classList.remove('active');
            liveCheck.style.display = 'flex';
            demoCheck.style.display = 'none';
            
            modeStatus.className = 'mode-status live';
            modeStatus.innerHTML = '<span class="mode-status-dot live"></span><span>Currently in <strong>Live Mode</strong> - Real trading active</span>';
        }
    }
}

// ========== MT5 Account 관리 ==========
function updateMT5AccountUI(hasMT5, mt5Data = null) {
    const notConnected = document.getElementById('mt5NotConnected');
    const connected = document.getElementById('mt5Connected');
    
    if (hasMT5 && mt5Data) {
        // 연결됨 상태 표시
        notConnected.style.display = 'none';
        connected.style.display = 'block';
        
        document.getElementById('mt5Broker').textContent = mt5Data.broker || '-';
        document.getElementById('mt5Account').textContent = mt5Data.account || '-';
        document.getElementById('mt5Server').textContent = mt5Data.server || '-';
        document.getElementById('mt5Leverage').textContent = mt5Data.leverage ? `1:${mt5Data.leverage}` : '-';
    } else {
        // 연결 안 됨 상태 표시
        notConnected.style.display = 'block';
        connected.style.display = 'none';
    }
}

async function disconnectMT5() {
    if (!confirm('MT5 계좌 연결을 해제하시겠습니까?')) return;
    
    console.log("[checkUserMode] About to try connectWebSocket - Live mode");
            try {
        const response = await fetch(`${API_URL}/mt5/disconnect`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (data.success) {
            updateMT5AccountUI(false);
            switchTradingMode('demo');
            stopMetaAPIStatusPoll();
            showToast('MT5 계좌 연결이 해제되었습니다', 'success');
        } else {
            showToast(data.message || '연결 해제 실패', 'error');
        }
    } catch (e) {
        console.error('Disconnect error:', e);
        showToast('연결 해제 실패', 'error');
    }
}

// MT5 상태 확인 및 UI 업데이트
async function checkAndUpdateMT5Status() {
    console.log("[checkUserMode] About to try connectWebSocket - Live mode");
            try {
        const response = await fetch(`${API_URL}/demo/account-info`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (data.has_mt5) {
            // MT5 정보 조회
            const mt5Response = await fetch(`${API_URL}/mt5/account-info`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const mt5Data = await mt5Response.json();
            
            updateMT5AccountUI(true, {
                broker: mt5Data.broker,
                account: mt5Data.account,
                server: mt5Data.server,
                leverage: mt5Data.leverage
            });

            // ★★★ MetaAPI 상태 체크 ★★★
            checkMetaAPIStatus();
        } else {
            updateMT5AccountUI(false);
        }
    } catch (e) {
        updateMT5AccountUI(false);
    }
}

// 페이지 로드 시 MT5 상태 확인
if (token && !isGuest) {
    checkAndUpdateMT5Status();
}

// ========== MT5 연결 모달 ==========
function openMT5ConnectModal() {
    document.getElementById('mt5ConnectModal').classList.add('show');
    showMT5Step1();
}

function closeMT5ConnectModal() {
    document.getElementById('mt5ConnectModal').classList.remove('show');
}

function showMT5Step1() {
    document.getElementById('mt5Step1').style.display = 'block';
    document.getElementById('mt5Step2Existing').style.display = 'none';
    document.getElementById('mt5Step2New').style.display = 'none';
}

function showMT5Step2(type) {
    document.getElementById('mt5Step1').style.display = 'none';
    if (type === 'existing') {
        document.getElementById('mt5Step2Existing').style.display = 'block';
        document.getElementById('mt5Step2New').style.display = 'none';
    } else {
        document.getElementById('mt5Step2Existing').style.display = 'none';
        document.getElementById('mt5Step2New').style.display = 'block';
    }
}

function openMT5GuideModal() {
    openMT5ConnectModal();
    showMT5Step2('new');
}

async function connectMT5Account() {
    const server = document.getElementById('mt5Server').value;
    const account = document.getElementById('mt5AccountNumber').value;
    const password = document.getElementById('mt5Password').value;
    const connectBtn = document.getElementById('mt5ConnectBtn');

    if (!account || !password) {
        showToast('계좌번호와 비밀번호를 입력하세요', 'error');
        return;
    }

    // 버튼 비활성화 + 로딩 메시지
    if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.textContent = '연결 확인중입니다...';
        connectBtn.style.opacity = '0.7';
        connectBtn.style.cursor = 'not-allowed';
    }

    try {
        // 실제 API 호출
        const response = await fetch(`${API_URL}/mt5/connect`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ server, account, password })
        });
        const result = await response.json();

        if (result.success) {
            closeMT5ConnectModal();
            
            // 성공 모달 표시
            document.getElementById('successAccount').textContent = account;
            document.getElementById('successServer').textContent = server || 'HedgeHood-MT5';
            document.getElementById('mt5SuccessModal').classList.add('show');
            
            // MT5 연결 상태 업데이트
            updateMT5AccountUI(true, {
                broker: 'HedgeHood Pty Ltd',
                account: account,
                server: server || 'HedgeHood-MT5',
                leverage: 500
            });
            
            // Live 모드로 전환
            isDemo = false;
            if (typeof resetTradingPanel === 'function') resetTradingPanel();

            // 배지 업데이트
            const modeBadge = document.getElementById('modeBadge');
            if (modeBadge) {
                modeBadge.textContent = 'LIVE';
                modeBadge.className = 'mode-badge-live';
            }
            
            // Hero 배지 업데이트
            const heroBadge = document.getElementById('heroModeBadge');
            if (heroBadge) {
                heroBadge.textContent = 'Trading-X Live';
                heroBadge.style.background = 'linear-gradient(135deg, rgba(0, 255, 136, 0.2) 0%, rgba(0, 255, 136, 0.05) 100%)';
                heroBadge.style.borderColor = 'rgba(0, 255, 136, 0.4)';
                heroBadge.style.color = '#00ff88';
            }
            
            // Trading Mode UI 업데이트
            const liveBtn = document.getElementById('modeLiveBtn');
            const demoBtn = document.getElementById('modeDemoBtn');
            const liveCheck = document.getElementById('liveCheck');
            const demoCheck = document.getElementById('demoCheck');
            const modeStatus = document.getElementById('modeStatus');
            const demoControl = document.getElementById('demoControlCard');
            
            if (liveBtn && demoBtn) {
                liveBtn.classList.add('active', 'live-active');
                demoBtn.classList.remove('active');
                liveCheck.style.display = 'flex';
                demoCheck.style.display = 'none';
                modeStatus.className = 'mode-status live';
                modeStatus.innerHTML = '<span class="mode-status-dot live"></span><span>Currently in <strong>Live Mode</strong> - Real trading active</span>';
            }
            if (demoControl) demoControl.style.display = 'none';
            
            // WebSocket 재연결 (Demo → Live URL로 변경)
            if (ws) {
                intentionalClose = true;  // ★ onclose에서 재연결 방지
                ws.close();
            }
            // ★ 재연결 카운터 리셋
            reconnectAttempt = 0;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            console.log("[WS] Switching to Live WebSocket...");
            setTimeout(() => {
                connectWebSocket();
            }, 100);  // ★ 약간의 딜레이 후 연결
            
            // Live 데이터 조회 시작
            fetchAccountData();
            // ★ 폴링은 ws.onclose에서 자동 시작됨 (중복 방지)

            showToast('MT5 계정 연결 중...\n잠시만 기다려주세요', 'info');

            // ★★★ MetaAPI 프로비저닝 상태 폴링 시작 ★★★
            startMetaAPIStatusPoll();

        } else {
            // 연결 실패 시 서버 메시지 표시
            const errorMsg = result.message || '계좌번호 또는 비밀번호가 올바르지 않습니다.';
            console.error('[MT5 Connect] 실패:', errorMsg);
            showToast(errorMsg, 'error');
        }

    } catch (error) {
        console.error('MT5 Connect error:', error);
        showToast('서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.', 'error');
    } finally {
        // 버튼 상태 복원
        if (connectBtn) {
            connectBtn.disabled = false;
            connectBtn.innerHTML = '연결하기';
            connectBtn.style.opacity = '1';
            connectBtn.style.cursor = 'pointer';
        }
    }
}

function closeMT5SuccessModal() {
    document.getElementById('mt5SuccessModal').classList.remove('show');
}

// ========== MetaAPI 프로비저닝 상태 폴링 ==========
let _metaapiPollTimer = null;

function startMetaAPIStatusPoll() {
    // 기존 타이머 정리
    if (_metaapiPollTimer) {
        clearInterval(_metaapiPollTimer);
        _metaapiPollTimer = null;
    }

    console.log('[MetaAPI] 프로비저닝 상태 폴링 시작');

    // 즉시 1회 체크
    checkMetaAPIStatus();

    // 3초마다 체크
    _metaapiPollTimer = setInterval(() => {
        checkMetaAPIStatus();
    }, 3000);
}

function stopMetaAPIStatusPoll() {
    if (_metaapiPollTimer) {
        clearInterval(_metaapiPollTimer);
        _metaapiPollTimer = null;
        console.log('[MetaAPI] 폴링 중지');
    }
}

async function checkMetaAPIStatus() {
    try {
        const response = await fetch(`${API_URL}/mt5/metaapi-status`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (!data.success) return;

        const status = data.metaapi_status;
        console.log(`[MetaAPI] 상태: ${status}`);

        // 성공 모달 내 상태 업데이트
        const modalStatusText = document.getElementById('metaapiStatusText');
        const successMsg = document.getElementById('successMessage');

        // MT5 연결 영역 상태 업데이트
        const mt5StatusEl = document.getElementById('mt5MetaapiStatus');

        if (status === 'deployed') {
            // ✅ 준비 완료
            if (modalStatusText) {
                modalStatusText.innerHTML = '<span style="color: #00ff88;">✅ 준비 완료</span>';
            }
            if (successMsg) {
                successMsg.innerHTML = '💎 거래 준비 완료! 지금 바로 거래를 시작하세요!';
                successMsg.style.color = '#00ff88';
            }
            if (mt5StatusEl) {
                mt5StatusEl.innerHTML = '<span style="color: #00ff88;">Ready</span>';
            }
            stopMetaAPIStatusPoll();

        } else if (status === 'provisioning' || status === 'deploying') {
            // ⏳ 준비중
            if (modalStatusText) {
                modalStatusText.innerHTML = '<span style="color: #f0b90b;">⏳ 준비중...</span>';
            }
            if (successMsg) {
                successMsg.innerHTML = '💎 거래 시스템을 준비하고 있습니다... (1~3분 소요)';
                successMsg.style.color = 'var(--accent-cyan)';
            }
            if (mt5StatusEl) {
                mt5StatusEl.innerHTML = '<span style="color: var(--accent-cyan);">Preparing...</span>';
            }

        } else if (status === 'error') {
            // ❌ 오류 (서버에서 에러 메시지 포함)
            const errorDetail = data.error_message || '거래 시스템 연결에 문제가 발생했습니다.';
            if (modalStatusText) {
                modalStatusText.innerHTML = '<span style="color: #ff4444;">❌ 연결 실패</span>';
            }
            if (successMsg) {
                successMsg.innerHTML = `⚠️ ${errorDetail}`;
                successMsg.style.color = '#ff4444';
            }
            // ★ 에러 토스트도 표시
            showToast(`❌ ${errorDetail}`, 'error');
            if (mt5StatusEl) {
                mt5StatusEl.innerHTML = '<span style="color: var(--accent-cyan);">Connecting...</span>';
            }
            stopMetaAPIStatusPoll();

        } else if (status === 'undeployed') {
            // 비활성 (재연결 시)
            if (mt5StatusEl) {
                mt5StatusEl.innerHTML = '<span style="color: var(--text-muted);">Standby</span>';
            }

        } else {
            // none 또는 기타 - MT5 연결된 경우 Waiting, 아니면 -
            if (mt5StatusEl) {
                if (data.has_mt5_account) {
                    mt5StatusEl.innerHTML = '<span style="color: var(--accent-cyan);">Connecting...</span>';
                } else {
                    mt5StatusEl.innerHTML = '<span style="color: var(--text-muted);">-</span>';
                }
            }
        }

        // ★★★ 개인 MetaAPI가 없어도 공유 MetaAPI로 연결되면 Ready 표시 ★★★
        if (status !== 'deployed' && window._metaapiConnected === true && mt5StatusEl) {
            mt5StatusEl.innerHTML = '<span style="color: #00ff88;">Ready</span>';
        }

    } catch (e) {
        console.error('[MetaAPI] 상태 확인 실패:', e);
    }
}

// ========== 히어로 섹션 CTA 업데이트 ==========
function updateHeroCTA(mode) {
    const ctaDesc = document.querySelector('.live-cta-desc');
    const ctaBtn = document.querySelector('.live-cta-btn');
    if (!ctaDesc || !ctaBtn) return;
    
    if (mode === 'guest') {
        // 게스트 모드
        ctaDesc.innerHTML = '<span style="color: #ffffff; font-size: 16px; font-weight: 600;">부담 없이 체험해보세요!</span><br>가입 후 데모자금으로 자유롭게 연습 해 보세요!';
        ctaBtn.innerHTML = '<span class="material-icons-round">person_add</span>무료체험 시작';
        ctaBtn.className = 'live-cta-btn';
        ctaBtn.onclick = function() { window.location.href = 'register.html'; };
    } else if (mode === 'demo') {
        // 로그인 + 라이브 미연결
        ctaDesc.innerHTML = '라이브 계좌를 연결하고<br>실거래를 시작하세요!';
        ctaBtn.innerHTML = '<span class="material-icons-round">link</span>라이브 계좌 연결';
        ctaBtn.className = 'live-cta-btn';
        ctaBtn.onclick = function() { scrollToMT5Section(); };
    } else if (mode === 'demo_with_live') {
        // 로그인 + 라이브 연결 O + 데모 모드 (랜덤 멘트)
        const messages = [
            {
                desc: '안전하게 연습 중! 💪<br>실거래 준비되면 라이브로 전환하세요',
                btn: '라이브 모드 시작'
            },
            {
                desc: '좋아요! 충분히 연습하고 계시네요 👍<br>준비되면 실거래를 시작해보세요',
                btn: '라이브 모드 전환'
            }
        ];
        const random = messages[Math.floor(Math.random() * messages.length)];
        ctaDesc.innerHTML = random.desc;
        ctaBtn.innerHTML = '<span class="material-icons-round">swap_horiz</span>' + random.btn;
        ctaBtn.className = 'live-cta-btn';
        ctaBtn.onclick = function() { switchTradingMode('live'); };
    } else if (mode === 'live') {
        // 로그인 + 라이브 연결
        ctaDesc.innerHTML = '실거래 준비 완료!<br>오늘도 성공적인 트레이딩 되세요 💪';
        ctaBtn.innerHTML = '<span class="material-icons-round">trending_up</span>거래 시작하기';
        ctaBtn.className = 'live-cta-btn success';
        ctaBtn.onclick = function() { switchTab('trading'); };
    }
}
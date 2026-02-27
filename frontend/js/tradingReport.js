// ========================================================
// tradingReport.js — 트레이딩 리포트 전용 모듈
// 의존: my.js (initDetailView에서 호출), connection.js (WS에서 DOM 직접 업데이트)
// 로드 순서: my.js → tradingReport.js
// ========================================================

// ========== 트레이딩 리포트 — 실시간 계좌 데이터 ==========
var _trRefreshTimer = null;

async function loadTradingReportData() {
    var spinBtn = document.getElementById('trRefreshBtn');
    if (spinBtn) { spinBtn.classList.add('spinning'); setTimeout(function(){ spinBtn.classList.remove('spinning'); }, 800); }

    try {
        var tkn = localStorage.getItem('access_token');
        var res = await fetch(API_URL + '/mt5/account-info', {
            headers: { 'Authorization': 'Bearer ' + tkn }
        });
        if (!res.ok) { console.error("[TR] HTTP 에러:", res.status); return; }
        var d = await res.json();

        function fmtUSD(v) { return '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }); }

        // 카드1: 잔고 히어로
        var balEl = document.getElementById('trLiveBalance');
        if (balEl) balEl.textContent = fmtUSD(d.balance);

        var eqEl = document.getElementById('trLiveEquity');
        if (eqEl) eqEl.textContent = fmtUSD(d.equity);

        var mEl = document.getElementById('trLiveMargin');
        if (mEl) mEl.textContent = fmtUSD(d.margin);

        var pEl = document.getElementById('trLiveProfit');
        if (pEl) {
            var profit = Number(d.profit || d.current_pl || 0);
            // 번쩍임 방지
            if (profit === 0 && pEl.textContent !== '$0.00' && pEl.textContent !== '$--.--') {
                // 기존값 유지
            } else if (profit === 0) {
                pEl.textContent = '$0.00';
                pEl.className = 'my-live-stat-value';
            } else {
                pEl.textContent = (profit >= 0 ? '+$' : '-$') + Math.abs(profit).toLocaleString('en-US', { minimumFractionDigits: 2 });
                pEl.className = 'my-live-stat-value ' + (profit > 0 ? 'profit-plus' : 'profit-minus');
            }
        }

        // 히어로 카드 브로커명 업데이트
        var bnEl = document.getElementById('trBrokerName');
        if (bnEl) bnEl.textContent = (d.broker || 'HedgeHood').replace(' Pty Ltd', '').replace(' Live', '');

        console.log('[TR] 데이터 로드 완료:', { balance: d.balance, equity: d.equity });
    } catch (e) {
        console.error("[TR] loadTradingReportData 에러:", e);
    }
}

function startTradingReportRefresh() {
    stopTradingReportRefresh();
    loadTradingReportData();
    loadTradingReportSummary();  // ★ Summary 데이터도 함께 로드
    _trRefreshTimer = setInterval(loadTradingReportData, 5000);
    // Summary는 자동 갱신 불필요 (기간 변경 시에만)
}

function stopTradingReportRefresh() {
    if (_trRefreshTimer) { clearInterval(_trRefreshTimer); _trRefreshTimer = null; }
}

// ========== 트레이딩 리포트 — 탭 전환 ==========
function switchTrTab(tab) {
    // 카드 활성화 토글
    document.querySelectorAll('.tr-tab-card').forEach(function(c) { c.classList.remove('active'); });
    var targetCard = document.getElementById(tab === 'summary' ? 'trTabSummary' : 'trTabAnalysis');
    if (targetCard) targetCard.classList.add('active');

    // 콘텐츠 토글
    document.querySelectorAll('.tr-tab-content').forEach(function(c) { c.classList.remove('active'); });
    var targetContent = document.getElementById(tab === 'summary' ? 'trContentSummary' : 'trContentAnalysis');
    if (targetContent) targetContent.classList.add('active');

    // ★ 분석 탭 클릭 시 데이터 로드
    if (tab === 'analysis') {
        loadAnalysisReport(_trCurrentPeriod);
    }
}

// ========== 트레이딩 리포트 — Summary API 연동 ==========
var _trCurrentPeriod = 'week';

function toggleTrPeriod() {
    var dd = document.getElementById('trPeriodDropdown');
    if (dd) dd.classList.toggle('open');
}

function selectTrPeriod(period, label) {
    _trCurrentPeriod = period;
    var labelEl = document.getElementById('trPeriodLabel');
    if (labelEl) labelEl.textContent = label;

    // 드롭다운 닫기 + 활성 표시
    document.querySelectorAll('.tr-period-option').forEach(function(o) {
        o.classList.toggle('active', o.dataset.period === period);
    });
    document.getElementById('trPeriodDropdown').classList.remove('open');

    // 커스텀 기간 숨기기
    var custom = document.getElementById('trCustomPeriod');
    if (custom) custom.style.display = 'none';

    // 데이터 새로 조회
    loadTradingReportSummary(period);

    // ★ 분석 탭 활성화 되어 있으면 같이 갱신
    var analysisTab = document.getElementById('trContentAnalysis');
    if (analysisTab && analysisTab.classList.contains('active')) {
        loadAnalysisReport(period);
    }
}

function openTrCustomPeriod() {
    document.getElementById('trPeriodDropdown').classList.remove('open');
    var custom = document.getElementById('trCustomPeriod');
    if (custom) custom.style.display = 'flex';

    // 기본값: 최근 7일
    var today = new Date();
    var weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    var endInput = document.getElementById('trEndDate');
    var startInput = document.getElementById('trStartDate');
    if (endInput) endInput.value = today.toISOString().split('T')[0];
    if (startInput) startInput.value = weekAgo.toISOString().split('T')[0];

    var labelEl = document.getElementById('trPeriodLabel');
    if (labelEl) labelEl.textContent = '기간설정';
    document.querySelectorAll('.tr-period-option').forEach(function(o) {
        o.classList.toggle('active', o.dataset.period === 'custom');
    });
}

function applyTrCustomPeriod() {
    var s = document.getElementById('trStartDate').value;
    var e = document.getElementById('trEndDate').value;
    if (!s || !e) return;
    _trCurrentPeriod = 'custom';
    loadTradingReportSummary('custom', s, e);

    // ★ 분석 탭 활성화 되어 있으면 같이 갱신
    var analysisTab = document.getElementById('trContentAnalysis');
    if (analysisTab && analysisTab.classList.contains('active')) {
        loadAnalysisReport('custom', s, e);
    }
}

async function loadTradingReportSummary(period, startDate, endDate) {
    period = period || _trCurrentPeriod;

    // 로딩 표시
    var loading = document.getElementById('trSummaryLoading');
    var card = document.getElementById('trSummaryCard');
    if (loading) loading.style.display = 'flex';
    if (card) card.style.opacity = '0.4';

    try {
        var tkn = localStorage.getItem('access_token');
        var url = API_URL + '/mt5/trading-report-summary?period=' + period;
        if (period === 'custom' && startDate && endDate) {
            url += '&start_date=' + startDate + '&end_date=' + endDate;
        }

        var res = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + tkn }
        });
        if (!res.ok) { console.error('[TR Summary] HTTP 에러:', res.status); return; }
        var d = await res.json();

        function fmtUSD(v) {
            var n = Number(v || 0);
            if (n === 0) return '$0.00';
            var sign = n >= 0 ? '' : '-';
            return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 });
        }
        function fmtPL(v) {
            var n = Number(v || 0);
            if (n === 0) return '$0.00';
            return (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 });
        }
        function plClass(v) {
            var n = Number(v || 0);
            return n > 0 ? 'tr-summary-value tr-val-profit' : n < 0 ? 'tr-summary-value tr-val-loss' : 'tr-summary-value';
        }

        // 데이터 업데이트
        var el;
        el = document.getElementById('trSumBroker');
        if (el) el.textContent = d.broker || '-';

        el = document.getElementById('trSumAccount');
        if (el) el.textContent = d.account || '-';

        el = document.getElementById('trSumInitial');
        if (el) el.textContent = fmtUSD(d.initial_balance);

        el = document.getElementById('trSumTotalPL');
        if (el) { el.textContent = fmtPL(d.total_pl); el.className = plClass(d.total_pl); }

        el = document.getElementById('trSumTradeProfit');
        if (el) { el.textContent = fmtPL(d.trade_profit); el.className = plClass(d.trade_profit); }

        el = document.getElementById('trSumSwap');
        if (el) { el.textContent = fmtPL(d.swap); el.className = plClass(d.swap); }

        el = document.getElementById('trSumCommission');
        if (el) { el.textContent = fmtPL(d.commission); el.className = plClass(d.commission); }

        el = document.getElementById('trSumBalance');
        if (el) el.textContent = fmtUSD(d.current_balance);

        el = document.getElementById('trSumReturn');
        if (el) {
            var rate = Number(d.return_rate || 0);
            el.textContent = (rate >= 0 ? '+' : '') + rate.toFixed(2) + '%';
            el.className = plClass(rate);
        }

        // ★ daily_pl 저장 + 그래프 렌더링 (조회 기간도 전달)
        window._trDailyPL = d.daily_pl || [];
        renderTrChart(window._trDailyPL, d.start_date, d.end_date);

        console.log('[TR Summary] 로드 완료:', d);

    } catch (e) {
        console.error('[TR Summary] 에러:', e);
    } finally {
        if (loading) loading.style.display = 'none';
        if (card) card.style.opacity = '1';
    }
}

// ★ 드롭다운 외부 클릭 시 닫기
document.addEventListener('click', function(e) {
    if (!e.target.closest('.tr-period-selector')) {
        var dd = document.getElementById('trPeriodDropdown');
        if (dd) dd.classList.remove('open');
    }
});

// ========== 트레이딩 리포트 — P&L 그래프 (누적 라인 + 일별 바 결합) ==========
function renderTrChart(dailyData, periodStart, periodEnd) {
    var section = document.getElementById('trChartSection');
    if (!dailyData || dailyData.length === 0) {
        if (section) section.style.display = 'none';
        return;
    }
    if (section) section.style.display = 'block';

    // ★ 상단 요약 업데이트
    var lastCum = dailyData[dailyData.length - 1].cumulative || 0;
    var cumEl = document.getElementById('trChartCumPL');
    if (cumEl) {
        cumEl.textContent = (lastCum >= 0 ? '+' : '-') + Math.abs(lastCum).toLocaleString('en-US', { minimumFractionDigits: 2 });
        cumEl.className = 'tr-chart-summary-val ' + (lastCum > 0 ? 'tr-val-profit' : lastCum < 0 ? 'tr-val-loss' : '');
    }

    var daysEl = document.getElementById('trChartDays');
    if (daysEl) daysEl.textContent = dailyData.length + '일';

    // 최고 수익일 / 최대 손실일
    var bestDay = null, worstDay = null;
    dailyData.forEach(function(d) {
        if (!bestDay || d.total > bestDay.total) bestDay = d;
        if (!worstDay || d.total < worstDay.total) worstDay = d;
    });

    var bestEl = document.getElementById('trChartBestDay');
    if (bestEl && bestDay) {
        bestEl.textContent = '+' + Math.abs(bestDay.total).toLocaleString('en-US', { minimumFractionDigits: 0 });
        bestEl.className = 'tr-chart-summary-val ' + (bestDay.total >= 0 ? 'tr-val-profit' : 'tr-val-loss');
    }
    var worstEl = document.getElementById('trChartWorstDay');
    if (worstEl && worstDay) {
        worstEl.textContent = '-' + Math.abs(worstDay.total).toLocaleString('en-US', { minimumFractionDigits: 0 });
        worstEl.className = 'tr-chart-summary-val tr-val-loss';
    }

    // 기간 표시 (API 조회 기간 사용)
    var periodEl = document.getElementById('trChartPeriod');
    if (periodEl) {
        var startStr = periodStart ? periodStart.substring(5).replace('-', '/') : dailyData[0].date.substring(5).replace('-', '/');
        var endStr = periodEnd ? periodEnd.substring(5).replace('-', '/') : dailyData[dailyData.length - 1].date.substring(5).replace('-', '/');
        periodEl.textContent = startStr + ' — ' + endStr;
    }

    // ★ Canvas 렌더링
    var canvas = document.getElementById('trChartCanvas');
    if (!canvas) return;
    var container = document.getElementById('trChartContainer');
    var dpr = window.devicePixelRatio || 1;
    var W = container.offsetWidth;
    var H = container.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    var n = dailyData.length;
    var padL = 2, padR = 2, padT = 8, padB = 4;
    var chartW = W - padL - padR;
    var chartH = H - padT - padB;

    // 값 범위 계산
    var allVals = [];
    dailyData.forEach(function(d) { allVals.push(d.total, d.cumulative); });
    var maxVal = Math.max.apply(null, allVals);
    var minVal = Math.min.apply(null, allVals);
    // 약간의 여유
    var range = maxVal - minVal || 1;
    maxVal += range * 0.1;
    minVal -= range * 0.1;
    range = maxVal - minVal;

    function yPos(v) { return padT + (1 - (v - minVal) / range) * chartH; }
    var zeroY = yPos(0);

    // 바 너비
    var barGap = Math.max(2, Math.floor(chartW / n * 0.2));
    var barW = Math.max(4, Math.floor((chartW - barGap * (n - 1)) / n));
    if (barW > 28) barW = 28;
    var totalBarArea = barW * n + barGap * (n - 1);
    var startX = padL + (chartW - totalBarArea) / 2;

    // ── 배경 그리드 ──
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (var g = 0; g < 4; g++) {
        var gy = padT + (chartH / 3) * g;
        ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
    }

    // ── 제로 라인 ──
    if (minVal < 0 && maxVal > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(padL, zeroY); ctx.lineTo(W - padR, zeroY); ctx.stroke();
        ctx.setLineDash([]);
    }

    // ── 일별 바 차트 ──
    dailyData.forEach(function(d, i) {
        var x = startX + i * (barW + barGap);
        var val = d.total;
        var top = val >= 0 ? yPos(val) : zeroY;
        var bottom = val >= 0 ? zeroY : yPos(val);
        var h = Math.max(2, bottom - top);

        // 그라디언트
        var grad;
        if (val >= 0) {
            grad = ctx.createLinearGradient(0, top, 0, bottom);
            grad.addColorStop(0, 'rgba(0, 212, 164, 0.6)');
            grad.addColorStop(1, 'rgba(0, 212, 164, 0.15)');
        } else {
            grad = ctx.createLinearGradient(0, top, 0, bottom);
            grad.addColorStop(0, 'rgba(255, 77, 90, 0.15)');
            grad.addColorStop(1, 'rgba(255, 77, 90, 0.6)');
        }
        ctx.fillStyle = grad;

        // 둥근 상단 바
        var radius = Math.min(3, barW / 2);
        ctx.beginPath();
        if (val >= 0) {
            ctx.moveTo(x + radius, top);
            ctx.arcTo(x + barW, top, x + barW, bottom, radius);
            ctx.lineTo(x + barW, bottom);
            ctx.lineTo(x, bottom);
            ctx.arcTo(x, top, x + radius, top, radius);
        } else {
            ctx.moveTo(x, top);
            ctx.lineTo(x + barW, top);
            ctx.arcTo(x + barW, bottom, x, bottom, radius);
            ctx.arcTo(x, bottom, x, top, radius);
        }
        ctx.closePath();
        ctx.fill();
    });

    // ── 누적 P&L 에어리어 ──
    var linePoints = [];
    dailyData.forEach(function(d, i) {
        var x = startX + i * (barW + barGap) + barW / 2;
        var y = yPos(d.cumulative);
        linePoints.push({ x: x, y: y });
    });

    if (linePoints.length > 1) {
        // 에어리어 그라디언트
        var lastPoint = linePoints[linePoints.length - 1];
        var isProfit = lastPoint.y < zeroY;
        var areaGrad = ctx.createLinearGradient(0, padT, 0, H);
        if (isProfit) {
            areaGrad.addColorStop(0, 'rgba(0, 212, 164, 0.15)');
            areaGrad.addColorStop(1, 'rgba(0, 212, 164, 0)');
        } else {
            areaGrad.addColorStop(0, 'rgba(255, 77, 90, 0.12)');
            areaGrad.addColorStop(1, 'rgba(255, 77, 90, 0)');
        }

        // 에어리어 채우기
        ctx.beginPath();
        ctx.moveTo(linePoints[0].x, linePoints[0].y);
        for (var i = 1; i < linePoints.length; i++) {
            // 스무스 커브 (bezier)
            var prev = linePoints[i - 1];
            var curr = linePoints[i];
            var cpx = (prev.x + curr.x) / 2;
            ctx.quadraticCurveTo(prev.x + (cpx - prev.x) * 0.8, prev.y, cpx, (prev.y + curr.y) / 2);
            ctx.quadraticCurveTo(cpx + (curr.x - cpx) * 0.2, curr.y, curr.x, curr.y);
        }
        ctx.lineTo(lastPoint.x, zeroY);
        ctx.lineTo(linePoints[0].x, zeroY);
        ctx.closePath();
        ctx.fillStyle = areaGrad;
        ctx.fill();

        // 라인
        ctx.beginPath();
        ctx.moveTo(linePoints[0].x, linePoints[0].y);
        for (var i = 1; i < linePoints.length; i++) {
            var prev = linePoints[i - 1];
            var curr = linePoints[i];
            var cpx = (prev.x + curr.x) / 2;
            ctx.quadraticCurveTo(prev.x + (cpx - prev.x) * 0.8, prev.y, cpx, (prev.y + curr.y) / 2);
            ctx.quadraticCurveTo(cpx + (curr.x - cpx) * 0.2, curr.y, curr.x, curr.y);
        }
        ctx.strokeStyle = isProfit ? '#00d4a4' : '#ff4d5a';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = isProfit ? 'rgba(0,212,164,0.4)' : 'rgba(255,77,90,0.4)';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // ── 끝점 글로우 도트 ──
        ctx.beginPath();
        ctx.arc(lastPoint.x, lastPoint.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = isProfit ? '#00d4a4' : '#ff4d5a';
        ctx.fill();
        // 외곽 링
        ctx.beginPath();
        ctx.arc(lastPoint.x, lastPoint.y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = isProfit ? 'rgba(0,212,164,0.35)' : 'rgba(255,77,90,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // ── 끝점 금액 라벨 ──
        var labelText = (lastCum >= 0 ? '+' : '-') + Math.abs(lastCum).toLocaleString('en-US', { minimumFractionDigits: 0 });
        ctx.font = '600 11px Rajdhani, sans-serif';
        ctx.fillStyle = isProfit ? '#00d4a4' : '#ff4d5a';
        var labelW = ctx.measureText(labelText).width;
        var labelX = lastPoint.x - labelW - 12;
        if (labelX < padL + 10) labelX = lastPoint.x + 12;
        ctx.fillText(labelText, labelX, lastPoint.y - 10);
    }

    // ── X축 날짜 라벨 ──
    var xAxisEl = document.getElementById('trChartXAxis');
    if (xAxisEl) {
        xAxisEl.innerHTML = '';
        // 최대 7개 라벨만 표시
        var step = Math.max(1, Math.ceil(n / 7));
        for (var i = 0; i < n; i += step) {
            var span = document.createElement('span');
            var dateStr = dailyData[i].date.substring(5).replace('-', '/');
            span.textContent = dateStr;
            xAxisEl.appendChild(span);
        }
        // 마지막 날짜 항상 표시
        if ((n - 1) % step !== 0) {
            var span = document.createElement('span');
            span.textContent = dailyData[n - 1].date.substring(5).replace('-', '/');
            xAxisEl.appendChild(span);
        }
    }
}

// ========== 분석 리포트 — API 연동 + 렌더링 ==========
async function loadAnalysisReport(period, startDate, endDate) {
    period = period || _trCurrentPeriod;

    var loading = document.getElementById('traLoading');
    var content = document.getElementById('traContent');
    if (loading) loading.style.display = 'flex';
    if (content) content.style.display = 'none';

    try {
        var tkn = localStorage.getItem('access_token');
        var url = API_URL + '/mt5/trading-report-analysis?period=' + period;
        if (period === 'custom' && startDate && endDate) {
            url += '&start_date=' + startDate + '&end_date=' + endDate;
        }

        var res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + tkn } });
        if (!res.ok) { console.error('[Analysis] HTTP:', res.status); return; }
        var d = await res.json();

        if (!d.total_count || d.total_count === 0) {
            if (loading) loading.style.display = 'none';
            if (content) { content.style.display = 'block'; content.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.25);font-size:13px;">해당 기간 거래 내역이 없습니다.</div>'; }
            return;
        }

        // 기간 배지
        var badge = document.getElementById('traPeriodBadge');
        if (badge) badge.textContent = (d.start_date || '').substring(5).replace('-','/') + ' — ' + (d.end_date || '').substring(5).replace('-','/');

        function fmtPL(v) { var n = Number(v||0); return (n >= 0 ? '+' : '-') + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits:2}); }
        function plColor(v) { return Number(v||0) >= 0 ? '#00d4a4' : '#ff4d5a'; }

        // ═══ 카드 1: 승률 ═══
        var w = d.winrate || {};
        var el;
        el = document.getElementById('traWinPct'); if (el) el.textContent = (w.rate || 0) + '%';
        el = document.getElementById('traWinRing'); if (el) el.setAttribute('stroke-dasharray', (w.rate || 0) + ' ' + (100 - (w.rate || 0)));
        el = document.getElementById('traWinLabel'); if (el) el.textContent = 'Win ' + (w.win || 0) + '건';
        el = document.getElementById('traLoseLabel'); if (el) el.textContent = 'Lose ' + (w.lose || 0) + '건';
        el = document.getElementById('traWinBar'); if (el) el.style.width = (w.rate || 0) + '%';
        el = document.getElementById('traLoseBar'); if (el) el.style.width = (100 - (w.rate || 0)) + '%';
        el = document.getElementById('traTotal'); if (el) el.textContent = (w.total || 0) + '건';
        el = document.getElementById('traAvgWin'); if (el) el.textContent = fmtPL(w.avg_win);
        el = document.getElementById('traAvgLoss'); if (el) el.textContent = fmtPL(w.avg_loss);
        el = document.getElementById('traRR'); if (el) el.textContent = '1 : ' + (w.rr_ratio || 0);

        // ═══ 카드 2: 종목별 ═══
        var symbolCard = document.getElementById('traSymbolCard');
        if (symbolCard && d.symbols && d.symbols.length > 0) {
            var maxAbs = Math.max.apply(null, d.symbols.map(function(s) { return Math.abs(s.total_pl); })) || 1;
            var html = '';
            d.symbols.forEach(function(s) {
                var pct = Math.min(48, Math.abs(s.total_pl) / maxAbs * 48);
                var isProfit = s.total_pl >= 0;
                var barClass = isProfit ? 'tra-symbol-bar tra-profit-bar' : 'tra-symbol-bar tra-loss-bar';
                var barText = (isProfit ? '+' : '-') + Math.abs(s.total_pl).toLocaleString('en-US', {minimumFractionDigits:0});
                html += '<div class="tra-symbol-row">';
                html += '<div class="tra-symbol-name">' + s.symbol + '</div>';
                html += '<div class="tra-symbol-bar-wrap"><div class="tra-symbol-center-line"></div>';
                html += '<div class="' + barClass + '" style="width:' + pct + '%;">' + barText + '</div></div>';
                html += '<div class="tra-symbol-meta">' + s.count + '건 · ' + s.win_rate + '%</div>';
                html += '</div>';
            });
            symbolCard.innerHTML = html;
        }

        // ═══ 카드 3: Buy/Sell ═══
        var bs = d.buysell || {};
        var buy = bs.buy || {}; var sell = bs.sell || {};
        el = document.getElementById('traBuyCount'); if (el) el.textContent = (buy.count||0) + '건';
        el = document.getElementById('traBuyPL'); if (el) { el.textContent = fmtPL(buy.total_pl); el.style.color = plColor(buy.total_pl); }
        el = document.getElementById('traBuyWinRate'); if (el) { el.textContent = (buy.win_rate||0) + '%'; el.style.color = '#00d4ff'; }
        el = document.getElementById('traBuyAvg'); if (el) { el.textContent = fmtPL(buy.avg_pl); el.style.color = plColor(buy.avg_pl); }
        el = document.getElementById('traSellCount'); if (el) el.textContent = (sell.count||0) + '건';
        el = document.getElementById('traSellPL'); if (el) { el.textContent = fmtPL(sell.total_pl); el.style.color = plColor(sell.total_pl); }
        el = document.getElementById('traSellWinRate'); if (el) { el.textContent = (sell.win_rate||0) + '%'; el.style.color = '#00d4ff'; }
        el = document.getElementById('traSellAvg'); if (el) { el.textContent = fmtPL(sell.avg_pl); el.style.color = plColor(sell.avg_pl); }

        // ═══ 카드 4: 시간대별 ═══
        var hr = d.hourly || {};
        var hours = hr.hours || {};
        var timeChart = document.getElementById('traTimeChart');
        if (timeChart) {
            var maxCount = 0;
            for (var h = 0; h < 24; h++) {
                var hd = hours[String(h)] || {};
                if ((hd.count || 0) > maxCount) maxCount = hd.count;
            }
            maxCount = maxCount || 1;
            var barsHtml = '';
            for (var h = 0; h < 24; h++) {
                var hd = hours[String(h)] || {};
                var cnt = hd.count || 0;
                var pl = hd.pl || 0;
                var heightPct = Math.max(2, cnt / maxCount * 100);
                var color;
                if (cnt === 0) color = 'rgba(255,255,255,0.04)';
                else if (pl > 0) color = 'rgba(0,212,164,' + (0.3 + cnt / maxCount * 0.5) + ')';
                else if (pl < 0) color = 'rgba(255,77,90,' + (0.3 + cnt / maxCount * 0.5) + ')';
                else color = 'rgba(255,255,255,0.06)';
                barsHtml += '<div class="tra-time-bar" style="height:' + heightPct + '%;background:' + color + ';"></div>';
            }
            timeChart.innerHTML = barsHtml;
        }
        el = document.getElementById('traBestHour');
        if (el) el.textContent = (hr.best_hour != null ? String(hr.best_hour).padStart(2,'0') + ':00 ~ ' + String(hr.best_hour+1).padStart(2,'0') + ':00' : '-');
        el = document.getElementById('traWorstHour');
        if (el) el.textContent = (hr.worst_hour != null ? String(hr.worst_hour).padStart(2,'0') + ':00 ~ ' + String(hr.worst_hour+1).padStart(2,'0') + ':00' : '-');

        // ═══ 카드 5: 거래량 ═══
        var vol = d.volume || {};
        el = document.getElementById('traVolTotal'); if (el) el.textContent = (vol.total || 0).toFixed(2);
        el = document.getElementById('traVolAvg'); if (el) el.textContent = (vol.avg || 0).toFixed(2) + ' lot / 건';
        el = document.getElementById('traVolMax'); if (el) el.textContent = (vol.max || 0).toFixed(2) + ' lot';
        el = document.getElementById('traVolMin'); if (el) el.textContent = (vol.min || 0).toFixed(2) + ' lot';
        el = document.getElementById('traVolMaxDetail'); if (el) el.textContent = vol.max_detail || '-';

        // ═══ 카드 6: 리스크 ═══
        var rk = d.risk || {};
        el = document.getElementById('traStreakWin'); if (el) el.textContent = (rk.max_win_streak || 0) + '건';
        el = document.getElementById('traStreakWinPL'); if (el) el.textContent = fmtPL(rk.max_win_streak_pl);
        el = document.getElementById('traStreakLoss'); if (el) el.textContent = (rk.max_loss_streak || 0) + '건';
        el = document.getElementById('traStreakLossPL'); if (el) el.textContent = fmtPL(rk.max_loss_streak_pl);
        el = document.getElementById('traBestDeal'); if (el) el.textContent = fmtPL(rk.best_deal_pl);
        el = document.getElementById('traBestDealDetail'); if (el) el.textContent = rk.best_deal_detail || '-';
        el = document.getElementById('traWorstDeal'); if (el) el.textContent = fmtPL(rk.worst_deal_pl);
        el = document.getElementById('traWorstDealDetail'); if (el) el.textContent = rk.worst_deal_detail || '-';
        el = document.getElementById('traProfitFactor'); if (el) el.textContent = (rk.profit_factor || 0).toFixed(2);

        console.log('[Analysis] 로드 완료:', d.total_count + '건');

    } catch (e) {
        console.error('[Analysis] 에러:', e);
    } finally {
        if (loading) loading.style.display = 'none';
        if (content) content.style.display = 'block';
    }
}

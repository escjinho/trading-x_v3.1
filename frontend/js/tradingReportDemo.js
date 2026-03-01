// ========== Demo Trading Report ==========
var _trdRefreshTimer = null;

async function loadDemoReportData() {
    var spinBtn = document.getElementById('trdRefreshBtn');
    if (spinBtn) { spinBtn.classList.add('spinning'); setTimeout(function(){ spinBtn.classList.remove('spinning'); }, 800); }
    var token = localStorage.getItem('access_token');
    if (!token) return;
    try {
        var res = await fetch(API_URL + '/demo/account-info?mode=demo', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) { console.error("[DemoReport] HTTP error:", res.status); return; }
        var d = await res.json();

        function fmtUSD(v) { return '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }); }

        // 잔고
        var balEl = document.getElementById('trdDemoBalance');
        if (balEl) balEl.textContent = fmtUSD(d.balance);

        // 에쿼티
        var eqEl = document.getElementById('trdDemoEquity');
        if (eqEl) eqEl.textContent = fmtUSD(d.equity);

        // 마진
        var mEl = document.getElementById('trdDemoMargin');
        if (mEl) mEl.textContent = fmtUSD(d.margin);

        // Current P/L (Live와 동일 로직)
        var pEl = document.getElementById('trdDemoProfit');
        if (pEl) {
            var profit = Number(d.current_pl || 0);
            if (profit === 0 && pEl.textContent !== '$0.00' && pEl.textContent !== '$--.--') {
                // 번쩍임 방지: 기존값 유지
            } else if (profit === 0) {
                pEl.textContent = '$0.00';
                pEl.className = 'my-live-stat-value';
            } else {
                pEl.textContent = (profit >= 0 ? '+$' : '-$') + Math.abs(profit).toLocaleString('en-US', { minimumFractionDigits: 2 });
                pEl.className = 'my-live-stat-value ' + (profit > 0 ? 'profit-plus' : 'profit-minus');
            }
        }

        console.log('[DemoReport] data loaded:', { balance: d.balance, equity: d.equity, margin: d.margin, current_pl: d.current_pl });
    } catch(e) { console.error('[DemoReport] account-info error:', e); }

    // 첫 로드 시에만 Summary 호출, 자동 리프레시에서는 히어로 카드만 갱신
    if (!window._trdSummaryLoaded) {
        window._trdSummaryLoaded = false;
        loadDemoReportSummary(_trdCurrentPeriod);
        window._trdSummaryLoaded = true;
    }
}

function startDemoReportRefresh() {
    window._trdSummaryLoaded = false;
    loadDemoReportData();
    _trdRefreshTimer = setInterval(loadDemoReportData, 30000);
}

function stopDemoReportRefresh() {
    if (_trdRefreshTimer) { clearInterval(_trdRefreshTimer); _trdRefreshTimer = null; }
    window._trdSummaryLoaded = false;
}

function switchDemoTrTab(tab) {
    document.querySelectorAll('#myView-tradingReportDemo .tr-tab-card').forEach(function(c) { c.classList.remove('active'); });
    var tabBtn = document.getElementById('trdTab' + tab.charAt(0).toUpperCase() + tab.slice(1));
    if (tabBtn) tabBtn.classList.add('active');
    document.querySelectorAll('#myView-tradingReportDemo .tr-tab-content').forEach(function(c) { c.classList.remove('active'); });
    var content = document.getElementById('trdContent' + tab.charAt(0).toUpperCase() + tab.slice(1));
    if (content) content.classList.add('active');

    if (tab === 'summary') {
        loadDemoReportSummary(_trdCurrentPeriod, _trdCustomStart, _trdCustomEnd);
    } else if (tab === 'analysis') {
        loadDemoAnalysisReport(_trdCurrentPeriod, _trdCustomStart, _trdCustomEnd);
    }
}

var _trdCurrentPeriod = 'week';
var _trdCustomStart = null;
var _trdCustomEnd = null;

function toggleDemoTrPeriod() {
    var dd = document.getElementById('trdPeriodDropdown');
    if (dd) dd.classList.toggle('open');
}

function selectDemoTrPeriod(period, label) {
    _trdCurrentPeriod = period;
    _trdCustomStart = null;
    _trdCustomEnd = null;
    var lbl = document.getElementById('trdPeriodLabel');
    if (lbl) lbl.textContent = label;
    var dd = document.getElementById('trdPeriodDropdown');
    if (dd) dd.classList.remove('open');
    document.querySelectorAll('#myView-tradingReportDemo .tr-period-option').forEach(function(o) {
        o.classList.toggle('active', o.dataset.period === period);
    });
    var cp = document.getElementById('trdCustomPeriod');
    if (cp) cp.style.display = 'none';

    loadDemoReportSummary(period);
    var analysisTab = document.getElementById('trdTabAnalysis');
    if (analysisTab && analysisTab.classList.contains('active')) {
        loadDemoAnalysisReport(period);
    }
}

function openDemoTrCustomPeriod() {
    var dd = document.getElementById('trdPeriodDropdown');
    if (dd) dd.classList.remove('open');
    var cp = document.getElementById('trdCustomPeriod');
    if (cp) cp.style.display = 'flex';
    var lbl = document.getElementById('trdPeriodLabel');
    if (lbl) lbl.textContent = '기간설정';
    document.querySelectorAll('#myView-tradingReportDemo .tr-period-option').forEach(function(o) {
        o.classList.toggle('active', o.dataset.period === 'custom');
    });
}

function applyDemoTrCustomPeriod() {
    var s = document.getElementById('trdStartDate');
    var e = document.getElementById('trdEndDate');
    if (!s || !e || !s.value || !e.value) return;
    _trdCurrentPeriod = 'custom';
    _trdCustomStart = s.value;
    _trdCustomEnd = e.value;
    var lbl = document.getElementById('trdPeriodLabel');
    if (lbl) lbl.textContent = s.value + ' ~ ' + e.value;
    loadDemoReportSummary('custom', s.value, e.value);
    var analysisTab = document.getElementById('trdTabAnalysis');
    if (analysisTab && analysisTab.classList.contains('active')) {
        loadDemoAnalysisReport('custom', s.value, e.value);
    }
}

async function loadDemoReportSummary(period, startDate, endDate) {
    var loading = document.getElementById('trdSummaryLoading');
    var chartSec = document.getElementById('trdChartSection');
    if (loading) loading.style.display = 'flex';
    if (chartSec) chartSec.style.display = 'none';
    var token = localStorage.getItem('access_token');
    if (!token) return;

    try {
        var url = API_URL + '/demo/trading-report-summary?period=' + (period || 'week');
        if (period === 'custom' && startDate && endDate) {
            url += '&start_date=' + startDate + '&end_date=' + endDate;
        }
        var res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
        var d = await res.json();

        function fmtUSD(v) {
            var n = Number(v || 0);
            return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        function fmtPL(v) {
            var n = Number(v || 0);
            return (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        function plClass(v) { return Number(v || 0) >= 0 ? 'tr-val-profit' : 'tr-val-loss'; }

        var set = function(id, text, cls) {
            var el = document.getElementById(id);
            if (el) { el.textContent = text; if (cls) el.className = 'tr-summary-value ' + cls; }
        };

        set('trdSumBroker', d.broker || 'Trading-X Demo');
        set('trdSumAccount', d.account || '-');
        set('trdSumInitial', fmtUSD(d.initial_balance));
        set('trdSumTotalPL', fmtPL(d.total_pl), plClass(d.total_pl));
        set('trdSumTradeProfit', fmtPL(d.trade_profit), plClass(d.trade_profit));
        set('trdSumBalance', fmtUSD(d.current_balance));
        set('trdSumReturn', (d.return_rate >= 0 ? '+' : '') + d.return_rate + '%', plClass(d.return_rate));

        if (loading) loading.style.display = 'none';

        if (d.daily_pl && d.daily_pl.length > 0) {
            if (chartSec) chartSec.style.display = 'block';
            renderDemoTrChart(d.daily_pl, d.start_date, d.end_date);
        }
    } catch(e) {
        console.error('[DemoReport] summary error:', e);
        if (loading) loading.style.display = 'none';
    }
}

document.addEventListener('click', function(e) {
    var dd = document.getElementById('trdPeriodDropdown');
    var btn = e.target.closest && e.target.closest('.tr-period-btn');
    if (dd && dd.classList.contains('open') && !btn && !dd.contains(e.target)) {
        dd.classList.remove('open');
    }
});

function renderDemoTrChart(dailyData, periodStart, periodEnd) {
    var canvas = document.getElementById('trdChartCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var container = document.getElementById('trdChartContainer');
    if (!container) return;
    var W = container.clientWidth || 340;
    var H = 200;
    canvas.width = W * 2; canvas.height = H * 2;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, W, H);

    var padL = 50, padR = 10, padT = 20, padB = 30;
    var chartW = W - padL - padR;
    var chartH = H - padT - padB;

    var cumPL = dailyData.length > 0 ? dailyData[dailyData.length - 1].cumulative : 0;
    var bestDay = dailyData.reduce(function(a, b) { return b.total > a.total ? b : a; }, dailyData[0] || {total:0});
    var worstDay = dailyData.reduce(function(a, b) { return b.total < a.total ? b : a; }, dailyData[0] || {total:0});
    var fmtPLshort = function(v) { var n = Number(v||0); return (n>=0?'+':'-')+'$'+Math.abs(n).toFixed(2); };

    var el1 = document.getElementById('trdChartCumPL');
    if (el1) { el1.textContent = fmtPLshort(cumPL); el1.style.color = cumPL >= 0 ? '#00d4a4' : '#ff4d5a'; }
    var el2 = document.getElementById('trdChartDays');
    if (el2) el2.textContent = dailyData.length + '일';
    var el3 = document.getElementById('trdChartBestDay');
    if (el3) el3.textContent = fmtPLshort(bestDay.total);
    var el4 = document.getElementById('trdChartWorstDay');
    if (el4) el4.textContent = fmtPLshort(worstDay.total);
    var el5 = document.getElementById('trdChartPeriod');
    if (el5) el5.textContent = (periodStart||'') + ' ~ ' + (periodEnd||'');

    var allVals = [0];
    dailyData.forEach(function(d) { allVals.push(d.total, d.cumulative); });
    var maxVal = Math.max.apply(null, allVals);
    var minVal = Math.min.apply(null, allVals);
    var range = maxVal - minVal || 1;
    maxVal += range * 0.1; minVal -= range * 0.1;
    range = maxVal - minVal;

    function yPos(v) { return padT + (1 - (v - minVal) / range) * chartH; }

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    for (var g = 0; g <= 4; g++) {
        var gy = padT + chartH * g / 4;
        ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
        var gv = maxVal - (range * g / 4);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('$' + gv.toFixed(0), padL - 5, gy + 3);
    }

    var zeroY = yPos(0);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
    ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(padL, zeroY); ctx.lineTo(W - padR, zeroY); ctx.stroke();
    ctx.setLineDash([]);

    var n = dailyData.length;
    var barW = Math.max(4, Math.min(20, (chartW / n) * 0.6));
    var gap = chartW / n;
    dailyData.forEach(function(d, i) {
        var x = padL + gap * i + gap / 2;
        var val = d.total;
        var top = val >= 0 ? yPos(val) : zeroY;
        var h = Math.abs(yPos(val) - zeroY);
        h = Math.max(h, 1);
        ctx.fillStyle = val >= 0 ? 'rgba(0,212,164,0.5)' : 'rgba(255,77,90,0.5)';
        ctx.fillRect(x - barW/2, top, barW, h);
    });

    ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2;
    ctx.beginPath();
    dailyData.forEach(function(d, i) {
        var x = padL + gap * i + gap / 2;
        var y = yPos(d.cumulative);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    dailyData.forEach(function(d, i) {
        var x = padL + gap * i + gap / 2;
        var y = yPos(d.cumulative);
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#00d4ff'; ctx.fill();
    });

    var xAxis = document.getElementById('trdChartXAxis');
    if (xAxis) {
        xAxis.innerHTML = '';
        var step = Math.max(1, Math.floor(n / 6));
        for (var i = 0; i < n; i += step) {
            var lbl = document.createElement('span');
            lbl.textContent = dailyData[i].date.slice(5);
            lbl.style.position = 'absolute';
            lbl.style.left = (padL + gap * i + gap / 2) + 'px';
            lbl.style.transform = 'translateX(-50%)';
            lbl.style.fontSize = '9px';
            lbl.style.color = 'rgba(255,255,255,0.4)';
            xAxis.appendChild(lbl);
        }
    }
}

async function loadDemoAnalysisReport(period, startDate, endDate) {
    var loading = document.getElementById('trdaLoading');
    var content = document.getElementById('trdaContent');
    if (loading) loading.style.display = 'flex';
    if (content) content.style.display = 'none';
    var token = localStorage.getItem('access_token');
    if (!token) return;

    try {
        var url = API_URL + '/demo/trading-report-analysis?period=' + (period || 'week');
        if (period === 'custom' && startDate && endDate) {
            url += '&start_date=' + startDate + '&end_date=' + endDate;
        }
        var res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
        var d = await res.json();

        var badge = document.getElementById('trdaPeriodBadge');
        var periodMap = {today:'오늘',week:'이번주',month:'이번달','3month':'3개월'};
        if (badge) badge.textContent = periodMap[period] || period;

        if (loading) loading.style.display = 'none';

        if (!d.total_count || d.total_count === 0) {
            if (content) { content.style.display = 'block'; content.innerHTML = '<div style="text-align:center;padding:40px 0;color:rgba(255,255,255,0.3);">거래 데이터가 없습니다</div>'; }
            return;
        }
        if (content) content.style.display = 'block';

        function fmtPL(v) { var n = Number(v||0); return (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits:2}); }
        function plColor(v) { return Number(v||0) >= 0 ? '#00d4a4' : '#ff4d5a'; }

        // 카드1: 승률
        if (d.winrate) {
            var w = d.winrate;
            var ring = document.getElementById('trdaWinRing');
            if (ring) ring.setAttribute('stroke-dasharray', w.rate + ' ' + (100 - w.rate));
            var pct = document.getElementById('trdaWinPct'); if (pct) pct.textContent = w.rate + '%';
            var wl = document.getElementById('trdaWinLabel'); if (wl) wl.textContent = 'Win ' + w.win;
            var ll = document.getElementById('trdaLoseLabel'); if (ll) ll.textContent = 'Lose ' + w.lose;
            var wb = document.getElementById('trdaWinBar'); if (wb) wb.style.width = w.rate + '%';
            var lb = document.getElementById('trdaLoseBar'); if (lb) lb.style.width = (100 - w.rate) + '%';
            var tot = document.getElementById('trdaTotal'); if (tot) tot.textContent = w.total + '건';
            var aw = document.getElementById('trdaAvgWin'); if (aw) { aw.textContent = fmtPL(w.avg_win); aw.style.color = plColor(w.avg_win); }
            var al = document.getElementById('trdaAvgLoss'); if (al) { al.textContent = fmtPL(w.avg_loss); al.style.color = plColor(w.avg_loss); }
            var rr = document.getElementById('trdaRR'); if (rr) rr.textContent = w.rr_ratio + ':1';
        }

        // 카드2: 종목별
        if (d.symbols && d.symbols.length > 0) {
            var sc = document.getElementById('trdaSymbolCard');
            if (sc) {
                var maxAbs = Math.max.apply(null, d.symbols.map(function(s) { return Math.abs(s.total_pl); })) || 1;
                var html = '';
                d.symbols.forEach(function(s) {
                    var pct = Math.min(Math.abs(s.total_pl) / maxAbs * 100, 100);
                    var c = s.total_pl >= 0 ? '#00d4a4' : '#ff4d5a';
                    html += '<div class="tra-symbol-row"><div class="tra-symbol-name">' + s.symbol + '</div><div class="tra-symbol-bar-wrap"><div class="tra-symbol-bar" style="width:'+pct+'%;background:'+c+'"></div></div><div class="tra-symbol-pl" style="color:'+c+'">' + fmtPL(s.total_pl) + '</div><div class="tra-symbol-meta">' + s.count + '건 · 승률 ' + s.win_rate + '%</div></div>';
                });
                sc.innerHTML = html;
            }
        }

        // 카드3: Buy/Sell
        if (d.buysell) {
            var b = d.buysell.buy, sl = d.buysell.sell;
            var el;
            el = document.getElementById('trdaBuyCount'); if (el) el.textContent = b.count + '건';
            el = document.getElementById('trdaBuyPL'); if (el) { el.textContent = fmtPL(b.total_pl); el.style.color = plColor(b.total_pl); }
            el = document.getElementById('trdaBuyWinRate'); if (el) el.textContent = b.win_rate + '%';
            el = document.getElementById('trdaBuyAvg'); if (el) { el.textContent = fmtPL(b.avg_pl); el.style.color = plColor(b.avg_pl); }
            el = document.getElementById('trdaSellCount'); if (el) el.textContent = sl.count + '건';
            el = document.getElementById('trdaSellPL'); if (el) { el.textContent = fmtPL(sl.total_pl); el.style.color = plColor(sl.total_pl); }
            el = document.getElementById('trdaSellWinRate'); if (el) el.textContent = sl.win_rate + '%';
            el = document.getElementById('trdaSellAvg'); if (el) { el.textContent = fmtPL(sl.avg_pl); el.style.color = plColor(sl.avg_pl); }
        }

        // 카드4: 시간대별
        if (d.hourly) {
            var tc = document.getElementById('trdaTimeChart');
            if (tc) {
                var hours = d.hourly.hours;
                var maxH = 0;
                for (var h in hours) { maxH = Math.max(maxH, Math.abs(hours[h].pl)); }
                maxH = maxH || 1;
                var bars = '';
                for (var h = 0; h < 24; h++) {
                    var hd = hours[String(h)] || {count:0, pl:0};
                    var pctH = Math.abs(hd.pl) / maxH * 100;
                    var c = hd.pl >= 0 ? '#00d4a4' : '#ff4d5a';
                    bars += '<div class="tra-time-bar" style="height:'+Math.max(pctH,2)+'%;background:'+c+';" title="'+h+'시: '+hd.count+'건 $'+hd.pl.toFixed(2)+'"></div>';
                }
                tc.innerHTML = bars;
            }
            var bh = document.getElementById('trdaBestHour'); if (bh) bh.textContent = d.hourly.best_hour + '시 (' + fmtPL(d.hourly.best_hour_pl) + ')';
            var wh = document.getElementById('trdaWorstHour'); if (wh) wh.textContent = d.hourly.worst_hour + '시 (' + fmtPL(d.hourly.worst_hour_pl) + ')';
        }

        // 카드5: 거래량
        if (d.volume) {
            var v = d.volume;
            el = document.getElementById('trdaVolTotal'); if (el) el.textContent = v.total + ' lot';
            el = document.getElementById('trdaVolAvg'); if (el) el.textContent = v.avg + ' lot';
            el = document.getElementById('trdaVolMax'); if (el) el.textContent = v.max + ' lot';
            el = document.getElementById('trdaVolMin'); if (el) el.textContent = v.min + ' lot';
            el = document.getElementById('trdaVolMaxDetail'); if (el) el.textContent = v.max_detail || '-';
        }

        // 카드6: 리스크
        if (d.risk) {
            var r = d.risk;
            el = document.getElementById('trdaStreakWin'); if (el) el.textContent = r.max_win_streak + '연승';
            el = document.getElementById('trdaStreakWinPL'); if (el) { el.textContent = fmtPL(r.max_win_streak_pl); el.style.color = '#00d4a4'; }
            el = document.getElementById('trdaStreakLoss'); if (el) el.textContent = r.max_loss_streak + '연패';
            el = document.getElementById('trdaStreakLossPL'); if (el) { el.textContent = fmtPL(r.max_loss_streak_pl); el.style.color = '#ff4d5a'; }
            el = document.getElementById('trdaBestDeal'); if (el) el.textContent = fmtPL(r.best_deal_pl);
            el = document.getElementById('trdaBestDealDetail'); if (el) el.textContent = r.best_deal_detail || '-';
            el = document.getElementById('trdaWorstDeal'); if (el) el.textContent = fmtPL(r.worst_deal_pl);
            el = document.getElementById('trdaWorstDealDetail'); if (el) el.textContent = r.worst_deal_detail || '-';
            el = document.getElementById('trdaProfitFactor'); if (el) { el.textContent = r.profit_factor; el.style.color = r.profit_factor >= 1 ? '#00d4ff' : '#ff4d5a'; }
        }
    } catch(e) {
        console.error('[DemoAnalysis] error:', e);
        if (loading) loading.style.display = 'none';
    }
}

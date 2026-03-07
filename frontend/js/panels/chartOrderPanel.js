// ================================================================
// ChartOrderPanel — 차트 탭 시장가 주문 시스템
// Trading-X v3.1
// Magic Number: 100004 (Badge: "Chart")
// ================================================================

const CHART_MAGIC_NUMBER = 100004;

const ChartOrderPanel = {

    // ========== 상태 ==========
    _side: 'BUY',           // 현재 선택된 주문 방향
    lotSize: 0.10,
    lotStep: 0.10,
    lotMin: 0.01,
    lotMax: 100.00,
    _isOrdering: false,      // 이중주문 방지
    _isOpen: false,          // 주문 패널 열림 상태
    _allChartPositions: [],  // magic=100004인 전체 포지션
    _positions: [],          // 현재 종목 chart 포지션 (표시용)
    _priceLines: [],         // lightweight-charts priceLine 객체 배열
    _currentBid: 0,
    _currentAsk: 0,

    // Lot Picker 프리셋
    _lotPresets: [
        { label: '0.01', value: 0.01 },
        { label: '0.10', value: 0.10 },
        { label: '0.50', value: 0.50 },
        { label: '1.00', value: 1.00 },
        { label: '2.00', value: 2.00 },
        { label: '직접입력', value: 'custom' },
    ],

    // 종목별 1 lot 마진 근사치 (프론트 표시용)
    // 종목별 1 lot 마진 근사치 — symbol-config.js(window.SYMBOL_MARGIN_PER_LOT)에서 자동 로드됨
    _marginPerLot: window.SYMBOL_MARGIN_PER_LOT || { 'BTCUSD': 1400, 'XAUUSD.r': 2400, 'US100.': 400, 'EURUSD.r': 260, 'USDJPY.r': 260 },


    // ========== 주문 패널 열기/닫기 ==========

    open(side) {
        console.log('[ChartOrder] open:', side);
        this._side = side || 'BUY';
        this._isOpen = true;

        const symbol = this._getSymbol();
        const symEl = document.getElementById('chartOrderSymbol');
        if (symEl) symEl.textContent = symbol;

        // 카드 선택 상태
        this.switchSide(this._side);

        // 현재 가격 업데이트
        this._refreshPrices();

        // Lot 표시
        const lotEl = document.getElementById('chartOrderLotValue');
        if (lotEl) lotEl.textContent = this.lotSize.toFixed(2);

        // 스프레드/마진 업데이트
        this._updateSpreadMargin();

        // 패널 표시
        const sheet = document.getElementById('chartOrderSheet');
        if (sheet) sheet.classList.add('active');
    },

    close() {
        console.log('[ChartOrder] close');
        this._isOpen = false;
        const sheet = document.getElementById('chartOrderSheet');
        if (sheet) sheet.classList.remove('active');
    },


    // ========== Bid/Ask 카드 전환 ==========

    switchSide(side) {
        this._side = side;
        const sellCard = document.getElementById('chartOrderSellCard');
        const buyCard = document.getElementById('chartOrderBuyCard');
        const confirmBtn = document.getElementById('chartOrderConfirmBtn');
        const confirmText = document.getElementById('chartOrderConfirmText');

        if (sellCard) {
            sellCard.classList.toggle('selected', side === 'SELL');
        }
        if (buyCard) {
            buyCard.classList.toggle('selected', side === 'BUY');
        }

        // 확인 버튼 스타일 + 텍스트
        if (confirmBtn) {
            confirmBtn.classList.remove('buy', 'sell');
            confirmBtn.classList.add(side === 'BUY' ? 'buy' : 'sell');
        }
        if (confirmText) {
            confirmText.textContent = side === 'BUY' ? '매수 확인' : '매도 확인';
        }

        // 확인 버튼 가격
        this._updateConfirmPrice();
    },


    // ========== 가격 업데이트 ==========

    updatePrices(bid, ask) {
        this._currentBid = bid;
        this._currentAsk = ask;

        // 주문 패널 열려있으면 가격 갱신
        if (this._isOpen) {
            this._refreshPrices();
        }

        // ★ 차트 오버레이 Y좌표 실시간 업데이트
        if (this._priceLines.length > 0) {
            this._updateEntryOverlays();
        }
    },

    _refreshPrices() {
        const symbol = this._getSymbol();
        const decimals = this._getDecimals(symbol);

        const bidEl = document.getElementById('chartOrderBidPrice');
        const askEl = document.getElementById('chartOrderAskPrice');

        if (bidEl && this._currentBid > 0) {
            bidEl.textContent = this._currentBid.toFixed(decimals);
        }
        if (askEl && this._currentAsk > 0) {
            askEl.textContent = this._currentAsk.toFixed(decimals);
        }

        this._updateConfirmPrice();
        this._updateSpreadMargin();
    },

    _updateConfirmPrice() {
        const priceEl = document.getElementById('chartOrderConfirmPrice');
        if (!priceEl) return;
        const symbol = this._getSymbol();
        const decimals = this._getDecimals(symbol);
        const price = this._side === 'BUY' ? this._currentAsk : this._currentBid;
        priceEl.textContent = price > 0 ? '(' + price.toFixed(decimals) + ')' : '';
    },


    // ========== 거래량 (Lot) 조절 ==========

    adjustLot(direction) {
        this.lotSize += direction * this.lotStep;
        this.lotSize = Math.max(this.lotMin, Math.min(this.lotMax, this.lotSize));
        this.lotSize = Math.round(this.lotSize * 100) / 100;

        const lotEl = document.getElementById('chartOrderLotValue');
        if (lotEl) lotEl.textContent = this.lotSize.toFixed(2);

        this._updateSpreadMargin();
    },


    // ========== Lot Picker 팝업 ==========

    openLotPicker() {
        const sheet = document.getElementById('chartLotPickerSheet');
        const grid = document.getElementById('chartLotPickerGrid');
        const customArea = document.getElementById('chartLotPickerCustom');
        const input = document.getElementById('chartLotPickerInput');

        if (!sheet || !grid) return;

        // 그리드 렌더
        grid.innerHTML = '';
        this._lotPresets.forEach(p => {
            const card = document.createElement('div');
            card.className = 'chart-lot-picker-card';
            if (p.value === 'custom') {
                card.classList.add('custom-card');
            } else if (p.value === this.lotSize) {
                card.classList.add('selected');
            }
            card.textContent = p.label;
            card.addEventListener('click', () => this._onLotPresetClick(p.value));
            grid.appendChild(card);
        });

        // 직접입력 숨김
        if (customArea) customArea.style.display = 'none';
        if (input) input.value = '';

        sheet.classList.add('active');
    },

    closeLotPicker() {
        const sheet = document.getElementById('chartLotPickerSheet');
        if (sheet) sheet.classList.remove('active');
    },

    _onLotPresetClick(value) {
        if (value === 'custom') {
            const customArea = document.getElementById('chartLotPickerCustom');
            const input = document.getElementById('chartLotPickerInput');
            if (customArea) {
                customArea.style.display = 'flex';
                setTimeout(() => { if (input) input.focus(); }, 100);
            }
            // Enter 키 지원
            if (input && !input._chartLotKeyHandler) {
                input._chartLotKeyHandler = true;
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') this.confirmCustomLot();
                });
            }
            return;
        }
        this.lotSize = value;
        const lotEl = document.getElementById('chartOrderLotValue');
        if (lotEl) lotEl.textContent = this.lotSize.toFixed(2);
        this._updateSpreadMargin();
        this.closeLotPicker();
    },

    confirmCustomLot() {
        const input = document.getElementById('chartLotPickerInput');
        if (!input) return;
        const val = parseFloat(input.value.replace(/,/g, ''));
        if (isNaN(val) || val <= 0) return;

        this.lotSize = Math.max(this.lotMin, Math.min(this.lotMax, Math.round(val * 100) / 100));
        const lotEl = document.getElementById('chartOrderLotValue');
        if (lotEl) lotEl.textContent = this.lotSize.toFixed(2);
        this._updateSpreadMargin();
        this.closeLotPicker();
    },


    // ========== 스프레드 + 마진 표시 ==========

    _updateSpreadMargin() {
        const symbol = this._getSymbol();
        const spreadEl = document.getElementById('chartOrderSpread');
        const marginEl = document.getElementById('chartOrderMargin');

        if (!spreadEl || !marginEl) return;

        // 스프레드 계산
        if (this._currentBid > 0 && this._currentAsk > 0) {
            const spec = (typeof SYMBOL_SPECS !== 'undefined') ? SYMBOL_SPECS[symbol] : null;
            let spreadCost = 0;

            if (spec && spec.tick_size && spec.tick_value) {
                const spread = Math.abs(this._currentAsk - this._currentBid);
                spreadCost = (spread / spec.tick_size) * spec.tick_value * this.lotSize;
            } else {
                // fallback: 간단 추정
                spreadCost = Math.abs(this._currentAsk - this._currentBid) * this.lotSize;
            }

            spreadCost = Math.round(spreadCost * 100) / 100;
            spreadEl.textContent = '$' + spreadCost.toFixed(2);

            // 색상: <$3 초록, <$10 노랑, >$10 주황
            spreadEl.classList.remove('spread-low', 'spread-mid', 'spread-high');
            if (spreadCost < 3) {
                spreadEl.classList.add('spread-low');
            } else if (spreadCost < 10) {
                spreadEl.classList.add('spread-mid');
            } else {
                spreadEl.classList.add('spread-high');
            }
        } else {
            spreadEl.textContent = '-';
            spreadEl.classList.remove('spread-low', 'spread-mid', 'spread-high');
        }

        // 마진 계산
        const marginPerLot = this._marginPerLot[symbol] || 300;
        const margin = marginPerLot * this.lotSize;
        marginEl.textContent = '$' + margin.toFixed(2);
    },


    // ========== 주문 실행 ==========

    async placeOrder() {
        if (this._isOrdering) {
            if (typeof showToast === 'function') showToast('주문 처리 중입니다. 잠시만 기다려주세요.', 'error');
            return;
        }

        const symbol = this._getSymbol();
        const side = this._side;
        const volume = this.lotSize;
        const token = localStorage.getItem('access_token');

        // ★ 데모 계좌 미생성 시 주문 차단
        if (window._hasDemoAccount === false) {
            if (typeof showToast === 'function') showToast('데모 계좌를 먼저 개설해주세요.', 'error');
            return;
        }

        // 게스트 체크
        if (typeof checkGuestAction === 'function' && !checkGuestAction('trade')) {
            return;
        }

        // 장 마감 체크
        if (typeof isCurrentMarketClosed === 'function' && isCurrentMarketClosed(symbol)) {
            if (typeof showToast === 'function') showToast('현재 시장이 닫혀있습니다\n운영시간을 확인해주세요', 'error', 3000);
            return;
        }

        if (!token) {
            if (typeof showToast === 'function') showToast('로그인이 필요합니다', 'error');
            return;
        }

        // 이중주문 방지 — 버튼 비활성화
        this._isOrdering = true;
        const confirmBtn = document.getElementById('chartOrderConfirmBtn');
        const confirmText = document.getElementById('chartOrderConfirmText');
        if (confirmBtn) confirmBtn.disabled = true;
        if (confirmText) confirmText.textContent = '처리 중...';

        try {
            const _isDemo = (typeof isDemo !== 'undefined') ? isDemo : false;
            const baseUrl = window.API_URL || '';
            const endpoint = _isDemo
                ? '/demo/order?symbol=' + symbol + '&order_type=' + side + '&volume=' + volume + '&target=0&magic=' + CHART_MAGIC_NUMBER
                : '/mt5/order?symbol=' + symbol + '&order_type=' + side + '&volume=' + volume + '&target=0&magic=' + CHART_MAGIC_NUMBER;

            let result;
            if (typeof apiCall === 'function') {
                result = await apiCall(endpoint, 'POST');
            } else {
                const response = await fetch(baseUrl + endpoint, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                result = await response.json();
            }

            if (result && result.success) {
                // 성공 사운드
                if (typeof playSound === 'function') {
                    const soundType = (side === 'SELL' || side === 'sell') ? 'sell' : 'buy';
                    console.log('[ChartOrder] playSound:', soundType, 'side:', side);
                    playSound(soundType);
                }

                // 성공 토스트
                if (typeof showToast === 'function') {
                    showToast('[Chart] ' + symbol + ' ' + side + ' ' + volume + 'lot 체결', side === 'BUY' ? 'buy' : 'sell');
                }

                // 주문 패널 닫기
                this.close();

            } else {
                // 에러 처리 (기존 trading.js 패턴)
                if (result && result.margin_insufficient) {
                    if (typeof showToast === 'function') {
                        showToast('증거금이 부족합니다\n가용마진: $' + (result.free_margin || 0).toFixed(0) + ', 필요마진: $' + (result.required_margin || 0).toFixed(0), 'warning', 5000);
                    }
                } else if (result && result.message && result.message.includes('spread')) {
                    if (typeof showToast === 'function') showToast('스프레드가 너무 넓습니다\n잠시 후 다시 시도해주세요', 'error', 5000);
                } else {
                    const msg = (typeof friendlyError === 'function' && result && result.message) ? friendlyError(result.message) : (result && result.message) || '주문 실패';
                    if (typeof showToast === 'function') showToast(msg, 'error');
                }
            }

        } catch (err) {
            console.error('[ChartOrder] placeOrder error:', err);
            if (typeof showToast === 'function') showToast('네트워크 오류', 'error');
        } finally {
            // 버튼 복구
            this._isOrdering = false;
            if (confirmBtn) confirmBtn.disabled = false;
            if (confirmText) confirmText.textContent = this._side === 'BUY' ? '매수 확인' : '매도 확인';
        }
    },


    // ========== 포지션 관리 (WS 실시간) ==========

    updatePositions(allPositions) {
        if (!Array.isArray(allPositions)) return;

        // magic=100004 전체 필터
        this._allChartPositions = allPositions.filter(p => p.magic == CHART_MAGIC_NUMBER);

        // 현재 종목 필터
        const symbol = this._getSymbol();
        this._positions = this._allChartPositions.filter(p => p.symbol === symbol);

        // 렌더링
        this._renderPositions();

        // 차트 진입가 라인 업데이트
        this._updatePriceLines();

        // P/L 오버레이 업데이트
        this._updatePLOverlay();

        // 종목명 아래 고정 뱃지 업데이트
        this._updateEntryBadges();
    },

    // 종목 변경 시 호출
    onSymbolChange(symbol) {
        console.log('[ChartOrder] onSymbolChange:', symbol);

        // 현재 종목 포지션 필터
        this._positions = this._allChartPositions.filter(p => p.symbol === symbol);

        // 렌더링
        this._renderPositions();

        // 기존 라인 클리어 후 새 종목 라인 그리기
        this._clearAllPriceLines();
        // updatePriceLines는 다음 WS 업데이트에서 자동 호출됨
        // 즉시 반영을 위해 수동 호출
        this._updatePriceLines();

        // P/L 오버레이 업데이트
        this._updatePLOverlay();

        // 종목명 아래 고정 뱃지 업데이트
        this._updateEntryBadges();

        // ★ 차트 높이: Chart 포지션이 있으면 줄인 상태 유지
        if (this._allChartPositions.length > 0) {
            this._shrinkChartHeight();
        } else {
            this._restoreChartHeight();
        }
    },


    // ========== 포지션 카드 렌더링 (account.css 클래스 100% 재사용) ==========

    _renderPositions() {
        const section = document.getElementById('chartPositionsSection');
        const container = document.getElementById('chartPosList');
        const countEl = document.getElementById('chartPosCount');
        const totalPLEl = document.getElementById('chartPosTotalPL');

        if (!section || !container) return;

        // ★ 하단 오픈포지션은 모든 Chart 포지션 표시 (종목 무관)
        const positions = this._allChartPositions;

        if (!positions || positions.length === 0) {
            section.style.display = 'none';
            this._restoreChartHeight();
            return;
        }

        section.style.display = 'block';
        this._shrinkChartHeight();

        // 헤더 업데이트
        if (countEl) countEl.textContent = positions.length;

        // 총 P/L
        const totalPL = positions.reduce((sum, p) => sum + (p.profit || 0), 0);
        if (totalPLEl) {
            const plText = totalPL > 0 ? '+$' + totalPL.toFixed(2)
                         : totalPL < 0 ? '-$' + Math.abs(totalPL).toFixed(2)
                         : '$0.00';
            totalPLEl.textContent = plText;
            totalPLEl.classList.remove('positive', 'negative', 'neutral');
            totalPLEl.classList.add(totalPL > 0 ? 'positive' : totalPL < 0 ? 'negative' : 'neutral');
        }

        // 카드 렌더 (openPositions.js render() 패턴과 100% 동일한 HTML 구조)
        let html = '';
        positions.forEach(pos => {
            const posType = pos.type || '';
            const isBuy = posType === 'BUY' || posType === 0 || posType === 'POSITION_TYPE_BUY';
            const typeStr = isBuy ? 'BUY' : 'SELL';
            const cardClass = isBuy ? 'buy-card' : 'sell-card';
            const typeClass = isBuy ? 'buy' : 'sell';

            const profit = pos.profit || 0;
            const profitClass = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'neutral';
            const profitText = profit > 0 ? '+$' + profit.toFixed(2)
                             : profit < 0 ? '-$' + Math.abs(profit).toFixed(2)
                             : '$0.00';

            const decimals = this._getDecimals(pos.symbol);
            const entryPrice = pos.entry || pos.openPrice || 0;
            const currentPrice = pos.current || pos.currentPrice || 0;
            const entryStr = entryPrice.toFixed(decimals);
            const currentStr = currentPrice.toFixed(decimals);

            const timeStr = this._formatTime(pos.opened_at || pos.time);
            const safeId = String(pos.id).replace(/'/g, "\\'");

            html += '<div class="open-pos-card ' + cardClass + '" data-pos-id="' + pos.id + '"'
                + ' onclick="ChartOrderPanel.onPositionTap(\'' + safeId + '\')">'
                + '<div class="open-pos-row1">'
                + '<div class="open-pos-info">'
                + '<span class="open-pos-symbol">' + pos.symbol + '</span>'
                + '<span class="open-pos-type ' + typeClass + '">' + typeStr + '</span>'
                + '<span class="open-pos-volume">' + pos.volume + 'lot</span>'
                + '<span class="open-pos-badge badge-chart">Chart</span>'
                + '</div>'
                + '<span class="open-pos-profit ' + profitClass + '">' + profitText + '</span>'
                + '</div>'
                + '<div class="open-pos-row2">'
                + '<span class="open-pos-time">' + timeStr + '</span>'
                + '<span class="open-pos-prices">' + entryStr + '<span class="open-pos-arrow"> → </span>' + currentStr + '</span>'
                + '</div>'
                + '</div>';
        });

        container.innerHTML = html;
    },


    // ========== 포지션 탭 → 청산 바텀시트 ==========

    onPositionTap(posId) {
        console.log('[ChartOrder] onPositionTap:', posId);

        // 기존 OpenPositions.showConfirmSheet 재사용
        if (typeof OpenPositions !== 'undefined' && typeof OpenPositions.showConfirmSheet === 'function') {
            OpenPositions.showConfirmSheet('single', posId);
        }
    },


    // ========== 차트 진입가 라인 ==========

    _updatePriceLines() {
        // candleSeries 확인
        if (!window.candleSeries) return;

        // 기존 라인 + 오버레이 제거
        this._clearAllPriceLines();

        // 현재 종목 포지션에 대해 라인 + 오버레이 추가
        this._positions.forEach(pos => {
            const isBuy = pos.type === 'BUY' || pos.type === 0 || pos.type === 'POSITION_TYPE_BUY';
            const entryPrice = pos.entry || pos.openPrice || 0;
            if (entryPrice <= 0) return;

            const sideColor = isBuy ? '#00d4a4' : '#ff4d5a';

            try {
                // 점선 라인만 (라벨 없음 — 이지패널 방식)
                const line = window.candleSeries.createPriceLine({
                    price: entryPrice,
                    color: sideColor,
                    lineWidth: 1,
                    lineStyle: 2, // Dashed
                    axisLabelVisible: false,
                    title: '',
                });
                this._priceLines.push({ line: line, price: entryPrice, isBuy: isBuy });

                // ★ 커스텀 ◉ BUY/SELL 오버레이 (이지패널 qeTickChart.js Line 568~583 동일 방식)
                const wrapper = document.getElementById('chart-wrapper');
                if (wrapper) {
                    const ov = document.createElement('div');
                    ov.className = 'chart-entry-overlay';
                    ov.innerHTML = '<span style="color:' + sideColor + '">◉</span> <span>' + (isBuy ? 'BUY' : 'SELL') + '</span>';
                    ov.style.cssText = 'position:absolute;right:65px;pointer-events:none;z-index:6;' +
                        'font-size:9px;font-weight:700;letter-spacing:0.5px;' +
                        'color:' + sideColor + ';' +
                        'background:rgba(10,10,15,0.7);padding:1px 5px;border-radius:3px;' +
                        'white-space:nowrap;transform:translateY(-50%);display:none;';
                    wrapper.appendChild(ov);
                    this._priceLines[this._priceLines.length - 1].overlay = ov;
                }
            } catch (e) {
                console.warn('[ChartOrder] createPriceLine error:', e);
            }
        });

        // 오버레이 Y좌표 즉시 업데이트
        this._updateEntryOverlays();
    },

    _clearAllPriceLines() {
        if (!window.candleSeries) return;

        this._priceLines.forEach(item => {
            try {
                window.candleSeries.removePriceLine(item.line);
            } catch (e) { /* 이미 제거된 라인 무시 */ }
            // 오버레이 DOM 제거
            if (item.overlay) {
                try { item.overlay.remove(); } catch (e) {}
            }
        });
        this._priceLines = [];
    },

    // ★ 오버레이 Y좌표 업데이트 (이지패널 updateEntryOverlay 패턴)
    _updateEntryOverlays() {
        if (!window.candleSeries) return;

        this._priceLines.forEach(item => {
            if (!item.overlay) return;
            try {
                const y = window.candleSeries.priceToCoordinate(item.price);
                if (y !== null && y > 0) {
                    item.overlay.style.top = y + 'px';
                    item.overlay.style.display = 'block';
                } else {
                    item.overlay.style.display = 'none';
                }
            } catch (e) {
                item.overlay.style.display = 'none';
            }
        });
    },


    // ========== P/L 오버레이 ==========

    _updatePLOverlay() {
        const overlay = document.getElementById('chartPLOverlay');
        const valueEl = document.getElementById('chartPLValue');
        if (!overlay || !valueEl) return;

        if (this._positions.length === 0) {
            overlay.style.display = 'none';
            return;
        }

        overlay.style.display = 'block';

        const totalPL = this._positions.reduce((sum, p) => sum + (p.profit || 0), 0);
        const plText = totalPL >= 0 ? '+$' + totalPL.toFixed(2) : '-$' + Math.abs(totalPL).toFixed(2);
        valueEl.textContent = plText;

        overlay.classList.remove('positive', 'negative');
        overlay.classList.add(totalPL >= 0 ? 'positive' : 'negative');
    },


    // ========== 종목명 아래 고정 뱃지 (포지션 정보) ==========

    _updateEntryBadges() {
        const container = document.getElementById('chartEntryBadges');
        if (!container) return;

        if (!this._positions || this._positions.length === 0) {
            container.style.display = 'none';
            container.innerHTML = '';
            return;
        }

        container.style.display = 'block';
        let html = '';

        this._positions.forEach(pos => {
            const isBuy = pos.type === 'BUY' || pos.type === 0 || pos.type === 'POSITION_TYPE_BUY';
            const typeStr = isBuy ? 'BUY' : 'SELL';
            const arrow = isBuy ? '▲' : '▼';
            const color = isBuy ? '#00d4a4' : '#ff4d5a';
            const decimals = this._getDecimals(pos.symbol);
            const entryPrice = (pos.entry || pos.openPrice || 0).toFixed(decimals);
            const volume = pos.volume || '0.00';

            html += '<div class="chart-entry-badge" style="color:' + color + ';">'
                + '<span class="chart-entry-badge-arrow">' + arrow + '</span> '
                + '<span class="chart-entry-badge-type">' + typeStr + '</span> '
                + '<span class="chart-entry-badge-vol">' + volume + 'lot</span> '
                + '<span class="chart-entry-badge-price">' + entryPrice + '</span>'
                + '</div>';
        });

        container.innerHTML = html;
    },


    // ========== 청산 후 동기화 (openPositions.js에서 호출) ==========

    onPositionClosed(symbol, posId) {
        console.log('[ChartOrder] onPositionClosed:', symbol, posId);

        // _allChartPositions에서 제거
        this._allChartPositions = this._allChartPositions.filter(p =>
            String(p.id) !== String(posId)
        );

        // 현재 종목이면 즉시 렌더 갱신
        const currentSymbol = this._getSymbol();
        if (symbol === currentSymbol) {
            this._positions = this._allChartPositions.filter(p => p.symbol === currentSymbol);
            this._renderPositions();
            this._updatePriceLines();
            this._updatePLOverlay();
            this._updateEntryBadges();
        }
    },


    // ========== 현재 차트 종목 조회 ==========
    _getSymbol() {
        // 우선순위: chartSymbol (전역) > DOM 표시값 > 폴백
        if (typeof chartSymbol !== 'undefined' && chartSymbol) return chartSymbol;
        const el = document.getElementById('chartSymbolId');
        if (el && el.textContent) return el.textContent;
        return 'BTCUSD';
    },


    // ========== 유틸리티 ==========

    _getDecimals(symbol) {
        if (!symbol) return 2;
        if (symbol.includes('JPY')) return 3;
        if (symbol.includes('XAU') || symbol.includes('XAG')) return 2;
        if (symbol.includes('BTC') || symbol.includes('ETH')) return 2;
        if (symbol.includes('US100') || symbol.includes('US30') || symbol.includes('US500')) return 2;
        if (symbol.includes('USD') || symbol.includes('EUR') || symbol.includes('GBP') || symbol.includes('AUD') || symbol.includes('NZD') || symbol.includes('CAD') || symbol.includes('CHF')) return 5;
        return 2;
    },

    _formatTime(opened_at) {
        if (!opened_at) return '';
        try {
            const d = new Date(opened_at);
            if (isNaN(d.getTime())) return '';
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const mi = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            return mm + '/' + dd + ' ' + hh + ':' + mi + ':' + ss;
        } catch (e) {
            return '';
        }
    },


    // ========== 차트 높이 조절 (포지션 표시 공간 확보) ==========

    _chartShrunk: false,

    _shrinkChartHeight() {
        const wrapper = document.getElementById('chart-wrapper');
        if (!wrapper) return;

        // 원래 높이 최초 1회만 저장
        if (!this._originalChartHeight) {
            this._originalChartHeight = wrapper.offsetHeight || wrapper.clientHeight;
        }

        // 원래 높이 기준으로 100px 줄이기 (절대값 — 누적 축소 방지)
        const shrinkAmount = 100;
        const newHeight = Math.max(200, this._originalChartHeight - shrinkAmount);

        // 이미 같은 높이면 스킵
        const currentH = parseInt(wrapper.style.height) || wrapper.offsetHeight;
        if (Math.abs(currentH - newHeight) < 5) return;

        wrapper.style.height = newHeight + 'px';
        this._chartShrunk = true;

        // lightweight-charts 리사이즈
        const container = document.getElementById('chart-container');
        if (window.chart && container) {
            const width = container.offsetWidth || container.clientWidth;
            const indPanels = document.getElementById('indicator-panels');
            const indH = indPanels ? indPanels.offsetHeight : 0;
            const chartH = Math.max(150, newHeight - indH);
            setTimeout(() => {
                try {
                    window.chart.resize(width, chartH);
                    window.chart.timeScale().scrollToRealTime();
                } catch (e) {
                    console.warn('[ChartOrder] chart resize error:', e);
                }
            }, 50);
        }
    },

    _restoreChartHeight() {
        if (!this._chartShrunk) return;
        this._chartShrunk = false;

        const wrapper = document.getElementById('chart-wrapper');
        if (!wrapper) return;

        // 원래 높이 복원
        if (this._originalChartHeight) {
            wrapper.style.height = this._originalChartHeight + 'px';
        } else {
            wrapper.style.height = '';
        }

        // lightweight-charts 리사이즈
        const container = document.getElementById('chart-container');
        if (window.chart && container) {
            const width = container.offsetWidth || container.clientWidth;
            setTimeout(() => {
                try {
                    const indPanels = document.getElementById('indicator-panels');
                    const indH = indPanels ? indPanels.offsetHeight : 0;
                    const restoredH = (wrapper.offsetHeight || wrapper.clientHeight) - indH;
                    window.chart.resize(width, Math.max(200, restoredH));
                    window.chart.timeScale().scrollToRealTime();
                } catch (e) {
                    console.warn('[ChartOrder] chart restore error:', e);
                }
            }, 50);
        }
    },

    _originalChartHeight: null,

};

// 글로벌 접근
window.ChartOrderPanel = ChartOrderPanel;

console.log('[ChartOrderPanel] Module loaded (magic=' + CHART_MAGIC_NUMBER + ')');

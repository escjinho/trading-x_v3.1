/**
 * Open Positions Module — Trading-X v3.1
 * 포지션 실시간 표시 + 개별/복수 청산
 */
const OpenPositions = {
    _positions: [],
    _closeMode: false,
    _selected: new Set(),
    _longPressTimer: null,
    _longPressId: null,
    _currentTab: 'history',
    _pendingCloseType: null,  // 'single' or 'multi'
    _pendingCloseId: null,    // posId for single close

    // ========== 매직넘버 → 뱃지 매핑 ==========
    BADGE_MAP: {
        100001: { label: 'Pro', cls: 'badge-pro' },
        100002: { label: 'V5', cls: 'badge-v5' },
        100003: { label: 'Easy', cls: 'badge-easy' },
        100004: { label: 'Chart', cls: 'badge-chart' }
    },

    // ========== 초기화 ==========
    init() {
        console.log('[OpenPositions] ✅ Module initialized');

        // 페이지 전환 시 바 숨김 처리
        const observer = new MutationObserver(() => {
            this._updateBarVisibility();
        });
        const accountPage = document.getElementById('page-account');
        if (accountPage) {
            observer.observe(accountPage, { attributes: true, attributeFilter: ['class'] });
        }
    },

    // ========== Account 탭 + Open Positions 탭 활성 여부 체크 ==========
    _isVisible() {
        const accountPage = document.getElementById('page-account');
        const isAccountActive = accountPage && accountPage.classList.contains('active');
        return isAccountActive && this._currentTab === 'positions';
    },

    // ========== 하단 바 표시/숨김 ==========
    _updateBarVisibility() {
        const bar = document.getElementById('closePosBar');
        const actionBar = document.getElementById('closePosActionBar');
        const shouldShow = this._isVisible() && this._positions.length > 0;

        if (this._closeMode) {
            if (bar) bar.style.display = 'none';
            if (actionBar) actionBar.style.display = shouldShow ? 'flex' : 'none';
        } else {
            if (bar) bar.style.display = shouldShow ? 'block' : 'none';
            if (actionBar) actionBar.style.display = 'none';
        }
    },

    // ========== 탭 전환 ==========
    switchTab(tab) {
        this._currentTab = tab;
        // 탭 헤더
        document.querySelectorAll('.acc-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        // 콘텐츠
        document.querySelectorAll('.acc-tab-content').forEach(c => {
            c.classList.remove('active');
        });
        const target = tab === 'history' ? 'tabHistory' : 'tabPositions';
        const el = document.getElementById(target);
        if (el) el.classList.add('active');

        // 청산 모드 해제
        if (tab === 'history' && this._closeMode) {
            this.cancelCloseMode();
        }

        // ★ 하단 바 표시/숨김 업데이트
        this._updateBarVisibility();
    },

    // ========== WS 데이터 수신 → 업데이트 ==========
    updatePositions(positions) {
        if (!Array.isArray(positions)) return;
        this._positions = positions;

        // ★ 디버깅: 받은 positions 데이터 확인
        if (positions.length > 0) {
            console.log('[OpenPositions] updatePositions - 첫 번째 포지션:', JSON.stringify(positions[0]));
        }

        // 탭 카운트 업데이트
        const countEl = document.getElementById('openPosCount');
        if (countEl) {
            if (positions.length > 0) {
                countEl.textContent = positions.length;
                countEl.style.display = 'inline';
            } else {
                countEl.style.display = 'none';
            }
        }

        // ★ 하단 바 표시/숨김 업데이트
        this._updateBarVisibility();

        // 현재 탭이 positions일 때만 렌더링
        if (this._currentTab === 'positions') {
            this.render();
        }
    },

    // ========== 카드 렌더링 ==========
    render() {
        const container = document.getElementById('openPositionsList');
        if (!container) return;

        const positions = this._positions;

        if (!positions || positions.length === 0) {
            container.innerHTML = `
                <div class="open-pos-empty">
                    <span class="material-icons-round" style="font-size:40px;color:var(--text-muted);opacity:0.4;">inbox</span>
                    <p style="color:var(--text-muted);margin-top:8px;font-size:13px;">No open positions</p>
                </div>`;
            // 버튼 숨김
            this._updateBarVisibility();
            return;
        }

        let html = '';
        positions.forEach(pos => {
            // ★★★ 라이브(MetaAPI) vs 데모 필드 호환 처리 ★★★
            // MetaAPI: type='POSITION_TYPE_BUY', openPrice, currentPrice, time
            // Demo: type='BUY', entry, current, opened_at
            const posType = pos.type || '';
            const isBuy = posType === 'BUY' || posType === 0 || posType === 'POSITION_TYPE_BUY';
            const typeStr = isBuy ? 'BUY' : 'SELL';
            const cardClass = isBuy ? 'buy-card' : 'sell-card';
            const typeClass = isBuy ? 'buy' : 'sell';
            const badge = this.BADGE_MAP[pos.magic] || { label: 'Pro', cls: 'badge-pro' };

            // 손익
            const profit = pos.profit || 0;
            const profitClass = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'neutral';
            const profitText = profit > 0 ? '+$' + profit.toFixed(2) : profit < 0 ? '-$' + Math.abs(profit).toFixed(2) : '$0.00';

            // 가격 소수점 (라이브: openPrice/currentPrice, 데모: entry/current)
            const decimals = this._getDecimals(pos.symbol);
            const entryPrice = pos.entry || pos.openPrice || 0;
            const currentPrice = pos.current || pos.currentPrice || 0;
            const entryStr = entryPrice.toFixed(decimals);
            const currentStr = currentPrice.toFixed(decimals);

            // 진입 시간 (라이브: time, 데모: opened_at)
            const timeStr = this._formatTime(pos.opened_at || pos.time);

            // 체크박스 (청산 모드일 때)
            const checkboxHtml = this._closeMode
                ? '<div class="open-pos-checkbox ' + (this._selected.has(pos.id) ? 'checked' : '') + '" onclick="OpenPositions.toggleSelect(' + pos.id + ', event)"></div>'
                : '';

            // 선택 상태
            const selectedClass = this._selected.has(pos.id) ? ' selected' : '';

            // ★★★ pos.id를 따옴표로 감싸기 (라이브 모드에서 문자열 ID 지원) ★★★
            const safeId = String(pos.id).replace(/'/g, "\\'");

            html += `
            <div class="open-pos-card ${cardClass}${selectedClass}" data-pos-id="${pos.id}"
                 ontouchstart="OpenPositions._onTouchStart('${safeId}', event)"
                 ontouchmove="OpenPositions._onTouchMove(event)"
                 ontouchend="OpenPositions._onTouchEnd(event)"
                 ontouchcancel="OpenPositions._onTouchEnd(event)"
                 onmousedown="OpenPositions._onTouchStart('${safeId}', event)"
                 onmousemove="OpenPositions._onTouchMove(event)"
                 onmouseup="OpenPositions._onTouchEnd(event)"
                 onmouseleave="OpenPositions._onTouchEnd(event)"
                 ${this._closeMode ? `onclick="OpenPositions.toggleSelect('${safeId}', event)"` : ''}>
                <div class="open-pos-row1">
                    <div class="open-pos-info">
                        ${checkboxHtml}
                        <span class="open-pos-symbol">${pos.symbol}</span>
                        <span class="open-pos-type ${typeClass}">${typeStr}</span>
                        <span class="open-pos-volume">${pos.volume}lot</span>
                        <span class="open-pos-badge ${badge.cls}">${badge.label}</span>
                    </div>
                    <span class="open-pos-profit ${profitClass}">${profitText}</span>
                </div>
                <div class="open-pos-row2">
                    <span class="open-pos-time">${timeStr}</span>
                    <span class="open-pos-prices">${entryStr}<span class="open-pos-arrow"> → </span>${currentStr}</span>
                </div>
            </div>`;
        });

        container.innerHTML = html;

        // 버튼 표시
        this._updateBarVisibility();
    },

    // ========== 소수점 자릿수 ==========
    _getDecimals(symbol) {
        if (!symbol) return 2;
        if (symbol.includes('JPY')) return 3;
        if (symbol.includes('XAU') || symbol.includes('XAG')) return 2;
        if (symbol.includes('BTC') || symbol.includes('ETH')) return 2;
        if (symbol.includes('US100') || symbol.includes('US30') || symbol.includes('US500')) return 2;
        if (symbol.includes('USD') || symbol.includes('EUR') || symbol.includes('GBP') || symbol.includes('AUD') || symbol.includes('NZD') || symbol.includes('CAD') || symbol.includes('CHF')) return 5;
        return 2;
    },

    // ========== 시간 포맷 ==========
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

    // ========== 롱프레스 (개별 청산) ==========
    _onTouchStart(posId, event) {
        console.log('[OpenPositions] touchstart 감지, posId:', posId, 'closeMode:', this._closeMode);
        if (this._closeMode) return;

        // 스크롤 감지용 시작 위치 저장
        this._touchStartY = event.touches ? event.touches[0].clientY : event.clientY;
        this._longPressId = posId;
        this._longPressTimer = setTimeout(() => {
            console.log('[OpenPositions] 롱프레스 600ms 완료, closeSingle 호출:', posId);
            this._longPressTimer = null;
            this.closeSingle(posId);
        }, 600);
    },

    _onTouchMove(event) {
        // 스크롤 시 롱프레스 취소
        if (this._longPressTimer) {
            const currentY = event.touches ? event.touches[0].clientY : event.clientY;
            const deltaY = Math.abs(currentY - (this._touchStartY || 0));
            if (deltaY > 10) {
                console.log('[OpenPositions] touchmove 감지, 롱프레스 취소 (스크롤)');
                clearTimeout(this._longPressTimer);
                this._longPressTimer = null;
            }
        }
    },

    _onTouchEnd(event) {
        console.log('[OpenPositions] touchend 감지, timer:', this._longPressTimer);
        if (this._longPressTimer) {
            clearTimeout(this._longPressTimer);
            this._longPressTimer = null;
        }
    },

    // ========== 바텀시트 표시/숨김 ==========
    showConfirmSheet(type, posId) {
        const sheet = document.getElementById('closeConfirmSheet');
        const content = document.getElementById('closeConfirmContent');
        const executeBtn = document.getElementById('closeConfirmExecute');
        if (!sheet || !content) return;

        this._pendingCloseType = type;
        this._pendingCloseId = posId;

        if (type === 'single') {
            const pos = this._positions.find(p => p.id === posId);
            if (!pos) return;

            const isBuy = pos.type === 'BUY' || pos.type === 0;
            const typeStr = isBuy ? 'BUY' : 'SELL';
            const typeClass = isBuy ? 'buy' : 'sell';
            const profit = pos.profit || 0;
            const profitClass = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'neutral';
            const profitText = profit > 0 ? '+$' + profit.toFixed(2) : profit < 0 ? '-$' + Math.abs(profit).toFixed(2) : '$0.00';

            content.innerHTML = `
                <div class="close-confirm-info">
                    <div>
                        <span class="close-confirm-symbol">${pos.symbol}</span>
                        <span class="close-confirm-type ${typeClass}">${typeStr}</span>
                        <span style="color:var(--text-muted);font-size:12px;margin-left:6px;">${pos.volume}lot</span>
                    </div>
                    <span class="close-confirm-profit ${profitClass}">${profitText}</span>
                </div>
                <div class="close-confirm-message">이 포지션을 청산하시겠습니까?</div>
            `;
        } else {
            const count = this._selected.size;
            content.innerHTML = `
                <div class="close-confirm-message" style="font-size:15px;padding:16px 0;">
                    선택한 <strong style="color:var(--accent-cyan);">${count}개</strong> 포지션을 청산하시겠습니까?
                </div>
            `;
        }

        if (executeBtn) {
            executeBtn.onclick = () => this.confirmClose();
        }

        sheet.classList.add('active');
    },

    hideConfirmSheet() {
        const sheet = document.getElementById('closeConfirmSheet');
        if (sheet) {
            sheet.classList.remove('active');
        }
        this._pendingCloseType = null;
        this._pendingCloseId = null;
    },

    confirmClose() {
        // ★ 먼저 값을 저장한 후 시트 닫기 (순서 중요!)
        const closeType = this._pendingCloseType;
        const closeId = this._pendingCloseId;

        console.log('[OpenPositions] confirmClose:', closeType, closeId);

        this.hideConfirmSheet();

        if (closeType === 'single' && closeId) {
            this._executeCloseSingle(closeId);
        } else if (closeType === 'multi') {
            this._executeCloseMultiple();
        }
    },

    // ========== 개별 청산 (롱프레스) ==========
    closeSingle(posId) {
        console.log('[OpenPositions] closeSingle - posId:', posId, 'type:', typeof posId);
        console.log('[OpenPositions] closeSingle - _positions:', this._positions.map(p => ({ id: p.id, type: typeof p.id, symbol: p.symbol })));

        const pos = this._positions.find(p => p.id === posId || p.id == posId);
        console.log('[OpenPositions] closeSingle - found pos:', pos ? pos.symbol : 'NOT FOUND');

        if (!pos) return;
        this.showConfirmSheet('single', posId);
    },

    async _executeCloseSingle(posId) {
        // ★ 청산 전 포지션 정보 저장 (패널 업데이트용)
        const pos = this._positions.find(p => p.id === posId || p.id == posId);
        const posMagic = pos ? pos.magic : null;
        const posSymbol = pos ? pos.symbol : null;

        // Demo/Live 분기
        // ★★★ 데모: ticket (정수), 라이브: position_id (문자열) ★★★
        let fullUrl;
        if (isDemo) {
            const ticketId = parseInt(posId, 10);
            fullUrl = '/demo/close?ticket=' + ticketId;
        } else {
            // 라이브: position_id는 문자열로 전달 (MetaAPI ID)
            fullUrl = '/mt5/close?position_id=' + encodeURIComponent(posId) + '&symbol=' + encodeURIComponent(posSymbol || '');
        }

        console.log('[OpenPositions] _executeCloseSingle:', {
            originalPosId: posId,
            fullUrl: fullUrl,
            isDemo: isDemo,
            magic: posMagic,
            symbol: posSymbol
        });

        try {
            const resp = await apiCall(fullUrl, 'POST');
            console.log('[OpenPositions] Close response:', resp);

            if (resp && resp.success !== false) {
                showToast('포지션이 청산되었습니다', 'success');
                // Today P/L 업데이트
                if (resp.profit !== undefined && typeof updateTodayPL === 'function') {
                    updateTodayPL(resp.profit);
                }

                // ★★★ _positions 배열에서 제거 (String 비교로 통일) ★★★
                this._positions = this._positions.filter(p => String(p.id) !== String(posId));
                console.log('[OpenPositions] 청산 후 남은 포지션:', this._positions.length);

                // ★★★ UI 즉시 업데이트 ★★★
                this.render();
                this._updateBarVisibility();

                // ★★★ 패널별 상태 초기화 ★★★
                this._syncPanelAfterClose(posMagic, posSymbol, posId);
            } else {
                showToast('청산 실패: ' + (resp?.message || ''), 'error');
            }
        } catch (e) {
            console.error('[OpenPositions] Close error:', e);
            showToast('청산 오류', 'error');
        }
    },

    // ★★★ 청산 후 패널 상태 동기화 ★★★
    _syncPanelAfterClose(magic, symbol, posId) {
        console.log('[OpenPositions] _syncPanelAfterClose:', { magic, symbol, posId });

        // QuickEasy (magic=100003) - 느슨한 비교 사용
        if (magic == 100003 && typeof QuickEasyPanel !== 'undefined') {
            console.log('[OpenPositions] QE 패널 상태 초기화:', symbol);
            // 포지션 딕셔너리에서 제거
            if (QuickEasyPanel._positions && symbol) {
                delete QuickEasyPanel._positions[symbol];
            }
            // 현재 보고 있는 종목이면 UI 초기화
            const currentSym = window.currentSymbol || 'BTCUSD';
            if (symbol === currentSym || QuickEasyPanel._posSymbol === symbol) {
                if (typeof QuickEasyPanel.hidePositionView === 'function') {
                    QuickEasyPanel.hidePositionView(true);
                }
            }
            // 뱃지 업데이트
            if (typeof QuickEasyPanel._updatePositionBadge === 'function') {
                QuickEasyPanel._updatePositionBadge();
            }
        }

        // BuySell Pro (magic=100001) - 느슨한 비교 사용
        if (magic == 100001) {
            console.log('[OpenPositions] BuySell 패널 상태 초기화');
            if (typeof updatePositionUI === 'function') {
                updatePositionUI(false, null);
            }
        }

        // V5 Multi (magic=100002) - 느슨한 비교 사용
        if (magic == 100002) {
            console.log('[OpenPositions] V5 패널 상태 초기화');
            if (typeof v5Positions !== 'undefined' && Array.isArray(v5Positions)) {
                // posId와 symbol 둘 다로 필터링
                window.v5Positions = v5Positions.filter(p =>
                    p.id !== posId && p.id != posId && p.symbol !== symbol
                );
            }
            // V5 패널 UI 갱신
            if (typeof updateMultiOrderPanelV5 === 'function') {
                updateMultiOrderPanelV5();
            }
        }
    },

    // ========== 청산 모드 (체크박스) ==========
    toggleCloseMode() {
        this._closeMode = true;
        this._selected.clear();
        this.render();
        this._updateCloseButton();
    },

    cancelCloseMode() {
        this._closeMode = false;
        this._selected.clear();
        this.render();
    },

    toggleSelect(posId, event) {
        if (event) event.stopPropagation();
        if (this._selected.has(posId)) {
            this._selected.delete(posId);
        } else {
            this._selected.add(posId);
        }
        // 체크박스 UI 즉시 반영
        const card = document.querySelector('.open-pos-card[data-pos-id="' + posId + '"]');
        if (card) {
            card.classList.toggle('selected', this._selected.has(posId));
            const cb = card.querySelector('.open-pos-checkbox');
            if (cb) cb.classList.toggle('checked', this._selected.has(posId));
        }
        this._updateCloseButton();
    },

    selectAllPositions() {
        if (this._selected.size === this._positions.length) {
            this._selected.clear();
        } else {
            this._positions.forEach(p => this._selected.add(p.id));
        }
        this.render();
        this._updateCloseButton();
    },

    _updateCloseButton() {
        const btn = document.getElementById('closePosExecute');
        if (btn) {
            const count = this._selected.size;
            btn.textContent = 'CLOSE (' + count + ')';
            btn.disabled = count === 0;
        }
    },

    executeClosePositions() {
        if (this._selected.size === 0) return;
        this.showConfirmSheet('multi', null);
    },

    async _executeCloseMultiple() {
        const ids = [...this._selected];
        const count = ids.length;
        let successCount = 0;

        // ★ 청산 전 포지션 정보 저장 (패널 업데이트용)
        const posInfos = ids.map(posId => {
            const pos = this._positions.find(p => p.id === posId || p.id == posId);
            return { posId, magic: pos?.magic, symbol: pos?.symbol };
        });

        console.log('[OpenPositions] _executeCloseMultiple:', {
            count: count,
            ids: ids,
            isDemo: isDemo,
            posInfos: posInfos
        });

        for (let i = 0; i < ids.length; i++) {
            const posId = ids[i];
            const info = posInfos[i];

            // ★★★ 데모: ticket, 라이브: position_id ★★★
            let closeUrl;
            if (isDemo) {
                const ticketId = parseInt(posId, 10);
                closeUrl = '/demo/close?ticket=' + ticketId;
            } else {
                closeUrl = '/mt5/close?position_id=' + encodeURIComponent(posId) + '&symbol=' + encodeURIComponent(info.symbol || '');
            }

            try {
                const resp = await apiCall(closeUrl, 'POST');
                console.log('[OpenPositions] Close', posId, ':', resp);

                if (resp && resp.success !== false) {
                    successCount++;
                    if (resp.profit !== undefined && typeof updateTodayPL === 'function') {
                        updateTodayPL(resp.profit);
                    }
                    // ★★★ _positions 배열에서 제거 (String 비교로 통일) ★★★
                    this._positions = this._positions.filter(p => String(p.id) !== String(posId));
                    // ★★★ 패널별 상태 초기화 ★★★
                    this._syncPanelAfterClose(info.magic, info.symbol, posId);
                }
            } catch (e) {
                console.error('[OpenPositions] Close error for', posId, e);
            }
        }

        showToast(successCount + '/' + count + ' 포지션 청산 완료', 'success');
        this.cancelCloseMode();
    }
};

// ========== 전역 함수 (HTML onclick 연결) ==========
function switchAccTab(tab) { OpenPositions.switchTab(tab); }
function toggleCloseMode() { OpenPositions.toggleCloseMode(); }
function cancelCloseMode() { OpenPositions.cancelCloseMode(); }
function selectAllPositions() { OpenPositions.selectAllPositions(); }
function executeClosePositions() { OpenPositions.executeClosePositions(); }

// 초기화
OpenPositions.init();

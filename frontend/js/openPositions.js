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
    },

    // ========== WS 데이터 수신 → 업데이트 ==========
    updatePositions(positions) {
        if (!Array.isArray(positions)) return;
        this._positions = positions;

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

        // Close Position 버튼 표시/숨김
        const bar = document.getElementById('closePosBar');
        if (bar) {
            bar.style.display = positions.length > 0 && !this._closeMode ? 'block' : 'none';
        }

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
            const bar = document.getElementById('closePosBar');
            if (bar) bar.style.display = 'none';
            const actionBar = document.getElementById('closePosActionBar');
            if (actionBar) actionBar.style.display = 'none';
            return;
        }

        let html = '';
        positions.forEach(pos => {
            const isBuy = pos.type === 'BUY' || pos.type === 0;
            const typeStr = isBuy ? 'BUY' : 'SELL';
            const cardClass = isBuy ? 'buy-card' : 'sell-card';
            const typeClass = isBuy ? 'buy' : 'sell';
            const badge = this.BADGE_MAP[pos.magic] || { label: 'Pro', cls: 'badge-pro' };

            // 손익
            const profit = pos.profit || 0;
            const profitClass = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'neutral';
            const profitText = profit > 0 ? '+$' + profit.toFixed(2) : profit < 0 ? '-$' + Math.abs(profit).toFixed(2) : '$0.00';

            // 가격 소수점
            const decimals = this._getDecimals(pos.symbol);
            const entryStr = (pos.entry || 0).toFixed(decimals);
            const currentStr = (pos.current || 0).toFixed(decimals);

            // 진입 시간
            const timeStr = this._formatTime(pos.opened_at);

            // 체크박스 (청산 모드일 때)
            const checkboxHtml = this._closeMode
                ? '<div class="open-pos-checkbox ' + (this._selected.has(pos.id) ? 'checked' : '') + '" onclick="OpenPositions.toggleSelect(' + pos.id + ', event)"></div>'
                : '';

            // 선택 상태
            const selectedClass = this._selected.has(pos.id) ? ' selected' : '';

            html += `
            <div class="open-pos-card ${cardClass}${selectedClass}" data-pos-id="${pos.id}"
                 ontouchstart="OpenPositions._onTouchStart(${pos.id}, event)"
                 ontouchend="OpenPositions._onTouchEnd(event)"
                 ontouchcancel="OpenPositions._onTouchEnd(event)"
                 onmousedown="OpenPositions._onTouchStart(${pos.id}, event)"
                 onmouseup="OpenPositions._onTouchEnd(event)"
                 onmouseleave="OpenPositions._onTouchEnd(event)"
                 ${this._closeMode ? 'onclick="OpenPositions.toggleSelect(' + pos.id + ', event)"' : ''}>
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
        const bar = document.getElementById('closePosBar');
        const actionBar = document.getElementById('closePosActionBar');
        if (this._closeMode) {
            if (bar) bar.style.display = 'none';
            if (actionBar) actionBar.style.display = 'flex';
        } else {
            if (bar) bar.style.display = 'block';
            if (actionBar) actionBar.style.display = 'none';
        }
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
        if (this._closeMode) return;
        this._longPressId = posId;
        this._longPressTimer = setTimeout(() => {
            this._longPressTimer = null;
            this.closeSingle(posId);
        }, 600);
    },

    _onTouchEnd(event) {
        if (this._longPressTimer) {
            clearTimeout(this._longPressTimer);
            this._longPressTimer = null;
        }
    },

    // ========== 개별 청산 (롱프레스) ==========
    closeSingle(posId) {
        const pos = this._positions.find(p => p.id === posId);
        if (!pos) return;

        const isBuy = pos.type === 'BUY' || pos.type === 0;
        const profit = pos.profit || 0;
        const profitText = profit >= 0 ? '+$' + profit.toFixed(2) : '-$' + Math.abs(profit).toFixed(2);

        if (confirm(pos.symbol + ' ' + (isBuy ? 'BUY' : 'SELL') + ' ' + pos.volume + 'lot\nP/L: ' + profitText + '\n\n이 포지션을 청산하시겠습니까?')) {
            this._executeCloseSingle(posId);
        }
    },

    async _executeCloseSingle(posId) {
        try {
            const resp = await apiCall('/demo/close?ticket=' + posId, 'POST');
            if (resp && resp.success !== false) {
                showToast('포지션이 청산되었습니다', 'success');
                // Today P/L 업데이트
                if (resp.profit !== undefined && typeof updateTodayPL === 'function') {
                    updateTodayPL(resp.profit);
                }
            } else {
                showToast('청산 실패: ' + (resp?.message || ''), 'error');
            }
        } catch (e) {
            console.error('[OpenPositions] Close error:', e);
            showToast('청산 오류', 'error');
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

    async executeClosePositions() {
        if (this._selected.size === 0) return;

        const count = this._selected.size;
        if (!confirm('선택한 ' + count + '개 포지션을 청산하시겠습니까?')) return;

        const ids = [...this._selected];
        let successCount = 0;

        for (const posId of ids) {
            try {
                const resp = await apiCall('/demo/close?ticket=' + posId, 'POST');
                if (resp && resp.success !== false) {
                    successCount++;
                    if (resp.profit !== undefined && typeof updateTodayPL === 'function') {
                        updateTodayPL(resp.profit);
                    }
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


// ========== 커스텀 확인 다이얼로그 ==========
var _txDialogResolve = null;

function showTxConfirm(opts) {
    return new Promise(function(resolve) {
        _txDialogResolve = resolve;
        var container = document.getElementById('txDialogContainer');
        if (!container) return resolve(false);

        var msgHtml = (opts.message || '').replace(/\n/g, '<br>');
        var cancelBtn = opts.cancelText
            ? '<button class="tx-dialog-btn cancel" onclick="closeTxDialog(false)">' + opts.cancelText + '</button>'
            : '';

        container.innerHTML =
            '<div class="tx-dialog-overlay" onclick="closeTxDialog(false)">' +
              '<div class="tx-dialog" onclick="event.stopPropagation()">' +
                '<div class="tx-dialog-icon">' +
                  '<div class="tx-dialog-icon-circle ' + (opts.type || 'info') + '">' +
                    '<span class="material-icons-round">' + (opts.icon || 'info') + '</span>' +
                  '</div>' +
                '</div>' +
                '<div class="tx-dialog-body">' +
                  '<div class="tx-dialog-title">' + (opts.title || '') + '</div>' +
                  '<div class="tx-dialog-message">' + msgHtml + '</div>' +
                '</div>' +
                '<div class="tx-dialog-actions">' +
                  cancelBtn +
                  '<button class="tx-dialog-btn ' + (opts.confirmStyle || 'confirm-primary') + '" onclick="closeTxDialog(true)">' + (opts.confirmText || '확인') + '</button>' +
                '</div>' +
              '</div>' +
            '</div>';
    });
}

function closeTxDialog(result) {
    var container = document.getElementById('txDialogContainer');
    if (container) container.innerHTML = '';
    if (_txDialogResolve) {
        _txDialogResolve(result);
        _txDialogResolve = null;
    }
}

// 알림용 (버튼 1개)
function showTxAlert(opts) {
    return showTxConfirm({
        type: opts.type || 'info',
        icon: opts.icon || 'info',
        title: opts.title || '',
        message: opts.message || '',
        confirmText: opts.confirmText || '확인',
        cancelText: '',
        confirmStyle: opts.confirmStyle || 'confirm-primary'
    });
}

/* ========================================
   Trading-X My Tab
   히어로, 설정, 모드 전환
   ======================================== */

// ========== 초기화 ==========
function initMyTab() {
    var userEmail = localStorage.getItem('user_email') || '';
    var userName = userEmail ? userEmail.split('@')[0] : 'Trader';

    // 프로필 (기본값 먼저 표시)
    var avatarEl = document.getElementById('myAvatar');
    var nameEl = document.getElementById('myProfileName');
    var emailEl = document.getElementById('myProfileEmail');
    var nicknameInput = document.getElementById('myNicknameInput');

    if (avatarEl) avatarEl.textContent = userName.charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = userName;
    if (emailEl) emailEl.textContent = userEmail || '-';
    if (nicknameInput) nicknameInput.value = userName;

    // 모드 표시
    updateMyModeDisplay();

    // ★★★ /api/auth/me API 호출 — 실데이터 로드 ★★★
    var tkn = localStorage.getItem('access_token') || '';
    if (tkn) {
        var apiUrl = (typeof API_URL !== 'undefined') ? API_URL : '/api';
        fetch(apiUrl + '/auth/me', {
            headers: { 'Authorization': 'Bearer ' + tkn }
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.email) {
                // 프로필 업데이트 + localStorage 동기화
                localStorage.setItem('user_email', data.email);
                var displayName = data.name || data.email.split('@')[0];
                if (nameEl) nameEl.textContent = displayName;
                if (emailEl) emailEl.textContent = data.email;
                if (avatarEl) avatarEl.textContent = displayName.charAt(0).toUpperCase();
                if (nicknameInput) nicknameInput.value = displayName;

                // 이메일 인증 경고 + 상태 저장
                var warningEl = document.getElementById('myEmailWarning');
                if (warningEl) {
                    warningEl.style.display = data.email_verified ? 'none' : 'flex';
                }
                var emailStateEl = document.getElementById('myEmailState');
                if (emailStateEl) {
                    emailStateEl.textContent = data.email_verified ? '인증됨' : '미인증';
                    emailStateEl.className = data.email_verified ? 'my-email-state verified' : 'my-email-state unverified';
                }
                localStorage.setItem('email_verified', data.email_verified ? 'true' : 'false');

                // 거래 통계 — 모드별 독립, 등급은 항상 Live 기준
                var isLive = (typeof tradingMode !== 'undefined' && tradingMode === 'live');
                var displayTrades = isLive ? (data.live_trades || 0) : (data.demo_trades || 0);
                var displayLots = isLive ? (data.live_lots || 0) : (data.demo_lots || 0);
                updateMyTradeStats(displayTrades, displayLots);

                // Demo 모드에서 등급 노티스
                var gradeNotice = document.getElementById('gradeNotice');
                if (gradeNotice) {
                    gradeNotice.style.display = isLive ? 'none' : 'block';
                }

                // 등급
                var gradeName = data.grade ? data.grade.name : 'Standard';
                var nextGradeName = data.next_grade ? data.next_grade.name : null;
                var remaining = data.next_grade ? data.next_grade.remaining_lots : 0;
                var progress = data.next_grade ? data.next_grade.progress : 100;
                updateMyGradeFromAPI(gradeName, nextGradeName, remaining, progress, data.grade ? data.grade.badge_color : '#9e9e9e');

                // 전역 저장 (VIP 페이지에서 사용)
                window._myProfileData = data;

                console.log('[MyTab] Profile loaded:', displayName, 'Grade:', gradeName, 'Lots:', data.total_lots);
            }
        })
        .catch(function(err) {
            console.log('[MyTab] /me API error:', err.message);
            // API 실패 시 기본값 유지
            var warningEl = document.getElementById('myEmailWarning');
            if (warningEl) warningEl.style.display = 'flex';
            updateMyTradeStats(0, 0);
            updateMyGradeFromAPI('Standard', 'Pro', 100, 0, '#9e9e9e');
        });
    } else {
        // 비로그인
        var warningEl = document.getElementById('myEmailWarning');
        if (warningEl) warningEl.style.display = 'flex';
        updateMyTradeStats(0, 0);
        updateMyGradeFromAPI('Standard', 'Pro', 100, 0, '#9e9e9e');
    }

    console.log('[MyTab] Initialized for user:', userName);
}

// ========== 모드 표시 ==========
function updateMyModeDisplay() {
    const dot = document.getElementById('myModeDot');
    const text = document.getElementById('myModeText');
    const demo = typeof isDemo !== 'undefined' ? isDemo : true;

    if (dot) {
        dot.className = 'my-mode-dot ' + (demo ? 'demo' : 'live');
    }
    if (text) {
        text.className = 'my-mode-text ' + (demo ? 'demo' : 'live');
        text.textContent = demo ? 'Demo' : 'Live';
    }
}

// ========== 거래 통계 ==========
function updateMyTradeStats(count, lots) {
    const countEl = document.getElementById('myTradesCount');
    const lotsEl = document.getElementById('myTradesLots');
    if (countEl) countEl.textContent = count;
    if (lotsEl) lotsEl.textContent = lots.toFixed(2);
}

// ========== 등급 (API 연동) ==========
function updateMyGrade(grade, current, next) {
    // 하위 호환 유지
    updateMyGradeFromAPI(grade, null, next - current, next > 0 ? (current / next) * 100 : 100, '#9e9e9e');
}

function updateMyGradeFromAPI(gradeName, nextGradeName, remainingLots, progress, badgeColor) {
    var gradeEl = document.getElementById('myGradeText');
    var fillEl = document.getElementById('myProgressFill');
    var textEl = document.getElementById('myProgressText');

    if (gradeEl) gradeEl.textContent = gradeName;
    if (fillEl) fillEl.style.width = Math.min(progress, 100) + '%';
    if (textEl) {
        if (nextGradeName && remainingLots > 0) {
            textEl.innerHTML = nextGradeName + ' · ' + remainingLots.toFixed(1) + ' lots <span style="color:#9aa0b0;">남음</span>';
        } else {
            textEl.textContent = '최고 등급 달성! 🎉';
        }
    }
}

// ========== VIP 페이지 렌더링 ==========
function initVipPage() {
    var data = window._myProfileData;
    if (!data) {
        // 데이터 없으면 API 호출
        var tkn = localStorage.getItem('access_token') || '';
        if (!tkn) return;
        var apiUrl = (typeof API_URL !== 'undefined') ? API_URL : '/api';
        fetch(apiUrl + '/auth/me', {
            headers: { 'Authorization': 'Bearer ' + tkn }
        })
        .then(function(res) { return res.json(); })
        .then(function(d) {
            if (d.email) {
                window._myProfileData = d;
                renderVipPage(d);
            }
        })
        .catch(function() {});
        return;
    }
    renderVipPage(data);
}

function renderVipPage(data) {
    var grade = data.grade || { name: 'Standard', badge_color: '#9e9e9e' };
    var nextGrade = data.next_grade;
    var totalLots = data.total_lots || 0;  // 등급 계산용 (항상 Live)
    var isLive = (typeof tradingMode !== 'undefined' && tradingMode === 'live');
    var displayLots = isLive ? (data.live_lots || 0) : (data.demo_lots || 0);  // 거래 현황용
    var displayTrades = isLive ? (data.live_trades || 0) : (data.demo_trades || 0);

    // 현재 등급 카드
    var gradeEl = document.getElementById('myVipGrade');
    var descEl = document.getElementById('myVipDesc');
    var fillEl = document.getElementById('myVipProgressFill');
    var curLabel = document.getElementById('myVipCurrentLabel');
    var nextLabel = document.getElementById('myVipNextLabel');
    var badgeEl = document.getElementById('myVipBadge');
    var card = document.getElementById('myVipCurrentCard');

    if (gradeEl) gradeEl.textContent = grade.name;
    if (badgeEl) {
        var icon = badgeEl.querySelector('.material-icons-round');
        if (icon) icon.style.color = grade.badge_color;
        // 링 + 아이콘 컬러
        var ring = document.getElementById('myVipBadgeRing');
        var bIcon = document.getElementById('myVipBadgeIcon');
        if (ring) {
            ring.style.borderColor = hexToRgba(grade.badge_color, 0.25);
            ring.style.setProperty('--vip-badge-border', hexToRgba(grade.badge_color, 0.6));
        }
        if (bIcon) {
            bIcon.style.background = 'linear-gradient(145deg, ' + hexToRgba(grade.badge_color, 0.12) + ', ' + hexToRgba(grade.badge_color, 0.04) + ')';
            bIcon.style.borderColor = hexToRgba(grade.badge_color, 0.2);
        }
    }
    if (card) {
        card.style.borderColor = hexToRgba(grade.badge_color, 0.3);
        card.style.setProperty('--vip-glow-color', hexToRgba(grade.badge_color, 0.12));
    }
    // 태그 컬러
    var tagEl = document.getElementById('myVipTag');
    if (tagEl) {
        tagEl.style.color = grade.badge_color;
        tagEl.style.borderColor = hexToRgba(grade.badge_color, 0.15);
        tagEl.style.background = hexToRgba(grade.badge_color, 0.06);
    }

    if (nextGrade) {
        if (descEl) descEl.innerHTML = '다음 등급까지 <span style="font-weight:700;color:#fff;">' + nextGrade.remaining_lots.toFixed(1) + '</span> lots 남음';
        if (fillEl) fillEl.style.width = nextGrade.progress + '%';
        if (curLabel) curLabel.textContent = grade.name;
        if (nextLabel) nextLabel.textContent = nextGrade.name;
    } else {
        if (descEl) descEl.textContent = '최고 등급 달성!';
        if (fillEl) fillEl.style.width = '100%';
        if (curLabel) curLabel.textContent = grade.name;
        if (nextLabel) nextLabel.textContent = 'MAX';
    }

    // 거래 현황
    var lotsEl = document.getElementById('myVipTotalLots');
    var tradesEl = document.getElementById('myVipTotalTrades');
    var refEl = document.getElementById('myVipReferral');

    if (lotsEl) lotsEl.textContent = displayLots.toFixed(2);
    if (tradesEl) tradesEl.textContent = displayTrades.toString();
    if (refEl) {
        var refAmount = grade.self_referral || 0;
        refEl.textContent = refAmount > 0 ? ('$' + refAmount + '/lot') : '-';
    }

    // 비교표 — C안: 우상단 체크 원형 + 컬럼 하이라이트
    var allTh = document.querySelectorAll('.my-vip-th');
    for (var i = 0; i < allTh.length; i++) {
        allTh[i].classList.remove('current');
        var oldCheck = allTh[i].querySelector('.my-vip-th-check');
        if (oldCheck) oldCheck.remove();
    }
    var gradeLower = (grade.name || 'standard').toLowerCase();
    var targetTh = document.querySelector('.my-vip-th.' + gradeLower);
    if (targetTh) {
        targetTh.classList.add('current');
        // 체크 아이콘 삽입
        var checkEl = document.createElement('div');
        checkEl.className = 'my-vip-th-check';
        checkEl.innerHTML = '<span class="material-icons-round">check</span>';
        targetTh.style.position = 'relative';
        targetTh.appendChild(checkEl);
        // 컬럼 바디 하이라이트
        var thRow = targetTh.parentElement;
        var colIndex = Array.prototype.indexOf.call(thRow.children, targetTh);
        var tbody = document.querySelector('#myVipTable tbody');
        if (tbody && colIndex >= 0) {
            var rows = tbody.querySelectorAll('tr');
            for (var r = 0; r < rows.length; r++) {
                var cells = rows[r].children;
                for (var c = 0; c < cells.length; c++) {
                    cells[c].classList.remove('current');
                }
                if (cells[colIndex]) cells[colIndex].classList.add('current');
            }
        }
    }
}

// hex → rgba 변환 유틸
function hexToRgba(hex, alpha) {
    if (!hex || hex.charAt(0) !== '#') return 'rgba(158,158,158,' + alpha + ')';
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// ========== 설정 모달 ==========
function openMySettings() {
    document.getElementById('mySettingsOverlay').classList.add('show');
}

function closeMySettings() {
    document.getElementById('mySettingsOverlay').classList.remove('show');
}

function toggleNicknameEdit() {
    const input = document.getElementById('myNicknameInput');
    const icon = document.getElementById('myNicknameEditIcon');

    if (input.readOnly) {
        input.readOnly = false;
        input.focus();
        icon.textContent = 'check';
    } else {
        input.readOnly = true;
        icon.textContent = 'edit';
        // 닉네임 저장 (UI + DB)
        var newName = input.value.trim();
        if (!newName) return;

        const nameEl = document.getElementById('myProfileName');
        if (nameEl) nameEl.textContent = newName;
        const avatarEl = document.getElementById('myAvatar');
        if (avatarEl) avatarEl.textContent = newName.charAt(0).toUpperCase();
        localStorage.setItem('user_nickname', newName);

        // DB에 저장 (API 호출)
        var tkn = localStorage.getItem('access_token');
        if (tkn) {
            fetch(API_URL + '/auth/profile/update-name', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + tkn
                },
                body: JSON.stringify({ name: newName })
            })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (d.success) {
                    showToast('닉네임이 변경되었습니다 ✓', 'success');
                }
            })
            .catch(function(e) { console.error('닉네임 저장 오류:', e); });
        }
    }
}

function toggleMyNoti(el) {
    el.classList.toggle('active');

    // ★★★ localStorage에 설정 저장 + 동기화 ★★★
    var key = el.getAttribute('data-noti-key');
    if (key) {
        var isOn = el.classList.contains('active');
        localStorage.setItem(key, isOn ? 'true' : 'false');
        // ★ 연결된 tr_ 키도 동기화
        _syncNotiToTr(key, isOn);
        // ★ 같은 noti_key를 가진 다른 토글 UI도 동기화
        _syncAllNotiToggles(key, isOn);
    }
}


// ★★★ 알림 설정 동기화 시스템 ★★★
// noti_ ↔ tr_ 키 매핑
var _NOTI_TR_MAP = {
    'noti_order': 'tr_order',
    'noti_close': 'tr_close',
    'noti_liquidation': 'tr_losscut',
    'noti_deposit': 'tr_deposit',
    'noti_sound': 'tr_sound'
};
var _TR_NOTI_MAP = {
    'tr_order': 'noti_order',
    'tr_close': 'noti_close',
    'tr_losscut': 'noti_liquidation',
    'tr_deposit': 'noti_deposit',
    'tr_sound': 'noti_sound'
};

// noti_ 변경 시 → tr_ 동기화
function _syncNotiToTr(notiKey, isOn) {
    var trKey = _NOTI_TR_MAP[notiKey];
    if (trKey) {
        localStorage.setItem(trKey, isOn ? '1' : '0');
        // tr_ UI 토글도 동기화
        var trToggle = document.querySelector('.my-toggle[data-key="' + trKey + '"]');
        if (trToggle) {
            if (isOn) trToggle.classList.add('active');
            else trToggle.classList.remove('active');
        }
    }
}

// tr_ 변경 시 → noti_ 동기화
function _syncTrToNoti(trKey, isOn) {
    var notiKey = _TR_NOTI_MAP[trKey];
    if (notiKey) {
        localStorage.setItem(notiKey, isOn ? 'true' : 'false');
        // noti_ UI 토글도 동기화
        _syncAllNotiToggles(notiKey, isOn);
    }
}

// 같은 noti_key를 가진 모든 토글 UI 동기화
function _syncAllNotiToggles(notiKey, isOn) {
    document.querySelectorAll('.my-toggle[data-noti-key="' + notiKey + '"]').forEach(function(t) {
        if (isOn) t.classList.add('active');
        else t.classList.remove('active');
    });
}

// 알림 설정 페이지 진입 시 저장된 설정 로드
function initNotificationSettings() {
    // ★ 모든 noti_ 토글 UI 동기화 (알림 설정 + 설정 모달 모두)
    var toggles = document.querySelectorAll('.my-toggle[data-noti-key]');
    toggles.forEach(function(toggle) {
        var key = toggle.getAttribute('data-noti-key');
        if (!key) return;

        var stored = localStorage.getItem(key);
        if (stored === null) {
            if (key === 'noti_event') {
                toggle.classList.remove('active');
            }
            return;
        }

        if (stored === 'true') {
            toggle.classList.add('active');
        } else {
            toggle.classList.remove('active');
        }
    });
    // ★ tr_ 토글도 noti_ 기준으로 동기화
    Object.keys(_NOTI_TR_MAP).forEach(function(notiKey) {
        var trKey = _NOTI_TR_MAP[notiKey];
        var notiVal = localStorage.getItem(notiKey);
        if (notiVal !== null) {
            var isOn = notiVal === 'true';
            localStorage.setItem(trKey, isOn ? '1' : '0');
            var trToggle = document.querySelector('.my-toggle[data-key="' + trKey + '"]');
            if (trToggle) {
                if (isOn) trToggle.classList.add('active');
                else trToggle.classList.remove('active');
            }
        }
    });
}

// ========== 모드 전환 모달 ==========
function openModeSwitch() {
    const demo = typeof isDemo !== 'undefined' ? isDemo : true;
    const toMode = demo ? 'Live' : 'Demo';

    document.getElementById('myModeEmoji').textContent = toMode === 'Live' ? '🚀' : '📚';
    document.getElementById('myModeTitle').textContent = 'MT5 ' + toMode + ' 모드';
    document.getElementById('myModeDesc').textContent = toMode === 'Live'
        ? '라이브 모드로 전환됩니다.\n성공 투자 하세요! 🚀'
        : '데모 모드로 전환합니다.\n가상 자금으로 연습하세요.';

    const btn = document.getElementById('myModeConfirmBtn');
    btn.textContent = toMode + ' 모드 전환';
    btn.className = 'my-mode-confirm-btn ' + (toMode === 'Live' ? 'to-live' : 'to-demo');

    document.getElementById('myModeOverlay').classList.add('show');
}

function closeModeSwitch() {
    document.getElementById('myModeOverlay').classList.remove('show');
}

function confirmModeSwitch() {
    const demo = typeof isDemo !== 'undefined' ? isDemo : true;
    const toMode = demo ? 'live' : 'demo';

    // ★ switchTradingMode 호출 (WS 재연결 + 전체 UI 업데이트)
    if (typeof switchTradingMode === 'function') {
        switchTradingMode(toMode);
    }

    // ★ My 탭 프로필 모드 표시 갱신 (Live 비동기 대비 지연)
    setTimeout(() => { updateMyModeDisplay(); }, 500);
    closeModeSwitch();
}

// ========== 로그아웃 확인 ==========
async function confirmLogout() {
    var confirmed = await showTxConfirm({
        type: 'danger',
        icon: 'logout',
        title: '로그아웃',
        message: '정말 로그아웃 하시겠습니까?',
        confirmText: '로그아웃',
        cancelText: '취소',
        confirmStyle: 'confirm-danger'
    });
    if (confirmed && typeof logout === 'function') {
        logout();
    }
}

// ========== 네비게이션 스택 ==========
let myPageStack = ['main'];

function openMySubPage(page) {
    const targetId = 'myView-' + page;
    const targetEl = document.getElementById(targetId);
    if (!targetEl) {
        console.warn('[MyTab] Sub page not found:', targetId);
        return;
    }

    // 현재 뷰 숨기기
    const currentId = myPageStack[myPageStack.length - 1];
    const currentEl = currentId === 'main'
        ? document.getElementById('myMainView')
        : document.getElementById('myView-' + currentId);

    if (currentEl) {
        currentEl.classList.remove('active', 'slide-back');
    }

    // 새 뷰 표시
    targetEl.classList.remove('slide-back');
    targetEl.classList.add('active');

    // 스택에 추가
    myPageStack.push(page);

    // 스크롤 상단으로
    document.getElementById('page-my').scrollTop = 0;

    console.log('[MyTab] Navigate to:', page, 'Stack:', myPageStack);
}

function openMyDetail(detail) {
    // 상세 페이지 타이틀 매핑
    const titles = {
        password: '비밀번호 변경',
        email: '이메일 인증',
        phone: '전화번호 인증',
        personalInfo: '개인정보',
        mt5: 'MT5 계정 관리',
        loginHistory: '로그인 기록',
        kyc: 'KYC',
        depositDemo: 'Demo 입출금',
        depositLive: 'Live 입출금',
        tradingReport: 'Trading Report',
        tradingReportLive: 'Live Trading Report',
        tradingReportDemo: 'Demo Trading Report',
        trAlert: '체결 알림 설정',
        invite: '친구 초대',
        vip: 'VIP 프로그램',
        notification: '알림 설정',
        language: '언어 설정',
        theme: '테마',
        support: '고객센터',
        terms: '약관 및 정책',
        appInfo: '앱 정보',
        depositGuide: '입금 가이드',
        withdrawGuide: '출금 가이드'
    };

    // 전용 뷰가 있는지 확인
    const dedicatedView = document.getElementById('myView-' + detail);
    if (dedicatedView) {
        // 전용 뷰로 이동
        const currentId = myPageStack[myPageStack.length - 1];
        const currentEl = currentId === 'main'
            ? document.getElementById('myMainView')
            : document.getElementById('myView-' + currentId);
        if (currentEl) currentEl.classList.remove('active', 'slide-back');

        dedicatedView.classList.remove('slide-back');
        dedicatedView.classList.add('active');
        myPageStack.push(detail);
        document.getElementById('page-my').scrollTop = 0;

        // 상세 페이지 초기화
        if (typeof initDetailView === 'function') initDetailView(detail);
        
        // 이메일 인증 페이지: API 직접 호출로 정확한 상태 확인
        if (detail === 'email') {
            (function() {
                var eAddr = document.getElementById('myEmailAddr');
                var stateEl = document.getElementById('myEmailState');
                var sendBtn = document.getElementById('myEmailSendBtn');
                var verifyBtn = document.getElementById('myEmailVerifyBtn');
                var resendBtn = document.getElementById('myEmailResendBtn');
                var codeSection = document.getElementById('myEmailCodeSection');
                var statusIcon = document.getElementById('myEmailStatusIcon');
                var descEl = document.querySelector('#myView-email .my-email-desc');

                function applyEmailUI(email, verified) {
                    if (eAddr && email) eAddr.textContent = email;
                    if (verified) {
                        if (stateEl) { stateEl.textContent = '인증 완료'; stateEl.className = 'my-email-state verified'; }
                        if (statusIcon) statusIcon.textContent = 'mark_email_read';
                        if (sendBtn) sendBtn.style.display = 'none';
                        if (verifyBtn) verifyBtn.style.display = 'none';
                        if (resendBtn) resendBtn.style.display = 'none';
                        if (codeSection) codeSection.style.display = 'none';
                        if (descEl) descEl.innerHTML = '<span style="color:#00d4a4;">✓ 이메일 인증이 완료되었습니다.</span><br>계정 보안이 강화되었으며, 비밀번호 분실 시 복구가 가능합니다.';
                    } else {
                        if (stateEl) { stateEl.textContent = '미인증'; stateEl.className = 'my-email-state unverified'; }
                        if (statusIcon) statusIcon.textContent = 'mark_email_unread';
                        if (sendBtn) sendBtn.style.display = '';
                        if (verifyBtn) verifyBtn.style.display = 'none';
                        if (resendBtn) resendBtn.style.display = 'none';
                        if (codeSection) codeSection.style.display = 'none';
                        if (descEl) descEl.innerHTML = '이메일 인증을 완료하면 계정 보안이 강화되고,<br>비밀번호 분실 시 복구가 가능합니다.';
                    }
                }

                // API 직접 호출로 최신 상태 가져오기
                var tkn = localStorage.getItem('access_token');
                if (tkn) {
                    fetch((typeof API_URL !== 'undefined' ? API_URL : '') + '/auth/me', {
                        headers: { 'Authorization': 'Bearer ' + tkn }
                    })
                    .then(function(r) { return r.json(); })
                    .then(function(d) {
                        if (d.email) {
                            localStorage.setItem('user_email', d.email);
                            localStorage.setItem('email_verified', d.email_verified ? 'true' : 'false');
                            applyEmailUI(d.email, d.email_verified);
                        }
                    })
                    .catch(function(e) { console.error('이메일 상태 조회 실패:', e); });
                }
            })();
        }

        // ★ 알림 설정 페이지면 저장된 설정 로드
        if (detail === 'notification') {
            initNotificationSettings();
        }

        // ★ VIP 페이지면 데이터 로드
        if (detail === 'vip') {
            initVipPage();
        }

        console.log('[MyTab] Navigate to detail:', detail, 'Stack:', myPageStack);
        return;
    }

    // 전용 뷰 없으면 플레이스홀더 사용
    const titleEl = document.getElementById('myDetailTitle');
    if (titleEl) titleEl.textContent = titles[detail] || detail;

    const currentId = myPageStack[myPageStack.length - 1];
    const currentEl = document.getElementById('myView-' + currentId);
    if (currentEl) currentEl.classList.remove('active', 'slide-back');

    const detailView = document.getElementById('myView-detail');
    if (detailView) {
        detailView.classList.remove('slide-back');
        detailView.classList.add('active');
    }

    myPageStack.push('detail');
    document.getElementById('page-my').scrollTop = 0;
    console.log('[MyTab] Navigate to detail (placeholder):', detail, 'Stack:', myPageStack);
}

function myGoBack() {
    if (myPageStack.length <= 1) return;

    // ★ 떠나는 뷰의 타이머 정리
    var leavingId = myPageStack[myPageStack.length - 1];
    if (leavingId === 'tradingReportLive' && typeof stopTradingReportRefresh === 'function') stopTradingReportRefresh();
    if (leavingId === 'tradingReportDemo' && typeof stopDemoReportRefresh === 'function') stopDemoReportRefresh();
    if (leavingId === 'depositLive' && typeof stopLiveRefresh === 'function') stopLiveRefresh();

    // 현재 뷰 숨기기
    const currentId = myPageStack.pop();
    const currentEl = currentId === 'main'
        ? document.getElementById('myMainView')
        : (currentId === 'detail'
            ? document.getElementById('myView-detail')
            : document.getElementById('myView-' + currentId));

    if (currentEl) {
        currentEl.classList.remove('active', 'slide-back');
    }

    // 이전 뷰 표시 (뒤로가기 애니메이션)
    const prevId = myPageStack[myPageStack.length - 1];
    const prevEl = prevId === 'main'
        ? document.getElementById('myMainView')
        : document.getElementById('myView-' + prevId);

    if (prevEl) {
        prevEl.classList.add('active', 'slide-back');
    }

    // 스크롤 상단으로
    document.getElementById('page-my').scrollTop = 0;

    console.log('[MyTab] Go back to:', prevId, 'Stack:', myPageStack);
}

// My 탭 진입 시 메인으로 리셋
function resetMyTab() {
    // 모든 뷰 숨기기
    document.querySelectorAll('#page-my .my-view').forEach(v => {
        v.classList.remove('active', 'slide-back');
    });
    // 메인 뷰 표시
    const mainView = document.getElementById('myMainView');
    if (mainView) mainView.classList.add('active');
    // 스택 리셋
    myPageStack = ['main'];
}

// ========== 비밀번호 변경 ==========
function togglePwVisibility(inputId, toggleEl) {
    const input = document.getElementById(inputId);
    const icon = toggleEl.querySelector('.material-icons-round');
    if (input.type === 'password') {
        input.type = 'text';
        icon.textContent = 'visibility';
    } else {
        input.type = 'password';
        icon.textContent = 'visibility_off';
    }
}

async function changePassword() {
    const currentPw = document.getElementById('myCurrentPw').value;
    const newPw = document.getElementById('myNewPw').value;
    const confirmPw = document.getElementById('myConfirmPw').value;

    // 유효성 검사
    if (!currentPw) {
        showToast('현재 비밀번호를 입력해주세요', 'error');
        return;
    }
    if (!newPw) {
        showToast('새 비밀번호를 입력해주세요', 'error');
        return;
    }
    if (newPw.length < 8) {
        showToast('비밀번호는 8자 이상이어야 합니다', 'error');
        return;
    }
    if (!/[a-zA-Z]/.test(newPw) || !/[0-9]/.test(newPw)) {
        showToast('영문과 숫자를 모두 포함해주세요', 'error');
        return;
    }
    if (newPw !== confirmPw) {
        showToast('새 비밀번호가 일치하지 않습니다', 'error');
        return;
    }
    if (currentPw === newPw) {
        showToast('현재와 다른 비밀번호를 입력해주세요', 'error');
        return;
    }

    // API 호출
    try {
        const token = localStorage.getItem('access_token') || '';
        if (!token) {
            showToast('로그인이 필요합니다', 'error');
            return;
        }

        const res = await fetch(API_URL + '/auth/password/change', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                current_password: currentPw,
                new_password: newPw
            })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            showToast('비밀번호가 변경되었습니다! ✓', 'success');

            // 입력 필드 초기화
            document.getElementById('myCurrentPw').value = '';
            document.getElementById('myNewPw').value = '';
            document.getElementById('myConfirmPw').value = '';

            // 1초 후 뒤로가기
            setTimeout(function() {
                myGoBack();
            }, 1000);
        } else {
            showToast(data.detail || '비밀번호 변경 실패', 'error');
        }
    } catch (err) {
        console.error('비밀번호 변경 오류:', err);
        showToast('서버 연결 실패', 'error');
    }
}

// ========== 이메일 인증 ==========
let emailTimerInterval = null;
let emailTimerSeconds = 300; // 5분

// 현재 로그인한 사용자 이메일
function getCurrentUserEmail() {
    // 1순위: 프로필 DOM, 2순위: localStorage
    const profileEl = document.getElementById('myProfileEmail');
    if (profileEl && profileEl.textContent && profileEl.textContent !== '-') {
        return profileEl.textContent;
    }
    return localStorage.getItem('user_email') || '';
}

function initEmailView() {
    const emailEl = document.getElementById('myEmailAddr');
    
    // 1순위: 프로필 DOM
    const profileEmail = document.getElementById('myProfileEmail');
    if (profileEmail && profileEmail.textContent && profileEmail.textContent !== '-') {
        if (emailEl) emailEl.textContent = profileEmail.textContent;
        return;
    }
    
    // 2순위: localStorage
    const stored = localStorage.getItem('user_email');
    if (stored) {
        if (emailEl) emailEl.textContent = stored;
        return;
    }
    
    // 3순위: API 직접 호출
    const tkn = localStorage.getItem('access_token');
    if (tkn) {
        fetch((typeof API_URL !== 'undefined' ? API_URL : '') + '/auth/me', {
            headers: { 'Authorization': 'Bearer ' + tkn }
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.email) {
                if (emailEl) emailEl.textContent = d.email;
                localStorage.setItem('user_email', d.email);
            }
        })
        .catch(function(e) { console.error('이메일 조회 실패:', e); });
    }
}

async function sendEmailCode() {
    const email = getCurrentUserEmail();
    if (!email) {
        showToast('로그인 정보를 확인할 수 없습니다', 'error');
        return;
    }

    // 버튼 비활성화 (중복 클릭 방지)
    const sendBtn = document.getElementById('myEmailSendBtn');
    if (sendBtn) sendBtn.disabled = true;

    try {
        // API_URL은 config.js에서 전역 정의됨
        const res = await fetch(API_URL + '/auth/email/send-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
        });

        const data = await res.json();

        if (!res.ok) {
            showToast(data.detail || '발송 실패', 'error');
            if (sendBtn) sendBtn.disabled = false;
            return;
        }

        // 테스트 모드일 때 코드 표시 (개발용)
        if (data.test_mode && data.test_code) {
            console.log('[TEST] 인증코드:', data.test_code);
            showToast('테스트 모드: ' + data.test_code, 'info');
        } else {
            showToast('인증코드가 발송되었습니다', 'success');
        }

        // 코드 입력 섹션 표시
        document.getElementById('myEmailCodeSection').style.display = 'block';
        document.getElementById('myEmailSendBtn').style.display = 'none';
        document.getElementById('myEmailVerifyBtn').style.display = 'flex';

        // 타이머 시작 (5분)
        if (emailTimerInterval) clearInterval(emailTimerInterval);
        emailTimerSeconds = 300;
        updateEmailTimer();
        emailTimerInterval = setInterval(() => {
            emailTimerSeconds--;
            updateEmailTimer();
            if (emailTimerSeconds <= 0) {
                clearInterval(emailTimerInterval);
                showToast('인증코드가 만료되었습니다', 'error');
                resetEmailView();
            }
        }, 1000);

        // 입력 필드 초기화 및 포커스
        // 재발송 버튼 표시
        const resendBtn = document.getElementById('myEmailResendBtn');
        if (resendBtn) resendBtn.style.display = '';
        
        document.querySelectorAll('.my-email-code-input').forEach(inp => inp.value = '');
        const firstInput = document.querySelector('.my-email-code-input[data-idx="0"]');
        if (firstInput) firstInput.focus();

    } catch (err) {
        console.error('이메일 인증코드 발송 오류:', err);
        showToast('서버 연결 실패', 'error');
        if (sendBtn) sendBtn.disabled = false;
    }
}

function updateEmailTimer() {
    const min = Math.floor(emailTimerSeconds / 60).toString().padStart(2, '0');
    const sec = (emailTimerSeconds % 60).toString().padStart(2, '0');
    const timerEl = document.getElementById('myEmailTimer');
    if (timerEl) timerEl.textContent = `${min}:${sec}`;
}

function onEmailCodeInput(input) {
    const idx = parseInt(input.dataset.idx);
    const value = input.value;

    // 숫자만 허용
    input.value = value.replace(/[^0-9]/g, '');

    // 다음 칸으로 이동
    if (input.value && idx < 5) {
        const nextInput = document.querySelector(`.my-email-code-input[data-idx="${idx + 1}"]`);
        if (nextInput) nextInput.focus();
    }
}

async function verifyEmailCode() {
    const email = getCurrentUserEmail();
    if (!email) {
        showToast('로그인 정보를 확인할 수 없습니다', 'error');
        return;
    }

    // 6자리 코드 수집
    const inputs = document.querySelectorAll('.my-email-code-input');
    let code = '';
    inputs.forEach(input => code += input.value);

    if (code.length !== 6) {
        showToast('6자리 코드를 입력해주세요', 'error');
        return;
    }

    // 버튼 비활성화
    const verifyBtn = document.getElementById('myEmailVerifyBtn');
    if (verifyBtn) verifyBtn.disabled = true;

    try {
        // API_URL은 config.js에서 전역 정의됨
        const res = await fetch(API_URL + '/auth/email/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, code: code })
        });

        const data = await res.json();

        if (data.success) {
            // 타이머 정지
            if (emailTimerInterval) {
                clearInterval(emailTimerInterval);
                emailTimerInterval = null;
            }

            // 인증 완료 상태 업데이트
            const stateEl = document.getElementById('myEmailState');
            const iconEl = document.getElementById('myEmailStatusIcon');
            if (stateEl) {
                stateEl.textContent = '인증됨';
                stateEl.className = 'my-email-state verified';
            }
            if (iconEl) iconEl.textContent = 'mark_email_read';

            // 메인 화면 이메일 경고 숨기기
            const warningEl = document.getElementById('myEmailWarning');
            if (warningEl) warningEl.style.display = 'none';

            showToast('이메일 인증이 완료되었습니다 ✓', 'success');

            setTimeout(() => myGoBack(), 1000);
        } else {
            showToast(data.message || data.detail || '인증 실패', 'error');
            if (verifyBtn) verifyBtn.disabled = false;

            // 실패 시 입력 흔들기 애니메이션
            const codeRow = document.querySelector('.my-email-code-row');
            if (codeRow) {
                codeRow.style.animation = 'none';
                codeRow.offsetHeight; // reflow
                codeRow.style.animation = 'shake 0.3s ease';
            }
        }
    } catch (err) {
        console.error('인증코드 검증 오류:', err);
        showToast('서버 연결 실패', 'error');
        if (verifyBtn) verifyBtn.disabled = false;
    }
}

function resetEmailView() {
    document.getElementById('myEmailCodeSection').style.display = 'none';
    const sendBtn = document.getElementById('myEmailSendBtn');
    if (sendBtn) {
        sendBtn.style.display = 'flex';
        sendBtn.disabled = false;
    }
    document.getElementById('myEmailVerifyBtn').style.display = 'none';
    document.querySelectorAll('.my-email-code-input').forEach(input => input.value = '');
}

// 이메일 코드 입력 백스페이스 핸들링
document.addEventListener('keydown', function(e) {
    if (e.target.matches('.my-email-code-input') && e.key === 'Backspace' && !e.target.value) {
        const idx = parseInt(e.target.dataset.idx);
        if (idx > 0) {
            const prevInput = document.querySelector(`.my-email-code-input[data-idx="${idx - 1}"]`);
            if (prevInput) {
                prevInput.focus();
                prevInput.value = '';
            }
        }
    }
});

// ========== MT5 계정 관리 ==========
function initMt5View() {
    var demo = typeof isDemo !== 'undefined' ? isDemo : true;

    var demoBtn = document.getElementById('myMt5DemoBtn');
    var liveBtn = document.getElementById('myMt5LiveBtn');
    var demoCheck = document.getElementById('myMt5DemoCheck');
    var liveCheck = document.getElementById('myMt5LiveCheck');
    var modeStatus = document.getElementById('myMt5ModeStatus');

    if (demo) {
        if (demoBtn) { demoBtn.classList.add('active'); demoBtn.classList.remove('live-active'); }
        if (liveBtn) { liveBtn.classList.remove('active', 'live-active'); }
        if (demoCheck) demoCheck.style.display = 'flex';
        if (liveCheck) liveCheck.style.display = 'none';
        if (modeStatus) { modeStatus.classList.remove('live'); modeStatus.innerHTML = '<span class="my-mt5-status-dot demo"></span><span><strong style="color:#ffffff;">데모 모드</strong> - 가상 자금으로 자유롭게 연습하세요</span>'; }
    } else {
        if (liveBtn) { liveBtn.classList.remove('active'); liveBtn.classList.add('live-active'); }
        if (demoBtn) { demoBtn.classList.remove('active', 'live-active'); }
        if (liveCheck) liveCheck.style.display = 'flex';
        if (demoCheck) demoCheck.style.display = 'none';
        if (modeStatus) { modeStatus.classList.add('live'); modeStatus.innerHTML = '<span class="my-mt5-status-dot live"></span><span><strong>라이브 모드</strong> - 실거래 활성화 됨</span>'; }
    }

    loadMT5AccountInfo();
}

// ★★★ MT5 계정 정보 로드 — 홈 DOM 우선, 없으면 API fallback ★★★
function loadMT5AccountInfo() {
    var readHome = function(id) {
        var el = document.getElementById(id);
        return el ? el.textContent.trim() : '';
    };

    var data = {
        broker: readHome('homeBroker'),
        account: readHome('homeAccount'),
        leverage: readHome('homeLeverage'),
        server: readHome('homeServer'),
        balance: readHome('homeBalance'),
        equity: readHome('homeEquity'),
        freeMargin: readHome('homeFreeMargin'),
        positions: readHome('homePositions')
    };

    // 홈 DOM에 데이터가 아직 없으면 (-, 빈값, $0.00) API fallback
    var hasData = data.broker && data.broker !== '-' && data.broker !== '';
    if (!hasData) {
        // API fallback으로 직접 가져오기
        var tkn = localStorage.getItem('access_token') || '';
        if (!tkn) { updateMT5Display(null); return; }
        var apiUrl = (typeof API_URL !== 'undefined') ? API_URL : '/api';

        fetch(apiUrl + '/demo/account-info', {
            headers: { 'Authorization': 'Bearer ' + tkn }
        })
        .then(function(res) { return res.json(); })
        .then(function(demoData) {
            var demo = typeof isDemo !== 'undefined' ? isDemo : true;
            var fmt = function(v) {
                var n = parseFloat(v) || 0;
                return '$' + n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
            };

            if (demo) {
                // ★ 데모 모드: 항상 데모 정보만 표시
                updateMT5Display({
                    broker: demoData.broker || 'Trading-X Markets',
                    account: demoData.account || '-',
                    leverage: demoData.leverage ? ('1:' + demoData.leverage) : '1:500',
                    server: demoData.server || 'Demo Server',
                    balance: fmt(demoData.balance || 10000),
                    equity: fmt(demoData.equity || demoData.balance || 10000),
                    freeMargin: fmt(demoData.free_margin || demoData.balance || 10000),
                    positions: (demoData.positions_count || 0).toString()
                });
            } else if (demoData.has_mt5) {
                // ★ 라이브 모드 + MT5 연결: MT5 정보 조회
                fetch(apiUrl + '/mt5/account-info', {
                    headers: { 'Authorization': 'Bearer ' + tkn }
                })
                .then(function(r) { return r.json(); })
                .then(function(mt5Data) {
                    updateMT5Display({
                        broker: mt5Data.broker || demoData.broker || '-',
                        account: mt5Data.account || demoData.account || '-',
                        leverage: mt5Data.leverage ? ('1:' + mt5Data.leverage) : '-',
                        server: mt5Data.server || demoData.server || '-',
                        balance: fmt(mt5Data.balance || demoData.balance),
                        equity: fmt(mt5Data.equity || demoData.equity),
                        freeMargin: fmt(mt5Data.free_margin || demoData.free_margin),
                        positions: (mt5Data.positions_count || demoData.positions_count || 0).toString()
                    });
                })
                .catch(function() {
                    updateMT5Display({
                        broker: demoData.broker || '-',
                        account: demoData.account || '-',
                        leverage: demoData.leverage ? ('1:' + demoData.leverage) : '-',
                        server: demoData.server || '-',
                        balance: fmt(demoData.balance),
                        equity: fmt(demoData.equity),
                        freeMargin: fmt(demoData.free_margin),
                        positions: (demoData.positions_count || 0).toString()
                    });
                });
            } else {
                // ★ 라이브 모드 + MT5 미연결: 데모 정보 표시
                updateMT5Display({
                    broker: demoData.broker || 'Trading-X Markets',
                    account: demoData.account || '-',
                    leverage: demoData.leverage ? ('1:' + demoData.leverage) : '1:500',
                    server: demoData.server || 'Demo Server',
                    balance: fmt(demoData.balance || 10000),
                    equity: fmt(demoData.equity || demoData.balance || 10000),
                    freeMargin: fmt(demoData.free_margin || demoData.balance || 10000),
                    positions: (demoData.positions_count || 0).toString()
                });
            }
        })
        .catch(function() { updateMT5Display(null); });
        return;
    }

    // 홈 DOM에 데이터가 있으면 그대로 사용
    updateMT5Display(data);
}

// ★★★ MT5 UI 업데이트 ★★★
function updateMT5Display(data) {
    var set = function(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val || '-';
    };

    if (!data) {
        set('myMt5Broker', '-');
        set('myMt5Account', '-');
        set('myMt5Leverage', '-');
        set('myMt5Server', '-');
        set('myMt5Balance', '-');
        set('myMt5Equity', '-');
        set('myMt5FreeMargin', '-');
        set('myMt5Positions', '0');
        return;
    }

    set('myMt5Broker', data.broker);
    set('myMt5Account', data.account);
    set('myMt5Leverage', data.leverage);
    set('myMt5Server', data.server);
    set('myMt5Balance', data.balance);
    set('myMt5Equity', data.equity);
    set('myMt5FreeMargin', data.freeMargin);
    set('myMt5Positions', data.positions);
}

// ★★★ My 페이지에서 모드 전환 ★★★
function switchMyMt5Mode(mode) {
    // 홈 화면의 실제 모드 전환 호출
    if (typeof switchTradingMode === 'function') {
        switchTradingMode(mode);
    }

    // My 페이지 UI 갱신
    var demoBtn = document.getElementById('myMt5DemoBtn');
    var liveBtn = document.getElementById('myMt5LiveBtn');
    var demoCheck = document.getElementById('myMt5DemoCheck');
    var liveCheck = document.getElementById('myMt5LiveCheck');
    var modeStatus = document.getElementById('myMt5ModeStatus');

    if (mode === 'demo') {
        if (demoBtn) { demoBtn.classList.add('active'); demoBtn.classList.remove('live-active'); }
        if (liveBtn) { liveBtn.classList.remove('active', 'live-active'); }
        if (demoCheck) demoCheck.style.display = 'flex';
        if (liveCheck) liveCheck.style.display = 'none';
        if (modeStatus) { modeStatus.classList.remove('live'); modeStatus.innerHTML = '<span class="my-mt5-status-dot demo"></span><span><strong style="color:#ffffff;">데모 모드</strong> - 가상 자금으로 자유롭게 연습하세요</span>'; }
    } else {
        if (liveBtn) { liveBtn.classList.remove('active'); liveBtn.classList.add('live-active'); }
        if (demoBtn) { demoBtn.classList.remove('active', 'live-active'); }
        if (liveCheck) liveCheck.style.display = 'flex';
        if (demoCheck) demoCheck.style.display = 'none';
        if (modeStatus) { modeStatus.classList.add('live'); modeStatus.innerHTML = '<span class="my-mt5-status-dot live"></span><span><strong>라이브 모드</strong> - 실거래 활성화 됨</span>'; }
    }

    // 모드 전환 후 홈 DOM 데이터가 갱신될 시간을 주고 다시 읽기
    setTimeout(function() { loadMT5AccountInfo(); }, 800);
}

// ★★★ 연결 새로고침 ★★★
function refreshMyMt5Info() {
    showToast('계정 정보를 갱신합니다...', 'info');
    // 홈 화면 데이터 갱신 트리거
    if (typeof checkAndUpdateMT5Status === 'function') {
        checkAndUpdateMT5Status();
    }
    // 약간 딜레이 후 DOM에서 다시 읽기
    setTimeout(function() { loadMT5AccountInfo(); }, 1000);
}

// 호환성: 기존 함수명 래핑
function switchMt5Account(mode) { switchMyMt5Mode(mode); }
function refreshMt5Connection() { refreshMyMt5Info(); }

// ========== 로그인 기록 ==========
async function loadLoginHistory() {
    var listEl = document.getElementById('myLoginHistoryList');
    if (!listEl) return;

    listEl.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text-dim);font-size:13px;">불러오는 중...</div>';

    try {
        var tkn = localStorage.getItem('access_token');
        var res = await fetch(API_URL + '/auth/login-history', {
            headers: { 'Authorization': 'Bearer ' + tkn }
        });

        if (!res.ok) {
            listEl.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text-dim);font-size:13px;">기록을 불러올 수 없습니다</div>';
            return;
        }

        var data = await res.json();
        var records = data.records || [];

        if (records.length === 0) {
            listEl.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text-dim);font-size:13px;">로그인 기록이 없습니다</div>';
            return;
        }

        var html = '';
        records.forEach(function(r) {
            var icon = r.device_type === 'mobile' ? 'smartphone' : (r.device_type === 'tablet' ? 'tablet' : 'computer');
            var isCurrent = r.is_current;
            var currentClass = isCurrent ? ' current' : '';

            // 디바이스 이름 조합
            var deviceName = '';
            if (isCurrent) {
                deviceName = '현재 기기';
            } else {
                deviceName = r.browser + ' · ' + r.os;
            }

            // 메타 정보 (모바일: 국가만 / 데스크톱: 도시+국가)
            var locDisplay = '';
            if (r.location) {
                if (r.device_type === 'mobile' || r.device_type === 'tablet') {
                    // 모바일: "Seoul, South Korea" → "South Korea"만 표시
                    var locParts = r.location.split(', ');
                    locDisplay = locParts.length > 1 ? locParts[locParts.length - 1] : r.location;
                } else {
                    // 데스크톱/기타: 전체 표시 (도시+국가)
                    locDisplay = r.location;
                }
            }

            var meta = '';
            if (isCurrent) {
                deviceName = r.browser + ' · ' + r.os;
                meta = (locDisplay ? locDisplay + ' · ' : '') + '방금 전';
            } else {
                meta = (locDisplay ? locDisplay + ' · ' : '') + r.time_str;
            }

            var badge = isCurrent ? '<span class="my-login-current-badge">현재 세션</span>' : '';

            html += '<div class="my-login-history-item' + currentClass + '">';
            html += '  <div class="my-login-history-icon"><span class="material-icons-round">' + icon + '</span></div>';
            html += '  <div class="my-login-history-info">';
            html += '    <div class="my-login-history-device">' + deviceName + '</div>';
            html += '    <div class="my-login-history-meta">' + meta + '</div>';
            html += '  </div>';
            html += badge;
            html += '</div>';
        });

        listEl.innerHTML = html;

    } catch (err) {
        console.error('로그인 기록 조회 오류:', err);
        listEl.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text-dim);font-size:13px;">오류가 발생했습니다</div>';
    }
}

async function logoutAllDevices() {
    var confirmed = await showTxConfirm({
        type: 'danger',
        icon: 'devices',
        title: '전체 기기 로그아웃',
        message: '모든 기기에서 로그아웃 하시겠습니까?\n현재 기기도 로그아웃됩니다.',
        confirmText: '로그아웃',
        cancelText: '취소',
        confirmStyle: 'confirm-danger'
    });
    if (confirmed) {
        // TODO: API 연동
        if (typeof logout === 'function') {
            logout();
        } else {
            if (typeof showToast === 'function') showToast('모든 기기에서 로그아웃되었습니다', 'success');
        }
    }
}

// ========== Demo 입출금 ==========
let selectedDemoAmount = 10000;

async function loadDemoBalance() {
    try {
        var tkn = localStorage.getItem('access_token');
        var res = await fetch(API_URL + '/auth/me', {
            headers: { 'Authorization': 'Bearer ' + tkn }
        });
        var data = await res.json();
        var balEl = document.getElementById('myDemoBalance');
        if (balEl && data.demo_balance !== undefined) {
            balEl.textContent = '$' + Number(data.demo_balance).toLocaleString('en-US', { minimumFractionDigits: 2 });
        } else if (balEl) {
            balEl.textContent = '$10,000.00';
        }
    } catch (e) {
        console.error('데모 잔고 로드 오류:', e);
    }
}

function selectDemoAmount(amount) {
    selectedDemoAmount = amount;
    document.querySelectorAll('.my-deposit-amount-btn').forEach(btn => {
        const btnAmount = parseInt(btn.textContent.replace(/[$,]/g, ''));
        btn.classList.toggle('selected', btnAmount === amount);
    });
}

async function handleDemoDeposit() {
    try {
        var tkn = localStorage.getItem('access_token');
        var res = await fetch(API_URL + '/demo/topup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + tkn
            },
            body: JSON.stringify({ amount: selectedDemoAmount })
        });
        var data = await res.json();
        if (data.success) {
            // My 탭 잔고 표시 업데이트
            var balEl = document.getElementById('myDemoBalance');
            if (balEl) balEl.textContent = '$' + Number(data.balance).toLocaleString('en-US', { minimumFractionDigits: 2 });
            // 홈 화면 데모 데이터도 갱신
            if (typeof fetchDemoData === 'function') fetchDemoData();
            showToast(data.message, 'success');
        } else {
            showTxAlert({
                type: 'warn',
                icon: 'account_balance_wallet',
                title: '최대 잔고 도달',
                message: '데모 잔고가 최대 $100,000에 도달했습니다.\n잔고 리셋 후 다시 충전할 수 있습니다.',
                confirmText: '확인',
                confirmStyle: 'confirm-warn'
            });
        }
    } catch (e) {
        console.error('충전 오류:', e);
        showToast('충전 실패', 'error');
    }
}

async function handleDemoReset() {
    var confirmed = await showTxConfirm({
        type: 'warn',
        icon: 'restart_alt',
        title: '잔고 초기화',
        message: '정말 잔고를 $10,000로 초기화하시겠습니까?\n모든 포지션과 거래 기록이 삭제됩니다.',
        confirmText: '초기화',
        cancelText: '취소',
        confirmStyle: 'confirm-warn'
    });
    if (!confirmed) return;

    try {
        var tkn = localStorage.getItem('access_token');
        var res = await fetch(API_URL + '/demo/reset', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + tkn }
        });
        var data = await res.json();
        if (data.success) {
            var balEl = document.getElementById('myDemoBalance');
            if (balEl) balEl.textContent = '$10,000.00';
            // 홈 화면 데모 데이터도 갱신
            if (typeof fetchDemoData === 'function') fetchDemoData();
            showToast(data.message, 'success');
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {
        console.error('리셋 오류:', e);
        showToast('리셋 실패', 'error');
    }
}

// ========== 상세 페이지 진입 시 초기화 ==========
// openMyDetail 함수에서 호출됨
function initDetailView(detail) {
    switch (detail) {
        case 'email':
            initEmailView();
            break;
        case 'mt5':
            initMt5View();
            break;
        case 'depositLive':
            console.log('[LIVE-DEBUG] depositLive case 진입');
            startLiveRefresh();
            break;
        case 'depositDemo':
            // 금액 선택 초기화
            selectedDemoAmount = 10000;
            document.querySelectorAll('.my-deposit-amount-btn').forEach(btn => {
                const btnAmount = parseInt(btn.textContent.replace(/[$,]/g, ''));
                btn.classList.toggle('selected', btnAmount === 10000);
            });
            // 실제 잔고 로드
            loadDemoBalance();
            break;
        case 'openSource':
            setTimeout(renderOpenSource, 50);
            break;
        case 'phone':
            initPhoneView();
            break;
        case 'personalInfo':
            piResetView();
            break;
        case 'loginHistory':
            loadLoginHistory();
            break;
        case 'tradingReportDemo':
            if (typeof startDemoReportRefresh === 'function') startDemoReportRefresh();
            break;
        case 'tradingReportLive':
            if (typeof startTradingReportRefresh === 'function') startTradingReportRefresh();
            break;
    }
}

// ========== 친구 초대 ==========
function copyInviteCode() {
    const code = document.getElementById('myInviteCode');
    if (!code) return;

    const text = code.textContent;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            if (typeof showToast === 'function') {
                showToast('📋 추천 코드가 복사되었습니다: ' + text, 'success');
            }
        }).catch(() => {
            fallbackCopyInviteCode(text);
        });
    } else {
        fallbackCopyInviteCode(text);
    }
}

function fallbackCopyInviteCode(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        if (typeof showToast === 'function') {
            showToast('📋 추천 코드가 복사되었습니다: ' + text, 'success');
        }
    } catch (e) {
        if (typeof showToast === 'function') {
            showToast('복사에 실패했습니다. 직접 복사해주세요.', 'error');
        }
    }
    document.body.removeChild(textarea);
}

function shareInviteCode() {
    const code = document.getElementById('myInviteCode');
    const text = code ? code.textContent : 'TRADEX';
    const shareData = {
        title: 'Trading-X 초대',
        text: 'Trading-X에서 함께 트레이딩해요! 추천코드: ' + text,
        url: 'https://trading-x.ai?ref=' + text
    };

    if (navigator.share) {
        navigator.share(shareData).catch(() => {
            copyInviteCode();
        });
    } else {
        copyInviteCode();
    }
}

// ========== 초대 링크 복사 ==========
function copyInviteLink() {
    var linkEl = document.getElementById('myInviteLink');
    if (!linkEl) return;
    var text = linkEl.textContent;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function() {
            showToast('✅ 초대 링크가 복사되었습니다');
        });
    } else {
        showToast('✅ 초대 링크가 복사되었습니다');
    }
}

// ========== QR 코드 모달 ==========
var _inviteQrGenerated = false;

function showInviteQR() {
    var overlay = document.getElementById('inviteQrOverlay');
    if (!overlay) return;
    overlay.classList.add('show');

    // QR 한 번만 생성
    if (!_inviteQrGenerated) {
        var container = document.getElementById('inviteQrCode');
        var link = document.getElementById('myInviteLink');
        var qrLink = document.getElementById('inviteQrLink');
        var url = link ? link.textContent : 'https://trading-x.ai';

        if (qrLink) qrLink.textContent = url;

        if (container && typeof QRCode !== 'undefined') {
            container.innerHTML = '';
            new QRCode(container, {
                text: url,
                width: 200,
                height: 200,
                colorDark: '#ffffff',
                colorLight: '#1a1a28',
                correctLevel: QRCode.CorrectLevel.M
            });
            _inviteQrGenerated = true;
        } else {
            container.innerHTML = '<div style="color:#999;font-size:12px;padding:20px;">QR 코드 생성 중...</div>';
        }
    }
}

function closeInviteQR(e) {
    if (e && e.target !== e.currentTarget) return;
    var overlay = document.getElementById('inviteQrOverlay');
    if (overlay) overlay.classList.remove('show');
}

// ========== 언어 선택 ==========
function selectMyLanguage(el, lang) {
    document.querySelectorAll('#myView-language .my-radio-item').forEach(item => {
        item.classList.remove('selected');
    });
    el.classList.add('selected');
    localStorage.setItem('app_language', lang);

    if (typeof showToast === 'function') {
        const names = { ko: '한국어', en: 'English', ja: '日本語', zh: '中文', th: 'ภาษาไทย' };
        showToast('🌐 ' + (names[lang] || lang) + '로 변경되었습니다', 'success');
    }
}

// ========== 테마 선택 ==========
function selectMyTheme(el, theme) {
    document.querySelectorAll('.my-theme-card').forEach(card => {
        card.classList.remove('selected');
    });
    el.classList.add('selected');

    if (theme === 'light') {
        if (typeof showToast === 'function') {
            showToast('☀️ 라이트 모드는 준비 중입니다', 'info');
        }
        // 다시 다크 선택으로 복원
        setTimeout(() => {
            document.querySelectorAll('.my-theme-card').forEach(card => card.classList.remove('selected'));
            document.querySelector('.my-theme-card')?.classList.add('selected');
        }, 300);
        return;
    }

    localStorage.setItem('app_theme', theme);
}

// ========== 고객센터 ==========
function handleSupportAction(type) {
    if (type === 'telegram') {
        window.open('https://t.me/tradingx_support', '_blank');
    } else if (type === 'email') {
        window.location.href = 'mailto:support@trading-x.ai';
    } else if (type === 'faq') {
        if (typeof showToast === 'function') {
            showToast('📖 FAQ 페이지는 준비 중입니다', 'info');
        }
    }
}

// ========== 약관 ==========
function handleTermsAction(type) {
    const urls = {
        service: 'https://trading-x.ai/terms',
        privacy: 'https://trading-x.ai/privacy',
        risk: 'https://trading-x.ai/risk-disclosure',
        aml: 'https://trading-x.ai/aml-policy'
    };
    if (urls[type]) {
        window.open(urls[type], '_blank');
    }
}

// ========== 앱 정보 ==========
function handleCheckUpdate() {
    if (typeof showToast === 'function') {
        showToast('✅ 현재 최신 버전입니다 (v3.1.0)', 'success');
    }
}

function handleClearCache() {
    if (confirm('캐시를 삭제하시겠습니까?')) {
        if ('caches' in window) {
            caches.keys().then(names => {
                names.forEach(name => caches.delete(name));
            });
        }
        if (typeof showToast === 'function') {
            showToast('🧹 캐시가 삭제되었습니다', 'success');
        }
    }
}

// ========== 공지사항 & FAQ ==========
function switchNoticeTab(tab, el) {
    document.querySelectorAll('#myView-noticeFaq .my-tab-item').forEach(t => t.classList.remove('active'));
    el.classList.add('active');

    const noticeList = document.getElementById('myNoticeList');
    const faqList = document.getElementById('myFaqList');

    if (tab === 'notice') {
        noticeList.style.display = 'block';
        faqList.style.display = 'none';
    } else {
        noticeList.style.display = 'none';
        faqList.style.display = 'block';
    }
}

function toggleFaq(el) {
    el.classList.toggle('open');
}

const noticeData = {
    1: { type: '공지', date: '02.20', title: 'Trading-X v3.1 업데이트 안내', body: '안녕하세요, Trading-X입니다.\n\n금일 v3.1 업데이트가 배포되었습니다.\n\n주요 변경사항:\n• My 탭 전면 개편\n• Quick & Easy 패널 개선\n• 틱차트 애니메이션 줌인 효과 추가\n• 포지션 라인 표시 개선\n\n문의사항은 고객센터로 연락 부탁드립니다.' },
    2: { type: '점검', date: '02.18', title: '2/22(토) 서버 정기 점검 안내', body: '안녕하세요, Trading-X입니다.\n\n아래와 같이 서버 정기 점검이 예정되어 있습니다.\n\n• 일시: 2026년 2월 22일 (토) 06:00 ~ 08:00 (KST)\n• 내용: 서버 안정화 및 보안 업데이트\n\n점검 시간 동안 서비스 이용이 제한됩니다.\n불편을 드려 죄송합니다.' },
    3: { type: '이벤트', date: '02.15', title: 'VIP 리워드 & 레퍼럴 프로그램 안내', body: '안녕하세요, Trading-X입니다.\n\nVIP 리워드 프로그램과 친구 초대(레퍼럴) 프로그램을 안내드립니다.\n\n[ VIP 등급별 리워드 ]\n• Standard: 기본 등급\n• Pro (누적 100 lots): 거래 시 $1/lot 캐시백\n• VIP (누적 300 lots): 거래 시 $2/lot 캐시백\n\n[ 친구 초대 프로그램 ]\n• 추천 코드로 친구를 초대하세요\n• 친구의 거래 활동에 따라 리워드 지급\n• My > 소셜 & 멤버십 > 친구 초대에서 내 추천 코드를 확인하세요\n\n많은 참여 부탁드립니다!' },
    4: { type: '공지', date: '02.10', title: '약관 및 정책 전면 개편 안내', body: '안녕하세요, Trading-X입니다.\n\n서비스 약관 및 정책이 전면 개편되었습니다.\n\n주요 변경사항:\n• 투자 위험 고지(Risk Disclosure) 별도 페이지 신설\n• 자금세탁방지 정책(AML) 별도 페이지 신설\n• 마케팅 정보 수신 동의 내용 보강\n• 전 문서 한국어/English 토글 지원\n\n자세한 내용은 My > 일반 > 약관 및 정책에서 확인하실 수 있습니다.\n\n시행일: 2026년 1월 5일' },
    5: { type: '공지', date: '01.20', title: 'HedgeHood 브로커 연동 시작', body: '안녕하세요, Trading-X입니다.\n\nHedgeHood Pty Ltd 브로커와의 공식 연동이 시작되었습니다.\n\n• ASIC 규제 브로커\n• 최대 1:500 레버리지\n• 빠른 입출금 지원\n\nMy > 내 계정 > MT5 계정 관리에서 계정을 연결하세요.' },
    6: { type: '공지', date: '01.15', title: '개인정보 처리방침 변경 안내', body: '안녕하세요, Trading-X입니다.\n\n개인정보 처리방침이 일부 변경되었습니다.\n\n• 시행일: 2026년 1월 5일\n• 변경 내용: 마케팅 정보 수신 동의 항목 추가, 개인정보 보호책임자 정보 갱신\n\n자세한 내용은 약관 및 정책 > 개인정보 처리방침에서 확인하실 수 있습니다.' },
    7: { type: '안내', date: '01.10', title: 'MT5 계정 연동 가이드', body: '안녕하세요, Trading-X입니다.\n\nMT5 브로커 계정을 Trading-X에 연동하는 방법을 안내드립니다.\n\n[ 연동 절차 ]\n1. My > 트레이딩 > MT5 계정 관리 이동\n2. 브로커 계좌번호 입력\n3. MT5 비밀번호(투자자 비밀번호) 입력\n4. 서버 정보 선택\n5. 연결 버튼 클릭\n\n[ 사전 준비 ]\n• 이메일 인증 완료 필수\n• 브로커 계좌 개설 및 KYC 완료 필수\n• 투자자 비밀번호(Read-Only 아님) 필요\n\n[ 참고사항 ]\n• 연동 후 잔고·포지션이 자동으로 동기화됩니다\n• 30분 비활동 시 자동 연결 해제, 재접속 시 자동 재연결됩니다\n• 문의: support@trading-x.ai' }
};

function openNoticeDetail(id) {
    const data = noticeData[id];
    if (!data) return;

    document.getElementById('myNoticeDetailMeta').textContent = data.type + ' · ' + data.date;
    document.getElementById('myNoticeDetailTitle').textContent = data.title;
    document.getElementById('myNoticeDetailBody').textContent = data.body;

    openMyDetail('noticeDetail');
}

// ========== 약관 상세 ==========
const iframeTermsMap = {
    service: { url: 'terms.html', title: '서비스 이용약관' },
    privacy: { url: 'privacy.html', title: '개인정보 처리방침' },
    risk: { url: 'risk.html', title: '투자 위험 고지' },
    aml: { url: 'aml.html', title: '자금세탁방지 정책 (AML)' },
    marketing: { url: 'marketing.html', title: '마케팅 정보 수신 동의' }
};

function openTermsDetail(type) {
    const iframe = iframeTermsMap[type];
    if (iframe) {
        document.getElementById('myTermsDetailTitle').textContent = iframe.title;
        document.getElementById('myTermsDetailBody').innerHTML = '<iframe src="' + iframe.url + '" style="width:100%;height:calc(100vh - 120px);border:none;border-radius:8px;"></iframe>';
        openMyDetail('termsDetail');
        return;
    }
}


// ========== 회원 탈퇴 ==========
function startWithdrawal() {
    document.getElementById('withdrawalModal').style.display = 'flex';
    showWithdrawStep(1);
}

function closeWithdrawalModal() {
    document.getElementById('withdrawalModal').style.display = 'none';
    document.querySelectorAll('input[name="withdrawReason"]').forEach(r => r.checked = false);
    const input = document.getElementById('withdrawConfirmInput');
    if (input) input.value = '';
    checkWithdrawConfirm();
}

function showWithdrawStep(step) {
    document.getElementById('withdrawStep1').style.display = step === 1 ? 'block' : 'none';
    document.getElementById('withdrawStep2').style.display = step === 2 ? 'block' : 'none';
    document.getElementById('withdrawStep3').style.display = step === 3 ? 'block' : 'none';
}

function checkWithdrawConfirm() {
    const input = document.getElementById('withdrawConfirmInput');
    const btn = document.getElementById('withdrawFinalBtn');
    if (!input || !btn) return;
    const isMatch = input.value.trim() === '탈퇴합니다';
    btn.disabled = !isMatch;
    btn.style.background = isMatch ? '#ff4757' : 'rgba(255,71,87,0.3)';
    btn.style.color = isMatch ? '#fff' : 'rgba(255,71,87,0.4)';
    btn.style.cursor = isMatch ? 'pointer' : 'not-allowed';
}

async function executeWithdrawal() {
    const reason = document.querySelector('input[name="withdrawReason"]:checked');
    const reasonValue = reason ? reason.value : 'not_specified';
    const btn = document.getElementById('withdrawFinalBtn');
    btn.disabled = true;
    btn.textContent = '처리 중...';
    try {
        const token = localStorage.getItem('access_token');
        const res = await fetch('/api/auth/withdraw?reason=' + encodeURIComponent(reasonValue), {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (data.success) {
            closeWithdrawalModal();
            localStorage.removeItem('access_token');
            localStorage.removeItem('user_info');
            localStorage.removeItem('refresh_token');
            showToast('회원 탈퇴가 완료되었습니다. 이용해주셔서 감사합니다.');
            setTimeout(() => { window.location.href = '/login.html'; }, 2000);
        } else {
            showToast(data.message || '탈퇴 처리 중 오류가 발생했습니다.');
            btn.disabled = false;
            btn.textContent = '회원 탈퇴';
        }
    } catch (e) {
        showToast('서버 연결에 실패했습니다.');
        btn.disabled = false;
        btn.textContent = '회원 탈퇴';
    }
}

function switchToDemo() {
    if (typeof switchTradingMode === 'function') {
        switchTradingMode('demo');
    }
}

// ========== 1:1 문의하기 ==========
function handleContactEmail() {
    const email = 'support@trading-x.ai';
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(email).then(() => {
            if (typeof showToast === 'function') showToast('📋 이메일 주소가 복사되었습니다', 'success');
        });
    } else {
        window.location.href = 'mailto:' + email;
    }
}

function handleContactTelegram() {
    window.open('https://t.me/TradingX_Support', '_blank');
}

// ========== 오픈소스 라이선스 ==========
// ========== 오픈소스 라이선스 ==========
const openSourceLibs = [
    ["React", "18.x", "MIT", "Meta"],
    ["FastAPI", "0.100+", "MIT", "S. Ramírez"],
    ["MetaAPI SDK", "27.x", "SEE LICENSE", "MetaApi"],
    ["Chart.js", "4.x", "MIT", "Contributors"],
    ["PostgreSQL", "15+", "PostgreSQL", "PGDG"],
    ["SQLAlchemy", "2.x", "MIT", "M. Bayer"],
    ["Redis", "7.x", "BSD-3", "Redis Ltd."],
    ["Tailwind", "3.x", "MIT", "Tailwind Labs"],
    ["Material Icons", "-", "Apache 2.0", "Google"],
    ["Pydantic", "2.x", "MIT", "S. Colvin"],
    ["bcrypt", "4.x", "Apache 2.0", "OpenBSD"]
];

function renderOpenSource() {
    const container = document.getElementById('myOpenSourceList');
    if (!container) return;
    container.innerHTML = '';

    openSourceLibs.forEach(([name, ver, license, author]) => {
        const item = document.createElement('div');
        item.className = 'my-oss-item';
        item.innerHTML = '<div class="my-oss-top"><span class="my-oss-name">' + name + '</span><span class="my-oss-license">' + license + '</span></div><div class="my-oss-meta">' + ver + ' · ' + author + '</div>';
        container.appendChild(item);
    });
}



// ========== 개인정보 관리 ==========
let piUserData = null;

const nationalityNames = {
    'KR': '🇰🇷 대한민국', 'US': '🇺🇸 미국', 'JP': '🇯🇵 일본', 'CN': '🇨🇳 중국',
    'VN': '🇻🇳 베트남', 'TH': '🇹🇭 태국', 'PH': '🇵🇭 필리핀', 'MY': '🇲🇾 말레이시아',
    'SG': '🇸🇬 싱가포르', 'AU': '🇦🇺 호주', 'GB': '🇬🇧 영국', 'OTHER': '기타'
};

function piResetView() {
    document.getElementById('piPasswordGate').style.display = '';
    document.getElementById('piViewMode').style.display = 'none';
    document.getElementById('piEditMode').style.display = 'none';
    var modal = document.getElementById('piPasswordModal');
    if (modal) modal.style.display = 'none';
    var pwInput = document.getElementById('piGatePassword');
    if (pwInput) pwInput.value = '';
    piUserData = null;
}

async function piVerifyPassword() {
    var pw = document.getElementById('piGatePassword').value;
    if (!pw) { showToast('비밀번호를 입력해주세요', 'error'); return; }

    try {
        var res = await fetch(API_URL + '/auth/profile/verify-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('access_token')
            },
            body: JSON.stringify({ password: pw })
        });
        var data = await res.json();

        if (!res.ok) {
            showToast(data.detail || '비밀번호가 올바르지 않습니다', 'error');
            return;
        }

        piUserData = data.data;
        piRenderViewMode();
        document.getElementById('piPasswordGate').style.display = 'none';
        document.getElementById('piViewMode').style.display = '';

    } catch (err) {
        console.error('비밀번호 확인 오류:', err);
        showToast('오류가 발생했습니다', 'error');
    }
}

function piRenderViewMode() {
    var d = piUserData;
    if (!d) return;

    document.getElementById('piEmail').textContent = d.email || '-';
    document.getElementById('piEmail').style.fontWeight = '700';

    var ca = d.created_at;
    if (ca) {
        var dt = new Date(ca);
        document.getElementById('piCreatedAt').style.fontWeight = '700';
        document.getElementById('piCreatedAt').textContent = dt.getFullYear() + '.' + String(dt.getMonth()+1).padStart(2,'0') + '.' + String(dt.getDate()).padStart(2,'0');
    }

    document.getElementById('piRealName').textContent = d.real_name || '미등록';
    document.getElementById('piRealName').style.color = d.real_name ? 'var(--text-primary)' : 'var(--text-dim)';
    document.getElementById('piRealName').style.fontStyle = d.real_name ? 'normal' : 'italic';
    document.getElementById('piRealName').style.fontWeight = d.real_name ? '700' : '400';

    document.getElementById('piNickname').textContent = d.name || '-';
    document.getElementById('piNickname').style.fontWeight = '700';

    var bd = d.birth_date;
    if (bd) {
        document.getElementById('piBirthDate').textContent = bd.replace(/-/g, '.');
        document.getElementById('piBirthDate').style.color = 'var(--text-primary)';
        document.getElementById('piBirthDate').style.fontStyle = 'normal';
        document.getElementById('piBirthDate').style.fontWeight = '700';
    } else {
        document.getElementById('piBirthDate').textContent = '미등록';
        document.getElementById('piBirthDate').style.color = 'var(--text-dim)';
        document.getElementById('piBirthDate').style.fontStyle = 'italic';
    }

    var nat = d.nationality;
    if (nat && nationalityNames[nat]) {
        document.getElementById('piNationality').textContent = nationalityNames[nat];
        document.getElementById('piNationality').style.color = 'var(--text-primary)';
        document.getElementById('piNationality').style.fontStyle = 'normal';
        document.getElementById('piNationality').style.fontWeight = '700';
    } else {
        document.getElementById('piNationality').textContent = '미등록';
        document.getElementById('piNationality').style.color = 'var(--text-dim)';
        document.getElementById('piNationality').style.fontStyle = 'italic';
    }

    // 이메일 인증 배지
    var emailBadge = document.getElementById('piEmailBadge');
    if (d.email_verified) {
        emailBadge.textContent = '인증됨';
        emailBadge.style.background = 'rgba(0,212,164,0.15)';
        emailBadge.style.color = '#00d4a4';
    } else {
        emailBadge.textContent = '미인증';
        emailBadge.style.background = 'rgba(255,77,106,0.15)';
        emailBadge.style.color = '#ff4d6a';
    }

    // 전화번호 + 인증 배지
    var phoneNum = document.getElementById('piPhoneNum');
    var phoneBadge = document.getElementById('piPhoneBadge');
    if (d.phone) {
        phoneNum.textContent = formatPhone(d.phone);
        phoneNum.style.color = 'var(--text-primary)';
        phoneNum.style.fontWeight = '700';
    } else {
        phoneNum.textContent = '미등록';
        phoneNum.style.color = 'var(--text-dim)';
    }
    if (d.phone_verified) {
        phoneBadge.textContent = '인증됨';
        phoneBadge.style.background = 'rgba(0,212,164,0.15)';
        phoneBadge.style.color = '#00d4a4';
    } else {
        phoneBadge.textContent = '미인증';
        phoneBadge.style.background = 'rgba(255,77,106,0.15)';
        phoneBadge.style.color = '#ff4d6a';
    }
}

function piShowEditMode() {
    var d = piUserData;
    if (!d) return;

    document.getElementById('piEditEmail').value = d.email || '';
    document.getElementById('piEditRealName').value = d.real_name || '';
    document.getElementById('piEditNickname').value = d.name || '';
    document.getElementById('piEditPhone').value = d.phone || '';
    // 생년월일 드롭다운 세팅
    if (d.birth_date) {
        var parts = d.birth_date.split('-');
        if (parts.length === 3) {
            document.getElementById('piBirthYear').value = parts[0];
            document.getElementById('piBirthMonth').value = parts[1];
            document.getElementById('piBirthDay').value = parts[2];
        }
    } else {
        document.getElementById('piBirthYear').value = '';
        document.getElementById('piBirthMonth').value = '';
        document.getElementById('piBirthDay').value = '';
    }
    document.getElementById('piEditNationality').value = d.nationality || '';

    document.getElementById('piViewMode').style.display = 'none';
    document.getElementById('piEditMode').style.display = '';
}

function piCancelEdit() {
    document.getElementById('piEditMode').style.display = 'none';
    document.getElementById('piViewMode').style.display = '';
}

function piSaveInfo() {
    // 비밀번호 재확인 모달 열기
    var modal = document.getElementById('piPasswordModal');
    modal.style.display = 'flex';
    document.getElementById('piSavePassword').value = '';
    document.getElementById('piSavePassword').focus();
}

function piCloseModal() {
    document.getElementById('piPasswordModal').style.display = 'none';
}

async function piConfirmSave() {
    var pw = document.getElementById('piSavePassword').value;
    if (!pw) { showToast('비밀번호를 입력해주세요', 'error'); return; }

    var body = {
        real_name: document.getElementById('piEditRealName').value,
        name: document.getElementById('piEditNickname').value,
        phone: document.getElementById('piEditPhone').value,
        birth_date: (function() {
            var y = document.getElementById('piBirthYear').value;
            var m = document.getElementById('piBirthMonth').value;
            var d = document.getElementById('piBirthDay').value;
            return (y && m && d) ? y + '-' + m + '-' + d : '';
        })(),
        nationality: document.getElementById('piEditNationality').value,
        password: pw
    };

    try {
        var res = await fetch(API_URL + '/auth/profile/personal', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('access_token')
            },
            body: JSON.stringify(body)
        });
        var data = await res.json();

        if (!res.ok) {
            showToast(data.detail || '저장에 실패했습니다', 'error');
            return;
        }

        piCloseModal();
        piUserData = data.data;
        piRenderViewMode();
        document.getElementById('piEditMode').style.display = 'none';
        document.getElementById('piViewMode').style.display = '';

        // 프로필 닉네임 동기화
        var profileName = document.getElementById('myProfileName');
        if (profileName && data.data.name) profileName.textContent = data.data.name;
        var avatarEl = document.getElementById('myAvatar');
        if (avatarEl && data.data.name) avatarEl.textContent = data.data.name.charAt(0).toUpperCase();

        showToast('개인정보가 저장되었습니다 ✓', 'success');

    } catch (err) {
        console.error('개인정보 저장 오류:', err);
        showToast('저장 중 오류가 발생했습니다', 'error');
    }
}

// ========== 전화번호 인증 ==========
let phoneTimerInterval = null;
let phoneTimerSeconds = 300;
let currentVerifyPhone = '';

function initPhoneView() {
    var tkn = localStorage.getItem('access_token');
    if (tkn) {
        fetch((typeof API_URL !== 'undefined' ? API_URL : '') + '/auth/me', {
            headers: { 'Authorization': 'Bearer ' + tkn }
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var phoneEl = document.getElementById('myPhoneNumber');
            var stateEl = document.getElementById('myPhoneState');
            var sendBtn = document.getElementById('myPhoneSendBtn');
            var verifyBtn = document.getElementById('myPhoneVerifyBtn');
            var resendBtn = document.getElementById('myPhoneResendBtn');
            var codeSection = document.getElementById('myPhoneCodeSection');
            var inputSection = document.getElementById('myPhoneInputSection');
            var descEl = document.getElementById('myPhoneDesc');
            var phoneInput = document.getElementById('myPhoneInput');

            if (d.phone_verified && d.phone) {
                if (phoneEl) phoneEl.textContent = formatPhone(d.phone);
                if (stateEl) { stateEl.textContent = '인증 완료'; stateEl.className = 'my-email-state verified'; }
                if (sendBtn) sendBtn.style.display = 'none';
                if (verifyBtn) verifyBtn.style.display = 'none';
                if (resendBtn) resendBtn.style.display = 'none';
                if (codeSection) codeSection.style.display = 'none';
                if (inputSection) inputSection.style.display = 'none';
                if (descEl) descEl.innerHTML = '<span style="color:#00d4ff;">✓ 전화번호 인증이 완료되었습니다.</span><br>계정 보안이 강화되었으며, 중요 알림을 SMS로 받을 수 있습니다.';
            } else {
                if (stateEl) { stateEl.textContent = '미인증'; stateEl.className = 'my-email-state unverified'; }
                if (sendBtn) sendBtn.style.display = '';
                if (verifyBtn) verifyBtn.style.display = 'none';
                if (resendBtn) resendBtn.style.display = 'none';
                if (codeSection) codeSection.style.display = 'none';
                if (inputSection) inputSection.style.display = '';
                if (d.phone && phoneInput) phoneInput.value = d.phone;
            }
        })
        .catch(function(e) { console.error('전화번호 상태 조회 실패:', e); });
    }
}

function formatPhone(phone) {
    var p = phone.replace(/[^0-9]/g, '');
    if (p.length === 11) return p.substring(0,3) + '-' + p.substring(3,7) + '-' + p.substring(7);
    if (p.length === 10) return p.substring(0,3) + '-' + p.substring(3,6) + '-' + p.substring(6);
    return phone;
}

async function sendPhoneCode() {
    var phoneInput = document.getElementById('myPhoneInput');
    var phone = phoneInput ? phoneInput.value.replace(/[^0-9]/g, '') : '';
    if (!phone || phone.length < 10) { showToast('올바른 전화번호를 입력해주세요', 'error'); return; }

    var sendBtn = document.getElementById('myPhoneSendBtn');
    if (sendBtn) sendBtn.disabled = true;

    try {
        var res = await fetch(API_URL + '/auth/phone/send-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phone })
        });
        var data = await res.json();
        if (!res.ok) { showToast(data.detail || '발송 실패', 'error'); if (sendBtn) sendBtn.disabled = false; return; }

        currentVerifyPhone = phone;
        if (data.test_mode && data.test_code) {
            console.log('[TEST] SMS 인증코드:', data.test_code);
            showToast('테스트 모드: ' + data.test_code, 'info');
        } else {
            showToast('인증코드가 발송되었습니다', 'success');
        }

        document.getElementById('myPhoneCodeSection').style.display = '';
        document.getElementById('myPhoneVerifyBtn').style.display = '';
        document.getElementById('myPhoneResendBtn').style.display = '';
        document.getElementById('myPhoneInputSection').style.display = 'none';
        if (sendBtn) sendBtn.style.display = 'none';

        if (phoneTimerInterval) clearInterval(phoneTimerInterval);
        phoneTimerSeconds = 300;
        updatePhoneTimer();
        phoneTimerInterval = setInterval(function() {
            phoneTimerSeconds--;
            updatePhoneTimer();
            if (phoneTimerSeconds <= 0) { clearInterval(phoneTimerInterval); showToast('인증코드가 만료되었습니다', 'error'); }
        }, 1000);

        document.querySelectorAll('.my-phone-code-input').forEach(function(inp) { inp.value = ''; });
        var firstInput = document.querySelector('.my-phone-code-input[data-idx="0"]');
        if (firstInput) firstInput.focus();
    } catch (err) {
        console.error('SMS 인증코드 발송 오류:', err);
        showToast('발송 중 오류가 발생했습니다', 'error');
    }
    if (sendBtn) sendBtn.disabled = false;
}

function updatePhoneTimer() {
    var min = Math.floor(phoneTimerSeconds / 60).toString().padStart(2, '0');
    var sec = (phoneTimerSeconds % 60).toString().padStart(2, '0');
    var el = document.getElementById('myPhoneTimer');
    if (el) el.textContent = min + ':' + sec;
}

function onPhoneCodeInput(el) {
    if (el.value.length === 1) {
        var idx = parseInt(el.getAttribute('data-idx'));
        var next = document.querySelector('.my-phone-code-input[data-idx="' + (idx + 1) + '"]');
        if (next) next.focus();
    }
}

async function verifyPhoneCode() {
    var code = '';
    document.querySelectorAll('.my-phone-code-input').forEach(function(inp) { code += inp.value; });
    if (code.length !== 6) { showToast('6자리 코드를 모두 입력해주세요', 'error'); return; }

    try {
        var token = localStorage.getItem('access_token');
        var res = await fetch(API_URL + '/auth/phone/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ phone: currentVerifyPhone, code: code })
        });
        var data = await res.json();

        if (res.ok && data.success) {
            if (phoneTimerInterval) clearInterval(phoneTimerInterval);
            var stateEl = document.getElementById('myPhoneState');
            if (stateEl) { stateEl.textContent = '인증 완료'; stateEl.className = 'my-email-state verified'; }
            var phoneEl = document.getElementById('myPhoneNumber');
            if (phoneEl) phoneEl.textContent = formatPhone(currentVerifyPhone);
            var descEl = document.getElementById('myPhoneDesc');
            if (descEl) descEl.innerHTML = '<span style="color:#00d4ff;">✓ 전화번호 인증이 완료되었습니다.</span><br>계정 보안이 강화되었으며, 중요 알림을 SMS로 받을 수 있습니다.';
            document.getElementById('myPhoneSendBtn').style.display = 'none';
            document.getElementById('myPhoneVerifyBtn').style.display = 'none';
            document.getElementById('myPhoneResendBtn').style.display = 'none';
            document.getElementById('myPhoneCodeSection').style.display = 'none';
            showToast('전화번호 인증이 완료되었습니다 ✓', 'success');

            // 개인정보 데이터 동기화 (다음 열람 시 최신 반영)
            if (piUserData) {
                piUserData.phone = currentVerifyPhone;
                piUserData.phone_verified = true;
            }
        } else {
            showToast(data.detail || data.message || '인증 실패', 'error');
        }
    } catch (err) {
        console.error('SMS 인증코드 검증 오류:', err);
        showToast('인증 확인 중 오류가 발생했습니다', 'error');
    }
}

// ========== 페이지 로드 시 초기화 ==========
document.addEventListener('DOMContentLoaded', initMyTab);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initMyTab();
}

// ========== 체결 알림 설정 ==========
function toggleTradeAlert(el) {
    el.classList.toggle('active');
    const key = el.getAttribute('data-key');
    if (key) {
        const isOn = el.classList.contains('active');
        localStorage.setItem(key, isOn ? '1' : '0');
        // ★ 연결된 noti_ 키도 동기화
        _syncTrToNoti(key, isOn);
    }
}

function initTradeAlertToggles() {
    const view = document.getElementById('myView-trAlert');
    if (!view) return;
    view.querySelectorAll('.my-toggle[data-key]').forEach(toggle => {
        const key = toggle.getAttribute('data-key');
        const saved = localStorage.getItem(key);
        if (saved === '0') {
            toggle.classList.remove('active');
        } else if (saved === '1') {
            toggle.classList.add('active');
        }
    });
}

// openMyDetail에서 trAlert 진입 시 초기화
(function() {
    const origOpenDetail = window.openMyDetail;
    if (origOpenDetail) {
        window.openMyDetail = function(detail) {
            origOpenDetail(detail);
            if (detail === 'trAlert') {
                setTimeout(initTradeAlertToggles, 50);
            }
        };
    }
})();

// ========== Live 입출금 ==========
var _liveRefreshTimer = null;
var _liveHistoryAll = [];
var _liveHistoryShown = 3;

async function loadLiveAccountData() {
    console.log("[LIVE] loadLiveAccountData 호출");
    var spinBtn = document.getElementById('liveRefreshBtn');
    if (spinBtn) { spinBtn.classList.add('spinning'); setTimeout(function(){ spinBtn.classList.remove('spinning'); }, 800); }

    try {
        var tkn = localStorage.getItem('access_token');
        var res = await fetch(API_URL + '/mt5/account-info', {
            headers: { 'Authorization': 'Bearer ' + tkn }
        });
        if (!res.ok) { console.error("[LIVE] HTTP 에러:", res.status); return; }
        var d = await res.json();
        console.log("[LIVE] 응답:", JSON.stringify({balance:d.balance, equity:d.equity, profit:d.profit, has_mt5:d.has_mt5}));

        if (!d || !d.has_mt5) {
            document.getElementById('liveConnectedState').style.display = 'none';
            document.getElementById('liveEmptyState').style.display = 'block';
            return;
        }
        document.getElementById('liveConnectedState').style.display = 'block';
        document.getElementById('liveEmptyState').style.display = 'none';

        function fmtUSD(v) { return '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }); }

        var balEl = document.getElementById('myLiveBalance');
        if (balEl) balEl.textContent = fmtUSD(d.balance);

        var eqEl = document.getElementById('myLiveEquity');
        if (eqEl) eqEl.textContent = fmtUSD(d.equity);

        var mEl = document.getElementById('myLiveMargin');
        if (mEl) mEl.textContent = fmtUSD(d.margin || d.total_margin);

        var pEl = document.getElementById('myLiveProfit');
        if (pEl) {
            var profit = Number(d.profit || d.current_pl || 0);
            // ★ 번쩍임 방지: 기존 값이 $0.00이 아닌데 새 값이 0이면 업데이트 건너뛰기
            if (profit === 0 && pEl.textContent !== '$0.00' && pEl.textContent !== '$--.--') {
                console.log('[LIVE] P/L 번쩍임 방지 — 기존값 유지:', pEl.textContent);
            } else if (profit === 0) {
                pEl.textContent = '$0.00';
                pEl.className = 'my-live-stat-value';
            } else {
                pEl.textContent = (profit >= 0 ? '+$' : '-$') + Math.abs(profit).toLocaleString('en-US', { minimumFractionDigits: 2 });
                pEl.className = 'my-live-stat-value ' + (profit > 0 ? 'profit-plus' : 'profit-minus');
            }
        }

        var accEl2 = document.getElementById('myLiveAccountNum2');
        if (accEl2) accEl2.textContent = d.account || '-';
        var sEl = document.getElementById('myLiveServer');
        if (sEl) sEl.textContent = d.server || '-';
        var lvEl = document.getElementById('myLiveLeverage');
        if (lvEl) lvEl.textContent = d.leverage ? '1:' + d.leverage : '-';
        var opEl = document.getElementById('myLivePositions');
        if (opEl) {
            // positions 배열이 있으면 실제 길이 사용, 없으면 positions_count
            var posCount = (d.positions && Array.isArray(d.positions)) ? d.positions.length : Number(d.positions_count || 0);
            opEl.textContent = posCount;
        }

    } catch (e) {
        console.error("[LIVE] loadLiveAccountData 에러:", e);
    }
}

function startLiveRefresh() {
    console.log("[LIVE-DEBUG] startLiveRefresh 호출됨");
    stopLiveRefresh();
    loadLiveAccountData();
    loadLiveDepositHistory();
    _liveRefreshTimer = setInterval(loadLiveAccountData, 5000);  // ★ 30초→3초 (실시간 반영)
}

function stopLiveRefresh() {
    if (_liveRefreshTimer) { clearInterval(_liveRefreshTimer); _liveRefreshTimer = null; }
}

async function loadLiveDepositHistory() {
    var bodyEl = document.getElementById('myLiveHistoryBody');
    var moreEl = document.getElementById('myLiveHistoryMore');
    if (!bodyEl) return;

    try {
        var tkn = localStorage.getItem('access_token');
        var res = await fetch(API_URL + '/demo/deposit-history', {
            headers: { 'Authorization': 'Bearer ' + tkn }
        });
        if (res.ok) {
            var data = await res.json();
            _liveHistoryAll = (data.history || []).map(function(h) {
                var isDeposit = h.type === 'deposit' || h.amount > 0;
                return {
                    type: isDeposit ? 'in' : 'out',
                    label: isDeposit ? '입금' : '출금',
                    method: h.method || h.comment || 'Transfer',
                    date: h.date || '',
                    amount: Math.abs(h.amount || 0) * (isDeposit ? 1 : -1)
                };
            });
        } else {
            _liveHistoryAll = [];
        }
    } catch(e) {
        console.error('Deposit history error:', e);
        _liveHistoryAll = [];
    }
    _liveHistoryShown = 3;
    renderLiveHistory();
}

function renderLiveHistory() {
    var bodyEl = document.getElementById('myLiveHistoryBody');
    var moreEl = document.getElementById('myLiveHistoryMore');
    if (!bodyEl) return;
    if (_liveHistoryAll.length === 0) {
        bodyEl.innerHTML = '<div style="text-align:center;padding:24px 0;"><span class="material-icons-round" style="font-size:32px;color:var(--text-dim);opacity:0.4;display:block;margin-bottom:8px;">receipt_long</span><span style="color:var(--text-dim);font-size:13px;">최근 6개월간 입출금 내역이 없습니다</span></div>';
        if (moreEl) moreEl.style.display = 'none';
        return;
    }
    var items = _liveHistoryAll.slice(0, _liveHistoryShown);
    var html = '';
    for (var i = 0; i < items.length; i++) {
        var h = items[i];
        var isIn = h.type === 'in';
        var amtStr = isIn ? ('+$' + Math.abs(h.amount).toLocaleString('en-US', {minimumFractionDigits:2})) : ('-$' + Math.abs(h.amount).toLocaleString('en-US', {minimumFractionDigits:2}));
        html += '<div class="my-live-history-item"><div class="my-live-history-left"><div class="my-live-history-icon ' + (isIn ? 'in' : 'out') + '"><span class="material-icons-round" style="font-size:16px;color:' + (isIn ? 'var(--buy-color)' : 'var(--sell-color)') + ';">' + (isIn ? 'south_west' : 'north_east') + '</span></div><div><div class="my-live-history-type">' + h.label + '</div><div class="my-live-history-meta">' + h.method + ' \u00B7 ' + h.date + '</div></div></div><span class="my-live-history-amount ' + (isIn ? 'positive' : 'negative') + '">' + amtStr + '</span></div>';
    }
    bodyEl.innerHTML = html;
    if (moreEl) {
        if (_liveHistoryShown < _liveHistoryAll.length) {
            moreEl.style.display = 'flex';
            moreEl.innerHTML = '<span>더보기</span><span class="material-icons-round" style="font-size:16px;">expand_more</span>';
        } else if (_liveHistoryAll.length > 3) {
            moreEl.style.display = 'flex';
            moreEl.innerHTML = '<span>접기</span><span class="material-icons-round" style="font-size:16px;">expand_less</span>';
        } else {
            moreEl.style.display = 'none';
        }
    }
}

function showMoreLiveHistory() {
    if (_liveHistoryShown < _liveHistoryAll.length) {
        _liveHistoryShown = _liveHistoryAll.length;
    } else {
        _liveHistoryShown = 3;
    }
    renderLiveHistory();
}

// ★★★ KYC 메뉴 토글 ★★★
function toggleKycMenu() {
    var menu = document.getElementById('kycSubMenu');
    var arrow = document.getElementById('kycArrow');
    var parent = arrow.closest('.kyc-parent');
    if (menu.style.display === 'none') {
        menu.style.display = 'block';
        arrow.textContent = 'expand_less';
        if (parent) parent.classList.add('open');
    } else {
        menu.style.display = 'none';
        arrow.textContent = 'expand_more';
        if (parent) parent.classList.remove('open');
    }
}

// ========== 트레이딩 리포트 함수들은 tradingReport.js로 이동됨 ==========

// ========== Account 탭 → 라이브 리포트 바로 이동 ==========
function goToTradingReportLive() {
    if (typeof checkMT5Connection !== 'function') {
        _doGoToTradingReportLive();
        return;
    }
    checkMT5Connection().then(function(hasMT5) {
        if (hasMT5) {
            _doGoToTradingReportLive();
        } else {
            if (typeof openMT5ConnectModal === 'function') {
                openMT5ConnectModal();
            } else {
                showToast('MT5 라이브 계좌를 먼저 연결해주세요', 'error');
            }
        }
    });
}

function _doGoToTradingReportLive() {
    var navBottom = document.getElementById('navBottom');
    var tabs = document.querySelectorAll('.tab-content');
    tabs.forEach(function(t) { t.classList.remove('active'); });
    document.getElementById('page-my').classList.add('active');
    if (navBottom) {
        navBottom.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
        var myNav = navBottom.querySelector('.nav-item:nth-child(5)');
        if (myNav) myNav.classList.add('active');
    }
    resetMyTab();
    openMyDetail('tradingReportLive');
}

// ★ Live 리포트 진입 전 MT5 연결 확인 (계정 선택 화면용)
function openLiveReport() {
    if (typeof checkMT5Connection !== 'function') {
        openMyDetail('tradingReportLive');
        return;
    }
    checkMT5Connection().then(function(hasMT5) {
        if (hasMT5) {
            openMyDetail('tradingReportLive');
        } else {
            if (typeof openMT5ConnectModal === 'function') {
                openMT5ConnectModal();
            } else {
                showToast('MT5 라이브 계좌를 먼저 연결해주세요', 'error');
            }
        }
    });
}

// ★ Live 입출금 진입 전 MT5 연결 확인
function openLiveDeposit() {
    if (typeof checkMT5Connection !== 'function') {
        openMyDetail('depositLive');
        return;
    }
    checkMT5Connection().then(function(hasMT5) {
        if (hasMT5) {
            openMyDetail('depositLive');
        } else {
            if (typeof openMT5ConnectModal === 'function') {
                openMT5ConnectModal();
            } else {
                showToast('MT5 라이브 계좌를 먼저 연결해주세요', 'error');
            }
        }
    });
}

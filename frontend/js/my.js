/* ========================================
   Trading-X My Tab
   히어로, 설정, 모드 전환
   ======================================== */

// ========== 초기화 ==========
function initMyTab() {
    const userEmail = localStorage.getItem('user_email') || '';
    const userName = userEmail ? userEmail.split('@')[0] : 'Trader';

    // 프로필
    const avatarEl = document.getElementById('myAvatar');
    const nameEl = document.getElementById('myProfileName');
    const emailEl = document.getElementById('myProfileEmail');
    const nicknameInput = document.getElementById('myNicknameInput');

    if (avatarEl) avatarEl.textContent = userName.charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = userName;
    if (emailEl) emailEl.textContent = userEmail || '-';
    if (nicknameInput) nicknameInput.value = userName;

    // 모드 표시
    updateMyModeDisplay();

    // 이메일 경고 (항상 표시 - 추후 인증 로직 연동)
    const warningEl = document.getElementById('myEmailWarning');
    if (warningEl) warningEl.style.display = 'flex';

    // 거래 통계 (추후 API 연동)
    updateMyTradeStats(0, 0);
    updateMyGrade('Standard', 0, 100);

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

// ========== 등급 ==========
function updateMyGrade(grade, current, next) {
    const gradeEl = document.getElementById('myGradeText');
    const fillEl = document.getElementById('myProgressFill');
    const textEl = document.getElementById('myProgressText');

    const grades = ['Standard', 'Silver', 'Gold', 'Platinum'];
    const nextGrade = grades[grades.indexOf(grade) + 1] || 'Max';
    const remaining = Math.max(next - current, 0);
    const progress = next > 0 ? Math.min((current / next) * 100, 100) : 0;

    if (gradeEl) gradeEl.textContent = grade;
    if (fillEl) fillEl.style.width = progress + '%';
    if (textEl) textEl.textContent = remaining > 0 ? (nextGrade + ' · ' + remaining + '회 남음') : '달성!';
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
        // 닉네임 저장
        const nameEl = document.getElementById('myProfileName');
        if (nameEl) nameEl.textContent = input.value;
        localStorage.setItem('user_nickname', input.value);
    }
}

function toggleMyNoti(el) {
    el.classList.toggle('active');
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

    if (demo) {
        // Demo → Live 전환
        if (typeof switchToLive === 'function') {
            switchToLive();
        } else {
            isDemo = false;
        }
    } else {
        // Live → Demo 전환
        if (typeof switchToDemo === 'function') {
            switchToDemo();
        } else {
            isDemo = true;
        }
    }

    updateMyModeDisplay();
    closeModeSwitch();

    if (typeof showToast === 'function') {
        showToast(isDemo ? '📚 Demo 모드로 전환되었습니다' : '🚀 Live 모드로 전환되었습니다', 'success');
    }
}

// ========== 로그아웃 확인 ==========
function confirmLogout() {
    if (confirm('정말 로그아웃 하시겠습니까?')) {
        if (typeof logout === 'function') {
            logout();
        }
    }
}

// ========== 서브페이지 (추후 구현) ==========
function openMySubPage(page) {
    if (typeof showToast === 'function') {
        showToast('📌 ' + page + ' 페이지는 준비 중입니다', '');
    }
    console.log('[MyTab] Open sub page:', page);
}

// ========== 페이지 로드 시 초기화 ==========
document.addEventListener('DOMContentLoaded', initMyTab);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initMyTab();
}

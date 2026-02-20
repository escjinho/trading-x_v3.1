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
        mt5: 'MT5 계정 관리',
        loginHistory: '로그인 기록',
        depositDemo: 'Demo 입출금',
        depositLive: 'Live 입출금',
        tradingReport: '트레이딩 리포트',
        tradeAlert: '체결 알림 설정',
        invite: '친구 초대',
        vip: 'VIP 프로그램',
        notification: '알림 설정',
        language: '언어 설정',
        theme: '테마',
        support: '고객센터',
        terms: '약관 및 정책',
        appInfo: '앱 정보'
    };

    // 전용 뷰가 있는지 확인 (추후 단계에서 추가됨)
    const dedicatedView = document.getElementById('myView-' + detail);
    if (dedicatedView) {
        // 전용 뷰로 이동
        const currentId = myPageStack[myPageStack.length - 1];
        const currentEl = document.getElementById('myView-' + currentId);
        if (currentEl) currentEl.classList.remove('active', 'slide-back');

        dedicatedView.classList.remove('slide-back');
        dedicatedView.classList.add('active');
        myPageStack.push(detail);
        document.getElementById('page-my').scrollTop = 0;
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

// ========== 페이지 로드 시 초기화 ==========
document.addEventListener('DOMContentLoaded', initMyTab);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initMyTab();
}

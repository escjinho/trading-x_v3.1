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

    // 전용 뷰가 있는지 확인
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

        // 상세 페이지 초기화
        if (typeof initDetailView === 'function') initDetailView(detail);

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

function changePassword() {
    const current = document.getElementById('myCurrentPw').value;
    const newPw = document.getElementById('myNewPw').value;
    const confirm = document.getElementById('myConfirmPw').value;

    if (!current || !newPw || !confirm) {
        if (typeof showToast === 'function') showToast('모든 필드를 입력해주세요', 'error');
        return;
    }

    if (newPw.length < 8) {
        if (typeof showToast === 'function') showToast('비밀번호는 8자 이상이어야 합니다', 'error');
        return;
    }

    if (newPw !== confirm) {
        if (typeof showToast === 'function') showToast('새 비밀번호가 일치하지 않습니다', 'error');
        return;
    }

    // TODO: API 연동
    if (typeof showToast === 'function') showToast('비밀번호가 변경되었습니다', 'success');

    // 입력 필드 초기화
    document.getElementById('myCurrentPw').value = '';
    document.getElementById('myNewPw').value = '';
    document.getElementById('myConfirmPw').value = '';

    myGoBack();
}

// ========== 이메일 인증 ==========
let emailTimerInterval = null;
let emailTimerSeconds = 180;

function initEmailView() {
    const email = localStorage.getItem('user_email') || 'user@example.com';
    const emailEl = document.getElementById('myEmailAddr');
    if (emailEl) emailEl.textContent = email;
}

function sendEmailCode() {
    // 코드 입력 섹션 표시
    document.getElementById('myEmailCodeSection').style.display = 'block';
    document.getElementById('myEmailSendBtn').style.display = 'none';
    document.getElementById('myEmailVerifyBtn').style.display = 'flex';

    // 타이머 시작
    emailTimerSeconds = 180;
    updateEmailTimer();
    emailTimerInterval = setInterval(() => {
        emailTimerSeconds--;
        updateEmailTimer();
        if (emailTimerSeconds <= 0) {
            clearInterval(emailTimerInterval);
            if (typeof showToast === 'function') showToast('인증 시간이 만료되었습니다', 'error');
            resetEmailView();
        }
    }, 1000);

    // 첫 번째 입력칸에 포커스
    const firstInput = document.querySelector('.my-email-code-input[data-idx="0"]');
    if (firstInput) firstInput.focus();

    if (typeof showToast === 'function') showToast('인증 메일이 발송되었습니다', 'success');
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

function verifyEmailCode() {
    const inputs = document.querySelectorAll('.my-email-code-input');
    let code = '';
    inputs.forEach(input => code += input.value);

    if (code.length !== 6) {
        if (typeof showToast === 'function') showToast('6자리 코드를 입력해주세요', 'error');
        return;
    }

    // TODO: API 연동
    clearInterval(emailTimerInterval);

    // 인증 완료 상태 업데이트
    const stateEl = document.getElementById('myEmailState');
    const iconEl = document.getElementById('myEmailStatusIcon');
    if (stateEl) {
        stateEl.textContent = '인증됨';
        stateEl.className = 'my-email-state verified';
    }
    if (iconEl) iconEl.textContent = 'mark_email_read';

    if (typeof showToast === 'function') showToast('이메일 인증이 완료되었습니다', 'success');

    setTimeout(() => myGoBack(), 1000);
}

function resetEmailView() {
    document.getElementById('myEmailCodeSection').style.display = 'none';
    document.getElementById('myEmailSendBtn').style.display = 'flex';
    document.getElementById('myEmailVerifyBtn').style.display = 'none';
    document.querySelectorAll('.my-email-code-input').forEach(input => input.value = '');
}

// ========== MT5 계정 관리 ==========
function initMt5View() {
    const demo = typeof isDemo !== 'undefined' ? isDemo : true;

    // 상태 배지
    const statusBadge = document.getElementById('myMt5StatusBadge');
    const modeBadge = document.getElementById('myMt5ModeBadge');

    if (modeBadge) {
        modeBadge.textContent = demo ? 'Demo' : 'Live';
        modeBadge.className = 'my-mt5-mode' + (demo ? '' : ' live');
    }

    // 스위치 버튼 상태
    const demoSwitch = document.getElementById('myMt5DemoSwitch');
    const liveSwitch = document.getElementById('myMt5LiveSwitch');
    if (demoSwitch && liveSwitch) {
        demoSwitch.classList.toggle('active', demo);
        liveSwitch.classList.toggle('active', !demo);
    }

    // 계정 정보 (TODO: API 연동)
    const loginEl = document.getElementById('myMt5Login');
    const serverEl = document.getElementById('myMt5Server');
    const balanceEl = document.getElementById('myMt5Balance');
    const leverageEl = document.getElementById('myMt5Leverage');

    if (loginEl) loginEl.textContent = demo ? '5001234' : '-';
    if (serverEl) serverEl.textContent = demo ? 'TradingX-Demo' : 'TradingX-Live';
    if (balanceEl) balanceEl.textContent = demo ? '$10,000.00' : '-';
    if (leverageEl) leverageEl.textContent = '1:100';
}

function switchMt5Account(mode) {
    if (mode === 'demo') {
        if (typeof switchToDemo === 'function') switchToDemo();
        else if (typeof isDemo !== 'undefined') isDemo = true;
    } else {
        if (typeof switchToLive === 'function') switchToLive();
        else if (typeof isDemo !== 'undefined') isDemo = false;
    }

    initMt5View();
    updateMyModeDisplay();

    if (typeof showToast === 'function') {
        showToast(mode === 'demo' ? '📚 Demo 모드로 전환' : '🚀 Live 모드로 전환', 'success');
    }
}

function refreshMt5Connection() {
    if (typeof showToast === 'function') showToast('연결을 새로고침합니다...', 'info');

    // TODO: 실제 연결 새로고침 로직
    setTimeout(() => {
        initMt5View();
        if (typeof showToast === 'function') showToast('연결이 갱신되었습니다', 'success');
    }, 1000);
}

// ========== 로그인 기록 ==========
function logoutAllDevices() {
    if (confirm('모든 기기에서 로그아웃 하시겠습니까?\n현재 기기도 로그아웃됩니다.')) {
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

function selectDemoAmount(amount) {
    selectedDemoAmount = amount;
    document.querySelectorAll('.my-deposit-amount-btn').forEach(btn => {
        const btnAmount = parseInt(btn.textContent.replace(/[$,]/g, ''));
        btn.classList.toggle('selected', btnAmount === amount);
    });
}

function handleDemoDeposit() {
    const balEl = document.getElementById('myDemoBalance');
    if (!balEl) return;

    const current = parseFloat(balEl.textContent.replace(/[$,]/g, '')) || 0;
    const newBal = Math.min(current + selectedDemoAmount, 100000);
    balEl.textContent = '$' + newBal.toLocaleString('en-US', { minimumFractionDigits: 2 });

    if (typeof showToast === 'function') {
        showToast('✅ $' + selectedDemoAmount.toLocaleString() + ' 충전 완료!', 'success');
    }
}

function handleDemoReset() {
    const balEl = document.getElementById('myDemoBalance');
    if (balEl) {
        balEl.textContent = '$10,000.00';
    }
    if (typeof showToast === 'function') {
        showToast('🔄 데모 잔고가 $10,000으로 리셋되었습니다', 'info');
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
        case 'depositDemo':
            // 금액 선택 초기화
            selectedDemoAmount = 10000;
            document.querySelectorAll('.my-deposit-amount-btn').forEach(btn => {
                const btnAmount = parseInt(btn.textContent.replace(/[$,]/g, ''));
                btn.classList.toggle('selected', btnAmount === 10000);
            });
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

// ========== 페이지 로드 시 초기화 ==========
document.addEventListener('DOMContentLoaded', initMyTab);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initMyTab();
}

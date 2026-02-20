/* ========================================
   Trading-X My Tab
   히어로, 설정, 모드 전환
   ======================================== */
console.log('[MyTab] my.js loaded successfully');

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
    console.log('[MyTab] openMySubPage called with:', page);
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
        trAlert: '체결 알림 설정',
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
let emailTimerSeconds = 300; // 5분

// ========== API 헬퍼 ==========
function getApiUrl() {
    const loc = window.location;
    if (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') {
        return 'http://localhost:8000/api';
    }
    return loc.protocol + '//' + loc.host + '/api';
}

function getCurrentUserEmail() {
    return localStorage.getItem('user_email') || '';
}

function initEmailView() {
    const email = localStorage.getItem('user_email') || 'user@example.com';
    const emailEl = document.getElementById('myEmailAddr');
    if (emailEl) emailEl.textContent = email;
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
        const API_URL = getApiUrl();
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
        const API_URL = getApiUrl();
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
    3: { type: '이벤트', date: '02.15', title: '신규 가입 이벤트 - 최대 $100 보너스', body: '안녕하세요, Trading-X입니다.\n\n신규 가입 이벤트를 진행합니다!\n\n• 기간: 2026.02.15 ~ 03.15\n• 혜택: 가입 시 $10, 첫 입금 시 $50, 첫 거래 시 $40\n• 조건: 본인 인증 완료 필수\n\n많은 참여 부탁드립니다!' },
    4: { type: '공지', date: '02.10', title: '개인정보 처리방침 변경 안내', body: '안녕하세요, Trading-X입니다.\n\n개인정보 처리방침이 일부 변경되었습니다.\n\n• 시행일: 2026년 2월 15일\n• 변경 내용: 마케팅 정보 수신 동의 항목 추가\n\n자세한 내용은 약관 및 정책 > 개인정보 처리방침에서 확인하실 수 있습니다.' },
    5: { type: '공지', date: '02.01', title: 'HedgeHood 브로커 연동 시작', body: '안녕하세요, Trading-X입니다.\n\nHedgeHood Pty Ltd 브로커와의 공식 연동이 시작되었습니다.\n\n• ASIC 규제 브로커\n• 최대 1:500 레버리지\n• 빠른 입출금 지원\n\nMy > 내 계정 > MT5 계정 관리에서 계정을 연결하세요.' }
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
const termsData = {
    service: { title: '서비스 이용약관', body: '제1조 (목적)\n이 약관은 GOODFRIENDS CO., LTD가 제공하는 Trading-X 서비스의 이용에 관한 사항을 규정합니다.\n\n제2조 (정의)\n① "서비스"란 MT5 연동 트레이딩 플랫폼 Trading-X를 말합니다.\n② "이용자"란 이 약관에 따라 서비스를 이용하는 자를 말합니다.\n③ "계정"이란 이메일과 비밀번호 조합을 말합니다.\n\n제3조 (약관의 효력)\n① 서비스 화면에 게시함으로써 효력을 발생합니다.\n② 관련 법령 범위에서 개정할 수 있습니다.\n\n제4조 (서비스의 제공)\n① MT5 연동, 데모 거래, 분석 및 리포트 서비스를 제공합니다.\n② 연중무휴 24시간 제공을 원칙으로 합니다.\n\n제5조 (이용자의 의무)\n① 타인 정보 도용 및 허위 등록 금지\n② 불법 활동 금지\n③ 계정 정보 관리 책임\n\n제6조 (면책사항)\n① 거래 손실에 대해 책임을 지지 않습니다.\n② 원금 손실 위험이 있습니다.\n③ 브로커 시스템 장애로 인한 손해에 대해 책임을 지지 않습니다.' },
    privacy: { title: '개인정보 처리방침', body: '1. 개인정보의 수집 및 이용 목적\n회사는 다음의 목적을 위해 개인정보를 처리합니다.\n• 회원 가입 및 관리\n• 서비스 제공 및 운영\n• 마케팅 및 광고 활용\n\n2. 수집하는 개인정보 항목\n• 필수: 이메일, 비밀번호\n• 선택: 닉네임, 전화번호\n\n3. 개인정보의 보유 및 이용기간\n회원 탈퇴 시까지 또는 법령에서 정한 기간까지 보유합니다.\n\n4. 개인정보의 파기\n보유 기간이 만료된 개인정보는 지체 없이 파기합니다.\n\n5. 개인정보 보호책임자\n이메일: privacy@trading-x.ai' },
    risk: { title: '투자 위험 고지', body: '⚠️ 투자 위험 고지\n\n파생상품(CFD) 거래는 높은 수준의 위험을 수반합니다.\n\n• 레버리지 거래로 인해 원금 이상의 손실이 발생할 수 있습니다.\n• 시장 변동성으로 인해 예상치 못한 손실이 발생할 수 있습니다.\n• 과거 수익률이 미래 수익을 보장하지 않습니다.\n\n본 서비스는 투자 조언을 제공하지 않습니다. 모든 투자 결정은 본인의 책임 하에 이루어집니다.\n\n거래를 시작하기 전 충분한 학습과 이해가 필요합니다. 감당할 수 있는 금액만 투자하시기 바랍니다.' },
    aml: { title: '자금세탁방지 정책 (AML)', body: 'GOODFRIENDS CO., LTD는 자금세탁방지 및 테러자금조달방지를 위해 아래 정책을 시행합니다.\n\n1. 목적\n본 정책은 Trading-X 서비스를 통한 자금세탁, 테러자금조달 및 기타 불법 금융활동을 예방하기 위함입니다.\n\n2. 고객확인(KYC)\n① 회원가입 시 이메일 인증을 실시합니다.\n② 라이브 계정 이용 시 본인 확인 절차를 진행합니다.\n③ 필요 시 추가 신원확인 서류를 요청할 수 있습니다.\n\n3. 의심거래 모니터링\n① 비정상적 입출금 패턴을 상시 모니터링합니다.\n② 의심 거래 발견 시 계정을 일시 정지할 수 있습니다.\n③ 관련 법령에 따라 당국에 보고할 수 있습니다.\n\n4. 기록 보관\n① 거래 기록을 관련 법령에서 정한 기간 동안 보관합니다.\n② 고객확인 서류는 관계 종료 후 5년간 보관합니다.\n\n5. 금지 행위\n① 타인 명의 계정 사용\n② 불법 자금 유입 시도\n③ 허위 정보 제공\n④ 다중 계정을 통한 자금 이동\n\n6. 위반 시 조치\n① 계정 정지 및 해지\n② 관련 당국 보고\n③ 법적 조치\n\n7. 문의\nAML 관련 문의: compliance@trading-x.ai' },
    marketing: { title: '마케팅 정보 수신 동의', body: '마케팅 정보 수신 동의\n\n수신 동의 시 다음의 정보를 받으실 수 있습니다.\n\n• 이벤트 및 프로모션 안내\n• 신규 기능 업데이트 소식\n• 투자 관련 뉴스레터\n• 맞춤형 서비스 제안\n\n수신 방법: 앱 푸시, 이메일, SMS\n\n동의 철회는 My > 일반 > 알림 설정에서 언제든지 가능합니다.\n\n※ 필수 공지사항(서버 점검, 약관 변경 등)은 동의 여부와 관계없이 발송됩니다.' }
};

function openTermsDetail(type) {
    const data = termsData[type];
    if (!data) return;

    document.getElementById('myTermsDetailTitle').textContent = data.title;
    document.getElementById('myTermsDetailBody').textContent = data.body;

    openMyDetail('termsDetail');
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

// initDetailView 확장
const _originalInitDetailView = typeof initDetailView === 'function' ? initDetailView : null;
function initDetailView(detail) {
    if (_originalInitDetailView) _originalInitDetailView(detail);

    if (detail === 'openSource') {
        setTimeout(renderOpenSource, 50);
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
        localStorage.setItem(key, el.classList.contains('active') ? '1' : '0');
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

/* ========================================
   Trading-X Authentication
   로그인, 로그아웃, 게스트 모드, 세션 관리
   ======================================== */

// ========== Auth Variables ==========
let token = localStorage.getItem('access_token');  // const → let 변경
const refreshToken = localStorage.getItem('refresh_token');

// URL 파라미터에서 게스트 모드 체크
const urlParams = new URLSearchParams(window.location.search);
const isGuestParam = urlParams.get('guest') === 'true';

// 게스트 파라미터가 있으면 세션에 저장
if (isGuestParam) {
    sessionStorage.setItem('guest_mode', 'true');
}

// 세션 또는 URL에서 게스트 모드 확인
const isGuest = isGuestParam || sessionStorage.getItem('guest_mode') === 'true';
window.isGuest = isGuest;

let isDemo = true;

// ========== Session Config ==========
const SESSION_TIMEOUT = 60 * 60 * 1000;  // 1시간 (밀리초)
const TOKEN_REFRESH_INTERVAL = 50 * 60 * 1000;  // 50분마다 갱신 시도
let lastActivityTime = parseInt(localStorage.getItem('last_activity')) || Date.now();
let tokenRefreshTimer = null;

// ========== Auth Check ==========
if (!token && !isGuest) {
    window.location.href = 'login.html';
}

// ========== Activity Tracking ==========
function updateLastActivity() {
    lastActivityTime = Date.now();
    localStorage.setItem('last_activity', lastActivityTime.toString());
}

// 활동 감지 이벤트 등록
function initActivityTracking() {
    const activityEvents = ['click', 'touchstart', 'keydown', 'scroll', 'mousemove'];
    
    // 디바운스 처리 (너무 자주 호출 방지)
    let activityTimeout = null;
    const handleActivity = () => {
        if (activityTimeout) return;
        activityTimeout = setTimeout(() => {
            updateLastActivity();
            activityTimeout = null;
        }, 1000);  // 1초에 한 번만 업데이트
    };
    
    activityEvents.forEach(event => {
        document.addEventListener(event, handleActivity, { passive: true });
    });
    
    console.log('✅ Activity tracking initialized');
}

// ========== Token Refresh ==========
async function refreshAccessToken() {
    const currentRefreshToken = localStorage.getItem('refresh_token');
    
    if (!currentRefreshToken) {
        console.log('⚠️ No refresh token available');
        return false;
    }
    
    try {
        const response = await fetch(`${API_URL}/auth/refresh?refresh_token=${encodeURIComponent(currentRefreshToken)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // 새 토큰 저장
            localStorage.setItem('access_token', data.access_token);
            token = data.access_token;
            
            if (data.refresh_token) {
                localStorage.setItem('refresh_token', data.refresh_token);
            }
            
            updateLastActivity();
            console.log('✅ Token refreshed successfully');
            return true;
        } else {
            console.log('❌ Token refresh failed:', response.status);
            return false;
        }
    } catch (error) {
        console.error('❌ Token refresh error:', error);
        return false;
    }
}

// 자동 토큰 갱신 타이머
function startTokenRefreshTimer() {
    if (tokenRefreshTimer) {
        clearInterval(tokenRefreshTimer);
    }
    
    tokenRefreshTimer = setInterval(async () => {
        // 마지막 활동 후 50분이 지났으면 토큰 갱신
        const timeSinceActivity = Date.now() - lastActivityTime;
        
        if (timeSinceActivity < SESSION_TIMEOUT && token) {
            await refreshAccessToken();
        }
    }, TOKEN_REFRESH_INTERVAL);
    
    console.log('✅ Token refresh timer started');
}

// ========== Session Expired Handler ==========
function handleSessionExpired(message = '세션이 만료되었습니다') {
    // 토큰 정리
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('last_activity');
    token = null;
    
    // 타이머 정리
    if (tokenRefreshTimer) {
        clearInterval(tokenRefreshTimer);
        tokenRefreshTimer = null;
    }
    
    // 세션 만료 팝업 표시
    showSessionExpiredPopup(message);
}

function showSessionExpiredPopup(message) {
    // 기존 팝업 제거
    const existingPopup = document.getElementById('sessionExpiredPopup');
    if (existingPopup) {
        existingPopup.remove();
    }
    
    const popup = document.createElement('div');
    popup.id = 'sessionExpiredPopup';
    popup.innerHTML = `
        <div style="
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 99999;
        ">
            <div style="
                background: #25282f;
                border: 1px solid #3f4451;
                border-radius: 16px;
                padding: 30px;
                max-width: 350px;
                width: 90%;
                text-align: center;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            ">
                <div style="
                    width: 60px;
                    height: 60px;
                    background: rgba(0, 212, 255, 0.1);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 20px;
                ">
                    <span class="material-icons-round" style="font-size: 30px; color: #00d4ff;">lock_clock</span>
                </div>
                <h3 style="color: #fff; font-size: 18px; margin-bottom: 10px;">세션 만료</h3>
                <p style="color: #9ca3af; font-size: 14px; margin-bottom: 25px; line-height: 1.5;">
                    ${message}<br>다시 로그인해 주세요.
                </p>
                <button onclick="goToLogin()" style="
                    width: 100%;
                    padding: 14px;
                    background: linear-gradient(135deg, #00d4ff, #0099cc);
                    border: none;
                    border-radius: 10px;
                    color: #0a0c10;
                    font-size: 15px;
                    font-weight: 700;
                    cursor: pointer;
                ">로그인 페이지로 이동</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(popup);
}

function goToLogin() {
    window.location.href = 'login.html';
}

// ========== Logout ==========
function logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_email');
    localStorage.removeItem('last_activity');
    
    if (tokenRefreshTimer) {
        clearInterval(tokenRefreshTimer);
    }
    
    window.location.href = 'login.html';
}

// ========== Guest Mode Functions ==========
function showGuestPopup() {
    document.getElementById('guestPopup').classList.add('show');
}

function closeGuestPopup() {
    document.getElementById('guestPopup').classList.remove('show');
}

function goToRegister() {
    sessionStorage.removeItem('guest_mode');
    window.location.href = 'login.html?mode=register';
}

function goToLoginPage() {
    sessionStorage.removeItem('guest_mode');
    window.location.href = 'login.html';
}

function checkGuestAction(action) {
    if (isGuest) {
        showGuestPopup();
        return false;
    }
    return true;
}

// ========== Initialize ==========
if (token && !isGuest) {
    initActivityTracking();
    startTokenRefreshTimer();
    updateLastActivity();
}

/* ========================================
   Trading-X Authentication
   로그인, 로그아웃, 게스트 모드
   ======================================== */

// ========== Auth Variables ==========
const token = localStorage.getItem('access_token');
const isGuest = sessionStorage.getItem('guest_mode') === 'true';
let isDemo = true;

// Auth Check
if (!token && !isGuest) {
    window.location.href = 'login.html';
}

// ========== Logout ==========
function logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_email');
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

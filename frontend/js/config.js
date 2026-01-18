// ========== Configuration ==========
const API_URL = 'http://localhost:8000/api';

// ========== Auth Check ==========
const token = localStorage.getItem('access_token');
const isGuest = sessionStorage.getItem('guest_mode') === 'true';
let isDemo = false;  // Demo 모드 여부 (로그인 후 확인)

if (!token && !isGuest) {
    window.location.href = 'login.html';
}

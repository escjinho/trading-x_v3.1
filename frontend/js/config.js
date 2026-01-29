// ========== Configuration ==========

// 동적 API URL 생성 (로컬/사설IP/서버 환경 호환)
const getApiUrl = () => {
    const hostname = window.location.hostname;

    // 로컬 개발 환경 (localhost, 127.0.0.1, 사설 IP)
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
        return `http://${hostname}:8000/api`;
    }

    // 실제 서버 환경 (기존 설정 유지)
    return 'http://localhost:8000/api';
};

// 동적 WebSocket URL 생성
const getWsUrl = (path) => {
    const hostname = window.location.hostname;

    // 로컬 개발 환경 (localhost, 127.0.0.1, 사설 IP)
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
        return `ws://${hostname}:8000${path}`;
    }

    // 실제 서버 환경 (기존 설정 유지)
    return `ws://localhost:8000${path}`;
};

const API_URL = getApiUrl();

// 인증 관련은 auth.js에서 관리
// ========== API Helper ==========
async function apiCall(endpoint, method = 'GET', body = null) {
    const headers = {
        'Content-Type': 'application/json'
    };
    
    // 토큰이 있으면 추가
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    
    try {
        const response = await fetch(`${API_URL}${endpoint}`, options);
        if (response.status === 401) {
            // 토큰 만료 → 로그인 필요 메시지 표시
            localStorage.removeItem('access_token');
            token = null;
            
            showToast('🔒 로그인이 필요합니다', '세션이 만료되었습니다');
            
            // 2초 후 로그인 페이지로 이동
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 2000);
            
            return { success: false, error: 'session_expired', message: '로그인이 필요합니다' };
        }
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        showToast('⚠️ 네트워크 오류', '서버 연결에 실패했습니다');
        return { success: false, error: 'network_error', message: '네트워크 오류' };
    }
}

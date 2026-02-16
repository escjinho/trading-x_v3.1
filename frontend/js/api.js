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
            // 토큰 만료 → 먼저 갱신 시도
            console.log('⚠️ 401 Unauthorized - Attempting token refresh...');
            
            const refreshSuccess = await refreshAccessToken();
            
            if (refreshSuccess) {
                // 토큰 갱신 성공 → 원래 요청 재시도
                headers['Authorization'] = `Bearer ${token}`;
                const retryResponse = await fetch(`${API_URL}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : null });
                
                if (retryResponse.ok) {
                    // 활동 시간 업데이트
                    if (typeof updateLastActivity === 'function') {
                        updateLastActivity();
                    }
                    return await retryResponse.json();
                }
            }
            
            // 토큰 갱신 실패 → 세션 만료 처리
            if (typeof handleSessionExpired === 'function') {
                handleSessionExpired('로그인 세션이 만료되었습니다');
            } else {
                // fallback
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
                token = null;
                showToast('🔒 세션 만료', '다시 로그인해 주세요');
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 2000);
            }
            
            return { success: false, error: 'session_expired', message: '세션이 만료되었습니다' };
        }
        
        // 정상 응답 → 활동 시간 업데이트
        if (typeof updateLastActivity === 'function') {
            updateLastActivity();
        }
        
        return await response.json();
        
    } catch (error) {
        console.error('API Error:', error);
        
        // 네트워크 오류와 세션 만료 구분
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            showToast('네트워크 연결 확인 중', 'warning');
        } else {
            showToast('잠시 연결이 불안정합니다\n곧 자동으로 복구됩니다', 'warning');
        }
        
        return { success: false, error: 'network_error', message: '서버 연결 실패' };
    }
}
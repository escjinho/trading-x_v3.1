// ========== Magic → Mode Label 변환 ==========
function getModeLabel(magic) {
    if (magic == 100001) return 'Pro';
    if (magic == 100003) return 'Easy';
    if (magic == 100002) return 'Chart';
    return 'V5';
}

// ========== Toast (스마트 알림 시스템) ==========

// 메시지 키워드 → 알림 타입 매핑
function _detectNotiType(message) {
    if (!message || typeof message !== 'string') return null;
    var m = message.toLowerCase();

    // ★★★ 버그 수정 4: 에러/실패 메시지는 항상 표시 ★★★
    if (m.indexOf('실패') !== -1 || m.indexOf('error') !== -1 || m.indexOf('오류') !== -1 ||
        m.indexOf('확인할 수 없') !== -1 || m.indexOf('필요합니다') !== -1 ||
        m.indexOf('timeout') !== -1 || m.indexOf('불안정') !== -1) {
        return null; // 항상 표시
    }

    // ★★★ 버그 수정 3: 진행 중 메시지는 항상 표시 ★★★
    if (m.indexOf('processing') !== -1 || m.indexOf('closing...') !== -1 ||
        m.indexOf('전송 중') !== -1 || m.indexOf('연결 중') !== -1 ||
        m.indexOf('계산 중') !== -1 || m.indexOf('확인중') !== -1) {
        return null; // 항상 표시
    }

    // ★★★ 버그 수정 1: liquidation을 close보다 먼저 체크 ★★★

    // 자동청산/로스컷 (liquidation) — close보다 먼저!
    if (m.indexOf('로스컷') !== -1 || m.indexOf('강제 청산') !== -1 || m.indexOf('강제청산') !== -1 ||
        m.indexOf('liquidat') !== -1) {
        return 'noti_liquidation';
    }

    // 마진콜 (margin) — close보다 먼저!
    if (m.indexOf('마진') !== -1 && (m.indexOf('경고') !== -1 || m.indexOf('부족') !== -1 || m.indexOf('위험') !== -1)) {
        return 'noti_margin';
    }

    // 주문 체결 (order)
    if (m.indexOf('체결') !== -1 || m.indexOf('buy 실행') !== -1 || m.indexOf('sell 실행') !== -1 ||
        m.indexOf('주문 성공') !== -1 || m.indexOf('quick buy') !== -1 || m.indexOf('quick sell') !== -1) {
        return 'noti_order';
    }

    // 포지션 청산 (close)
    if (m.indexOf('청산') !== -1 || m.indexOf('closed') !== -1) {
        return 'noti_close';
    }

    // 입출금 (deposit)
    if (m.indexOf('충전') !== -1 || m.indexOf('리셋') !== -1 || m.indexOf('입금') !== -1 ||
        m.indexOf('출금') !== -1 || m.indexOf('인출') !== -1) {
        return 'noti_deposit';
    }

    // 공지사항 (notice)
    if (m.indexOf('점검') !== -1 || m.indexOf('공지') !== -1) {
        return 'noti_notice';
    }

    // 이벤트/프로모션 (event)
    if (m.indexOf('이벤트') !== -1 || m.indexOf('프로모션') !== -1) {
        return 'noti_event';
    }

    // 매칭 안 되면 null (항상 표시)
    return null;
}

// 알림 설정 체크 (OFF면 false 반환)
function _isNotiEnabled(notiKey) {
    if (!notiKey) return true; // 매칭 안 되면 항상 표시
    var stored = localStorage.getItem(notiKey);
    if (stored === null) {
        // ★★★ 버그 수정 5: 이벤트는 기본 OFF, 나머지는 기본 ON ★★★
        if (notiKey === 'noti_event') return false;
        return true;
    }
    return stored === 'true';
}

function showToast(message, type, duration) {
    var toast = document.getElementById('toast');
    if (!toast) return;

    // ★★★ 스마트 알림: 메시지 키워드로 타입 감지 → 설정 체크 ★★★
    var notiType = _detectNotiType(message);
    if (notiType && !_isNotiEnabled(notiType)) {
        // 설정이 OFF면 토스트 표시하지 않음
        return;
    }

    // 타입 정규화
    var t = type === '' || !type ? 'info' : type;
    var dur = duration || (t === 'error' ? 4000 : 3000);

    // 멀티라인 지원: \n → 두 줄 (title + message)
    var parts = message.split('\n');
    var contentHtml = '';
    if (parts.length > 1) {
        contentHtml = '<div class="toast-content"><div class="toast-title">' + parts[0] + '</div><div class="toast-message">' + parts.slice(1).join('<br>') + '</div></div>';
    } else {
        contentHtml = '<div class="toast-content"><div class="toast-title">' + message + '</div></div>';
    }

    toast.className = 'toast ' + t;
    toast.innerHTML = contentHtml;

    // 애니메이션: 약간의 딜레이 후 show 추가
    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            toast.classList.add('show');
        });
    });

    // 이전 타이머 취소
    if (window._toastTimer) clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(function() {
        toast.classList.remove('show');
    }, dur);
}

// ========== Logout ==========
function logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_email');
    window.location.href = 'login.html';
}

// ========== 게스트 모드 함수 ==========
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

// updateGreeting()은 init.js에서 정의 (시간대별 5개 랜덤 인사말 버전 사용)

// ========== 프로모션 슬라이더 ==========
function scrollToPromo(index) {
    const slider = document.getElementById('promoSlider');
    const cards = slider.querySelectorAll('.promo-card');
    if (cards[index]) {
        cards[index].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        updatePromoDots(index);
    }
}

function updatePromoDots(activeIndex) {
    const dots = document.querySelectorAll('.promo-dot');
    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === activeIndex);
    });
}

// ========== 공지 배너 ==========
function showNoticeBanner(message) {
    const banner = document.getElementById('noticeBanner');
    const text = document.getElementById('noticeText');
    text.textContent = message;
    banner.style.display = 'flex';
}

function closeNoticeBanner() {
    const banner = document.getElementById('noticeBanner');
    banner.style.animation = 'slideUp 0.3s ease';
    setTimeout(() => {
        banner.style.display = 'none';
        banner.style.animation = 'slideDown 0.3s ease';
    }, 300);
    // 24시간 동안 다시 안 보이게 (선택사항)
    localStorage.setItem('noticeClosed', Date.now());
}

// ========== 종목 정보 ==========
function getDecimalsForSymbol(symbol) {
    if (symbol === 'BTCUSD' || symbol === 'ETHUSD') return 2;
    if (symbol === 'XAUUSD.r') return 2;
    if (symbol === 'US100.') return 2;
    if (symbol.includes('JPY')) return 3;
    if (symbol === 'EURUSD.r' || symbol === 'GBPUSD.r' || symbol === 'AUDUSD.r' || symbol === 'USDCAD.r') return 5;
    return 2;
}

function getSymbolInfo(symbol) {
    const defaultInfo = { name: symbol, icon: '📈', color: '#00d4ff', category: 'Currency' };

    const symbolMap = {
        'BTCUSD': { name: 'Bitcoin', icon: '₿', color: '#f7931a', category: 'Crypto Currency' },
        'ETHUSD': { name: 'Ethereum', icon: 'Ξ', color: '#627eea', category: 'Crypto Currency' },
        'EURUSD.r': { name: 'Euro/Dollar', icon: '€', color: '#0052cc', category: 'Forex' },
        'USDJPY.r': { name: 'Dollar/Yen', icon: '¥', color: '#dc143c', category: 'Forex' },
        'GBPUSD.r': { name: 'Pound/Dollar', icon: '£', color: '#9c27b0', category: 'Forex' },
        'XAUUSD.r': { name: 'Gold', icon: '✦', color: '#ffd700', category: 'Metals' },
        'US100.': { name: 'NASDAQ', icon: '⬡', color: '#00b450', category: 'Indices' }
    };

    return symbolMap[symbol] || defaultInfo;
}

// ========== 사운드 재생 (스마트 알림 연동) ==========
function playSound(type) {
    // ★★★ 체결 사운드 설정 체크 ★★★
    if (!_isNotiEnabled('noti_sound')) return;

    try {
        if (!window._audioContext) {
            window._audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        var audioContext = window._audioContext;

        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        var oscillator = audioContext.createOscillator();
        var gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        if (type === 'buy') { oscillator.frequency.value = 880; oscillator.type = 'sine'; }
        else if (type === 'sell') { oscillator.frequency.value = 660; oscillator.type = 'sine'; }
        else if (type === 'close') { oscillator.frequency.value = 440; oscillator.type = 'triangle'; }
        else { oscillator.frequency.value = 220; oscillator.type = 'sawtooth'; }

        gainNode.gain.setValueAtTime(0.6, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.4);
    } catch (e) {
        console.error('[Sound] Error:', e.message);
    }
}

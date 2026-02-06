// ========== Toast ==========
function showToast(message, type) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    setTimeout(() => { toast.className = 'toast'; }, 3000);
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

// ========== 인사말 업데이트 ==========
function updateGreeting() {
    const hour = new Date().getHours();
    const greetingText = document.getElementById('greetingText');
    const greetingSub = document.getElementById('greetingSub');

    const userName = localStorage.getItem('user_email')?.split('@')[0] || 'Trader';

    let greeting, sub;

    if (hour >= 5 && hour < 12) {
        greeting = `Good Morning, ${userName}! ☀️`;
        sub = '오늘도 좋은 거래 되세요!';
    } else if (hour >= 12 && hour < 18) {
        greeting = `Good Afternoon, ${userName}! 🌤️`;
        sub = '오후도 화이팅!';
    } else if (hour >= 18 && hour < 22) {
        greeting = `Good Evening, ${userName}! 🌙`;
        sub = '오늘 하루 수고하셨어요!';
    } else {
        greeting = `Still Trading, ${userName}? 🦉`;
        sub = '늦은 시간까지 화이팅!';
    }

    if (greetingText) greetingText.textContent = greeting;
    if (greetingSub) greetingSub.textContent = sub;
}

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

// ========== 사운드 재생 (개선된 버전) ==========
function playSound(type) {
    try {
        // ★ 전역 AudioContext 재사용 (브라우저 정책 대응)
        if (!window._audioContext) {
            window._audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        const audioContext = window._audioContext;

        // ★ AudioContext가 suspended 상태면 resume 시도
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('[Sound] AudioContext resumed');
            });
        }

        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        if (type === 'buy') { oscillator.frequency.value = 880; oscillator.type = 'sine'; }
        else if (type === 'sell') { oscillator.frequency.value = 660; oscillator.type = 'sine'; }
        else if (type === 'close') { oscillator.frequency.value = 440; oscillator.type = 'triangle'; }
        else { oscillator.frequency.value = 220; oscillator.type = 'sawtooth'; }

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);

        console.log('[Sound] Played:', type);
    } catch (e) {
        console.error('[Sound] Error:', e.message);
    }
}

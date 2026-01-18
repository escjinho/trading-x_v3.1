/* ========================================
   Trading-X Home Tab
   인사, 프로모션, Trading Mode, MT5 관리
   ======================================== */

// ========== 시간대별 인사 ==========
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

// ========== Trading Mode 전환 ==========
function switchTradingMode(mode) {
    const demoBtn = document.getElementById('modeDemoBtn');
    const liveBtn = document.getElementById('modeLiveBtn');
    const demoCheck = document.getElementById('demoCheck');
    const liveCheck = document.getElementById('liveCheck');
    const modeStatus = document.getElementById('modeStatus');
    const modeBadge = document.getElementById('modeBadge');
    
    if (mode === 'demo') {
        demoBtn.classList.add('active');
        demoBtn.classList.remove('live-active');
        liveBtn.classList.remove('active', 'live-active');
        demoCheck.style.display = 'flex';
        liveCheck.style.display = 'none';
        
        modeStatus.className = 'mode-status';
        modeStatus.innerHTML = '<span class="mode-status-dot demo"></span><span>Currently in <strong>Demo Mode</strong> - Practice with virtual $10,000</span>';
        
        if (modeBadge) {
            modeBadge.textContent = 'DEMO';
            modeBadge.className = 'mode-badge-demo';
            modeBadge.style.display = 'inline';
        }
        
        const demoControl = document.getElementById('demoControlCard');
        if (demoControl) demoControl.style.display = 'block';
        
        isDemo = true;
        showToast('🎮 Demo 모드로 전환되었습니다', 'success');
        fetchDemoData();
        
    } else if (mode === 'live') {
        if (!token) {
            showToast('로그인이 필요합니다', 'error');
            return;
        }
        
        checkMT5Connection().then(hasMT5 => {
            if (hasMT5) {
                liveBtn.classList.add('active', 'live-active');
                demoBtn.classList.remove('active');
                liveCheck.style.display = 'flex';
                demoCheck.style.display = 'none';
                
                modeStatus.className = 'mode-status live';
                modeStatus.innerHTML = '<span class="mode-status-dot live"></span><span>Currently in <strong>Live Mode</strong> - Real trading active</span>';
                
                if (modeBadge) {
                    modeBadge.textContent = 'LIVE';
                    modeBadge.className = 'mode-badge-live';
                    modeBadge.style.display = 'inline';
                }
                
                const demoControl = document.getElementById('demoControlCard');
                if (demoControl) demoControl.style.display = 'none';
                
                isDemo = false;
                showToast('💎 Live 모드로 전환되었습니다', 'success');
                fetchAccountData();
                
            } else {
                showToast('MT5 계정을 먼저 연결해주세요', 'error');
                document.getElementById('mt5AccountSection')?.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }
}

async function checkMT5Connection() {
    try {
        const response = await fetch(`${API_URL}/demo/account-info`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        return data.has_mt5 || false;
    } catch (e) {
        return false;
    }
}

function initTradingModeUI() {
    if (isDemo) {
        switchTradingMode('demo');
    } else {
        const liveBtn = document.getElementById('modeLiveBtn');
        const demoBtn = document.getElementById('modeDemoBtn');
        const liveCheck = document.getElementById('liveCheck');
        const demoCheck = document.getElementById('demoCheck');
        const modeStatus = document.getElementById('modeStatus');
        
        if (liveBtn && demoBtn) {
            liveBtn.classList.add('active', 'live-active');
            demoBtn.classList.remove('active');
            liveCheck.style.display = 'flex';
            demoCheck.style.display = 'none';
            
            modeStatus.className = 'mode-status live';
            modeStatus.innerHTML = '<span class="mode-status-dot live"></span><span>Currently in <strong>Live Mode</strong> - Real trading active</span>';
        }
    }
}

// ========== MT5 Account 관리 ==========
function updateMT5AccountUI(hasMT5, mt5Data = null) {
    const notConnected = document.getElementById('mt5NotConnected');
    const connected = document.getElementById('mt5Connected');
    
    if (hasMT5 && mt5Data) {
        notConnected.style.display = 'none';
        connected.style.display = 'block';
        
        document.getElementById('mt5Broker').textContent = mt5Data.broker || '-';
        document.getElementById('mt5Account').textContent = mt5Data.account || '-';
        document.getElementById('mt5Server').textContent = mt5Data.server || '-';
        document.getElementById('mt5Leverage').textContent = mt5Data.leverage ? `1:${mt5Data.leverage}` : '-';
    } else {
        notConnected.style.display = 'block';
        connected.style.display = 'none';
    }
}

async function disconnectMT5() {
    if (!confirm('MT5 계좌 연결을 해제하시겠습니까?')) return;
    
    try {
        updateMT5AccountUI(false);
        switchTradingMode('demo');
        showToast('MT5 계좌 연결이 해제되었습니다', 'success');
    } catch (e) {
        showToast('연결 해제 실패', 'error');
    }
}

async function checkAndUpdateMT5Status() {
    try {
        const response = await fetch(`${API_URL}/demo/account-info`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (data.has_mt5) {
            const mt5Response = await fetch(`${API_URL}/mt5/account-info`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const mt5Data = await mt5Response.json();
            
            updateMT5AccountUI(true, {
                broker: mt5Data.broker,
                account: mt5Data.account,
                server: mt5Data.server,
                leverage: mt5Data.leverage
            });
        } else {
            updateMT5AccountUI(false);
        }
    } catch (e) {
        updateMT5AccountUI(false);
    }
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
    localStorage.setItem('noticeClosed', Date.now());
}

// ========== MT5 연결 모달 ==========
function openMT5ConnectModal() {
    document.getElementById('mt5ConnectModal').classList.add('show');
    showMT5Step1();
}

function closeMT5ConnectModal() {
    document.getElementById('mt5ConnectModal').classList.remove('show');
}

function showMT5Step1() {
    document.getElementById('mt5Step1').style.display = 'block';
    document.getElementById('mt5Step2Existing').style.display = 'none';
    document.getElementById('mt5Step2New').style.display = 'none';
}

function showMT5Step2(type) {
    document.getElementById('mt5Step1').style.display = 'none';
    if (type === 'existing') {
        document.getElementById('mt5Step2Existing').style.display = 'block';
        document.getElementById('mt5Step2New').style.display = 'none';
    } else {
        document.getElementById('mt5Step2Existing').style.display = 'none';
        document.getElementById('mt5Step2New').style.display = 'block';
    }
}

function openMT5GuideModal() {
    openMT5ConnectModal();
    showMT5Step2('new');
}

async function connectMT5Account() {
    const server = document.getElementById('mt5Server').value;
    const account = document.getElementById('mt5AccountNumber').value;
    const password = document.getElementById('mt5Password').value;
    
    if (!account || !password) {
        showToast('계좌번호와 비밀번호를 입력하세요', 'error');
        return;
    }
    
    showToast('연결 중...', '');
    
    try {
        setTimeout(() => {
            closeMT5ConnectModal();
            
            document.getElementById('successAccount').textContent = account;
            document.getElementById('successServer').textContent = server;
            document.getElementById('mt5SuccessModal').classList.add('show');
            
            updateMT5AccountUI(true, {
                broker: 'HedgeHood',
                account: account,
                server: server,
                leverage: 500
            });
            
            isDemo = false;
            switchTradingMode('live');
            
            const heroBadge = document.getElementById('heroModeBadge');
            if (heroBadge) {
                heroBadge.textContent = 'Trading-X Live';
                heroBadge.style.background = 'linear-gradient(135deg, rgba(0, 255, 136, 0.2) 0%, rgba(0, 255, 136, 0.05) 100%)';
                heroBadge.style.borderColor = 'rgba(0, 255, 136, 0.4)';
                heroBadge.style.color = '#00ff88';
            }
        }, 1500);
        
    } catch (error) {
        showToast('연결 실패: ' + error.message, 'error');
    }
}

function closeMT5SuccessModal() {
    document.getElementById('mt5SuccessModal').classList.remove('show');
}

// ========== Initialize Home ==========
function initHome() {
    updateGreeting();
    setInterval(updateGreeting, 60000);
    
    // Promo slider scroll
    document.getElementById('promoSlider')?.addEventListener('scroll', function() {
        const slider = this;
        const scrollLeft = slider.scrollLeft;
        const cardWidth = slider.querySelector('.promo-card')?.offsetWidth || 0;
        const gap = 12;
        const index = Math.round(scrollLeft / (cardWidth + gap));
        updatePromoDots(index);
    });
    
    // Profile name
    const userEmail = localStorage.getItem('user_email');
    if (userEmail) {
        document.getElementById('profileName').textContent = userEmail.split('@')[0];
    }
    
    // MT5 status
    if (token && !isGuest) {
        checkAndUpdateMT5Status();
    }
}

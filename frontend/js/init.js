// 왓치리스트 초기화
// 브라우저 뒤로가기 지원
window.addEventListener('popstate', function(event) {
    const chartDetail = document.getElementById('chartDetailContainer');
    if (chartDetail && chartDetail.style.display !== 'none') {
        backToWatchlist();
    }
});

// 차트에서 종목 열 때 마지막 종목 저장 (네비게이션 연동)
const originalOpenChartFromWatchlist = openChartFromWatchlist;
openChartFromWatchlist = function(symbol, name, icon, color) {
    localStorage.setItem('last_chart_symbol', symbol);
    originalOpenChartFromWatchlist(symbol, name, icon, color);
};

// 10초마다 시세 업데이트 (데모용)
setInterval(() => {
    const watchlistContainer = document.getElementById('watchlistContainer');
    if (watchlistContainer && watchlistContainer.style.display !== 'none') {
        // 랜덤 변동 시뮬레이션 (실제 API 연동 전)
        Object.keys(demoQuotes).forEach(symbol => {
            const quote = demoQuotes[symbol];
            const variation = (Math.random() - 0.5) * 0.001;
            quote.bid = quote.bid * (1 + variation);
            quote.ask = quote.bid + (quote.ask - quote.bid);
            quote.change = quote.change + (Math.random() - 0.5) * 0.1;
        });
        renderWatchlist();
    }
}, 10000);

// 차트 모듈 초기화
if (typeof initChartModule === 'function') {
    initChartModule();
}

// ========== 홈 슬라이더 + 인사말 시스템 ==========

// 시간대별 인사말 데이터 (5개씩)
const greetingData = {
    morning: [ // 06:00 ~ 12:00
        { en: "Good Morning! ☀️", ko: "오늘도 함께해요!" },
        { en: "Good Morning! ☀️", ko: "좋은 일이 가득할 거예요!" },
        { en: "Good Morning! ☀️", ko: "당신의 아침을 응원해요!" },
        { en: "Rise & Shine! 🌤️", ko: "오늘 하루도 빛날 거예요!" },
        { en: "Fresh Start! 🌤️", ko: "설레는 하루가 시작됐어요!" }
    ],
    afternoon: [ // 12:00 ~ 18:00
        { en: "Good Afternoon! 🌤️", ko: "오후도 화이팅!" },
        { en: "Good Afternoon! 🌤️", ko: "당신을 응원해요!" },
        { en: "Good Afternoon! 🌤️", ko: "오늘도 빛나는 중이에요!" },
        { en: "Keep Going! 💪", ko: "당신의 여정을 응원해요!" },
        { en: "You Got This! ⚡", ko: "잘하고 있어요!" }
    ],
    evening: [ // 18:00 ~ 22:00
        { en: "Good Evening! 🌙", ko: "오늘 하루 수고했어요!" },
        { en: "Good Evening! 🌙", ko: "따뜻한 저녁 보내세요!" },
        { en: "Good Evening! 🌙", ko: "당신의 하루가 빛났어요!" },
        { en: "Well Done! 🌅", ko: "오늘도 멋진 하루였어요!" },
        { en: "Proud of You! 🌃", ko: "하루의 끝, 당신은 더 멋져졌어요!" }
    ],
    night: [ // 22:00 ~ 06:00
        { en: "Good Night! 🌙", ko: "오늘도 수고 많았어요!" },
        { en: "Night Owl! 🦉", ko: "당신의 열정이 멋져요!" },
        { en: "Late Night! 🌌", ko: "꿈을 향해 달리는 중이군요!" },
        { en: "Keep Dreaming! 💫", ko: "내일은 더 좋은 날이 될 거예요!" },
        { en: "Sweet Dreams! ✨", ko: "별빛처럼 빛나는 당신을 응원해요!" }
    ]
};

// 현재 시간대 가져오기
function getTimeOfDay() {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    if (hour >= 18 && hour < 22) return 'evening';
    return 'night';
}

// 세션별 인사말 인덱스 가져오기 (재접속 시 변경)
function getGreetingIndex(timeOfDay) {
    const storageKey = `greeting_index_${timeOfDay}`;
    const dateKey = 'greeting_date';
    
    const today = new Date().toDateString();
    const savedDate = sessionStorage.getItem(dateKey);
    
    // 새 세션이거나 날짜가 바뀌면 새 인덱스 생성
    if (!sessionStorage.getItem(storageKey) || savedDate !== today) {
        const randomIndex = Math.floor(Math.random() * 5);
        sessionStorage.setItem(storageKey, randomIndex);
        sessionStorage.setItem(dateKey, today);
        return randomIndex;
    }
    
    return parseInt(sessionStorage.getItem(storageKey));
}

// 인사말 업데이트
function updateGreeting() {
    const timeOfDay = getTimeOfDay();
    const index = getGreetingIndex(timeOfDay);
    const greeting = greetingData[timeOfDay][index];
    
    const greetingText = document.getElementById('greetingText');
    const greetingSub = document.getElementById('greetingSub');
    
    if (greetingText && greetingSub) {
        // 사용자 이름 가져오기 (있으면)
        const userName = localStorage.getItem('user_name') || '';
        
        // 영문 인사말에 이름 추가
        let enText = greeting.en;
        if (userName) {
            // 이모지 앞에 이름 삽입
            const emojiMatch = enText.match(/[\u{1F300}-\u{1F9FF}]/u);
            if (emojiMatch) {
                enText = enText.replace(emojiMatch[0], `, ${userName}! ${emojiMatch[0]}`);
            } else {
                enText = enText.replace('!', `, ${userName}!`);
            }
        }
        
        greetingText.textContent = enText;
        greetingSub.textContent = greeting.ko;
    }
}

// 홈 슬라이더 변수
let homeSliderInterval = null;
let homeSliderPaused = false;
const HOME_SLIDE_INTERVAL = 5000; // 5초

// 홈 슬라이더 초기화
function initHomeSlider() {
    const slider = document.getElementById('homeSlider');
    const dots = document.querySelectorAll('.home-dot');
    
    if (!slider || dots.length === 0) return;
    
    // 인사말 업데이트
    updateGreeting();
    
    // 인디케이터 클릭
    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            scrollToHomeSlide(index);
            resetHomeSliderTimer();
        });
    });
    
    // 스크롤 이벤트 (수동 스와이프 감지)
    slider.addEventListener('scroll', () => {
        const index = Math.round(slider.scrollLeft / slider.offsetWidth);
        updateHomeDots(index);
    });
    
    // 터치 시작 시 자동 슬라이드 일시 정지
    slider.addEventListener('touchstart', () => {
        homeSliderPaused = true;
        clearInterval(homeSliderInterval);
    });
    
    // 터치 종료 후 3초 뒤 자동 슬라이드 재개
    slider.addEventListener('touchend', () => {
        setTimeout(() => {
            homeSliderPaused = false;
            startHomeSliderTimer();
        }, 3000);
    });
    
    // 자동 슬라이드 시작
    startHomeSliderTimer();
    
    // 라이브 계좌 상태에 따른 CTA 표시
    updateLiveCTA();
}

function scrollToHomeSlide(index) {
    const slider = document.getElementById('homeSlider');
    if (!slider) return;
    
    const slideWidth = slider.offsetWidth;
    slider.scrollTo({
        left: slideWidth * index,
        behavior: 'smooth'
    });
    updateHomeDots(index);
}

function updateHomeDots(activeIndex) {
    const dots = document.querySelectorAll('.home-dot');
    dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === activeIndex);
    });
}

function startHomeSliderTimer() {
    if (homeSliderPaused) return;
    
    clearInterval(homeSliderInterval);
    homeSliderInterval = setInterval(() => {
        if (homeSliderPaused) return;
        
        const slider = document.getElementById('homeSlider');
        if (!slider) return;
        
        const currentIndex = Math.round(slider.scrollLeft / slider.offsetWidth);
        const totalSlides = document.querySelectorAll('.home-slide').length;
        const nextIndex = (currentIndex + 1) % totalSlides;
        
        scrollToHomeSlide(nextIndex);
    }, HOME_SLIDE_INTERVAL);
}

function resetHomeSliderTimer() {
    clearInterval(homeSliderInterval);
    startHomeSliderTimer();
}

// 라이브 계좌 연결 상태에 따른 CTA 업데이트
function updateLiveCTA() {
    const notConnected = document.getElementById('liveCTANotConnected');
    const connected = document.getElementById('liveCTAConnected');
    
    if (!notConnected || !connected) return;
    
    // tradingMode가 'live'이고 MT5 연결되어 있으면
    const isLiveConnected = (typeof tradingMode !== 'undefined' && tradingMode === 'live') && 
                           (typeof mt5Connected !== 'undefined' && mt5Connected);
    
    notConnected.style.display = isLiveConnected ? 'none' : 'block';
    connected.style.display = isLiveConnected ? 'block' : 'none';
}

// Trading 탭으로 이동
function switchToTrading() {
    const tradeNav = document.querySelector('.nav-item[data-page="trade"]');
    if (tradeNav) {
        tradeNav.click();
    }
}

// 이용가이드 투어 시작 (나중에 구현)
function startGuideTour() {
    showToast('📖 이용가이드는 준비 중입니다!', 'info');
    // TODO: 인터랙티브 투어 구현 예정
}

// 셀퍼럴 안내 페이지 열기 (나중에 구현)
function openReferralPage() {
    showToast('💰 리베이트 센터는 준비 중입니다!', 'info');
    // TODO: 셀퍼럴 안내 페이지 또는 리베이트 센터 모달
}

// 홈 슬라이더 초기화 실행
initHomeSlider();

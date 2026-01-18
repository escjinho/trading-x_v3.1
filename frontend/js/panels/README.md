# Chart Panels 모듈 구조

차트 탭의 패널들을 독립적인 모듈로 분리하여 유지보수성과 확장성을 향상시켰습니다.

## 📁 파일 구조

```
frontend/js/panels/
├── gaugePanel.js           # Trade 탭 게이지
├── chartGaugePanel.js      # Chart 탭 게이지
├── chartPanel.js           # TradingView 차트
├── symbolSelectorPanel.js  # 심볼 선택 드롭다운
├── randomWalkPanel.js      # 랜덤 워크 계산
└── README.md               # 이 파일
```

## 🎯 각 패널 설명

### 1. **GaugePanel** (`gaugePanel.js`)
- **목적**: Trade 탭의 게이지 렌더링 및 애니메이션
- **주요 기능**:
  - SVG Arc 경로 생성
  - 스프링-댐핑 애니메이션
  - 상태 텍스트 업데이트 (Strong Sell ~ Strong Buy)
- **전역 변수 사용**: `baseScore`, `targetScore`, `displayScore`, `velocity`

### 2. **ChartGaugePanel** (`chartGaugePanel.js`)
- **목적**: Chart 탭의 게이지 렌더링 및 애니메이션
- **주요 기능**:
  - SVG Arc 경로 생성
  - 스프링-댐핑 애니메이션
  - 상태 텍스트 업데이트
- **전역 변수 사용**: `chartTargetScore`, `chartDisplayScore`, `chartVelocity`

### 3. **ChartPanel** (`chartPanel.js`)
- **목적**: TradingView Lightweight Charts 렌더링 및 관리
- **주요 기능**:
  - 차트 초기화 (캔들스틱, 볼린저 밴드, LWMA)
  - 캔들 데이터 로드
  - 타임프레임 전환
  - 반응형 리사이즈
- **전역 변수 사용**: `chart`, `candleSeries`, `bbUpperSeries`, `bbMiddleSeries`, `bbLowerSeries`, `lwmaSeries`

### 4. **SymbolSelectorPanel** (`symbolSelectorPanel.js`)
- **목적**: 차트 심볼 선택 드롭다운
- **주요 기능**:
  - 드롭다운 토글
  - 심볼 선택 및 UI 업데이트
  - localStorage에 마지막 선택 저장
- **전역 함수**: `toggleChartSymbolDropdown()`, `selectChartSymbol()`

### 5. **RandomWalkPanel** (`randomWalkPanel.js`)
- **목적**: 게이지 랜덤 워크 계산
- **주요 기능**:
  - baseScore로 당기는 힘 계산
  - 랜덤 노이즈 추가
  - 2~3초마다 targetScore 업데이트
- **전역 변수 사용**: `baseScore`, `targetScore`

## 🔧 패널 API

각 패널은 동일한 인터페이스를 제공합니다:

```javascript
const Panel = {
    /**
     * 패널 초기화
     */
    init() { },

    /**
     * 데이터로 패널 업데이트
     * @param {Object} data - 업데이트할 데이터
     */
    update(data) { },

    /**
     * 패널 정리 (메모리 해제)
     */
    destroy() { }
};
```

## 🚀 사용 방법

### 1. 모든 패널 초기화

```javascript
// chart.js에서 호출
initChartModule();
```

이 함수는 다음 패널들을 순서대로 초기화합니다:
1. GaugePanel
2. ChartGaugePanel
3. ChartPanel
4. SymbolSelectorPanel
5. RandomWalkPanel

### 2. 개별 패널 접근

```javascript
// 게이지 패널 수동 업데이트
GaugePanel.update({ score: 75 });

// 차트 재초기화
ChartPanel.reinit();

// 심볼 선택
SymbolSelectorPanel.selectSymbol('BTCUSD', 'Bitcoin', '₿', '#f7931a');
```

### 3. 모든 패널 정리

```javascript
// 페이지 종료 시 또는 재초기화 전
destroyChartModule();
```

## ➕ 새 패널 추가하기

새로운 패널을 추가하려면:

### 1. 패널 파일 생성

`frontend/js/panels/newPanel.js`:
```javascript
const NewPanel = {
    init() {
        console.log('[NewPanel] Initialized');
        // 초기화 로직
    },

    update(data) {
        // 업데이트 로직
    },

    destroy() {
        console.log('[NewPanel] Destroyed');
        // 정리 로직
    }
};
```

### 2. index.html에 추가

```html
<!-- Chart Panels (모듈화) -->
<script src="js/panels/gaugePanel.js"></script>
<script src="js/panels/chartGaugePanel.js"></script>
<script src="js/panels/chartPanel.js"></script>
<script src="js/panels/symbolSelectorPanel.js"></script>
<script src="js/panels/randomWalkPanel.js"></script>
<script src="js/panels/newPanel.js"></script> <!-- 추가 -->
```

### 3. chart.js에서 초기화

```javascript
function initChartModule() {
    // ... 기존 패널들 ...

    if (typeof NewPanel !== 'undefined') {
        NewPanel.init();
    }
}

function destroyChartModule() {
    // ... 기존 패널들 ...

    if (typeof NewPanel !== 'undefined') {
        NewPanel.destroy();
    }
}
```

## 📝 주의사항

1. **전역 변수 의존성**: 패널들은 `state.js`에 정의된 전역 변수에 의존합니다.
2. **초기화 순서**: 패널 간 의존성이 있을 수 있으므로 초기화 순서가 중요합니다.
3. **메모리 관리**: `destroy()` 메서드에서 반드시 타이머와 이벤트 리스너를 정리해야 합니다.
4. **HTML 요소**: 각 패널은 해당 DOM 요소가 존재한다고 가정하므로, HTML 구조 변경 시 주의가 필요합니다.

## 🔗 관련 파일

- **chart.js**: 모든 패널을 통합하는 메인 파일
- **state.js**: 전역 변수 선언
- **connection.js**: WebSocket으로 실시간 데이터 수신
- **init.js**: 애플리케이션 초기화

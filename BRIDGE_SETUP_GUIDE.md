# MT5 브릿지 설정 가이드

Windows MT5에서 Linux 서버로 실시간 시세를 전송하는 브릿지 설정 가이드입니다.

## 📋 시스템 구성

- **Windows 서버**: 158.247.222.183 (MT5 설치, Hedgehood 브로커)
- **Linux 서버**: 158.247.251.146 (Trading-X 웹 운영)
- **전송 심볼**: BTCUSD, EURUSD.r, USDJPY.r, XAUUSD.r, US100., GBPUSD.r, AUDUSD.r, USDCAD.r, ETHUSD

---

## 🚀 빠른 시작

### 1단계: 필수 패키지 설치 확인

```bash
# 가상환경이 활성화되어 있는지 확인
# Windows에서:
venv\Scripts\activate

# 필수 패키지 확인
pip install MetaTrader5 httpx asyncio
```

### 2단계: MT5 로그인 정보 설정

`run_bridge.py` 파일을 열어서 MT5 로그인 정보를 입력합니다:

```python
# MT5 로그인 정보 (Hedgehood)
MT5_LOGIN = 123456  # 실제 계정 번호로 변경
MT5_PASSWORD = "your_password"  # 실제 비밀번호로 변경
MT5_SERVER = "Hedgehood-Demo"  # 실제 서버명으로 변경
```

> **참고**: MT5가 이미 로그인되어 있다면 로그인 정보를 `None`으로 두어도 됩니다.

### 3단계: 브릿지 실행

#### 방법 1: 배치 파일 실행 (권장)

```bash
# Windows에서 더블클릭 또는 명령창에서:
run_bridge.bat
```

#### 방법 2: Python 직접 실행

```bash
python run_bridge.py
```

### 4단계: 로그 확인

브릿지가 실행되면 다음과 같은 로그가 표시됩니다:

```
============================================================
Trading-X MT5 Bridge
============================================================

Linux 서버: http://158.247.251.146:8000
업데이트 간격: 1초
모니터링 심볼: BTCUSD, EURUSD.r, USDJPY.r, ...

브릿지를 시작합니다...
종료하려면 Ctrl+C를 누르세요
============================================================

2024-01-27 10:30:00 - MT5Bridge - INFO - MT5 초기화 성공!
2024-01-27 10:30:00 - MT5Bridge - INFO - 브릿지 루프 시작...
2024-01-27 10:30:01 - MT5Bridge - DEBUG - 전송 성공: BTCUSD
2024-01-27 10:30:01 - MT5Bridge - DEBUG - 전송 성공: EURUSD.r
...
```

---

## 🔧 고급 설정

### Windows 자동 시작 설정

Windows 시작 시 자동으로 브릿지가 실행되도록 설정:

```bash
# 관리자 권한으로 실행
setup_autostart.bat
```

자동 시작 해제:

```bash
remove_autostart.bat
```

또는 수동으로:
1. `Win + R` 키를 누르고
2. `shell:startup` 입력
3. `Trading-X MT5 Bridge.lnk` 파일 삭제

### 브릿지 설정 변경

`backend/app/services/mt5_bridge.py` 파일에서 설정을 변경할 수 있습니다:

```python
bridge = MT5Bridge(
    linux_server="http://158.247.251.146:8000",  # Linux 서버 주소
    update_interval=1,  # 업데이트 간격 (초)
    candle_count=100,  # 전송할 캔들 개수
    mt5_login=YOUR_LOGIN,
    mt5_password="YOUR_PASSWORD",
    mt5_server="YOUR_SERVER"
)
```

### 전송 심볼 변경

`backend/app/services/mt5_bridge.py` 파일에서 `SYMBOLS` 리스트를 수정:

```python
SYMBOLS = [
    "BTCUSD",
    "EURUSD.r",
    # 필요한 심볼 추가/제거
]
```

---

## 📊 Linux 서버 연동

### 데이터 수신 엔드포인트

Linux 서버는 다음 엔드포인트로 데이터를 수신합니다:

```
POST http://158.247.251.146:8000/api/mt5/bridge/{symbol}
```

### 데이터 형식

```json
{
  "symbol": "BTCUSD",
  "candles": [
    {
      "time": 1706342400,
      "open": 42500.0,
      "high": 42600.0,
      "low": 42450.0,
      "close": 42550.0,
      "volume": 1234
    },
    ...
  ],
  "tick": {
    "symbol": "BTCUSD",
    "bid": 42550.0,
    "ask": 42552.0,
    "last": 42551.0,
    "time": "2024-01-27T10:30:00"
  },
  "timestamp": "2024-01-27T10:30:00"
}
```

### 응답 형식

```json
{
  "status": "success",
  "message": "BTCUSD 데이터 수신 완료",
  "timestamp": "2024-01-27T10:30:00"
}
```

---

## 🐛 문제 해결

### MT5 초기화 실패

**증상**: `MT5 초기화 실패` 오류 메시지

**해결 방법**:
1. MT5가 실행 중인지 확인
2. MT5 터미널에서 로그인되어 있는지 확인
3. MT5 경로가 시스템 환경변수에 등록되어 있는지 확인

### 로그인 실패

**증상**: `MT5 로그인 실패` 오류 메시지

**해결 방법**:
1. `run_bridge.py`에서 로그인 정보가 올바른지 확인
2. MT5 터미널에서 수동 로그인이 되는지 테스트
3. 서버명, 계정번호, 비밀번호를 정확히 입력했는지 확인

### 심볼 선택 실패

**증상**: `심볼 선택 실패: XXXX` 경고 메시지

**해결 방법**:
1. MT5 터미널의 "Market Watch"에서 해당 심볼이 표시되는지 확인
2. MT5에서 해당 심볼을 수동으로 추가 (Market Watch 우클릭 → Symbols → 심볼 검색 및 추가)
3. 브로커가 해당 심볼을 제공하는지 확인

### 전송 실패

**증상**: `전송 실패 (XXXX): 500` 오류 메시지

**해결 방법**:
1. Linux 서버가 실행 중인지 확인
2. 네트워크 연결 상태 확인
3. Linux 서버 로그 확인: `journalctl -u trading-x -f`
4. 방화벽 설정 확인 (포트 8000 열림)

### 데이터 없음

**증상**: `데이터 없음: XXXX` 경고 메시지

**해결 방법**:
1. MT5에서 해당 심볼의 차트가 표시되는지 확인
2. 시장이 열려 있는 시간인지 확인
3. 심볼명이 정확한지 확인 (대소문자, 특수문자 등)

---

## 📝 로그 파일

브릿지 실행 중 생성되는 로그 파일:

- **위치**: `C:\Users\escji\trading-x_v3.1\mt5_bridge.log`
- **내용**: 브릿지 실행, 데이터 수집, 전송 상태 등 모든 이벤트 기록

로그 레벨 변경 (더 자세한 로그):

`backend/app/services/mt5_bridge.py`에서:

```python
logging.basicConfig(
    level=logging.DEBUG,  # INFO에서 DEBUG로 변경
    ...
)
```

---

## 🔒 보안 권장사항

1. **로그인 정보 보호**
   - `run_bridge.py`에 실제 로그인 정보를 하드코딩하지 말 것
   - 환경 변수나 별도의 설정 파일 사용 권장
   - `.gitignore`에 설정 파일 추가

2. **네트워크 보안**
   - HTTPS 사용 권장 (현재는 HTTP)
   - API 키 또는 토큰 인증 추가 고려
   - IP 화이트리스트 설정

3. **접근 제어**
   - Linux 서버에 방화벽 설정
   - Windows 서버 IP만 허용

---

## 📞 지원

문제가 발생하면:
1. 로그 파일 확인 (`mt5_bridge.log`)
2. MT5 터미널 로그 확인
3. Linux 서버 로그 확인
4. 이 가이드의 문제 해결 섹션 참조

---

## 📄 라이센스

Trading-X © 2024

# MT5 Bridge - 빠른 시작 가이드

Windows MT5에서 Linux 서버로 실시간 시세를 전송하는 브릿지 시스템입니다.

## 🚀 5분 안에 시작하기

### 1. 테스트 실행

```bash
python test_bridge.py
```

모든 테스트가 통과하면 다음 단계로 진행하세요.

### 2. MT5 로그인 정보 설정 (선택사항)

`run_bridge.py` 파일을 열고 다음 부분을 수정:

```python
MT5_LOGIN = 123456  # 실제 계정 번호
MT5_PASSWORD = "your_password"  # 실제 비밀번호
MT5_SERVER = "Hedgehood-Demo"  # 실제 서버명
```

> MT5가 이미 로그인되어 있다면 이 단계를 건너뛰어도 됩니다.

### 3. 브릿지 실행

#### Windows에서 더블클릭:
```
run_bridge.bat
```

또는 명령창에서:
```bash
python run_bridge.py
```

### 4. 확인

로그에서 다음과 같은 메시지가 보이면 성공:
```
✅ MT5 초기화 성공!
✅ 브릿지 루프 시작...
✅ 전송 성공: BTCUSD
```

---

## 📁 파일 구조

```
trading-x_v3.1/
├── backend/app/services/
│   └── mt5_bridge.py           # 브릿지 핵심 로직
├── run_bridge.py               # 브릿지 실행 스크립트
├── run_bridge.bat              # Windows 실행 파일
├── test_bridge.py              # 테스트 스크립트
├── setup_autostart.bat         # 자동 시작 설정
├── remove_autostart.bat        # 자동 시작 해제
├── bridge_config.example.py    # 설정 파일 예제
├── BRIDGE_SETUP_GUIDE.md       # 상세 가이드
└── BRIDGE_README.md            # 이 파일
```

---

## ⚙️ 기능

- ✅ 실시간 시세 수집 (9개 심볼)
- ✅ 캔들 히스토리 전송 (최소 100개)
- ✅ Linux 서버로 HTTP POST 전송
- ✅ 자동 재연결 및 오류 처리
- ✅ 로그 파일 기록
- ✅ Windows 자동 시작 지원

---

## 🔧 주요 설정

### 전송 심볼
```
BTCUSD, EURUSD.r, USDJPY.r, XAUUSD.r, US100.,
GBPUSD.r, AUDUSD.r, USDCAD.r, ETHUSD
```

### Linux 서버
```
http://158.247.251.146:8000
```

### 업데이트 간격
```
1초
```

---

## 🐛 문제 해결

### MT5 연결 실패
1. MT5가 실행 중인지 확인
2. MT5에서 로그인되어 있는지 확인
3. `test_bridge.py` 실행하여 테스트

### 서버 연결 실패
1. Linux 서버가 실행 중인지 확인
2. 네트워크 연결 확인
3. 방화벽 설정 확인

### 심볼 없음
1. MT5 Market Watch에서 심볼 추가
2. 브로커가 해당 심볼을 지원하는지 확인

---

## 📖 상세 문서

더 자세한 내용은 [BRIDGE_SETUP_GUIDE.md](BRIDGE_SETUP_GUIDE.md)를 참조하세요.

---

## 📝 로그 확인

로그 파일: `mt5_bridge.log`

실시간 로그 보기:
```bash
tail -f mt5_bridge.log  # Linux/Mac
Get-Content mt5_bridge.log -Wait  # Windows PowerShell
```

---

## 🔄 자동 시작 설정

Windows 시작 시 자동 실행:
```bash
setup_autostart.bat  # 관리자 권한으로 실행
```

자동 시작 해제:
```bash
remove_autostart.bat
```

---

## 📞 지원

문제가 발생하면:
1. `test_bridge.py` 실행
2. `mt5_bridge.log` 로그 확인
3. `BRIDGE_SETUP_GUIDE.md` 참조

---

## 📊 모니터링

브릿지 상태 확인:
- Windows: Task Manager에서 python.exe 프로세스 확인
- 로그: `mt5_bridge.log` 파일 확인
- 서버: Linux 서버 로그 확인

---

## 🎯 다음 단계

1. ✅ 테스트 실행 (`test_bridge.py`)
2. ✅ 브릿지 실행 (`run_bridge.bat`)
3. ⏸️ 로그 확인 (정상 작동 확인)
4. ⏸️ 자동 시작 설정 (선택사항)
5. ⏸️ Linux 서버에서 데이터 수신 확인

---

Trading-X © 2024

"""
MT5 Bridge 설정 파일 예제
실제 사용 시 이 파일을 'bridge_config.py'로 복사하여 사용하세요
주의: bridge_config.py는 .gitignore에 추가하여 Git에 커밋되지 않도록 하세요
"""

# MT5 계정 정보 (Hedgehood)
MT5_LOGIN = None  # 예: 123456
MT5_PASSWORD = None  # 예: "your_password"
MT5_SERVER = None  # 예: "Hedgehood-Demo" 또는 "Hedgehood-Live"

# Linux 서버 설정
LINUX_SERVER = "http://158.247.251.146:8000"

# 브릿지 설정
UPDATE_INTERVAL = 1  # 업데이트 간격 (초)
CANDLE_COUNT = 100  # 전송할 캔들 개수

# 모니터링 심볼 (필요에 따라 추가/제거)
SYMBOLS = [
    "BTCUSD",
    "EURUSD.r",
    "USDJPY.r",
    "XAUUSD.r",
    "US100.",
    "GBPUSD.r",
    "AUDUSD.r",
    "USDCAD.r",
    "ETHUSD"
]

# 로깅 설정
LOG_LEVEL = "INFO"  # DEBUG, INFO, WARNING, ERROR
LOG_FILE = "mt5_bridge.log"

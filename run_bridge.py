"""
MT5 Bridge 실행 스크립트
Windows MT5에서 Linux 서버로 실시간 시세 전송
"""

import asyncio
import sys
from pathlib import Path

# 프로젝트 경로를 Python Path에 추가
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root / "backend"))

from app.services.mt5_bridge import MT5Bridge


def main():
    """메인 함수"""
    print("=" * 60)
    print("Trading-X MT5 Bridge")
    print("=" * 60)
    print()

    # MT5 로그인 정보 (Hedgehood)
    # 실제 로그인 정보로 변경하세요
    MT5_LOGIN = None  # 예: 123456
    MT5_PASSWORD = None  # 예: "your_password"
    MT5_SERVER = None  # 예: "Hedgehood-Demo"

    # Linux 서버 주소
    LINUX_SERVER = "http://158.247.251.146:8000"

    # 브릿지 설정
    bridge = MT5Bridge(
        linux_server=LINUX_SERVER,
        update_interval=1,  # 1초마다 업데이트
        candle_count=100,
        mt5_login=MT5_LOGIN,
        mt5_password=MT5_PASSWORD,
        mt5_server=MT5_SERVER
    )

    print(f"Linux 서버: {LINUX_SERVER}")
    print(f"업데이트 간격: 1초")
    print(f"모니터링 심볼: BTCUSD, EURUSD.r, USDJPY.r, XAUUSD.r, US100., GBPUSD.r, AUDUSD.r, USDCAD.r, ETHUSD")
    print()
    print("브릿지를 시작합니다...")
    print("종료하려면 Ctrl+C를 누르세요")
    print("=" * 60)
    print()

    # 브릿지 실행
    try:
        asyncio.run(bridge.start())
    except KeyboardInterrupt:
        print("\n\n브릿지가 사용자에 의해 중단되었습니다.")
    except Exception as e:
        print(f"\n\n오류 발생: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

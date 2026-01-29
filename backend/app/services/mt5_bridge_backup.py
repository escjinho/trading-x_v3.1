"""
MT5 Bridge Service
Windows MT5에서 실시간 시세를 수집하여 Linux 서버로 전송
"""

import MetaTrader5 as mt5
import httpx
import asyncio
import time
from datetime import datetime
from typing import Dict, List, Optional
import logging

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('mt5_bridge.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('MT5Bridge')


class MT5Bridge:
    """MT5 브릿지 서비스 - Windows에서 Linux 서버로 시세 전송"""

    # 모니터링할 심볼 목록
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

    def __init__(
        self,
        linux_server: str = "http://158.247.251.146:8000",
        update_interval: int = 1,  # 초 단위
        candle_count: int = 100,
        mt5_login: Optional[int] = None,
        mt5_password: Optional[str] = None,
        mt5_server: Optional[str] = None
    ):
        """
        초기화

        Args:
            linux_server: Linux 서버 URL
            update_interval: 업데이트 간격 (초)
            candle_count: 전송할 캔들 개수
            mt5_login: MT5 계정 로그인
            mt5_password: MT5 계정 패스워드
            mt5_server: MT5 서버명
        """
        self.linux_server = linux_server.rstrip('/')
        self.update_interval = update_interval
        self.candle_count = candle_count
        self.mt5_login = mt5_login
        self.mt5_password = mt5_password
        self.mt5_server = mt5_server
        self.running = False
        self.client = httpx.AsyncClient(timeout=10.0)

    def initialize_mt5(self) -> bool:
        """MT5 초기화 및 로그인"""
        logger.info("MT5 초기화 시작...")

        if not mt5.initialize():
            logger.error(f"MT5 초기화 실패: {mt5.last_error()}")
            return False

        logger.info("MT5 초기화 성공!")

        # 로그인 정보가 있으면 로그인 시도
        if self.mt5_login and self.mt5_password and self.mt5_server:
            logger.info(f"MT5 로그인 시도: {self.mt5_login}@{self.mt5_server}")

            authorized = mt5.login(
                login=self.mt5_login,
                password=self.mt5_password,
                server=self.mt5_server
            )

            if not authorized:
                logger.error(f"MT5 로그인 실패: {mt5.last_error()}")
                return False

            logger.info("MT5 로그인 성공!")

        # 심볼 선택 활성화
        for symbol in self.SYMBOLS:
            if not mt5.symbol_select(symbol, True):
                logger.warning(f"심볼 선택 실패: {symbol}")

        return True

    def get_candles(self, symbol: str, timeframe: str = "M15", count: int = 100) -> List[Dict]:
        """캔들 데이터 수집"""
        try:
            # 타임프레임 매핑
            tf_map = {
                "M1": mt5.TIMEFRAME_M1,
                "M5": mt5.TIMEFRAME_M5,
                "M15": mt5.TIMEFRAME_M15,
                "M30": mt5.TIMEFRAME_M30,
                "H1": mt5.TIMEFRAME_H1,
                "H4": mt5.TIMEFRAME_H4,
                "D1": mt5.TIMEFRAME_D1,
            }

            mt5_tf = tf_map.get(timeframe, mt5.TIMEFRAME_M15)
            rates = mt5.copy_rates_from_pos(symbol, mt5_tf, 0, count)

            if rates is None or len(rates) == 0:
                logger.warning(f"캔들 데이터 없음: {symbol}")
                return []

            candles = []
            for rate in rates:
                candles.append({
                    "time": int(rate['time']),
                    "open": float(rate['open']),
                    "high": float(rate['high']),
                    "low": float(rate['low']),
                    "close": float(rate['close']),
                    "volume": int(rate['tick_volume'])
                })

            return candles

        except Exception as e:
            logger.error(f"캔들 수집 오류 ({symbol}): {e}")
            return []

    def get_tick(self, symbol: str) -> Optional[Dict]:
        """현재 시세 수집"""
        try:
            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
                return None

            return {
                "symbol": symbol,
                "bid": tick.bid,
                "ask": tick.ask,
                "last": tick.last,
                "time": datetime.fromtimestamp(tick.time).isoformat()
            }

        except Exception as e:
            logger.error(f"시세 수집 오류 ({symbol}): {e}")
            return None

    async def send_to_server(self, symbol: str, data: Dict) -> bool:
        """Linux 서버로 데이터 전송"""
        try:
            # Linux 서버의 bridge 엔드포인트로 전송
            url = f"{self.linux_server}/api/mt5/bridge/{symbol}"

            response = await self.client.post(url, json=data)

            if response.status_code == 200:
                logger.debug(f"전송 성공: {symbol}")
                return True
            else:
                logger.warning(f"전송 실패 ({symbol}): {response.status_code}")
                return False

        except Exception as e:
            logger.error(f"전송 오류 ({symbol}): {e}")
            return False

    async def collect_and_send(self, symbol: str):
        """데이터 수집 및 전송"""
        try:
            # 캔들 데이터 수집
            candles = self.get_candles(symbol, "M15", self.candle_count)

            # 현재 시세 수집
            tick = self.get_tick(symbol)

            if not candles or not tick:
                logger.warning(f"데이터 없음: {symbol}")
                return

            # 전송할 데이터 구성
            data = {
                "symbol": symbol,
                "candles": candles,
                "tick": tick,
                "timestamp": datetime.now().isoformat()
            }

            # 서버로 전송
            await self.send_to_server(symbol, data)

        except Exception as e:
            logger.error(f"수집/전송 오류 ({symbol}): {e}")

    async def run_loop(self):
        """메인 루프 - 실시간 데이터 수집 및 전송"""
        logger.info("브릿지 루프 시작...")
        logger.info(f"모니터링 심볼: {', '.join(self.SYMBOLS)}")
        logger.info(f"업데이트 간격: {self.update_interval}초")
        logger.info(f"Linux 서버: {self.linux_server}")

        self.running = True

        while self.running:
            try:
                start_time = time.time()

                # 모든 심볼에 대해 병렬로 데이터 수집 및 전송
                tasks = [self.collect_and_send(symbol) for symbol in self.SYMBOLS]
                await asyncio.gather(*tasks, return_exceptions=True)

                # 다음 업데이트까지 대기
                elapsed = time.time() - start_time
                sleep_time = max(0, self.update_interval - elapsed)

                if sleep_time > 0:
                    await asyncio.sleep(sleep_time)

            except Exception as e:
                logger.error(f"루프 오류: {e}")
                await asyncio.sleep(5)  # 오류 발생 시 5초 대기

        logger.info("브릿지 루프 종료")

    async def start(self):
        """브릿지 시작"""
        logger.info("=" * 60)
        logger.info("MT5 Bridge 시작")
        logger.info("=" * 60)

        # MT5 초기화
        if not self.initialize_mt5():
            logger.error("MT5 초기화 실패 - 브릿지 종료")
            return

        try:
            # 메인 루프 실행
            await self.run_loop()

        except KeyboardInterrupt:
            logger.info("\n사용자에 의해 중단됨")

        except Exception as e:
            logger.error(f"브릿지 오류: {e}")

        finally:
            await self.stop()

    async def stop(self):
        """브릿지 종료"""
        logger.info("브릿지 종료 중...")

        self.running = False

        # HTTP 클라이언트 종료
        await self.client.aclose()

        # MT5 종료
        mt5.shutdown()

        logger.info("브릿지 종료 완료")
        logger.info("=" * 60)


# 단독 실행용
if __name__ == "__main__":
    # 브릿지 인스턴스 생성
    bridge = MT5Bridge(
        linux_server="http://158.247.251.146:8000",
        update_interval=1,  # 1초마다 업데이트
        candle_count=100,
        # MT5 로그인 정보 (필요시 입력)
        # mt5_login=YOUR_LOGIN,
        # mt5_password="YOUR_PASSWORD",
        # mt5_server="YOUR_SERVER"
    )

    # 브릿지 실행
    asyncio.run(bridge.start())

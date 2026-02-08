#!/usr/bin/env python3
"""
MT5 Bridge Auto-Recovery Launcher
Windows C:\MT5Bridge\ 에서 실행
mt5_bridge.py가 종료되면 자동으로 재시작
"""

import subprocess
import time
import sys
import os
from datetime import datetime

# 설정
BRIDGE_SCRIPT = "mt5_bridge.py"
LOG_FILE = "bridge_launcher.log"
RESTART_DELAY = 10  # 재시작 대기 시간 (초)


def log_crash(exit_code: int) -> None:
    """크래시 정보를 로그 파일에 기록"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = f"[{timestamp}] 프로세스 종료 - 종료코드: {exit_code}\n"

    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(log_entry)


def run_bridge() -> int:
    """mt5_bridge.py 실행 및 종료코드 반환"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    bridge_path = os.path.join(script_dir, BRIDGE_SCRIPT)

    process = subprocess.Popen(
        [sys.executable, bridge_path],
        cwd=script_dir
    )

    return process.wait()


def main() -> None:
    """메인 루프 - 무한 재시작"""
    while True:
        print(f"[Launcher] {BRIDGE_SCRIPT} 시작")

        exit_code = run_bridge()

        log_crash(exit_code)
        print(f"[Launcher] 프로세스 종료 감지, {RESTART_DELAY}초 후 재시작...")

        time.sleep(RESTART_DELAY)


if __name__ == "__main__":
    main()

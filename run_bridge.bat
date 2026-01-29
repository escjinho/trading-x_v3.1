@echo off
REM MT5 Bridge 실행 배치 파일
REM Windows에서 MT5 브릿지를 실행합니다

echo ========================================
echo Trading-X MT5 Bridge Launcher
echo ========================================
echo.

REM 현재 디렉토리를 스크립트 위치로 변경
cd /d "%~dp0"

REM 가상환경 활성화
if exist "venv\Scripts\activate.bat" (
    echo 가상환경 활성화 중...
    call venv\Scripts\activate.bat
) else (
    echo 경고: 가상환경을 찾을 수 없습니다.
    echo Python이 시스템에 설치되어 있는지 확인하세요.
    echo.
)

REM Python 버전 확인
python --version

REM 브릿지 실행
echo.
echo 브릿지 시작...
echo.
python run_bridge.py

REM 오류 발생 시 대기
if errorlevel 1 (
    echo.
    echo 오류가 발생했습니다!
    pause
)

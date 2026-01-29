@echo off
REM Windows 시작 프로그램에 브릿지 등록
REM 관리자 권한으로 실행하세요

echo ========================================
echo MT5 Bridge 자동 시작 설정
echo ========================================
echo.

REM 현재 스크립트의 전체 경로 얻기
set "SCRIPT_PATH=%~dp0run_bridge.bat"
set "SHORTCUT_NAME=Trading-X MT5 Bridge"

REM 시작 프로그램 폴더 경로
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

echo 브릿지 경로: %SCRIPT_PATH%
echo 시작 프로그램 폴더: %STARTUP_FOLDER%
echo.

REM PowerShell을 사용하여 바로가기 생성
powershell -Command "$WS = New-Object -ComObject WScript.Shell; $SC = $WS.CreateShortcut('%STARTUP_FOLDER%\%SHORTCUT_NAME%.lnk'); $SC.TargetPath = '%SCRIPT_PATH%'; $SC.WorkingDirectory = '%~dp0'; $SC.Save()"

if errorlevel 1 (
    echo.
    echo 오류: 바로가기 생성 실패
    echo 관리자 권한으로 실행해주세요.
    pause
    exit /b 1
)

echo.
echo ========================================
echo 설정 완료!
echo ========================================
echo.
echo 다음 Windows 시작 시 자동으로 MT5 Bridge가 실행됩니다.
echo.
echo 자동 시작을 해제하려면:
echo 1. Win+R 키를 누르고
echo 2. shell:startup 입력
echo 3. "%SHORTCUT_NAME%.lnk" 파일 삭제
echo.
pause

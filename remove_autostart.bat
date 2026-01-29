@echo off
REM Windows 시작 프로그램에서 브릿지 제거

echo ========================================
echo MT5 Bridge 자동 시작 제거
echo ========================================
echo.

set "SHORTCUT_NAME=Trading-X MT5 Bridge"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_FOLDER%\%SHORTCUT_NAME%.lnk"

if exist "%SHORTCUT_PATH%" (
    del "%SHORTCUT_PATH%"
    echo 자동 시작이 제거되었습니다.
) else (
    echo 자동 시작 항목을 찾을 수 없습니다.
)

echo.
pause

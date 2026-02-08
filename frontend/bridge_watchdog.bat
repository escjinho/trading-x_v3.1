@echo off
REM MT5 Bridge Watchdog
REM Windows 시작 시 자동 실행: shell:startup 폴더에 이 파일의 바로가기 생성

cd /d C:\MT5Bridge
python bridge_launcher.py

pause

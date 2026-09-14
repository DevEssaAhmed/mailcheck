@echo off
cd /d "%~dp0"
wsl --status >nul 2>&1
if errorlevel 1 (
  echo Install Ubuntu in WSL first: wsl --install -d Ubuntu
  echo Then finish Ubuntu setup and run this file again. See README.md.
  pause
  exit /b 1
)
wsl --cd "%~dp0." --exec python3 setup_reacher.py
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "http://127.0.0.1:8765"
wsl --cd "%~dp0." --exec python3 app.py
pause

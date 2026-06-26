@echo off
echo Starting TAAL Beat Detector on http://localhost:8000

:: Kill anything already on port 8000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " 2^>nul') do (
    echo Killing existing process on port 8000 ^(PID %%a^)
    taskkill /PID %%a /F >nul 2>&1
)

set PATH=%PATH%;%USERPROFILE%\ffmpeg\ffmpeg-master-latest-win64-gpl\bin
cd /d "%~dp0services\beat-detector"
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

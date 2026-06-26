@echo off
echo Starting TAAL Beat Detector on http://localhost:8000
set PATH=%PATH%;%USERPROFILE%\ffmpeg\ffmpeg-master-latest-win64-gpl\bin
cd /d "%~dp0services\beat-detector"
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

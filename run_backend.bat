@echo off
echo Starting Tarot Backend...
call .\venv\Scripts\activate
set PYTHONPATH=%CD%
python backend/main.py
pause




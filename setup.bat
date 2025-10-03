@echo off
echo ================================
echo Tarot App - Setup Script
echo ================================
echo.

echo [1/4] Checking Python virtual environment...
if not exist "venv\Scripts\activate.bat" (
    echo Virtual environment not found. Creating one...
    python -m venv venv
)
call .\venv\Scripts\activate

echo.
echo [2/4] Installing Python dependencies...
pip install -r requirements.txt

echo.
echo [3/4] Creating data directories...
if not exist "backend\data" mkdir backend\data

echo.
echo [4/4] Setting up frontend...
cd frontend
echo Installing Node.js dependencies...
call npm install
cd ..

echo.
echo ================================
echo Setup completed successfully!
echo ================================
echo.
echo Next steps:
echo 1. Copy .env.example to .env and fill in your Gemini API key
echo 2. Run run_backend.bat to start the backend server
echo 3. Run run_frontend.bat to start the frontend server
echo.
pause





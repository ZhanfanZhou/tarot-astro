#!/bin/bash

echo "================================"
echo "Tarot App - Setup Script"
echo "================================"
echo ""

echo "[1/4] Checking Python virtual environment..."
if [ ! -f "venv/bin/activate" ]; then
    echo "Virtual environment not found. Creating one..."
    python3 -m venv venv
fi
source venv/bin/activate

echo ""
echo "[2/4] Installing Python dependencies..."
pip install -r requirements.txt

echo ""
echo "[3/4] Creating data directories..."
mkdir -p backend/data

echo ""
echo "[4/4] Setting up frontend..."
cd frontend
echo "Installing Node.js dependencies..."
npm install
cd ..

echo ""
echo "================================"
echo "Setup completed successfully!"
echo "================================"
echo ""
echo "Next steps:"
echo "1. Copy .env.example to .env and fill in your Gemini API key"
echo "2. Run ./run_backend.sh to start the backend server"
echo "3. Run ./run_frontend.sh to start the frontend server"
echo ""





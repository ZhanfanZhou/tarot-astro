#!/bin/bash
echo "Starting Tarot Backend..."
source venv/bin/activate
export https_proxy="http://127.0.0.1:7890"
export http_proxy="http://127.0.0.1:7890"
python backend/main.py





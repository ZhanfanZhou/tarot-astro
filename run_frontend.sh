#!/bin/bash
echo "Starting Tarot Frontend..."
cd frontend
export https_proxy="http://127.0.0.1:7890"
export http_proxy="http://127.0.0.1:7890"
npm run dev





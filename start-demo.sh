#!/bin/bash

# Pharmacy Voice Agent Demo Startup Script
echo "🏥 Starting Pharmacy Voice Agent Demo..."

# Check if API keys are set
cd server
if [ ! -f .env ]; then
    echo "❌ No .env file found in server directory"
    echo "Please copy server/env.example to server/.env and add your API keys"
    exit 1
fi

# Source environment variables
source .env

# Check API keys
echo "🔑 Checking API keys..."
if [ -z "$DEEPGRAM_API_KEY" ]; then
    echo "❌ DEEPGRAM_API_KEY is missing"
    exit 1
fi
if [ -z "$GOOGLE_API_KEY" ]; then
    echo "❌ GOOGLE_API_KEY is missing"
    exit 1
fi
if [ -z "$ELEVENLABS_API_KEY" ]; then
    echo "❌ ELEVENLABS_API_KEY is missing"
    exit 1
fi

echo "✅ All API keys are set"

# Start backend server
echo "🚀 Starting backend server..."
cd /Users/theo/hophacks-2025-v2/server
source .env && npm run dev &
BACKEND_PID=$!

# Wait for backend to start
sleep 3

# Start frontend server
echo "🌐 Starting frontend server..."
cd /Users/theo/hophacks-2025-v2/web
npm run dev &
FRONTEND_PID=$!

# Wait for both servers to start
sleep 5

echo "✅ Demo is ready!"
echo "📱 Frontend: http://localhost:5173"
echo "🔧 Backend:  http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for user interrupt
trap "echo 'Stopping servers...' && kill $BACKEND_PID $FRONTEND_PID 2>/dev/null && exit 0" INT
wait

#!/bin/bash

# Work With Me - Start WebSocket Server
# Starts the real-time collaboration server

echo "🚀 Work With Me - Starting WebSocket Server"
echo "============================================="
echo ""

# Check if we're in the right directory
if [ ! -d "server" ]; then
    echo "❌ Error: server directory not found"
    echo "Current directory: $(pwd)"
    exit 1
fi

cd server

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    echo "   (This only happens once)"
    echo ""
    npm install
    echo ""
fi

# Check if .env exists in parent
if [ ! -f "../.env" ]; then
    echo "⚠️  Warning: .env file not found"
    echo "   Make sure you have OPENAI_API_KEY set"
    echo ""
fi

echo "🚀 Starting WebSocket Server..."
echo ""

npm start

#!/bin/bash

# Work With Me - Quick Start Script
# Starts both the web app and MCP server

echo "🎨 Work With Me - Starting Services"
echo "===================================="

# Check if we're in the right directory
if [ ! -d "src" ] || [ ! -d "server" ]; then
    echo "❌ Error: Must run from project root (work-with-me/)"
    echo "Current directory: $(pwd)"
    exit 1
fi

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    kill $WEB_PID 2>/dev/null
    kill $SERVER_PID 2>/dev/null
    exit 0
}

trap cleanup INT TERM

# Start web server (from src directory)
echo ""
echo "🌐 Starting web server on http://localhost:8000..."
cd src
python3 -m http.server 8000 &
WEB_PID=$!
cd ..

# Check if server directory exists
if [ -d "server" ]; then
    cd server
    
    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        echo ""
        echo "📦 Installing MCP server dependencies..."
        npm install
    fi
    
    # Start MCP server
    echo ""
    echo "🚀 Starting MCP server on ws://localhost:3001..."
    npm start &
    SERVER_PID=$!
    
    cd ..
else
    echo ""
    echo "⚠️  MCP server not found. Run setup first:"
    echo "   cd server && npm install"
fi

echo ""
echo "✅ Services started!"
echo ""
echo "📱 Open your browser:"
echo "   http://localhost:8000"
echo ""
echo "🔧 Server endpoints:"
echo "   http://localhost:3001/health"
echo "   http://localhost:3001/stats"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Keep script running
wait

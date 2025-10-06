#!/bin/bash

# Work With Me - Simple Start Script
# Starts the web app with automatic port detection

echo "🎨 Work With Me - Starting Web App"
echo "==================================="
echo ""

# Check if we're in the right directory
if [ ! -d "src" ]; then
    echo "❌ Error: Must run from project root (work-with-me/)"
    echo "Current directory: $(pwd)"
    exit 1
fi

# Function to find available port
find_port() {
    for port in 8000 8001 8002 8080 8081 3000; do
        if ! lsof -i :$port >/dev/null 2>&1; then
            echo $port
            return
        fi
    done
    echo "8888"  # fallback
}

# Find available port
PORT=$(find_port)

echo "📍 Starting web server..."
echo "   Port: $PORT"
echo ""

cd src

# Start server
python3 -m http.server $PORT &
SERVER_PID=$!

# Wait a moment for server to start
sleep 1

# Check if server started successfully
if ps -p $SERVER_PID > /dev/null 2>&1; then
    echo "✅ Web server started successfully!"
    echo ""
    echo "🌐 Open in your browser:"
    echo "   http://localhost:$PORT"
    echo ""
    echo "💡 Features available:"
    echo "   ✓ Drawing tools (pen, eraser, fill, line, circle)"
    echo "   ✓ AI chat with GPT-4"
    echo "   ✓ VISION support - AI can see your drawings!"
    echo ""
    echo "🎨 Try asking: 'what am I drawing?'"
    echo ""
    echo "Press Ctrl+C to stop"
    echo ""
    
    # Try to open browser (macOS)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sleep 1
        open "http://localhost:$PORT" 2>/dev/null
    fi
    
    # Wait for Ctrl+C
    wait $SERVER_PID
else
    echo "❌ Failed to start server"
    exit 1
fi

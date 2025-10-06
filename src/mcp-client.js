/** WebSocket Client for Work With Me MCP Server
 * Handles real-time communication with the AI collaboration server
 */

class MCPClient {
    constructor() {
        this.ws = null;
        this.sessionId = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.messageHandlers = new Map();
        this.serverUrl = 'ws://localhost:3001';
    }

    connect(serverUrl = null) {
        if (serverUrl) {
            this.serverUrl = serverUrl;
        }

        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.serverUrl);

                this.ws.onopen = () => {
                    console.log('✅ Connected to MCP Server');
                    this.connected = true;
                    this.reconnectAttempts = 0;
                };

                this.ws.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        this.handleMessage(message);

                        if (message.type === 'connected') {
                            this.sessionId = message.sessionId;
                            resolve(message);
                        }
                    } catch (error) {
                        console.error('Message parsing error:', error);
                    }
                };

                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    reject(new Error(`WebSocket error: ${error.message || 'Connection failed'}`));
                };

                this.ws.onclose = () => {
                    console.log('Disconnected from MCP Server');
                    this.connected = false;
                    this.attemptReconnect();
                };

            } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        setTimeout(() => {
            this.connect();
        }, this.reconnectDelay * this.reconnectAttempts);
    }

    handleMessage(message) {
        const handlers = this.messageHandlers.get(message.type) || [];
        handlers.forEach(handler => handler(message));

        const genericHandlers = this.messageHandlers.get('*') || [];
        genericHandlers.forEach(handler => handler(message));
    }

    on(messageType, handler) {
        if (!this.messageHandlers.has(messageType)) {
            this.messageHandlers.set(messageType, []);
        }
        this.messageHandlers.get(messageType).push(handler);
    }

    off(messageType, handler) {
        if (this.messageHandlers.has(messageType)) {
            const handlers = this.messageHandlers.get(messageType);
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    send(message) {
        if (!this.connected || !this.ws) {
            console.error('Not connected to server');
            return false;
        }

        try {
            this.ws.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('Send error:', error);
            return false;
        }
    }

    updateCanvas(imageDataUrl) {
        return this.send({
            type: 'canvas_update',
            imageData: imageDataUrl
        });
    }

    analyzeCanvas(imageDataUrl, userMessage = null) {
        return this.send({
            type: 'analyze_canvas',
            imageData: imageDataUrl,
            userMessage: userMessage
        });
    }

    sendChatMessage(message, includeCanvas = false, canvasImage = null) {
        return this.send({
            type: 'chat_message',
            content: message,
            includeCanvas: includeCanvas,
            canvasImage: canvasImage
        });
    }

    requestDrawing(shapes) {
        return this.send({
            type: 'request_drawing',
            shapes: shapes
        });
    }

    ping() {
        return this.send({ type: 'ping' });
    }

    disconnect() {
        if (this.ws) {
            this.connected = false;
            this.ws.close();
            this.ws = null;
        }
    }

    isConnected() {
        return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    getSessionId() {
        return this.sessionId;
    }
}

window.MCPClient = MCPClient;

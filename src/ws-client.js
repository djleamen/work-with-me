/** WebSocket Client for Work With Me
 * Handles real-time communication with the AI collaboration server
 */

class WSClient {
    constructor() {
        this.ws = null;
        this.sessionId = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.messageHandlers = new Map();
        this.serverUrl = 'ws://localhost:3001';
        this.status = 'disconnected';
        // Optional callback invoked with ('connecting' | 'connected' | 'disconnected')
        this.onStatusChange = null;
        // FIFO queue of in-flight request/response promises
        this.pending = [];
    }

    _setStatus(status) {
        if (this.status === status) return;
        this.status = status;
        try {
            this.onStatusChange?.(status);
        } catch (error) {
            console.error('Status change handler error:', error);
        }
    }

    connect(serverUrl = null) {
        if (serverUrl) {
            this.serverUrl = serverUrl;
        }

        this._setStatus('connecting');

        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.serverUrl);

                this.ws.onopen = () => {
                    console.log('✅ Connected to WebSocket Server');
                    this.connected = true;
                    this.reconnectAttempts = 0;
                    this._setStatus('connected');
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
                    console.log('Disconnected from WebSocket Server');
                    this.connected = false;
                    this._rejectAllPending(new Error('Connection closed'));
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
            this._setStatus('disconnected');
            return;
        }

        this.reconnectAttempts++;
        this._setStatus('connecting');
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        setTimeout(() => {
            this.connect().catch(() => {
                // Reconnect failures are surfaced via status/onclose; nothing else to do here
            });
        }, this.reconnectDelay * this.reconnectAttempts);
    }

    handleMessage(message) {
        this._resolvePending(message);

        const handlers = this.messageHandlers.get(message.type) || [];
        handlers.forEach(handler => handler(message));

        const genericHandlers = this.messageHandlers.get('*') || [];
        genericHandlers.forEach(handler => handler(message));
    }

    /**
     * Send a payload and resolve with the first response whose type is in
     * expectedTypes. Server `error` messages reject the oldest pending request.
     */
    request(payload, expectedTypes, timeoutMs = 45000) {
        if (!this.isConnected()) {
            return Promise.reject(new Error('Not connected to server'));
        }

        return new Promise((resolve, reject) => {
            const entry = { expectedTypes, resolve, reject, timer: null };
            entry.timer = setTimeout(() => {
                const index = this.pending.indexOf(entry);
                if (index > -1) this.pending.splice(index, 1);
                reject(new Error('Request timed out'));
            }, timeoutMs);
            this.pending.push(entry);

            if (!this.send(payload)) {
                clearTimeout(entry.timer);
                const index = this.pending.indexOf(entry);
                if (index > -1) this.pending.splice(index, 1);
                reject(new Error('Failed to send request'));
            }
        });
    }

    _resolvePending(message) {
        if (!this.pending.length) return;

        let index;
        if (message.type === 'error') {
            index = 0; // reject the oldest in-flight request
        } else {
            index = this.pending.findIndex(entry => entry.expectedTypes.includes(message.type));
        }

        if (index === -1) return;

        const [entry] = this.pending.splice(index, 1);
        clearTimeout(entry.timer);

        if (message.type === 'error') {
            entry.reject(new Error(message.message || 'Server error'));
        } else {
            entry.resolve(message);
        }
    }

    _rejectAllPending(error) {
        const pending = this.pending.splice(0, this.pending.length);
        pending.forEach(entry => {
            clearTimeout(entry.timer);
            entry.reject(error);
        });
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

    /**
     * Send a chat message and resolve with the AI's text response.
     */
    async requestChat(message, includeCanvas = false, canvasImage = null) {
        const response = await this.request({
            type: 'chat_message',
            content: message,
            includeCanvas: includeCanvas,
            canvasImage: includeCanvas ? canvasImage : null
        }, ['ai_response']);
        return response.content;
    }

    /**
     * Request live feedback for the current canvas and resolve with the AI's text.
     */
    async requestAnalysis(imageDataUrl, userMessage = null) {
        const response = await this.request({
            type: 'analyze_canvas',
            imageData: imageDataUrl,
            userMessage: userMessage
        }, ['ai_response']);
        return response.content;
    }

    /**
     * Ask the server to generate drawing commands and resolve with them so the
     * client can render the AI's drawing live on the canvas.
     */
    /**
     * Ask the server to draw. Strokes stream back as `ai_drawing_start` /
     * `ai_draw_command` / `ai_drawing_end` events (handled live by the app).
     * This promise resolves when the drawing finishes:
     *  - { streamed: true, ... } when commands were streamed and already rendered
     *  - { streamed: false, commands } for the non-streaming fallback payload
     */
    async requestAIDrawing(prompt, canvasImage = null) {
        const response = await this.request({
            type: 'request_ai_drawing',
            prompt: prompt,
            canvasImage: canvasImage
        }, ['ai_drawing', 'ai_drawing_end'], 90000);

        if (response.type === 'ai_drawing_end') {
            return {
                streamed: true,
                description: response.description,
                count: response.count || 0
            };
        }

        return {
            streamed: false,
            description: response.description,
            commands: response.commands || [],
            coordinateSystem: response.coordinateSystem
        };
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

window.WSClient = WSClient;

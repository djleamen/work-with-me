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
        // In-flight assistant turns, keyed by turnId
        this.turns = new Map();
        this.turnSeq = 0;
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
                    this._rejectAllTurns(new Error('Connection closed'));
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
        this._routeTurnEvent(message);

        const handlers = this.messageHandlers.get(message.type) || [];
        handlers.forEach(handler => handler(message));

        const genericHandlers = this.messageHandlers.get('*') || [];
        genericHandlers.forEach(handler => handler(message));
    }

    /**
     * Run one assistant turn. `payload` is { content, context, canvasImage }.
     * The reply and each canvas command are delivered through the handlers as
     * the server streams them; the promise resolves when the turn is finished.
     */
    requestAssist(payload, { onReply, onCommand } = {}, timeoutMs = 120000) {
        if (!this.isConnected()) {
            return Promise.reject(new Error('Not connected to server'));
        }

        const turnId = `turn-${++this.turnSeq}`;
        return new Promise((resolve, reject) => {
            const settle = (fn, value) => {
                clearTimeout(timer);
                this.turns.delete(turnId);
                fn(value);
            };
            const timer = setTimeout(() => settle(reject, new Error('Request timed out')), timeoutMs);
            this.turns.set(turnId, {
                onReply,
                onCommand,
                resolve: (value) => settle(resolve, value),
                reject: (error) => settle(reject, error)
            });

            if (!this.send({ type: 'assist', turnId, ...payload })) {
                settle(reject, new Error('Failed to send request'));
            }
        });
    }

    _routeTurnEvent(message) {
        const turn = this.turns.get(message.turnId);
        if (!turn) return;

        switch (message.type) {
            case 'assist_reply':
                turn.onReply?.(message.content);
                break;
            case 'assist_command':
                turn.onCommand?.(message.command);
                break;
            case 'assist_done':
                turn.resolve({ reply: message.reply, count: message.count || 0 });
                break;
            case 'assist_error':
                turn.reject(new Error(message.message || 'Server error'));
                break;
        }
    }

    _rejectAllTurns(error) {
        [...this.turns.values()].forEach(turn => turn.reject(error));
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

window.WSClient = WSClient;

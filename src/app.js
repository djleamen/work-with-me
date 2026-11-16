/**
 * Main application logic for Work With Me
 * Handles canvas drawing, chat interface, and AI interactions
 */

const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');
let isDrawing = false;
let currentTool = 'pen';
let currentColor = '#000000';
let brushSize = 3;
let history = [];
let historyStep = -1;
let shapeStartX, shapeStartY;
let isDrawingShape = false;
let lastUserMessage = '';
let lastAIMessage = '';
let pendingAIDrawOffer = null;

function getCanvasSnapshot(type = 'image/png', quality = 1.0) {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext('2d');
    exportCtx.fillStyle = '#ffffff';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(canvas, 0, 0);

    return exportCanvas.toDataURL(type, quality);
}

function resizeCanvas() {
    const container = canvas.parentElement;
    const rect = container.getBoundingClientRect();
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width = rect.width - 34;
    canvas.height = rect.height - 90; 
    ctx.putImageData(imageData, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function saveState() {
    historyStep++;
    if (historyStep < history.length) {
        history.length = historyStep;
    }
    history.push(getCanvasSnapshot());
}

saveState();

document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTool = btn.dataset.tool;
        
        if (currentTool === 'eraser') {
            canvas.style.cursor = 'grab';
        } else if (currentTool === 'fill') {
            canvas.style.cursor = 'copy';
        } else {
            canvas.style.cursor = 'crosshair';
        }
    });
});

const brushSizeSlider = document.getElementById('brushSize');
const brushSizeValue = document.getElementById('brushSizeValue');
brushSizeSlider.addEventListener('input', (e) => {
    brushSize = e.target.value;
    brushSizeValue.textContent = `${brushSize}px`;
});

const colorPicker = document.getElementById('colorPicker');
colorPicker.addEventListener('input', (e) => {
    currentColor = e.target.value;
});

document.querySelectorAll('.color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        currentColor = color;
        colorPicker.value = color;
    });
});

function startDrawing(e) {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (currentTool === 'fill') {
        floodFill(x, y, currentColor);
        saveState();
        analyzeDrawing();
        return;
    }
    
    if (currentTool === 'line' || currentTool === 'circle') {
        isDrawingShape = true;
        shapeStartX = x;
        shapeStartY = y;
        return;
    }
    
    ctx.beginPath();
    ctx.moveTo(x, y);
    
    if (currentTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = brushSize * 2;
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = brushSize;
    }
}

function draw(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    document.getElementById('cursorPosition').textContent = `X: ${Math.round(x)}, Y: ${Math.round(y)}`;
    
    if (!isDrawing) return;
    
    if (isDrawingShape) {
        return;
    }
    
    ctx.lineTo(x, y);
    ctx.stroke();
}

function stopDrawing(e) {
    if (!isDrawing && !isDrawingShape) return;
    
    if (isDrawingShape) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = brushSize;
        ctx.globalCompositeOperation = 'source-over';
        
        if (currentTool === 'line') {
            ctx.beginPath();
            ctx.moveTo(shapeStartX, shapeStartY);
            ctx.lineTo(x, y);
            ctx.stroke();
        } else if (currentTool === 'circle') {
            const radius = Math.sqrt(Math.pow(x - shapeStartX, 2) + Math.pow(y - shapeStartY, 2));
            ctx.beginPath();
            ctx.arc(shapeStartX, shapeStartY, radius, 0, 2 * Math.PI);
            ctx.stroke();
        }
        
        isDrawingShape = false;
        saveState();
        analyzeDrawing();
        return;
    }
    
    isDrawing = false;
    ctx.closePath();
    saveState();
    
    analyzeDrawing();
}

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', () => {
    if (isDrawing) {
        isDrawing = false;
        ctx.closePath();
        saveState();
        analyzeDrawing();
    }
});

function floodFill(startX, startY, fillColor) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const targetColor = getPixelColor(imageData, startX, startY);
    const fillColorRgb = hexToRgb(fillColor);
    
    if (colorsMatch(targetColor, fillColorRgb)) return;
    
    const pixelsToCheck = [[startX, startY]];
    const visited = new Set();
    
    while (pixelsToCheck.length > 0) {
        const [x, y] = pixelsToCheck.pop();
        const key = `${x},${y}`;
        
        if (visited.has(key)) continue;
        if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) continue;
        
        const currentColor = getPixelColor(imageData, x, y);
        if (!colorsMatch(currentColor, targetColor)) continue;
        
        visited.add(key);
        setPixelColor(imageData, x, y, fillColorRgb);
        
        pixelsToCheck.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    
    ctx.putImageData(imageData, 0, 0);
}

function getPixelColor(imageData, x, y) {
    const index = (y * imageData.width + x) * 4;
    return [
        imageData.data[index],
        imageData.data[index + 1],
        imageData.data[index + 2],
        imageData.data[index + 3]
    ];
}

function setPixelColor(imageData, x, y, color) {
    const index = (y * imageData.width + x) * 4;
    imageData.data[index] = color[0];
    imageData.data[index + 1] = color[1];
    imageData.data[index + 2] = color[2];
    imageData.data[index + 3] = 255;
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
        255
    ] : null;
}

function colorsMatch(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function clearCanvasProgrammatically(message = 'Canvas cleared! Ready for a fresh start. What would you like to create?') {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    saveState();
    pendingAIDrawOffer = null;

    if (message) {
        addAIMessage(message);
    }
}

document.getElementById('clearCanvas').addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the canvas?')) {
        clearCanvasProgrammatically();
    }
});

document.getElementById('undo').addEventListener('click', () => {
    if (historyStep > 0) {
        historyStep--;
        const img = new Image();
        img.src = history[historyStep];
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
        };
    }
});

document.getElementById('saveImage').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `work-with-me-${Date.now()}.png`;
    link.href = getCanvasSnapshot();
    link.click();
    addAIMessage('Image saved! Great work! 🎨');
});

const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendMessage');

function escapeHTML(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function addMessage(content, isUser = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = isUser ? '👤' : '🤖';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    if (typeof content === 'string') {
        contentDiv.innerHTML = escapeHTML(content).replace(/\n/g, '<br>');
    } else {
        contentDiv.appendChild(content);
    }
    
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return messageDiv;
}

function addAIMessage(content) {
    addMessage(content, false);

    if (typeof content === 'string') {
        lastAIMessage = content;
        analyzeAIMessageForDrawOffers(content);
    }
}

function addUserMessage(content) {
    addMessage(content, true);
}

function analyzeAIMessageForDrawOffers(message) {
    const lower = message.toLowerCase();
    const offerPatterns = [
        /would you like me to add/,
        /do you want me to add/,
        /should i add/,
        /want me to add/,
        /would you like me to put/,
        /do you want me to put/,
        /should i put/
    ];

    if (offerPatterns.some(pattern => pattern.test(lower))) {
        const subject = extractCanvasSubject(message);
        pendingAIDrawOffer = {
            subject,
            aiMessage: message,
            createdAt: Date.now()
        };
        return;
    }

    const commitmentPatterns = [
        /i['’]ll add/,
        /i will add/,
        /let me add/,
        /adding it now/,
        /i['’]m adding/,
        /i will put/
    ];

    if (commitmentPatterns.some(pattern => pattern.test(lower))) {
        if (pendingAIDrawOffer && !pendingAIDrawOffer.subject) {
            pendingAIDrawOffer.subject = extractCanvasSubject(message);
        }
    }
}

function extractCanvasSubject(message) {
    const subjectMatch = message.match(/(?:add|put|place)\s+(.*?)\s+(?:onto|to|on)\s+the\s+canvas/i);
    if (subjectMatch?.[1]) {
        return subjectMatch[1].trim();
    }
    return null;
}

function buildDrawPromptFromOffer(offer) {
    if (!offer) {
        return 'Please add the update you just described to the canvas.';
    }
    if (offer.subject) {
        return `Please add ${offer.subject} to the canvas exactly as you described.`;
    }
    return 'Please add the update you just mentioned to the canvas.';
}

let aiEnabled = true;
let aiCanDraw = true;
let drawingTimeout = null;
let aiService = null;
let useDemoMode = false;
let wsClient = null;
let serverWelcomeShown = false;
let activeTurns = 0;
let userTurnSeq = 0;

function isServerAvailable() {
    return Boolean(wsClient?.isConnected?.());
}

function updateConnectionStatus(state) {
    const indicator = document.getElementById('connectionStatus');
    if (!indicator) return;

    const labels = {
        connected: 'Live',
        connecting: 'Connecting…',
        disconnected: 'Offline'
    };
    const normalized = labels[state] ? state : 'disconnected';

    indicator.dataset.state = normalized;
    const text = document.getElementById('connectionStatusText');
    if (text) {
        text.textContent = labels[normalized];
    }
}

function onServerConnected() {
    updateConnectionStatus('connected');

    if (!serverWelcomeShown) {
        serverWelcomeShown = true;
        addAIMessage('🟢 Connected to the real-time server — I\'ll give you live feedback as you draw!');
    }

    // The server holds the API key, so a missing client key no longer blocks AI.
    const modal = document.getElementById('apiKeyModal');
    if (modal?.classList.contains('active') && !localStorage.getItem('openai_api_key')) {
        hideApiKeyModal();
        useDemoMode = false;
    }
}

function initializeRealtime() {
    if (typeof WSClient === 'undefined') {
        console.warn('WSClient unavailable; staying on direct AI / demo mode.');
        updateConnectionStatus('disconnected');
        return;
    }

    wsClient = new WSClient();
    wsClient.onStatusChange = (state) => {
        updateConnectionStatus(state);
        if (state === 'disconnected' && serverWelcomeShown) {
            // Only nudge once we had a working connection that dropped
            console.info('Realtime server disconnected; falling back to direct AI / demo mode.');
        }
    };
    wsClient.on('connected', () => onServerConnected());

    updateConnectionStatus('connecting');
    wsClient.connect().catch(err => {
        console.warn('Realtime server not reachable, using direct AI / demo mode.', err);
        updateConnectionStatus('disconnected');
    });
}

function initializeAI() {
    aiService = new AIService();
    
    const savedApiKey = localStorage.getItem('openai_api_key');
    
    if (savedApiKey) {
        aiService.initialize(savedApiKey).then(() => {
            console.log('AI Service initialized with saved API key');
            addAIMessage('I\'m powered by GPT 4.1! I can understand your drawings and provide intelligent feedback. Start creating!');
        }).catch(err => {
            console.error('Failed to initialize AI:', err);
            showApiKeyModal();
        });
    } else {
        showApiKeyModal();
    }
}

function showApiKeyModal() {
    const modal = document.getElementById('apiKeyModal');
    modal.classList.add('active');
}

function hideApiKeyModal() {
    const modal = document.getElementById('apiKeyModal');
    modal.classList.remove('active');
}

document.getElementById('saveApiKey').addEventListener('click', () => {
    const apiKey = document.getElementById('apiKeyInput').value.trim();
    
    if (!apiKey) {
        alert('Please enter a valid API key');
        return;
    }
    
    if (!apiKey.startsWith('sk-')) {
        alert('OpenAI API keys start with "sk-". Please check your key.');
        return;
    }
    
    localStorage.setItem('openai_api_key', apiKey);
    
    aiService.initialize(apiKey).then(() => {
        hideApiKeyModal();
        addAIMessage('🚀 AI initialized! I\'m powered by GPT-4 and ready to help you create, learn, and draw together!');
        useDemoMode = false;
    }).catch(err => {
        alert('Failed to initialize AI. Please check your API key and try again.');
        console.error(err);
    });
});

document.getElementById('skipApiKey').addEventListener('click', () => {
    hideApiKeyModal();
    useDemoMode = true;
    addAIMessage('📝 Running in demo mode with pre-programmed responses. For the full AI experience, add your OpenAI API key in settings!');
});

document.getElementById('toggleAI').addEventListener('click', () => {
    aiEnabled = !aiEnabled;
    const status = document.getElementById('aiStatus');
    status.textContent = aiEnabled ? 'AI: Active' : 'AI: Paused';
    
    if (aiEnabled) {
        addAIMessage('I\'m back and ready to help! Continue drawing and I\'ll provide feedback.');
    } else {
        addAIMessage('I\'ll stay quiet for now. Click the button again when you want my help!');
    }
});

document.getElementById('aiCollaborate').addEventListener('change', (e) => {
    aiCanDraw = e.target.checked;
    if (aiCanDraw) {
        addAIMessage('Great! I can now draw alongside you to help visualize ideas.');
    } else {
        addAIMessage('Okay, I\'ll just provide verbal guidance without drawing.');
    }
});

// Proactive check-ins: once the user has stopped drawing for a moment, the AI
// looks at the canvas and decides for itself whether a comment is worth making.
const CHECK_IN_IDLE_MS = 4000;
const CHECK_IN_MIN_INK_CHANGE = 300;
const CHECK_IN_NOTE = '[Automatic check-in: the user paused while drawing and has not sent a message.]';

function isAIAvailable() {
    return isServerAvailable() || Boolean(aiService?.isInitialized?.() && !useDemoMode);
}

function analyzeDrawing() {
    if (!aiEnabled) return;
    
    clearTimeout(drawingTimeout);
    drawingTimeout = setTimeout(() => {
        performAnalysis();
    }, isAIAvailable() ? CHECK_IN_IDLE_MS : 800);
}

let lastFeedbackCoverage = 0;
let feedbackCount = 0;
let lastCheckInInk = 0;

/**
 * Count what the user has actually drawn. The canvas starts transparent, so
 * "not background" has to mean visible, non-white pixels.
 */
function measureInk() {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let inkPixels = 0;
    const colorVariety = new Set();

    for (let i = 0; i < pixels.length; i += 4) {
        if (!isBackgroundPixel(pixels, i)) {
            inkPixels++;
            colorVariety.add(`${Math.floor(pixels[i]/50)}-${Math.floor(pixels[i+1]/50)}-${Math.floor(pixels[i+2]/50)}`);
        }
    }

    return {
        inkPixels,
        coverage: (inkPixels / (canvas.width * canvas.height)) * 100,
        colors: colorVariety.size
    };
}

async function performAnalysis() {
    if (!aiEnabled) {
        return;
    }

    const { inkPixels, coverage, colors } = measureInk();

    if (isAIAvailable()) {
        // Don't talk over someone who is mid-stroke, mid-question, or already waiting on a reply.
        const userIsBusy = isDrawing || isDrawingShape || activeTurns > 0 || chatInput.value.trim() !== '';
        if (userIsBusy || Math.abs(inkPixels - lastCheckInInk) < CHECK_IN_MIN_INK_CHANGE) {
            return;
        }
        lastCheckInInk = inkPixels;
        await runAssistTurn(CHECK_IN_NOTE, { checkIn: true });
        return;
    }

    if (Math.abs(coverage - lastFeedbackCoverage) < 2 && feedbackCount > 0) {
        return; // not enough change
    }
    
    lastFeedbackCoverage = coverage;
    feedbackCount++;
    
    if (coverage < 0.5) {
        return; // too early
    }

    performDemoAnalysis(coverage, colors);
}

function performDemoAnalysis(coverage, colors) {
    if (coverage < 3) {
        const messages = [
            'Nice start! I see you\'re sketching something. 🎨',
            'Interesting! What are you planning to create?',
            'Good technique! Your strokes look confident.',
            'I\'m watching! Keep going, this looks promising.',
        ];
        addAIMessage(messages[Math.floor(Math.random() * messages.length)]);
    } else if (coverage < 8) {
        const messages = [
            colors > 2 ? 'Great use of colors! The variety really adds depth.' : 'Looking good! Have you considered adding more colors?',
            'Your composition is taking shape nicely!',
            'I can see your vision coming together! 🖌️',
            'Nice work! The proportions look balanced.',
        ];
        addAIMessage(messages[Math.floor(Math.random() * messages.length)]);
    } else if (coverage < 20) {
        const messages = [
            'This is really coming along! Want me to help with anything specific?',
            colors > 3 ? 'Beautiful color palette! You have a good eye for color harmony.' : 'Your drawing has great structure. Maybe try experimenting with more colors?',
            'Impressive! Are you working on homework or just creating art?',
            'I\'m loving this! The details are really emerging.',
        ];
        addAIMessage(messages[Math.floor(Math.random() * messages.length)]);
    } else if (coverage < 40 && feedbackCount < 8) {
        const messages = [
            'Wow! This is getting detailed. You\'re doing great! 🌟',
            'Your artwork is really filling out beautifully!',
            'I can see you\'re putting a lot of thought into this. Keep it up!',
            'This is looking fantastic! Need any suggestions or help?',
        ];
        addAIMessage(messages[Math.floor(Math.random() * messages.length)]);
    }
}

async function handleSendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;
    
    addUserMessage(message);
    chatInput.value = '';
    lastUserMessage = message;
    const lowerMsg = message.toLowerCase();
    const analysisOnly = isAnalysisOnlyQuery(lowerMsg);

    const eraseIntent = !analysisOnly ? detectEraseIntent(lowerMsg) : null;
    if (eraseIntent?.entireCanvas) {
        clearCanvasProgrammatically('I\'ve cleared the canvas so you can start fresh. What would you like to create next?');
        return;
    }

    // With a real model available it sees the canvas and decides, in a single
    // turn, what to say and what (if anything) to add to the canvas.
    if (isAIAvailable()) {
        await runAssistTurn(message);
        return;
    }

    // Demo mode: keyword-matched canned responses and shapes.
    let autoDrawPrompt = null;
    if (pendingAIDrawOffer) {
        if (isAffirmativeResponse(lowerMsg)) {
            autoDrawPrompt = buildDrawPromptFromOffer(pendingAIDrawOffer);
            pendingAIDrawOffer = null;
        } else if (isNegativeResponse(lowerMsg)) {
            pendingAIDrawOffer = null;
        }
    }
    
    const isExplicitDrawRequest = !analysisOnly && aiCanDraw && shouldTriggerDrawFromMessage(lowerMsg);

    if (!analysisOnly && (isExplicitDrawRequest || autoDrawPrompt)) {
        handleDrawRequest(autoDrawPrompt || message);
        return;
    }

    processUserMessage(message);
}

function isAnalysisOnlyQuery(lowerMessage) {
    const analysisPhrases = [
        'what have i drawn',
        'what\'ve i drawn',
        'what did i draw',
        'what am i drawing',
        'what\'s on my canvas',
        'what is on my canvas',
        'what\'s on the canvas',
        'what is on the canvas',
        'what is on this canvas',
        'what is on my drawing',
        'what have i been drawing',
        'what do you see on my canvas',
        'describe my canvas',
        'describe my drawing'
    ];
    return analysisPhrases.some(phrase => lowerMessage.includes(phrase));
}

function shouldTriggerDrawFromMessage(lowerMessage) {
    const drawPatterns = [
        /\bdraw\b/,
        /\bsketch\b/,
        /\billustrate\b/,
        /\bpaint\b/,
        /\bfill\b/,
        /\bfill\s+in/,
        /\bshade\b/,
        /\bcolor\b/,
        /\badd\s+(?:some\s+)?(?:color|colour)/,
        /\badd\s+.*\b(on|to|onto)\s+the\s+canvas/,
        /\bput\s+.*\b(on|to|onto)\s+the\s+canvas/,
        /\bplace\s+.*\b(on|to|onto)\s+the\s+canvas/,
        /\bmake\s+.*\b(on|to|onto)\s+the\s+canvas/, 
        /\berase\b/,
        /\bremove\b/,
        /\bclear\b/
    ];

    if (drawPatterns.some(pattern => pattern.test(lowerMessage))) {
        return true;
    }

    const phrases = [
        'draw me',
        'draw a',
        'draw the',
        'sketch me',
        'sketch a',
        'sketch the',
        'illustrate a',
        'paint me',
        'paint a',
        'create a drawing of',
        'can you add',
        'please add',
        'could you add',
        'could you make',
        'can you make',
        'can you make it',
        'fill it',
        'fill this',
        'fill that',
        'make it bigger',
        'make it smaller',
        'adjust it',
        'move it',
        'erase it',
        'erase that',
        'clear it',
        'clean it up',
        'fix it',
        'touch it up',
        'refine it',
        'polish it',
        'can you help with',
        'finish it',
        'finish the',
        'can you complete'
    ];

    return phrases.some(phrase => lowerMessage.includes(phrase));
}

function isAffirmativeResponse(lowerMessage) {
    const normalized = lowerMessage.trim();
    if (!normalized) return false;
    const sanitized = normalized.replace(/[!.?]+$/, '');
    const affirmations = [
        'yes',
        'yes!',
        'yeah',
        'yep',
        'sure',
        'sure thing',
        'absolutely',
        'of course',
        'definitely',
        'please do',
        'please',
        'go ahead',
        'do it',
        'ok',
        'okay',
        'sounds good',
        'that\'d be great',
        'that would be great',
        'please add it',
        'please add that'
    ];

    return affirmations.some(phrase => sanitized === phrase || sanitized.startsWith(`${phrase} `));
}

function isNegativeResponse(lowerMessage) {
    const normalized = lowerMessage.trim();
    if (!normalized) return false;
    const sanitized = normalized.replace(/[!.?]+$/, '');
    const negatives = [
        'no',
        'no thanks',
        'not yet',
        'maybe later',
        'not right now',
        'don\'t', 
        'do not',
        'don\'t add',
        'no thank you',
        'please don\'t'
    ];

    return negatives.some(phrase => sanitized === phrase || sanitized.startsWith(`${phrase} `));
}

function detectEraseIntent(lowerMessage) {
    const compact = lowerMessage.replace(/\s+/g, ' ').trim();
    if (!compact) return null;

    const verbs = ['erase', 'clear', 'wipe', 'remove', 'reset'];
    const universalTargets = ['everything', 'all', 'all of it', 'all of this', 'all of that'];
    const canvasTargets = ['my canvas', 'the canvas', 'canvas', 'drawing'];
    const politeTriggers = ['can you', 'could you', 'would you', 'will you', 'please', 'help me', 'need you to'];

    const containsVerb = verb => compact.includes(verb);

    if (verbs.some(verb => compact.startsWith(`${verb} `))) {
        if (universalTargets.some(target => compact.includes(target)) || canvasTargets.some(target => compact.includes(target))) {
            return { entireCanvas: true };
        }
    }

    if (verbs.some(containsVerb)) {
        if (universalTargets.some(target => compact.includes(target)) || canvasTargets.some(target => compact.includes(target))) {
            if (politeTriggers.some(trigger => compact.includes(trigger))) {
                return { entireCanvas: true };
            }
        }
    }

    const directCombos = [
        'wipe it clean',
        'reset the canvas',
        'reset my canvas',
        'clear my board',
        'clear the board'
    ];

    if (directCombos.some(phrase => compact.includes(phrase))) {
        return { entireCanvas: true };
    }

    return null;
}

sendButton.addEventListener('click', handleSendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleSendMessage();
    }
});

function processUserMessage(message) {
    const lowerMessage = message.toLowerCase();
    
    setTimeout(() => {
        if (lowerMessage.includes('math') || lowerMessage.includes('equation') || lowerMessage.includes('solve')) {
            handleMathRequest(message);
        } else if (lowerMessage.includes('help') || lowerMessage.includes('how')) {
            handleHelpRequest(message);
        } else if ((lowerMessage.includes('draw') || lowerMessage.includes('show') || lowerMessage.includes('make')) && aiCanDraw) {
            handleDrawRequest(message);
        } else if (lowerMessage.includes('color') || lowerMessage.includes('colour')) {
            handleColorAdvice();
        } else if (lowerMessage.includes('improve') || lowerMessage.includes('better') || lowerMessage.includes('tip')) {
            handleImprovementAdvice();
        } else if (lowerMessage.includes('what') && (lowerMessage.includes('drew') || lowerMessage.includes('draw'))) {
            analyzeCurrentDrawing();
        } else {
            handleGeneralQuery(message);
        }
    }, 300);
}

function analyzeCurrentDrawing() {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    let drawnPixels = 0;
    let colorVariety = new Set();
    
    for (let i = 0; i < pixels.length; i += 4) {
        if (!isBackgroundPixel(pixels, i)) {
            drawnPixels++;
            const colorKey = `${Math.floor(pixels[i]/50)}-${Math.floor(pixels[i+1]/50)}-${Math.floor(pixels[i+2]/50)}`;
            colorVariety.add(colorKey);
        }
    }
    
    const coverage = (drawnPixels / (canvas.width * canvas.height)) * 100;
    const colors = colorVariety.size;
    
    if (coverage < 0.5) {
        addAIMessage('I don\'t see much on the canvas yet! Start drawing and I\'ll help you analyze it. 🎨');
    } else {
        let analysis = 'Let me analyze your drawing! 🔍\n\n';
        
        if (coverage < 5) {
            analysis += '• You have a light sketch started\n';
        } else if (coverage < 15) {
            analysis += '• Your drawing is taking shape nicely\n';
        } else if (coverage < 30) {
            analysis += '• You have a substantial piece developing\n';
        } else {
            analysis += '• This is a detailed, well-filled composition\n';
        }
        
        if (colors === 1) {
            analysis += '• Using a single color - great for focused studies\n';
        } else if (colors === 2) {
            analysis += '• Using 2 colors - nice minimal palette\n';
        } else if (colors <= 4) {
            analysis += '• Using ' + colors + ' colors - good variety without overwhelming\n';
        } else {
            analysis += '• Using ' + colors + ' colors - vibrant and diverse!\n';
        }
        
        analysis += '\nKeep going, or ask me for specific help! 🌟';
        addAIMessage(analysis);
    }
}

function handleMathRequest(message) {
    addAIMessage(`I can help with math! Here are some things I can do:
    
    • Solve equations step by step
    • Draw graphs and diagrams
    • Visualize geometric concepts
    • Show working for calculations
    
    Try drawing the equation on the canvas, and I'll help you solve it! For example:
    - Draw "2x + 5 = 15" and I'll guide you through solving it
    - Sketch a triangle and I can help with angles and sides
    - Draw a graph and I'll help analyze it`);
    
    if (aiCanDraw) {
        demonstrateMathExample();
    }
}

function handleHelpRequest(message) {
    addAIMessage(`Here's how to use the app:
    
    **Tools:**
    • Pen - Draw freehand lines
    • Eraser - Remove parts of your drawing
    • Fill - Fill enclosed areas with color
    • Line - Draw straight lines
    • Circle - Draw circles
    
    **Tips:**
    • Adjust brush size for different effects
    • Use preset colors for quick access
    • I'm watching your canvas and will offer real-time feedback
    • Ask me to draw something and I can demonstrate
    
    What would you like to create?`);
}

function handleDrawRequest(message) {
    const lowerMsg = message.toLowerCase();
    addAIMessage('I\'d love to draw with you! Let me add something to the canvas...');
    
    setTimeout(() => {
        drawAIShapeFromMessage(lowerMsg);
    }, 800);
}

function drawAIShapeFromMessage(lowerMsg) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    if (lowerMsg.includes('star')) {
        drawStar(centerX, centerY, 5, 50, 25, '#FFD700');
        addAIMessage('I drew a star! ⭐ Now it\'s your turn. Try adding to it or create something new!');
    } else if (lowerMsg.includes('circle') || lowerMsg.includes('round')) {
        drawCircleShape(centerX, centerY, 60, currentColor);
        addAIMessage('Here\'s a circle! Try adding details to it or draw around it! 🔵');
    } else if (lowerMsg.includes('square') || lowerMsg.includes('box')) {
        drawSquare(centerX - 50, centerY - 50, 100, currentColor);
        addAIMessage('I drew a square! Maybe turn it into a house or robot? 🏠');
    } else if (lowerMsg.includes('heart')) {
        drawHeart(centerX, centerY, 60, '#FF6B9D');
        addAIMessage('Here\'s a heart for you! ❤️ Feel free to decorate it!');
    } else if (lowerMsg.includes('triangle')) {
        drawTriangle(centerX, centerY - 40, 80, currentColor);
        addAIMessage('Triangle drawn! 🔺 Great for geometry or creative designs!');
    } else if (lowerMsg.includes('flower')) {
        drawFlower(centerX, centerY, 40, '#FF69B4', '#FFD700');
        addAIMessage('A flower for you! 🌸 Try adding a stem and leaves!');
    } else if (lowerMsg.includes('smiley') || lowerMsg.includes('face')) {
        drawSmiley(centerX, centerY, 50, '#FFD700');
        addAIMessage('Here\'s a smiley face! 😊 Spread some joy!');
    } else {
        const shapes = ['star', 'circle', 'heart', 'flower', 'smiley'];
        const randomShape = shapes[Math.floor(Math.random() * shapes.length)];
        drawAIShape(randomShape);
    }
    
    saveState();
}

function drawAIShape(shapeName) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    switch(shapeName) {
        case 'star':
            drawStar(centerX, centerY, 5, 50, 25, '#FFD700');
            break;
        case 'circle':
            drawCircleShape(centerX, centerY, 60, currentColor);
            break;
        case 'heart':
            drawHeart(centerX, centerY, 60, '#FF6B9D');
            break;
        case 'square':
            drawSquare(centerX - 50, centerY - 50, 100, currentColor);
            break;
        case 'triangle':
            drawTriangle(centerX, centerY - 40, 80, currentColor);
            break;
        case 'flower':
            drawFlower(centerX, centerY, 40, '#FF69B4', '#FFD700');
            break;
        case 'smiley':
            drawSmiley(centerX, centerY, 50, '#FFD700');
            break;
    }
    
    saveState();
}

function handleColorAdvice() {
    addAIMessage(`Here are some color theory tips:
    
    • **Complementary colors** (opposite on color wheel) create vibrant contrast
    • **Analogous colors** (next to each other) create harmony
    • Use lighter colors for highlights
    • Darker colors work well for shadows and depth
    
    Current color: ${currentColor}
    
    Try experimenting with the color picker or preset colors!`);
}

function handleImprovementAdvice() {
    const tips = [
        '**Composition tip:** Try using the rule of thirds - divide your canvas into 9 sections and place focal points at intersections.',
        
        '**Technique tip:** Vary your brush sizes to create depth. Use larger brushes for background and smaller ones for details.',
        
        '**Color tip:** Start with a light sketch, then gradually build up darker colors for better control.',
        
        '**Practice tip:** Try drawing basic shapes first (circles, squares, triangles) to warm up your hand.',
    ];
    
    addAIMessage(tips[Math.floor(Math.random() * tips.length)]);
}

function handleGeneralQuery(message) {
    const responses = [
        'That\'s interesting! Tell me more about what you\'d like to create.',
        'I\'m here to help! Would you like some drawing tips or shall we work on something specific?',
        'Great question! Feel free to start drawing and I\'ll provide feedback as you go.',
        'I\'m analyzing your canvas. What would you like to focus on?',
    ];
    
    addAIMessage(responses[Math.floor(Math.random() * responses.length)]);
}

function drawStar(cx, cy, spikes, outerRadius, innerRadius, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;
    
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
        x = cx + Math.cos(rot) * outerRadius;
        y = cy + Math.sin(rot) * outerRadius;
        ctx.lineTo(x, y);
        rot += step;
        
        x = cx + Math.cos(rot) * innerRadius;
        y = cy + Math.sin(rot) * innerRadius;
        ctx.lineTo(x, y);
        rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
}

function drawCircleShape(cx, cy, radius, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color + '40';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fill();
    ctx.restore();
}

function drawSquare(x, y, size, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color + '40';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, size, size);
    ctx.fillRect(x, y, size, size);
    ctx.restore();
}

function drawHeart(cx, cy, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    const topCurveHeight = size * 0.3;
    ctx.moveTo(cx, cy + topCurveHeight);
    
    ctx.bezierCurveTo(
        cx, cy, 
        cx - size / 2, cy, 
        cx - size / 2, cy + topCurveHeight
    );
    ctx.bezierCurveTo(
        cx - size / 2, cy + (size + topCurveHeight) / 2, 
        cx, cy + (size + topCurveHeight) / 1.2, 
        cx, cy + size
    );
    
    ctx.bezierCurveTo(
        cx, cy + (size + topCurveHeight) / 1.2,
        cx + size / 2, cy + (size + topCurveHeight) / 2,
        cx + size / 2, cy + topCurveHeight
    );
    ctx.bezierCurveTo(
        cx + size / 2, cy,
        cx, cy,
        cx, cy + topCurveHeight
    );
    
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function drawTriangle(cx, cy, size, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color + '40';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - size / 2, cy + size);
    ctx.lineTo(cx + size / 2, cy + size);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
}

function drawFlower(cx, cy, petalSize, petalColor, centerColor) {
    ctx.save();

    ctx.fillStyle = petalColor;
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI * 2 * i) / 6;
        const x = cx + Math.cos(angle) * petalSize * 0.8;
        const y = cy + Math.sin(angle) * petalSize * 0.8;
        
        ctx.beginPath();
        ctx.arc(x, y, petalSize / 2, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = centerColor;
    ctx.beginPath();
    ctx.arc(cx, cy, petalSize / 2.5, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
}

function drawSmiley(cx, cy, radius, color) {
    ctx.save();
    
    ctx.fillStyle = color;
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(cx - radius / 3, cy - radius / 4, radius / 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + radius / 3, cy - radius / 4, radius / 8, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius / 2, 0, Math.PI, false);
    ctx.stroke();
    
    ctx.restore();
}

function demonstrateMathExample() {
    setTimeout(() => {
        const startX = 100;
        const startY = 100;
        
        ctx.save();
        ctx.font = '24px Arial';
        ctx.fillStyle = '#667eea';
        ctx.fillText('Example: 2x + 5 = 15', startX, startY);
        
        ctx.font = '18px Arial';
        ctx.fillStyle = '#333';
        ctx.fillText('Step 1: 2x = 15 - 5', startX + 20, startY + 40);
        ctx.fillText('Step 2: 2x = 10', startX + 20, startY + 70);
        ctx.fillText('Step 3: x = 5', startX + 20, startY + 100);
        
        ctx.strokeStyle = '#00FF00';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(startX + 200, startY + 90);
        ctx.lineTo(startX + 210, startY + 100);
        ctx.lineTo(startX + 230, startY + 70);
        ctx.stroke();
        
        ctx.restore();
        saveState();
        
        addAIMessage('See how I solved it step by step? Draw your own equation and I\'ll help you solve it!');
    }, 500);
}

document.getElementById('toggleChat').addEventListener('click', function() {
    const chatMessages = document.getElementById('chatMessages');
    const inputContainer = document.querySelector('.chat-input-container');
    
    if (chatMessages.style.display === 'none') {
        chatMessages.style.display = 'flex';
        inputContainer.style.display = 'flex';
        this.textContent = '−';
    } else {
        chatMessages.style.display = 'none';
        inputContainer.style.display = 'none';
        this.textContent = '+';
    }
});

// Canned tips for demo mode only; with a real model connected they would just be noise.
setInterval(() => {
    if (!aiEnabled || isAIAvailable()) return;
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    let drawnPixels = 0;
    
    for (let i = 0; i < pixels.length; i += 4) {
        if (!isBackgroundPixel(pixels, i)) {
            drawnPixels++;
        }
    }
    
    if (drawnPixels > 1000 && Math.random() < 0.15) {
        const messages = [
            '💡 Tip: Try varying your brush sizes for more dynamic artwork!',
            '🎨 Looking creative! Want me to suggest some color combinations?',
            '✨ Your art is developing nicely! Need help with anything?',
            '🖌️ Pro tip: Lighter colors first, then add darker details!',
            '🌟 You\'re doing great! Want me to draw something to inspire you?',
            '🎯 Need help with proportions or perspective? Just ask!',
        ];
        
        if (Math.random() < 0.4) {
            addAIMessage(messages[Math.floor(Math.random() * messages.length)]);
        }
    }
}, 45000);

function resolveCoordinate(value, axis, isRelative = false) {
    const size = axis === 'x' ? canvas.width : canvas.height;
    const center = size / 2;
    if (typeof value === 'string' && value.trim().endsWith('%')) {
        const percentage = Number(value.trim().slice(0, -1));
        if (Number.isFinite(percentage)) {
            return Math.min(size, Math.max(0, (percentage / 100) * size));
        }
    }

    let num = Number(value);

    if (!Number.isFinite(num)) {
        return center;
    }

    if (isRelative) {
        return center + num;
    }

    if (num >= 0 && num <= size) {
        return num;
    }

    if (num >= -center && num <= center) {
        return center + num;
    }

    if (num >= 0 && num <= 400) {
        return (num / 400) * size;
    }

    if (num < 0) {
        return Math.max(0, center + num);
    }

    return Math.min(size, Math.max(0, num));
}

function normalizeLength(value, axisSize) {
    if (typeof value === 'string' && value.trim().endsWith('%')) {
        const percentage = Number(value.trim().slice(0, -1));
        if (Number.isFinite(percentage)) {
            return Math.min(axisSize, Math.max(0, (percentage / 100) * axisSize));
        }
    }

    let num = Number(value);
    if (!Number.isFinite(num)) {
        return axisSize * 0.1;
    }

    num = Math.abs(num);
    if (num <= axisSize) {
        return num;
    }

    if (num <= 400) {
        return (num / 400) * axisSize;
    }

    return Math.min(axisSize, num);
}

function shouldSkipLargeFillRect(width, height) {
    if (width <= 0 || height <= 0) {
        return false;
    }
    const clampedWidth = Math.min(canvas.width, Math.abs(width));
    const clampedHeight = Math.min(canvas.height, Math.abs(height));
    const area = clampedWidth * clampedHeight;
    const canvasArea = canvas.width * canvas.height;
    return area > canvasArea * 0.6;
}

function isBackgroundPixel(data, index) {
    const alpha = data[index + 3];
    if (alpha < 10) {
        return true;
    }

    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];

    return r > 245 && g > 245 && b > 245;
}

function computeWeightedContentCenter(imageData, targetX, targetY, radius) {
    const { data, width, height } = imageData;
    const searchRadius = Math.min(Math.max(radius, 30), Math.max(width, height));
    const radiusInt = Math.round(searchRadius);
    const sampleStep = Math.max(1, Math.floor(searchRadius / 24));

    let totalWeight = 0;
    let sumX = 0;
    let sumY = 0;
    let nonBackgroundSamples = 0;

    for (let dy = -radiusInt; dy <= radiusInt; dy += sampleStep) {
        const y = Math.round(targetY + dy);
        if (y < 0 || y >= height) continue;

        for (let dx = -radiusInt; dx <= radiusInt; dx += sampleStep) {
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared > radiusInt * radiusInt) continue;

            const x = Math.round(targetX + dx);
            if (x < 0 || x >= width) continue;

            const index = (y * width + x) * 4;
            if (isBackgroundPixel(data, index)) continue;

            nonBackgroundSamples++;
            const distance = Math.sqrt(distanceSquared);
            const weight = 1 / (1 + distance);

            totalWeight += weight;
            sumX += x * weight;
            sumY += y * weight;
        }
    }

    if (totalWeight === 0) {
        return null;
    }

    return {
        x: sumX / totalWeight,
        y: sumY / totalWeight,
        weight: totalWeight,
        samples: nonBackgroundSamples
    };
}

function snapPointToExistingContent(imageData, targetX, targetY, radius, options = {}) {
    const searchRadius = options.searchRadius || (radius ? radius * 1.5 + 20 : 80);
    const centroid = computeWeightedContentCenter(imageData, targetX, targetY, searchRadius);

    if (!centroid) {
        return null;
    }

    const minSamples = options.minSamples || 25;
    if (centroid.samples < minSamples) {
        return null;
    }

    const dx = centroid.x - targetX;
    const dy = centroid.y - targetY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxShift = options.maxShift || Math.max(40, searchRadius * 0.75);

    if (distance > maxShift) {
        const ratio = maxShift / distance;
        return {
            x: targetX + dx * ratio,
            y: targetY + dy * ratio,
            shifted: distance,
            clamped: true
        };
    }

    return {
        x: centroid.x,
        y: centroid.y,
        shifted: distance,
        samples: centroid.samples
    };
}

/**
 * Scan the canvas for the bounding box of everything that isn't background.
 * Sampled for speed. Used to keep AI additions out of the user's artwork.
 */
function getContentBounds(sampleStep = 4) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let found = false;

    for (let y = 0; y < height; y += sampleStep) {
        for (let x = 0; x < width; x += sampleStep) {
            const index = (y * width + x) * 4;
            const alpha = data[index + 3];
            if (alpha < 10) continue;
            const r = data[index];
            const g = data[index + 1];
            const b = data[index + 2];
            if (r > 245 && g > 245 && b > 245) continue;

            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }

    if (!found) {
        return { hasContent: false, width, height };
    }
    return { hasContent: true, minX, minY, maxX, maxY, width, height };
}

/**
 * Render a single AI draw command onto the canvas. `turn` carries what the
 * canvas looked like before the AI started, so text can avoid the user's marks.
 */
function renderDrawCommand(cmd, turn) {
    switch (cmd.action) {
        case 'path':
            drawAIPath(cmd, false);
            break;
        case 'circle':
            drawAICircle(cmd, false);
            break;
        case 'rect':
            drawAIRect(cmd, false);
            break;
        case 'text':
            drawAIText(cmd, turn);
            break;
        case 'line':
            drawAILine(cmd, false);
            break;
        default:
            console.warn('Unknown drawing action:', cmd.action);
    }
}

const AI_GRID_STEP = 50;

/**
 * The snapshot the model sees: the canvas on white, over a faint labelled
 * coordinate grid. The grid is only in this copy, never on the real canvas.
 * It lets the model read off where things are and how big the handwriting is,
 * so what it adds lands where it belongs.
 */
function getSnapshotForAI() {
    const snapshot = document.createElement('canvas');
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    const g = snapshot.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, snapshot.width, snapshot.height);

    g.lineWidth = 1;
    g.font = '10px sans-serif';
    g.textBaseline = 'top';
    g.fillStyle = 'rgba(40, 90, 220, 0.85)';
    const gridLine = (x1, y1, x2, y2, major) => {
        g.strokeStyle = major ? 'rgba(60, 120, 255, 0.32)' : 'rgba(60, 120, 255, 0.14)';
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
    };
    for (let x = AI_GRID_STEP; x < snapshot.width; x += AI_GRID_STEP) {
        const major = x % (AI_GRID_STEP * 2) === 0;
        gridLine(x + 0.5, 0, x + 0.5, snapshot.height, major);
        if (major) g.fillText(String(x), x + 3, 2);
    }
    for (let y = AI_GRID_STEP; y < snapshot.height; y += AI_GRID_STEP) {
        const major = y % (AI_GRID_STEP * 2) === 0;
        gridLine(0, y + 0.5, snapshot.width, y + 0.5, major);
        if (major) g.fillText(String(y), 2, y + 3);
    }

    g.drawImage(canvas, 0, 0);
    return snapshot.toDataURL('image/png');
}

function describeCanvasForAI(canDraw) {
    const bounds = getContentBounds();
    const facts = [`The canvas is ${canvas.width}x${canvas.height}px.`];
    facts.push(bounds.hasContent
        ? `The existing marks span x ${bounds.minX}-${bounds.maxX} and y ${bounds.minY}-${bounds.maxY}.`
        : 'It is currently empty.');
    facts.push(`The user's pen is ${currentColor}, ${brushSize}px wide.`);
    if (!canDraw) {
        facts.push('AI drawing is turned off for this turn.');
    }
    return facts.join(' ');
}

/**
 * One AI turn: send the user's words (or a check-in note) with a snapshot of
 * the canvas, show the reply in chat, and render canvas commands as they
 * arrive. Goes through the realtime server when connected, otherwise straight
 * to OpenAI with the key saved in this browser.
 */
async function runAssistTurn(content, { checkIn = false } = {}) {
    if (!checkIn) userTurnSeq++;
    const startedAt = userTurnSeq;
    // A check-in overtaken by a real message is dropped rather than talking over it.
    const isStale = () => checkIn && startedAt !== userTurnSeq;

    const turn = {
        canDraw: aiCanDraw && !checkIn,
        ink: ctx.getImageData(0, 0, canvas.width, canvas.height),
        placedText: [],
        drawn: 0,
        replied: false
    };
    const payload = {
        content,
        context: describeCanvasForAI(turn.canDraw),
        canvasImage: getSnapshotForAI()
    };
    const thinking = checkIn ? null : addMessage('…', false);
    const handlers = {
        onReply: (text) => {
            if (isStale()) return;
            thinking?.remove();
            turn.replied = true;
            addAIMessage(text);
        },
        onCommand: (cmd) => {
            if (isStale() || !turn.canDraw || !cmd || typeof cmd !== 'object') return;
            try {
                ctx.save();
                ctx.globalCompositeOperation = 'source-over';
                renderDrawCommand(cmd, turn);
                turn.drawn++;
            } catch (error) {
                console.error('Error rendering AI command:', error, cmd);
            } finally {
                ctx.restore();
            }
        }
    };

    activeTurns++;
    try {
        let failure = null;

        if (isServerAvailable()) {
            try {
                await wsClient.requestAssist(payload, handlers);
                return;
            } catch (error) {
                failure = error;
            }
        }

        // Only retry directly if the server produced nothing, so nothing is drawn twice.
        if (!turn.replied && turn.drawn === 0 && aiService?.isInitialized?.() && !useDemoMode) {
            try {
                await aiService.assist(payload, handlers);
                return;
            } catch (error) {
                failure = error;
            }
        }

        console.error('AI turn failed:', failure);
        if (!checkIn) {
            addAIMessage('⚠️ I couldn\'t reach the AI just now. Check that the server is running (or your API key) and try again.');
        }
    } finally {
        activeTurns--;
        thinking?.remove();
        if (turn.drawn > 0) {
            saveState();
        }
        if (!checkIn) {
            // The AI has just seen (and maybe added to) the canvas; no need to check in on it again.
            lastCheckInInk = measureInk().inkPixels;
        }
    }
}

function boxTouchesInk(ink, x, y, w, h) {
    // Leave a readable gap beside neighbouring marks (about a quarter of the
    // text height), but allow lines of writing to sit close above and below.
    const padX = Math.max(4, h * 0.25);
    const padY = 4;
    const x0 = Math.max(0, Math.floor(x - padX));
    const x1 = Math.min(ink.width, Math.ceil(x + w + padX));
    const y0 = Math.max(0, Math.floor(y - padY));
    const y1 = Math.min(ink.height, Math.ceil(y + h + padY));
    let hits = 0;

    for (let py = y0; py < y1; py += 2) {
        for (let px = x0; px < x1; px += 2) {
            if (!isBackgroundPixel(ink.data, (py * ink.width + px) * 4) && ++hits > 2) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Keep a text box where the model put it if that spot is clear; otherwise
 * slide it to the nearest clear spot, preferring to stay on the same line.
 * "Clear" means off the user's marks and off text already placed this turn.
 */
function findClearSpot(box, turn) {
    const margin = 8;
    const maxX = Math.max(margin, canvas.width - margin - box.w);
    const maxY = Math.max(margin, canvas.height - margin - box.h);
    const clamp = (x, y) => ({
        x: Math.min(Math.max(margin, x), maxX),
        y: Math.min(Math.max(margin, y), maxY)
    });
    const start = clamp(box.x, box.y);
    if (!turn) return start;

    const isClear = ({ x, y }) => !boxTouchesInk(turn.ink, x, y, box.w, box.h)
        && !turn.placedText.some(p => x < p.x + p.w && p.x < x + box.w && y < p.y + p.h && p.y < y + box.h);

    if (isClear(start)) return start;

    const reach = Math.max(canvas.width, canvas.height);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        for (let distance = 10; distance <= reach; distance += 10) {
            const candidate = clamp(start.x + dx * distance, start.y + dy * distance);
            if (isClear(candidate)) return candidate;
        }
    }
    return start;
}

function drawAIPath(cmd, isRelative) {
    const useRelative = isRelative || cmd.relative === true || cmd.coordinateSystem === 'relative';
    if (!cmd.points || cmd.points.length < 2) return;

    ctx.strokeStyle = cmd.color || '#000000';
    ctx.fillStyle = cmd.color || '#000000';
    ctx.lineWidth = cmd.width || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let resolvedPoints = cmd.points.map(pt => ([
        resolveCoordinate(pt[0], 'x', useRelative),
        resolveCoordinate(pt[1], 'y', useRelative)
    ]));

    let minX = resolvedPoints[0][0];
    let maxX = resolvedPoints[0][0];
    let minY = resolvedPoints[0][1];
    let maxY = resolvedPoints[0][1];
    let sumX = 0;
    let sumY = 0;

    for (const [x, y] of resolvedPoints) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        sumX += x;
        sumY += y;
    }

    let centroidX = sumX / resolvedPoints.length;
    let centroidY = sumY / resolvedPoints.length;

    const shouldSnap = cmd.snapToExisting === true;

    if (shouldSnap) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const snappedCenter = snapPointToExistingContent(
            imageData,
            centroidX,
            centroidY,
            Math.max(maxX - minX, maxY - minY),
            {
                minSamples: cmd.minSamples || 20,
                maxShift: cmd.maxShift || Math.max(Math.max(maxX - minX, maxY - minY) * 1.25, 50)
            }
        );

        if (snappedCenter) {
            const shiftX = snappedCenter.x - centroidX;
            const shiftY = snappedCenter.y - centroidY;
            resolvedPoints = resolvedPoints.map(([x, y]) => [x + shiftX, y + shiftY]);

            minX += shiftX;
            maxX += shiftX;
            minY += shiftY;
            maxY += shiftY;
        }
    }

    ctx.beginPath();
    const [startX, startY] = resolvedPoints[0];
    ctx.moveTo(startX, startY);

    for (let i = 1; i < resolvedPoints.length; i++) {
        const [x, y] = resolvedPoints[i];
        ctx.lineTo(x, y);
    }

    if (cmd.fill && resolvedPoints.length > 2 && !shouldSkipLargeFillRect(maxX - minX, maxY - minY)) {
        ctx.closePath();
        ctx.fill();
    }
    ctx.stroke();
}

function drawAICircle(cmd, isRelative) {
    const useRelative = isRelative || cmd.relative === true || cmd.coordinateSystem === 'relative';
    ctx.strokeStyle = cmd.color || '#000000';
    ctx.fillStyle = cmd.color || '#000000';
    ctx.lineWidth = cmd.width || 3;

    ctx.beginPath();
    const radius = normalizeLength(cmd.radius || 30, Math.min(canvas.width, canvas.height));
    let cx = resolveCoordinate(cmd.x || 0, 'x', useRelative);
    let cy = resolveCoordinate(cmd.y || 0, 'y', useRelative);

    const shouldSnap = cmd.snapToExisting === true;

    if (shouldSnap) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const snappedCenter = snapPointToExistingContent(imageData, cx, cy, radius, {
            minSamples: cmd.minSamples || 30,
            maxShift: cmd.maxShift || Math.max(radius * 1.5, 60)
        });

        if (snappedCenter) {
            cx = snappedCenter.x;
            cy = snappedCenter.y;
        }
    }

    cx = Math.min(Math.max(radius, cx), canvas.width - radius);
    cy = Math.min(Math.max(radius, cy), canvas.height - radius);

    ctx.arc(
        cx,
        cy,
        radius,
        0,
        2 * Math.PI
    );
    
    if (cmd.fill) {
        ctx.fill();
    }
    ctx.stroke();
}

function drawAIRect(cmd, isRelative) {
    const useRelative = isRelative || cmd.relative === true || cmd.coordinateSystem === 'relative';
    ctx.strokeStyle = cmd.color || '#000000';
    ctx.fillStyle = cmd.color || '#000000';
    // "width" is the rectangle's width, so the outline thickness has its own field.
    ctx.lineWidth = cmd.lineWidth || 3;

    const w = normalizeLength(cmd.width || 50, canvas.width);
    const h = normalizeLength(cmd.height || 50, canvas.height);
    let x = resolveCoordinate(cmd.x || 0, 'x', useRelative);
    let y = resolveCoordinate(cmd.y || 0, 'y', useRelative);

    const shouldSnap = cmd.snapToExisting === true;

    if (shouldSnap) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const snappedCenter = snapPointToExistingContent(imageData, x + w / 2, y + h / 2, Math.max(w, h), {
            minSamples: cmd.minSamples || 30,
            maxShift: cmd.maxShift || Math.max(Math.max(w, h) * 1.2, 60)
        });

        if (snappedCenter) {
            x = snappedCenter.x - w / 2;
            y = snappedCenter.y - h / 2;
        }
    }

    if (w >= canvas.width) {
        x = 0;
    } else {
        x = Math.min(Math.max(0, x), canvas.width - w);
    }

    if (h >= canvas.height) {
        y = 0;
    } else {
        y = Math.min(Math.max(0, y), canvas.height - h);
    }

    if (cmd.fill && !shouldSkipLargeFillRect(w, h)) {
        ctx.fillRect(x, y, w, h);
    }
    ctx.strokeRect(x, y, w, h);
}

// Thin handwriting faces sit best next to pen strokes; the weight is ignored where unavailable.
const AI_TEXT_FONT = '"Noteworthy", "Segoe Print", "Chalkboard SE", "Comic Sans MS", cursive';
const AI_TEXT_WEIGHT = 300;

/**
 * Write AI text in a handwriting font. `x` is the left edge, `y` the vertical
 * centre of the line and `size` the height of a digit, so the model can match
 * the user's own writing by reading those straight off the snapshot.
 */
function drawAIText(cmd, turn) {
    const text = String(cmd.text ?? '').trim();
    if (!text) return;

    const digitHeight = Math.min(Math.max(10, Number(cmd.size) || 28), canvas.height * 0.4);
    // Pick the font size that makes a digit exactly `digitHeight` tall in this font.
    ctx.font = `${AI_TEXT_WEIGHT} 100px ${AI_TEXT_FONT}`;
    const ascentAt100 = ctx.measureText('0').actualBoundingBoxAscent || 70;
    ctx.font = `${AI_TEXT_WEIGHT} ${Math.round(digitHeight * 100 / ascentAt100)}px ${AI_TEXT_FONT}`;

    const box = {
        x: Number(cmd.x) || 0,
        y: (Number(cmd.y) || 0) - digitHeight / 2,
        w: ctx.measureText(text).width,
        h: digitHeight
    };
    const spot = findClearSpot(box, turn);
    turn?.placedText.push({ ...box, ...spot });

    ctx.fillStyle = cmd.color || '#000000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, spot.x, spot.y + digitHeight);
}

function drawAILine(cmd, isRelative) {
    const useRelative = isRelative || cmd.relative === true || cmd.coordinateSystem === 'relative';
    ctx.strokeStyle = cmd.color || '#000000';
    ctx.lineWidth = cmd.width || 3;
    ctx.lineCap = 'round';

    ctx.beginPath();
    let startX = resolveCoordinate(cmd.x1 || 0, 'x', useRelative);
    let startY = resolveCoordinate(cmd.y1 || 0, 'y', useRelative);
    let endX = resolveCoordinate(cmd.x2 || 0, 'x', useRelative);
    let endY = resolveCoordinate(cmd.y2 || 0, 'y', useRelative);

    if (cmd.snapToExisting) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const centerX = (startX + endX) / 2;
        const centerY = (startY + endY) / 2;
        const snappedCenter = snapPointToExistingContent(imageData, centerX, centerY, Math.hypot(endX - startX, endY - startY) / 2, {
            minSamples: cmd.minSamples || 15,
            maxShift: cmd.maxShift || Math.max(Math.hypot(endX - startX, endY - startY) * 0.9, 40)
        });

        if (snappedCenter) {
            const shiftX = snappedCenter.x - centerX;
            const shiftY = snappedCenter.y - centerY;
            startX += shiftX;
            endX += shiftX;
            startY += shiftY;
            endY += shiftY;
        }
    }

    const clampX = x => Math.min(Math.max(0, x), canvas.width);
    const clampY = y => Math.min(Math.max(0, y), canvas.height);

    ctx.moveTo(clampX(startX), clampY(startY));
    ctx.lineTo(clampX(endX), clampY(endY));
    ctx.stroke();
}

console.log('Work With Me - AI Drawing Assistant loaded!');
initializeRealtime();
initializeAI();

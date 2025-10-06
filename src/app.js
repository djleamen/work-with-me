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

function clearCanvasProgrammatically(message = "Canvas cleared! Ready for a fresh start. What would you like to create?") {
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
    addAIMessage("Image saved! Great work! 🎨");
});

const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendMessage');

function escapeHTML(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
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

function initializeAI() {
    aiService = new AIService();
    
    const savedApiKey = localStorage.getItem('openai_api_key');
    
    if (savedApiKey) {
        aiService.initialize(savedApiKey).then(() => {
            console.log('AI Service initialized with saved API key');
            addAIMessage("I'm powered by GPT 4.1! I can understand your drawings and provide intelligent feedback. Start creating!");
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
        addAIMessage("🚀 AI initialized! I'm powered by GPT-4 and ready to help you create, learn, and draw together!");
        useDemoMode = false;
    }).catch(err => {
        alert('Failed to initialize AI. Please check your API key and try again.');
        console.error(err);
    });
});

document.getElementById('skipApiKey').addEventListener('click', () => {
    hideApiKeyModal();
    useDemoMode = true;
    addAIMessage("📝 Running in demo mode with pre-programmed responses. For the full AI experience, add your OpenAI API key in settings!");
});

document.getElementById('toggleAI').addEventListener('click', () => {
    aiEnabled = !aiEnabled;
    const status = document.getElementById('aiStatus');
    status.textContent = aiEnabled ? 'AI: Active' : 'AI: Paused';
    
    if (aiEnabled) {
        addAIMessage("I'm back and ready to help! Continue drawing and I'll provide feedback.");
    } else {
        addAIMessage("I'll stay quiet for now. Click the button again when you want my help!");
    }
});

document.getElementById('aiCollaborate').addEventListener('change', (e) => {
    aiCanDraw = e.target.checked;
    if (aiCanDraw) {
        addAIMessage("Great! I can now draw alongside you to help visualize ideas.");
    } else {
        addAIMessage("Okay, I'll just provide verbal guidance without drawing.");
    }
});

function analyzeDrawing() {
    if (!aiEnabled) return;
    
    clearTimeout(drawingTimeout);
    drawingTimeout = setTimeout(() => {
        performAnalysis();
    }, 800);
}

let lastFeedbackCoverage = 0;
let feedbackCount = 0;

async function performAnalysis() {
    if (!aiEnabled) {
        return;
    }
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    
    let drawnPixels = 0;
    let colorVariety = new Set();
    
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250) {
            drawnPixels++;
            const colorKey = `${Math.floor(pixels[i]/50)}-${Math.floor(pixels[i+1]/50)}-${Math.floor(pixels[i+2]/50)}`;
            colorVariety.add(colorKey);
        }
    }
    
    const coverage = (drawnPixels / (canvas.width * canvas.height)) * 100;
    const colors = colorVariety.size;
    
    if (Math.abs(coverage - lastFeedbackCoverage) < 2 && feedbackCount > 0) {
        return; // not enough change
    }
    
    lastFeedbackCoverage = coverage;
    feedbackCount++;
    
    if (coverage < 0.5) {
        return; // too early
    }
    
    if (aiService?.isInitialized?.() && !useDemoMode) {
        try {
            const canvasImage = getCanvasSnapshot('image/png');
            
            const response = await aiService.analyzeCanvas({
                coverage: coverage.toFixed(2),
                colorCount: colors
            }, null, canvasImage);
            
            addAIMessage(response);
            
            const drawInstructions = aiService.parseDrawingInstructions(response);
            if (aiCanDraw && drawInstructions.length > 0) {
                setTimeout(() => {
                    drawInstructions.forEach(instruction => {
                        if (instruction.type === 'shape') {
                            drawAIShape(instruction.shape);
                        }
                    });
                }, 1000);
            }
        } catch (error) {
            console.error('AI Error:', error);
            addAIMessage("Hmm, I'm having trouble connecting.");
            useDemoMode = true;
            performDemoAnalysis(coverage, colors);
        }
    } else {
        performDemoAnalysis(coverage, colors);
    }
}

function performDemoAnalysis(coverage, colors) {
    if (coverage < 3) {
        const messages = [
            "Nice start! I see you're sketching something. 🎨",
            "Interesting! What are you planning to create?",
            "Good technique! Your strokes look confident.",
            "I'm watching! Keep going, this looks promising.",
        ];
        addAIMessage(messages[Math.floor(Math.random() * messages.length)]);
    } else if (coverage < 8) {
        const messages = [
            colors > 2 ? "Great use of colors! The variety really adds depth." : "Looking good! Have you considered adding more colors?",
            "Your composition is taking shape nicely!",
            "I can see your vision coming together! 🖌️",
            "Nice work! The proportions look balanced.",
        ];
        addAIMessage(messages[Math.floor(Math.random() * messages.length)]);
    } else if (coverage < 20) {
        const messages = [
            "This is really coming along! Want me to help with anything specific?",
            colors > 3 ? "Beautiful color palette! You have a good eye for color harmony." : "Your drawing has great structure. Maybe try experimenting with more colors?",
            "Impressive! Are you working on homework or just creating art?",
            "I'm loving this! The details are really emerging.",
        ];
        addAIMessage(messages[Math.floor(Math.random() * messages.length)]);
    } else if (coverage < 40 && feedbackCount < 8) {
        const messages = [
            "Wow! This is getting detailed. You're doing great! 🌟",
            "Your artwork is really filling out beautifully!",
            "I can see you're putting a lot of thought into this. Keep it up!",
            "This is looking fantastic! Need any suggestions or help?",
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
    
    const canvasData = getCanvasData();
    const analysisOnly = isAnalysisOnlyQuery(lowerMsg);

    const eraseIntent = !analysisOnly ? detectEraseIntent(lowerMsg) : null;
    if (eraseIntent?.entireCanvas) {
        clearCanvasProgrammatically("I've cleared the canvas so you can start fresh. What would you like to create next?");
        return;
    }

    const needsVision = analysisOnly || shouldUseVision(message);
    const canvasImage = needsVision ? getCanvasSnapshot('image/png') : null;
    const aiAvailable = aiService?.isInitialized?.() && !useDemoMode;

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
    
    if (needsVision) {
        addAIMessage("👁️ Let me take a look at your canvas...");
    }
    
    if (aiAvailable) {
        await processMessageWithAI({
            message,
            canvasData,
            canvasImage,
            analysisOnly,
            isExplicitDrawRequest,
            autoDrawPrompt
        });
        return;
    }

    await processMessageWithoutAI({
        message,
        analysisOnly,
        isExplicitDrawRequest,
        autoDrawPrompt
    });
}

function shouldUseVision(message) {
    const visionKeywords = [
        'what am i drawing',
        'what did i draw',
        'what is this',
        'what do you see',
        'can you see',
        'look at',
        'analyze',
        'describe',
        'what does this look like',
        'recognize',
        'identify',
        'what shape',
        'what color',
        'read this',
        'what equation',
        'solve this',
        'what number',
        'what letter',
        'what word',
        'on my canvas',
        'on the canvas',
        'in my drawing',
        'draw with me'
    ];
    
    const lowerMessage = message.toLowerCase();
    return visionKeywords.some(keyword => lowerMessage.includes(keyword));
}

function isAnalysisOnlyQuery(lowerMessage) {
    const analysisPhrases = [
        'what have i drawn',
        "what've i drawn",
        'what did i draw',
        'what am i drawing',
        "what's on my canvas",
        'what is on my canvas',
        "what's on the canvas",
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
        "that'd be great",
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
        "don't", 
        'do not',
        "don't add",
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

function getCanvasData() {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    let drawnPixels = 0;
    let colorVariety = new Set();
    
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250) {
            drawnPixels++;
            const colorKey = `${Math.floor(pixels[i]/50)}-${Math.floor(pixels[i+1]/50)}-${Math.floor(pixels[i+2]/50)}`;
            colorVariety.add(colorKey);
        }
    }
    
    const coverage = (drawnPixels / (canvas.width * canvas.height)) * 100;
    
    return {
        coverage: coverage.toFixed(2),
        colorCount: colorVariety.size
    };
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
            if (aiService?.isInitialized?.() && !useDemoMode) {
                handleCollaborativeDrawRequest(message);
            } else {
                handleDrawRequest(message);
            }
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

async function processMessageWithAI({ message, canvasData, canvasImage, analysisOnly, isExplicitDrawRequest, autoDrawPrompt }) {
    if (isExplicitDrawRequest) {
        await handleCollaborativeDrawRequest(message);
        return;
    }

    try {
        const response = await aiService.sendMessage(message, canvasData, canvasImage);
        addAIMessage(response);

        if (analysisOnly) {
            return;
        }

        const drawInstructions = aiService.parseDrawingInstructions(response);
        if (aiCanDraw && drawInstructions.length > 0) {
            setTimeout(() => {
                drawInstructions.forEach(instruction => {
                    if (instruction.type === 'shape') {
                        drawAIShape(instruction.shape);
                    }
                });
            }, 1000);
        }

        if (autoDrawPrompt) {
            await handleCollaborativeDrawRequest(autoDrawPrompt);
        }
    } catch (error) {
        console.error('AI Error:', error);
        addAIMessage("⚠️ I'm having trouble connecting to my AI brain. Please check your API key or switch to demo mode.");

        if (!analysisOnly && (isExplicitDrawRequest || autoDrawPrompt)) {
            const promptToUse = autoDrawPrompt || message;
            await handleCollaborativeDrawRequest(promptToUse);
        }
    }
}

async function processMessageWithoutAI({ message, analysisOnly, isExplicitDrawRequest, autoDrawPrompt }) {
    if (!analysisOnly && isExplicitDrawRequest) {
        await handleCollaborativeDrawRequest(message);
        return;
    }

    if (!analysisOnly && autoDrawPrompt) {
        await handleCollaborativeDrawRequest(autoDrawPrompt);
        return;
    }

    processUserMessage(message);
}

function analyzeCurrentDrawing() {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    let drawnPixels = 0;
    let colorVariety = new Set();
    
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250) {
            drawnPixels++;
            const colorKey = `${Math.floor(pixels[i]/50)}-${Math.floor(pixels[i+1]/50)}-${Math.floor(pixels[i+2]/50)}`;
            colorVariety.add(colorKey);
        }
    }
    
    const coverage = (drawnPixels / (canvas.width * canvas.height)) * 100;
    const colors = colorVariety.size;
    
    if (coverage < 0.5) {
        addAIMessage("I don't see much on the canvas yet! Start drawing and I'll help you analyze it. 🎨");
    } else {
        let analysis = "Let me analyze your drawing! 🔍\n\n";
        
        if (coverage < 5) {
            analysis += "• You have a light sketch started\n";
        } else if (coverage < 15) {
            analysis += "• Your drawing is taking shape nicely\n";
        } else if (coverage < 30) {
            analysis += "• You have a substantial piece developing\n";
        } else {
            analysis += "• This is a detailed, well-filled composition\n";
        }
        
        if (colors === 1) {
            analysis += "• Using a single color - great for focused studies\n";
        } else if (colors === 2) {
            analysis += "• Using 2 colors - nice minimal palette\n";
        } else if (colors <= 4) {
            analysis += "• Using " + colors + " colors - good variety without overwhelming\n";
        } else {
            analysis += "• Using " + colors + " colors - vibrant and diverse!\n";
        }
        
        analysis += "\nKeep going, or ask me for specific help! 🌟";
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
    addAIMessage("I'd love to draw with you! Let me add something to the canvas...");
    
    setTimeout(() => {
        drawAIShapeFromMessage(lowerMsg);
    }, 800);
}

function drawAIShapeFromMessage(lowerMsg) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    if (lowerMsg.includes('star')) {
        drawStar(centerX, centerY, 5, 50, 25, '#FFD700');
        addAIMessage("I drew a star! ⭐ Now it's your turn. Try adding to it or create something new!");
    } else if (lowerMsg.includes('circle') || lowerMsg.includes('round')) {
        drawCircleShape(centerX, centerY, 60, currentColor);
        addAIMessage("Here's a circle! Try adding details to it or draw around it! 🔵");
    } else if (lowerMsg.includes('square') || lowerMsg.includes('box')) {
        drawSquare(centerX - 50, centerY - 50, 100, currentColor);
        addAIMessage("I drew a square! Maybe turn it into a house or robot? 🏠");
    } else if (lowerMsg.includes('heart')) {
        drawHeart(centerX, centerY, 60, '#FF6B9D');
        addAIMessage("Here's a heart for you! ❤️ Feel free to decorate it!");
    } else if (lowerMsg.includes('triangle')) {
        drawTriangle(centerX, centerY - 40, 80, currentColor);
        addAIMessage("Triangle drawn! 🔺 Great for geometry or creative designs!");
    } else if (lowerMsg.includes('flower')) {
        drawFlower(centerX, centerY, 40, '#FF69B4', '#FFD700');
        addAIMessage("A flower for you! 🌸 Try adding a stem and leaves!");
    } else if (lowerMsg.includes('smiley') || lowerMsg.includes('face')) {
        drawSmiley(centerX, centerY, 50, '#FFD700');
        addAIMessage("Here's a smiley face! 😊 Spread some joy!");
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
        `**Composition tip:** Try using the rule of thirds - divide your canvas into 9 sections and place focal points at intersections.`,
        
        `**Technique tip:** Vary your brush sizes to create depth. Use larger brushes for background and smaller ones for details.`,
        
        `**Color tip:** Start with a light sketch, then gradually build up darker colors for better control.`,
        
        `**Practice tip:** Try drawing basic shapes first (circles, squares, triangles) to warm up your hand.`,
    ];
    
    addAIMessage(tips[Math.floor(Math.random() * tips.length)]);
}

function handleGeneralQuery(message) {
    const responses = [
        "That's interesting! Tell me more about what you'd like to create.",
        "I'm here to help! Would you like some drawing tips or shall we work on something specific?",
        "Great question! Feel free to start drawing and I'll provide feedback as you go.",
        "I'm analyzing your canvas. What would you like to focus on?",
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
        
        addAIMessage("See how I solved it step by step? Draw your own equation and I'll help you solve it!");
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

// Real-time AI Vision System
setInterval(() => {
    if (!aiEnabled) return;
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    let drawnPixels = 0;
    
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250) {
            drawnPixels++;
        }
    }
    
    if (drawnPixels > 1000 && Math.random() < 0.15) {
        const messages = [
            "💡 Tip: Try varying your brush sizes for more dynamic artwork!",
            "🎨 Looking creative! Want me to suggest some color combinations?",
            "✨ Your art is developing nicely! Need help with anything?",
            "🖌️ Pro tip: Lighter colors first, then add darker details!",
            "🌟 You're doing great! Want me to draw something to inspire you?",
            "🎯 Need help with proportions or perspective? Just ask!",
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

function shouldAllowTextCommand(cmd, originalPrompt = '', description = '') {
    const text = (cmd.text || '').trim();
    if (!text) {
        return false;
    }

    if (cmd.forceText === true) {
        return true;
    }

    const lowerPrompt = originalPrompt.toLowerCase();
    const lowerDescription = (description || '').toLowerCase();
    const textHints = ['write', 'text', 'label', 'word', 'words', 'caption', 'annotate', 'spell', 'equation', 'solution', 'answer', 'formula'];

    if (textHints.some(hint => lowerPrompt.includes(hint) || lowerDescription.includes(hint))) {
        return true;
    }

    if (/[0-9=+\-*/^]/.test(text) || /[∫Σπ∞√≈≠≤≥]/.test(text)) {
        return true;
    }

    if (/^(yes|ok|okay|done|sure|hi|hello|thanks|thank you)$/i.test(text)) {
        return false;
    }

    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 3 && /^[a-z\s]+$/i.test(text)) {
        return false;
    }

    return true;
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

async function executeAIDrawing(drawingData, originalPrompt = '') {
    if (!drawingData?.commands?.length) {
        console.warn('No drawing commands to execute');
        return;
    }

    if (drawingData.description) {
        addAIMessage(`✏️ ${drawingData.description}`);
    }

    const isRelative = drawingData.coordinateSystem === 'relative';
    const commandsToRun = drawingData.commands.filter(cmd => {
        if (cmd.action === 'text' && !shouldAllowTextCommand(cmd, originalPrompt, drawingData.description)) {
            console.info('Skipping AI text command for clarity:', cmd);
            return false;
        }
        return true;
    });

    if (commandsToRun.length === 0) {
        console.warn('All drawing commands were filtered out; nothing to execute');
        return;
    }

    for (const cmd of commandsToRun) {
        await new Promise(resolve => setTimeout(resolve, 300));

        try {
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            
            switch(cmd.action) {
                case 'path':
                    drawAIPath(cmd, isRelative);
                    break;
                case 'circle':
                    drawAICircle(cmd, isRelative);
                    break;
                case 'rect':
                    drawAIRect(cmd, isRelative);
                    break;
                case 'text':
                    drawAIText(cmd, isRelative);
                    break;
                case 'line':
                    drawAILine(cmd, isRelative);
                    break;
                default:
                    console.warn('Unknown drawing action:', cmd.action);
            }

            ctx.restore();
        } catch (error) {
            console.error('Error executing drawing command:', error, cmd);
        }
    }

    saveState();
    addAIMessage("Done! What do you think? Want to add to it?");
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

    const shouldSnap = cmd.snapToExisting !== false && (cmd.snapToExisting === true || cmd.fill);

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

    const shouldSnap = cmd.snapToExisting !== false && (cmd.snapToExisting === true || cmd.fill);

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
    ctx.lineWidth = cmd.width || 3;

    const w = normalizeLength(cmd.width || 50, canvas.width);
    const h = normalizeLength(cmd.height || 50, canvas.height);
    let x = resolveCoordinate(cmd.x || 0, 'x', useRelative);
    let y = resolveCoordinate(cmd.y || 0, 'y', useRelative);

    const shouldSnap = cmd.snapToExisting !== false && (cmd.snapToExisting === true || cmd.fill);

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

function drawAIText(cmd, isRelative) {
    const useRelative = isRelative || cmd.relative === true || cmd.coordinateSystem === 'relative';
    ctx.fillStyle = cmd.color || '#000000';
    const fontSizeRaw = Number(cmd.size) || 20;
    const fontSize = Math.min(Math.max(10, fontSizeRaw), Math.min(canvas.width, canvas.height) * 0.25);
    const fontFamily = typeof cmd.font === 'string' ? cmd.font : 'Arial';
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textAlign = cmd.align || 'center';
    ctx.textBaseline = cmd.baseline || 'middle';

    let textX = resolveCoordinate(cmd.x || 0, 'x', useRelative);
    let textY = resolveCoordinate(cmd.y || 0, 'y', useRelative);

    if (cmd.snapToExisting) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const snappedCenter = snapPointToExistingContent(imageData, textX, textY, fontSize * 1.2, {
            minSamples: cmd.minSamples || 15,
            maxShift: cmd.maxShift || Math.max(fontSize * 2, 40)
        });

        if (snappedCenter) {
            textX = snappedCenter.x;
            textY = snappedCenter.y;
        }
    }

    ctx.fillText(
        cmd.text || '', 
        Math.min(Math.max(0, textX), canvas.width),
        Math.min(Math.max(0, textY), canvas.height)
    );
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

async function handleCollaborativeDrawRequest(message) {
    if (!aiService?.isInitialized?.() || useDemoMode) {
        handleDrawRequest(message);
        return;
    }

    addAIMessage("🎨 Let me draw that for you...");
    
    try {
        const canvasImage = getCanvasSnapshot('image/png');
        
        const drawingData = await aiService.requestCollaborativeDraw(message, canvasImage);
        
    await executeAIDrawing(drawingData, message);
        
    } catch (error) {
        console.error('Collaborative drawing error:', error);
        addAIMessage("⚠️ I had trouble creating that drawing. Let me try a simpler approach...");
        handleDrawRequest(message);
    }
}

console.log('Work With Me - AI Drawing Assistant loaded!');
initializeAI();

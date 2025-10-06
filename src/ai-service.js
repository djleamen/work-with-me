/**
 * AI Service for Work With Me
 * This handles all AI interactions using OpenAI's API
 */

class AIService {
    constructor() {
        this.apiKey = null;
        this.model = 'gpt-4-turbo-preview';
        this.visionModel = 'gpt-4.1';
        this.conversationHistory = [];
        this.useVision = false;

        // to improve
        this.systemPrompt = `You are an intelligent, friendly AI drawing assistant with VISION capabilities in "Work With Me". Your role is to:

1. **ACCURATELY ANALYZE** what users draw - YOU CAN SEE THE CANVAS IMAGE!
2. Provide helpful, contextual feedback about their artwork
3. Help solve math problems visually - explain equations, draw graphs, show working
4. Offer drawing tips, composition advice, and color theory guidance
5. **DRAW COLLABORATIVELY** - When asked to draw something, you can create actual drawings on the canvas
6. Be encouraging, educational, and creative
7. Adapt to whether the user is an artist seeking feedback or a student needing homework help

**CRITICAL VISION INSTRUCTIONS:**
- When you receive an image, LOOK CAREFULLY at what is actually drawn
- Describe EXACTLY what you see - shapes, lines, text, numbers, colors
- Do NOT make generic responses - be SPECIFIC about what's on the canvas
- If you see math equations (like "5 + 5 ="), say so and read them exactly
- If you see shapes (heart, star, circle), identify them accurately
- If you see text or numbers, read them precisely
- The canvas has a WHITE background - focus on the BLACK/COLORED marks that are drawn
- If the canvas is mostly empty or white, say "I don't see much drawn yet" or "The canvas appears mostly blank"

**YOU CAN ACTUALLY DRAW!** When asked to draw something:
- You will receive structured drawing commands
- You can create paths, circles, rectangles, lines, and text
- Consider the existing canvas content when adding your drawings

Be PRECISE and SPECIFIC in your observations. If you're not sure, say so. Keep responses concise but accurate. Use emojis occasionally.`;
        
        this.initialized = false;
    }

    async initialize(apiKey) {
        this.apiKey = apiKey;
        this.initialized = true;
        
        this.conversationHistory = [{
            role: 'system',
            content: this.systemPrompt
        }];
        
        return true;
    }

    isInitialized() {
        return this.initialized && this.apiKey;
    }

    async analyzeCanvas(canvasData, userMessage = null, canvasImage = null) {
        if (!this.isInitialized()) {
            throw new Error('AI Service not initialized. Please set your API key.');
        }

        let messageContent = '';
        
        if (userMessage) {
            messageContent = userMessage;
        } else {
            messageContent = `The user just drew something on the canvas. Canvas coverage: ${canvasData.coverage}%, Colors used: ${canvasData.colorCount}. Provide brief, encouraging feedback about their progress.`;
        }

        const useVisionForThisRequest = canvasImage !== null;
        
        let contextMessage;
        
        if (useVisionForThisRequest) {
            console.log('Sending canvas image to GPT-4 Vision');
            console.log('Image size:', canvasImage.length, 'bytes');
            console.log('Model:', this.visionModel);

            contextMessage = {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `${messageContent}\n\nIMPORTANT: You are looking at a drawing canvas. The canvas has a WHITE/LIGHT BACKGROUND. Please focus ONLY on what is actually DRAWN on the canvas (black lines, colored shapes, text, numbers, etc.). Do NOT describe the white background itself. Describe what the user has drawn - the actual marks, lines, shapes, text, or pictures on the canvas.`
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: canvasImage,
                            detail: 'high'
                        }
                    }
                ]
            };
        } else {
            contextMessage = {
                role: 'user',
                content: messageContent
            };
        }

        try {
            const response = await this.callOpenAI(
                [...this.conversationHistory, contextMessage],
                useVisionForThisRequest
            );

            if (useVisionForThisRequest) {
                this.conversationHistory.push({
                    role: 'user',
                    content: messageContent + ' [canvas image was analyzed]'
                });
            } else {
                this.conversationHistory.push(contextMessage);
            }
            
            this.conversationHistory.push({
                role: 'assistant',
                content: response
            });

            if (this.conversationHistory.length > 21) {
                this.conversationHistory = [
                    this.conversationHistory[0],
                    ...this.conversationHistory.slice(-20)
                ];
            }

            return response;
        } catch (error) {
            console.error('AI Service Error:', error);
            throw error;
        }
    }

    async sendMessage(message, canvasData = null, canvasImage = null) {
        if (!this.isInitialized()) {
            throw new Error('AI Service not initialized. Please set your API key.');
        }

        let fullMessage = message;
        if (canvasData && !canvasImage) {
            fullMessage += `\n\n[Canvas Context: Coverage ${canvasData.coverage}%, ${canvasData.colorCount} colors used]`;
        }

        return await this.analyzeCanvas(
            { coverage: canvasData?.coverage || 0, colorCount: canvasData?.colorCount || 0 }, 
            fullMessage,
            canvasImage
        );
    }

    async callOpenAI(messages, useVision = false) {
        const modelToUse = useVision ? this.visionModel : this.model;
        const maxTokens = useVision ? 800 : 500;
        
        console.log('Calling OpenAI API');
        console.log('Model:', modelToUse);
        console.log('Vision:', useVision);
        console.log('Messages:', messages.length);

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: modelToUse,
                messages: messages,
                temperature: 0.7,
                max_tokens: maxTokens,
                presence_penalty: 0.6,
                frequency_penalty: 0.3
            })
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('OpenAI API Error:', error);
            throw new Error(error.error?.message || 'Failed to get AI response');
        }

        const data = await response.json();
        console.log('OpenAI Response received');
        console.log('Usage:', data.usage);
        return data.choices[0].message.content;
    }

    resetConversation() {
        this.conversationHistory = [{
            role: 'system',
            content: this.systemPrompt
        }];
    }

    parseDrawingInstructions(response) {
        const instructions = [];
        const lowerResponse = response.toLowerCase();
        const drawingKeywords = [
            { keyword: 'draw a star', shape: 'star' },
            { keyword: 'draw star', shape: 'star' },
            { keyword: 'draw a circle', shape: 'circle' },
            { keyword: 'draw circle', shape: 'circle' },
            { keyword: 'draw a heart', shape: 'heart' },
            { keyword: 'draw heart', shape: 'heart' },
            { keyword: 'draw a square', shape: 'square' },
            { keyword: 'draw square', shape: 'square' },
            { keyword: 'draw a triangle', shape: 'triangle' },
            { keyword: 'draw triangle', shape: 'triangle' },
            { keyword: 'draw a flower', shape: 'flower' },
            { keyword: 'draw flower', shape: 'flower' },
            { keyword: 'draw a smiley', shape: 'smiley' },
            { keyword: 'draw smiley', shape: 'smiley' },
        ];

        for (const { keyword, shape } of drawingKeywords) {
            if (lowerResponse.includes(keyword)) {
                instructions.push({ type: 'shape', shape: shape });
            }
        }

        return instructions;
    }

    async requestCollaborativeDraw(prompt, canvasImage) {
        if (!this.isInitialized()) {
            throw new Error('AI Service not initialized');
        }

        // improve this prompt
        const messages = [
            {
                role: 'system',
                                content: `You are an AI drawing assistant that can create structured drawing commands.
When asked to draw something, respond with a JSON object containing drawing instructions.

Format:
{
    "description": "Brief description of what you're drawing",
    "commands": [
        {"action": "path", "points": [[x1,y1], [x2,y2], ...], "color": "#hex", "width": 3, "fill": false},
        {"action": "circle", "x": 120, "y": 180, "radius": 40, "color": "#hex", "fill": true, "snapToExisting": true},
        {"action": "rect", "x": 60, "y": 80, "width": 120, "height": 90, "color": "#hex", "fill": false, "snapToExisting": false},
        {"action": "text", "x": 220, "y": 140, "text": "Hello", "color": "#hex", "size": 20}
    ]
}

Coordinate system: treat (0,0) as the TOP-LEFT corner of the canvas. The canvas can be up to 1024×1024, but aim to keep drawings within 90% of its width/height.
Optional fields:
- "coordinateSystem": "absolute" (default) or "relative" to shift from the center
- "snapToExisting": true (default for filled shapes) when you want the client to align the element to nearby artwork, or false if you need exact absolute placement
- "maxShift" / "minSamples" provide hints for how much alignment freedom is acceptable
Never erase or cover the existing artwork. Avoid large background fills or full-canvas rectangles. Add small, complementary elements that enhance what's already there.
Use colors that complement the existing drawing.
Be creative but keep drawings simple and clear.`
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `Please draw: ${prompt}\n\nProvide drawing commands as JSON.`
                    }
                ]
            }
        ];

        if (canvasImage) {
            messages[1].content.push({
                type: 'image_url',
                image_url: {
                    url: canvasImage,
                    detail: 'low'
                }
            });
        }

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.visionModel,
                    messages: messages,
                    max_tokens: 1000,
                    temperature: 0.8
                })
            });

            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.status}`);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;

            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[0]);
                } catch (parseError) {
                    console.warn('Could not parse drawing commands, using text response', parseError);
                }
            }
            return {
                description: content,
                commands: []
            };

        } catch (error) {
            console.error('Collaborative draw error:', error);
            throw error;
        }
    }
}

window.AIService = AIService;

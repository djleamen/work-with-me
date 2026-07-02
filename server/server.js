#!/usr/bin/env node

/**
 * Work With Me - WebSocket Server
 * Real-time AI drawing collaboration server
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import cors from 'cors';
import { config } from 'dotenv';
import OpenAI from 'openai';
import crypto from 'crypto';
config({ path: '../.env' });

const app = express();
const server = createServer(app);

// Allow local dev origins by default; extend with ALLOWED_ORIGINS (comma-separated)
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  // Non-browser clients (no Origin header) are allowed; CORS can't restrict them anyway
  return !origin || LOCAL_ORIGIN.test(origin) || allowedOrigins.includes(origin);
}

// Reject disallowed origins during the HTTP Upgrade handshake,
// before a WebSocket (and session) is ever created
const wss = new WebSocketServer({
  server,
  verifyClient: ({ origin }, done) => {
    if (isOriginAllowed(origin)) {
      done(true);
    } else {
      console.warn(`Rejected WebSocket upgrade from disallowed origin: ${origin}`);
      done(false, 403, 'Origin not allowed');
    }
  }
});

// Disallowed origins get no CORS headers (browser blocks the read) without erroring the request
app.use(cors({
  origin: (origin, callback) => callback(null, isOriginAllowed(origin))
}));
app.use(express.json({ limit: '10mb' }));

// Don't crash at startup when the key is missing; AI features fail gracefully instead
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function requireOpenAI() {
  if (!openai) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY to enable AI features.');
  }
  return openai;
}

// Models are configurable so you can point them at the strongest model your
// account has access to without touching code. Vision-capable tasks (canvas
// analysis + collaborative drawing) use VISION_MODEL.
const TEXT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.5';

function isNextGenModel(model) {
  return /^(gpt-5|o\d)/i.test(model || '');
}

// Newer reasoning models (GPT-5 / o-series) use max_completion_tokens, only
// support the default temperature, and accept reasoning_effort. Older models
// (gpt-4.x) use max_tokens + temperature. This keeps both working.
function buildCompletionRequest(model, messages, { maxTokens, temperature, stream } = {}) {
  const request = { model, messages };
  if (stream) request.stream = true;
  if (isNextGenModel(model)) {
    if (maxTokens) request.max_completion_tokens = maxTokens;
    request.reasoning_effort = process.env.OPENAI_REASONING_EFFORT || 'low';
  } else {
    if (maxTokens) request.max_tokens = maxTokens;
    if (typeof temperature === 'number') request.temperature = temperature;
  }
  return request;
}

// Shared system prompt for generating structured, canvas-aware drawing commands
const DRAWING_SYSTEM_PROMPT = `You are an AI drawing assistant that can create structured drawing commands.
When asked to draw something, respond with a JSON object containing drawing instructions.

Format:
{
    "description": "Brief description of what you're drawing",
    "commands": [
        {"action": "path", "points": [[x1,y1], [x2,y2]], "color": "#hex", "width": 3, "fill": false},
        {"action": "circle", "x": 120, "y": 180, "radius": 40, "color": "#hex", "fill": true, "snapToExisting": true},
        {"action": "rect", "x": 60, "y": 80, "width": 120, "height": 90, "color": "#hex", "fill": false, "snapToExisting": false},
        {"action": "text", "x": 220, "y": 140, "text": "Hello", "color": "#hex", "size": 20}
    ]
}

Coordinate system: treat (0,0) as the TOP-LEFT corner of the canvas. The canvas can be up to 1024x1024, but aim to keep drawings within 90% of its width/height.
Optional fields:
- "coordinateSystem": "absolute" (default) or "relative" to shift from the center
- "snapToExisting": true (default for filled shapes) when you want the client to align the element to nearby artwork, or false if you need exact absolute placement
- "maxShift" / "minSamples" provide hints for how much alignment freedom is acceptable
Never erase or cover the existing artwork. Avoid large background fills or full-canvas rectangles. Add small, complementary elements that enhance what's already there.
CRITICAL PLACEMENT RULES:
- NEVER place text or shapes on top of existing handwriting or marks. Follow the "Placement guidance" in the user's message and write only in the empty area it points to.
- When asked to DRAW a subject (a boat, sun, flower, house, etc.), render it with "path"/"line"/"circle"/"rect" shapes and colors. Do NOT just write the subject's name or description as text — actually draw it.
- When writing answers or labels, use "action":"text" with "snapToExisting": false, "align":"left", and absolute coordinates, laid out as a tidy vertical list (increase y by about 36px per line).
- Keep every element fully inside the canvas and at least 20px from each edge.
Use colors that complement the existing drawing.
Be creative but keep drawings simple and clear.`;

/**
 * Incrementally extracts the `description` string and each object inside the
 * `commands: [ ... ]` array from a JSON response as it streams in, so the
 * client can render strokes the moment the model emits them.
 */
class StreamingDrawingParser {
  constructor() {
    this.buffer = '';
    this.descriptionEmitted = false;
    this.commandsStarted = false;
    this.cursor = 0;
    this.arrayDone = false;
  }

  push(chunk, onDescription, onCommand) {
    this.buffer += chunk;

    if (!this.descriptionEmitted) {
      const match = this.buffer.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (match) {
        this.descriptionEmitted = true;
        let value = match[1];
        try { value = JSON.parse(`"${match[1]}"`); } catch { /* keep raw */ }
        onDescription(value);
      }
    }

    if (!this.commandsStarted) {
      const keyIndex = this.buffer.indexOf('"commands"');
      if (keyIndex === -1) return;
      const bracket = this.buffer.indexOf('[', keyIndex);
      if (bracket === -1) return;
      this.commandsStarted = true;
      this.cursor = bracket + 1;
    }

    if (this.arrayDone) return;
    this._scanCommands(onCommand);
  }

  _scanCommands(onCommand) {
    const buf = this.buffer;
    let i = this.cursor;
    while (i < buf.length) {
      const ch = buf[i];
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === ',') { i++; continue; }
      if (ch === ']') { this.arrayDone = true; this.cursor = i + 1; return; }
      if (ch === '{') {
        const end = this._matchObject(buf, i);
        if (end === -1) { this.cursor = i; return; } // incomplete; wait for more
        const objStr = buf.slice(i, end + 1);
        try { onCommand(JSON.parse(objStr)); } catch { /* skip malformed */ }
        i = end + 1;
        this.cursor = i;
        continue;
      }
      i++;
    }
    this.cursor = i;
  }

  _matchObject(buf, start) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < buf.length; i++) {
      const c = buf[i];
      if (inString) {
        if (escape) escape = false;
        else if (c === '\\') escape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  }
}

const sessions = new Map();

class DrawingSession {
  constructor(ws, sessionId) {
    this.ws = ws;
    this.sessionId = sessionId;
    this.conversationHistory = [];
    this.canvasHistory = [];
    this.lastAnalysis = null;
    this.createdAt = Date.now();
    
    this.conversationHistory.push({
      role: 'system',
      content: `You are an AI drawing assistant in a real-time collaborative drawing app. You can:
- SEE the canvas through image analysis
- Provide real-time feedback and suggestions
- Help solve math problems visually
- Draw shapes and provide coordinates for rendering
- Offer drawing tips and art guidance

Be helpful, encouraging, and specific about what you observe in the drawings.`
    });
  }

  addCanvasSnapshot(imageData) {
    this.canvasHistory.push({
      timestamp: Date.now(),
      data: imageData
    });
    
    // keep only last 5 snapshots to save memory
    if (this.canvasHistory.length > 5) {
      this.canvasHistory.shift();
    }
  }

  async analyzeCanvas(imageDataUrl, userMessage = null) {
    try {
      const messages = [...this.conversationHistory];
            messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: userMessage || 'Analyze the current canvas drawing and provide feedback.'
          },
          {
            type: 'image_url',
            image_url: {
              url: imageDataUrl,
              detail: 'high'
            }
          }
        ]
      });

      const response = await requireOpenAI().chat.completions.create(
        buildCompletionRequest(VISION_MODEL, messages, { maxTokens: 800, temperature: 0.7 })
      );

      const aiResponse = response.choices[0].message.content;

      this.conversationHistory.push({
        role: 'user',
        content: userMessage || 'Analyzed canvas drawing'
      });
      
      this.conversationHistory.push({
        role: 'assistant',
        content: aiResponse
      });

      if (this.conversationHistory.length > 21) {
        this.conversationHistory = [
          this.conversationHistory[0],
          ...this.conversationHistory.slice(-20)
        ];
      }

      this.lastAnalysis = {
        timestamp: Date.now(),
        response: aiResponse
      };

      return aiResponse;

    } catch (error) {
      console.error('Analysis error:', error);
      throw error;
    }
  }

  async sendMessage(message, includeCanvas = false, canvasImage = null) {
    try {
      const messages = [...this.conversationHistory];
      
      if (includeCanvas && canvasImage) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: message },
            {
              type: 'image_url',
              image_url: {
                url: canvasImage,
                detail: 'high'
              }
            }
          ]
        });
      } else {
        messages.push({
          role: 'user',
          content: message
        });
      }

      const model = includeCanvas ? VISION_MODEL : TEXT_MODEL;
      const response = await requireOpenAI().chat.completions.create(
        buildCompletionRequest(model, messages, { maxTokens: includeCanvas ? 800 : 500, temperature: 0.7 })
      );

      const aiResponse = response.choices[0].message.content;

      this.conversationHistory.push({
        role: 'user',
        content: message
      });
      
      this.conversationHistory.push({
        role: 'assistant',
        content: aiResponse
      });

      if (this.conversationHistory.length > 21) {
        this.conversationHistory = [
          this.conversationHistory[0],
          ...this.conversationHistory.slice(-20)
        ];
      }

      return aiResponse;

    } catch (error) {
      console.error('Message error:', error);
      throw error;
    }
  }

  async generateDrawing(prompt, canvasImage = null) {
    try {
      const userContent = [
        {
          type: 'text',
          text: `Please draw: ${prompt}\n\nProvide drawing commands as JSON.`
        }
      ];

      if (canvasImage) {
        userContent.push({
          type: 'image_url',
          image_url: { url: canvasImage, detail: 'low' }
        });
      }

      const messages = [
        { role: 'system', content: DRAWING_SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ];

      const response = await requireOpenAI().chat.completions.create(
        buildCompletionRequest(VISION_MODEL, messages, { maxTokens: 1000, temperature: 0.8 })
      );

      const content = response.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            description: parsed.description || '',
            commands: Array.isArray(parsed.commands) ? parsed.commands : [],
            coordinateSystem: parsed.coordinateSystem
          };
        } catch (parseError) {
          console.warn('Could not parse drawing commands:', parseError);
        }
      }

      return { description: content, commands: [] };

    } catch (error) {
      console.error('Drawing generation error:', error);
      throw error;
    }
  }

  /**
   * Streaming variant of generateDrawing. Invokes onDescription once and
   * onCommand for each command as soon as it is fully parsed from the model's
   * streamed output. Returns { description, count }.
   */
  async streamDrawing(prompt, canvasImage, { onDescription, onCommand } = {}) {
    const userContent = [
      {
        type: 'text',
        text: `Please draw: ${prompt}\n\nProvide drawing commands as JSON.`
      }
    ];

    if (canvasImage) {
      userContent.push({
        type: 'image_url',
        image_url: { url: canvasImage, detail: 'low' }
      });
    }

    const messages = [
      { role: 'system', content: DRAWING_SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ];

    const stream = await requireOpenAI().chat.completions.create(
      buildCompletionRequest(VISION_MODEL, messages, { maxTokens: 1000, temperature: 0.8, stream: true })
    );

    const parser = new StreamingDrawingParser();
    let description = '';
    let count = 0;
    let full = '';

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (!delta) continue;
      full += delta;
      parser.push(
        delta,
        (desc) => { description = desc; onDescription?.(desc); },
        (cmd) => { count++; onCommand?.(cmd); }
      );
    }

    // If streaming yielded no commands (e.g. the model wrapped or reordered the
    // JSON), fall back to parsing the full text once.
    if (count === 0) {
      const jsonMatch = full.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (!description && parsed.description) {
            description = parsed.description;
            onDescription?.(description);
          }
          for (const cmd of (parsed.commands || [])) {
            count++;
            onCommand?.(cmd);
          }
        } catch { /* leave count at 0 */ }
      }
    }

    return { description, count };
  }
}

wss.on('connection', (ws) => {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const session = new DrawingSession(ws, sessionId);
  sessions.set(sessionId, session);

  console.log(`New session connected: ${sessionId}`);

  ws.send(JSON.stringify({
    type: 'connected',
    sessionId: sessionId,
    message: '🎨 Connected to Work With Me!'
  }));

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'canvas_update': {
          if (typeof message.imageData !== 'string' || !message.imageData.trim()) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'canvas_update requires imageData'
            }));
            break;
          }
          session.addCanvasSnapshot(message.imageData);
          ws.send(JSON.stringify({
            type: 'ack',
            message: 'Canvas updated'
          }));
          break;
        }

        case 'analyze_canvas': {
          if (typeof message.imageData !== 'string' || !message.imageData.trim()) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'analyze_canvas requires imageData'
            }));
            break;
          }
          const analysis = await session.analyzeCanvas(
            message.imageData,
            message.userMessage
          );
          
          ws.send(JSON.stringify({
            type: 'ai_response',
            content: analysis,
            timestamp: Date.now()
          }));
          break;
        }

        case 'chat_message': {
          if (typeof message.content !== 'string' || !message.content.trim()) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'chat_message requires non-empty content'
            }));
            break;
          }
          const needsCanvas = message.includeCanvas || shouldUseVision(message.content);
          const response = await session.sendMessage(
            message.content,
            needsCanvas,
            needsCanvas ? message.canvasImage : null
          );
          
          ws.send(JSON.stringify({
            type: 'ai_response',
            content: response,
            timestamp: Date.now()
          }));
          break;
        }

        case 'request_drawing':
          ws.send(JSON.stringify({
            type: 'draw_command',
            shapes: message.shapes || [],
            timestamp: Date.now()
          }));
          break;

        case 'request_ai_drawing': {
          if (typeof message.prompt !== 'string' || !message.prompt.trim()) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'request_ai_drawing requires a non-empty prompt'
            }));
            break;
          }

          let started = false;
          const startIfNeeded = (description) => {
            if (started) return;
            started = true;
            ws.send(JSON.stringify({
              type: 'ai_drawing_start',
              description: description || '',
              timestamp: Date.now()
            }));
          };

          try {
            const result = await session.streamDrawing(message.prompt, message.canvasImage, {
              onDescription: (description) => startIfNeeded(description),
              onCommand: (command) => {
                startIfNeeded('');
                ws.send(JSON.stringify({
                  type: 'ai_draw_command',
                  command,
                  timestamp: Date.now()
                }));
              }
            });

            if (result.count > 0) {
              ws.send(JSON.stringify({
                type: 'ai_drawing_end',
                description: result.description,
                count: result.count,
                timestamp: Date.now()
              }));
            } else {
              // Nothing usable streamed — fall back to a single full payload
              const drawing = await session.generateDrawing(message.prompt, message.canvasImage);
              ws.send(JSON.stringify({
                type: 'ai_drawing',
                description: drawing.description,
                commands: drawing.commands,
                coordinateSystem: drawing.coordinateSystem,
                fromSession: sessionId,
                timestamp: Date.now()
              }));
            }
          } catch (streamError) {
            console.error('Streaming drawing failed, falling back to full generation:', streamError);
            const drawing = await session.generateDrawing(message.prompt, message.canvasImage);
            ws.send(JSON.stringify({
              type: 'ai_drawing',
              description: drawing.description,
              commands: drawing.commands,
              coordinateSystem: drawing.coordinateSystem,
              fromSession: sessionId,
              timestamp: Date.now()
            }));
          }
          break;
        }

        case 'broadcast_drawing': {
          const drawingData = {
            type: 'ai_drawing',
            commands: message.commands,
            description: message.description,
            fromSession: sessionId,
            timestamp: Date.now()
          };
          
          // send to originator
          ws.send(JSON.stringify(drawingData));

          // optionally broadcast to other sessions

          // sessions.forEach((s, id) => {
          //   if (id !== sessionId && s.ws.readyState === 1) {
          //     s.ws.send(JSON.stringify(drawingData));
          //   }
          // });
          break;
        }

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Unknown message type'
          }));
      }

    } catch (error) {
      console.error('Message handling error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  });

  ws.on('close', () => {
    sessions.delete(sessionId);
    console.log(`Session disconnected: ${sessionId}`);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for session ${sessionId}:`, error);
  });
});

// could improve this with NLP keyword detection?
function shouldUseVision(message) {
  const visionKeywords = [
    'what am i drawing', 'what did i draw', 'what is this', 'what do you see',
    'can you see', 'look at', 'analyze', 'describe', 'recognize', 'identify',
    'what shape', 'what color', 'read this', 'what equation', 'solve this'
  ];
  
  const lowerMessage = message.toLowerCase();
  return visionKeywords.some(keyword => lowerMessage.includes(keyword));
}

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeSessions: sessions.size,
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

app.get('/stats', (req, res) => {
  res.json({
    activeSessions: sessions.size,
    sessions: Array.from(sessions.values()).map(s => ({
      id: s.sessionId,
      messagesCount: s.conversationHistory.length,
      canvasSnapshots: s.canvasHistory.length,
      uptime: Date.now() - s.createdAt
    }))
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║   Work With Me - WebSocket Server                     ║
║   Real-time AI Drawing Collaboration                  ║
╚═══════════════════════════════════════════════════════╝

HTTP Server: http://localhost:${PORT}
WebSocket Server: ws://localhost:${PORT}
Status: Ready for connections

Endpoints:
   - GET  /health  - Server health check
   - GET  /stats   - Session statistics
   - WS   /        - WebSocket connection

API Key: ${process.env.OPENAI_API_KEY ? '✓ Loaded' : '✗ Missing'}
Text model: ${TEXT_MODEL}
Vision model: ${VISION_MODEL}
  `);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

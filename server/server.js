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

// Canvas snapshots are the largest messages a client sends (a few MB at most).
// ws accepts up to 100 MiB per message by default, so cap it to match the HTTP body limit.
const MAX_WS_PAYLOAD_BYTES = 10 * 1024 * 1024;

// Reject disallowed origins during the HTTP Upgrade handshake,
// before a WebSocket (and session) is ever created
const wss = new WebSocketServer({
  server,
  maxPayload: MAX_WS_PAYLOAD_BYTES,
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

// The model is configurable so you can point it at the strongest vision-capable
// model your account has access to without touching code. Every turn includes a
// canvas snapshot, so a single vision model handles chat and drawing together.
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.5';

function isNextGenModel(model) {
  return /^(gpt-5|o\d)/i.test(model || '');
}

// Newer reasoning models (GPT-5 / o-series) use max_completion_tokens, only
// support the default temperature, and accept reasoning_effort. Older models
// (gpt-4.x) use max_tokens + temperature. This keeps both working.
function buildCompletionRequest(model, messages, { maxTokens, temperature, stream, json } = {}) {
  const request = { model, messages };
  if (stream) request.stream = true;
  if (json) request.response_format = { type: 'json_object' };
  if (isNextGenModel(model)) {
    if (maxTokens) request.max_completion_tokens = maxTokens;
    request.reasoning_effort = process.env.OPENAI_REASONING_EFFORT || 'low';
  } else {
    if (maxTokens) request.max_tokens = maxTokens;
    if (typeof temperature === 'number') request.temperature = temperature;
  }
  return request;
}

// One prompt for the whole assistant: the model sees the canvas every turn and
// decides both what to say in chat and what (if anything) to add to the canvas.
// Keep in sync with the copy in src/ai-service.js (used when the browser talks
// to OpenAI directly because this server is not running).
const ASSISTANT_SYSTEM_PROMPT = `You are the AI partner in "Work With Me", a shared whiteboard app. The user draws and writes by hand on a canvas. You talk to them in a narrow chat panel beside it, and you can also write and draw on the same canvas. People use it for homework and maths as much as for sketching, so think of yourself as someone sitting next to them at a whiteboard with your own pen.

Each turn you receive the user's message, a few facts about the canvas, and a snapshot of it. The snapshot has a faint blue coordinate grid with pixel labels laid over it. The grid exists only so you can read positions accurately. It is not part of the user's work, so never mention it or treat it as something they drew. All coordinates are canvas pixels with (0,0) at the top-left, x increasing to the right and y increasing downward.

Respond with one JSON object and nothing else, with "reply" first:
{"reply": "what you say in the chat panel", "commands": [what you add to the canvas]}

The reply
- The chat panel shows plain text only. Markdown and LaTeX are not rendered, so asterisks, backslashes, \\[ \\] and \\sqrt{} would show up literally. Write maths with ordinary characters: √25, x², 3/4, ×, ÷, ≤, π.
- Keep it short, because the panel is narrow: usually one to three sentences. For a maths problem, give the working as a few short lines separated by newlines, ending with the answer.
- Read what is actually on the canvas and be specific about it. If something is ambiguous or hard to read, say what you think it is and ask.
- When you add something to the canvas, say briefly what you added. Never tell the user to write something that you can write for them.

The canvas commands
Use [] when nothing should be added. The available commands are:
{"action":"text","x":0,"y":0,"text":"10","size":60,"color":"#000000"}
  x is the left edge of the text, y is the vertical centre of the line, and size is the height of a digit or capital letter in pixels. Text is drawn in a handwriting style, one line per command.
{"action":"line","x1":0,"y1":0,"x2":0,"y2":0,"color":"#000000","width":3}
{"action":"path","points":[[0,0],[10,10]],"color":"#000000","width":3,"fill":false}
  A polyline through the points. With "fill": true it is closed and filled. Use plenty of points for curves.
{"action":"circle","x":0,"y":0,"radius":40,"color":"#000000","width":3,"fill":false}
  x,y is the centre.
{"action":"rect","x":0,"y":0,"width":120,"height":80,"color":"#000000","lineWidth":3,"fill":false}
  x,y is the top-left corner.
Commands are drawn in order, so later ones sit on top of earlier ones. You can only add to the canvas. You cannot erase or move anything, so if asked to, say so and mention that the user has an eraser and an Undo button.

Deciding what goes on the canvas
The canvas is the user's work, so add only what they asked for, put it where a person would put it, and never cover or cross their marks.
- When they ask you to solve, answer, finish or fill in something they have written, write just the result in the place it belongs. For "5 + √25 =" that means "10" immediately to the right of the equals sign, on the same line. The explanation belongs in the reply. Put working on the canvas only if they ask to see the steps there, and then as short lines below their work.
- An expression left waiting for an answer (ending in "=", a blank, or a question mark) is an invitation: when they ask you to solve it, write the answer on the canvas as well as explaining in the reply.
- Make your writing look like it belongs with theirs. Read the height of their digits or letters off the grid and use that as "size", centre "y" on their line of writing, leave a gap of about half a character before your text, and use their ink colour unless they ask for something else.
- When they ask you to draw something, draw it with line, path, circle and rect commands, using enough parts and points that it is recognisable, in empty space, at a size that suits the canvas and what is already there. Do not write the name of the thing in place of drawing it. Add text only when they ask for labels or writing.
- If the canvas facts say AI drawing is turned off, "commands" must be [] and the reply gives the answer in words instead.
- If there is no sensible place for something, or you cannot tell what they want added, ask in the reply rather than guessing.

Automatic check-ins
Sometimes, in place of a user message, you get a note saying this is an automatic check-in. It is sent when the user pauses while drawing, and they have not asked you anything. An interruption has to earn its place, so reply with an empty string unless you have something they would be glad to hear right now: for example they have finished writing a problem you could solve (offer in one short sentence), there is a mistake in their working, or a drawing has clearly come together and you have one specific suggestion. Stay silent for half-finished work or a lone stroke or symbol. Do not comment on how neat their handwriting is, do not praise for the sake of it, and do not repeat something you said at an earlier check-in. "commands" must be [] during a check-in.`;

/**
 * Incrementally extracts the `reply` string and each object inside the
 * `commands: [ ... ]` array from a JSON response as it streams in, so the
 * client can show the reply and render strokes the moment the model emits them.
 */
class StreamingTurnParser {
  constructor() {
    this.buffer = '';
    this.replyEmitted = false;
    this.commandsStarted = false;
    this.cursor = 0;
    this.arrayDone = false;
  }

  push(chunk, onReply, onCommand) {
    this.buffer += chunk;

    if (!this.replyEmitted) {
      const match = this.buffer.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (match) {
        this.replyEmitted = true;
        let value = match[1];
        try { value = JSON.parse(`"${match[1]}"`); } catch { /* keep raw */ }
        onReply(value);
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
    this.conversationHistory = [{ role: 'system', content: ASSISTANT_SYSTEM_PROMPT }];
    this.canvasHistory = [];
    this.createdAt = Date.now();
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

  /**
   * One assistant turn. The model gets the conversation so far, the user's
   * message (or a check-in note), the client's canvas facts and a snapshot,
   * and streams back a chat reply plus canvas commands. onReply fires once
   * (only for a non-empty reply) and onCommand once per command, as soon as
   * each is fully parsed. Returns { reply, count }.
   */
  async assist({ content, context, canvasImage }, { onReply, onCommand } = {}) {
    const userContent = [
      { type: 'text', text: context ? `${content}\n\n[Canvas facts] ${context}` : content }
    ];
    if (typeof canvasImage === 'string' && canvasImage.startsWith('data:image/')) {
      userContent.push({ type: 'image_url', image_url: { url: canvasImage, detail: 'high' } });
    }

    const stream = await requireOpenAI().chat.completions.create(
      buildCompletionRequest(
        VISION_MODEL,
        [...this.conversationHistory, { role: 'user', content: userContent }],
        { maxTokens: 4000, temperature: 0.4, stream: true, json: true }
      )
    );

    const parser = new StreamingTurnParser();
    let reply = '';
    let count = 0;
    let full = '';
    const emitReply = (value) => {
      reply = typeof value === 'string' ? value : '';
      if (reply.trim()) onReply?.(reply);
    };
    const emitCommand = (command) => {
      count++;
      onCommand?.(command);
    };

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (!delta) continue;
      full += delta;
      parser.push(delta, emitReply, emitCommand);
    }

    // If nothing could be picked out of the stream (e.g. a model that ignored
    // the JSON format), parse the whole text once, or show it as the reply.
    if (!parser.replyEmitted && count === 0 && full.trim()) {
      try {
        const parsed = JSON.parse(full.match(/\{[\s\S]*\}/)?.[0] ?? full);
        emitReply(parsed.reply);
        (Array.isArray(parsed.commands) ? parsed.commands : []).forEach(emitCommand);
      } catch {
        emitReply(full.trim());
      }
    }

    // Silent check-ins are not worth remembering.
    if (reply.trim() || count > 0) {
      this.conversationHistory.push({ role: 'user', content });
      this.conversationHistory.push({
        role: 'assistant',
        // Long stroke lists are dropped from history; the next snapshot shows them anyway.
        content: full.length <= 4000 ? full : JSON.stringify({ reply, commands: [] })
      });

      if (this.conversationHistory.length > 21) {
        this.conversationHistory = [
          this.conversationHistory[0],
          ...this.conversationHistory.slice(-20)
        ];
      }
    }

    return { reply, count };
  }
}

wss.on('connection', (ws) => {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const session = new DrawingSession(ws, sessionId);
  sessions.set(sessionId, session);

  console.log(`New session connected: ${sessionId}`);

  // A reply can finish streaming after the browser has gone away; sending on a
  // closed socket throws, so drop those instead.
  const send = (payload) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };

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

        case 'assist': {
          if (typeof message.content !== 'string' || !message.content.trim()) {
            send({ type: 'assist_error', turnId: message.turnId, message: 'assist requires non-empty content' });
            break;
          }

          // Every event carries the client's turnId so overlapping turns
          // (a check-in and a chat message, say) never get mixed up.
          const turnId = message.turnId;
          try {
            const result = await session.assist(message, {
              onReply: (content) => send({ type: 'assist_reply', turnId, content }),
              onCommand: (command) => send({ type: 'assist_command', turnId, command })
            });
            send({ type: 'assist_done', turnId, reply: result.reply, count: result.count });
          } catch (assistError) {
            console.error('Assist error:', assistError);
            send({ type: 'assist_error', turnId, message: assistError.message });
          }
          break;
        }

        case 'request_drawing':
          ws.send(JSON.stringify({
            type: 'draw_command',
            shapes: message.shapes || [],
            timestamp: Date.now()
          }));
          break;

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
Model: ${VISION_MODEL}
  `);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

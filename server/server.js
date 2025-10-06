#!/usr/bin/env node

/**
 * Work With Me - MCP Server
 * Real-time AI drawing collaboration server using Model Context Protocol
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import cors from 'cors';
import { config } from 'dotenv';
import OpenAI from 'openai';

config({ path: '../.env' });

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: messages,
        max_tokens: 800,
        temperature: 0.7
      });

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

      const response = await openai.chat.completions.create({
        model: includeCanvas ? 'gpt-4o' : 'gpt-4-turbo-preview',
        messages: messages,
        max_tokens: includeCanvas ? 800 : 500,
        temperature: 0.7
      });

      const aiResponse = response.choices[0].message.content;

      this.conversationHistory.push({
        role: 'user',
        content: message
      });
      
      this.conversationHistory.push({
        role: 'assistant',
        content: aiResponse
      });

      return aiResponse;

    } catch (error) {
      console.error('Message error:', error);
      throw error;
    }
  }
}

wss.on('connection', (ws) => {
  const sessionId = Math.random().toString(36).substring(7);
  const session = new DrawingSession(ws, sessionId);
  sessions.set(sessionId, session);

  console.log(`New session connected: ${sessionId}`);

  ws.send(JSON.stringify({
    type: 'connected',
    sessionId: sessionId,
    message: '🎨 Connected to Work With Me MCP Server!'
  }));

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'canvas_update': {
          session.addCanvasSnapshot(message.imageData);
          ws.send(JSON.stringify({
            type: 'ack',
            message: 'Canvas updated'
          }));
          break;
        }

        case 'analyze_canvas': {
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
║   Work With Me - MCP Server                           ║
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
  `);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

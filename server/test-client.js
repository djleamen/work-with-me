#!/usr/bin/env node

/**
 * Test client for Work With Me MCP Server
 * Tests WebSocket connection and basic functionality
 * Debugging and development purposes only
 */

import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3001');

ws.on('open', () => {
  console.log('Connected to server');
  
  // Test ping
  setTimeout(() => {
    console.log('📤 Sending ping...');
    ws.send(JSON.stringify({ type: 'ping' }));
  }, 1000);
  
  // Test chat message
  setTimeout(() => {
    console.log('Sending chat message...');
    ws.send(JSON.stringify({
      type: 'chat_message',
      content: 'Hello! Can you help me?',
      includeCanvas: false
    }));
  }, 2000);
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('Received:', message.type);
  console.log('Content:', message.content || message.message || 'N/A');
  
  if (message.type === 'ai_response') {
    setTimeout(() => {
      console.log('Closing connection...');
      ws.close();
    }, 1000);
  }
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error.message);
});

ws.on('close', () => {
  console.log('Disconnected from server');
  process.exit(0);
});

console.log('Connecting to ws://localhost:3001...');

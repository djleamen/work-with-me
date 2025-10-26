# Copilot Instructions for Work With Me

## Project Overview
Work With Me is an AI-powered collaborative drawing web application that combines creative freedom with AI assistance. It's perfect for artists, students working on homework, visualizing math equations, and anyone who wants an AI companion while drawing.

## Architecture

### Project Structure
The project consists of two main components:

1. **Web Frontend** (`src/`)
   - Pure JavaScript (vanilla JS, no frameworks)
   - Canvas-based drawing interface
   - Real-time chat with AI
   - WebSocket client for server communication
   - Files: `app.js`, `ai-service.js`, `mcp-client.js`, `index.html`, `styles.css`

2. **MCP Server** (`server/`)
   - Node.js/Express backend
   - WebSocket server for real-time communication
   - OpenAI API integration for AI features
   - Model Context Protocol (MCP) implementation
   - Files: `server.js`, `test-client.js`

### Technology Stack
- **Frontend**: Vanilla JavaScript, HTML5 Canvas, WebSocket API
- **Backend**: Node.js, Express, WebSocket (ws library)
- **AI**: OpenAI API (GPT-4 Vision)
- **Development**: ESLint for code quality

## Development Workflow

### Setup
```bash
# Install frontend dependencies (if needed)
npm install

# Install server dependencies
cd server
npm install
cd ..

# Copy environment variables
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

### Running the Application
```bash
# Start both web server and MCP server
./start.sh

# Or start individually:
./start-web.sh     # Web frontend on port 8000
./start-server.sh  # MCP server on port 3001
```

### Linting
```bash
# Run ESLint
npx eslint .
```

### Testing
Currently, the project uses manual testing. Start the application and test:
- Drawing functionality (pen, shapes, colors)
- AI chat interactions
- Canvas analysis features
- WebSocket connection stability

## Code Style and Conventions

### JavaScript Style
- Use ES6+ modern JavaScript syntax
- Use `const` and `let` instead of `var`
- Use arrow functions for callbacks
- Use template literals for string interpolation
- Follow ESLint configuration in `eslint.config.js`

### Naming Conventions
- `camelCase` for variables and functions
- `PascalCase` for classes
- `UPPER_CASE` for constants
- Descriptive names that convey purpose

### Code Organization
- Keep functions focused and single-purpose
- Add JSDoc comments for classes and complex functions
- Group related functionality together
- Use async/await for asynchronous operations

### Canvas Drawing Patterns
- Always save canvas state before operations that need restoration
- Use `ctx.save()` and `ctx.restore()` for context management
- Store history for undo/redo functionality
- Handle resize events properly to preserve canvas content

### WebSocket Communication
- All WebSocket messages use JSON format
- Include `type` field to identify message purpose
- Handle connection errors gracefully with reconnection logic
- Maintain session IDs for conversation continuity

## Key Features to Maintain

### Drawing Tools
- Pen tool with variable brush sizes
- Shape tools (circle, rectangle, line)
- Color picker with customizable colors
- Eraser functionality
- Undo/redo with history management
- Clear canvas option

### AI Integration
- Vision-capable AI that can "see" and analyze drawings
- Context-aware responses based on canvas content
- Math problem solving with visual explanations
- Drawing assistance and suggestions
- Collaborative drawing where AI can add content

### Real-time Features
- WebSocket-based bidirectional communication
- Session management for conversation history
- Canvas state synchronization
- Error handling and automatic reconnection

## Important Design Decisions

### Why Vanilla JavaScript?
The frontend uses vanilla JS (no frameworks) to:
- Keep the bundle size small
- Minimize dependencies
- Provide direct control over Canvas API
- Make the code accessible to beginners

### Canvas Rendering Strategy
- Use HTML5 Canvas API directly for maximum performance
- Maintain separate canvas for export (with white background)
- Store drawing history as image data for undo/redo
- Handle high-DPI displays appropriately

### AI Service Architecture
- OpenAI API key can be provided by user (client-side) or server-side
- Two modes: direct OpenAI API calls or MCP server proxy
- Vision model used for canvas analysis
- Conversation history maintained for context

### Model Context Protocol (MCP)
- Custom MCP implementation for drawing collaboration
- Session-based conversation management
- Canvas history tracking for analysis
- Real-time streaming responses

## Security Considerations

- API keys should be stored in `.env` (never committed)
- Validate and sanitize all user inputs
- Use CORS appropriately for the Express server
- Implement rate limiting for AI API calls (future enhancement)
- Keep dependencies updated for security patches

## File Modification Guidelines

### When editing `app.js`:
- Maintain canvas state management carefully
- Test all drawing tools after changes
- Ensure history (undo/redo) still works
- Check event handlers don't cause memory leaks

### When editing `server.js`:
- Maintain backward compatibility with existing clients
- Log important events for debugging
- Handle WebSocket disconnections gracefully
- Update conversation history management carefully

### When editing `ai-service.js`:
- Preserve vision capabilities
- Maintain conversation history format
- Test with and without API key
- Ensure proper error handling

### When editing styles:
- Maintain responsive design
- Test on different screen sizes
- Ensure canvas resizing works properly
- Keep the UI intuitive and accessible

## Common Tasks

### Adding a new drawing tool:
1. Add button/control in `index.html`
2. Add tool state in `app.js`
3. Implement drawing logic in canvas event handlers
4. Update cursor styling if needed
5. Test with undo/redo functionality

### Modifying AI behavior:
1. Update system prompt in `ai-service.js` or `server.js`
2. Test with various drawing scenarios
3. Ensure vision capabilities still work
4. Check conversation context is maintained

### Adding a new WebSocket message type:
1. Define message structure (include `type` field)
2. Add handler in `mcp-client.js` `handleMessage()`
3. Add corresponding handler in `server.js`
4. Update error handling for the new type
5. Test bidirectional communication

## Environment Variables
- `OPENAI_API_KEY`: Required for AI features (in `.env`)
- `OPENAI_MODEL`: Optional, defaults to `gpt-4-turbo-preview`
- `AI_TEMPERATURE`: Optional, defaults to 0.7

## Dependencies Management
- Keep dependencies minimal and well-justified
- Update regularly for security and bug fixes
- Test thoroughly after dependency updates
- Document why each dependency is needed

## Future Considerations
- Add automated testing framework
- Implement proper build process
- Add TypeScript for type safety
- Create comprehensive API documentation
- Add user authentication and multi-user sessions
- Implement canvas collaboration features
- Add more drawing tools and effects

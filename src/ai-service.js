/**
 * AI Service for Work With Me
 * Talks to OpenAI directly from the browser. Used when the realtime server is
 * not running; when it is, the same assistant turn goes through the server.
 */

class AIService {
    constructor() {
        this.apiKey = null;
        this.visionModel = localStorage.getItem('openai_vision_model') || 'gpt-5.5';
        this.reasoningEffort = localStorage.getItem('openai_reasoning_effort') || 'low';
        this.conversationHistory = [];

        // Keep in sync with ASSISTANT_SYSTEM_PROMPT in server/server.js.
        this.systemPrompt = `You are the AI partner in "Work With Me", a shared whiteboard app. The user draws and writes by hand on a canvas. You talk to them in a narrow chat panel beside it, and you can also write and draw on the same canvas. People use it for homework and maths as much as for sketching, so think of yourself as someone sitting next to them at a whiteboard with your own pen.

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

        this.initialized = false;
    }

    async initialize(apiKey) {
        this.apiKey = apiKey;
        this.initialized = true;
        this.resetConversation();
        return true;
    }

    isInitialized() {
        return this.initialized && this.apiKey;
    }

    /**
     * Build a Chat Completions body that works for both older models
     * (gpt-4.x: max_tokens + temperature) and newer reasoning models
     * (GPT-5 / o-series: max_completion_tokens + reasoning_effort,
     * default temperature only).
     */
    buildRequestBody(model, messages, { maxTokens, temperature } = {}) {
        const body = { model, messages, response_format: { type: 'json_object' } };
        if (/^(gpt-5|o\d)/i.test(model)) {
            if (maxTokens) body.max_completion_tokens = maxTokens;
            body.reasoning_effort = this.reasoningEffort || 'low';
        } else {
            if (maxTokens) body.max_tokens = maxTokens;
            if (typeof temperature === 'number') body.temperature = temperature;
        }
        return body;
    }

    /**
     * One assistant turn: the model gets the conversation so far, the user's
     * message (or a check-in note), the canvas facts and a snapshot, and
     * returns a chat reply plus canvas commands. onReply fires for a non-empty
     * reply, then onCommand once per command. Returns { reply, count }.
     */
    async assist({ content, context, canvasImage }, { onReply, onCommand } = {}) {
        if (!this.isInitialized()) {
            throw new Error('AI Service not initialized. Please set your API key.');
        }

        const userContent = [
            { type: 'text', text: context ? `${content}\n\n[Canvas facts] ${context}` : content }
        ];
        if (canvasImage) {
            userContent.push({ type: 'image_url', image_url: { url: canvasImage, detail: 'high' } });
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(
                this.buildRequestBody(
                    this.visionModel,
                    [...this.conversationHistory, { role: 'user', content: userContent }],
                    { maxTokens: 4000, temperature: 0.4 }
                )
            )
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            console.error('OpenAI API Error:', error);
            throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        const raw = data.choices?.[0]?.message?.content || '';

        let reply = raw.trim();
        let commands = [];
        try {
            const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw);
            reply = typeof parsed.reply === 'string' ? parsed.reply : '';
            commands = Array.isArray(parsed.commands) ? parsed.commands : [];
        } catch {
            // Not JSON: show whatever the model said as the reply.
        }

        if (reply.trim()) onReply?.(reply);
        commands.forEach(command => onCommand?.(command));

        // Silent check-ins are not worth remembering.
        if (reply.trim() || commands.length > 0) {
            this.conversationHistory.push({ role: 'user', content });
            this.conversationHistory.push({
                role: 'assistant',
                // Long stroke lists are dropped from history; the next snapshot shows them anyway.
                content: raw.length <= 4000 ? raw : JSON.stringify({ reply, commands: [] })
            });

            if (this.conversationHistory.length > 21) {
                this.conversationHistory = [
                    this.conversationHistory[0],
                    ...this.conversationHistory.slice(-20)
                ];
            }
        }

        return { reply, count: commands.length };
    }

    resetConversation() {
        this.conversationHistory = [{
            role: 'system',
            content: this.systemPrompt
        }];
    }
}

window.AIService = AIService;

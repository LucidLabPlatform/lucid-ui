// UUID helper (works over plain HTTP, unlike crypto.randomUUID)
function uuid() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
}

// Session management
const SESSION_KEY = 'lucid_ai_session';
let sessionId = sessionStorage.getItem(SESSION_KEY);
if (!sessionId) {
    sessionId = uuid();
    sessionStorage.setItem(SESSION_KEY, sessionId);
}

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const loadingEl = document.getElementById('loading');
const sessionLabelEl = document.getElementById('session-label');

if (sessionLabelEl) {
    sessionLabelEl.textContent = `session: ${sessionId.slice(0, 8)}…`;
}

// Elapsed timer
let timerInterval = null;
const timerEl = document.getElementById('timer');

function startTimer() {
    const start = Date.now();
    if (timerEl) {
        timerEl.textContent = '0.0s';
        timerEl.classList.remove('hidden');
    }
    timerInterval = setInterval(() => {
        if (timerEl) timerEl.textContent = ((Date.now() - start) / 1000).toFixed(1) + 's';
    }, 100);
}

function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    if (timerEl) timerEl.classList.add('hidden');
}

// Load history on page load
async function loadHistory() {
    try {
        const resp = await fetch(`/api/ai/history?session_id=${sessionId}`);
        const data = await resp.json();
        for (const turn of (data.turns || [])) {
            appendMessage(turn.role, turn.content, []);
        }
    } catch (e) {
        // silently ignore — history is optional
    }
}

function appendMessage(role, content, toolCalls) {
    const div = document.createElement('div');
    div.className = `message ${role}`;

    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = content;
    div.appendChild(text);

    if (toolCalls && toolCalls.length > 0) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = `Tool calls (${toolCalls.length})`;
        details.appendChild(summary);
        for (const tc of toolCalls) {
            const item = document.createElement('div');
            item.className = 'tool-call';
            item.textContent = formatToolCall(tc);
            details.appendChild(item);
        }
        div.appendChild(details);
    }

    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatToolCall(tc) {
    const name = tc.name || tc.specialist || 'tool';
    let args = tc.args;
    if (!args && tc.task) {
        args = tc.task;
    }
    if (args && typeof args === 'object') {
        try {
            args = JSON.stringify(args);
        } catch (_) {
            args = String(args);
        }
    }
    return args ? `${name}: ${args}` : name;
}

async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = '';
    appendMessage('user', text, []);
    loadingEl.classList.remove('hidden');
    startTimer();

    try {
        const resp = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({message: text, session_id: sessionId})
        });
        const data = await resp.json();
        if (resp.ok) {
            appendMessage('assistant', data.response, data.tool_calls || []);
        } else {
            appendMessage('assistant', `Error: ${data.detail || 'Unknown error'}`, []);
        }
    } catch (e) {
        appendMessage('assistant', `Network error: ${e.message}`, []);
    } finally {
        stopTimer();
        loadingEl.classList.add('hidden');
    }
}

function newChat() {
    sessionId = uuid();
    sessionStorage.setItem(SESSION_KEY, sessionId);
    messagesEl.innerHTML = '';
    if (sessionLabelEl) {
        sessionLabelEl.textContent = `session: ${sessionId.slice(0, 8)}…`;
    }
}

// Enter to send (Shift+Enter for newline)
inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('new-chat-btn').addEventListener('click', newChat);

loadHistory();

// UUID helper (works over plain HTTP, unlike crypto.randomUUID)
function uuid() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
}

// Session management — use localStorage so sessions persist across tabs/restarts
const SESSION_KEY = 'lucid_ai_session';
let sessionId = localStorage.getItem(SESSION_KEY);
if (!sessionId) {
    sessionId = uuid();
    localStorage.setItem(SESSION_KEY, sessionId);
}

const messagesEl   = document.getElementById('messages');
const inputEl      = document.getElementById('input');
const loadingEl    = document.getElementById('loading');
const sessionList  = document.getElementById('session-list');

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

// ── Session sidebar ──────────────────────────────────────────────────
async function loadSessions() {
    try {
        const resp = await fetch('/api/ai/sessions');
        const sessions = await resp.json();
        if (!sessions.length) {
            sessionList.innerHTML = '<div class="empty" style="font-size:.75rem;padding:.5rem">No sessions yet</div>';
            return;
        }
        sessionList.innerHTML = sessions.map(s => {
            const active = s.session_id === sessionId ? ' ai-session-active' : '';
            const preview = s.preview || 'Empty session';
            const ts = s.last_active_at
                ? new Date(s.last_active_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
                : '';
            return `
                <div class="ai-session-item${active}" data-sid="${s.session_id}">
                    <div class="ai-session-content" onclick="switchSession('${s.session_id}')">
                        <div class="ai-session-preview">${escHtml(preview)}</div>
                        <div class="ai-session-ts">${ts}</div>
                    </div>
                    <button class="ai-session-delete" onclick="event.stopPropagation();deleteSession('${s.session_id}')" title="Delete">&times;</button>
                </div>`;
        }).join('');
    } catch {
        sessionList.innerHTML = '<div class="empty" style="font-size:.75rem;padding:.5rem">Could not load sessions</div>';
    }
}

function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

window.deleteSession = async function(sid) {
    await fetch(`/api/ai/sessions/${sid}`, { method: 'DELETE' });
    if (sid === sessionId) {
        newChat();
    }
    loadSessions();
};

window.switchSession = function(sid) {
    sessionId = sid;
    localStorage.setItem(SESSION_KEY, sessionId);
    messagesEl.innerHTML = '';
    loadHistory();
    // Update active class
    sessionList.querySelectorAll('.ai-session-item').forEach(el => {
        el.classList.toggle('ai-session-active', el.dataset.sid === sid);
    });
};

// ── Chat history ─────────────────────────────────────────────────────
async function loadHistory() {
    try {
        const resp = await fetch(`/api/ai/history?session_id=${sessionId}`);
        const data = await resp.json();
        for (const turn of (data.turns || [])) {
            appendMessage(turn.role, turn.content, []);
        }
    } catch {
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

// ── Send ─────────────────────────────────────────────────────────────
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
        loadSessions(); // refresh sidebar to show updated timestamp
    }
}

function newChat() {
    sessionId = uuid();
    localStorage.setItem(SESSION_KEY, sessionId);
    messagesEl.innerHTML = '';
    loadSessions();
    inputEl.focus();
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

// ── Voice (push-to-talk) ─────────────────────────────────────────────
const voiceBtn = document.getElementById('voice-btn');
let mediaRecorder = null;
let audioChunks = [];
let recordingTimeout = null;

// Check if voice service is available
fetch('/api/voice/health').then(r => {
    if (r.ok && voiceBtn) voiceBtn.classList.remove('hidden');
}).catch(() => {});

if (voiceBtn) {
    voiceBtn.addEventListener('mousedown', startRecording);
    voiceBtn.addEventListener('mouseup', stopRecording);
    voiceBtn.addEventListener('touchstart', e => { e.preventDefault(); startRecording(); });
    voiceBtn.addEventListener('touchend', e => { e.preventDefault(); stopRecording(); });
    voiceBtn.addEventListener('mouseleave', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') stopRecording();
    });
}

async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        appendMessage('assistant', 'Microphone not available. Chrome requires HTTPS for mic access on non-localhost. Try chrome://flags/#unsafely-treat-insecure-origin-as-secure and add http://10.205.10.16:5000', []);
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];
        // Try opus first, fall back to default
        let options = {};
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            options.mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
            options.mimeType = 'audio/webm';
        }
        mediaRecorder = new MediaRecorder(stream, options);
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = handleRecordingComplete;
        mediaRecorder.start();
        voiceBtn.classList.add('recording');
        // Max 30s safety limit
        recordingTimeout = setTimeout(() => stopRecording(), 30000);
    } catch (err) {
        appendMessage('assistant', `Microphone error: ${err.message}. Make sure mic access is allowed.`, []);
    }
}

function stopRecording() {
    clearTimeout(recordingTimeout);
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    voiceBtn.classList.remove('recording');
}

async function handleRecordingComplete() {
    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    if (blob.size < 1000) return;

    loadingEl.classList.remove('hidden');
    startTimer();

    try {
        // STT
        const form = new FormData();
        form.append('audio', blob, 'recording.webm');
        const sttResp = await fetch('/api/voice/stt', { method: 'POST', body: form });
        if (!sttResp.ok) {
            const err = await sttResp.json().catch(() => ({}));
            throw new Error(err.detail || 'Transcription failed');
        }
        const { text } = await sttResp.json();
        appendMessage('user', text, []);

        // Chat (existing flow)
        const chatResp = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, session_id: sessionId })
        });
        const data = await chatResp.json();
        if (!chatResp.ok) {
            appendMessage('assistant', `Error: ${data.detail || 'Unknown error'}`, []);
            return;
        }
        appendMessage('assistant', data.response, data.tool_calls || []);

        // TTS
        const ttsResp = await fetch('/api/voice/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: data.response })
        });
        if (ttsResp.ok) {
            const audioBlob = await ttsResp.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            audio.play();
            audio.onended = () => URL.revokeObjectURL(audioUrl);
        }
    } catch (e) {
        appendMessage('assistant', `Voice error: ${e.message}`, []);
    } finally {
        stopTimer();
        loadingEl.classList.add('hidden');
        loadSessions();
    }
}

loadSessions();
loadHistory();

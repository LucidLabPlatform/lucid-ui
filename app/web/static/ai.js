// LUCID AI Copilot — chat + voice client
// SSE consumption from /api/ai/chat/stream, push-to-talk via MediaRecorder,
// TTS playback after final response, right-panel poll every 5s.

(function () {
  const els = {
    transcript: document.getElementById("ai-transcript"),
    empty: document.getElementById("ai-empty"),
    form: document.getElementById("ai-composer"),
    input: document.getElementById("ai-input"),
    send: document.getElementById("ai-send"),
    mic: document.getElementById("ai-mic"),
    sessionSel: document.getElementById("ai-session-sel"),
    newBtn: document.getElementById("ai-new-session"),
    delBtn: document.getElementById("ai-delete-session"),
    voiceToggle: document.getElementById("ai-voice-toggle"),
    status: document.getElementById("ai-status"),
    audio: document.getElementById("ai-audio"),
    fleetPanel: document.getElementById("ai-panel-fleet"),
    runsPanel: document.getElementById("ai-panel-runs"),
  };

  const state = {
    sessionId: localStorage.getItem("lucid.ai.session") || newSessionId(),
    inflight: false,
    recorder: null,
    chunks: [],
    pollTimer: null,
  };

  function newSessionId() {
    return "s-" + Math.random().toString(36).slice(2, 10);
  }

  function setStatus(s) {
    els.status.textContent = s;
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s == null ? "" : String(s);
    return div.innerHTML;
  }

  function renderMarkdownInto(el, text) {
    if (!el) return;
    el.classList.add("ai-md");
    if (typeof window.marked !== "undefined" && typeof window.DOMPurify !== "undefined") {
      try {
        const html = window.marked.parse(text || "", { breaks: true, gfm: true });
        el.innerHTML = window.DOMPurify.sanitize(html);
        return;
      } catch (e) {
        // fall through to plain text
      }
    }
    el.textContent = text || "";
  }

  // ─── Transcript rendering ────────────────────────────────────────

  function clearTranscript() {
    els.transcript.innerHTML = "";
    els.empty && els.empty.remove();
  }

  function addBubble(role, text) {
    if (els.empty) els.empty.remove();
    const div = document.createElement("div");
    div.className = "ai-bubble ai-bubble-" + role;
    div.innerHTML = `<div class="ai-bubble-role">${role}</div><div class="ai-bubble-content"></div>`;
    div.querySelector(".ai-bubble-content").textContent = text || "";
    els.transcript.appendChild(div);
    els.transcript.scrollTop = els.transcript.scrollHeight;
    return div;
  }

  function addToolCard(name, args) {
    if (els.empty) els.empty.remove();
    const card = document.createElement("div");
    card.className = "ai-tool-card";
    card.innerHTML = `
      <div class="ai-tool-head">
        <span class="ai-tool-name">${escapeHtml(name)}</span>
        <span class="ai-tool-state">running…</span>
      </div>
      <pre class="ai-tool-args">${escapeHtml(args)}</pre>
    `;
    els.transcript.appendChild(card);
    els.transcript.scrollTop = els.transcript.scrollHeight;
    return card;
  }

  function addError(message) {
    if (els.empty) els.empty.remove();
    const div = document.createElement("div");
    div.className = "ai-bubble ai-bubble-error";
    div.innerHTML = `<div class="ai-bubble-role">error</div><div class="ai-bubble-content"></div>`;
    div.querySelector(".ai-bubble-content").textContent = message;
    els.transcript.appendChild(div);
    els.transcript.scrollTop = els.transcript.scrollHeight;
  }

  // ─── SSE chat stream ─────────────────────────────────────────────

  async function sendMessage(message, opts = {}) {
    if (!message || state.inflight) return;
    state.inflight = true;
    els.send.disabled = true;
    els.input.disabled = true;
    setStatus("thinking…");

    if (!opts.silent) addBubble("user", message);
    const assistant = addBubble("assistant", "");
    const contentEl = assistant.querySelector(".ai-bubble-content");
    let assistantText = "";
    let pendingTool = null;

    try {
      const resp = await fetch("/api/ai/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, session_id: state.sessionId }),
      });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          let evt;
          try {
            evt = JSON.parse(payload);
          } catch {
            continue;
          }

          switch (evt.type) {
            case "intent":
              setStatus(`intent: ${evt.intent}`);
              break;
            case "tool_call":
              pendingTool = addToolCard(evt.name || "tool", evt.args || "");
              setStatus(`calling ${evt.name}…`);
              break;
            case "tool_result":
              if (pendingTool) {
                const s = pendingTool.querySelector(".ai-tool-state");
                if (s) {
                  s.textContent = "done";
                  s.classList.add("ai-tool-done");
                }
                pendingTool = null;
              }
              break;
            case "token":
              assistantText += evt.content || "";
              // Streaming: textContent during the stream is fastest and
              // safe; we re-render as markdown on `done`.
              contentEl.textContent = assistantText;
              els.transcript.scrollTop = els.transcript.scrollHeight;
              break;
            case "done":
              if (evt.response) {
                assistantText = evt.response;
              }
              renderMarkdownInto(contentEl, assistantText);
              els.transcript.scrollTop = els.transcript.scrollHeight;
              break;
            case "error":
              addError(evt.message || "AI error");
              break;
          }
        }
      }
    } catch (err) {
      addError(`Request failed: ${err.message || err}`);
    } finally {
      state.inflight = false;
      els.send.disabled = false;
      els.input.disabled = false;
      setStatus("idle");
      els.input.focus();

      if (assistantText && els.voiceToggle.checked) {
        speak(assistantText).catch((e) => console.warn("TTS failed:", e));
      }
      // Refresh side panels — state may have changed.
      refreshPanels();
    }
  }

  // ─── Voice (push-to-talk) ────────────────────────────────────────

  async function startRecording() {
    if (state.recorder) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      addError("Microphone denied or unavailable.");
      return;
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    state.recorder = rec;
    state.chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) state.chunks.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      state.recorder = null;
      const blob = new Blob(state.chunks, { type: mime });
      state.chunks = [];
      if (blob.size < 200) {
        setStatus("idle");
        return;
      }
      setStatus("transcribing…");
      try {
        const fd = new FormData();
        fd.append("audio", blob, "speech.webm");
        const resp = await fetch("/api/voice/stt", { method: "POST", body: fd });
        if (!resp.ok) {
          addError(`STT failed (${resp.status})`);
          setStatus("idle");
          return;
        }
        const { text } = await resp.json();
        if (text && text.trim()) {
          els.input.value = text.trim();
          await sendMessage(text.trim());
        } else {
          setStatus("idle");
        }
      } catch (e) {
        addError(`STT error: ${e.message || e}`);
        setStatus("idle");
      }
    };
    rec.start();
    setStatus("recording…");
    els.mic.classList.add("ai-mic-active");
  }

  function stopRecording() {
    els.mic.classList.remove("ai-mic-active");
    if (state.recorder && state.recorder.state !== "inactive") {
      state.recorder.stop();
    }
  }

  async function speak(text) {
    if (!text) return;
    const resp = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    els.audio.src = url;
    els.audio.play().catch(() => {});
    els.audio.onended = () => URL.revokeObjectURL(url);
  }

  // ─── Sessions ────────────────────────────────────────────────────

  async function loadSessions() {
    try {
      const resp = await fetch("/api/ai/sessions");
      if (!resp.ok) return;
      const sessions = await resp.json();
      const list = Array.isArray(sessions) ? sessions : [];
      els.sessionSel.innerHTML = "";
      const haveCurrent = list.some((s) => s.session_id === state.sessionId);
      if (!haveCurrent) {
        const opt = document.createElement("option");
        opt.value = state.sessionId;
        opt.textContent = `(new) ${state.sessionId}`;
        els.sessionSel.appendChild(opt);
      }
      for (const s of list) {
        const opt = document.createElement("option");
        opt.value = s.session_id;
        const preview = (s.preview || s.first_message || s.session_id).slice(0, 40);
        opt.textContent = preview;
        if (s.session_id === state.sessionId) opt.selected = true;
        els.sessionSel.appendChild(opt);
      }
    } catch (e) {
      console.warn("loadSessions failed", e);
    }
  }

  async function loadHistory() {
    clearTranscript();
    try {
      const resp = await fetch(
        `/api/ai/history?session_id=${encodeURIComponent(state.sessionId)}`
      );
      if (!resp.ok) return;
      const data = await resp.json();
      const turns = (data && data.turns) || [];
      for (const t of turns) {
        const div = addBubble(t.role, "");
        const c = div.querySelector(".ai-bubble-content");
        if (t.role === "assistant") {
          renderMarkdownInto(c, t.content || "");
        } else {
          c.textContent = t.content || "";
        }
      }
    } catch {
      // History fetch failed — leave transcript empty.
    }
  }

  function switchSession(id) {
    state.sessionId = id;
    localStorage.setItem("lucid.ai.session", id);
    loadHistory();
  }

  // ─── Side panels ─────────────────────────────────────────────────

  async function refreshPanels() {
    fetchAgents();
    fetchRuns();
  }

  async function fetchAgents() {
    try {
      const resp = await fetch("/api/agents");
      if (!resp.ok) {
        els.fleetPanel.innerHTML = `<div class="ai-empty">Fleet unavailable</div>`;
        return;
      }
      const agents = await resp.json();
      const list = Array.isArray(agents) ? agents : [];
      if (!list.length) {
        els.fleetPanel.innerHTML = `<div class="ai-empty">No agents</div>`;
        return;
      }
      let online = 0;
      const rows = list.map((a) => {
        const state = ((a.status || {}).state || "unknown").toLowerCase();
        const ok = state === "online" || state === "running" || state === "ready";
        if (ok) online++;
        const compIds = Object.keys(a.components || {});
        return `
          <div class="ai-agent-row">
            <span class="ai-agent-dot ${ok ? "ai-dot-online" : "ai-dot-offline"}"></span>
            <a class="ai-agent-id" href="/agent/${escapeHtml(a.agent_id)}">${escapeHtml(a.agent_id)}</a>
            <span class="ai-agent-comp">${compIds.length} comp</span>
          </div>`;
      }).join("");
      els.fleetPanel.innerHTML = `
        <div class="ai-panel-stat">${online}/${list.length} online</div>
        ${rows}
      `;
    } catch (e) {
      els.fleetPanel.innerHTML = `<div class="ai-empty">Fleet error</div>`;
    }
  }

  async function fetchRuns() {
    try {
      const resp = await fetch("/api/experiments/runs?limit=5");
      if (!resp.ok) {
        els.runsPanel.innerHTML = `<div class="ai-empty">Runs unavailable</div>`;
        return;
      }
      const data = await resp.json();
      const runs = Array.isArray(data) ? data : (data.runs || []);
      if (!runs.length) {
        els.runsPanel.innerHTML = `<div class="ai-empty">No runs yet</div>`;
        return;
      }
      const rows = runs.slice(0, 5).map((r) => {
        const status = (r.status || "?").toLowerCase();
        const id = r.run_id || r.id || "?";
        const tpl = r.template_id || r.template || "";
        return `
          <div class="ai-run-row ai-run-${escapeHtml(status)}">
            <a class="ai-run-id" href="/experiments/runs/${escapeHtml(id)}">${escapeHtml(id.slice(0, 12))}</a>
            <span class="ai-run-tpl">${escapeHtml(tpl)}</span>
            <span class="ai-run-status">${escapeHtml(status)}</span>
          </div>`;
      }).join("");
      els.runsPanel.innerHTML = rows;
    } catch (e) {
      els.runsPanel.innerHTML = `<div class="ai-empty">Runs error</div>`;
    }
  }

  // ─── Wiring ──────────────────────────────────────────────────────

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = els.input.value.trim();
    if (!message) return;
    els.input.value = "";
    await sendMessage(message);
  });

  els.newBtn.addEventListener("click", () => {
    state.sessionId = newSessionId();
    localStorage.setItem("lucid.ai.session", state.sessionId);
    loadSessions();
    loadHistory();
  });

  els.delBtn.addEventListener("click", async () => {
    if (!confirm("Delete this conversation?")) return;
    try {
      await fetch(`/api/ai/sessions/${encodeURIComponent(state.sessionId)}`, {
        method: "DELETE",
      });
    } catch {}
    state.sessionId = newSessionId();
    localStorage.setItem("lucid.ai.session", state.sessionId);
    await loadSessions();
    await loadHistory();
  });

  els.sessionSel.addEventListener("change", (e) => {
    switchSession(e.target.value);
  });

  // Push-to-talk: hold mic button.
  ["mousedown", "touchstart"].forEach((ev) =>
    els.mic.addEventListener(ev, (e) => {
      e.preventDefault();
      startRecording();
    })
  );
  ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach((ev) =>
    els.mic.addEventListener(ev, (e) => {
      e.preventDefault();
      stopRecording();
    })
  );

  // Init
  (async () => {
    setStatus("idle");
    await loadSessions();
    await loadHistory();
    refreshPanels();
    state.pollTimer = setInterval(refreshPanels, 5000);
  })();
})();

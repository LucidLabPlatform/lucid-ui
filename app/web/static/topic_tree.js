// Topic Tree page
document.querySelector('a[href="/topic-tree"]')?.classList.add('active');

const container = document.getElementById('topic-tree');

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function statusBadge(state) {
  if (!state) return '';
  const cls = state === 'online' || state === 'running' ? 'status-online' : 'status-offline';
  return `<span class="status-badge ${cls}" style="font-size:.65rem;margin-left:.4rem">${state}</span>`;
}

function topicList(topics, type) {
  const cls = `tt-type-${type}`;
  return topics.map(t =>
    `<div class="tt-topic ${cls}"><span class="tt-badge tt-badge-${type}">${type}</span><code class="tt-path">${escHtml(t)}</code></div>`
  ).join('');
}

function renderSection(label, topics) {
  if (!topics || !topics.length) return '';
  return `
    <details class="tt-section" open>
      <summary class="tt-section-label">${label} <span class="tt-count">${topics.length}</span></summary>
      <div class="tt-section-body">${topicList(topics, label.toLowerCase())}</div>
    </details>`;
}

async function loadTree() {
  try {
    const res = await fetch('/api/topic-tree');
    if (!res.ok) throw new Error(res.statusText);
    const agents = await res.json();

    if (!agents.length) {
      container.innerHTML = '<div class="empty">No agents found</div>';
      return;
    }

    container.innerHTML = agents.map(agent => {
      const compHtml = (agent.components || []).map(comp => `
        <details class="tt-component">
          <summary class="tt-comp-header">
            <span class="tt-comp-id">${escHtml(comp.component_id)}</span>
            ${statusBadge(comp.status)}
            <span class="tt-comp-prefix">${escHtml(comp.prefix)}</span>
          </summary>
          <div class="tt-comp-body">
            ${renderSection('Retained', comp.topics.retained)}
            ${renderSection('Streams', comp.topics.streams)}
            ${renderSection('Commands', comp.topics.commands)}
            ${renderSection('Events', comp.topics.events)}
          </div>
        </details>
      `).join('');

      return `
        <div class="panel tt-agent">
          <details open>
            <summary class="tt-agent-header">
              <h2 class="tt-agent-id">${escHtml(agent.agent_id)}</h2>
              ${statusBadge(agent.status)}
              <span class="tt-agent-prefix">${escHtml(agent.prefix)}</span>
            </summary>
            <div class="tt-agent-body">
              ${renderSection('Retained', agent.topics.retained)}
              ${renderSection('Streams', agent.topics.streams)}
              ${renderSection('Commands', agent.topics.commands)}
              ${renderSection('Events', agent.topics.events)}
              ${compHtml ? `<h3 class="tt-comp-heading">Components</h3>${compHtml}` : ''}
            </div>
          </details>
        </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div class="empty">Error loading topic tree: ${escHtml(e.message)}</div>`;
  }
}

loadTree();

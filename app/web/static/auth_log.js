// Auth log page
document.querySelector('a[href="/auth-log"]')?.classList.add('active');

const tbody    = document.getElementById('log-tbody');
const metaEl   = document.getElementById('log-meta');
const search   = document.getElementById('search');
const fType    = document.getElementById('filter-type');
const fResult  = document.getElementById('filter-result');

let allRows = [];

function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false }) + ' ' +
         d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function render() {
  const q  = search.value.toLowerCase();
  const ft = fType.value;
  const fr = fResult.value;

  const rows = allRows.filter(r =>
    (!q  || `${r.username}${r.topic ?? ''}${r.clientid}`.toLowerCase().includes(q)) &&
    (!ft || r.type === ft) &&
    (!fr || r.result === fr)
  );

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No entries</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td style="color:var(--muted);white-space:nowrap">${fmt(r.ts)}</td>
      <td><span class="badge badge-${r.type}">${r.type}</span></td>
      <td style="font-family:var(--font-mono);font-size:0.78rem">${r.username}</td>
      <td style="color:var(--muted);font-size:0.75rem">${r.clientid}</td>
      <td style="color:var(--subtle);font-size:0.75rem">${r.topic ?? '—'}</td>
      <td style="color:var(--subtle);font-size:0.75rem">${r.action ?? '—'}</td>
      <td class="${r.result}">${r.result}</td>
    </tr>`).join('');
}

async function load() {
  const res = await fetch('/api/auth-log?limit=500');
  allRows = await res.json();
  metaEl.textContent = `${allRows.length} entries · refreshes every 5s`;
  render();
}

[search, fType, fResult].forEach(el => el.addEventListener('input', render));

load();
setInterval(load, 5000);

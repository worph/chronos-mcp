// State
let rules = [];
let editingRuleId = null;
let logsTab = 'all';
let logsRuleId = null;
let logsRuleName = '';

// ── Status polling ────────────────────────────────────────────────────────────

async function updateStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const status = await res.json();

    document.getElementById('stat-active').textContent = status.activeRules;
    document.getElementById('stat-total').textContent = status.totalRules;

    const last = status.lastExecution;
    if (last) {
      document.getElementById('stat-last-status').textContent = last.status === 'success' ? '✓' : '✗';
      document.getElementById('stat-last-status').style.color = last.status === 'success' ? '#28a745' : '#dc3545';
      document.getElementById('stat-last-time').textContent = formatTime(last.triggeredAt);
    } else {
      document.getElementById('stat-last-status').textContent = '–';
      document.getElementById('stat-last-time').textContent = '–';
    }
  } catch (e) {
    console.error('Status error:', e);
  }
}

// ── Rules ─────────────────────────────────────────────────────────────────────

async function loadRules() {
  try {
    const res = await fetch('/api/rules');
    if (!res.ok) throw new Error('Failed to load rules');
    rules = await res.json();
    renderRules();
  } catch (e) {
    showToast('Failed to load rules: ' + e.message, 'error');
  }
}

function renderRules() {
  const container = document.getElementById('rules-list');
  if (rules.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">⏰</div>
        <div>No rules yet. Add your first scheduled rule above.</div>
      </div>`;
    return;
  }

  container.innerHTML = rules.map(rule => `
    <div class="rule-card ${rule.enabled ? '' : 'disabled'}" id="rule-${rule.id}">
      <label class="toggle" title="${rule.enabled ? 'Disable' : 'Enable'}">
        <input type="checkbox" ${rule.enabled ? 'checked' : ''} onchange="toggleRule('${rule.id}')">
        <span class="toggle-slider"></span>
      </label>
      <div class="rule-info">
        <div class="rule-name">${escHtml(rule.name)}</div>
        <div class="rule-meta">
          <span>⏱ <code>${escHtml(rule.schedule)}</code></span>
          <span>⚡ <code>${escHtml(rule.tool)}</code></span>
          <span>🔌 ${escHtml(rule.target.transport)}${rule.target.url ? ` · <code>${escHtml(rule.target.url)}</code>` : rule.target.command ? ` · <code>${escHtml(rule.target.command)}</code>` : ''}</span>
        </div>
      </div>
      <div class="rule-actions">
        <button class="btn-icon btn-sm" title="Run now" onclick="triggerRule('${rule.id}', '${escAttr(rule.name)}')">▶</button>
        <button class="btn-icon btn-sm" title="Logs" onclick="viewRuleLogs('${rule.id}', '${escAttr(rule.name)}')">📋</button>
        <button class="btn-icon btn-sm" title="Edit" onclick="openEditModal('${rule.id}')">✏️</button>
        <button class="btn-icon btn-sm" title="Delete" onclick="deleteRule('${rule.id}', '${escAttr(rule.name)}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function toggleRule(id) {
  try {
    const res = await fetch(`/api/rules/${id}/toggle`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to toggle');
    await loadRules();
  } catch (e) {
    showToast('Failed to toggle rule: ' + e.message, 'error');
  }
}

async function triggerRule(id, name) {
  try {
    const res = await fetch(`/api/rules/${id}/trigger`, { method: 'POST' });
    if (!res.ok) throw new Error('Trigger failed');
    showToast(`"${name}" triggered`);
    setTimeout(loadLogs, 500);
  } catch (e) {
    showToast('Trigger failed: ' + e.message, 'error');
  }
}

async function deleteRule(id, name) {
  if (!confirm(`Delete rule "${name}"?`)) return;
  try {
    const res = await fetch(`/api/rules/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    showToast(`"${name}" deleted`);
    await loadRules();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

function viewRuleLogs(id, name) {
  logsTab = 'rule';
  logsRuleId = id;
  logsRuleName = name;

  // Expand logs card
  const body = document.getElementById('logs-body');
  const header = document.querySelector('#logs-body').previousElementSibling;
  body.classList.remove('hidden');
  header.classList.remove('collapsed');

  // Show rule tab
  const ruleTab = document.getElementById('rule-logs-tab');
  ruleTab.style.display = '';
  ruleTab.textContent = name;

  // Activate rule tab
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  ruleTab.classList.add('active');

  loadLogs();
  ruleTab.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openAddModal() {
  editingRuleId = null;
  document.getElementById('modal-title').textContent = 'Add Rule';
  clearForm();
  document.getElementById('rule-modal').classList.remove('hidden');
}

function openEditModal(id) {
  const rule = rules.find(r => r.id === id);
  if (!rule) return;

  editingRuleId = id;
  document.getElementById('modal-title').textContent = 'Edit Rule';
  fillForm(rule);
  document.getElementById('rule-modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('rule-modal').classList.add('hidden');
  editingRuleId = null;
}

function clearForm() {
  document.getElementById('f-name').value = '';
  document.getElementById('f-schedule').value = '';
  document.getElementById('f-tool').value = '';
  document.getElementById('f-params').value = '{}';
  document.getElementById('f-transport').value = 'http';
  document.getElementById('f-url').value = '';
  document.getElementById('f-auth').value = '';
  document.getElementById('f-url-sse').value = '';
  document.getElementById('f-auth-sse').value = '';
  document.getElementById('f-command').value = '';
  document.getElementById('f-args').value = '[]';
  document.getElementById('f-enabled').checked = true;
  onTransportChange();
}

function fillForm(rule) {
  document.getElementById('f-name').value = rule.name;
  document.getElementById('f-schedule').value = rule.schedule;
  document.getElementById('f-tool').value = rule.tool;
  document.getElementById('f-params').value = JSON.stringify(rule.params, null, 2);
  document.getElementById('f-transport').value = rule.target.transport;
  document.getElementById('f-url').value = rule.target.url || '';
  document.getElementById('f-auth').value = rule.target.authToken || '';
  document.getElementById('f-url-sse').value = rule.target.url || '';
  document.getElementById('f-auth-sse').value = rule.target.authToken || '';
  document.getElementById('f-command').value = rule.target.command || '';
  document.getElementById('f-args').value = JSON.stringify(rule.target.args || []);
  document.getElementById('f-enabled').checked = rule.enabled;
  onTransportChange();
}

function onTransportChange() {
  const transport = document.getElementById('f-transport').value;
  document.querySelectorAll('.transport-fields').forEach(el => el.classList.remove('active'));
  const active = document.getElementById(`tf-${transport}`);
  if (active) active.classList.add('active');
}

async function saveRule() {
  const name = document.getElementById('f-name').value.trim();
  const schedule = document.getElementById('f-schedule').value.trim();
  const tool = document.getElementById('f-tool').value.trim();
  const transport = document.getElementById('f-transport').value;
  const enabled = document.getElementById('f-enabled').checked;

  if (!name || !schedule || !tool) {
    showToast('Name, schedule, and tool are required', 'error');
    return;
  }

  let params;
  try {
    params = JSON.parse(document.getElementById('f-params').value || '{}');
  } catch {
    showToast('Invalid JSON in Parameters', 'error');
    return;
  }

  const target = { transport };

  if (transport === 'stdio') {
    target.command = document.getElementById('f-command').value.trim();
    try {
      target.args = JSON.parse(document.getElementById('f-args').value || '[]');
    } catch {
      showToast('Invalid JSON in Args', 'error');
      return;
    }
  } else if (transport === 'sse') {
    target.url = document.getElementById('f-url-sse').value.trim();
    const auth = document.getElementById('f-auth-sse').value.trim();
    if (auth) target.authToken = auth;
  } else {
    target.url = document.getElementById('f-url').value.trim();
    const auth = document.getElementById('f-auth').value.trim();
    if (auth) target.authToken = auth;
  }

  const body = { name, schedule, tool, params, target, enabled };

  try {
    let res;
    if (editingRuleId) {
      res = await fetch(`/api/rules/${editingRuleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result.error));

    showToast(editingRuleId ? 'Rule updated' : 'Rule created');
    closeModal();
    await loadRules();
  } catch (e) {
    showToast('Failed to save: ' + e.message, 'error');
  }
}

// ── Logs ──────────────────────────────────────────────────────────────────────

async function loadLogs() {
  try {
    let url;
    if (logsTab === 'rule' && logsRuleId) {
      url = `/api/rules/${logsRuleId}/logs?limit=50`;
    } else {
      url = '/api/logs?limit=100';
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load logs');
    const logs = await res.json();
    renderLogs(logs);
  } catch (e) {
    console.error('Failed to load logs:', e);
  }
}

function renderLogs(logs) {
  const container = document.getElementById('logs-list');
  if (logs.length === 0) {
    container.innerHTML = '<div class="empty-state"><div>No executions yet.</div></div>';
    return;
  }

  container.innerHTML = logs.map(log => `
    <div class="log-entry">
      <div class="log-status">
        <span class="${log.status === 'success' ? 'badge-success' : 'badge-error'}">
          ${log.status === 'success' ? '✓' : '✗'}
        </span>
      </div>
      <div class="log-info">
        <div class="log-rule">${escHtml(log.ruleName)}</div>
        <div class="log-time">${formatTime(log.triggeredAt)}</div>
        ${log.error ? `<div class="log-detail" style="color:#dc3545">${escHtml(log.error)}</div>` : ''}
        ${log.result ? `<div class="log-detail">${escHtml(summarize(log.result))}</div>` : ''}
      </div>
      <div class="log-duration">${log.durationMs}ms</div>
    </div>
  `).join('');
}

function switchLogsTab(tab, btn) {
  logsTab = tab;
  if (tab === 'all') {
    logsRuleId = null;
    logsRuleName = '';
  }
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  loadLogs();
}

// ── Collapsible ───────────────────────────────────────────────────────────────

function toggleAbout(bodyId, header) {
  document.getElementById(bodyId).classList.toggle('hidden');
  header.classList.toggle('collapsed');
}

function toggleCard(bodyId, header) {
  document.getElementById(bodyId).classList.toggle('hidden');
  header.classList.toggle('collapsed');
  if (!document.getElementById(bodyId).classList.contains('hidden')) {
    if (bodyId === 'logs-body') loadLogs();
    if (bodyId === 'mcp-server-body') loadMcpServerInfo();
  }
}

// ── MCP Server Info ──────────────────────────────────────────────────────────

async function loadMcpServerInfo() {
  try {
    const res = await fetch('/api/mcp-server-info');
    if (!res.ok) throw new Error('Failed to load MCP server info');
    const info = await res.json();
    renderMcpServerInfo(info);
  } catch (e) {
    document.getElementById('mcp-server-info').innerHTML =
      `<p style="color:#dc3545;font-size:13px">Failed to load MCP server info</p>`;
  }
}

function renderMcpServerInfo(info) {
  const container = document.getElementById('mcp-server-info');
  const configJson = JSON.stringify(info.claudeConfig, null, 2);

  container.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:#333">Endpoints</div>
      <div class="endpoint-row">
        <label>HTTP (Streamable)</label>
        <code id="mcp-http-url">${escHtml(info.httpUrl)}</code>
        <button class="btn-copy" onclick="copyText('mcp-http-url')">Copy</button>
      </div>
      <div class="endpoint-row">
        <label>SSE</label>
        <code id="mcp-sse-url">${escHtml(info.sseUrl)}</code>
        <button class="btn-copy" onclick="copyText('mcp-sse-url')">Copy</button>
      </div>
    </div>

    <div style="margin-bottom:16px">
      <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:#333">Available Tools (${info.tools.length})</div>
      <div class="tool-list">
        ${info.tools.map(t => `<span class="tool-item" title="${escHtml(t.description)}">${escHtml(t.name)}</span>`).join('')}
      </div>
    </div>

    <div>
      <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:#333">Claude Desktop Config</div>
      <div class="config-block" id="mcp-config-block">
        <button class="btn-copy" onclick="copyBlock('mcp-config-block')">Copy</button>${escHtml(configJson)}
      </div>
    </div>
  `;
}

function copyText(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent.trim()).then(() => {
    showToast('Copied to clipboard');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
}

function copyBlock(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  // Get text content excluding the copy button
  const clone = el.cloneNode(true);
  const btn = clone.querySelector('.btn-copy');
  if (btn) btn.remove();
  navigator.clipboard.writeText(clone.textContent.trim()).then(() => {
    showToast('Copied to clipboard');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str ?? '').replace(/'/g, "\\'");
}

function formatTime(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleString();
}

function summarize(result) {
  if (!result) return '';
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  return str.length > 120 ? str.slice(0, 120) + '…' : str;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadRules();
  updateStatus();
  setInterval(updateStatus, 3000);
});

// Close modal on overlay click
document.getElementById('rule-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

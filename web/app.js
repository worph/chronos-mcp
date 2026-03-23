// State
let rules = [];
let editingRuleId = null;
let logsTab = 'all';
let logsRuleId = null;
let logsRuleName = '';
let cronMode = 'simple';
let _beaconServers = [];

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
  document.getElementById('f-schedule-value').value = '';
  document.getElementById('f-tool').value = '';
  document.getElementById('f-params').value = '{}';
  document.getElementById('f-transport').value = 'http';
  document.getElementById('f-url').value = '';
  document.getElementById('f-auth').value = '';
  document.getElementById('f-command').value = '';
  document.getElementById('f-args').value = '[]';
  document.getElementById('f-enabled').checked = true;
  onTransportChange();

  // Reset cron selector
  setCronMode('simple');
  document.getElementById('cron-frequency').value = 'day';
  document.getElementById('cron-hour').value = '0';
  document.getElementById('cron-minute').value = '0';
  updateBuilderVisibility();
  document.querySelectorAll('.cron-preset-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('cron-next-runs').classList.add('hidden');

  // Reset beacon
  document.getElementById('beacon-servers').innerHTML = '';
  document.getElementById('beacon-tools').innerHTML = '';
  document.getElementById('beacon-empty').classList.add('hidden');
  _beaconServers = [];
}

function fillForm(rule) {
  document.getElementById('f-name').value = rule.name;
  document.getElementById('f-tool').value = rule.tool;
  document.getElementById('f-params').value = JSON.stringify(rule.params, null, 2);
  document.getElementById('f-transport').value = rule.target.transport;
  document.getElementById('f-url').value = rule.target.url || '';
  document.getElementById('f-auth').value = rule.target.authToken || '';
  document.getElementById('f-command').value = rule.target.command || '';
  document.getElementById('f-args').value = JSON.stringify(rule.target.args || []);
  document.getElementById('f-enabled').checked = rule.enabled;
  onTransportChange();

  // Set cron schedule
  setCronMode('simple');
  setCronExpression(rule.schedule);
}

function onTransportChange() {
  const transport = document.getElementById('f-transport').value;
  document.querySelectorAll('.transport-fields').forEach(el => el.classList.remove('active'));
  const active = document.getElementById(`tf-${transport}`);
  if (active) active.classList.add('active');
}

async function saveRule() {
  const name = document.getElementById('f-name').value.trim();
  const schedule = (cronMode === 'advanced'
    ? document.getElementById('f-schedule').value
    : document.getElementById('f-schedule-value').value
  ).trim();
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

// ── Cron Selector ────────────────────────────────────────────────────────────

function initCronBuilder() {
  const hourSel = document.getElementById('cron-hour');
  const minSel = document.getElementById('cron-minute');
  const mdaySel = document.getElementById('cron-monthday');

  hourSel.innerHTML = '';
  for (let h = 0; h < 24; h++) {
    hourSel.innerHTML += `<option value="${h}">${String(h).padStart(2, '0')}</option>`;
  }

  minSel.innerHTML = '';
  for (let m = 0; m < 60; m += 5) {
    minSel.innerHTML += `<option value="${m}">${String(m).padStart(2, '0')}</option>`;
  }

  mdaySel.innerHTML = '';
  for (let d = 1; d <= 28; d++) {
    mdaySel.innerHTML += `<option value="${d}">${d}</option>`;
  }
}

function setCronMode(mode) {
  cronMode = mode;
  document.querySelectorAll('.cron-mode-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.cron-mode-btn[onclick*="${mode}"]`).classList.add('active');

  document.getElementById('cron-simple').classList.toggle('hidden', mode !== 'simple');
  document.getElementById('cron-advanced').classList.toggle('hidden', mode !== 'advanced');

  if (mode === 'advanced') {
    // Sync hidden value to the visible input
    document.getElementById('f-schedule').value = document.getElementById('f-schedule-value').value;
  } else {
    // Try to parse advanced input back into builder
    const expr = document.getElementById('f-schedule').value.trim();
    if (expr) {
      setCronExpression(expr);
    }
  }
}

function applyCronPreset(expr, btn) {
  document.querySelectorAll('.cron-preset-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  setCronExpression(expr);
  updateCronPreview(expr);
}

function setCronExpression(expr) {
  document.getElementById('f-schedule-value').value = expr;
  document.getElementById('f-schedule').value = expr;

  // Try to reverse-parse into builder
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return;

  const [min, hour, dom, , dow] = parts;
  const freq = document.getElementById('cron-frequency');

  if (min === '*' && hour === '*') {
    freq.value = 'minute';
  } else if (min.match(/^\d+$/) && hour === '*') {
    freq.value = 'hour';
    document.getElementById('cron-minute').value = min;
  } else if (min.match(/^\d+$/) && hour.match(/^\d+$/) && dom === '*' && dow === '*') {
    freq.value = 'day';
    document.getElementById('cron-hour').value = hour;
    document.getElementById('cron-minute').value = nearestMinOption(min);
  } else if (min.match(/^\d+$/) && hour.match(/^\d+$/) && dow !== '*') {
    freq.value = 'week';
    document.getElementById('cron-hour').value = hour;
    document.getElementById('cron-minute').value = nearestMinOption(min);
    document.getElementById('cron-weekday').value = dow.split('-')[0].split(',')[0];
  } else if (min.match(/^\d+$/) && hour.match(/^\d+$/) && dom !== '*') {
    freq.value = 'month';
    document.getElementById('cron-hour').value = hour;
    document.getElementById('cron-minute').value = nearestMinOption(min);
    document.getElementById('cron-monthday').value = dom;
  }

  updateBuilderVisibility();
  updateCronPreview(expr);
}

function nearestMinOption(val) {
  const n = parseInt(val);
  // Snap to nearest 5-minute option
  return String(Math.round(n / 5) * 5 % 60);
}

function updateBuilderVisibility() {
  const freq = document.getElementById('cron-frequency').value;
  const showTime = freq !== 'minute';
  const showWeekday = freq === 'week';
  const showMonthday = freq === 'month';

  document.getElementById('cron-at-label').classList.toggle('hidden', !showTime);
  document.getElementById('cron-hour').classList.toggle('hidden', !showTime);
  document.getElementById('cron-colon').classList.toggle('hidden', !showTime);
  document.getElementById('cron-minute').classList.toggle('hidden', freq === 'minute');

  document.getElementById('cron-on-label').classList.toggle('hidden', !showWeekday && !showMonthday);
  document.getElementById('cron-weekday').classList.toggle('hidden', !showWeekday);
  document.getElementById('cron-monthday').classList.toggle('hidden', !showMonthday);

  // For hourly, hide hour selector and only show minute
  document.getElementById('cron-hour').classList.toggle('hidden', freq === 'hour' || freq === 'minute');
  document.getElementById('cron-colon').classList.toggle('hidden', freq === 'hour' || freq === 'minute');
  if (freq === 'hour') {
    document.getElementById('cron-at-label').textContent = 'at minute';
  } else {
    document.getElementById('cron-at-label').textContent = 'at';
  }
}

function updateCronFromBuilder() {
  updateBuilderVisibility();

  const freq = document.getElementById('cron-frequency').value;
  const min = document.getElementById('cron-minute').value;
  const hour = document.getElementById('cron-hour').value;
  const weekday = document.getElementById('cron-weekday').value;
  const monthday = document.getElementById('cron-monthday').value;

  let expr;
  switch (freq) {
    case 'minute':  expr = '* * * * *'; break;
    case 'hour':    expr = `${min} * * * *`; break;
    case 'day':     expr = `${min} ${hour} * * *`; break;
    case 'week':    expr = `${min} ${hour} * * ${weekday}`; break;
    case 'month':   expr = `${min} ${hour} ${monthday} * *`; break;
    default:        expr = '* * * * *';
  }

  document.getElementById('f-schedule-value').value = expr;
  document.getElementById('f-schedule').value = expr;

  // Clear active preset
  document.querySelectorAll('.cron-preset-btn').forEach(b => b.classList.remove('active'));

  updateCronPreview(expr);
}

function updateCronPreview(expr) {
  const container = document.getElementById('cron-next-runs');
  const list = document.getElementById('cron-next-list');

  try {
    const runs = getNextCronRuns(expr, 3);
    if (runs.length === 0) throw new Error('Invalid');

    container.classList.remove('hidden', 'invalid');
    list.innerHTML = runs.map(d =>
      `<div class="next-item">${d.toLocaleString()}</div>`
    ).join('');
  } catch {
    container.classList.remove('hidden');
    container.classList.add('invalid');
    list.innerHTML = '<div>Invalid cron expression</div>';
  }
}

/**
 * Simple cron next-run calculator for 5-field expressions.
 * Handles: specific values, *, ranges (1-5), steps (*​/5), lists (1,3,5).
 */
function getNextCronRuns(expr, count) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Invalid cron');

  const fields = parts.map(parseCronField);
  const [minF, hourF, domF, monF, dowF] = fields;

  const results = [];
  const now = new Date();
  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1, 0, 0);

  const maxIter = 525960; // ~1 year of minutes
  for (let i = 0; i < maxIter && results.length < count; i++) {
    const m = cursor.getMinutes();
    const h = cursor.getHours();
    const dom = cursor.getDate();
    const mon = cursor.getMonth() + 1;
    const dow = cursor.getDay();

    if (minF.has(m) && hourF.has(h) && domF.has(dom) && monF.has(mon) && dowF.has(dow)) {
      results.push(new Date(cursor));
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return results;
}

function parseCronField(field) {
  const values = new Set();
  const ranges = { minute: [0, 59], hour: [0, 23], dom: [1, 31], month: [1, 12], dow: [0, 6] };

  // Determine field index from caller — not available here, so use generic approach
  for (const part of field.split(',')) {
    if (part === '*') {
      // Will be handled with range below
      return new Set(Array.from({ length: 60 }, (_, i) => i)); // max range, will be intersected
    }

    const stepMatch = part.match(/^(\*|\d+-\d+)\/(\d+)$/);
    if (stepMatch) {
      let [start, end] = stepMatch[1] === '*' ? [0, 59] : stepMatch[1].split('-').map(Number);
      const step = Number(stepMatch[2]);
      for (let i = start; i <= end; i += step) values.add(i);
      continue;
    }

    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const [, a, b] = rangeMatch;
      for (let i = Number(a); i <= Number(b); i++) values.add(i);
      continue;
    }

    if (/^\d+$/.test(part)) {
      values.add(Number(part));
    }
  }

  return values.size > 0 ? values : new Set(Array.from({ length: 60 }, (_, i) => i));
}

// ── Beacon Discovery ─────────────────────────────────────────────────────────

// Template variable mapping for auto-generating params from tool schemas
const TEMPLATE_MAP = {
  now: '{{now}}',
  date: '{{date}}',
  time: '{{time}}',
  timestamp: '{{timestamp}}',
  year: '{{year}}',
  month: '{{month}}',
  day: '{{day}}',
  hour: '{{hour}}',
  minute: '{{minute}}',
  second: '{{second}}',
  text: '{{now}}',
  message: '{{now}}',
  prompt: '{{now}}',
};

function generateParamsFromSchema(inputSchema) {
  if (!inputSchema || !inputSchema.properties) return {};

  const params = {};
  const required = new Set(inputSchema.required || []);

  for (const [key] of Object.entries(inputSchema.properties)) {
    if (TEMPLATE_MAP[key]) {
      params[key] = TEMPLATE_MAP[key];
    } else if (required.has(key)) {
      params[key] = '';
    }
  }

  return params;
}

async function runBeaconDiscovery() {
  const loading = document.getElementById('beacon-loading');
  const empty = document.getElementById('beacon-empty');
  const serversDiv = document.getElementById('beacon-servers');
  const toolsDiv = document.getElementById('beacon-tools');
  const scanBtn = document.getElementById('beacon-scan-btn');

  loading.classList.remove('hidden');
  empty.classList.add('hidden');
  serversDiv.innerHTML = '';
  toolsDiv.innerHTML = '';
  scanBtn.disabled = true;
  scanBtn.textContent = 'Scanning...';

  try {
    const response = await fetch('/api/beacon/discover');
    const { servers } = await response.json();

    if (!servers || servers.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    _beaconServers = servers;

    serversDiv.innerHTML = servers.map((s, i) => `
      <div class="beacon-server-item ${i === 0 ? 'selected' : ''}" onclick="selectBeaconServer(${i})" data-index="${i}">
        <div class="beacon-server-name">${escHtml(s.name)}</div>
        <div class="beacon-server-desc">${escHtml(s.description)}</div>
        <div class="beacon-server-url">${escHtml(s.url)}</div>
      </div>
    `).join('');

    selectBeaconServer(0);
  } catch (err) {
    showToast('Discovery failed: ' + err.message, 'error');
  } finally {
    loading.classList.add('hidden');
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan Network';
  }
}

function selectBeaconServer(index) {
  if (!_beaconServers[index]) return;

  const server = _beaconServers[index];

  document.querySelectorAll('.beacon-server-item').forEach((el, i) => {
    el.classList.toggle('selected', i === index);
  });

  const toolsDiv = document.getElementById('beacon-tools');
  if (server.tools && server.tools.length > 0) {
    toolsDiv.innerHTML =
      '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Tools</div>' +
      server.tools.map((t, i) => `
        <div class="beacon-tool-item" onclick="selectBeaconTool(${index}, ${i})" data-server="${index}" data-tool="${i}">
          <div class="beacon-tool-name">${escHtml(t.name)}</div>
          <div class="beacon-tool-desc">${escHtml(t.description || '')}</div>
        </div>
      `).join('');
  } else {
    toolsDiv.innerHTML = '<div style="color:#6c757d;font-size:13px;">No tools advertised by this server.</div>';
  }
}

function selectBeaconTool(serverIndex, toolIndex) {
  const server = _beaconServers[serverIndex];
  const tool = server.tools[toolIndex];

  document.querySelectorAll('.beacon-tool-item').forEach((el) => {
    const ti = parseInt(el.dataset.tool);
    el.classList.toggle('selected', ti === toolIndex);
  });

  // Auto-fill the form fields
  document.getElementById('f-transport').value = 'http';
  onTransportChange();
  document.getElementById('f-url').value = server.url;
  document.getElementById('f-auth').value = '';
  document.getElementById('f-tool').value = tool.name;
  document.getElementById('f-params').value = JSON.stringify(
    generateParamsFromSchema(tool.inputSchema), null, 2
  );

  showToast(`Selected tool: ${tool.name}`);
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadRules();
  updateStatus();
  setInterval(updateStatus, 3000);
  initCronBuilder();

  // Sync advanced cron input to hidden value + preview
  document.getElementById('f-schedule').addEventListener('input', function() {
    const expr = this.value.trim();
    document.getElementById('f-schedule-value').value = expr;
    if (expr) updateCronPreview(expr);
  });
});

// Close modal on overlay click
document.getElementById('rule-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

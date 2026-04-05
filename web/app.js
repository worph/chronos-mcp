// State
let rules = [];
let editingRuleId = null;
let logsTab = 'all';
let logsRuleId = null;
let logsRuleName = '';
let cronMode = 'simple';
let _beaconServers = [];

// Tier state
let currentTier = 3;
let _claudeDetection = null;   // { server, tool, promptParamName }
let _selectedTier2 = null;     // { server, tool }
let _tier2Servers = [];
let _beaconCache = null;       // { servers, timestamp }

// ── Claude / LLM Detection ──────────────────────────────────────────────────

const CLAUDE_TOOL_PATTERNS = [
  /^(query_?claude|ask_?claude|claude_?query|prompt_?claude)$/i,
  /^(llm_?prompt|llm_?query|send_?prompt|run_?prompt)$/i,
  /^(ask_?llm|query_?llm|chat|complete|generate)$/i,
  /claude/i,
];

const CLAUDE_DESCRIPTION_KEYWORDS = [
  'claude', 'llm', 'language model', 'anthropic',
  'send a prompt', 'query claude', 'natural language',
  'ai prompt', 'ask claude',
];

const PROMPT_PARAM_NAMES = ['prompt', 'message', 'query', 'text', 'input', 'content', 'question'];

function detectClaudeTool(servers) {
  for (const server of servers) {
    for (const tool of server.tools || []) {
      const nameMatch = CLAUDE_TOOL_PATTERNS.some(p => p.test(tool.name));
      const descMatch = CLAUDE_DESCRIPTION_KEYWORDS.some(kw =>
        (tool.description || '').toLowerCase().includes(kw)
      );
      if (nameMatch || descMatch) {
        return { server, tool };
      }
    }
  }
  return null;
}

function findPromptParam(inputSchema) {
  if (!inputSchema || !inputSchema.properties) return null;

  // First pass: known prompt param names
  for (const name of PROMPT_PARAM_NAMES) {
    if (inputSchema.properties[name] && inputSchema.properties[name].type === 'string') {
      return name;
    }
  }

  // Second pass: single required string param
  const required = inputSchema.required || [];
  const stringParams = Object.entries(inputSchema.properties)
    .filter(([, v]) => v.type === 'string');

  if (stringParams.length === 1) return stringParams[0][0];

  const requiredStrings = stringParams.filter(([k]) => required.includes(k));
  if (requiredStrings.length === 1) return requiredStrings[0][0];

  return null;
}

function classifyRule(rule) {
  const isLLMTool = CLAUDE_TOOL_PATTERNS.some(p => p.test(rule.tool)) ||
    CLAUDE_DESCRIPTION_KEYWORDS.some(kw => rule.tool.toLowerCase().includes(kw));

  if (isLLMTool && rule.params) {
    const promptParam = PROMPT_PARAM_NAMES.find(name =>
      typeof rule.params[name] === 'string' && rule.params[name].length > 0
    );
    if (promptParam) return { type: 'claude', promptParam };
  }

  return { type: 'standard' };
}

// ── Tier Management ──────────────────────────────────────────────────────────

function setTier(tier) {
  const prev = currentTier;
  currentTier = tier;

  const t1 = document.getElementById('tier1-section');
  const t2 = document.getElementById('tier2-section');
  const t3 = document.getElementById('tier3-section');
  const status = document.getElementById('tier-status');
  const scanning = document.getElementById('tier-scanning');

  scanning.classList.add('hidden');

  // Copy data between tiers when switching
  if (prev === 1 && tier === 3 && _claudeDetection) {
    // Copy prompt into JSON params + fill tool/target
    const prompt = document.getElementById('f-prompt').value;
    const paramName = _claudeDetection.promptParamName || 'prompt';
    document.getElementById('f-tool').value = _claudeDetection.tool.name;
    document.getElementById('f-params').value = JSON.stringify({ [paramName]: prompt }, null, 2);
    document.getElementById('f-transport').value = 'http';
    document.getElementById('f-url').value = _claudeDetection.server.url;
    document.getElementById('f-auth').value = '';
    onTransportChange();
  } else if (prev === 3 && tier === 1 && _claudeDetection) {
    // Extract prompt from JSON params
    try {
      const params = JSON.parse(document.getElementById('f-params').value || '{}');
      const paramName = _claudeDetection.promptParamName || 'prompt';
      if (params[paramName]) {
        document.getElementById('f-prompt').value = params[paramName];
      }
    } catch { /* ignore */ }
  } else if (prev === 2 && tier === 3 && _selectedTier2) {
    // Copy tier 2 selection into tier 3 fields
    document.getElementById('f-tool').value = _selectedTier2.tool.name;
    document.getElementById('f-transport').value = 'http';
    document.getElementById('f-url').value = _selectedTier2.server.url;
    document.getElementById('f-auth').value = '';
    onTransportChange();
    // Copy smart params into JSON
    const params = gatherTier2Params();
    if (params) {
      document.getElementById('f-params').value = JSON.stringify(params, null, 2);
    }
  }

  // Show/hide sections
  t1.classList.toggle('hidden', tier !== 1);
  t2.classList.toggle('hidden', tier !== 2);
  t3.classList.toggle('hidden', tier !== 3);

  // Update status line
  updateTierStatus();
}

function updateTierStatus() {
  const status = document.getElementById('tier-status');

  if (currentTier === 1 && _claudeDetection) {
    status.className = 'tier-status connected';
    status.innerHTML = `
      <span class="tier-status-dot"></span>
      <span>Claude connected via beacon</span>
      <button type="button" class="tier-status-action" onclick="switchToTier2()">Use different tool</button>
    `;
    status.classList.remove('hidden');
  } else if (currentTier === 2 && _tier2Servers.length > 0) {
    status.className = 'tier-status beacon';
    const serverCount = _tier2Servers.length;
    const toolCount = _tier2Servers.reduce((n, s) => n + (s.tools || []).length, 0);
    status.innerHTML = `
      <span class="tier-status-dot"></span>
      <span>${serverCount} server${serverCount > 1 ? 's' : ''} found (${toolCount} tools)</span>
      <button type="button" class="tier-status-action" onclick="setTier(3)">Configure manually</button>
    `;
    status.classList.remove('hidden');
  } else if (currentTier === 3) {
    if (_tier2Servers.length > 0 || _claudeDetection) {
      status.className = 'tier-status manual';
      const actions = [];
      if (_claudeDetection) actions.push('<button type="button" class="tier-status-action" onclick="setTier(1)">Claude mode</button>');
      if (_tier2Servers.length > 0) actions.push('<button type="button" class="tier-status-action" onclick="switchToTier2()">Beacon tools</button>');
      status.innerHTML = `
        <span>Manual configuration</span>
        <span style="margin-left:auto;display:flex;gap:12px">${actions.join('')}</span>
      `;
      status.classList.remove('hidden');
    } else {
      status.className = 'tier-status manual';
      status.innerHTML = `
        <span>No beacon servers found</span>
        <button type="button" class="tier-status-action" onclick="runBeaconRescan()">Scan again</button>
      `;
      status.classList.remove('hidden');
    }
  }
}

function switchToTier2() {
  if (_tier2Servers.length > 0) {
    setTier(2);
    renderTier2Tools(_tier2Servers);
  }
}

async function autoDetectTier() {
  const scanning = document.getElementById('tier-scanning');
  scanning.classList.remove('hidden');

  try {
    let servers;

    // Use cache if fresh (30 seconds)
    if (_beaconCache && Date.now() - _beaconCache.timestamp < 30000) {
      servers = _beaconCache.servers;
    } else {
      const response = await fetch('/api/beacon/discover');
      const data = await response.json();
      servers = data.servers || [];
      _beaconCache = { servers, timestamp: Date.now() };
    }

    scanning.classList.add('hidden');
    _tier2Servers = servers;
    _beaconServers = servers;

    if (servers.length === 0) {
      setTier(3);
      return;
    }

    const claude = detectClaudeTool(servers);
    if (claude) {
      _claudeDetection = {
        server: claude.server,
        tool: claude.tool,
        promptParamName: findPromptParam(claude.tool.inputSchema) || 'prompt',
      };
      setTier(1);
    } else {
      setTier(2);
      renderTier2Tools(servers);
    }
  } catch {
    scanning.classList.add('hidden');
    setTier(3);
  }
}

async function runBeaconRescan() {
  _beaconCache = null;
  await autoDetectTier();
}

// ── Tier 2: Tool Picker & Smart Params ───────────────────────────────────────

function renderTier2Tools(servers) {
  const container = document.getElementById('tier2-tools');
  const cards = [];

  servers.forEach((server, si) => {
    (server.tools || []).forEach((tool, ti) => {
      const isSelected = _selectedTier2 &&
        _selectedTier2.server.url === server.url &&
        _selectedTier2.tool.name === tool.name;
      cards.push(`
        <div class="tier2-tool-card ${isSelected ? 'selected' : ''}"
             onclick="selectTier2Tool(${si}, ${ti})"
             data-si="${si}" data-ti="${ti}">
          <div class="tier2-tool-card-name">${escHtml(tool.name)}</div>
          ${tool.description ? `<div class="tier2-tool-card-desc">${escHtml(tool.description)}</div>` : ''}
          ${servers.length > 1 ? `<div class="tier2-tool-card-server">${escHtml(server.name)}</div>` : ''}
        </div>
      `);
    });
  });

  if (cards.length === 0) {
    container.innerHTML = '<div style="color:#6c757d;font-size:13px;padding:12px;text-align:center">No tools found on discovered servers.</div>';
    return;
  }

  container.innerHTML = cards.join('');

  // Auto-select first tool if nothing selected
  if (!_selectedTier2 && servers[0] && servers[0].tools && servers[0].tools.length > 0) {
    selectTier2Tool(0, 0);
  }
}

function selectTier2Tool(serverIndex, toolIndex) {
  const server = _tier2Servers[serverIndex];
  if (!server) return;
  const tool = server.tools[toolIndex];
  if (!tool) return;

  _selectedTier2 = { server, tool };

  // Highlight selected card
  document.querySelectorAll('.tier2-tool-card').forEach(el => {
    el.classList.toggle('selected',
      parseInt(el.dataset.si) === serverIndex && parseInt(el.dataset.ti) === toolIndex
    );
  });

  renderSmartParams(tool.inputSchema);
}

function renderSmartParams(inputSchema) {
  const container = document.getElementById('tier2-params');

  if (!inputSchema || !inputSchema.properties) {
    container.innerHTML = `
      <label for="t2-json-params">Parameters (JSON)</label>
      <textarea id="t2-json-params" class="t2-json-params" placeholder='{"key": "value"}'>{}</textarea>
    `;
    return;
  }

  const props = Object.entries(inputSchema.properties);
  const required = new Set(inputSchema.required || []);

  // Single string property → simple textarea
  if (props.length === 1 && props[0][1].type === 'string') {
    const [key, schema] = props[0];
    container.innerHTML = `
      <label for="t2-smart-${key}">${escHtml(schema.description || key)}</label>
      <textarea id="t2-smart-${key}" class="smart-param-textarea" data-key="${escAttr(key)}"
        placeholder="${escAttr(schema.description || '')}">${escHtml(TEMPLATE_MAP[key] || '')}</textarea>
      <p class="hint">Template vars: <code>{{now}}</code> <code>{{date}}</code> <code>{{time}}</code></p>
    `;
    return;
  }

  // 2-4 simple properties → individual inputs
  const simpleTypes = ['string', 'number', 'integer', 'boolean'];
  const allSimple = props.length <= 4 && props.every(([, v]) => simpleTypes.includes(v.type));

  if (allSimple) {
    container.innerHTML = props.map(([key, schema]) => {
      const isReq = required.has(key);
      const defaultVal = TEMPLATE_MAP[key] || '';
      if (schema.type === 'boolean') {
        return `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="t2-smart-${key}" data-key="${escAttr(key)}" data-type="boolean" style="width:auto;margin:0">
            <span>${escHtml(schema.description || key)}${isReq ? ' *' : ''}</span>
          </label>
        `;
      }
      const inputType = schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text';
      return `
        <label for="t2-smart-${key}">${escHtml(schema.description || key)}${isReq ? ' *' : ''}</label>
        <input type="${inputType}" id="t2-smart-${key}" data-key="${escAttr(key)}" data-type="${schema.type}"
          placeholder="${escAttr(schema.description || key)}" value="${escAttr(defaultVal)}">
      `;
    }).join('') + '<p class="hint">Template vars: <code>{{now}}</code> <code>{{date}}</code> <code>{{time}}</code></p>';
    return;
  }

  // Complex → JSON textarea
  const generated = generateParamsFromSchema(inputSchema);
  container.innerHTML = `
    <label for="t2-json-params">Parameters (JSON)</label>
    <textarea id="t2-json-params" class="t2-json-params" placeholder='{"key": "value"}'>${escHtml(JSON.stringify(generated, null, 2))}</textarea>
    <p class="hint">Template vars: <code>{{now}}</code> <code>{{date}}</code> <code>{{time}}</code></p>
  `;
}

function gatherTier2Params() {
  // Check for JSON textarea fallback
  const jsonArea = document.getElementById('t2-json-params');
  if (jsonArea) {
    try {
      return JSON.parse(jsonArea.value || '{}');
    } catch {
      showToast('Invalid JSON in parameters', 'error');
      return null;
    }
  }

  // Gather from smart fields
  const params = {};
  document.querySelectorAll('[id^="t2-smart-"]').forEach(el => {
    const key = el.dataset.key;
    if (!key) return;
    if (el.dataset.type === 'boolean') {
      params[key] = el.checked;
    } else if (el.dataset.type === 'number' || el.dataset.type === 'integer') {
      params[key] = el.value ? Number(el.value) : '';
    } else if (el.tagName === 'TEXTAREA') {
      params[key] = el.value;
    } else {
      params[key] = el.value;
    }
  });

  return params;
}

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
        <div>No triggers yet. Add your first scheduled trigger above.</div>
      </div>`;
    return;
  }

  container.innerHTML = rules.map(rule => {
    const cls = classifyRule(rule);
    let metaHtml;

    if (cls.type === 'claude') {
      const promptText = rule.params[cls.promptParam] || '';
      metaHtml = `
        <div class="rule-meta">
          <span>⏱ <code>${escHtml(rule.schedule)}</code></span>
          <span class="rule-badge-claude">Claude</span>
        </div>
        <div class="rule-prompt">${escHtml(promptText)}</div>
      `;
    } else {
      metaHtml = `
        <div class="rule-meta">
          <span>⏱ <code>${escHtml(rule.schedule)}</code></span>
          <span>⚡ <code>${escHtml(rule.tool)}</code></span>
          <span>🔌 ${escHtml(rule.target.transport)}${rule.target.url ? ` · <code>${escHtml(rule.target.url)}</code>` : rule.target.command ? ` · <code>${escHtml(rule.target.command)}</code>` : ''}</span>
        </div>
      `;
    }

    return `
      <div class="rule-card ${rule.enabled ? '' : 'disabled'}" id="rule-${rule.id}">
        <label class="toggle" title="${rule.enabled ? 'Disable' : 'Enable'}">
          <input type="checkbox" ${rule.enabled ? 'checked' : ''} onchange="toggleRule('${rule.id}')">
          <span class="toggle-slider"></span>
        </label>
        <div class="rule-info">
          <div class="rule-name">${escHtml(rule.name)}</div>
          ${metaHtml}
        </div>
        <div class="rule-actions">
          <button class="btn-icon btn-sm" title="Run now" onclick="triggerRule('${rule.id}', '${escAttr(rule.name)}')">▶</button>
          <button class="btn-icon btn-sm" title="Logs" onclick="viewRuleLogs('${rule.id}', '${escAttr(rule.name)}')">📋</button>
          <button class="btn-icon btn-sm" title="Edit" onclick="openEditModal('${rule.id}')">✏️</button>
          <button class="btn-icon btn-sm" title="Delete" onclick="deleteRule('${rule.id}', '${escAttr(rule.name)}')">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
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

  // Show rule tab
  const ruleTab = document.getElementById('rule-logs-tab');
  ruleTab.style.display = '';
  ruleTab.textContent = name;

  // Activate rule tab
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  ruleTab.classList.add('active');

  // Open settings panel and load logs
  togglePanel('settings-panel');
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openAddModal() {
  editingRuleId = null;
  document.getElementById('modal-title').textContent = 'Add Trigger';
  clearForm();
  document.getElementById('rule-modal').classList.remove('hidden');
  autoDetectTier();
}

function openEditModal(id) {
  const rule = rules.find(r => r.id === id);
  if (!rule) return;

  editingRuleId = id;
  document.getElementById('modal-title').textContent = 'Edit Trigger';

  // Classify rule to determine which tier to show
  const cls = classifyRule(rule);

  // Fill the full form first (tier 3 fields)
  fillForm(rule);

  if (cls.type === 'claude') {
    // Fill prompt textarea
    document.getElementById('f-prompt').value = rule.params[cls.promptParam] || '';

    // Try to detect Claude server from beacon for proper state
    _claudeDetection = {
      server: { url: rule.target.url, name: 'Claude' },
      tool: { name: rule.tool, inputSchema: null },
      promptParamName: cls.promptParam,
    };
    currentTier = 3; // set before setTier to avoid unwanted data copy
    setTier(1);
  } else {
    currentTier = 3;
    setTier(3);
  }

  document.getElementById('rule-modal').classList.remove('hidden');

  // Background scan to refresh detection state
  autoDetectTier_background(rule);
}

async function autoDetectTier_background(rule) {
  // Silently scan beacon to update status line, but don't change tier
  try {
    let servers;
    if (_beaconCache && Date.now() - _beaconCache.timestamp < 30000) {
      servers = _beaconCache.servers;
    } else {
      const response = await fetch('/api/beacon/discover');
      const data = await response.json();
      servers = data.servers || [];
      _beaconCache = { servers, timestamp: Date.now() };
    }
    _tier2Servers = servers;
    _beaconServers = servers;

    const claude = detectClaudeTool(servers);
    if (claude) {
      _claudeDetection = {
        server: claude.server,
        tool: claude.tool,
        promptParamName: findPromptParam(claude.tool.inputSchema) || _claudeDetection?.promptParamName || 'prompt',
      };
    }
    updateTierStatus();
  } catch { /* silent */ }
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
  document.getElementById('f-timeout').value = '';
  onTransportChange();

  // Reset tier state
  document.getElementById('f-prompt').value = '';
  document.getElementById('tier2-tools').innerHTML = '';
  document.getElementById('tier2-params').innerHTML = '';
  _selectedTier2 = null;
  currentTier = 3;

  // Reset cron selector
  setCronMode('simple');
  document.getElementById('cron-frequency').value = 'day';
  document.getElementById('cron-hour').value = '0';
  document.getElementById('cron-minute').value = '0';
  updateBuilderVisibility();
  document.querySelectorAll('.cron-preset-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('cron-next-runs').classList.add('hidden');

  // Reset beacon (tier 3)
  document.getElementById('beacon-servers').innerHTML = '';
  document.getElementById('beacon-tools').innerHTML = '';
  document.getElementById('beacon-empty').classList.add('hidden');
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
  document.getElementById('f-timeout').value = rule.timeout || '';
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
  const enabled = document.getElementById('f-enabled').checked;
  const timeoutVal = document.getElementById('f-timeout').value.trim();
  const timeout = timeoutVal ? parseInt(timeoutVal, 10) : undefined;

  // Tier 1: Claude prompt mode
  if (currentTier === 1 && _claudeDetection) {
    const promptText = document.getElementById('f-prompt').value.trim();
    if (!name || !schedule || !promptText) {
      showToast('Name, schedule, and prompt are required', 'error');
      return;
    }

    const tool = _claudeDetection.tool.name;
    const paramName = _claudeDetection.promptParamName || 'prompt';
    const params = { [paramName]: promptText };
    const target = { transport: 'http', url: _claudeDetection.server.url };

    return await submitRule({ name, schedule, tool, params, target, enabled, timeout });
  }

  // Tier 2: Beacon tool picker
  if (currentTier === 2 && _selectedTier2) {
    if (!name || !schedule) {
      showToast('Name and schedule are required', 'error');
      return;
    }
    const tool = _selectedTier2.tool.name;
    const params = gatherTier2Params();
    if (params === null) return; // JSON parse error
    const target = { transport: 'http', url: _selectedTier2.server.url };

    return await submitRule({ name, schedule, tool, params, target, enabled, timeout });
  }

  // Tier 3: Full manual mode
  const tool = document.getElementById('f-tool').value.trim();
  const transport = document.getElementById('f-transport').value;

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

  return await submitRule({ name, schedule, tool, params, target, enabled, timeout });
}

async function submitRule(body) {
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

    showToast(editingRuleId ? 'Trigger updated' : 'Trigger created');
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

// ── Panels ────────────────────────────────────────────────────────────────────

function togglePanel(panelId) {
  const panel = document.getElementById(panelId);
  const overlay = document.getElementById(panelId + '-overlay');
  const isOpen = panel.classList.contains('open');

  // Close any other open panels first
  document.querySelectorAll('.side-panel.open').forEach(p => {
    p.classList.remove('open');
    const ov = document.getElementById(p.id + '-overlay');
    if (ov) ov.classList.remove('open');
  });

  if (!isOpen) {
    panel.classList.add('open');
    overlay.classList.add('open');
    // Load content when opening settings panel
    if (panelId === 'settings-panel') {
      loadLogs();
      loadMcpServerInfo();
    }
  }
}

function closePanel(panelId) {
  document.getElementById(panelId).classList.remove('open');
  document.getElementById(panelId + '-overlay').classList.remove('open');
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
    document.getElementById('f-schedule').value = document.getElementById('f-schedule-value').value;
  } else {
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

function getNextCronRuns(expr, count) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Invalid cron');

  const fields = parts.map(parseCronField);
  const [minF, hourF, domF, monF, dowF] = fields;

  const results = [];
  const now = new Date();
  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1, 0, 0);

  const maxIter = 525960;
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

  for (const part of field.split(',')) {
    if (part === '*') {
      return new Set(Array.from({ length: 60 }, (_, i) => i));
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

// ── Beacon Discovery (Tier 3 legacy) ────────────────────────────────────────

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

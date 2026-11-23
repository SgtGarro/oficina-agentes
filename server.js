#!/usr/bin/env node
// Oficina de agentes: servidor local.
// Recibe los eventos de los hooks de Claude Code y Antigravity (POST /hook),
// mantiene el estado de cada agente en memoria y lo transmite al navegador (GET /events).
// No necesita dependencias: solo Node 18 o superior.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 4317;
const HOST = '127.0.0.1'; // solo accesible desde tu equipo
const HIDE_DETAIL = process.env.OCULTAR_DETALLE === '1' || process.argv.includes('--sin-detalle');
const MAX_LOG = 120;
const MAX_BODY = 2_000_000;
const REMOVE_DONE_AFTER_MS = 9000;
const STALE_WORKING_MS = 10 * 60 * 1000;
const STALE_SESSION_MS = 6 * 60 * 60 * 1000;

/** @type {Map<string, any>} */
const agents = new Map();
const logEntries = [];
const clients = new Set();
let logSeq = 0;

// ---------------------------------------------------------------- utilidades

const trunc = (s, n = 90) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

function projectName(cwd) {
  if (!cwd) return 'sin proyecto';
  const parts = String(cwd).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || String(cwd);
}

function shortPath(p) {
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/');
}

const TOOL_ES = {
  // Claude Code
  Read: 'Leyendo',
  Write: 'Escribiendo',
  Edit: 'Editando',
  MultiEdit: 'Editando',
  NotebookEdit: 'Editando notebook',
  Bash: 'Ejecutando comando',
  PowerShell: 'Ejecutando comando',
  Grep: 'Buscando en código',
  Glob: 'Buscando archivos',
  WebSearch: 'Buscando en la web',
  WebFetch: 'Leyendo una web',
  Task: 'Delegando a subagente',
  Agent: 'Delegando a subagente',
  TodoWrite: 'Actualizando tareas',
  // Antigravity
  read_file: 'Leyendo',
  view_file: 'Leyendo',
  view_file_outline: 'Leyendo esquema',
  view_code_item: 'Leyendo código',
  write_file: 'Escribiendo',
  write_to_file: 'Escribiendo',
  edit_file: 'Editando',
  replace_file_content: 'Editando',
  multi_replace_file_content: 'Editando',
  list_dir: 'Explorando carpeta',
  find_by_name: 'Buscando archivos',
  grep_search: 'Buscando en código',
  run_command: 'Ejecutando comando',
  manage_task: 'Gestionando tarea',
  schedule: 'Programando tarea',
  search_web: 'Buscando en la web',
  read_url_content: 'Leyendo una web',
  invoke_subagent: 'Delegando a subagente',
  define_subagent: 'Definiendo subagente',
  manage_subagents: 'Gestionando subagentes',
  send_message: 'Enviando mensaje',
  swarm: 'Coordinando equipo',
  run_workflow: 'Ejecutando flujo',
  ask_question: 'Necesita tu respuesta',
  ask_permission: 'Solicitando permiso',
  list_permissions: 'Revisando permisos',
  generate_image: 'Generando imagen',
};

function describeTool(name, input) {
  input = input && typeof input === 'object' ? input : {};
  const toolName = String(name || '');
  if (toolName.startsWith('mcp__')) {
    const [, server, tool] = toolName.split('__');
    return { activity: `Conector ${server || ''}`.trim(), detail: HIDE_DETAIL ? '' : trunc(tool || '', 60) };
  }
  if (toolName === 'call_mcp_tool' || toolName === 'list_resources' || toolName === 'read_resource') {
    const server = input.ServerName || input.serverName || '';
    const detail = input.ToolName || input.toolName || input.Uri || input.uri || '';
    return { activity: `Conector ${server}`.trim(), detail: HIDE_DETAIL ? '' : trunc(detail, 60) };
  }
  if (toolName.startsWith('mcp_')) {
    const rest = toolName.slice(4);
    const sep = rest.indexOf('_');
    const server = sep > 0 ? rest.slice(0, sep) : rest;
    const tool = sep > 0 ? rest.slice(sep + 1) : '';
    return { activity: `Conector ${server}`.trim(), detail: HIDE_DETAIL ? '' : trunc(tool, 60) };
  }
  if (toolName.startsWith('browser_')) {
    const action = toolName.slice('browser_'.length).replace(/_/g, ' ');
    const detail = input.url || input.Url || input.element || action;
    return { activity: 'Navegando en web', detail: HIDE_DETAIL ? '' : trunc(detail, 80) };
  }
  const activity = TOOL_ES[toolName] || String(toolName || 'Herramienta');
  let detail = '';
  if (input.subagent_type) detail = `${input.subagent_type}${input.description ? ': ' + input.description : ''}`;
  else if (toolName === 'invoke_subagent') {
    if (Array.isArray(input.Subagents) && input.Subagents.length) {
      detail = input.Subagents.map((s) => s.Role || s.TypeName || 'subagente').join(', ');
    } else {
      detail = input.Role || input.TypeName || '';
    }
  } else if (toolName === 'swarm') {
    detail = [input.action, input.name].filter(Boolean).join(' ');
  } else if (toolName === 'ask_question' && Array.isArray(input.questions) && input.questions[0]?.question) {
    detail = input.questions[0].question;
  } else if (toolName === 'ask_permission') {
    detail = input.Reason || input.Target || input.Action || '';
  } else if (input.file_path || input.Path || input.AbsolutePath || input.TargetFile) {
    detail = shortPath(input.file_path || input.Path || input.AbsolutePath || input.TargetFile);
  } else if (input.toolSummary) detail = input.toolSummary;
  else if (input.command || input.CommandLine) detail = input.command || input.CommandLine;
  else if (input.pattern || input.Pattern) detail = input.pattern || input.Pattern;
  else if (input.query || input.Query) detail = input.query || input.Query;
  else if (input.url || input.Url) detail = input.url || input.Url;
  else if (input.DirectoryPath || input.SearchDirectory || input.SearchPath) {
    detail = shortPath(input.DirectoryPath || input.SearchDirectory || input.SearchPath);
  } else if (input.description || input.Description) detail = input.description || input.Description;
  else if (input.Name || input.name) detail = input.Name || input.name;
  else if (input.ImageName) detail = input.ImageName;
  else if (input.Prompt) detail = input.Prompt;
  else if (input.Action) detail = input.Action;
  else if (input.Recipient) detail = input.Recipient;
  return { activity, detail: HIDE_DETAIL ? '' : trunc(detail, 80) };
}

function pushLog(agent, text, level = 'info') {
  logEntries.push({ n: ++logSeq, t: Date.now(), agent: agent ? agent.name : 'Sistema', agentId: agent ? agent.id : null, text: trunc(text, 120), level });
  if (logEntries.length > MAX_LOG) logEntries.splice(0, logEntries.length - MAX_LOG);
}

// ------------------------------------------------------------ estado agentes

const PENDING_SUBAGENT_TTL_MS = 20_000;
const pendingAgSubagents = [];
const agSubagentMeta = new Map();

function mainKey(sessionId) {
  return `${sessionId}:main`;
}

function isAntigravityPayload(p) {
  return Boolean(p && (p.source === 'antigravity' || p.conversationId || p.hookEventName || p.toolCall));
}

function detectAgSurface(p) {
  const ref = String(p.transcriptPath || p.artifactDirectoryPath || '').toLowerCase();
  if (ref.includes('antigravity-cli')) return 'cli';
  if (ref.includes('antigravity-ide')) return 'ide';
  if (ref.includes('antigravity')) return 'app';
  return null;
}

function normalizePromptSample(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function queueAgSubagents(parentSessionId, cwd, toolName, toolArgs, now) {
  const args = toolArgs && typeof toolArgs === 'object' ? toolArgs : {};
  const addEntry = (role, type, prompt) => {
    pendingAgSubagents.push({
      parentSessionId,
      cwd: String(cwd || ''),
      role: trunc(role || type || 'subagente', 40),
      type: trunc(type || role || 'subagente', 40),
      promptSample: normalizePromptSample(prompt),
      createdAt: now,
    });
  };
  if (toolName === 'invoke_subagent') {
    if (Array.isArray(args.Subagents) && args.Subagents.length) {
      for (const spec of args.Subagents) {
        addEntry(spec?.Role || spec?.TypeName, spec?.TypeName || spec?.Role, spec?.Prompt);
      }
    } else {
      addEntry(args.Role || args.TypeName, args.TypeName || args.Role, args.Prompt);
    }
  } else if (toolName === 'swarm' && args.action === 'add' && args.name) {
    const count = Array.isArray(args.tasks) && args.tasks.length ? args.tasks.length : Math.max(1, Number(args.n) || 1);
    for (let i = 0; i < count; i++) {
      const workerName = count > 1 ? `${args.name}-${i + 1}` : args.name;
      addEntry(workerName, args.name, args.brief);
    }
  }
}

function matchPendingAgSubagent(convId, cwd, lastUserInput, now) {
  while (pendingAgSubagents.length && now - pendingAgSubagents[0].createdAt > PENDING_SUBAGENT_TTL_MS) {
    pendingAgSubagents.shift();
  }
  const sample = normalizePromptSample(lastUserInput);
  // 1. Coincidencia exacta por prompt (evita falsos positivos con chats nuevos del usuario)
  if (sample) {
    const idx = pendingAgSubagents.findIndex(
      (x) =>
        x.parentSessionId !== convId &&
        x.promptSample &&
        (sample.startsWith(x.promptSample) || x.promptSample.startsWith(sample))
    );
    if (idx >= 0) return pendingAgSubagents.splice(idx, 1)[0];
  }
  // 2. Fallback en SessionStart sin lastUserInput todavía: mismo proyecto en ventana corta
  const proj = projectName(cwd);
  const idx = pendingAgSubagents.findIndex(
    (x) =>
      x.parentSessionId !== convId &&
      now - x.createdAt <= 6000 &&
      (!x.cwd || !cwd || projectName(x.cwd) === proj)
  );
  if (idx >= 0) return pendingAgSubagents.splice(idx, 1)[0];
  return null;
}

function ensureAgent(p, forcedAgentId, opts = {}) {
  const sessionId = p.session_id || 'sin-sesion';
  const agentId = forcedAgentId !== undefined ? forcedAgentId : p.agent_id || null;
  const key = opts.key || (agentId ? `${sessionId}:${agentId}` : mainKey(sessionId));
  let a = agents.get(key);
  if (!a) {
    const kind = opts.kind || (agentId ? 'sub' : 'main');
    const provider = opts.provider || (p.source === 'antigravity' ? 'antigravity' : 'claude');
    const defaultMainType = provider === 'antigravity' ? 'antigravity' : 'claude';
    const defaultMainName = provider === 'antigravity' ? 'Antigravity' : 'Claude';
    const type = opts.type || p.agent_type || (kind === 'main' ? defaultMainType : 'subagente');
    const name =
      opts.name ||
      (kind === 'main'
        ? p.agent_type && p.agent_type !== defaultMainType
          ? p.agent_type
          : defaultMainName
        : type);
    a = {
      id: key,
      sessionId,
      kind,
      type,
      name,
      provider,
      surface: opts.surface || null,
      project: projectName(p.cwd),
      status: 'idle',
      activity: 'Esperando',
      detail: '',
      tool: null,
      toolCount: 0,
      parent: opts.parent !== undefined ? opts.parent : kind === 'sub' ? mainKey(sessionId) : null,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      errorAt: 0,
      _lastPrompt: '',
    };
    agents.set(key, a);
    if (kind === 'sub') pushLog(a, `Se une a la oficina (${a.project})`);
  }
  if (p.cwd) a.project = projectName(p.cwd);
  return a;
}

function removeSession(sessionId) {
  for (const [key, a] of agents) {
    if (a.sessionId === sessionId) agents.delete(key);
  }
  agSubagentMeta.delete(sessionId);
}

function findWorkingSub(sessionId, type) {
  for (const a of agents.values()) {
    if (a.sessionId === sessionId && a.kind === 'sub' && a.status !== 'done' && (!type || a.type === type)) return a;
  }
  return null;
}

function scheduleRemoveDone(id) {
  setTimeout(() => {
    const cur = agents.get(id);
    if (cur && cur.status === 'done') {
      agents.delete(id);
      scheduleBroadcast();
    }
  }, REMOVE_DONE_AFTER_MS).unref();
}

let syntheticSeq = 0;

function handleAntigravity(p) {
  const ev = p.hookEventName || p.hook_event_name;
  if (!ev) return;
  const now = Date.now();
  const convId = p.conversationId || p.session_id || 'antigravity-sin-sesion';
  const cwd = p.cwd || (Array.isArray(p.workspacePaths) && p.workspacePaths[0]) || '';
  const surface = detectAgSurface(p);

  let subMeta = agSubagentMeta.get(convId);
  const existingMain = agents.get(mainKey(convId));
  if (!subMeta && !existingMain) {
    const matched = matchPendingAgSubagent(convId, cwd, p.lastUserInput, now);
    if (matched) {
      subMeta = {
        key: `${matched.parentSessionId}:agsub:${convId}`,
        parent: mainKey(matched.parentSessionId),
        type: matched.type,
        name: matched.role,
      };
      agSubagentMeta.set(convId, subMeta);
    }
  }

  const a = subMeta
    ? ensureAgent(
        { session_id: convId, cwd, source: 'antigravity' },
        convId,
        { key: subMeta.key, kind: 'sub', provider: 'antigravity', surface, type: subMeta.type, name: subMeta.name, parent: subMeta.parent }
      )
    : ensureAgent(
        { session_id: convId, cwd, source: 'antigravity' },
        null,
        { kind: 'main', provider: 'antigravity', surface, type: 'antigravity', name: 'Antigravity', parent: null }
      );
  a.updatedAt = now;

  const toolName = p.toolCall?.name || p.tool_name || '';
  const toolArgs = p.toolCall?.args || p.tool_input || {};

  switch (ev) {
    case 'SessionStart':
      if (a.kind === 'sub') {
        a.status = 'working';
        a.activity = 'Arrancando';
      } else {
        a.status = 'idle';
        a.activity = 'Sesión iniciada';
        pushLog(a, `Sesión iniciada en ${a.project}`);
      }
      break;
    case 'PreInvocation': {
      const prompt = String(p.lastUserInput || '').trim();
      const isNewTurn = Boolean(prompt && prompt !== a._lastPrompt);
      if (isNewTurn) a._lastPrompt = prompt;
      a.status = 'working';
      a.tool = null;
      a.activity = 'Pensando';
      if (isNewTurn) {
        a.detail = HIDE_DETAIL ? '' : trunc(prompt, 80);
        if (a.kind === 'main') pushLog(a, 'Recibió una tarea');
      } else {
        a.detail = '';
      }
      break;
    }
    case 'PreToolUse': {
      if (toolName === 'invoke_subagent' || (toolName === 'swarm' && toolArgs?.action === 'add')) {
        queueAgSubagents(convId, cwd, toolName, toolArgs, now);
      }
      const d = describeTool(toolName, toolArgs);
      a.tool = toolName || null;
      a.toolCount += 1;
      if (toolName === 'ask_question' || toolName === 'ask_permission') {
        a.status = 'waiting';
        a.activity = 'Necesita tu atención';
        a.detail = d.detail;
        pushLog(a, d.detail ? `Necesita tu atención: ${d.detail}` : 'Necesita tu atención', 'warn');
      } else {
        a.status = 'working';
        a.activity = d.activity;
        a.detail = d.detail;
        pushLog(a, d.detail ? `${d.activity}: ${d.detail}` : d.activity);
      }
      break;
    }
    case 'PostToolUse':
      if (p.error) {
        a.errorAt = now;
        a.status = a.status === 'done' ? 'done' : 'working';
        a.tool = null;
        a.activity = `Falló ${toolName || 'una herramienta'}`;
        a.detail = HIDE_DETAIL ? '' : trunc(p.error, 80);
        pushLog(a, a.activity, 'error');
      } else {
        a.status = a.status === 'done' ? 'done' : 'working';
        a.tool = null;
        a.activity = 'Pensando';
        a.detail = '';
      }
      break;
    case 'PostInvocation':
      if (a.status !== 'done' && a.status !== 'idle' && a.status !== 'waiting') {
        a.activity = 'Pensando';
      }
      break;
    case 'Stop': {
      const reason = String(p.terminationReason || '');
      const hasErr = Boolean(p.error) || /^error$/i.test(reason);
      a.tool = null;
      if (hasErr) {
        a.status = 'error';
        a.errorAt = now;
        a.activity = 'El turno terminó con error';
        a.detail = HIDE_DETAIL ? '' : trunc(p.error || reason, 100);
        pushLog(a, a.activity, 'error');
      } else if (a.kind === 'sub' && p.fullyIdle !== false) {
        a.status = 'done';
        a.activity = 'Terminó';
        a.detail = '';
        pushLog(a, 'Terminó su trabajo', 'ok');
        scheduleRemoveDone(a.id);
      } else {
        a.status = 'idle';
        a.activity = reason === 'USER_CANCELED' ? 'Turno cancelado' : 'Turno terminado';
        a.detail = '';
        pushLog(a, reason === 'USER_CANCELED' ? 'Turno cancelado' : 'Terminó su turno', 'ok');
      }
      break;
    }
    default:
      break;
  }
}

function handle(p) {
  if (!p || typeof p !== 'object') return;
  if (isAntigravityPayload(p)) {
    handleAntigravity(p);
    return;
  }
  const ev = p.hook_event_name;
  if (!ev) return;
  const now = Date.now();

  if (ev === 'SessionEnd') {
    const m = agents.get(mainKey(p.session_id || 'sin-sesion'));
    if (m) pushLog(m, 'Sesión terminada');
    removeSession(p.session_id || 'sin-sesion');
    return;
  }

  let a;
  if (ev === 'SubagentStart') {
    // Si el evento no trae agent_id, inventamos uno para no confundirlo con el agente principal.
    a = ensureAgent(p, p.agent_id || `sub-${++syntheticSeq}`);
  } else if (ev === 'SubagentStop') {
    a = p.agent_id ? ensureAgent(p) : findWorkingSub(p.session_id || 'sin-sesion', p.agent_type) || ensureAgent(p, `sub-${++syntheticSeq}`);
  } else {
    a = ensureAgent(p);
  }
  a.updatedAt = now;

  switch (ev) {
    case 'SessionStart':
      a.status = 'idle';
      a.activity = 'Sesión iniciada';
      pushLog(a, `Sesión iniciada en ${a.project}`);
      break;
    case 'UserPromptSubmit':
      a.status = 'working';
      a.tool = null;
      a.activity = 'Pensando';
      a.detail = HIDE_DETAIL ? '' : trunc(p.prompt, 80);
      pushLog(a, 'Recibió una tarea');
      break;
    case 'PreToolUse': {
      const d = describeTool(p.tool_name, p.tool_input);
      a.status = 'working';
      a.tool = p.tool_name || null;
      a.activity = d.activity;
      a.detail = d.detail;
      a.toolCount += 1;
      pushLog(a, d.detail ? `${d.activity}: ${d.detail}` : d.activity);
      break;
    }
    case 'PostToolUse':
      a.status = a.status === 'done' ? 'done' : 'working';
      a.tool = null;
      a.activity = 'Pensando';
      a.detail = '';
      break;
    case 'PostToolUseFailure':
      a.errorAt = now;
      a.activity = `Falló ${p.tool_name || 'una herramienta'}`;
      pushLog(a, a.activity, 'error');
      break;
    case 'Notification': {
      const type = p.notification_type || '';
      if (type === 'idle_prompt' || type === 'agent_completed') {
        a.status = 'idle';
        a.activity = 'Esperando';
      } else {
        a.status = 'waiting';
        a.activity = 'Necesita tu atención';
        a.detail = HIDE_DETAIL ? '' : trunc(p.message, 80);
        pushLog(a, 'Necesita tu atención', 'warn');
      }
      break;
    }
    case 'Stop':
      a.status = 'idle';
      a.tool = null;
      a.activity = 'Turno terminado';
      a.detail = HIDE_DETAIL ? '' : trunc(p.last_assistant_message, 100);
      pushLog(a, 'Terminó su turno', 'ok');
      break;
    case 'StopFailure':
      a.status = 'error';
      a.activity = 'El turno terminó con error';
      pushLog(a, a.activity, 'error');
      break;
    case 'SubagentStart':
      a.status = 'working';
      a.activity = 'Arrancando';
      break;
    case 'SubagentStop': {
      a.status = 'done';
      a.tool = null;
      a.activity = 'Terminó';
      a.detail = HIDE_DETAIL ? '' : trunc(p.last_assistant_message, 100);
      pushLog(a, 'Terminó su trabajo', 'ok');
      scheduleRemoveDone(a.id);
      break;
    }
    default:
      break;
  }
}

function publicAgent(a) {
  return {
    id: a.id,
    kind: a.kind,
    type: a.type,
    name: a.name,
    provider: a.provider || 'claude',
    project: a.project,
    parent: a.parent,
    status: a.status,
    activity: a.activity,
    detail: a.detail,
    tool: a.tool,
    toolCount: a.toolCount,
    startedAt: a.startedAt,
    updatedAt: a.updatedAt,
    errorAt: a.errorAt,
  };
}

function snapshot() {
  const list = [...agents.values()].sort((x, y) => x.startedAt - y.startedAt).map(publicAgent);
  return { now: Date.now(), agents: list, log: logEntries.slice(-60), demo: Boolean(demo) };
}

// ------------------------------------------------------------------- difusión

let broadcastTimer = null;
function scheduleBroadcast() {
  if (broadcastTimer || clients.size === 0) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    if (clients.size === 0) return;
    const data = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of clients) {
      if (res.writableEnded) {
        clients.delete(res);
        continue;
      }
      try {
        res.write(data);
      } catch {
        clients.delete(res);
      }
    }
  }, 40);
}

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [key, a] of agents) {
    if (a.status === 'working' && now - a.updatedAt > STALE_WORKING_MS) {
      a.status = 'idle';
      a.activity = 'Sin actividad';
      changed = true;
    }
    if (now - a.updatedAt > STALE_SESSION_MS) {
      agents.delete(key);
      changed = true;
    }
  }
  if (changed) scheduleBroadcast();
  for (const res of clients) {
    if (res.writableEnded) {
      clients.delete(res);
      continue;
    }
    try {
      res.write(': latido\n\n');
    } catch {
      clients.delete(res);
    }
  }
}, 25000).unref();

// ----------------------------------------------------------------------- demo

let demo = null;

function startDemo() {
  if (demo) return;
  const stamp = Date.now().toString(36);
  const sid = 'demo-' + stamp;
  const agSid = 'demo-ag-' + stamp;
  const cwd = '/demo/dashboard-ventas';
  const agCwd = '/demo/api-pagos';
  const types = ['planificador', 'ejecutor', 'ejecutor', 'revisor', 'investigador'];
  const tools = [
    ['Read', { file_path: 'src/ventas/resumen.ts' }],
    ['Grep', { pattern: 'margen_bruto' }],
    ['Edit', { file_path: 'src/ventas/resumen.ts' }],
    ['Bash', { command: 'npm test -- --watch=false' }],
    ['WebSearch', { query: 'mejores prácticas de cohortes' }],
    ['Write', { file_path: 'informe/semana.md' }],
    ['Glob', { pattern: 'src/**/*.ts' }],
  ];
  const agTools = [
    ['read_file', { Path: '/demo/api-pagos/src/checkout.ts' }],
    ['grep_search', { Query: 'webhook_signature', SearchPath: '/demo/api-pagos/src' }],
    ['edit_file', { Path: '/demo/api-pagos/src/checkout.ts' }],
    ['run_command', { CommandLine: 'npm run test:unit', toolSummary: 'Ejecutar tests de pagos' }],
    ['search_web', { query: 'stripe idempotency key best practices' }],
  ];
  const state = { sids: [sid, agSid], subs: new Map(), tick: 0, nextId: 1, timers: new Set() };
  const base = { session_id: sid, cwd };
  const agBase = { source: 'antigravity', conversationId: agSid, workspacePaths: [agCwd], cwd: agCwd };
  const later = (ms, fn) => {
    const t = setTimeout(() => {
      state.timers.delete(t);
      fn();
      scheduleBroadcast();
    }, ms);
    state.timers.add(t);
  };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  handle({ ...base, hook_event_name: 'SessionStart' });
  handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'Prepara el informe semanal de ventas' });
  handle({ ...agBase, hookEventName: 'SessionStart' });
  handle({ ...agBase, hookEventName: 'PreInvocation', lastUserInput: 'Refuerza las validaciones del checkout' });

  const step = () => {
    state.tick += 1;
    const r = Math.random();
    if (state.subs.size < 4 && r < 0.3) {
      const id = `dem${state.nextId++}`;
      const type = types[state.subs.size % types.length];
      state.subs.set(id, { type, steps: 3 + Math.floor(Math.random() * 4) });
      handle({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { subagent_type: type, description: 'parte de la tarea' } });
      handle({ ...base, hook_event_name: 'SubagentStart', agent_id: id, agent_type: type });
    } else if (state.subs.size && r < 0.8) {
      const [id, sub] = pick([...state.subs.entries()]);
      sub.steps -= 1;
      if (sub.steps <= 0) {
        handle({ ...base, hook_event_name: 'SubagentStop', agent_id: id, agent_type: sub.type, last_assistant_message: 'Listo, dejé el resultado en el informe.' });
        state.subs.delete(id);
      } else {
        const [tool_name, tool_input] = pick(tools);
        handle({ ...base, hook_event_name: 'PreToolUse', agent_id: id, agent_type: sub.type, tool_name, tool_input });
        later(900 + Math.random() * 900, () => handle({ ...base, hook_event_name: 'PostToolUse', agent_id: id, agent_type: sub.type, tool_name }));
      }
    } else {
      const [tool_name, tool_input] = pick(tools);
      handle({ ...base, hook_event_name: 'PreToolUse', tool_name, tool_input });
      later(800, () => handle({ ...base, hook_event_name: 'PostToolUse', tool_name }));
    }

    // Actividad paralela del agente de Antigravity
    if (state.tick % 2 === 0) {
      const [name, args] = pick(agTools);
      handle({ ...agBase, hookEventName: 'PreToolUse', toolCall: { id: 'ag-' + state.tick, name, args } });
      later(850, () => handle({ ...agBase, hookEventName: 'PostToolUse', toolCall: { id: 'ag-' + state.tick, name, args } }));
    }
    if (state.tick % 26 === 13) {
      handle({ ...agBase, hookEventName: 'Stop', terminationReason: 'NO_TOOL_CALL', fullyIdle: true });
      later(5500, () => handle({ ...agBase, hookEventName: 'PreInvocation', lastUserInput: 'Añade pruebas de reintento al webhook' }));
    }

    if (state.tick % 22 === 0) {
      handle({ ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Permiso para ejecutar un comando' });
      later(4200, () => handle({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm run build' } }));
    }
    if (state.tick % 38 === 0) {
      handle({ ...base, hook_event_name: 'Stop', last_assistant_message: 'Informe terminado.' });
      later(5000, () => handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'Ahora revisa los márgenes por tienda' }));
    }
    scheduleBroadcast();
  };

  state.interval = setInterval(step, 1500);
  demo = state;
  step();
}

function stopDemo() {
  if (!demo) return;
  clearInterval(demo.interval);
  for (const t of demo.timers) clearTimeout(t);
  for (const sid of demo.sids) removeSession(sid);
  demo = null;
  scheduleBroadcast();
}

// ----------------------------------------------------------------------- HTTP

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

function hostAllowed(req) {
  const host = String(req.headers.host || '').toLowerCase();
  return host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);
const staticCache = new Map();

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = path.normalize(decodeURIComponent(rel)).replace(/^([/\\])+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) {
    res.writeHead(403).end('Prohibido');
    return;
  }
  const isVendor = rel.startsWith('vendor' + path.sep) || rel.startsWith('vendor/');
  const sendEntry = (entry) => {
    const cacheControl = isVendor ? 'public, max-age=86400, immutable' : 'no-cache';
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, { ETag: entry.etag, 'Cache-Control': cacheControl }).end();
      return;
    }
    const wantsGzip = entry.gz && /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
    const body = wantsGzip ? entry.gz : entry.buf;
    const headers = {
      'Content-Type': entry.mime,
      'Cache-Control': cacheControl,
      ETag: entry.etag,
      'Content-Length': body.length,
    };
    if (entry.gz) headers.Vary = 'Accept-Encoding';
    if (wantsGzip) headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  const cached = staticCache.get(file);
  if (cached && isVendor) {
    sendEntry(cached);
    return;
  }

  fs.stat(file, (statErr, st) => {
    if (statErr || !st.isFile()) {
      staticCache.delete(file);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
      return;
    }
    const sig = `${st.size}-${Math.trunc(st.mtimeMs)}`;
    if (cached && cached.sig === sig) {
      sendEntry(cached);
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
        return;
      }
      const ext = path.extname(file);
      const mime = MIME[ext] || 'application/octet-stream';
      const gz = COMPRESSIBLE.has(ext) && buf.length >= 1024 ? zlib.gzipSync(buf, { level: 6 }) : null;
      const entry = { sig, etag: `"${sig}"`, mime, buf, gz };
      staticCache.set(file, entry);
      sendEntry(entry);
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!hostAllowed(req)) {
      res.writeHead(403).end('Host no permitido');
      return;
    }
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (req.method === 'POST' && url.pathname === '/hook') {
      const raw = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        res.writeHead(400).end();
        return;
      }
      handle(payload);
      scheduleBroadcast();
      // Respuesta vacía con 2xx = "sin decisión": Claude Code sigue su flujo normal.
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(`retry: 2000\n\ndata: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(snapshot(), null, 2));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/demo/start') {
      startDemo();
      res.writeHead(204).end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/demo/stop') {
      stopDemo();
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, url.pathname);
      return;
    }
    res.writeHead(405).end();
  } catch (err) {
    console.error('Error atendiendo la solicitud:', err.message);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

export { handle, snapshot, startDemo, stopDemo, agents };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`El puerto ${PORT} ya está en uso. Cambia el puerto con PORT=4400 node server.js`);
    else console.error(err);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(`\n  Oficina de agentes lista en  http://localhost:${PORT}`);
    console.log(`  Los hooks (Claude Code / Antigravity) envían a  http://127.0.0.1:${PORT}/hook`);
    if (HIDE_DETAIL) console.log('  Modo privado: no se muestran comandos, rutas ni textos.');
    console.log('');
    if (process.argv.includes('--demo')) startDemo();
  });
}

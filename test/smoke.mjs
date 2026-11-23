// Pruebas de humo: node test/smoke.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log('  ✓', name);
};

// ------------------------------------------------------------- 1. lógica
console.log('Lógica del servidor');
const srv = await import(pathToFileURL(path.join(root, 'server.js')).href);
const base = { session_id: 's1', cwd: '/home/ana/proyecto-ventas' };
srv.handle({ ...base, hook_event_name: 'SessionStart' });
srv.handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'haz el informe' });
srv.handle({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/home/ana/proyecto-ventas/src/a.ts' } });
let snap = srv.snapshot();
assert.equal(snap.agents.length, 1);
assert.equal(snap.agents[0].kind, 'main');
assert.equal(snap.agents[0].status, 'working');
assert.equal(snap.agents[0].project, 'proyecto-ventas');
assert.match(snap.agents[0].detail, /src\/a\.ts/);
ok('un evento crea al agente principal y lo marca trabajando');

srv.handle({ ...base, hook_event_name: 'SubagentStart', agent_id: 'A1', agent_type: 'planificador' });
srv.handle({ ...base, hook_event_name: 'PreToolUse', agent_id: 'A1', agent_type: 'planificador', tool_name: 'Grep', tool_input: { pattern: 'x' } });
snap = srv.snapshot();
assert.equal(snap.agents.length, 2);
const sub = snap.agents.find((a) => a.kind === 'sub');
assert.equal(sub.name, 'planificador');
assert.equal(sub.parent, 's1:main');
assert.equal(sub.activity, 'Buscando en código');
assert.equal(snap.agents.find((a) => a.kind === 'main').toolCount, 1, 'la herramienta del subagente no se cuenta en el principal');
ok('los subagentes se distinguen por agent_id y no se mezclan con el principal');

srv.handle({ ...base, hook_event_name: 'SubagentStart', agent_type: 'revisor' }); // sin agent_id
srv.handle({ ...base, hook_event_name: 'SubagentStop', agent_type: 'revisor' });
snap = srv.snapshot();
assert.equal(snap.agents.filter((a) => a.kind === 'sub').length, 2);
assert.equal(snap.agents.find((a) => a.name === 'revisor').status, 'done');
assert.equal(snap.agents.find((a) => a.kind === 'main').name, 'Claude');
ok('SubagentStart/Stop sin agent_id no rompe ni toca al principal');

srv.handle({ ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'permiso' });
assert.equal(srv.snapshot().agents.find((a) => a.kind === 'main').status, 'waiting');
srv.handle({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
assert.equal(srv.snapshot().agents.find((a) => a.kind === 'main').status, 'working');
srv.handle({ ...base, hook_event_name: 'Stop', last_assistant_message: 'listo' });
assert.equal(srv.snapshot().agents.find((a) => a.kind === 'main').status, 'idle');
ok('espera de permiso → trabajando → libre');

srv.handle({ ...base, hook_event_name: 'PreToolUse', tool_name: 'mcp__MCP-Cubo__consultar_ventas', tool_input: {} });
assert.match(srv.snapshot().agents.find((a) => a.kind === 'main').activity, /Conector/);
ok('las herramientas de conectores MCP se describen');

srv.handle({ ...base, hook_event_name: 'SessionEnd' });
assert.equal(srv.snapshot().agents.length, 0);
ok('al terminar la sesión desaparecen sus agentes');

// Antigravity: ciclo completo, herramientas, espera de usuario, subagentes y swarm
const agBase = {
  source: 'antigravity',
  conversationId: 'ag-conv-1',
  workspacePaths: ['C:\\trabajo\\portal-clientes'],
  transcriptPath: 'C:\\Users\\demo\\.gemini\\antigravity-cli\\brain\\ag-conv-1\\.system_generated\\logs\\transcript.jsonl',
};
srv.handle({ ...agBase, hookEventName: 'SessionStart' });
srv.handle({ ...agBase, hookEventName: 'PreInvocation', lastUserInput: 'Revisa el checkout de pagos' });
srv.handle({ ...agBase, hookEventName: 'PreToolUse', toolCall: { id: 't1', name: 'read_file', args: { Path: 'C:\\trabajo\\portal-clientes\\src\\pago.ts' } } });
snap = srv.snapshot();
assert.equal(snap.agents.length, 1);
assert.equal(snap.agents[0].name, 'Antigravity');
assert.equal(snap.agents[0].provider, 'antigravity');
assert.equal(snap.agents[0].project, 'portal-clientes');
assert.equal(snap.agents[0].status, 'working');
assert.equal(snap.agents[0].activity, 'Leyendo');
assert.match(snap.agents[0].detail, /src\/pago\.ts/);
ok('Antigravity crea agente principal, detecta proyecto desde workspacePaths y traduce herramientas');

srv.handle({ ...agBase, hookEventName: 'PreToolUse', toolCall: { id: 't2', name: 'call_mcp_tool', args: { ServerName: 'playwright', ToolName: 'browser_snapshot' } } });
assert.equal(srv.snapshot().agents[0].activity, 'Conector playwright');
assert.equal(srv.snapshot().agents[0].detail, 'browser_snapshot');
srv.handle({ ...agBase, hookEventName: 'PreToolUse', toolCall: { id: 't3', name: 'ask_question', args: { questions: [{ question: '¿Qué entorno usamos?' }] } } });
assert.equal(srv.snapshot().agents[0].status, 'waiting');
assert.equal(srv.snapshot().agents[0].activity, 'Necesita tu atención');
srv.handle({ ...agBase, hookEventName: 'PostToolUse', toolCall: { id: 't3', name: 'ask_question', args: {} } });
assert.equal(srv.snapshot().agents[0].status, 'working');
srv.handle({ ...agBase, hookEventName: 'PostToolUse', toolCall: { id: 't4', name: 'run_command', args: { CommandLine: 'npm test' } }, error: 'exit status 1' });
assert.ok(srv.snapshot().agents[0].errorAt > 0);
assert.match(srv.snapshot().agents[0].activity, /Falló run_command/);
ok('Antigravity maneja conectores MCP, ask_question (waiting → working) y errores de PostToolUse');

// Subagente de Antigravity vinculado por invoke_subagent
srv.handle({
  ...agBase,
  hookEventName: 'PreToolUse',
  toolCall: { id: 't5', name: 'invoke_subagent', args: { TypeName: 'research', Role: 'Codebase Researcher', Prompt: 'Explora las rutas de checkout' } },
});
const agSubBase = {
  source: 'antigravity',
  conversationId: 'ag-sub-1',
  workspacePaths: ['C:\\trabajo\\portal-clientes'],
  lastUserInput: 'Explora las rutas de checkout',
};
srv.handle({ ...agSubBase, hookEventName: 'SessionStart' });
srv.handle({ ...agSubBase, hookEventName: 'PreToolUse', toolCall: { id: 's1', name: 'grep_search', args: { Query: 'checkout' } } });
snap = srv.snapshot();
const agSub = snap.agents.find((a) => a.kind === 'sub');
assert.ok(agSub, 'el subagente de Antigravity se vinculó al principal');
assert.equal(agSub.name, 'Codebase Researcher');
assert.equal(agSub.parent, 'ag-conv-1:main');
assert.equal(agSub.provider, 'antigravity');
assert.equal(agSub.activity, 'Buscando en código');
srv.handle({ ...agSubBase, hookEventName: 'Stop', terminationReason: 'NO_TOOL_CALL', fullyIdle: true });
assert.equal(srv.snapshot().agents.find((a) => a.kind === 'sub').status, 'done');
srv.handle({ ...agBase, hookEventName: 'Stop', terminationReason: 'NO_TOOL_CALL', fullyIdle: true });
assert.equal(srv.snapshot().agents.find((a) => a.kind === 'main').status, 'idle');
srv.handle({ ...agBase, hookEventName: 'Stop', terminationReason: 'ERROR', error: 'quota exceeded', fullyIdle: true });
assert.equal(srv.snapshot().agents.find((a) => a.kind === 'main').status, 'error');
srv.agents.clear();
ok('Antigravity vincula subagentes de invoke_subagent, los marca done al parar y distingue Stop normal/error');

// -------------------------------------------------------------- 2. HTTP
console.log('Servidor HTTP');
const PORT = 4399;
const child = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('el servidor no arrancó')), 4000);
  child.stdout.on('data', (d) => {
    if (String(d).includes('lista')) {
      clearTimeout(t);
      resolve();
    }
  });
  child.on('exit', (c) => reject(new Error('el servidor salió con ' + c)));
});
const url = (p) => `http://127.0.0.1:${PORT}${p}`;
try {
  let r = await fetch(url('/'));
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Oficina de agentes/);
  for (const f of ['/app.js', '/office.js', '/pingpong.js', '/billiards.js', '/darts.js', '/styles.css', '/vendor/three.module.js', '/vendor/OrbitControls.js']) {
    r = await fetch(url(f));
    assert.equal(r.status, 200, f);
    assert.match(r.headers.get('content-type'), f.endsWith('.css') ? /text\/css/ : /javascript/);
    await r.arrayBuffer();
  }
  const threeHead = await fetch(url('/vendor/three.module.js'), { headers: { 'Accept-Encoding': 'gzip' } });
  const etag = threeHead.headers.get('etag');
  assert.ok(etag, 'sirve ETag para caché HTTP');
  await threeHead.arrayBuffer();
  const three304 = await fetch(url('/vendor/three.module.js'), { headers: { 'If-None-Match': etag } });
  assert.equal(three304.status, 304);
  ok('sirve la página y los módulos JS (con compresión gzip y caché ETag/304)');

  r = await fetch(url('/hook'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: 'h1', cwd: '/x/demo', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x/demo/a.js' } }) });
  assert.equal(r.status, 204);
  assert.equal((await r.text()).length, 0);
  r = await fetch(url('/api/state'));
  const st = await r.json();
  assert.equal(st.agents.length, 1);
  assert.equal(st.agents[0].activity, 'Editando');
  ok('POST /hook responde 204 vacío (sin decisión) y actualiza el estado');

  r = await fetch(url('/hook'), { method: 'POST', body: 'no es json' });
  assert.equal(r.status, 400);
  ok('JSON inválido → 400 sin romper nada');

  // Envío end-to-end de Antigravity mediante hooks/enviar-evento.mjs
  const agSenderLive = spawnSync(
    process.execPath,
    [path.join(root, 'hooks', 'enviar-evento.mjs'), String(PORT), '--antigravity', 'PreToolUse'],
    {
      input: JSON.stringify({
        conversationId: 'ag-http-1',
        workspacePaths: ['/x/app-agy'],
        toolCall: { id: 'c1', name: 'run_command', args: { CommandLine: 'npm test', toolSummary: 'Correr pruebas' } },
      }),
      encoding: 'utf8',
    }
  );
  assert.equal(agSenderLive.status, 0);
  assert.deepEqual(JSON.parse(agSenderLive.stdout), { decision: 'allow' });
  const stAg = await (await fetch(url('/api/state'))).json();
  const agAgent = stAg.agents.find((a) => a.name === 'Antigravity');
  assert.ok(agAgent, 'Antigravity llegó por enviar-evento.mjs al servidor');
  assert.equal(agAgent.project, 'app-agy');
  assert.equal(agAgent.activity, 'Ejecutando comando');
  assert.equal(agAgent.detail, 'Correr pruebas');
  ok('enviar-evento.mjs --antigravity entrega el evento al servidor y responde {"decision":"allow"}');

  // SSE
  const gotEvent = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('sin evento SSE')), 3000);
    const req = http.get(url('/events'), (res) => {
      assert.match(res.headers['content-type'], /text\/event-stream/);
      let buf = '';
      res.on('data', (d) => {
        buf += d;
        const m = buf.match(/data: (\{.*\})\n\n/);
        if (m) {
          clearTimeout(t);
          req.destroy();
          resolve(JSON.parse(m[1]));
        }
      });
    });
  });
  assert.equal(gotEvent.agents[0].name, 'Claude');
  ok('SSE entrega el estado inicial');

  // SSE recibe cambios en vivo
  const live = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('SSE no recibió el cambio')), 3000);
    const req = http.get(url('/events'), (res) => {
      let n = 0;
      let buf = '';
      res.on('data', async (d) => {
        buf += d;
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const p of parts) {
          if (!p.startsWith('data: ')) continue;
          n += 1;
          const snap = JSON.parse(p.slice(6));
          if (n === 1) {
            fetch(url('/hook'), { method: 'POST', body: JSON.stringify({ session_id: 'h1', cwd: '/x/demo', hook_event_name: 'Stop' }) });
          } else if (snap.agents[0].status === 'idle') {
            clearTimeout(t);
            req.destroy();
            resolve(snap);
          }
        }
      });
    });
  });
  assert.equal(live.agents[0].status, 'idle');
  ok('SSE transmite los cambios en tiempo real');

  // Seguridad
  const traversal = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/%2e%2e/server.js' }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
  });
  assert.ok([403, 404].includes(traversal), 'traversal bloqueado: ' + traversal);
  ok('no deja salir de la carpeta public (path traversal)');

  const badHost = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/api/state', headers: { Host: 'evil.example.com' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
  });
  assert.equal(badHost, 403);
  ok('rechaza Host que no sea localhost (anti DNS-rebinding)');

  r = await fetch(url('/demo/start'), { method: 'POST' });
  assert.equal(r.status, 204);
  await new Promise((res) => setTimeout(res, 3600));
  const ds = await (await fetch(url('/api/state'))).json();
  assert.equal(ds.demo, true);
  assert.ok(ds.agents.length >= 2, 'la demo creó agentes: ' + ds.agents.length);
  await fetch(url('/demo/stop'), { method: 'POST' });
  const ds2 = await (await fetch(url('/api/state'))).json();
  assert.equal(ds2.demo, false);
  ok(`la demo crea agentes (${ds.agents.length}) y se detiene limpiamente`);
} finally {
  child.kill();
}

// ------------------------------------------------- 3. instalador de hooks
console.log('Instalador de hooks');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-'));
const proj = path.join(tmp, 'proj');
fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
const settingsPath = path.join(proj, '.claude', 'settings.json');
const existing = { model: 'sonnet', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hola' }] }] } };
fs.writeFileSync(settingsPath, JSON.stringify(existing));
const run = (...a) => spawnSync(process.execPath, [path.join(root, 'instalar-hooks.mjs'), ...a], { encoding: 'utf8' });
let o = run('--proyecto', proj);
assert.equal(o.status, 0, o.stderr);
let s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.equal(s.model, 'sonnet');
assert.equal(s.hooks.PreToolUse.length, 2);
assert.equal(s.hooks.PreToolUse[0].hooks[0].command, 'echo hola');
assert.equal(s.hooks.PreToolUse[1].hooks[0].type, 'http');
assert.equal(s.hooks.PreToolUse[1].hooks[0].url, 'http://127.0.0.1:4317/hook');
assert.ok(s.hooks.SubagentStart && s.hooks.Stop && s.hooks.Notification);
assert.ok(fs.existsSync(settingsPath + '.bak-oficina'));
ok('instala sin tocar tus hooks ni tus otras opciones, y crea copia de seguridad');

run('--proyecto', proj);
s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.equal(s.hooks.PreToolUse.length, 2, 'idempotente');
ok('es idempotente (no duplica al repetirse)');

run('--proyecto', proj, '--comando');
s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.equal(s.hooks.PreToolUse.length, 2);
assert.equal(s.hooks.PreToolUse[1].hooks[0].type, 'command');
assert.equal(s.hooks.PreToolUse[1].hooks[0].command, 'node');
assert.equal(s.hooks.PreToolUse[1].hooks[0].async, true);
ok('el modo --comando reemplaza al HTTP');

run('--proyecto', proj, '--quitar');
s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.deepEqual(s, existing);
ok('--quitar deja el archivo exactamente como estaba');

fs.writeFileSync(settingsPath, '{ esto no es json');
o = run('--proyecto', proj);
assert.notEqual(o.status, 0);
assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{ esto no es json');
ok('si el settings.json está roto, no lo modifica');

// el enviador de comando (Claude Code y Antigravity sin servidor)
const sender = spawn(process.execPath, [path.join(root, 'hooks', 'enviar-evento.mjs'), '4398'], { stdio: ['pipe', 'pipe', 'pipe'] });
sender.stdin.end('{"hook_event_name":"Stop"}');
const code = await new Promise((r) => sender.on('exit', r));
assert.equal(code, 0);
ok('enviar-evento.mjs sale en silencio aunque el servidor esté apagado');

for (const [ev, expected] of [
  ['PreToolUse', { decision: 'allow' }],
  ['Stop', { decision: 'stop' }],
  ['PostToolUse', {}],
  ['SessionStart', {}],
]) {
  const res = spawnSync(
    process.execPath,
    [path.join(root, 'hooks', 'enviar-evento.mjs'), '4398', '--antigravity', ev],
    { input: '{}', encoding: 'utf8' }
  );
  assert.equal(res.status, 0, ev);
  assert.deepEqual(JSON.parse(res.stdout), expected, `stdout de ${ev}`);
}
ok('enviar-evento.mjs --antigravity responde JSON válido para cada evento incluso con servidor apagado');

// Instalador de hooks para Antigravity y modo --todos
const agProj = path.join(tmp, 'ag-proj');
fs.mkdirSync(path.join(agProj, '.agents'), { recursive: true });
const agHooksPath = path.join(agProj, '.agents', 'hooks.json');
const existingAg = {
  'mi-linter': {
    PostToolUse: [{ matcher: 'write_file', hooks: [{ type: 'command', command: 'echo lint' }] }],
  },
};
fs.writeFileSync(agHooksPath, JSON.stringify(existingAg));

o = run('--antigravity', '--proyecto', agProj);
assert.equal(o.status, 0, o.stderr);
let agDoc = JSON.parse(fs.readFileSync(agHooksPath, 'utf8'));
assert.deepEqual(agDoc['mi-linter'], existingAg['mi-linter']);
assert.ok(agDoc['oficina-agentes']);
assert.ok(Array.isArray(agDoc['oficina-agentes'].SessionStart));
assert.ok(Array.isArray(agDoc['oficina-agentes'].PreInvocation));
assert.equal(agDoc['oficina-agentes'].PreToolUse[0].matcher, '*');
assert.match(agDoc['oficina-agentes'].PreToolUse[0].hooks[0].command, /--antigravity PreToolUse/);
assert.equal(agDoc['oficina-agentes'].PostToolUse[0].matcher, '*');
assert.ok(Array.isArray(agDoc['oficina-agentes'].Stop));
assert.ok(fs.existsSync(agHooksPath + '.bak-oficina'));
ok('instalador --antigravity crea hooks.json válido sin tocar hooks existentes');

run('--antigravity', '--proyecto', agProj);
agDoc = JSON.parse(fs.readFileSync(agHooksPath, 'utf8'));
assert.equal(Object.keys(agDoc).length, 2);
assert.equal(agDoc['oficina-agentes'].PreToolUse.length, 1);
ok('instalador --antigravity es idempotente');

run('--antigravity', '--proyecto', agProj, '--quitar');
agDoc = JSON.parse(fs.readFileSync(agHooksPath, 'utf8'));
assert.deepEqual(agDoc, existingAg);
ok('instalador --antigravity --quitar deja hooks.json exactamente como estaba');

const bothProj = path.join(tmp, 'both-proj');
o = run('--todos', '--proyecto', bothProj);
assert.equal(o.status, 0, o.stderr);
assert.ok(fs.existsSync(path.join(bothProj, '.claude', 'settings.json')));
assert.ok(fs.existsSync(path.join(bothProj, '.agents', 'hooks.json')));
o = run('--todos', '--proyecto', bothProj, '--quitar');
assert.equal(o.status, 0, o.stderr);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(bothProj, '.claude', 'settings.json'), 'utf8')), {});
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(bothProj, '.agents', 'hooks.json'), 'utf8')), {});
ok('instalador --todos instala y desinstala Claude Code y Antigravity a la vez');

// ------------------------------------------------------------ 4. escena 3D
console.log('Escena 3D (sin navegador)');
const THREE = await import(pathToFileURL(path.join(root, 'public', 'vendor', 'three.module.js')).href);
const { Office, colorFor } = await import(pathToFileURL(path.join(root, 'public', 'office.js')).href);

const makeCanvas = () => {
  const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? (s) => ({ width: String(s).length * 18 }) : k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  return { width: 0, height: 0, getContext: () => ctx };
};
const office = new Office(THREE, { makeCanvas });
assert.equal(office.desks.length, 12);
let drawCalls = 0;
let instances = 0;
let instancedBatches = 0;
office.scene.traverse((o) => {
  if (o.isInstancedMesh) {
    drawCalls++;
    instancedBatches++;
    instances += o.count;
  } else if (o.isMesh) {
    drawCalls++;
    instances++;
  }
});
assert.ok(instances > 200, 'la escena tiene geometría: ' + instances);
assert.ok(instancedBatches > 5 && drawCalls < 260, `instancing activo (${drawCalls} draw calls, ${instancedBatches} lotes)`);
ok(`la escena se construye optimizada (${instances} mallas en solo ${drawCalls} draw calls, 12 escritorios)`);

const mk = (id, kind, type, status, extra = {}) => ({ id, kind, type, name: kind === 'main' ? 'Claude' : type, project: 'demo', parent: kind === 'sub' ? 'm' : null, status, activity: 'Leyendo', detail: 'src/a.ts', toolCount: 3, errorAt: 0, ...extra });
const agentsList = [mk('m', 'main', 'claude', 'working'), mk('p', 'sub', 'planificador', 'working'), mk('e', 'sub', 'ejecutor', 'working'), mk('r', 'sub', 'revisor', 'idle')];
office.setAgents(agentsList);
assert.equal(office.actors.size, 4);

let framesChecked = 0;
const step = (secs) => {
  for (let i = 0; i < secs * 60; i++) {
    office.update(1 / 60);
    for (const a of office.actors.values()) {
      const p = a.group.position;
      for (const d of office.desks) {
        // nadie puede estar dentro de la huella de un escritorio (2.4 x 1.2) con 0.2 de margen
        if (Math.abs(p.x - d.x) < 1.4 && Math.abs(p.z - d.z) < 0.8) throw new Error(`${a.id} atraviesa el escritorio ${d.index} en (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
      }
      // ni de las sillas ajenas
      for (const d of office.desks) {
        if (a.desk === d) continue;
        if (Math.hypot(p.x - d.seatX, p.z - (d.seatZ + 0.05)) < 0.35) throw new Error(`${a.id} atraviesa la silla del escritorio ${d.index}`);
      }
      framesChecked++;
    }
  }
};
const finite = () => {
  for (const a of office.actors.values()) {
    const p = a.group.position;
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), 'posición finita de ' + a.id);
    assert.ok(Math.abs(p.x) < 13 && Math.abs(p.z) < 9, `${a.id} dentro de la sala: ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
  }
};
step(12);
finite();
for (const id of ['m', 'p', 'e']) {
  const a = office.actors.get(id);
  assert.ok(a.arrived && a.target.type === 'seat', id + ' llegó a su escritorio');
  assert.ok(Math.abs(a.group.position.x - a.desk.seatX) < 0.01 && Math.abs(a.group.position.z - a.desk.seatZ) < 0.01, id + ' está en su silla');
  assert.equal(a.sit, 1, id + ' sentado');
}
const rev = office.actors.get('r');
assert.ok(rev.arrived && rev.target.type === 'spot', 'el agente libre está en la sala de descanso');
assert.ok(rev.group.position.x > 5, 'el libre está a la derecha (descanso)');
ok('al llegar, los que trabajan se sientan en su escritorio y el libre va a la sala de descanso');

const deskOf = (id) => office.actors.get(id).desk;
const mainDesk = deskOf('m');
const pDesk = deskOf('p');
assert.ok(Math.hypot(mainDesk.x - pDesk.x, mainDesk.z - pDesk.z) <= 3.6 + 0.01, 'el subagente se sienta junto a su principal');
ok('los subagentes eligen escritorio cercano al del principal');

// pasa de trabajar a libre y de libre a trabajar
agentsList[1] = { ...agentsList[1], status: 'idle' };
agentsList[3] = { ...agentsList[3], status: 'working' };
office.setAgents(agentsList);
step(14);
finite();
assert.ok(office.actors.get('p').group.position.x > 5, 'p fue a descansar');
assert.ok(office.actors.get('r').arrived && office.actors.get('r').sit === 1, 'r se sentó a trabajar');
ok('cambios de estado: se levantan, caminan por los pasillos y se sientan');

// espera permiso y error
agentsList[0] = { ...agentsList[0], status: 'waiting' };
agentsList[2] = { ...agentsList[2], status: 'error', errorAt: Date.now() };
office.setAgents(agentsList);
step(2);
finite();
ok('estados "esperando" y "error" se animan sin fallos');

// terminar: celebra y sale
agentsList[2] = { ...agentsList[2], status: 'done' };
office.setAgents(agentsList);
step(1);
assert.ok(office.actors.has('e'));
step(25);
assert.ok(!office.actors.has('e'), 'el que terminó salió por la puerta y se eliminó');
assert.equal(office.desks.filter((d) => d.owner === 'e').length, 0, 'su escritorio quedó libre');
ok('al terminar celebra, sale por la puerta y libera su escritorio');

// desaparece de la lista del servidor
office.setAgents(agentsList.filter((a) => a.id !== 'r'));
step(25);
assert.ok(!office.actors.has('r'));
ok('si el servidor lo quita, también sale caminando');

// muchos agentes: más que escritorios
const many = Array.from({ length: 16 }, (_, i) => mk('x' + i, 'sub', 'ejecutor', 'working', { parent: null }));
office.setAgents(many);
step(30);
finite();
assert.equal(office.actors.size, 16, 'los 16 están presentes y los 2 anteriores ya salieron');
const seatedNow = [...office.actors.values()].filter((a) => a.arrived && a.target.type === 'seat');
assert.equal(seatedNow.length, 12, 'los 12 escritorios están ocupados: ' + seatedNow.length);
assert.equal(new Set(seatedNow.map((a) => a.desk.index)).size, 12, 'sin dos personas en el mismo escritorio');
const standingNow = [...office.actors.values()].filter((a) => a.arrived && a.target.type === 'spot');
assert.equal(standingNow.length, 4, 'los 4 sobrantes trabajan de pie en la sala de descanso');
ok('con 16 agentes: 12 sentados, 4 de pie en la sala, ninguno repetido ni fuera de la sala');

// raycast no falla
const cam = new THREE.PerspectiveCamera(36, 1.6, 0.1, 200);
cam.position.set(17, 15.5, 19.5);
cam.lookAt(0, 0.6, 0.5);
cam.updateMatrixWorld(true);
const rc = new THREE.Raycaster();
rc.setFromCamera(new THREE.Vector2(0, 0), cam);
office.pick(rc);
ok('la selección con clic (raycaster) funciona');

assert.equal(colorFor(mk('a', 'sub', 'ejecutor', 'idle')), colorFor(mk('b', 'sub', 'ejecutor', 'idle')));
assert.notEqual(colorFor(mk('c1', 'main', 'claude', 'working', { provider: 'claude' })), colorFor(mk('a1', 'main', 'antigravity', 'working', { provider: 'antigravity' })));
ok('el mismo rol siempre tiene el mismo color y Antigravity se distingue de Claude');

// ping-pong: dos agentes libres juegan hasta ganar (5 pts, diferencia de 2) sin atravesar la mesa
const ppOffice = new Office(THREE, { makeCanvas });
ppOffice.setAgents([
  mk('pp1', 'sub', 'planificador', 'idle'),
  mk('pp2', 'sub', 'revisor', 'idle'),
  mk('pp3', 'sub', 'ejecutor', 'idle'),
]);
let ppSawRally = false;
let ppSawWin = false;
let ppRotated = false;
for (let i = 0; i < 180 * 60; i++) {
  ppOffice.update(1 / 60);
  const st = ppOffice.pingPongState();
  if (st.rally >= 2) ppSawRally = true;
  if (!ppSawWin && st.phase === 'match_over') {
    ppSawWin = true;
    assert.ok(Math.max(st.left.score, st.right.score) >= 5, 'el ganador llega al menos a 5 puntos');
    assert.ok(Math.abs(st.left.score - st.right.score) >= 2, 'victoria con ventaja mínima de 2');
  }
  if (ppSawWin && st.phase !== 'match_over' && st.left && st.right && (st.left.id === 'pp3' || st.right.id === 'pp3')) {
    ppRotated = true;
    break;
  }
  for (const a of ppOffice.actors.values()) {
    const p = a.group.position;
    if (Math.abs(p.x - 8.1) < 1.35 && Math.abs(p.z - 2.3) < 0.78) {
      throw new Error(`${a.id} atraviesa la mesa de ping-pong en (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
    }
  }
}
assert.ok(ppSawRally && ppSawWin && ppRotated, 'partido completo de ping-pong con rally, ganador y rotación');
ok('ping-pong: partido completo con reglas (5 pts, dif. 2), rotación y sin atravesar la mesa');

// billar, dardos e interacciones con expresiones faciales
const recOffice = new Office(THREE, { makeCanvas });
recOffice.setGameExhibition('billiards', true);
recOffice.setGameExhibition('darts', true);
recOffice.setAgents([mk('u1', 'main', 'claude', 'working')]);
recOffice.interact('u1', 'coffee');
let sawPoolShot = false;
let sawPoolPot = false;
let sawDartScore = false;
let sawDartWin = false;
for (let i = 0; i < 120 * 60; i++) {
  recOffice.update(1 / 60);
  const gs = recOffice.gamesState();
  if (gs.billiards.phase === 'rolling') sawPoolShot = true;
  if (gs.billiards.p0 && gs.billiards.p1 && (gs.billiards.p0.score + gs.billiards.p1.score > 0)) sawPoolPot = true;
  if (gs.darts.p0 && gs.darts.p0.score > 0) sawDartScore = true;
  if (gs.darts.phase === 'match_over') sawDartWin = true;
  if (i === 180) recOffice.interact('u1', 'wave');
  if (i === 360) recOffice.interact('u1', 'dance');
  if (sawPoolShot && sawPoolPot && sawDartScore && sawDartWin) break;
}
assert.ok(sawPoolShot && sawPoolPot, 'billar ejecuta tiros con física y emboca bolas');
assert.ok(sawDartScore && sawDartWin, 'dardos lanza, puntúa y corona ganador a 150 pts');
ok('billar, dardos e interacciones (café, saludo, baile y expresiones) funcionan sin fallos');

// modo jugador humano vs NPC en los 3 juegos (Ping-Pong, Billar y Dardos) + envío de 1 agente con NPC
const humanOffice = new Office(THREE, { makeCanvas });

// 1. Ping-Pong: Tú vs NPC en vista de primera persona
humanOffice.setGameHumanMode('pingpong', true);
humanOffice.update(1 / 60);
let hState = humanOffice.gamesState().pingpong;
assert.equal(hState.humanMode, true);
assert.equal(hState.left.name, 'Tú');
assert.ok(hState.right && hState.right.isGuest, 'el rival en Ping-Pong es un NPC');
assert.equal(hState.phase, 'serve_ready');
let fpCam = humanOffice.humanCameraTarget();
assert.ok(fpCam && fpCam.pos.x < 6.0 && fpCam.target.x > 8.0, 'cámara en 1ª persona detrás de tu lado de la mesa mirando al NPC');
assert.equal(humanOffice.pingPong.fpPaddle.visible, true, 'raqueta 3D en primera persona visible');
assert.equal(humanOffice.pingPong.humanActor.group.visible, false, 'cuerpo del jugador oculto en 1ª persona para no tapar la cámara');
// Sin pulsar acción el saque humano espera al jugador
for (let i = 0; i < 60; i++) humanOffice.update(1 / 60);
assert.equal(humanOffice.gamesState().pingpong.phase, 'serve_ready', 'el saque espera la acción del jugador');
humanOffice.gameHumanInput('pingpong', { type: 'move_z', z: 2.55, aimZ: 2.65 });
humanOffice.gameHumanInput('pingpong', { type: 'action' });
for (let i = 0; i < 45; i++) humanOffice.update(1 / 60);
hState = humanOffice.gamesState().pingpong;
assert.equal(hState.phase, 'rally', 'tras sacar con acción arranca el rally contra el NPC');

// 2. Billar: Tú vs NPC en 1ª persona con taco POV, guía 3D y tiro interactivo
humanOffice.setGameHumanMode('billiards', true);
for (let i = 0; i < 45; i++) humanOffice.update(1 / 60);
let bState = humanOffice.gamesState().billiards;
assert.equal(bState.humanMode, true);
assert.equal(bState.p0.name, 'Tú');
assert.ok(bState.p1 && bState.p1.isGuest, 'el rival en Billar es un NPC');
assert.equal(bState.phase, 'aim');
assert.equal(humanOffice.billiards.aimGroup.visible, true, 'guía 3D de puntería visible en turno humano');
assert.equal(humanOffice.billiards.fpCue.visible, true, 'taco 3D en primera persona visible frente a la cámara');
fpCam = humanOffice.humanCameraTarget();
assert.ok(fpCam && fpCam.pos.y < 1.35, 'cámara de billar en 1ª persona a ras de taco detrás de la bola blanca');
humanOffice.gameHumanInput('billiards', { type: 'aim_delta', delta: 0.05 });
humanOffice.gameHumanInput('billiards', { type: 'power', power: 3.1, manualPull: true });
humanOffice.gameHumanInput('billiards', { type: 'shoot' });
for (let i = 0; i < 25; i++) humanOffice.update(1 / 60);
assert.equal(humanOffice.gamesState().billiards.phase, 'rolling', 'el tiro humano impulsa las bolas en la mesa');

// 3. Dardos: Tú vs NPC en 1ª persona con dardo en mano POV, mirilla 3D y lanzamiento interactivo
humanOffice.setGameHumanMode('darts', true);
humanOffice.update(1 / 60);
let dState = humanOffice.gamesState().darts;
assert.equal(dState.humanMode, true);
assert.equal(dState.p0.name, 'Tú');
assert.ok(dState.p1 && dState.p1.isGuest, 'el rival en Dardos es un NPC');
assert.equal(dState.phase, 'aim');
assert.equal(humanOffice.darts.reticleGroup.visible, true, 'mirilla 3D visible en la diana');
assert.equal(humanOffice.darts.fpDart.visible, true, 'dardo 3D en primera persona visible en la mano');
fpCam = humanOffice.humanCameraTarget();
assert.ok(fpCam && Math.abs(fpCam.pos.y - 1.77) < 0.25, 'cámara de dardos en 1ª persona a la altura de los ojos frente a la diana');
humanOffice.gameHumanInput('darts', { type: 'aim_point', x: 10.35, y: 1.75 });
humanOffice.gameHumanInput('darts', { type: 'steady', active: true });
humanOffice.update(1 / 60);
humanOffice.gameHumanInput('darts', { type: 'throw' });
for (let i = 0; i < 45; i++) humanOffice.update(1 / 60);
dState = humanOffice.gamesState().darts;
assert.ok(dState.p0.score >= 25, 'el lanzamiento humano al centro suma puntos en la diana: ' + dState.p0.score);

// 4. Enviar un único agente libre a Billar lo empareja automáticamente con un NPC
humanOffice.setGameHumanMode('darts', false);
humanOffice.setAgents([mk('solo1', 'sub', 'planificador', 'idle')]);
humanOffice.interact('solo1', 'play_billiards');
humanOffice.update(1 / 60);
bState = humanOffice.gamesState().billiards;
assert.ok(bState.active && bState.p0 && bState.p1, '1 agente libre enviado a Billar juega contra un NPC');
ok('modo jugador interactivo (Tú vs NPC) en Ping-Pong, Billar y Dardos, y emparejamiento con NPCs');

console.log(`  ✓ ${framesChecked} posiciones revisadas fotograma a fotograma: nadie atravesó escritorios ni sillas ajenas`);
console.log(`\n${passed} comprobaciones superadas`);
process.exit(0);

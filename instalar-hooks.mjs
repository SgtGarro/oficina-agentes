#!/usr/bin/env node
// Agrega (o quita) los hooks de la oficina para Claude Code y/o Antigravity.
// No borra tus hooks existentes: solo añade los suyos y los reconoce al volver a ejecutarlo.
//
// Uso:
//   Claude Code (por defecto o --claude):
//     node instalar-hooks.mjs --usuario                  (~/.claude/settings.json)
//     node instalar-hooks.mjs --proyecto [carpeta]       (<carpeta>/.claude/settings.json)
//     node instalar-hooks.mjs --usuario --comando        (usa comando en vez de hook HTTP)
//
//   Antigravity (App, CLI e IDE):
//     node instalar-hooks.mjs --antigravity --usuario            (~/.gemini/config/hooks.json)
//     node instalar-hooks.mjs --antigravity --proyecto [carpeta] (<carpeta>/.agents/hooks.json)
//
//   Ambos a la vez:
//     node instalar-hooks.mjs --todos --usuario
//     node instalar-hooks.mjs --todos --proyecto [carpeta]
//
//   Desinstalar: añade --quitar    |    Puerto personalizado: --puerto 4400

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

const CLAUDE_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'Notification',
];

const ANTIGRAVITY_HOOK_KEY = 'oficina-agentes';

const port = Number(val('--puerto')) || 4317;
const url = `http://127.0.0.1:${port}/hook`;
const sender = path.join(here, 'hooks', 'enviar-evento.mjs');
const remove = has('--quitar');

if (!has('--usuario') && !has('--proyecto')) {
  console.log(
    'Indica dónde instalar:\n' +
      '  --usuario            global para todos tus proyectos\n' +
      '  --proyecto [carpeta] solo para ese proyecto (por defecto, la carpeta actual)\n\n' +
      'Plataforma:\n' +
      '  (por defecto)        Claude Code (~/.claude/settings.json o .claude/settings.json)\n' +
      '  --antigravity        Antigravity App/CLI/IDE (~/.gemini/config/hooks.json o .agents/hooks.json)\n' +
      '  --todos              Claude Code y Antigravity juntos\n\n' +
      'Opciones: --comando (Claude Code sin HTTP), --quitar (desinstalar), --puerto 4400'
  );
  process.exit(1);
}

const doTodos = has('--todos');
const doAntigravity = doTodos || has('--antigravity');
const doClaude = doTodos || has('--claude') || !doAntigravity;

const projectDir = has('--proyecto') ? path.resolve(val('--proyecto') || process.cwd()) : null;

function readJsonOrFail(file) {
  if (!fs.existsSync(file)) return { data: {}, existed: false };
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('la raíz debe ser un objeto JSON');
    }
    const bak = file + '.bak-oficina';
    if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
    return { data, existed: true };
  } catch (e) {
    console.error(`No pude leer ${file} como JSON (${e.message}). No lo modifiqué.`);
    process.exit(1);
  }
}

function quoteShellArg(s) {
  return /[\s"&|<>^()]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

function installClaude() {
  const target = has('--usuario')
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(projectDir, '.claude', 'settings.json');

  const isLocalOfficeHttp = (u) => typeof u === 'string' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/hook$/.test(u);
  const ours = (h) =>
    h &&
    ((h.type === 'http' && (h.url === url || (remove && isLocalOfficeHttp(h.url)))) ||
      (h.type === 'command' && Array.isArray(h.args) && h.args.some((a) => String(a).endsWith('enviar-evento.mjs'))));

  const handler = has('--comando')
    ? { type: 'command', command: 'node', args: [sender, String(port)], async: true }
    : { type: 'http', url, timeout: 5 };

  const { data: settings, existed } = readJsonOrFail(target);
  if (remove && !existed) {
    console.log(`No había hooks de Claude Code en ${target}`);
    return;
  }
  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};

  for (const ev of CLAUDE_EVENTS) {
    const groups = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
    const cleaned = groups
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !ours(h)) }))
      .filter((g) => g.hooks.length > 0);
    if (!remove) cleaned.push({ hooks: [handler] });
    if (cleaned.length) settings.hooks[ev] = cleaned;
    else delete settings.hooks[ev];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  console.log(
    remove
      ? `Hooks de la oficina eliminados de ${target}`
      : `Hooks de la oficina instalados en ${target} (${has('--comando') ? 'modo comando' : 'modo HTTP'}, puerto ${port}).`
  );
  if (!remove) console.log('Abre una sesión nueva de Claude Code y escribe /hooks para comprobar que aparecen.');
}

function installAntigravity() {
  const target = has('--usuario')
    ? path.join(os.homedir(), '.gemini', 'config', 'hooks.json')
    : path.join(projectDir, '.agents', 'hooks.json');

  const { data: hooksDoc, existed } = readJsonOrFail(target);
  if (remove && !existed) {
    console.log(`No había hooks de Antigravity en ${target}`);
    return;
  }

  if (remove) {
    delete hooksDoc[ANTIGRAVITY_HOOK_KEY];
  } else {
    const mkHandler = (ev) => ({
      type: 'command',
      command: `node ${quoteShellArg(sender)} ${port} --antigravity ${ev}`,
      timeout: 5,
    });
    hooksDoc[ANTIGRAVITY_HOOK_KEY] = {
      SessionStart: [mkHandler('SessionStart')],
      PreInvocation: [mkHandler('PreInvocation')],
      PreToolUse: [{ matcher: '*', hooks: [mkHandler('PreToolUse')] }],
      PostToolUse: [{ matcher: '*', hooks: [mkHandler('PostToolUse')] }],
      PostInvocation: [mkHandler('PostInvocation')],
      Stop: [mkHandler('Stop')],
    };
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(hooksDoc, null, 2) + '\n', 'utf8');

  console.log(
    remove
      ? `Hooks de Antigravity eliminados de ${target}`
      : `Hooks de Antigravity instalados en ${target} (puerto ${port}).`
  );
  if (!remove) {
    console.log('Funciona en Antigravity App, CLI e IDE. Escribe /hooks en Antigravity CLI o revisa Settings > Customizations > Hooks.');
  }
}

if (doClaude) installClaude();
if (doAntigravity) installAntigravity();

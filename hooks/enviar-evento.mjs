#!/usr/bin/env node
// Reenvía eventos de hooks (Claude Code en modo --comando y Antigravity via hooks.json)
// al servidor local de la oficina. Nunca falla para no bloquear ni interrumpir al agente.
//
// Uso:
//   node enviar-evento.mjs [puerto]
//   node enviar-evento.mjs [puerto] --antigravity <Evento>

import http from 'node:http';

const args = process.argv.slice(2);
const port = Number(args[0]) || 4317;
const agIdx = args.indexOf('--antigravity');
const isAntigravity = agIdx >= 0;
const agEvent = isAntigravity && args[agIdx + 1] ? args[agIdx + 1] : '';

function antigravityReply(eventName) {
  if (eventName === 'PreToolUse') return '{"decision":"allow"}\n';
  if (eventName === 'Stop') return '{"decision":"stop"}\n';
  return '{}\n';
}

function postJson(body, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/hook',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
        res.on('error', resolve);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.on('error', () => resolve());
    req.end(body);
  });
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', async () => {
  let body = raw;
  let eventForReply = agEvent;

  if (isAntigravity) {
    let parsed = {};
    if (raw.trim()) {
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) parsed = obj;
      } catch {
        // Ignorar JSON malformado en stdin
      }
    }
    eventForReply = parsed.hookEventName || agEvent;
    parsed.source = 'antigravity';
    if (eventForReply && !parsed.hookEventName) parsed.hookEventName = eventForReply;
    body = JSON.stringify(parsed);
  }

  try {
    await postJson(body, isAntigravity ? 600 : 2000);
  } catch {
    // El servidor puede no estar encendido; no pasa nada.
  }

  if (isAntigravity) {
    process.stdout.write(antigravityReply(eventForReply));
  }
  process.exit(0);
});

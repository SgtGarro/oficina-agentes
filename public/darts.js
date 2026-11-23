// Arena de Dardos 3D en la pared del fondo del lounge Silicon Valley:
// diana reglamentaria de 20 sectores, vuelos parabólicos con vibración al clavarse,
// marcador electrónico 3D, mini-reglas (a 150 pts) y animaciones atléticas de lanzamiento.

export const DARTS_ZONE = {
  boardX: 10.35,
  boardY: 1.75,
  boardZ: -7.86,
  boardR: 0.42,
  throwX: 10.35,
  throwZ: -5.05,
  waitX: 11.15,
  waitZ: -4.42,
};

export const DARTS_RULES = {
  targetScore: 150,
  dartsPerTurn: 3,
};

const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const GRAVITY = 5.2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const dampAngle = (cur, target, lambda, dt) => cur + wrapAngle(target - cur) * (1 - Math.exp(-lambda * dt));
const cssHex = (n) => '#' + n.toString(16).padStart(6, '0');

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export class DartsArena {
  constructor(office) {
    this.office = office;
    this.THREE = office.THREE;
    this.time = 0;

    this.exhibition = false;
    this.humanMode = false;
    this.humanActor = null;
    this.humanOpponentId = null;
    this.humanAimX = 0;
    this.humanAimY = DARTS_ZONE.boardR * 0.44;
    this.reticlePos = { x: 0, y: DARTS_ZONE.boardR * 0.44 };
    this.aimPreview = null;
    this._humanLockedTarget = null;
    this.humanSteady = false;
    this.guests = [];
    this.players = []; // 1 o 2 jugadores
    this.requestedIds = [];
    this.wins = new Map();

    // Estado de la partida
    this.phase = 'idle'; // 'idle' | 'aim' | 'throw' | 'flight' | 'react' | 'turn_pause' | 'match_over'
    this.phaseTime = 0;
    this.turn = 0;
    this.dartIdx = 0; // 0, 1, 2
    this.scores = [0, 0];
    this.visitTags = [];
    this.visitTotal = 0;
    this.bestVisit = 0;
    this.lastHit = null;
    this.winnerIdx = -1;
    this.winnerName = '';
    this.lastEvent = '';
    this._boardKey = '';
    this._boardPop = 0;
    this._rngState = 4242;
    this._spotLight = null;

    // 3 dardos físicos en escena (vuelo + clavados en diana)
    this.dartMeshes = [];
    this.flight = null;

    this._buildDartboard();
    this._buildScoreboard();
    this._buildDarts();
    this._drawScoreboard(true);
  }

  _rand() {
    this._rngState = (Math.imul(this._rngState, 1664525) + 1013904223) >>> 0;
    return this._rngState / 4294967296;
  }

  // ------------------------------------------------ geometría de la diana
  _buildDartboard() {
    const T = this.THREE;
    const o = this.office;
    const g = new T.Group();
    g.position.set(DARTS_ZONE.boardX, DARTS_ZONE.boardY, -7.95);
    o.scene.add(g);

    // Panel trasero de nogal estilo estudio Silicon Valley
    o._box(1.06, 1.16, 0.06, 0x6b472b, 0, 0, 0.03, g, { cast: false, rough: 0.65 });
    o._box(1.0, 1.1, 0.02, 0x1e293b, 0, 0, 0.065, g, { cast: false, rough: 0.85 });

    // Foco de galería minimalista iluminando la diana desde arriba
    o._box(0.38, 0.04, 0.14, 0x1e293b, 0, 0.68, 0.14, g, { cast: false, rough: 0.35, metal: 0.6 });
    const bulbMat = new T.MeshBasicMaterial({ color: 0xfff3d6 });
    bulbMat.toneMapped = false;
    o._mesh(new T.BoxGeometry(0.28, 0.015, 0.06), bulbMat, 0, 0.655, 0.17, g, { cast: false, receive: false });

    const spot = new T.PointLight(0xffe7c2, 0.4, 4.5, 1.8);
    spot.position.set(DARTS_ZONE.boardX, DARTS_ZONE.boardY + 0.55, -7.45);
    o.scene.add(spot);
    this._spotLight = spot;

    // Textura reglamentaria de 20 sectores de alta definición
    const boardTex = o._texture(512, 512, 1, 1, (ctx, w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      const R = w * 0.48;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);

      // Anillo negro exterior (números)
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      const rDoubleOut = R * 0.80;
      const rDoubleIn = R * 0.72;
      const rTripleOut = R * 0.50;
      const rTripleIn = R * 0.42;
      const rOuterBull = R * 0.125;
      const rBull = R * 0.058;

      const slice = (Math.PI * 2) / 20;
      for (let i = 0; i < 20; i++) {
        const a0 = -Math.PI / 2 - slice / 2 + i * slice;
        const a1 = a0 + slice;
        const even = i % 2 === 0;

        const wedge = (rOut, col) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, rOut, a0, a1);
          ctx.closePath();
          ctx.fill();
        };

        wedge(rDoubleOut, even ? '#dc2626' : '#16a34a');
        wedge(rDoubleIn, even ? '#14181f' : '#f4ecd8');
        wedge(rTripleOut, even ? '#dc2626' : '#16a34a');
        wedge(rTripleIn, even ? '#14181f' : '#f4ecd8');

        // Número del sector
        const mid = (a0 + a1) / 2;
        const nr = R * 0.9;
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '700 22px "Instrument Sans", system-ui, sans-serif';
        const txt = String(SECTORS[i]);
        const tw = ctx.measureText(txt).width;
        ctx.fillText(txt, cx + Math.cos(mid) * nr - tw / 2, cy + Math.sin(mid) * nr + 8);
      }

      // Outer bull (25) y Bullseye (50)
      ctx.fillStyle = '#16a34a';
      ctx.beginPath();
      ctx.arc(cx, cy, rOuterBull, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(cx, cy, rBull, 0, Math.PI * 2);
      ctx.fill();

      // Alambres metálicos sutiles
      ctx.strokeStyle = 'rgba(226,232,240,0.55)';
      ctx.lineWidth = 2;
      for (const rr of [rDoubleOut, rDoubleIn, rTripleOut, rTripleIn, rOuterBull, rBull]) {
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // Cilindro de la diana + cara frontal con textura
    const rim = o._cyl(DARTS_ZONE.boardR, DARTS_ZONE.boardR, 0.055, 0x111827, 0, 0, 0.09, g, { seg: 32, rough: 0.7 });
    rim.rotation.x = Math.PI / 2;
    const face = o._mesh(new T.CircleGeometry(DARTS_ZONE.boardR - 0.004, 36), new T.MeshStandardMaterial({ map: boardTex, roughness: 0.72 }), 0, 0, 0.12, g, { cast: false });
    face.receiveShadow = false;

    // Línea de tiro (Oche) sobre el parquet de madera
    o._box(0.86, 0.008, 0.06, 0xf8fafc, DARTS_ZONE.throwX, 0.008, DARTS_ZONE.throwZ - 0.24, null, { cast: false, rough: 0.5 });
    o._box(0.86, 0.008, 0.018, 0xef4444, DARTS_ZONE.throwX, 0.009, DARTS_ZONE.throwZ - 0.24, null, { cast: false, rough: 0.5 });

    // Mirilla 3D en la diana para cuando juega el usuario
    const ret = new T.Group();
    ret.position.set(DARTS_ZONE.boardX, DARTS_ZONE.boardY + DARTS_ZONE.boardR * 0.44, DARTS_ZONE.boardZ + 0.038);
    ret.visible = false;
    ret.userData.dynamic = true;
    o.scene.add(ret);
    this.reticleGroup = ret;

    const retMat = new T.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.94, side: T.DoubleSide, depthTest: false });
    retMat.toneMapped = false;
    this.reticleMat = retMat;
    const ring = new T.Mesh(o._geo('dartRetRing', () => new T.RingGeometry(0.024, 0.034, 24)), retMat);
    ring.renderOrder = 22;
    ring.raycast = () => {};
    const dot = new T.Mesh(o._geo('dartRetDot', () => new T.CircleGeometry(0.007, 12)), retMat);
    dot.renderOrder = 22;
    dot.raycast = () => {};
    ret.add(ring, dot);
  }

  _buildScoreboard() {
    const T = this.THREE;
    const o = this.office;
    const head = new T.Group();
    head.userData.dynamic = true;
    head.position.set(11.42, 1.76, -7.91);
    o.scene.add(head);
    this.boardHead = head;

    o._box(0.88, 0.92, 0.05, 0x1e293b, 0, 0, 0, head, { cast: false, rough: 0.42, metal: 0.3 });

    this.boardCanvas = o.makeCanvas();
    this.boardCanvas.width = 400;
    this.boardCanvas.height = 420;
    this.boardTex = new T.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = T.SRGBColorSpace;
    this.boardTex.anisotropy = 4;

    const mat = new T.MeshBasicMaterial({ map: this.boardTex });
    mat.toneMapped = false;
    o._mesh(new T.PlaneGeometry(0.82, 0.86), mat, 0, 0, 0.03, head, { cast: false, receive: false });
  }

  _makeDartMesh(color = 0x3b82f6) {
    const T = this.THREE;
    const o = this.office;
    const g = new T.Group();
    // Punta metálica hacia -Z (hacia la diana)
    const tip = o._cyl(0.002, 0.008, 0.055, 0xe2e8f0, 0, 0, -0.065, g, { seg: 8, cast: false, rough: 0.25, metal: 0.8 });
    tip.rotation.x = Math.PI / 2;
    const barrel = o._cyl(0.011, 0.009, 0.095, 0xd4a359, 0, 0, 0.005, g, { seg: 10, cast: false, rough: 0.32, metal: 0.65 });
    barrel.rotation.x = Math.PI / 2;
    const finMat = new T.MeshStandardMaterial({ color, roughness: 0.45 });
    const f1 = new T.Mesh(o._geo('dartFin', () => new T.BoxGeometry(0.058, 0.004, 0.068)), finMat);
    f1.position.set(0, 0, 0.085);
    const f2 = new T.Mesh(o._geo('dartFin', () => new T.BoxGeometry(0.058, 0.004, 0.068)), finMat);
    f2.position.set(0, 0, 0.085);
    f2.rotation.z = Math.PI / 2;
    g.add(f1, f2);
    g.userData.finMat = finMat;
    g.visible = false;
    return g;
  }

  _buildDarts() {
    for (let i = 0; i < 3; i++) {
      const m = this._makeDartMesh(0x3b82f6);
      m.userData.dynamic = true;
      this.office.scene.add(m);
      this.dartMeshes.push({ mesh: m, stuck: false, wobble: 0, baseRotX: 0, baseRotY: 0 });
    }
    this.fpDart = null;
  }

  _ensureFpDart() {
    if (this.fpDart) return;
    this.fpDart = this._makeDartMesh(0x4f5ee8);
    this.fpDart.scale.setScalar(1.38);
    this.fpDart.userData.dynamic = true;
    this.fpDart.visible = false;
    this.office.scene.add(this.fpDart);
  }

  attachHandDart(actor) {
    const d = this._makeDartMesh(actor.role);
    d.position.set(0, -0.24, 0.04);
    d.rotation.set(-Math.PI * 0.45, 0, 0);
    d.scale.setScalar(0.001);
    d.visible = false;
    actor.parts.elbowR.add(d);
    actor.parts.handDart = d;
    actor._dartScale = 0.001;
  }

  // ------------------------------------------------ gestión de jugadores
  isActivePlayer(actor) {
    return Boolean(actor && this.players.includes(actor));
  }

  getActorTarget(actor) {
    const idx = this.players.indexOf(actor);
    if (idx < 0) return null;
    const isThrower = idx === this.turn;
    const x = isThrower ? DARTS_ZONE.throwX : DARTS_ZONE.waitX;
    const z = isThrower ? DARTS_ZONE.throwZ : DARTS_ZONE.waitZ;
    return { key: `darts-${idx}-${isThrower ? 't' : 'w'}`, type: 'spot', spot: { index: 120 + idx, x, z } };
  }

  requestPlayer(actor) {
    if (!actor || actor.data.status !== 'idle') return;
    if (!this.requestedIds.includes(actor.id)) this.requestedIds.unshift(actor.id);
    if (this.requestedIds.length > 2) this.requestedIds.length = 2;
  }

  removePlayer(actor) {
    if (!actor) return;
    this.requestedIds = this.requestedIds.filter((id) => id !== actor.id);
    const had = this.players.includes(actor);
    if (had) {
      this.players = this.players.filter((p) => p !== actor);
      if (!this.players.length) {
        this.phase = 'idle';
        this._clearBoardDarts();
        this._drawScoreboard(true);
      } else {
        this.turn = 0;
      }
    }
  }

  setExhibition(enabled) {
    const next = Boolean(enabled);
    if (next && this.humanMode) {
      this.setHumanMode(false);
    }
    if (this.exhibition === next) return;
    this.exhibition = next;
    if (!next) this._clearGuests();
    else this._ensureGuests();
    this._drawScoreboard(true);
  }

  setHumanMode(enabled, opponentId = null) {
    const next = Boolean(enabled);
    if (this.humanMode === next && (!next || this.humanOpponentId === opponentId)) return;
    this.humanMode = next;
    this.humanOpponentId = opponentId && opponentId !== '__dart_human' ? opponentId : null;
    this.humanAimX = 0;
    this.humanAimY = DARTS_ZONE.boardR * 0.44;
    this._humanLockedTarget = null;
    if (next) {
      this.exhibition = false;
      this._ensureFpDart();
      this._ensureHumanActor();
      this._ensureGuests();
      this.phase = 'idle';
    } else {
      this.players = this.players.filter((p) => p !== this.humanActor);
      this._clearHumanActor();
      this._clearGuests();
      if (this.reticleGroup) this.reticleGroup.visible = false;
      if (this.fpDart) this.fpDart.visible = false;
      this.humanSteady = false;
      this._clearBoardDarts();
      this.phase = 'idle';
    }
    this._drawScoreboard(true);
  }

  getFirstPersonCamera() {
    if (!this.humanMode) return null;
    const T = this.THREE;
    if (this.turn === 0) {
      return {
        pos: new T.Vector3(
          DARTS_ZONE.boardX + this.humanAimX * 0.16,
          DARTS_ZONE.boardY + 0.02 + this.humanAimY * 0.14,
          DARTS_ZONE.boardZ + 1.88
        ),
        target: new T.Vector3(
          DARTS_ZONE.boardX + 0.08 + this.humanAimX * 0.32,
          DARTS_ZONE.boardY + this.humanAimY * 0.32,
          DARTS_ZONE.boardZ
        ),
      };
    }
    return {
      pos: new T.Vector3(DARTS_ZONE.boardX - 0.92, DARTS_ZONE.boardY + 0.08, DARTS_ZONE.throwZ + 0.55),
      target: new T.Vector3(DARTS_ZONE.boardX + 0.15, DARTS_ZONE.boardY - 0.05, DARTS_ZONE.boardZ + 0.45),
    };
  }

  _ensureHumanActor() {
    if (this.humanActor) return;
    const d = {
      id: '__dart_human',
      kind: 'main',
      type: 'human',
      name: 'Tú',
      project: 'Jugador',
      status: 'idle',
      activity: 'Dardos',
      detail: 'Jugando contra NPC',
      tool: null,
      toolCount: 0,
      errorAt: 0,
    };
    const a = this.office._makeActor(d);
    a.isGuest = true;
    a.isHuman = true;
    a.group.position.set(DARTS_ZONE.throwX, 0, DARTS_ZONE.throwZ);
    a.yaw = Math.PI;
    a.targetYaw = Math.PI;
    a.arrived = true;
    a.target = { key: 'darts-0-t', type: 'spot', spot: { x: DARTS_ZONE.throwX, z: DARTS_ZONE.throwZ } };
    this.office._drawLabel(a, true);
    this.humanActor = a;
  }

  _clearHumanActor() {
    if (!this.humanActor) return;
    this.players = this.players.filter((p) => p !== this.humanActor);
    this.office._dispose(this.humanActor);
    this.humanActor = null;
  }

  handleHumanInput(input) {
    if (!this.humanMode || !input) return;
    const R = DARTS_ZONE.boardR * 0.92;
    const isMyTurn = this.turn === 0 && this.phase === 'aim';
    if (input.type === 'aim_point' && Number.isFinite(input.x) && Number.isFinite(input.y)) {
      this.humanAimX = clamp(input.x - DARTS_ZONE.boardX, -R, R);
      this.humanAimY = clamp(input.y - DARTS_ZONE.boardY, -R, R);
    } else if (input.type === 'aim_delta' && Number.isFinite(input.dx) && Number.isFinite(input.dy)) {
      this.humanAimX = clamp(this.humanAimX + input.dx, -R, R);
      this.humanAimY = clamp(this.humanAimY + input.dy, -R, R);
    } else if (input.type === 'steady') {
      this.humanSteady = Boolean(input.active);
    } else if (input.type === 'throw' && isMyTurn) {
      this.humanSteady = false;
      this._humanLockedTarget = this._scoreAtOffset(this.reticlePos.x, this.reticlePos.y);
      if (this.reticleGroup) this.reticleGroup.visible = false;
      this.phase = 'throw';
      this.phaseTime = 0;
      if (this.office.bumpGamesVersion) this.office.bumpGamesVersion();
    }
  }

  _ensureGuests() {
    if (this.guests.length) return;
    const defs = [
      { id: '__dart_guest_a', kind: 'sub', type: 'dart-a', name: 'Lucas', project: 'sala', status: 'idle', activity: 'Dardos', detail: '', tool: null, toolCount: 0, errorAt: 0 },
      { id: '__dart_guest_b', kind: 'sub', type: 'dart-b', name: 'Elena', project: 'sala', status: 'idle', activity: 'Dardos', detail: '', tool: null, toolCount: 0, errorAt: 0 },
    ];
    defs.forEach((d, idx) => {
      const a = this.office._makeActor(d);
      a.isGuest = true;
      const x = idx === 0 ? DARTS_ZONE.throwX : DARTS_ZONE.waitX;
      const z = idx === 0 ? DARTS_ZONE.throwZ : DARTS_ZONE.waitZ;
      a.group.position.set(x, 0, z);
      a.yaw = Math.PI;
      a.targetYaw = Math.PI;
      a.arrived = true;
      a.target = { key: `darts-${idx}`, type: 'spot', spot: { x, z } };
      this.office._drawLabel(a, true);
      this.guests.push(a);
    });
  }

  _clearGuests() {
    for (const g of this.guests) {
      this.players = this.players.filter((p) => p !== g);
      this.office._dispose(g);
    }
    this.guests = [];
  }

  syncPlayers(availableIdleActors) {
    const pool = availableIdleActors.filter((a) => !a.leaving && a.data.status === 'idle');
    this.requestedIds = this.requestedIds.filter((id) => pool.some((a) => a.id === id));

    if (this.humanMode) {
      this._ensureHumanActor();
      this._ensureGuests();
      let opp = null;
      if (this.humanOpponentId) {
        opp = pool.find((a) => a.id === this.humanOpponentId) || this.guests.find((g) => g.id === this.humanOpponentId) || null;
      }
      if (!opp && this.requestedIds.length) {
        opp = this.requestedIds.map((id) => pool.find((a) => a.id === id)).find(Boolean) || null;
      }
      if (!opp && pool.length >= 1) {
        opp = pool[0];
      }
      if (!opp) {
        opp = this.guests[1] || this.guests[0];
      }
      for (const g of this.guests) {
        g.group.visible = g === opp;
      }
      const pair = [this.humanActor, opp];
      const changed = pair.length !== this.players.length || pair.some((a, i) => this.players[i] !== a);
      this.players = pair;
      if (changed || this.phase === 'idle') {
        this._startNewMatch();
      }
      return;
    }

    // Si el usuario envió explícitamente a 1 agente a jugar a los dardos y está solo, sumar NPC rival
    if (this.requestedIds.length > 0 && pool.length === 1 && !this.exhibition) {
      this.exhibition = true;
    }

    if (pool.length >= 1 && !this.exhibition) {
      const ordered = [
        ...this.requestedIds.map((id) => pool.find((a) => a.id === id)).filter(Boolean),
        ...pool,
      ];
      const unique = [...new Set(ordered)].slice(0, 2);
      const changed = unique.length !== this.players.length || unique.some((a, i) => this.players[i] !== a);
      this.players = unique;
      if (changed) this._startNewMatch();
      return;
    }

    if (this.exhibition) {
      this._ensureGuests();
      const mix = pool.length >= 2 ? pool.slice(0, 2) : pool.length === 1 ? [pool[0], this.guests[1]] : this.guests;
      if (pool.length >= 2) {
        this._clearGuests();
        this.exhibition = false;
      } else if (pool.length === 1 && this.guests[0]) {
        this.guests[0].group.visible = false;
      } else if (this.guests[0]) {
        this.guests[0].group.visible = true;
      }
      const changed = mix.length !== this.players.length || mix.some((a, i) => this.players[i] !== a);
      this.players = mix;
      if (changed) this._startNewMatch();
      return;
    }

    this._clearGuests();
    if (this.players.length) {
      this.players = [];
      this.phase = 'idle';
      this._clearBoardDarts();
      this._drawScoreboard(true);
    }
  }

  _clearBoardDarts() {
    for (const dm of this.dartMeshes) {
      dm.mesh.visible = false;
      dm.stuck = false;
      dm.wobble = 0;
    }
  }

  _startNewMatch() {
    this.scores = [0, 0];
    this.turn = 0;
    this.dartIdx = 0;
    this.visitTags = [];
    this.visitTotal = 0;
    this.lastHit = null;
    this.winnerIdx = -1;
    this.winnerName = '';
    this.lastEvent = '3 dardos por turno · Meta 150 pts';
    this._clearBoardDarts();
    this.phase = this.players.length ? 'aim' : 'idle';
    this.phaseTime = 0;
    this._drawScoreboard(true);
  }

  _throwerReady() {
    const a = this.players[this.turn];
    return Boolean(a && (a.isGuest || a.arrived));
  }

  // ------------------------------------------------ física y puntuación
  _scoreAtOffset(tx, ty) {
    const R = DARTS_ZONE.boardR;
    const rNorm = Math.hypot(tx, ty) / (R * 0.96);
    let points = 0;
    let tag = '0';
    let special = '';

    if (rNorm <= 0.062) {
      points = 50;
      tag = 'BULL';
      special = '¡BULLSEYE! +50';
    } else if (rNorm <= 0.13) {
      points = 25;
      tag = '25';
      special = '¡Centro! +25';
    } else if (rNorm <= 0.80) {
      // Calcular ángulo desde arriba (12 en punto) en sentido horario
      let a = Math.atan2(tx, ty);
      if (a < 0) a += Math.PI * 2;
      const idx = Math.floor(((a + Math.PI / 20) % (Math.PI * 2)) / (Math.PI / 10));
      const base = SECTORS[idx % 20];
      if (rNorm >= 0.42 && rNorm <= 0.50) {
        points = base * 3;
        tag = `T${base}`;
        if (base === 20) special = '¡TRIPLE 20! +60';
      } else if (rNorm >= 0.72 && rNorm <= 0.80) {
        points = base * 2;
        tag = `D${base}`;
      } else {
        points = base;
        tag = String(base);
      }
    }

    return {
      x: DARTS_ZONE.boardX + tx,
      y: DARTS_ZONE.boardY + ty,
      z: DARTS_ZONE.boardZ + 0.03,
      points,
      tag,
      special,
    };
  }

  _sampleTarget() {
    // Puntería hábil hacia Triple 20 o Bullseye con dispersión realista
    const aimBull = this._rand() < 0.34;
    const R = DARTS_ZONE.boardR;
    let tx;
    let ty;
    if (aimBull) {
      const rad = this._rand() * R * 0.24;
      const ang = this._rand() * Math.PI * 2;
      tx = Math.cos(ang) * rad;
      ty = Math.sin(ang) * rad;
    } else {
      // Apunta alrededor de T20 (arriba centro)
      tx = (this._rand() - 0.5) * R * 0.24;
      ty = R * 0.44 + (this._rand() - 0.5) * R * 0.26;
    }
    return this._scoreAtOffset(tx, ty);
  }

  _launchDart() {
    const actor = this.players[this.turn];
    const target = (this.humanMode && this.turn === 0 && this._humanLockedTarget)
      ? this._humanLockedTarget
      : this._sampleTarget();
    this._humanLockedTarget = null;
    const dm = this.dartMeshes[this.dartIdx];
    dm.mesh.userData.finMat.color.setHex(actor ? actor.role : 0x3b82f6);
    dm.mesh.visible = true;
    dm.stuck = false;
    dm.wobble = 0;

    const fpThrow = Boolean(this.humanMode && this.office.firstPersonMode && this.turn === 0);
    const sx = fpThrow
      ? DARTS_ZONE.boardX + 0.14 + this.reticlePos.x * 0.42
      : (actor ? actor.group.position.x : DARTS_ZONE.throwX) + 0.16;
    const sy = fpThrow ? DARTS_ZONE.boardY - 0.17 + this.reticlePos.y * 0.42 : 1.62;
    const sz = fpThrow
      ? DARTS_ZONE.boardZ + 1.44
      : (actor ? actor.group.position.z : DARTS_ZONE.throwZ) - 0.25;
    const dur = fpThrow ? 0.28 : 0.34;
    const vy = (target.y - sy + 0.5 * GRAVITY * dur * dur) / dur;

    this.flight = {
      dm,
      t: 0,
      dur,
      sx,
      sy,
      sz,
      vy,
      target,
    };
    this.phase = 'flight';
    this.phaseTime = 0;
  }

  // ------------------------------------------------ actualización por frame
  update(dt) {
    this.time += dt;
    this.phaseTime += dt;

    if (this._spotLight) {
      const tgt = this.office.theme === 'dark' ? 3.2 : 0.4;
      if (Math.abs(this._spotLight.intensity - tgt) > 0.004) {
        this._spotLight.intensity = damp(this._spotLight.intensity, tgt, 6, dt);
        if (Math.abs(this._spotLight.intensity - tgt) <= 0.004) this._spotLight.intensity = tgt;
        this._spotLight.visible = this._spotLight.intensity > 0.02;
      }
    }

    if (this._boardPop > 0) {
      this._boardPop = Math.max(0, this._boardPop - dt * 4);
      this.boardHead.scale.setScalar(1 + Math.sin(this._boardPop * Math.PI) * 0.08);
    } else if (this.boardHead.scale.x !== 1) {
      this.boardHead.scale.setScalar(1);
    }

    if (this.humanActor) {
      const fp = Boolean(this.humanMode && this.office.firstPersonMode);
      this.humanActor.group.visible = Boolean(this.humanMode && !fp);
      if (this.humanActor.group.visible) {
        this.humanActor.spawnScale = damp(this.humanActor.spawnScale, 1, 10, dt);
        this.humanActor.group.scale.setScalar(this.humanActor.spawnScale);
        this.office._pose(this.humanActor, dt, false);
      }
    }
    if (this.fpDart) {
      const showFpDart = Boolean(
        this.humanMode &&
        this.office.firstPersonMode &&
        this.turn === 0 &&
        (this.phase === 'aim' || this.phase === 'throw')
      );
      this.fpDart.visible = showFpDart;
      if (showFpDart) {
        const pullBack = this.humanSteady ? 0.08 : (this.phase === 'throw' ? -0.14 : 0);
        const fx = DARTS_ZONE.boardX + 0.14 + this.reticlePos.x * 0.42;
        const fy = DARTS_ZONE.boardY - 0.17 + this.reticlePos.y * 0.42;
        const fz = DARTS_ZONE.boardZ + 1.48 + pullBack;
        this.fpDart.position.set(fx, fy, fz);
        const tx = DARTS_ZONE.boardX + this.reticlePos.x;
        const ty = DARTS_ZONE.boardY + this.reticlePos.y;
        const tz = DARTS_ZONE.boardZ;
        this.fpDart.rotation.set(
          Math.atan2(ty - fy, Math.abs(tz - fz)) + 0.08,
          Math.atan2( fx - tx, fz - tz),
          0
        );
      }
    }

    for (const g of this.guests) {
      if (!g.group.visible) continue;
      g.spawnScale = damp(g.spawnScale, 1, 10, dt);
      g.group.scale.setScalar(g.spawnScale);
      this.office._pose(g, dt, false);
    }

    // Vibración amortiguada en los dardos recién clavados
    for (const dm of this.dartMeshes) {
      if (dm.stuck && dm.wobble > 0) {
        dm.wobble = Math.max(0, dm.wobble - dt * 3.4);
        const osc = Math.sin(dm.wobble * 28) * dm.wobble * 0.14;
        dm.mesh.rotation.x = dm.baseRotX + osc;
        dm.mesh.rotation.y = dm.baseRotY + osc * 0.5;
      }
    }

    if (this.phase === 'idle' || !this.players.length) {
      if (this.reticleGroup) this.reticleGroup.visible = false;
      return;
    }

    if (this.phase === 'aim') {
      if (this.humanMode && this.turn === 0) {
        const R = DARTS_ZONE.boardR * 0.94;
        const swayMul = this.humanSteady ? 0.25 : 1.0;
        const swayX = (Math.sin(this.time * 2.9) * 0.014 + Math.cos(this.time * 5.1) * 0.006) * swayMul;
        const swayY = (Math.cos(this.time * 2.5) * 0.014 + Math.sin(this.time * 4.5) * 0.006) * swayMul;
        this.reticlePos.x = clamp(this.humanAimX + swayX, -R, R);
        this.reticlePos.y = clamp(this.humanAimY + swayY, -R, R);
        const prevTag = this.aimPreview ? this.aimPreview.tag : '';
        this.aimPreview = this._scoreAtOffset(this.reticlePos.x, this.reticlePos.y);
        if (this.reticleGroup) {
          this.reticleGroup.visible = true;
          this.reticleGroup.position.set(
            DARTS_ZONE.boardX + this.reticlePos.x,
            DARTS_ZONE.boardY + this.reticlePos.y,
            DARTS_ZONE.boardZ + 0.038
          );
          const hi = this.aimPreview.points >= 40 || this.aimPreview.tag === 'BULL' || this.aimPreview.tag.startsWith('T');
          this.reticleMat.color.setHex(hi ? 0x34d399 : 0x38bdf8);
        }
        if (this.aimPreview.tag !== prevTag && this.office.bumpGamesVersion) {
          this.office.bumpGamesVersion();
        }
      } else {
        if (this.reticleGroup) this.reticleGroup.visible = false;
        if (this._throwerReady() && this.phaseTime >= 0.85) {
          this.phase = 'throw';
          this.phaseTime = 0;
        }
      }
    } else if (this.phase === 'throw') {
      if (this.phaseTime >= 0.22) {
        this._launchDart();
      }
    } else if (this.phase === 'flight' && this.flight) {
      const f = this.flight;
      f.t += dt;
      const u = clamp(f.t / f.dur, 0, 1);
      const x = f.sx + (f.target.x - f.sx) * u;
      const z = f.sz + (f.target.z - f.sz) * u;
      const y = f.sy + f.vy * f.t - 0.5 * GRAVITY * f.t * f.t;
      f.dm.mesh.position.set(x, y, z);

      // Inclinación realista siguiendo la tangente de la parábola
      const curVy = f.vy - GRAVITY * f.t;
      const vz = (f.target.z - f.sz) / f.dur;
      const pitch = Math.atan2(curVy, Math.abs(vz));
      f.dm.mesh.rotation.set(pitch, 0, 0);

      if (u >= 1) {
        f.dm.stuck = true;
        f.dm.wobble = 1;
        f.dm.baseRotX = pitch * 0.5;
        f.dm.baseRotY = (this._rand() - 0.5) * 0.08;
        f.dm.mesh.position.set(f.target.x, f.target.y, f.target.z);

        // Sumar puntuación
        const t = f.target;
        this.lastHit = t;
        this.scores[this.turn] += t.points;
        this.visitTotal += t.points;
        this.visitTags.push(t.tag);
        if (this.visitTotal > this.bestVisit) this.bestVisit = this.visitTotal;
        this._boardPop = 1;

        const pName = this.players[this.turn]?.data.name || 'Jugador';
        if (this.scores[this.turn] >= DARTS_RULES.targetScore) {
          this.winnerIdx = this.turn;
          this.winnerName = pName;
          const w = this.players[this.winnerIdx];
          if (w) this.wins.set(w.id, (this.wins.get(w.id) || 0) + 1);
          this.lastEvent = `¡${pName} gana con ${this.scores[this.turn]} pts!`;
          this.phase = 'match_over';
          this.phaseTime = 0;
        } else {
          this.lastEvent = t.special || `${pName} acierta ${t.tag} (+${t.points})`;
          this.phase = 'react';
          this.phaseTime = 0;
        }
        this.flight = null;
        this._drawScoreboard(true);
      }
    } else if (this.phase === 'react') {
      if (this.phaseTime >= 0.72) {
        this.dartIdx += 1;
        if (this.dartIdx >= DARTS_RULES.dartsPerTurn) {
          this.phase = 'turn_pause';
          this.phaseTime = 0;
        } else {
          this.phase = 'aim';
          this.phaseTime = 0;
        }
      }
    } else if (this.phase === 'turn_pause') {
      if (this.phaseTime >= 1.15) {
        this._clearBoardDarts();
        this.dartIdx = 0;
        this.visitTags = [];
        this.visitTotal = 0;
        if (this.players.length > 1) this.turn = 1 - this.turn;
        this.phase = 'aim';
        this.phaseTime = 0;
        this._drawScoreboard(true);
      }
    } else if (this.phase === 'match_over') {
      if (this.phaseTime >= 3.2) {
        this._startNewMatch();
      }
    }
  }

  // ------------------------------------------------ animaciones de lanzamiento
  poseActor(a, dt) {
    const idx = this.players.indexOf(a);
    const playing = idx >= 0 && (a.isGuest || a.arrived) && this.phase !== 'idle';
    const isThrower = playing && idx === this.turn;
    const showHandDart = isThrower && (this.phase === 'aim' || this.phase === 'throw');

    if (a.parts.handDart) {
      const tgt = showHandDart ? 1 : 0.001;
      a._dartScale = damp(a._dartScale || 0.001, tgt, 18, dt);
      a.parts.handDart.visible = a._dartScale > 0.04;
      a.parts.handDart.scale.setScalar(a._dartScale);
    }

    if (!playing) return false;

    const p = a.parts;
    const t = this.time + a.phase;
    const tx = isThrower ? DARTS_ZONE.throwX : DARTS_ZONE.waitX;
    const tz = isThrower ? DARTS_ZONE.throwZ : DARTS_ZONE.waitZ;
    const tyaw = isThrower ? Math.PI : Math.atan2(DARTS_ZONE.boardX - tx, DARTS_ZONE.boardZ - tz);

    a.group.position.x = damp(a.group.position.x, tx, 7, dt);
    a.group.position.z = damp(a.group.position.z, tz, 7, dt);
    a.yaw = dampAngle(a.yaw, tyaw, 10, dt);
    a.group.rotation.y = a.yaw;

    let bodyY = 0;
    let jumpY = 0;
    let torsoX = 0.05;
    let torsoY = 0;
    let torsoZ = 0;
    let headX = -0.04;
    let headY = 0;
    let headZ = 0;
    let thighL = 0;
    let thighR = 0;
    let shinL = 0;
    let shinR = 0;
    let armLX = 0.05;
    let armLZ = 0.1;
    let elbowLX = -0.24;
    let armRX = 0.05;
    let armRZ = -0.1;
    let elbowRX = -0.24;
    let mood = 'neutral';

    if (this.phase === 'match_over') {
      if (idx === this.winnerIdx) {
        mood = 'excited';
        jumpY = Math.pow(Math.abs(Math.sin(this.phaseTime * 7.2)), 0.78) * 0.28;
        torsoX = -0.08;
        torsoY = Math.sin(this.phaseTime * 4.5) * 0.16;
        armRX = -2.65 + Math.sin(this.phaseTime * 10) * 0.16;
        armRZ = -0.32;
        elbowRX = -0.28;
        armLX = -2.6 + Math.sin(this.phaseTime * 10 + 1) * 0.16;
        armLZ = 0.32;
        elbowLX = -0.28;
      } else {
        mood = 'happy';
        const cl = Math.abs(Math.sin(this.phaseTime * 8.5));
        armRX = -0.78;
        armRZ = 0.16 + cl * 0.14;
        elbowRX = -1.16;
        armLX = -0.78;
        armLZ = -0.16 - cl * 0.14;
        elbowLX = -1.16;
      }
    } else if (isThrower) {
      // Postura de perfil profesional en el oche (pie derecho adelantado)
      torsoY = -0.28;
      headY = 0.28;
      thighR = -0.14;
      thighL = 0.12;
      shinL = 0.16;
      armLX = -0.38;
      armLZ = 0.16;
      elbowLX = -0.82;

      if (this.phase === 'aim') {
        mood = 'focused';
        const steady = Math.sin(this.phaseTime * 3.5) * 0.03;
        torsoX = 0.1;
        armRX = -1.35 + steady;
        armRZ = -0.08;
        elbowRX = -1.25 + steady * 0.8;
        headX = -0.05;
      } else if (this.phase === 'throw') {
        mood = 'focused';
        const u = clamp(this.phaseTime / 0.22, 0, 1);
        if (u < 0.45) {
          // Retroceso fino del antebrazo hacia el ojo
          const k = smoothstep(u / 0.45);
          torsoX = 0.06;
          armRX = -1.32;
          elbowRX = -1.25 - k * 0.65;
        } else {
          // Látigo limpio hacia delante soltando el dardo
          const k = smoothstep((u - 0.45) / 0.55);
          torsoX = 0.14 * k + 0.06;
          armRX = -1.32 - k * 0.25;
          elbowRX = -1.9 + k * 1.72;
        }
      } else if (this.phase === 'flight') {
        mood = 'focused';
        // Seguimiento elegante con el brazo extendido apuntando a la diana
        torsoX = 0.16;
        armRX = -1.52;
        armRZ = -0.05;
        elbowRX = -0.14;
        headX = -0.08;
      } else if (this.phase === 'react' && this.lastHit) {
        if (this.lastHit.points >= 25) {
          mood = 'excited';
          const pump = Math.sin(this.phaseTime * 13) * Math.exp(-this.phaseTime * 1.5);
          jumpY = Math.abs(Math.sin(Math.min(this.phaseTime, 0.45) * Math.PI / 0.45)) * 0.12;
          armRX = -1.8 + pump * 0.35;
          armRZ = -0.25;
          elbowRX = -1.25;
        } else if (this.lastHit.points >= 12) {
          mood = 'happy';
          armRX = -0.6;
          elbowRX = -0.7;
          headX = Math.sin(this.phaseTime * 7) * 0.08;
        } else {
          mood = 'sad';
          headY = 0.28 + Math.sin(this.phaseTime * 10) * 0.18;
        }
      }
    } else {
      // Compañero esperando turno mirando la diana
      mood = this.lastHit && this.lastHit.points >= 40 && this.phase === 'react' ? 'happy' : 'neutral';
      torsoZ = Math.sin(t * 0.9) * 0.025;
      armLX = Math.sin(t * 1.1) * 0.04;
      armRX = Math.sin(t * 1.1 + 1.2) * 0.04;
      headX = -0.06;
    }

    p.body.position.y = damp(p.body.position.y, bodyY, 14, dt);
    a.group.position.y = damp(a.group.position.y, jumpY, 16, dt);
    p.thighL.rotation.x = damp(p.thighL.rotation.x, thighL, 14, dt);
    p.thighR.rotation.x = damp(p.thighR.rotation.x, thighR, 14, dt);
    p.shinL.rotation.x = damp(p.shinL.rotation.x, shinL, 14, dt);
    p.shinR.rotation.x = damp(p.shinR.rotation.x, shinR, 14, dt);
    p.torso.rotation.x = damp(p.torso.rotation.x, torsoX, 14, dt);
    p.torso.rotation.y = damp(p.torso.rotation.y, torsoY, 14, dt);
    p.torso.rotation.z = damp(p.torso.rotation.z, torsoZ, 14, dt);
    p.head.rotation.x = damp(p.head.rotation.x, headX, 12, dt);
    p.head.rotation.y = damp(p.head.rotation.y, headY, 12, dt);
    p.head.rotation.z = damp(p.head.rotation.z, headZ, 12, dt);
    p.armL.rotation.x = damp(p.armL.rotation.x, armLX, 14, dt);
    p.armL.rotation.z = damp(p.armL.rotation.z, armLZ, 14, dt);
    p.elbowL.rotation.x = damp(p.elbowL.rotation.x, elbowLX, 14, dt);
    p.armR.rotation.x = damp(p.armR.rotation.x, armRX, 20, dt);
    p.armR.rotation.z = damp(p.armR.rotation.z, armRZ, 18, dt);
    p.elbowR.rotation.x = damp(p.elbowR.rotation.x, elbowRX, 24, dt);

    if (this.phase === 'match_over' && idx === this.winnerIdx) {
      p.sparks.visible = true;
      const el = this.phaseTime;
      const fade = clamp(1 - el / 3.1, 0, 1);
      p.sparks.children.forEach((sp, i) => {
        const ang = (i / 6) * Math.PI * 2 + el * 2.5;
        const rad = 0.28 + Math.sin(el * 3 + i) * 0.12 + el * 0.1;
        sp.position.set(Math.cos(ang) * rad, 1.55 + ((el * 0.75 + i * 0.19) % 1.0), Math.sin(ang) * rad);
      });
      p.sparks.children[0].material.color.setHex(0xf59e0b);
      p.sparks.children[0].material.opacity = fade * 0.94;
    } else if (p.sparks.visible) {
      p.sparks.visible = false;
    }

    this.office._finishActivityPose(a, dt, t, mood);
    return true;
  }

  onThemeChange() {
    this._drawScoreboard(true);
  }

  // ------------------------------------------------ marcador electrónico 3D
  _drawScoreboard(force = false) {
    const p0 = this.players[0];
    const p1 = this.players[1];
    const key = `${p0?.data.name || ''}|${p1?.data.name || ''}|${this.scores[0]}|${this.scores[1]}|${this.turn}|${this.visitTags.join(',')}|${this.phase}`;
    if (!force && key === this._boardKey) return;
    this._boardKey = key;
    if (this.office.bumpGamesVersion) this.office.bumpGamesVersion();

    const ctx = this.boardCanvas.getContext('2d');
    const W = 400;
    const H = 420;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, W, 58);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 26px "Instrument Sans", system-ui, sans-serif';
    ctx.fillText('DARDOS · 150', 22, 39);

    const drawRow = (y0, player, sc, isTurn, isWin) => {
      roundRectPath(ctx, 20, y0, W - 40, 108, 18);
      ctx.fillStyle = isWin ? 'rgba(16,185,129,0.22)' : isTurn ? 'rgba(59,130,246,0.16)' : 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.fillStyle = player ? cssHex(player.role) : '#64748b';
      ctx.beginPath();
      ctx.arc(46, y0 + 34, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 24px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText(String(player ? player.data.name : 'Libre').slice(0, 12), 68, y0 + 42);
      ctx.fillStyle = isWin ? '#34d399' : '#ffffff';
      ctx.font = '700 54px "Instrument Sans", system-ui, sans-serif';
      const s = String(sc);
      ctx.fillText(s, W - 40 - ctx.measureText(s).width, y0 + 78);
    };

    drawRow(74, p0, this.scores[0], this.players.length > 0 && this.turn === 0 && this.phase !== 'match_over', this.winnerIdx === 0);
    drawRow(194, p1, this.scores[1], this.players.length > 1 && this.turn === 1 && this.phase !== 'match_over', this.winnerIdx === 1);

    // 3 casillas de dardos del turno actual
    for (let i = 0; i < 3; i++) {
      const bx = 22 + i * 122;
      roundRectPath(ctx, bx, 318, 112, 54, 12);
      ctx.fillStyle = this.visitTags[i] ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.fillStyle = this.visitTags[i] ? '#fbbf24' : '#64748b';
      ctx.font = '700 26px "Instrument Sans", system-ui, sans-serif';
      const t = this.visitTags[i] || '·';
      ctx.fillText(t, bx + (112 - ctx.measureText(t).width) / 2, 354);
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 18px "Instrument Sans", system-ui, sans-serif';
    ctx.fillText(String(this.lastEvent || '3 dardos por turno').slice(0, 34), 22, 404);
    this.boardTex.needsUpdate = true;
  }

  getState() {
    const active = this.players.length > 0;
    const mkP = (i) => {
      const a = this.players[i];
      if (!a) return null;
      return {
        id: a.id,
        name: a.data.name,
        color: a.role,
        score: this.scores[i],
        wins: this.wins.get(a.id) || 0,
        activeTurn: active && this.turn === i && this.phase !== 'match_over',
        winner: this.winnerIdx === i && this.phase === 'match_over',
        isGuest: Boolean(a.isGuest),
      };
    };
    return {
      phase: this.phase,
      active,
      exhibition: this.exhibition,
      humanMode: this.humanMode,
      dartIdx: this.dartIdx,
      aimPreview: this.aimPreview,
      visitTags: [...this.visitTags],
      visitTotal: this.visitTotal,
      bestVisit: this.bestVisit,
      winnerName: this.phase === 'match_over' ? this.winnerName : '',
      lastEvent: this.lastEvent,
      p0: mkP(0),
      p1: mkP(1),
      rules: DARTS_RULES,
    };
  }
}

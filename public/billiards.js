// Arena de Billar (Pool) 3D con física elástica real de bolas, troneras,
// taco articulado, marcador de mesa, mini-reglas y animaciones de tiro.

export const POOL_TABLE = {
  x: 7.85,
  z: -2.05,
  len: 2.42,
  wid: 1.36,
  topY: 0.8,
  playHalfL: 1.04,
  playHalfW: 0.52,
};

export const POOL_RULES = {
  targetBalls: 4,
};

const BALL_R = 0.036;
const FRICTION = 1.18;
const RESTITUTION = 0.84;

const BALL_COLORS = [
  0xfef08a, // 1 amarilla
  0x3b82f6, // 2 azul
  0xef4444, // 3 roja
  0x8b5cf6, // 4 morada
  0xf97316, // 5 naranja
  0x22c55e, // 6 verde
  0xbe123c, // 7 granate
  0x111827, // 8 negra
];

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

export class BilliardsArena {
  constructor(office) {
    this.office = office;
    this.THREE = office.THREE;
    this.time = 0;

    this.exhibition = false;
    this.humanMode = false;
    this.humanActor = null;
    this.humanOpponentId = null;
    this.humanAngle = 0;
    this.humanPower = 2.6;
    this.humanCharging = false;
    this.humanChargeDir = 1;
    this.guests = [];
    this.players = [null, null]; // [jugador 0, jugador 1]
    this.requestedIds = [];
    this.wins = new Map();

    // Estado de la partida
    this.phase = 'idle'; // 'idle' | 'position' | 'aim' | 'strike' | 'rolling' | 'turn_end' | 'match_over'
    this.phaseTime = 0;
    this.turn = 0; // 0 o 1
    this.scores = [0, 0];
    this.pottedColors = [[], []];
    this.pottedThisTurn = 0;
    this.scratched = false;
    this.winnerIdx = -1;
    this.winnerName = '';
    this.lastEvent = '';
    this._boardKey = '';
    this._boardPop = 0;
    this._rngState = 9001;

    // Plan del tiro actual
    this.shot = {
      dirX: 1,
      dirZ: 0,
      standX: POOL_TABLE.x - 1.65,
      standZ: POOL_TABLE.z,
      yaw: Math.PI / 2,
      power: 2.8,
      aimDur: 1.15,
      strikeDur: 0.28,
      struck: false,
      cuePull: 0,
    };

    // Bolas (0 = bola blanca, 1..8 = bolas de color)
    this.balls = [];
    this.pockets = this._makePockets();
    this._lampLight = null;
    this._lampShadeMat = null;

    this._buildTable();
    this._buildBalls();
    this._buildScoreboard();
    this._rackBalls();
    this._drawScoreboard(true);
  }

  _rand() {
    this._rngState = (Math.imul(this._rngState, 1664525) + 1013904223) >>> 0;
    return this._rngState / 4294967296;
  }

  _makePockets() {
    const hl = POOL_TABLE.playHalfL + 0.02;
    const hw = POOL_TABLE.playHalfW + 0.02;
    return [
      { x: -hl, z: -hw },
      { x: 0, z: -hw - 0.02 },
      { x: hl, z: -hw },
      { x: -hl, z: hw },
      { x: 0, z: hw + 0.02 },
      { x: hl, z: hw },
    ];
  }

  // ------------------------------------------------ geometría de la mesa
  _buildTable() {
    const T = this.THREE;
    const o = this.office;
    const g = new T.Group();
    g.position.set(POOL_TABLE.x, 0, POOL_TABLE.z);
    o.scene.add(g);
    this.tableGroup = g;

    // Textura fina de paño verde esmeralda de torneo
    const feltTex = o._texture(512, 288, 1, 1, (ctx, w, h) => {
      ctx.fillStyle = '#156b56';
      ctx.fillRect(0, 0, w, h);
      // Trama sutil de paño
      for (let i = 0; i < 360; i++) {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)';
        ctx.fillRect((i * 89) % w, (i * 151) % h, 4, 2);
      }
      // Línea de salida (baulk line) y punto de pie
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.25, 10);
      ctx.lineTo(w * 0.25, h - 10);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      ctx.beginPath();
      ctx.arc(w * 0.72, h / 2, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Estructura principal: faldón oscuro + bandas de nogal cálido
    o._box(POOL_TABLE.len - 0.14, 0.22, POOL_TABLE.wid - 0.14, 0x26313f, 0, POOL_TABLE.topY - 0.12, 0, g, { rough: 0.6 });
    const feltMat = new T.MeshStandardMaterial({ map: feltTex, roughness: 0.82 });
    const felt = o._mesh(new T.PlaneGeometry(POOL_TABLE.playHalfL * 2 + 0.06, POOL_TABLE.playHalfW * 2 + 0.06), feltMat, 0, POOL_TABLE.topY + 0.001, 0, g, { cast: false, receive: true });
    felt.rotation.x = -Math.PI / 2;

    // Bandas perimetrales de madera nogal con incrustaciones metálicas (diamantes)
    const railCol = 0x7c5334;
    const railH = 0.075;
    const railY = POOL_TABLE.topY + 0.026;
    const railT = 0.13;
    // Bandas largas (norte/sur)
    for (const sz of [-1, 1]) {
      const rz = sz * (POOL_TABLE.playHalfW + railT / 2 + 0.02);
      o._box(POOL_TABLE.len - 0.1, railH, railT, railCol, 0, railY, rz, g, { rough: 0.5 });
      for (const dx of [-0.72, -0.36, 0.36, 0.72]) {
        o._sphere(0.012, 0xe2e8f0, dx, railY + railH / 2 + 0.002, rz, g, { seg: 8, cast: false });
      }
    }
    // Bandas cortas (este/oeste)
    for (const sx of [-1, 1]) {
      const rx = sx * (POOL_TABLE.playHalfL + railT / 2 + 0.02);
      o._box(railT, railH, POOL_TABLE.wid - 0.1, railCol, rx, railY, 0, g, { rough: 0.5 });
      for (const dz of [-0.26, 0, 0.26]) {
        o._sphere(0.012, 0xe2e8f0, rx, railY + railH / 2 + 0.002, dz, g, { seg: 8, cast: false });
      }
    }

    // 6 troneras negras con remate en latón cepillado
    for (const pk of this.pockets) {
      const hole = o._cyl(0.072, 0.072, 0.025, 0x0b1117, pk.x, POOL_TABLE.topY + 0.005, pk.z, g, { seg: 16, cast: false });
      hole.receiveShadow = false;
      const rim = o._mesh(o._geo('poolPocketRim', () => new T.TorusGeometry(0.078, 0.014, 8, 18)), o._mat(0xd4a359, { rough: 0.32, metal: 0.65 }), pk.x, POOL_TABLE.topY + 0.032, pk.z, g, { cast: false });
      rim.rotation.x = Math.PI / 2;
    }

    // Patas modernas estilo Silicon Valley (acero negro + travesaño de roble)
    for (const sx of [-0.88, 0.88]) {
      for (const sz of [-0.46, 0.46]) {
        o._box(0.085, 0.64, 0.085, 0x1e293b, sx, 0.32, sz, g, { rough: 0.45, metal: 0.45 });
      }
      o._box(0.07, 0.06, 0.92, 0xc29e74, sx, 0.16, 0, g, { rough: 0.65 });
    }
    o._box(1.76, 0.055, 0.06, 0x334155, 0, 0.16, 0, g, { rough: 0.45, metal: 0.45 });

    // Lámpara doble colgante industrial (negro mate + interior cálido) sobre el billar
    const lampGroup = new T.Group();
    lampGroup.position.set(0, 2.72, 0);
    g.add(lampGroup);
    o._box(1.38, 0.035, 0.04, 0x1e293b, 0, 0.16, 0, lampGroup, { cast: false, rough: 0.35, metal: 0.6 });
    const shadeEmissive = new T.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xffd28a, emissiveIntensity: 0.35, roughness: 0.4 });
    this._lampShadeMat = shadeEmissive;
    for (const sx of [-0.46, 0.46]) {
      o._cyl(0.012, 0.012, 0.95, 0x1e293b, sx, 0.62, 0, lampGroup, { seg: 8, cast: false });
      o._cyl(0.09, 0.22, 0.18, 0x1e293b, sx, 0.05, 0, lampGroup, { seg: 20, cast: false, rough: 0.38, metal: 0.55 });
      o._mesh(o._geo('poolBulb', () => new T.SphereGeometry(0.075, 12, 8)), shadeEmissive, sx, -0.02, 0, lampGroup, { cast: false, receive: false });
    }
    const pLight = new T.PointLight(0xffdfb0, 0.4, 7.5, 1.8);
    pLight.position.set(POOL_TABLE.x, 2.52, POOL_TABLE.z);
    o.scene.add(pLight);
    this._lampLight = pLight;

    // Guía 3D de puntería para cuando juega el usuario (línea + bola fantasma + trayectoria objetivo)
    const aimGroup = new T.Group();
    aimGroup.position.y = POOL_TABLE.topY + BALL_R;
    aimGroup.visible = false;
    aimGroup.userData.dynamic = true;
    g.add(aimGroup);
    this.aimGroup = aimGroup;

    const aimMat = new T.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85, depthWrite: false });
    aimMat.toneMapped = false;
    this.aimLine = new T.Mesh(o._geo('poolAimBar', () => new T.BoxGeometry(1, 0.005, 0.012)), aimMat);
    this.aimLine.raycast = () => {};
    aimGroup.add(this.aimLine);

    const ghostMat = new T.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false });
    ghostMat.toneMapped = false;
    this.ghostRing = new T.Mesh(o._geo('poolGhostRing', () => new T.RingGeometry(BALL_R * 0.72, BALL_R * 1.05, 24)), ghostMat);
    this.ghostRing.rotation.x = -Math.PI / 2;
    this.ghostRing.raycast = () => {};
    aimGroup.add(this.ghostRing);

    const tgtMat = new T.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.92, depthWrite: false });
    tgtMat.toneMapped = false;
    this.targetLine = new T.Mesh(o._geo('poolAimBar', () => new T.BoxGeometry(1, 0.005, 0.011)), tgtMat);
    this.targetLine.raycast = () => {};
    aimGroup.add(this.targetLine);
    this.fpCue = null;
  }

  _ensureFpCue() {
    if (this.fpCue) return;
    const T = this.THREE;
    const o = this.office;
    const fpCue = new T.Group();
    fpCue.rotation.order = 'YXZ';
    fpCue.visible = false;
    fpCue.userData.dynamic = true;
    const tipM = o._cyl(0.0065, 0.0065, 0.024, 0x38bdf8, 0, 0, -0.05, fpCue, { seg: 10, cast: false });
    tipM.rotation.x = Math.PI / 2;
    const ferruleM = o._cyl(0.0065, 0.007, 0.02, 0xf8fafc, 0, 0, -0.072, fpCue, { seg: 10, cast: false });
    ferruleM.rotation.x = Math.PI / 2;
    const shaftM = o._cyl(0.007, 0.012, 0.66, 0xe8d0a9, 0, 0, -0.41, fpCue, { seg: 10, rough: 0.35, cast: false });
    shaftM.rotation.x = Math.PI / 2;
    const buttM = o._cyl(0.012, 0.018, 0.52, 0x1e293b, 0, 0, -1.0, fpCue, { seg: 10, rough: 0.45, cast: false });
    buttM.rotation.x = Math.PI / 2;
    o.scene.add(fpCue);
    this.fpCue = fpCue;
  }

  _buildBalls() {
    const T = this.THREE;
    const o = this.office;
    const geo = o._geo('poolBall', () => new T.SphereGeometry(BALL_R, 14, 12));
    const shGeo = o._geo('poolBallSh', () => new T.CircleGeometry(BALL_R * 1.12, 12));

    const makeBall = (id, color) => {
      const mat = new T.MeshStandardMaterial({ color, roughness: 0.18, metalness: 0.08 });
      const mesh = new T.Mesh(geo, mat);
      mesh.castShadow = false;
      mesh.raycast = () => {};
      mesh.userData.dynamic = true;
      this.tableGroup.add(mesh);

      const shMat = new T.MeshBasicMaterial({ color: 0x062920, transparent: true, opacity: 0.32, depthWrite: false });
      const shadow = new T.Mesh(shGeo, shMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = POOL_TABLE.topY + 0.003;
      shadow.raycast = () => {};
      shadow.userData.dynamic = true;
      this.tableGroup.add(shadow);

      return { id, color, mesh, shadow, x: 0, z: 0, vx: 0, vz: 0, potted: false, drop: 0 };
    };

    // Bola 0: bola blanca (cue ball)
    this.balls.push(makeBall(0, 0xf8fafc));
    for (let i = 0; i < BALL_COLORS.length; i++) {
      this.balls.push(makeBall(i + 1, BALL_COLORS[i]));
    }
  }

  _buildScoreboard() {
    const T = this.THREE;
    const o = this.office;
    const stand = new T.Group();
    // Colocado limpiamente al costado oeste-norte de la mesa mirando a la cámara (+Z)
    stand.position.set(POOL_TABLE.x - 1.56, 0, POOL_TABLE.z - 0.88);
    o.scene.add(stand);

    o._cyl(0.18, 0.2, 0.03, 0x334155, 0, 0.015, 0, stand, { seg: 16, rough: 0.4, metal: 0.5, cast: false });
    o._cyl(0.026, 0.026, 1.18, 0x475569, 0, 0.6, 0, stand, { seg: 10, rough: 0.35, metal: 0.55, cast: false });

    const head = new T.Group();
    head.userData.dynamic = true;
    head.position.set(0, 1.32, 0);
    stand.add(head);
    this.boardHead = head;

    o._box(1.18, 0.58, 0.06, 0x1e293b, 0, 0, 0, head, { rough: 0.42, metal: 0.3 });

    this.boardCanvas = o.makeCanvas();
    this.boardCanvas.width = 560;
    this.boardCanvas.height = 270;
    this.boardTex = new T.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = T.SRGBColorSpace;
    this.boardTex.anisotropy = 4;

    const faceMat = new T.MeshBasicMaterial({ map: this.boardTex });
    faceMat.toneMapped = false;
    o._mesh(new T.PlaneGeometry(1.1, 0.5), faceMat, 0, 0, 0.033, head, { cast: false, receive: false });
  }

  attachCue(actor) {
    const o = this.office;
    const cue = new this.THREE.Group();
    // Anclado en la mano derecha (elbowR en y = -0.24)
    cue.position.set(0, -0.24, 0.03);
    cue.scale.setScalar(0.001);
    cue.visible = false;

    // Taco de billar estilizado (culata oscura, flecha de arce, suela azul)
    o._cyl(0.012, 0.019, 0.55, 0x1e293b, 0, -0.22, 0, cue, { seg: 8, rough: 0.45 });
    o._cyl(0.0075, 0.012, 0.72, 0xe8d0a9, 0, 0.41, 0, cue, { seg: 8, rough: 0.4 });
    o._cyl(0.008, 0.008, 0.025, 0x38bdf8, 0, 0.78, 0, cue, { seg: 8, cast: false });

    actor.parts.elbowR.add(cue);
    actor.parts.cue = cue;
    actor._cueScale = 0.001;
  }

  _rackBalls() {
    // Bola blanca en la zona de salida (oeste)
    const cue = this.balls[0];
    cue.x = -0.56;
    cue.z = (this._rand() - 0.5) * 0.14;
    cue.vx = 0;
    cue.vz = 0;
    cue.potted = false;
    cue.drop = 0;

    // Triángulo compacto de 8 bolas en el punto de pie (este)
    const d = BALL_R * 2.08;
    const dx = d * 0.87;
    const positions = [
      [0.34, 0],
      [0.34 + dx, -d * 0.5],
      [0.34 + dx, d * 0.5],
      [0.34 + dx * 2, -d],
      [0.34 + dx * 2, 0], // bola 8 en el centro
      [0.34 + dx * 2, d],
      [0.34 + dx * 3, -d * 0.5],
      [0.34 + dx * 3, d * 0.5],
    ];
    // Orden para que la bola 8 (índice 8) quede en el centro del rack
    const order = [1, 2, 3, 4, 8, 5, 6, 7];
    order.forEach((bIdx, i) => {
      const b = this.balls[bIdx];
      b.x = positions[i][0];
      b.z = positions[i][1];
      b.vx = 0;
      b.vz = 0;
      b.potted = false;
      b.drop = 0;
    });
    this._syncBallsVisuals(0);
  }

  // ------------------------------------------------ gestión de jugadores
  isActivePlayer(actor) {
    return Boolean(actor && (this.players[0] === actor || this.players[1] === actor));
  }

  getPlayerWaitSpot(idx) {
    return idx === 0
      ? { x: POOL_TABLE.x - 1.62, z: POOL_TABLE.z + 0.15 }
      : { x: POOL_TABLE.x + 1.62, z: POOL_TABLE.z - 0.15 };
  }

  getActorTarget(actor) {
    const idx = this.players.indexOf(actor);
    if (idx < 0) return null;
    const sp = this.getPlayerWaitSpot(idx);
    return { key: `pool-${idx}`, type: 'spot', spot: { index: 110 + idx, x: sp.x, z: sp.z } };
  }

  requestPlayer(actor) {
    if (!actor || actor.data.status !== 'idle') return;
    if (!this.requestedIds.includes(actor.id)) this.requestedIds.unshift(actor.id);
    if (this.requestedIds.length > 2) this.requestedIds.length = 2;
  }

  removePlayer(actor) {
    if (!actor) return;
    this.requestedIds = this.requestedIds.filter((id) => id !== actor.id);
    for (let i = 0; i < 2; i++) {
      if (this.players[i] === actor) this.players[i] = null;
    }
    if (!this.players[0] || !this.players[1]) {
      this.phase = 'idle';
      this._drawScoreboard(true);
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
    this.humanOpponentId = opponentId && opponentId !== '__pool_human' ? opponentId : null;
    this.humanCharging = false;
    if (next) {
      this.exhibition = false;
      this._ensureFpCue();
      this._ensureHumanActor();
      this._ensureGuests();
      this.phase = 'idle';
    } else {
      if (this.players[0] === this.humanActor) this.players[0] = null;
      this._clearHumanActor();
      this._clearGuests();
      if (this.aimGroup) this.aimGroup.visible = false;
      if (this.fpCue) this.fpCue.visible = false;
      this.phase = 'idle';
    }
    this._drawScoreboard(true);
  }

  getFirstPersonCamera() {
    if (!this.humanMode) return null;
    const T = this.THREE;
    const cue = this.balls[0];
    const wx = POOL_TABLE.x + cue.x;
    const wz = POOL_TABLE.z + cue.z;
    const dx = this.shot.dirX;
    const dz = this.shot.dirZ;
    const aimingNow = this.turn === 0 && (this.phase === 'aim' || this.phase === 'position' || this.phase === 'strike') && !cue.potted;
    if (aimingNow) {
      return {
        pos: new T.Vector3(wx - dx * 1.12, POOL_TABLE.topY + 0.41, wz - dz * 1.12),
        target: new T.Vector3(wx + dx * 0.92, POOL_TABLE.topY + 0.02, wz + dz * 0.92),
      };
    }
    return {
      pos: new T.Vector3(POOL_TABLE.x - dx * 1.95, POOL_TABLE.topY + 1.48, POOL_TABLE.z - dz * 1.95),
      target: new T.Vector3(POOL_TABLE.x, POOL_TABLE.topY + 0.02, POOL_TABLE.z),
    };
  }

  _ensureHumanActor() {
    if (this.humanActor) return;
    const d = {
      id: '__pool_human',
      kind: 'main',
      type: 'human',
      name: 'Tú',
      project: 'Jugador',
      status: 'idle',
      activity: 'Billar',
      detail: 'Jugando contra NPC',
      tool: null,
      toolCount: 0,
      errorAt: 0,
    };
    const a = this.office._makeActor(d);
    a.isGuest = true;
    a.isHuman = true;
    const sp = this.getPlayerWaitSpot(0);
    a.group.position.set(sp.x, 0, sp.z);
    a.yaw = Math.PI / 2;
    a.targetYaw = a.yaw;
    a.arrived = true;
    a.target = { key: 'pool-0', type: 'spot', spot: sp };
    this.office._drawLabel(a, true);
    this.humanActor = a;
  }

  _clearHumanActor() {
    if (!this.humanActor) return;
    if (this.players[0] === this.humanActor) this.players[0] = null;
    if (this.players[1] === this.humanActor) this.players[1] = null;
    this.office._dispose(this.humanActor);
    this.humanActor = null;
  }

  handleHumanInput(input) {
    if (!this.humanMode || !input) return;
    const isMyTurn = this.turn === 0 && (this.phase === 'aim' || this.phase === 'position');
    if (input.type === 'aim_point' && isMyTurn && Number.isFinite(input.x) && Number.isFinite(input.z)) {
      const cue = this.balls[0];
      const cx = POOL_TABLE.x + cue.x;
      const cz = POOL_TABLE.z + cue.z;
      const dx = input.x - cx;
      const dz = input.z - cz;
      if (Math.hypot(dx, dz) > 0.04) {
        this._applyHumanAim(Math.atan2(dz, dx), this.humanPower);
      }
    } else if (input.type === 'aim_delta' && isMyTurn && Number.isFinite(input.delta)) {
      this._applyHumanAim(this.humanAngle + input.delta, this.humanPower);
    } else if (input.type === 'power' && Number.isFinite(input.power)) {
      if (input.manualPull) this.humanCharging = false;
      this._applyHumanAim(this.humanAngle, input.power);
      this.shot.cuePull = -((this.humanPower - 1.2) / 2.6) * 0.26;
      if (this.office.bumpGamesVersion) this.office.bumpGamesVersion();
    } else if (input.type === 'charge_start' && isMyTurn) {
      this.humanCharging = true;
    } else if (input.type === 'shoot' && isMyTurn) {
      this.humanCharging = false;
      this._applyHumanAim(this.humanAngle, this.humanPower);
      if (this.aimGroup) this.aimGroup.visible = false;
      this.phase = 'strike';
      this.phaseTime = 0;
      this.shot.struck = false;
      this._drawScoreboard(true);
    }
  }

  _ensureGuests() {
    if (this.guests.length) return;
    const defs = [
      { id: '__pool_guest_a', kind: 'sub', type: 'pool-a', name: 'Mateo', project: 'sala', status: 'idle', activity: 'Billar', detail: '', tool: null, toolCount: 0, errorAt: 0 },
      { id: '__pool_guest_b', kind: 'sub', type: 'pool-b', name: 'Camila', project: 'sala', status: 'idle', activity: 'Billar', detail: '', tool: null, toolCount: 0, errorAt: 0 },
    ];
    defs.forEach((d, idx) => {
      const a = this.office._makeActor(d);
      a.isGuest = true;
      const sp = this.getPlayerWaitSpot(idx);
      a.group.position.set(sp.x, 0, sp.z);
      a.yaw = idx === 0 ? Math.PI / 2 : -Math.PI / 2;
      a.targetYaw = a.yaw;
      a.arrived = true;
      a.target = { key: `pool-${idx}`, type: 'spot', spot: sp };
      this.office._drawLabel(a, true);
      this.guests.push(a);
    });
  }

  _clearGuests() {
    for (const g of this.guests) {
      if (this.players[0] === g) this.players[0] = null;
      if (this.players[1] === g) this.players[1] = null;
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
      const changed = this.players[0] !== this.humanActor || this.players[1] !== opp;
      this.players = [this.humanActor, opp];
      if (changed || this.phase === 'idle') {
        this._startNewMatch();
      }
      return;
    }

    // Si el usuario envió explícitamente a 1 agente a jugar al billar y está solo, sumar NPC rival
    if (this.requestedIds.length > 0 && pool.length === 1 && !this.exhibition) {
      this.exhibition = true;
    }

    if (pool.length >= 2) {
      if (this.guests.length) {
        this._clearGuests();
        this.exhibition = false;
      }
      this._assignPair(pool);
      return;
    }

    if (this.exhibition) {
      this._ensureGuests();
      const mix = pool.length === 1 ? [pool[0], this.guests[1]] : this.guests;
      if (pool.length === 1 && this.guests[0]) this.guests[0].group.visible = false;
      else if (this.guests[0]) this.guests[0].group.visible = true;
      this._assignPair(mix);
      return;
    }

    this._clearGuests();
    if (this.players[0] || this.players[1]) {
      this.players = [null, null];
      this.phase = 'idle';
      this._drawScoreboard(true);
    }
  }

  _assignPair(pool) {
    const validIds = new Set(pool.map((a) => a.id));
    for (let i = 0; i < 2; i++) {
      if (this.players[i] && !validIds.has(this.players[i].id)) {
        this.players[i] = null;
      }
    }
    // Priorizar agentes solicitados explícitamente por el usuario
    const ordered = [
      ...this.requestedIds.map((id) => pool.find((a) => a.id === id)).filter(Boolean),
      ...pool,
    ];
    for (let i = 0; i < 2; i++) {
      if (!this.players[i]) {
        const other = this.players[1 - i];
        this.players[i] = ordered.find((a) => a !== other) || null;
      }
    }
    if (this.players[0] && this.players[1] && this.phase === 'idle') {
      this._startNewMatch();
    } else if (!this.players[0] || !this.players[1]) {
      this.phase = 'idle';
    }
  }

  _startNewMatch() {
    this.scores = [0, 0];
    this.pottedColors = [[], []];
    this.turn = 0;
    this.winnerIdx = -1;
    this.winnerName = '';
    this.lastEvent = 'Saque de apertura · 4 bolas para ganar';
    this._rackBalls();
    this._planNextShot();
    this.phase = 'position';
    this.phaseTime = 0;
    this._drawScoreboard(true);
  }

  _playersReady() {
    return (
      this.players[0] &&
      this.players[1] &&
      (this.players[0].isGuest || this.players[0].arrived) &&
      (this.players[1].isGuest || this.players[1].arrived)
    );
  }

  // ------------------------------------------------ IA de tiro y física
  _planNextShot() {
    const cue = this.balls[0];
    if (cue.potted) {
      cue.potted = false;
      cue.drop = 0;
      cue.x = -0.56;
      cue.z = (this._rand() - 0.5) * 0.2;
      cue.vx = 0;
      cue.vz = 0;
    }

    const activeObjs = this.balls.slice(1).filter((b) => !b.potted);
    if (!activeObjs.length) {
      this._rackBalls();
    }
    const candidates = this.balls.slice(1).filter((b) => !b.potted);

    // Evaluar el mejor tiro limpio hacia una tronera (método bola fantasma)
    let best = null;
    for (const obj of candidates) {
      for (const pk of this.pockets) {
        const toPkX = pk.x - obj.x;
        const toPkZ = pk.z - obj.z;
        const pkDist = Math.hypot(toPkX, toPkZ);
        if (pkDist < 0.05) continue;
        const nx = toPkX / pkDist;
        const nz = toPkZ / pkDist;

        // Punto de impacto (ghost ball)
        const gx = obj.x - nx * BALL_R * 2.02;
        const gz = obj.z - nz * BALL_R * 2.02;
        const cToGX = gx - cue.x;
        const cToGZ = gz - cue.z;
        const cDist = Math.hypot(cToGX, cToGZ);
        if (cDist < 0.08) continue;
        const dx = cToGX / cDist;
        const dz = cToGZ / cDist;
        const align = dx * nx + dz * nz; // 1 = tiro recto perfecto
        if (align < 0.35) continue;

        const score = align * 2.4 - pkDist * 0.45 - cDist * 0.25 + this._rand() * 0.22;
        if (!best || score > best.score) {
          best = { dx, dz, align, pkDist, cDist, score };
        }
      }
    }

    let dirX = 1;
    let dirZ = 0;
    let power = 2.6;
    if (best) {
      // Pequeña imprecisión humana realista (más fácil embocar, pero con fallos ocasionales)
      const jitter = (this._rand() - 0.5) * 0.09;
      const ang = Math.atan2(best.dz, best.dx) + jitter;
      dirX = Math.cos(ang);
      dirZ = Math.sin(ang);
      power = clamp(1.8 + (best.cDist + best.pkDist) * 0.85, 1.9, 3.5);
    } else {
      const target = candidates[0] || { x: 0.4, z: 0 };
      const ang = Math.atan2(target.z - cue.z, target.x - cue.x);
      dirX = Math.cos(ang);
      dirZ = Math.sin(ang);
      power = 3.2;
    }

    // Posicionar al tirador limpiamente fuera del perímetro de la mesa detrás de la bola blanca
    const wx = POOL_TABLE.x + cue.x;
    const wz = POOL_TABLE.z + cue.z;
    const minX = POOL_TABLE.x - POOL_TABLE.len / 2 - 0.36;
    const maxX = POOL_TABLE.x + POOL_TABLE.len / 2 + 0.36;
    const minZ = POOL_TABLE.z - POOL_TABLE.wid / 2 - 0.36;
    const maxZ = POOL_TABLE.z + POOL_TABLE.wid / 2 + 0.36;

    // Avanzar hacia atrás (-dir) hasta quedar justo fuera del borde de la mesa
    let distBack = 0.72;
    let sx = wx - dirX * distBack;
    let sz = wz - dirZ * distBack;
    for (let k = 0; k < 14; k++) {
      if (sx <= minX || sx >= maxX || sz <= minZ || sz >= maxZ) break;
      distBack += 0.16;
      sx = wx - dirX * distBack;
      sz = wz - dirZ * distBack;
    }
    sx = clamp(sx, 5.45, 10.35);
    sz = clamp(sz, -3.55, -0.58);

    this.shot = {
      dirX,
      dirZ,
      standX: sx,
      standZ: sz,
      yaw: Math.atan2(wx - sx, wz - sz),
      power,
      aimDur: 1.15,
      strikeDur: 0.28,
      struck: false,
      cuePull: 0,
    };

    if (this.humanMode && this.turn === 0) {
      this.humanAngle = Math.atan2(dirZ, dirX);
      this.humanPower = clamp(power, 1.3, 3.8);
      this.lastEvent = 'Tu turno · Apunta en la mesa y tira con Clic o Espacio';
      this._applyHumanAim(this.humanAngle, this.humanPower);
    } else if (this.aimGroup) {
      this.aimGroup.visible = false;
    }
  }

  _applyHumanAim(angle, power) {
    this.humanAngle = wrapAngle(angle);
    this.humanPower = clamp(power, 1.3, 3.8);
    const dirX = Math.cos(this.humanAngle);
    const dirZ = Math.sin(this.humanAngle);
    const cue = this.balls[0];
    const wx = POOL_TABLE.x + cue.x;
    const wz = POOL_TABLE.z + cue.z;
    const minX = POOL_TABLE.x - POOL_TABLE.len / 2 - 0.36;
    const maxX = POOL_TABLE.x + POOL_TABLE.len / 2 + 0.36;
    const minZ = POOL_TABLE.z - POOL_TABLE.wid / 2 - 0.36;
    const maxZ = POOL_TABLE.z + POOL_TABLE.wid / 2 + 0.36;

    let distBack = 0.72;
    let sx = wx - dirX * distBack;
    let sz = wz - dirZ * distBack;
    for (let k = 0; k < 14; k++) {
      if (sx <= minX || sx >= maxX || sz <= minZ || sz >= maxZ) break;
      distBack += 0.16;
      sx = wx - dirX * distBack;
      sz = wz - dirZ * distBack;
    }
    sx = clamp(sx, 5.45, 10.35);
    sz = clamp(sz, -3.55, -0.58);

    this.shot.dirX = dirX;
    this.shot.dirZ = dirZ;
    this.shot.standX = sx;
    this.shot.standZ = sz;
    this.shot.yaw = Math.atan2(wx - sx, wz - sz);
    this.shot.power = this.humanPower;
    this._updateAimGuide();
  }

  _updateAimGuide() {
    if (!this.aimGroup) return;
    const cue = this.balls[0];
    const show = Boolean(this.humanMode && this.turn === 0 && (this.phase === 'aim' || this.phase === 'position') && !cue.potted);
    this.aimGroup.visible = show;
    if (!show) return;

    const dx = this.shot.dirX;
    const dz = this.shot.dirZ;
    const maxX = POOL_TABLE.playHalfL - BALL_R;
    const maxZ = POOL_TABLE.playHalfW - BALL_R;

    // Distancia máxima hasta tocar banda
    let bestT = 3.0;
    if (Math.abs(dx) > 1e-5) {
      const tx = ((dx > 0 ? maxX : -maxX) - cue.x) / dx;
      if (tx > 0 && tx < bestT) bestT = tx;
    }
    if (Math.abs(dz) > 1e-5) {
      const tz = ((dz > 0 ? maxZ : -maxZ) - cue.z) / dz;
      if (tz > 0 && tz < bestT) bestT = tz;
    }

    // Intersección exacta con primera bola objetivo (bola fantasma)
    let hitBall = null;
    const twoR = BALL_R * 2;
    const twoRSq = twoR * twoR;
    for (let i = 1; i < this.balls.length; i++) {
      const b = this.balls[i];
      if (b.potted) continue;
      const ox = b.x - cue.x;
      const oz = b.z - cue.z;
      const proj = ox * dx + oz * dz;
      if (proj <= 0) continue;
      const perpSq = ox * ox + oz * oz - proj * proj;
      if (perpSq < twoRSq) {
        const t = proj - Math.sqrt(twoRSq - perpSq);
        if (t > 0.01 && t < bestT) {
          bestT = t;
          hitBall = b;
        }
      }
    }

    const gx = cue.x + dx * bestT;
    const gz = cue.z + dz * bestT;
    const angY = -Math.atan2(dz, dx);

    this.aimLine.position.set((cue.x + gx) * 0.5, 0, (cue.z + gz) * 0.5);
    this.aimLine.rotation.y = angY;
    this.aimLine.scale.x = Math.max(0.02, bestT);

    this.ghostRing.position.set(gx, 0.002, gz);
    this.ghostRing.material.color.setHex(hitBall ? 0x34d399 : 0x38bdf8);

    if (hitBall) {
      const nx = (hitBall.x - gx) / twoR;
      const nz = (hitBall.z - gz) / twoR;
      const tLen = 0.44;
      this.targetLine.visible = true;
      this.targetLine.position.set(hitBall.x + nx * tLen * 0.5, 0, hitBall.z + nz * tLen * 0.5);
      this.targetLine.rotation.y = -Math.atan2(nz, nx);
      this.targetLine.scale.x = tLen;
    } else {
      this.targetLine.visible = false;
    }
  }

  _stepPhysics(dt) {
    const subSteps = 3;
    const h = dt / subSteps;
    let moving = false;

    for (let s = 0; s < subSteps; s++) {
      // Integrar posiciones y fricción
      for (const b of this.balls) {
        if (b.potted) continue;
        b.x += b.vx * h;
        b.z += b.vz * h;
        const speed = Math.hypot(b.vx, b.vz);
        if (speed > 0.001) {
          const dampMul = Math.exp(-FRICTION * h);
          b.vx *= dampMul;
          b.vz *= dampMul;
          if (Math.hypot(b.vx, b.vz) < 0.03) {
            b.vx = 0;
            b.vz = 0;
          } else {
            moving = true;
          }
          // Rotación visual realista de rodadura
          b.mesh.rotation.z -= (b.vx * h) / BALL_R;
          b.mesh.rotation.x += (b.vz * h) / BALL_R;
        }

        // Comprobar captura en cualquiera de las 6 troneras
        let fell = false;
        for (const pk of this.pockets) {
          if (Math.hypot(b.x - pk.x, b.z - pk.z) < 0.095) {
            b.potted = true;
            b.vx = 0;
            b.vz = 0;
            b.x = pk.x;
            b.z = pk.z;
            b.drop = 0.01;
            fell = true;
            if (b.id === 0) {
              this.scratched = true;
            } else {
              this.pottedThisTurn += 1;
              this.scores[this.turn] += 1;
              this.pottedColors[this.turn].push(b.color);
              this._boardPop = 1;
            }
            break;
          }
        }
        if (fell) continue;

        // Rebotes contra las bandas
        const maxX = POOL_TABLE.playHalfL - BALL_R;
        const maxZ = POOL_TABLE.playHalfW - BALL_R;
        if (b.x < -maxX) { b.x = -maxX; b.vx = Math.abs(b.vx) * RESTITUTION; }
        else if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx) * RESTITUTION; }
        if (b.z < -maxZ) { b.z = -maxZ; b.vz = Math.abs(b.vz) * RESTITUTION; }
        else if (b.z > maxZ) { b.z = maxZ; b.vz = -Math.abs(b.vz) * RESTITUTION; }
      }

      // Colisiones elásticas bola-bola
      const minD = BALL_R * 2;
      for (let i = 0; i < this.balls.length; i++) {
        const a = this.balls[i];
        if (a.potted) continue;
        for (let j = i + 1; j < this.balls.length; j++) {
          const b = this.balls[j];
          if (b.potted) continue;
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.0001 && dist < minD) {
            const nx = dx / dist;
            const nz = dz / dist;
            const overlap = (minD - dist) * 0.5;
            a.x -= nx * overlap;
            a.z -= nz * overlap;
            b.x += nx * overlap;
            b.z += nz * overlap;

            const rvx = b.vx - a.vx;
            const rvz = b.vz - a.vz;
            const vn = rvx * nx + rvz * nz;
            if (vn < 0) {
              const imp = -vn * 0.94;
              a.vx -= imp * nx;
              a.vz -= imp * nz;
              b.vx += imp * nx;
              b.vz += imp * nz;
              moving = true;
            }
          }
        }
      }
    }
    return moving;
  }

  _syncBallsVisuals(dt) {
    for (const b of this.balls) {
      if (b.potted) {
        b.drop = Math.min(1, b.drop + dt * 5);
        b.mesh.position.set(b.x, POOL_TABLE.topY + BALL_R - b.drop * 0.16, b.z);
        b.mesh.visible = b.drop < 0.95;
        b.shadow.visible = false;
      } else {
        b.mesh.visible = true;
        b.mesh.position.set(b.x, POOL_TABLE.topY + BALL_R, b.z);
        b.shadow.visible = true;
        b.shadow.position.set(b.x, POOL_TABLE.topY + 0.003, b.z);
      }
    }
  }

  // ------------------------------------------------ actualización por frame
  update(dt) {
    this.time += dt;
    this.phaseTime += dt;

    // Luz cálida sobre la mesa en tema oscuro
    const dark = this.office.theme === 'dark';
    const tgtLight = dark ? 4.2 : 0.35;
    if (this._lampLight && Math.abs(this._lampLight.intensity - tgtLight) > 0.004) {
      this._lampLight.intensity = damp(this._lampLight.intensity, tgtLight, 6, dt);
      if (Math.abs(this._lampLight.intensity - tgtLight) <= 0.004) this._lampLight.intensity = tgtLight;
      this._lampLight.visible = this._lampLight.intensity > 0.02;
    }
    const tgtEmissive = dark ? 1.15 : 0.22;
    if (this._lampShadeMat && Math.abs(this._lampShadeMat.emissiveIntensity - tgtEmissive) > 0.004) {
      this._lampShadeMat.emissiveIntensity = damp(this._lampShadeMat.emissiveIntensity, tgtEmissive, 6, dt);
      if (Math.abs(this._lampShadeMat.emissiveIntensity - tgtEmissive) <= 0.004) this._lampShadeMat.emissiveIntensity = tgtEmissive;
    }

    if (this._boardPop > 0) {
      this._boardPop = Math.max(0, this._boardPop - dt * 3.8);
      this.boardHead.scale.setScalar(1 + Math.sin(this._boardPop * Math.PI) * 0.08);
    } else if (this.boardHead.scale.x !== 1) {
      this.boardHead.scale.setScalar(1);
    }

    if (this.humanActor) {
      const fp = Boolean(this.humanMode && this.office.firstPersonMode);
      const aimingFp = fp && this.turn === 0 && (this.phase === 'aim' || this.phase === 'position' || this.phase === 'strike');
      this.humanActor.group.visible = Boolean(this.humanMode && !aimingFp && !fp);
      if (this.humanActor.group.visible) {
        this.humanActor.spawnScale = damp(this.humanActor.spawnScale, 1, 10, dt);
        this.humanActor.group.scale.setScalar(this.humanActor.spawnScale);
        this.office._pose(this.humanActor, dt, false);
      }
    }
    if (this.fpCue) {
      const cue = this.balls[0];
      const showFpCue = Boolean(
        this.humanMode &&
        this.office.firstPersonMode &&
        this.turn === 0 &&
        (this.phase === 'aim' || this.phase === 'position' || this.phase === 'strike') &&
        !cue.potted
      );
      this.fpCue.visible = showFpCue;
      if (showFpCue) {
        const pull = Math.max(0, -(this.shot.cuePull || 0));
        const push = Math.max(0, this.shot.cuePull || 0);
        const backDist = Math.max(0.005, 0.025 + pull * 1.05 - push * 0.09);
        const wx = POOL_TABLE.x + cue.x - this.shot.dirX * backDist;
        const wz = POOL_TABLE.z + cue.z - this.shot.dirZ * backDist;
        this.fpCue.position.set(wx, POOL_TABLE.topY + BALL_R + 0.006, wz);
        this.fpCue.rotation.set(0.11, Math.atan2(this.shot.dirX, this.shot.dirZ), 0);
      }
    }

    for (const g of this.guests) {
      if (!g.group.visible) continue;
      g.spawnScale = damp(g.spawnScale, 1, 10, dt);
      g.group.scale.setScalar(g.spawnScale);
      this.office._pose(g, dt, false);
    }

    if (this.phase === 'idle') {
      if (!this._ballsSettled) {
        this._syncBallsVisuals(dt);
        this._ballsSettled = this.balls.every((b) => !b.potted || b.drop >= 1);
      }
      return;
    }
    this._ballsSettled = false;

    if (this.phase === 'position') {
      if (this.humanMode && this.turn === 0) {
        this._updateAimGuide();
      }
      if (this._playersReady() && this.phaseTime >= (this.humanMode && this.turn === 0 ? 0.48 : 0.72)) {
        this.phase = 'aim';
        this.phaseTime = 0;
        if (this.office.bumpGamesVersion) this.office.bumpGamesVersion();
      }
    } else if (this.phase === 'aim') {
      if (this.humanMode && this.turn === 0) {
        if (this.humanCharging) {
          this.humanPower += this.humanChargeDir * dt * 2.4;
          if (this.humanPower >= 3.8) {
            this.humanPower = 3.8;
            this.humanChargeDir = -1;
          } else if (this.humanPower <= 1.3) {
            this.humanPower = 1.3;
            this.humanChargeDir = 1;
          }
          this.shot.power = this.humanPower;
          this.shot.cuePull = -((this.humanPower - 1.2) / 2.6) * 0.25;
          if (this.office.bumpGamesVersion) this.office.bumpGamesVersion();
        } else {
          this.shot.cuePull = Math.sin(this.phaseTime * 5.2) * 0.045 - ((this.humanPower - 1.2) / 2.6) * 0.08;
        }
        this._updateAimGuide();
      } else {
        // Dos amagos suaves de taco afinando la puntería (IA)
        this.shot.cuePull = Math.sin(this.phaseTime * 7.2) * 0.075;
        if (this.phaseTime >= this.shot.aimDur) {
          this.phase = 'strike';
          this.phaseTime = 0;
          this.shot.struck = false;
        }
      }
    } else if (this.phase === 'strike') {
      const u = clamp(this.phaseTime / this.shot.strikeDur, 0, 1);
      if (u < 0.48) {
        this.shot.cuePull = -smoothstep(u / 0.48) * 0.24; // carga atrás
      } else {
        const fwd = smoothstep((u - 0.48) / 0.52);
        this.shot.cuePull = -0.24 + fwd * 0.4; // golpe limpio hacia adelante
        if (!this.shot.struck && u >= 0.65) {
          this.shot.struck = true;
          this.pottedThisTurn = 0;
          this.scratched = false;
          const cue = this.balls[0];
          cue.vx = this.shot.dirX * this.shot.power;
          cue.vz = this.shot.dirZ * this.shot.power;
        }
      }
      if (this.phaseTime >= this.shot.strikeDur) {
        this.phase = 'rolling';
        this.phaseTime = 0;
      }
    } else if (this.phase === 'rolling') {
      const stillMoving = this._stepPhysics(dt);
      if (!stillMoving && this.phaseTime > 0.35) {
        const shooter = this.players[this.turn];
        const sName = shooter ? shooter.data.name : 'Jugador';

        if (this.scores[this.turn] >= POOL_RULES.targetBalls || this.balls.slice(1).every((b) => b.potted)) {
          this.winnerIdx = this.scores[0] >= this.scores[1] ? 0 : 1;
          const w = this.players[this.winnerIdx];
          this.winnerName = w ? w.data.name : 'Ganador';
          if (w) this.wins.set(w.id, (this.wins.get(w.id) || 0) + 1);
          this.lastEvent = `Ganó ${this.winnerName} (${this.scores[0]}–${this.scores[1]})`;
          this.phase = 'match_over';
          this.phaseTime = 0;
        } else if (this.scratched) {
          this.lastEvent = `Falta blanca de ${sName} · Cambio de turno`;
          this.turn = 1 - this.turn;
          this.phase = 'turn_end';
          this.phaseTime = 0;
        } else if (this.pottedThisTurn > 0) {
          this.lastEvent = `¡${sName} emboca! Repite turno`;
          this.phase = 'turn_end';
          this.phaseTime = 0;
        } else {
          this.lastEvent = `Turno de ${this.players[1 - this.turn]?.data.name || 'rival'}`;
          this.turn = 1 - this.turn;
          this.phase = 'turn_end';
          this.phaseTime = 0;
        }
        this._drawScoreboard(true);
      }
    } else if (this.phase === 'turn_end') {
      if (this.phaseTime >= 1.1) {
        this._planNextShot();
        this.phase = 'position';
        this.phaseTime = 0;
        this._drawScoreboard(true);
      }
    } else if (this.phase === 'match_over') {
      if (this.phaseTime >= 3.2) {
        this._startNewMatch();
      }
    }

    this._syncBallsVisuals(dt);
  }

  // ------------------------------------------------ animaciones de personajes
  poseActor(a, dt) {
    const idx = this.players.indexOf(a);
    const playing = idx >= 0 && (a.isGuest || a.arrived) && this.phase !== 'idle';

    if (a.parts.cue) {
      const tgt = playing ? 1 : 0.001;
      a._cueScale = damp(a._cueScale || 0.001, tgt, 14, dt);
      a.parts.cue.visible = a._cueScale > 0.04;
      a.parts.cue.scale.setScalar(a._cueScale);
    }

    if (!playing) return false;

    const p = a.parts;
    const isShooter = idx === this.turn && this.phase !== 'match_over';
    const t = this.time + a.phase;

    // Posición objetivo alrededor de la mesa (el tirador se alinea con la bola blanca; el rival espera a un lado)
    let tx;
    let tz;
    let tyaw;
    if (isShooter) {
      tx = this.shot.standX;
      tz = this.shot.standZ;
      tyaw = this.shot.yaw;
    } else {
      // Lado contrario al tirador para no cruzarse ni tapar el tiro
      const oppSide = this.shot.standX < POOL_TABLE.x ? 1 : -1;
      tx = POOL_TABLE.x + oppSide * 1.66;
      tz = POOL_TABLE.z + (idx === 0 ? 0.35 : -0.35);
      tyaw = Math.atan2(POOL_TABLE.x - tx, POOL_TABLE.z - tz);
    }

    const moveDist = Math.hypot(tx - a.group.position.x, tz - a.group.position.z);
    a.group.position.x = damp(a.group.position.x, tx, 6.5, dt);
    a.group.position.z = damp(a.group.position.z, tz, 6.5, dt);
    a.yaw = dampAngle(a.yaw, tyaw, 10, dt);
    a.group.rotation.y = a.yaw;

    const walkingAround = clamp(moveDist * 2.2, 0, 1);
    const step = Math.sin(this.time * 11 + idx);

    let bodyY = Math.abs(step) * 0.03 * walkingAround;
    let jumpY = 0;
    let torsoX = 0.06;
    let torsoY = 0;
    let torsoZ = 0;
    let headX = 0.14;
    let headY = 0;
    let headZ = 0;
    let thighL = step * 0.35 * walkingAround;
    let thighR = -step * 0.35 * walkingAround;
    let shinL = Math.max(0, -step) * 0.45 * walkingAround;
    let shinR = Math.max(0, step) * 0.45 * walkingAround;
    let armLX = 0.04;
    let armLZ = 0.12;
    let elbowLX = -0.22;
    let armRX = -0.25;
    let armRZ = -0.14;
    let elbowRX = -0.45;
    let cueRotX = 0.18;
    let cueRotZ = 0;
    let cuePosZ = 0.03;
    let mood = 'neutral';

    if (this.phase === 'match_over') {
      if (idx === this.winnerIdx) {
        mood = 'excited';
        const wave = Math.sin(this.phaseTime * 7.0);
        jumpY = Math.pow(Math.abs(wave), 0.78) * 0.26;
        torsoX = -0.08;
        torsoY = Math.sin(this.phaseTime * 4) * 0.16;
        armRX = -2.45 + Math.sin(this.phaseTime * 9) * 0.16;
        armRZ = -0.25;
        elbowRX = -0.35;
        armLX = -2.4 + Math.sin(this.phaseTime * 9 + 1) * 0.16;
        armLZ = 0.28;
        elbowLX = -0.35;
        cueRotX = 0.1;
      } else {
        mood = 'happy';
        const cl = Math.abs(Math.sin(this.phaseTime * 8));
        armRX = -0.75;
        armRZ = 0.16 + cl * 0.14;
        elbowRX = -1.15;
        armLX = -0.75;
        armLZ = -0.16 - cl * 0.14;
        elbowLX = -1.15;
      }
    } else if (isShooter && (this.phase === 'aim' || this.phase === 'strike')) {
      // Postura clásica inclinada de billar: puente con mano izquierda, taco alineado con derecha
      mood = 'focused';
      const pull = this.shot.cuePull || 0;
      bodyY = -0.12;
      torsoX = 0.58;
      torsoY = -0.38;
      torsoZ = 0.06;
      thighL = -0.34;
      thighR = 0.16;
      shinL = 0.44;
      shinR = 0.18;
      headX = -0.32;
      headY = 0.34;
      // Mano izquierda apoyada adelante haciendo puente
      armLX = -1.12;
      armLZ = -0.12;
      elbowLX = -0.35;
      // Brazo derecho sujeta el taco y ejecuta el movimiento de vaivén y golpe
      armRX = 0.18 - pull * 1.4;
      armRZ = -0.12;
      elbowRX = -1.42 - pull * 1.2;
      cueRotX = Math.PI * 0.48;
      cuePosZ = 0.08 + pull * 0.65;
    } else if (isShooter && this.phase === 'turn_end' && this.pottedThisTurn > 0) {
      mood = 'happy';
      const pump = Math.sin(this.phaseTime * 11) * Math.exp(-this.phaseTime * 1.5);
      armLX = -1.55 + pump * 0.3;
      armLZ = 0.25;
      elbowLX = -1.2;
      torsoX = -0.04;
      headX = -0.06;
    } else {
      // Observando las bolas rodar o esperando turno sosteniendo el taco vertical
      mood = this.phase === 'rolling' ? 'focused' : 'neutral';
      const cueBall = this.balls[0];
      const bx = POOL_TABLE.x + cueBall.x;
      const bz = POOL_TABLE.z + cueBall.z;
      const ang = Math.atan2(bx - a.group.position.x, bz - a.group.position.z);
      headY = clamp(wrapAngle(ang - a.yaw), -0.6, 0.6);
      headX = 0.18;
      torsoZ = Math.sin(t * 0.85) * 0.025;
      armRX = -0.32;
      armRZ = -0.18;
      elbowRX = -0.82;
      cueRotX = 0.04;
      cueRotZ = 0.06;
    }

    p.body.position.y = damp(p.body.position.y, bodyY, 14, dt);
    a.group.position.y = damp(a.group.position.y, jumpY, 16, dt);
    p.thighL.rotation.x = damp(p.thighL.rotation.x, thighL, 14, dt);
    p.thighR.rotation.x = damp(p.thighR.rotation.x, thighR, 14, dt);
    p.shinL.rotation.x = damp(p.shinL.rotation.x, shinL, 14, dt);
    p.shinR.rotation.x = damp(p.shinR.rotation.x, shinR, 14, dt);
    p.torso.rotation.x = damp(p.torso.rotation.x, torsoX, 12, dt);
    p.torso.rotation.y = damp(p.torso.rotation.y, torsoY, 12, dt);
    p.torso.rotation.z = damp(p.torso.rotation.z, torsoZ, 12, dt);
    p.head.rotation.x = damp(p.head.rotation.x, headX, 12, dt);
    p.head.rotation.y = damp(p.head.rotation.y, headY, 12, dt);
    p.head.rotation.z = damp(p.head.rotation.z, headZ, 12, dt);
    p.armL.rotation.x = damp(p.armL.rotation.x, armLX, 14, dt);
    p.armL.rotation.z = damp(p.armL.rotation.z, armLZ, 14, dt);
    p.elbowL.rotation.x = damp(p.elbowL.rotation.x, elbowLX, 14, dt);
    p.armR.rotation.x = damp(p.armR.rotation.x, armRX, 16, dt);
    p.armR.rotation.z = damp(p.armR.rotation.z, armRZ, 16, dt);
    p.elbowR.rotation.x = damp(p.elbowR.rotation.x, elbowRX, 18, dt);

    if (p.cue) {
      p.cue.rotation.x = damp(p.cue.rotation.x, cueRotX, 18, dt);
      p.cue.rotation.z = damp(p.cue.rotation.z, cueRotZ, 16, dt);
      p.cue.position.z = damp(p.cue.position.z, cuePosZ, 22, dt);
    }

    if (this.phase === 'match_over' && idx === this.winnerIdx) {
      p.sparks.visible = true;
      const el = this.phaseTime;
      const fade = clamp(1 - el / 3.1, 0, 1);
      p.sparks.children.forEach((sp, i) => {
        const ang = (i / 6) * Math.PI * 2 + el * 2.4;
        const rad = 0.28 + Math.sin(el * 3 + i) * 0.12 + el * 0.1;
        sp.position.set(Math.cos(ang) * rad, 1.55 + ((el * 0.72 + i * 0.19) % 1.0), Math.sin(ang) * rad);
      });
      p.sparks.children[0].material.color.setHex(0x34d399);
      p.sparks.children[0].material.opacity = fade * 0.92;
    } else if (p.sparks.visible) {
      p.sparks.visible = false;
    }

    this.office._finishActivityPose(a, dt, t, mood);
    return true;
  }

  onThemeChange() {
    this._drawScoreboard(true);
  }

  // ------------------------------------------------ marcador 3D del billar
  _drawScoreboard(force = false) {
    const p0 = this.players[0];
    const p1 = this.players[1];
    const active = Boolean(p0 && p1);
    const key = `${p0?.data.name || ''}|${p1?.data.name || ''}|${this.scores[0]}|${this.scores[1]}|${this.turn}|${this.phase}|${this.office.theme}`;
    if (!force && key === this._boardKey) return;
    this._boardKey = key;
    if (this.office.bumpGamesVersion) this.office.bumpGamesVersion();

    const ctx = this.boardCanvas.getContext('2d');
    const W = 560;
    const H = 270;
    ctx.fillStyle = '#111b27';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, W, 52);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 20px "Instrument Sans", system-ui, sans-serif';
    ctx.fillText('BILLAR · PRIMERO A 4 BOLAS', 20, 33);

    const drawCol = (x0, player, score, balls, isTurn, isWin) => {
      roundRectPath(ctx, x0, 66, 250, 152, 18);
      ctx.fillStyle = isWin ? 'rgba(16,185,129,0.22)' : 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.fillStyle = player ? cssHex(player.role) : '#64748b';
      ctx.beginPath();
      ctx.arc(x0 + 24, 96, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 23px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText(String(player ? player.data.name : 'Libre').slice(0, 12), x0 + 44, 104);
      if (active && isTurn && this.phase !== 'match_over') {
        ctx.fillStyle = '#34d399';
        ctx.beginPath();
        ctx.arc(x0 + 226, 96, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = isWin ? '#34d399' : '#ffffff';
      ctx.font = '700 84px "Instrument Sans", system-ui, sans-serif';
      const st = String(score);
      ctx.fillText(st, x0 + (250 - ctx.measureText(st).width) / 2, 186);

      // Puntos de color de las bolas embocadas
      balls.slice(0, 5).forEach((col, bi) => {
        ctx.fillStyle = cssHex(col);
        ctx.beginPath();
        ctx.arc(x0 + 44 + bi * 28, 204, 8, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    drawCol(20, p0, this.scores[0], this.pottedColors[0], this.turn === 0, this.winnerIdx === 0);
    drawCol(290, p1, this.scores[1], this.pottedColors[1], this.turn === 1, this.winnerIdx === 1);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 18px "Instrument Sans", system-ui, sans-serif';
    ctx.fillText(String(this.lastEvent || 'Si embocas, repites turno').slice(0, 44), 22, 250);
    this.boardTex.needsUpdate = true;
  }

  getState() {
    const active = Boolean(this.players[0] && this.players[1]);
    const mkP = (i) => {
      const a = this.players[i];
      if (!a) return null;
      return {
        id: a.id,
        name: a.data.name,
        color: a.role,
        score: this.scores[i],
        potted: this.pottedColors[i],
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
      humanPower: this.humanPower,
      humanAngle: this.humanAngle,
      winnerName: this.phase === 'match_over' ? this.winnerName : '',
      lastEvent: this.lastEvent,
      p0: mkP(0),
      p1: mkP(1),
      rules: POOL_RULES,
    };
  }
}

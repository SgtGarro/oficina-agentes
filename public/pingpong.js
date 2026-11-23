// Arena de Ping-Pong 3D, física de bola, mini-reglas y animaciones atléticas.
// Se integra en la zona de descanso de Office sin interferir con escritorios ni rutas.

export const PP_TABLE = {
  x: 8.1,
  z: 2.3,
  len: 2.6,
  wid: 1.48,
  topY: 0.76,
  netH: 0.145,
  playerOffsetX: 1.84,
};

export const PP_RULES = {
  targetScore: 5,
  winBy: 2,
  servesPerTurn: 2,
};

const BALL_R = 0.044;
const GRAVITY = 8.6;
const HALF_L = PP_TABLE.len / 2;
const HALF_W = PP_TABLE.wid / 2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
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

function solveVy(y0, y1, T) {
  return (y1 - y0 + 0.5 * GRAVITY * T * T) / Math.max(0.05, T);
}

export class PingPongArena {
  constructor(office) {
    this.office = office;
    this.THREE = office.THREE;
    this.time = 0;

    // Estado de jugadores y exhibición local (opcional, sin ensuciar office.actors)
    this.exhibition = false;
    this.humanMode = false;
    this.humanActor = null;
    this.humanOpponentId = null;
    this.humanTargetZ = PP_TABLE.z;
    this.humanAimZ = PP_TABLE.z;
    this.humanSwingTimer = 0;
    this.humanServeQueued = false;
    this.guests = [];
    this.leftActor = null;
    this.rightActor = null;
    this.juggler = null;
    this.wins = new Map();
    this.queueSkipId = null;
    this._rotateSide = 0;
    this.requestedIds = [];

    // Estado del partido
    this.phase = 'idle'; // 'idle' | 'juggling' | 'serve_ready' | 'serve_toss' | 'rally' | 'point_end' | 'match_over'
    this.phaseTime = 0;
    this.score = { left: 0, right: 0 };
    this.server = -1; // -1 = izquierda, +1 = derecha
    this.firstServer = -1;
    this.rally = 0;
    this.bestRally = 0;
    this.lastScorer = 0;
    this.winnerSide = 0;
    this.winnerName = '';
    this.lastEventText = '';
    this._boardKey = '';
    this._boardPop = 0;

    // Estado físico de la pelota (ring buffer prealocado para cero GC en rallies)
    this.ballPos = new this.THREE.Vector3(PP_TABLE.x, PP_TABLE.topY + BALL_R, PP_TABLE.z);
    this.ballVisible = false;
    this.shot = null;
    this._trailRing = Array.from({ length: 6 }, () => new this.THREE.Vector3());
    this._trailCount = 0;
    this._trailHead = 0;
    this._ripples = [];
    this._rngState = 1337;

    // Estado kinemático por lado (-1 izquierda, +1 derecha)
    this.playerAnim = {
      [-1]: this._freshAnim(-1),
      [1]: this._freshAnim(1),
    };

    this._buildTable();
    this._buildBall();
    this._buildScoreboard();
    this._drawScoreboard(true);
  }

  _rand() {
    this._rngState = (Math.imul(this._rngState, 1664525) + 1013904223) >>> 0;
    return this._rngState / 4294967296;
  }

  _freshAnim(side) {
    return {
      side,
      z: PP_TABLE.z,
      targetZ: PP_TABLE.z,
      xOff: 0,
      targetXOff: 0,
      vz: 0,
      strokeType: 'forehand', // 'forehand' | 'backhand' | 'smash' | 'serve' | 'lunge'
      strokePhase: 0, // < 0 preparando, 0 impacto, > 0 seguimiento
      strokeActive: false,
      strokeTimer: 0,
      windupDur: 0.24,
      followDur: 0.34,
      lungeDir: 0,
      mood: 'ready', // 'ready' | 'celebrate_pt' | 'sad_pt' | 'win' | 'clap'
      moodTime: 0,
      juggleTap: 0,
    };
  }

  // --------------------------------------------------- geometría de la mesa
  _buildTable() {
    const T = this.THREE;
    const o = this.office;
    const g = new T.Group();
    g.position.set(PP_TABLE.x, 0, PP_TABLE.z);
    o.scene.add(g);
    this.tableGroup = g;

    // Textura limpia de tablero profesional con líneas reglamentarias
    const surfaceTex = o._texture(512, 292, 1, 1, (ctx, w, h) => {
      ctx.fillStyle = '#1e527a';
      ctx.fillRect(0, 0, w, h);
      // Variación sutil de iluminación mate
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(10, 10, w - 20, (h - 20) / 2);
      // Borde perimetral blanco nítido
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 8;
      ctx.strokeRect(10, 10, w - 20, h - 20);
      // Línea central de dobles
      ctx.fillStyle = 'rgba(248,250,252,0.82)';
      ctx.fillRect(10, h / 2 - 2, w - 20, 4);
      // Sombra sutil bajo la red
      ctx.fillStyle = 'rgba(15,23,42,0.22)';
      ctx.fillRect(w / 2 - 4, 0, 8, h);
    });
    surfaceTex.wrapS = surfaceTex.wrapT = T.ClampToEdgeWrapping;

    // Tablero principal + faldón oscuro limpio
    o._box(PP_TABLE.len, 0.055, PP_TABLE.wid, 0x1e293b, 0, PP_TABLE.topY - 0.028, 0, g, { rough: 0.55 });
    const topMat = new T.MeshStandardMaterial({ map: surfaceTex, roughness: 0.42, metalness: 0.04 });
    const topPlane = o._mesh(new T.PlaneGeometry(PP_TABLE.len - 0.01, PP_TABLE.wid - 0.01), topMat, 0, PP_TABLE.topY + 0.001, 0, g, { cast: false, receive: true });
    topPlane.rotation.x = -Math.PI / 2;

    // Estructura inferior y patas estilizadas en A con travesaño de madera clara
    o._box(PP_TABLE.len - 0.36, 0.08, PP_TABLE.wid - 0.28, 0x334155, 0, PP_TABLE.topY - 0.09, 0, g, { rough: 0.5, metal: 0.35 });
    for (const sx of [-0.92, 0.92]) {
      for (const sz of [-0.52, 0.52]) {
        const leg = o._cyl(0.032, 0.026, 0.72, 0x334155, sx, 0.35, sz, g, { seg: 10, rough: 0.4, metal: 0.45 });
        leg.rotation.z = sx > 0 ? -0.1 : 0.1;
      }
      o._box(0.055, 0.045, 1.04, 0xc29e74, sx * 1.03, 0.18, 0, g, { rough: 0.65 });
    }
    o._box(1.9, 0.04, 0.045, 0x475569, 0, 0.26, 0, g, { rough: 0.45, metal: 0.45 });

    // Red con malla perforada realista + cinta blanca superior + postes metálicos
    const netTex = o._texture(128, 32, 8, 2, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(241, 245, 249, 0.62)';
      ctx.lineWidth = 2;
      for (let x = 0; x < w; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 8) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    });
    const netMat = new T.MeshBasicMaterial({ map: netTex, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false });
    const netMesh = o._mesh(new T.PlaneGeometry(PP_TABLE.wid + 0.12, PP_TABLE.netH - 0.022), netMat, 0, PP_TABLE.topY + PP_TABLE.netH * 0.46, 0, g, { cast: false, receive: false });
    netMesh.rotation.y = Math.PI / 2;

    // Cinta superior blanca y postes laterales
    o._box(0.018, 0.024, PP_TABLE.wid + 0.14, 0xf8fafc, 0, PP_TABLE.topY + PP_TABLE.netH, 0, g, { cast: false, rough: 0.6 });
    for (const sz of [-(HALF_W + 0.07), HALF_W + 0.07]) {
      o._cyl(0.018, 0.018, PP_TABLE.netH + 0.05, 0x475569, 0, PP_TABLE.topY + PP_TABLE.netH * 0.48, sz, g, { seg: 10, rough: 0.35, metal: 0.6 });
    }

    // Ondas de bote sobre el tablero (pool de 3 anillos)
    for (let i = 0; i < 3; i++) {
      const rMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false });
      rMat.toneMapped = false;
      const ring = new T.Mesh(o._geo('ppRipple', () => new T.RingGeometry(0.03, 0.065, 24)), rMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = PP_TABLE.topY + 0.005;
      ring.visible = false;
      ring.raycast = () => {};
      ring.userData.dynamic = true;
      o.scene.add(ring);
      this._ripples.push({ mesh: ring, mat: rMat, age: 99, dur: 0.38 });
    }

    // Indicador en mesa de posición y alcance cuando juega el usuario
    const curMat = new T.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.78, side: T.DoubleSide, depthWrite: false });
    curMat.toneMapped = false;
    this.humanCursorMesh = new T.Mesh(o._geo('ppHumanCur', () => new T.RingGeometry(0.085, 0.125, 24)), curMat);
    this.humanCursorMesh.rotation.x = -Math.PI / 2;
    this.humanCursorMesh.position.set(PP_TABLE.x - HALF_L + 0.12, PP_TABLE.topY + 0.006, PP_TABLE.z);
    this.humanCursorMesh.visible = false;
    this.humanCursorMesh.raycast = () => {};
    this.humanCursorMesh.userData.dynamic = true;
    o.scene.add(this.humanCursorMesh);
    this.fpPaddle = null;
  }

  _ensureFpPaddle() {
    if (this.fpPaddle) return;
    const T = this.THREE;
    const o = this.office;
    const fpPaddle = new T.Group();
    fpPaddle.scale.setScalar(1.38);
    fpPaddle.visible = false;
    fpPaddle.userData.dynamic = true;
    o._cyl(0.018, 0.022, 0.15, 0xc9a374, 0, -0.03, 0, fpPaddle, { seg: 10, rough: 0.62, cast: false });
    const fpRim = o._cyl(0.115, 0.115, 0.018, 0xf8fafc, 0, 0.125, 0, fpPaddle, { seg: 20, rough: 0.45, cast: false });
    fpRim.rotation.x = Math.PI / 2;
    const fpRed = o._cyl(0.108, 0.108, 0.006, 0xe11d48, 0, 0.125, 0.009, fpPaddle, { seg: 20, rough: 0.4, cast: false });
    fpRed.rotation.x = Math.PI / 2;
    const fpBlk = o._cyl(0.108, 0.108, 0.006, 0x1e293b, 0, 0.125, -0.009, fpPaddle, { seg: 20, rough: 0.4, cast: false });
    fpBlk.rotation.x = Math.PI / 2;
    o.scene.add(fpPaddle);
    this.fpPaddle = fpPaddle;
  }

  _buildBall() {
    const T = this.THREE;
    const o = this.office;

    const ballMat = new T.MeshStandardMaterial({
      color: 0xfff8eb,
      emissive: 0xffedd5,
      emissiveIntensity: 0.38,
      roughness: 0.25,
    });
    this.ballMesh = new T.Mesh(o._geo('ppBall', () => new T.SphereGeometry(BALL_R, 14, 12)), ballMat);
    this.ballMesh.castShadow = false;
    this.ballMesh.visible = false;
    this.ballMesh.raycast = () => {};
    this.ballMesh.userData.dynamic = true;
    o.scene.add(this.ballMesh);

    // Sombra proyectada dinámica de la bola (sobre mesa o suelo)
    const shMat = new T.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.28, depthWrite: false });
    this.ballShadow = new T.Mesh(o._geo('ppBallSh', () => new T.CircleGeometry(BALL_R * 1.15, 16)), shMat);
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.visible = false;
    this.ballShadow.raycast = () => {};
    this.ballShadow.userData.dynamic = true;
    o.scene.add(this.ballShadow);

    // Estela suave de movimiento
    this.trailMeshes = [];
    for (let i = 0; i < 5; i++) {
      const frac = 1 - (i + 1) / 6;
      const tMat = new T.MeshBasicMaterial({ color: 0xffedd5, transparent: true, opacity: frac * 0.34, depthWrite: false });
      tMat.toneMapped = false;
      const tm = new T.Mesh(o._geo('ppBall', () => new T.SphereGeometry(BALL_R, 10, 8)), tMat);
      tm.scale.setScalar(0.55 + frac * 0.35);
      tm.visible = false;
      tm.raycast = () => {};
      tm.userData.dynamic = true;
      o.scene.add(tm);
      this.trailMeshes.push(tm);
    }
  }

  _buildScoreboard() {
    const T = this.THREE;
    const o = this.office;
    const stand = new T.Group();
    stand.position.set(PP_TABLE.x, 0, PP_TABLE.z - HALF_W - 0.56);
    o.scene.add(stand);

    // Pedestal elegante y marco de marcador digital de pista
    o._cyl(0.22, 0.24, 0.035, 0x334155, 0, 0.02, 0, stand, { seg: 18, rough: 0.4, metal: 0.5, cast: false });
    o._cyl(0.032, 0.032, 1.32, 0x475569, 0, 0.68, 0, stand, { seg: 12, rough: 0.35, metal: 0.55, cast: false });

    const head = new T.Group();
    head.userData.dynamic = true;
    head.position.set(0, 1.48, 0);
    stand.add(head);
    this.boardHead = head;

    o._box(1.52, 0.72, 0.07, 0x1e293b, 0, 0, 0, head, { rough: 0.42, metal: 0.3 });

    this.boardCanvas = o.makeCanvas();
    this.boardCanvas.width = 640;
    this.boardCanvas.height = 300;
    this.boardTex = new T.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = T.SRGBColorSpace;
    this.boardTex.anisotropy = 4;

    const faceMat = new T.MeshBasicMaterial({ map: this.boardTex });
    faceMat.toneMapped = false;
    o._mesh(new T.PlaneGeometry(1.42, 0.62), faceMat, 0, 0, 0.038, head, { cast: false, receive: false });
  }

  attachPaddle(actor) {
    const T = this.THREE;
    const o = this.office;
    const paddle = new T.Group();
    // Anclada en la mano derecha (actor.parts.elbowR en y = -0.24)
    paddle.position.set(0, -0.24, 0.04);
    paddle.rotation.set(Math.PI * 0.45, 0, 0);
    paddle.scale.setScalar(0.001);
    paddle.visible = false;

    // Mango de madera + cara roja (drive) y cara oscura (revés) + canto blanco
    o._cyl(0.018, 0.021, 0.14, 0xc9a374, 0, -0.02, 0, paddle, { seg: 8, rough: 0.65 });
    const bladeRim = o._cyl(0.112, 0.112, 0.018, 0xf8fafc, 0, 0.125, 0, paddle, { seg: 18, rough: 0.5 });
    bladeRim.rotation.x = Math.PI / 2;
    const redFace = o._cyl(0.105, 0.105, 0.006, 0xe11d48, 0, 0.125, 0.009, paddle, { seg: 18, rough: 0.45, cast: false });
    redFace.rotation.x = Math.PI / 2;
    const blkFace = o._cyl(0.105, 0.105, 0.006, 0x1e293b, 0, 0.125, -0.009, paddle, { seg: 18, rough: 0.45, cast: false });
    blkFace.rotation.x = Math.PI / 2;

    actor.parts.elbowR.add(paddle);
    actor.parts.paddle = paddle;
    actor._paddleScale = 0.001;
  }

  // ----------------------------------------------------------- utilidades
  getPlayerSpot(side) {
    return {
      x: PP_TABLE.x + side * PP_TABLE.playerOffsetX,
      z: PP_TABLE.z,
    };
  }

  isActivePlayer(actor) {
    return actor && (actor === this.leftActor || actor === this.rightActor || actor === this.juggler);
  }

  getActorTarget(actor) {
    if (actor === this.leftActor) {
      const s = this.getPlayerSpot(-1);
      return { key: 'pp-left', type: 'spot', spot: { index: 100, x: s.x, z: s.z } };
    }
    if (actor === this.rightActor) {
      const s = this.getPlayerSpot(1);
      return { key: 'pp-right', type: 'spot', spot: { index: 101, x: s.x, z: s.z } };
    }
    if (actor === this.juggler) {
      const s = this.getPlayerSpot(-1);
      return { key: 'pp-juggle', type: 'spot', spot: { index: 100, x: s.x, z: s.z } };
    }
    return null;
  }

  lookTargetForSpectator() {
    if (this.ballVisible) return this.ballPos;
    return null;
  }

  onThemeChange() {
    this._drawScoreboard(true);
  }

  // ------------------------------------------------ exhibición y modo jugador
  setExhibition(enabled) {
    const next = Boolean(enabled);
    if (next && this.humanMode) {
      this.setHumanMode(false);
    }
    if (this.exhibition === next) return;
    this.exhibition = next;
    if (!next) {
      this._clearGuests();
    } else {
      this._ensureGuests();
    }
    this._drawScoreboard(true);
  }

  setHumanMode(enabled, opponentId = null) {
    const next = Boolean(enabled);
    if (this.humanMode === next && (!next || this.humanOpponentId === opponentId)) return;
    this.humanMode = next;
    this.humanOpponentId = opponentId && opponentId !== '__pp_human' ? opponentId : null;
    this.humanTargetZ = PP_TABLE.z;
    this.humanAimZ = PP_TABLE.z;
    this.humanSwingTimer = 0;
    this.humanServeQueued = false;
    if (next) {
      this.exhibition = false;
      this._ensureFpPaddle();
      this._ensureHumanActor();
      this._ensureGuests();
      this._resetMatch();
    } else {
      if (this.leftActor === this.humanActor) this.leftActor = null;
      this._clearHumanActor();
      this._clearGuests();
      if (this.humanCursorMesh) this.humanCursorMesh.visible = false;
      if (this.fpPaddle) this.fpPaddle.visible = false;
      this._resetMatch();
    }
    this._drawScoreboard(true);
  }

  getFirstPersonCamera() {
    if (!this.humanMode) return null;
    const T = this.THREE;
    const zOff = this.playerAnim[-1].z - PP_TABLE.z;
    const aimOff = this.humanAimZ - PP_TABLE.z;
    return {
      pos: new T.Vector3(PP_TABLE.x - HALF_L - 1.32, PP_TABLE.topY + 0.74, PP_TABLE.z + zOff * 0.36),
      target: new T.Vector3(PP_TABLE.x + 0.55, PP_TABLE.topY + 0.08, PP_TABLE.z + aimOff * 0.2),
    };
  }

  _ensureHumanActor() {
    if (this.humanActor) return;
    const d = {
      id: '__pp_human',
      kind: 'main',
      type: 'human',
      name: 'Tú',
      project: 'Jugador',
      status: 'idle',
      activity: 'Ping-Pong',
      detail: 'Jugando contra NPC',
      tool: null,
      toolCount: 0,
      errorAt: 0,
    };
    const a = this.office._makeActor(d);
    a.isGuest = true;
    a.isHuman = true;
    const spot = this.getPlayerSpot(-1);
    a.group.position.set(spot.x, 0, spot.z);
    a.yaw = Math.PI / 2;
    a.targetYaw = a.yaw;
    a.arrived = true;
    a.target = { key: 'pp-left', type: 'spot', spot };
    this.office._drawLabel(a, true);
    this.humanActor = a;
  }

  _clearHumanActor() {
    if (!this.humanActor) return;
    if (this.leftActor === this.humanActor) this.leftActor = null;
    if (this.rightActor === this.humanActor) this.rightActor = null;
    this.office._dispose(this.humanActor);
    this.humanActor = null;
  }

  handleHumanInput(input) {
    if (!this.humanMode || !input) return;
    if (input.type === 'move_z' && Number.isFinite(input.z)) {
      this.humanTargetZ = clamp(input.z, PP_TABLE.z - 0.78, PP_TABLE.z + 0.78);
      if (Number.isFinite(input.aimZ)) {
        this.humanAimZ = clamp(input.aimZ, PP_TABLE.z - HALF_W + 0.14, PP_TABLE.z + HALF_W - 0.14);
      } else {
        this.humanAimZ = clamp(PP_TABLE.z + (this.humanTargetZ - PP_TABLE.z) * 0.85, PP_TABLE.z - HALF_W + 0.14, PP_TABLE.z + HALF_W - 0.14);
      }
      this.playerAnim[-1].targetZ = this.humanTargetZ;
    } else if (input.type === 'move_delta' && Number.isFinite(input.delta)) {
      this.humanTargetZ = clamp(this.humanTargetZ + input.delta, PP_TABLE.z - 0.78, PP_TABLE.z + 0.78);
      this.humanAimZ = clamp(PP_TABLE.z + (this.humanTargetZ - PP_TABLE.z) * 0.85, PP_TABLE.z - HALF_W + 0.14, PP_TABLE.z + HALF_W - 0.14);
      this.playerAnim[-1].targetZ = this.humanTargetZ;
    } else if (input.type === 'action') {
      if (this.phase === 'serve_ready' && this.server === -1) {
        this.humanServeQueued = true;
      } else if (this.phase === 'rally') {
        this.humanSwingTimer = 0.55;
        const st = this.playerAnim[-1];
        const ballZ = this.shot ? this.shot.endZ : this.ballPos.z;
        const stroke = this._chooseStrokeSide(-1, ballZ, st.z);
        this._triggerStroke(-1, stroke === 'forehand' ? 'smash' : 'backhand', 0.14, 0.34);
      }
    }
  }

  _ensureGuests() {
    if (this.guests.length) return;
    const defs = [
      { id: '__pp_guest_a', kind: 'sub', type: 'ping-a', name: 'Alex', project: 'sala', status: 'idle', activity: 'Ping-Pong', detail: '', tool: null, toolCount: 0, errorAt: 0 },
      { id: '__pp_guest_b', kind: 'sub', type: 'ping-b', name: 'Sofía', project: 'sala', status: 'idle', activity: 'Ping-Pong', detail: '', tool: null, toolCount: 0, errorAt: 0 },
    ];
    defs.forEach((d, idx) => {
      const a = this.office._makeActor(d);
      a.isGuest = true;
      const spot = this.getPlayerSpot(idx === 0 ? -1 : 1);
      a.group.position.set(spot.x, 0, spot.z);
      a.yaw = idx === 0 ? Math.PI / 2 : -Math.PI / 2;
      a.targetYaw = a.yaw;
      a.arrived = true;
      a.target = this.getActorTarget(a) || { key: idx === 0 ? 'pp-left' : 'pp-right', type: 'spot', spot };
      this.office._drawLabel(a, true);
      this.guests.push(a);
    });
  }

  _clearGuests() {
    for (const g of this.guests) {
      if (this.leftActor === g) this.leftActor = null;
      if (this.rightActor === g) this.rightActor = null;
      if (this.juggler === g) this.juggler = null;
      this.office._dispose(g);
    }
    this.guests = [];
  }

  // -------------------------------------------- sincronización de jugadores
  syncPlayers(realIdleActors) {
    const idlePool = realIdleActors.filter((a) => !a.leaving && a.data.status === 'idle');

    // Modo interactivo: el usuario ("Tú") juega en la izquierda contra un agente o NPC en la derecha
    if (this.humanMode) {
      this._ensureHumanActor();
      this._ensureGuests();
      this.juggler = null;
      let opp = null;
      if (this.humanOpponentId) {
        opp = idlePool.find((a) => a.id === this.humanOpponentId) || this.guests.find((g) => g.id === this.humanOpponentId) || null;
      }
      if (!opp && this.requestedIds.length) {
        opp = this.requestedIds.map((id) => idlePool.find((a) => a.id === id)).find(Boolean) || null;
      }
      if (!opp && idlePool.length >= 1) {
        opp = idlePool[0];
      }
      if (!opp) {
        opp = this.guests[1] || this.guests[0];
      }
      for (const g of this.guests) {
        g.group.visible = g === opp;
      }
      const changed = this.leftActor !== this.humanActor || this.rightActor !== opp;
      this.leftActor = this.humanActor;
      this.rightActor = opp;
      if (changed || this.phase === 'idle' || this.phase === 'juggling') {
        this._startNewMatch();
      }
      return;
    }

    // Si el usuario envió explícitamente a 1 agente a jugar y está solo, sumar NPC rival
    if (this.requestedIds.length > 0 && idlePool.length === 1 && !this.exhibition) {
      this.exhibition = true;
    }

    // Si hay >= 2 agentes reales libres, la mesa es suya (se retiran invitados de exhibición)
    if (idlePool.length >= 2) {
      if (this.guests.length) {
        this._clearGuests();
        this.exhibition = false;
      }
      this._assignPair(idlePool);
      return;
    }

    // Si la exhibición está activa y no hay 2 reales libres, juegan los invitados
    if (this.exhibition) {
      this._ensureGuests();
      // Si hay 1 agente real libre + exhibición activa, juega el agente real contra Sofía
      const pool = idlePool.length === 1 ? [idlePool[0], this.guests[1]] : this.guests;
      if (idlePool.length === 1 && this.guests[0]) this.guests[0].group.visible = false;
      else if (this.guests[0]) this.guests[0].group.visible = true;
      this._assignPair(pool);
      return;
    }

    // Sin exhibición y < 2 agentes reales libres
    this._clearGuests();
    if (idlePool.length === 1) {
      const solo = idlePool[0];
      if (this.leftActor || this.rightActor) {
        this._resetMatch();
      }
      this.leftActor = null;
      this.rightActor = null;
      this.juggler = solo;
      if (this.phase !== 'juggling') {
        this.phase = 'juggling';
        this.phaseTime = 0;
        this.playerAnim[-1] = this._freshAnim(-1);
      }
    } else {
      if (this.leftActor || this.rightActor || this.juggler) {
        this._resetMatch();
      }
      this.leftActor = null;
      this.rightActor = null;
      this.juggler = null;
      this.phase = 'idle';
      this.ballVisible = false;
    }
  }

  requestPlayer(actor) {
    if (!actor || actor.data.status !== 'idle') return;
    if (!this.requestedIds.includes(actor.id)) this.requestedIds.unshift(actor.id);
    if (this.requestedIds.length > 2) this.requestedIds.length = 2;
    this.queueSkipId = null;
  }

  removePlayer(actor) {
    if (!actor) return;
    this.requestedIds = this.requestedIds.filter((id) => id !== actor.id);
    if (this.leftActor === actor) {
      this.leftActor = null;
      this._resetMatch();
    }
    if (this.rightActor === actor) {
      this.rightActor = null;
      this._resetMatch();
    }
    if (this.juggler === actor) {
      this.juggler = null;
      this.phase = 'idle';
      this.ballVisible = false;
    }
  }

  _assignPair(pool) {
    this.juggler = null;
    const validIds = new Set(pool.map((a) => a.id));
    this.requestedIds = this.requestedIds.filter((id) => validIds.has(id));

    // Si acaba de terminar un partido, rotar al perdedor si hay retador libre
    if (this._rotateSide) {
      const side = this._rotateSide;
      this._rotateSide = 0;
      const loser = side === -1 ? this.leftActor : this.rightActor;
      if (loser && !loser.isGuest && pool.length >= 3) {
        this.queueSkipId = loser.id;
        if (side === -1) this.leftActor = null;
        else this.rightActor = null;
      }
      this._startNewMatch();
    }

    // Mantener a los jugadores actuales si siguen libres
    if (this.leftActor && !validIds.has(this.leftActor.id)) {
      this.leftActor = null;
      this._resetMatch();
    }
    if (this.rightActor && !validIds.has(this.rightActor.id)) {
      this.rightActor = null;
      this._resetMatch();
    }

    const pickNext = (excludeIds) => {
      const req = this.requestedIds
        .map((id) => pool.find((a) => a.id === id))
        .find((a) => a && !excludeIds.has(a.id));
      if (req) return req;
      const preferred = pool.find((a) => !excludeIds.has(a.id) && a.id !== this.queueSkipId);
      return preferred || pool.find((a) => !excludeIds.has(a.id)) || null;
    };

    const used = new Set();
    if (this.leftActor) used.add(this.leftActor.id);
    if (this.rightActor) used.add(this.rightActor.id);

    if (!this.leftActor) {
      this.leftActor = pickNext(used);
      if (this.leftActor) used.add(this.leftActor.id);
    }
    if (!this.rightActor) {
      this.rightActor = pickNext(used);
      if (this.rightActor) used.add(this.rightActor.id);
    }

    if (this.leftActor && this.rightActor && (this.phase === 'idle' || this.phase === 'juggling')) {
      this._startNewMatch();
    }
  }

  _resetMatch() {
    this.score.left = 0;
    this.score.right = 0;
    this.rally = 0;
    this.winnerSide = 0;
    this.winnerName = '';
    this.lastEventText = '';
    this.shot = null;
    this.ballVisible = false;
    this.phase = 'idle';
    this.phaseTime = 0;
    this.playerAnim[-1] = this._freshAnim(-1);
    this.playerAnim[1] = this._freshAnim(1);
    this._drawScoreboard(true);
  }

  _startNewMatch() {
    this.score.left = 0;
    this.score.right = 0;
    this.rally = 0;
    this.winnerSide = 0;
    this.winnerName = '';
    this.firstServer = this.humanMode ? -1 : (this.firstServer === -1 ? 1 : -1);
    this.server = this.firstServer;
    this.humanServeQueued = false;
    this.humanSwingTimer = 0;
    this.lastEventText = this.humanMode ? 'Tu saque · Haz clic o pulsa Espacio' : 'Nuevo partido · A 5 pts';
    this.phase = 'serve_ready';
    this.phaseTime = 0;
    this.shot = null;
    this.playerAnim[-1] = this._freshAnim(-1);
    this.playerAnim[1] = this._freshAnim(1);
    if (this.humanMode) this.playerAnim[-1].targetZ = this.humanTargetZ;
    this._drawScoreboard(true);
  }

  // ------------------------------------------------ lógica y física de juego
  _computeServer() {
    const total = this.score.left + this.score.right;
    const deuce = this.score.left >= PP_RULES.targetScore - 1 && this.score.right >= PP_RULES.targetScore - 1;
    if (deuce) {
      // En deuce (4-4 en adelante), el saque cambia cada 1 punto
      const deucePts = total - (PP_RULES.targetScore - 1) * 2;
      return deucePts % 2 === 0 ? this.firstServer : -this.firstServer;
    }
    return Math.floor(total / PP_RULES.servesPerTurn) % 2 === 0 ? this.firstServer : -this.firstServer;
  }

  _isDeuce() {
    return this.score.left >= PP_RULES.targetScore - 1 && this.score.right >= PP_RULES.targetScore - 1;
  }

  _playersReadyAtTable() {
    if (!this.leftActor || !this.rightActor) return false;
    const readyA = this.leftActor.isGuest || (this.leftActor.arrived && this.leftActor.target && this.leftActor.target.key === 'pp-left');
    const readyB = this.rightActor.isGuest || (this.rightActor.arrived && this.rightActor.target && this.rightActor.target.key === 'pp-right');
    return readyA && readyB;
  }

  _spawnRipple(x, z) {
    const slot = this._ripples.reduce((best, r) => (r.age > best.age ? r : best), this._ripples[0]);
    slot.age = 0;
    slot.mesh.position.set(x, PP_TABLE.topY + 0.006, z);
    slot.mesh.scale.setScalar(0.35);
    slot.mesh.visible = true;
    slot.mat.opacity = 0.72;
  }

  _triggerStroke(side, type, windupDur, followDur) {
    const st = this.playerAnim[side];
    st.strokeType = type;
    st.strokeActive = true;
    st.windupDur = windupDur;
    st.followDur = followDur;
    st.strokeTimer = -windupDur;
  }

  _chooseStrokeSide(side, ballZ, playerZ) {
    // Izquierda (-1) mira a +X -> su mano derecha está en +Z.
    // Derecha (+1) mira a -X -> su mano derecha está en -Z.
    const forehandOffset = side === -1 ? ballZ - playerZ : playerZ - ballZ;
    return forehandOffset >= -0.06 ? 'forehand' : 'backhand';
  }

  _launchServe() {
    const s = this.server;
    const recv = -s;
    const sAnim = this.playerAnim[s];
    const rAnim = this.playerAnim[recv];

    const startX = PP_TABLE.x + s * (HALF_L + 0.28);
    const startZ = sAnim.z + (s === -1 ? 0.24 : -0.24);
    const startY = PP_TABLE.topY + 0.24;

    // Saque reglamentario: 1er bote en campo propio, cruza la red, 2do bote en campo rival
    const ownBounceX = PP_TABLE.x + s * (0.48 + this._rand() * 0.32);
    const ownBounceZ = clamp(startZ + (this._rand() - 0.5) * 0.25, PP_TABLE.z - HALF_W + 0.22, PP_TABLE.z + HALF_W - 0.22);

    const oppBounceX = PP_TABLE.x + recv * (0.58 + this._rand() * 0.45);
    const oppBounceZ = (this.humanMode && s === -1)
      ? clamp(this.humanAimZ + (this._rand() - 0.5) * 0.16, PP_TABLE.z - HALF_W + 0.16, PP_TABLE.z + HALF_W - 0.16)
      : PP_TABLE.z + (this._rand() - 0.5) * (PP_TABLE.wid * 0.74);

    const strikeX = PP_TABLE.x + recv * (HALF_L + 0.28);
    const strikeZ = clamp(oppBounceZ + (oppBounceZ - ownBounceZ) * 0.32, PP_TABLE.z - HALF_W - 0.12, PP_TABLE.z + HALF_W + 0.12);
    const strikeY = PP_TABLE.topY + 0.28 + this._rand() * 0.1;

    const T0 = 0.18;
    const T1 = 0.34;
    const T2 = 0.26;
    const topY = PP_TABLE.topY + BALL_R;

    this.shot = {
      isServe: true,
      from: s,
      to: recv,
      t: 0,
      segs: [
        { x0: startX, y0: startY, z0: startZ, x1: ownBounceX, y1: topY, z1: ownBounceZ, vy: solveVy(startY, topY, T0), dur: T0, bounce: true },
        { x0: ownBounceX, y0: topY, z0: ownBounceZ, x1: oppBounceX, y1: topY, z1: oppBounceZ, vy: solveVy(topY, topY, T1) + 0.32, dur: T1, bounce: true },
        { x0: oppBounceX, y0: topY, z0: oppBounceZ, x1: strikeX, y1: strikeY, z1: strikeZ, vy: solveVy(topY, strikeY, T2), dur: T2, bounce: false },
      ],
      segIdx: 0,
      segT: 0,
      endX: strikeX,
      endY: strikeY,
      endZ: strikeZ,
      willMiss: false,
      netFault: false,
      isSmash: false,
      recvWindupTriggered: false,
    };

    // El receptor se desplaza de inmediato a interceptar la trayectoria (salvo que sea el jugador humano)
    if (!(this.humanMode && recv === -1)) {
      const stroke = this._chooseStrokeSide(recv, strikeZ, rAnim.z);
      const paddleSideOff = recv === -1 ? (stroke === 'forehand' ? -0.26 : 0.16) : (stroke === 'forehand' ? 0.26 : -0.16);
      rAnim.targetZ = clamp(strikeZ + paddleSideOff, PP_TABLE.z - 0.72, PP_TABLE.z + 0.72);
      rAnim.targetXOff = 0;
    }

    this.rally = 1;
    this.phase = 'rally';
    this.phaseTime = 0;
    this.ballVisible = true;
    this._trailCount = 0;
    this._drawScoreboard();
  }

  _launchReturn(fromSide, isHumanPower = false) {
    const toSide = -fromSide;
    const fAnim = this.playerAnim[fromSide];
    const tAnim = this.playerAnim[toSide];
    const humanHitting = this.humanMode && fromSide === -1;
    const humanReceiving = this.humanMode && toSide === -1;

    const startX = this.ballPos.x;
    const startY = Math.max(this.ballPos.y, PP_TABLE.topY + 0.18);
    const startZ = this.ballPos.z;

    this.rally += 1;
    if (this.rally > this.bestRally) this.bestRally = this.rally;

    // Decidir si este golpe es smash, golpe ganador (fallo del rival) o fallo en red
    const pressure = clamp((this.rally - 2) * 0.085, 0, 0.45);
    const isSmash = humanHitting
      ? Boolean(isHumanPower)
      : (this.rally >= 4 && this._rand() < 0.32);
    const netFault = !humanHitting && !isSmash && this.rally >= 3 && this._rand() < 0.09;
    let willMiss = false;
    if (!netFault && !humanReceiving) {
      if (humanHitting) {
        const npcDist = Math.abs(this.humanAimZ - tAnim.z);
        const missProb = isSmash
          ? 0.48 + clamp(npcDist * 0.32, 0, 0.36)
          : 0.12 + pressure * 0.55 + clamp(npcDist * 0.18, 0, 0.22);
        willMiss = this._rand() < missProb;
      } else {
        willMiss = this.rally >= 3 && this._rand() < (isSmash ? 0.58 : 0.14 + pressure);
      }
    }

    const topY = PP_TABLE.topY + BALL_R;

    if (netFault) {
      // Golpe que toca la cinta de la red y cae en campo propio
      const netZ = clamp(startZ + (this._rand() - 0.5) * 0.5, PP_TABLE.z - HALF_W + 0.18, PP_TABLE.z + HALF_W - 0.18);
      const netY = PP_TABLE.topY + PP_TABLE.netH - 0.01;
      const dropX = PP_TABLE.x + fromSide * 0.28;
      const T1 = 0.25;
      const T2 = 0.28;
      this.shot = {
        isServe: false,
        from: fromSide,
        to: toSide,
        segs: [
          { x0: startX, y0: startY, z0: startZ, x1: PP_TABLE.x, y1: netY, z1: netZ, vy: solveVy(startY, netY, T1), dur: T1, bounce: false },
          { x0: PP_TABLE.x, y0: netY, z0: netZ, x1: dropX, y1: topY, z1: netZ, vy: 0.7, dur: T2, bounce: true },
        ],
        segIdx: 0,
        segT: 0,
        endX: dropX,
        endY: topY,
        endZ: netZ,
        willMiss: true,
        netFault: true,
        isSmash: false,
        recvWindupTriggered: true,
      };
      this._drawScoreboard();
      return;
    }

    // Colocación inteligente: busca el lado opuesto al rival para obligarlo a moverse
    const openSide = tAnim.z >= PP_TABLE.z ? -1 : 1;
    const spread = willMiss ? 0.78 + this._rand() * 0.18 : 0.35 + this._rand() * 0.48;
    const oppBounceZ = humanHitting
      ? clamp(this.humanAimZ + (this._rand() - 0.5) * 0.16, PP_TABLE.z - HALF_W + 0.14, PP_TABLE.z + HALF_W - 0.14)
      : clamp(
          PP_TABLE.z + openSide * HALF_W * spread * (this._rand() < 0.72 ? 1 : -0.7),
          PP_TABLE.z - HALF_W + 0.14,
          PP_TABLE.z + HALF_W - 0.14
        );
    const oppBounceX = PP_TABLE.x + toSide * (isSmash ? 0.75 + this._rand() * 0.35 : 0.46 + this._rand() * 0.55);

    const strikeX = PP_TABLE.x + toSide * (HALF_L + (isSmash ? 0.44 : 0.29));
    const strikeZ = clamp(oppBounceZ + (oppBounceZ - startZ) * 0.24, PP_TABLE.z - HALF_W - 0.28, PP_TABLE.z + HALF_W + 0.28);
    const strikeY = PP_TABLE.topY + (isSmash ? 0.36 : 0.26 + this._rand() * 0.14);

    // Ritmo ligeramente más rápido conforme sube el rally o si es smash
    const pace = clamp(1 - (this.rally - 2) * 0.032, 0.74, 1.0);
    const T1 = (isSmash ? 0.29 : 0.41) * pace;
    const T2 = (isSmash ? 0.2 : 0.28) * pace;

    const segs = [
      { x0: startX, y0: startY, z0: startZ, x1: oppBounceX, y1: topY, z1: oppBounceZ, vy: solveVy(startY, topY, T1) + (isSmash ? 0.08 : 0.26), dur: T1, bounce: true },
      { x0: oppBounceX, y0: topY, z0: oppBounceZ, x1: strikeX, y1: strikeY, z1: strikeZ, vy: solveVy(topY, strikeY, T2), dur: T2, bounce: false },
    ];

    // Si es un golpe ganador (fallo del receptor), la bola continúa más allá de la mesa y bota en el suelo
    if (willMiss) {
      const pastX = strikeX + toSide * 0.95;
      const pastZ = strikeZ + (strikeZ - oppBounceZ) * 0.7;
      const T3 = 0.36;
      segs.push({
        x0: strikeX,
        y0: strikeY,
        z0: strikeZ,
        x1: pastX,
        y1: BALL_R,
        z1: pastZ,
        vy: solveVy(strikeY, BALL_R, T3) * 0.55,
        dur: T3,
        bounce: false,
      });
    }

    this.shot = {
      isServe: false,
      from: fromSide,
      to: toSide,
      segs,
      segIdx: 0,
      segT: 0,
      endX: strikeX,
      endY: strikeY,
      endZ: strikeZ,
      willMiss,
      netFault: false,
      isSmash,
      recvWindupTriggered: false,
    };

    if (humanHitting && isSmash) {
      this.lastEventText = '🔥 ¡Remate potente tuyo!';
    }

    // Desplazamiento atlético del receptor (si no es el jugador humano)
    if (!humanReceiving) {
      const stroke = this._chooseStrokeSide(toSide, strikeZ, tAnim.z);
      const paddleSideOff = toSide === -1 ? (stroke === 'forehand' ? -0.26 : 0.16) : (stroke === 'forehand' ? 0.26 : -0.16);
      const desiredZ = clamp(strikeZ + paddleSideOff, PP_TABLE.z - 0.78, PP_TABLE.z + 0.78);
      tAnim.targetZ = willMiss ? tAnim.z + (desiredZ - tAnim.z) * 0.62 : desiredZ;
      tAnim.targetXOff = isSmash ? toSide * 0.14 : 0;
    }

    // El golpeador vuelve suavemente hacia el centro de la mesa tras golpear (si es IA)
    if (!humanHitting) {
      fAnim.targetZ = PP_TABLE.z + (fAnim.z - PP_TABLE.z) * 0.35;
      fAnim.targetXOff = 0;
    }

    this._drawScoreboard();
  }

  _awardPoint(winnerSide, reasonText) {
    const loserSide = -winnerSide;
    if (winnerSide === -1) this.score.left += 1;
    else this.score.right += 1;

    this.lastScorer = winnerSide;
    this._boardPop = 1;
    this.shot = null;

    const wActor = winnerSide === -1 ? this.leftActor : this.rightActor;
    const wName = wActor ? this.office.displayName(wActor) : winnerSide === -1 ? 'Izquierda' : 'Derecha';

    // Comprobar regla de victoria: >= targetScore y diferencia >= winBy
    const hi = Math.max(this.score.left, this.score.right);
    const diff = Math.abs(this.score.left - this.score.right);
    if (hi >= PP_RULES.targetScore && diff >= PP_RULES.winBy) {
      this.winnerSide = winnerSide;
      this.winnerName = wName;
      if (wActor) this.wins.set(wActor.id, (this.wins.get(wActor.id) || 0) + 1);
      this.lastEventText = `Ganó ${wName} (${this.score.left}–${this.score.right})`;
      this.phase = 'match_over';
      this.phaseTime = 0;
      this.playerAnim[winnerSide].mood = 'win';
      this.playerAnim[winnerSide].moodTime = 0;
      this.playerAnim[loserSide].mood = 'clap';
      this.playerAnim[loserSide].moodTime = 0;
      this.ballVisible = false;
    } else {
      this.lastEventText = this._isDeuce() ? `¡Deuce! ${this.score.left}–${this.score.right}` : reasonText || `Punto para ${wName}`;
      this.phase = 'point_end';
      this.phaseTime = 0;
      this.playerAnim[winnerSide].mood = 'celebrate_pt';
      this.playerAnim[winnerSide].moodTime = 0;
      this.playerAnim[loserSide].mood = 'sad_pt';
      this.playerAnim[loserSide].moodTime = 0;
    }

    if (this.humanMode) {
      this.playerAnim[-1].targetZ = this.humanTargetZ;
    } else {
      this.playerAnim[-1].targetZ = PP_TABLE.z;
    }
    this.playerAnim[1].targetZ = PP_TABLE.z;
    this.playerAnim[-1].targetXOff = 0;
    this.playerAnim[1].targetXOff = 0;
    this._drawScoreboard(true);
  }

  // ------------------------------------------------ actualización por frame
  update(dt) {
    this.time += dt;
    this.phaseTime += dt;
    if (this.humanSwingTimer > 0) {
      this.humanSwingTimer = Math.max(0, this.humanSwingTimer - dt);
    }

    if (this.humanActor) {
      const fp = Boolean(this.humanMode && this.office.firstPersonMode);
      this.humanActor.group.visible = Boolean(this.humanMode && !fp);
      if (this.humanMode) {
        this.playerAnim[-1].z = damp(this.playerAnim[-1].z, this.humanTargetZ, 24, dt);
      }
      if (this.humanActor.group.visible) {
        this.humanActor.spawnScale = damp(this.humanActor.spawnScale, 1, 10, dt);
        this.humanActor.group.scale.setScalar(this.humanActor.spawnScale);
        this.office._pose(this.humanActor, dt, false);
      }
    }
    if (this.fpPaddle) {
      const showFp = Boolean(this.humanMode && this.office.firstPersonMode && this.leftActor && this.rightActor);
      this.fpPaddle.visible = showFp;
      if (showFp) {
        const pz = this.playerAnim[-1].z;
        const lat = pz - PP_TABLE.z;
        let swing = 0;
        if (this.humanSwingTimer > 0.2) {
          swing = Math.sin(clamp((0.55 - this.humanSwingTimer) / 0.35, 0, 1) * Math.PI);
        } else if (this.phase === 'serve_toss' && this.server === -1) {
          swing = Math.sin(clamp(this.phaseTime / 0.48, 0, 1) * Math.PI) * 0.85;
        }
        this.fpPaddle.position.set(
          PP_TABLE.x - HALF_L - 0.16 + swing * 0.34,
          PP_TABLE.topY + 0.22 + swing * 0.09,
          pz
        );
        this.fpPaddle.rotation.set(
          0.22 - swing * 0.55,
          Math.PI / 2 - lat * 0.35,
          -lat * 0.65
        );
      }
    }
    if (this.boardHead) {
      const tgtBoardYaw = this.humanMode && this.office.firstPersonMode ? -0.55 : 0;
      this.boardHead.rotation.y = damp(this.boardHead.rotation.y, tgtBoardYaw, 8, dt);
    }
    if (this.humanCursorMesh) {
      this.humanCursorMesh.visible = Boolean(this.humanMode && this.leftActor && this.rightActor);
      if (this.humanCursorMesh.visible) {
        this.humanCursorMesh.position.z = damp(this.humanCursorMesh.position.z, this.humanTargetZ, 22, dt);
        this.humanCursorMesh.scale.setScalar(this.humanSwingTimer > 0 ? 1.35 : 1.0);
      }
    }

    // Actualizar invitados de exhibición (si existen)
    for (const g of this.guests) {
      if (!g.group.visible) continue;
      g.spawnScale = damp(g.spawnScale, 1, 10, dt);
      g.group.scale.setScalar(g.spawnScale);
      this.office._pose(g, dt, false);
    }

    // Animar ondas de bote sobre el tablero
    for (const r of this._ripples) {
      if (r.age < r.dur) {
        r.age += dt;
        const p = clamp(r.age / r.dur, 0, 1);
        r.mesh.scale.setScalar(0.35 + smoothstep(p) * 2.1);
        r.mat.opacity = (1 - p) * (1 - p) * 0.72;
        if (p >= 1) r.mesh.visible = false;
      }
    }

    // Rebote sutil del marcador 3D al sumar punto
    if (this._boardPop > 0) {
      this._boardPop = Math.max(0, this._boardPop - dt * 3.8);
      const popScale = 1 + Math.sin(this._boardPop * Math.PI) * 0.085;
      this.boardHead.scale.setScalar(popScale);
    } else if (this.boardHead.scale.x !== 1) {
      this.boardHead.scale.setScalar(1);
    }

    // Actualizar timers de golpes / estados de ánimo
    for (const side of [-1, 1]) {
      const st = this.playerAnim[side];
      st.moodTime += dt;
      if (st.strokeActive) {
        st.strokeTimer += dt;
        if (st.strokeTimer >= st.followDur) {
          st.strokeActive = false;
        }
      }
    }

    // Máquina de estados de la partida
    if (this.phase === 'juggling') {
      this._updateJuggling(dt);
    } else if (this.phase === 'serve_ready') {
      if (this._playersReadyAtTable()) {
        const s = this.server;
        const sAnim = this.playerAnim[s];
        if (this.humanMode && s === -1) {
          sAnim.targetZ = this.humanTargetZ;
        }
        // Colocar la pelota en la mano izquierda del sacador
        const handX = PP_TABLE.x + s * (HALF_L + 0.42);
        const handZ = sAnim.z + (s === -1 ? -0.22 : 0.22);
        this.ballPos.set(handX, PP_TABLE.topY + 0.34, handZ);
        this.ballVisible = true;
        const shouldServe = (this.humanMode && s === -1)
          ? this.humanServeQueued
          : this.phaseTime >= 0.52;
        if (shouldServe) {
          this.humanServeQueued = false;
          this.phase = 'serve_toss';
          this.phaseTime = 0;
          this._triggerStroke(s, 'serve', 0.48, 0.34);
          this._drawScoreboard(true);
        }
      } else {
        this.ballVisible = false;
      }
    } else if (this.phase === 'serve_toss') {
      const s = this.server;
      const sAnim = this.playerAnim[s];
      const tossDur = 0.48;
      const u = clamp(this.phaseTime / tossDur, 0, 1);
      // Parábola limpia del lanzamiento vertical con la mano izquierda hacia la raqueta
      const x0 = PP_TABLE.x + s * (HALF_L + 0.42);
      const x1 = PP_TABLE.x + s * (HALF_L + 0.34);
      const z0 = sAnim.z + (s === -1 ? -0.18 : 0.18);
      const z1 = sAnim.z + (s === -1 ? 0.24 : -0.24);
      const yBase = PP_TABLE.topY + 0.32;
      const yArc = Math.sin(u * Math.PI) * 0.46;
      this.ballPos.set(x0 + (x1 - x0) * smoothstep(u), yBase + yArc - u * 0.08, z0 + (z1 - z0) * smoothstep(u));
      this.ballVisible = true;
      if (this.phaseTime >= tossDur) {
        this._launchServe();
      }
    } else if (this.phase === 'rally') {
      this._updateRally(dt);
    } else if (this.phase === 'point_end') {
      if (this.phaseTime > 0.45) this.ballVisible = false;
      if (this.phaseTime >= 1.35) {
        this.server = this._computeServer();
        this.humanServeQueued = false;
        this.playerAnim[-1].mood = 'ready';
        this.playerAnim[1].mood = 'ready';
        if (this.humanMode && this.server === -1) {
          this.lastEventText = 'Tu saque · Haz clic o pulsa Espacio';
        }
        this.phase = 'serve_ready';
        this.phaseTime = 0;
        this._drawScoreboard(true);
      }
    } else if (this.phase === 'match_over') {
      if (this.phaseTime >= 3.2) {
        if (this.humanMode) {
          this._rotateSide = 0;
          this._startNewMatch();
        } else {
          // Regla "el que gana sigue": marcar rotación para el siguiente tick (sin frames vacíos)
          this._rotateSide = -this.winnerSide;
          this.office.markGamesDirty();
          if (this.guests.length && this.exhibition) {
            this._rotateSide = 0;
            this._startNewMatch();
          }
        }
      }
    }

    this._syncBallVisuals();
  }

  _updateJuggling(dt) {
    if (!this.juggler || !this.juggler.arrived) {
      this.ballVisible = false;
      return;
    }
    // Bote rítmico de práctica sobre la raqueta (peloteo solitario)
    const period = 0.62;
    const u = (this.phaseTime % period) / period;
    const yBounce = 4 * u * (1 - u) * 0.44;
    const jx = this.juggler.group.position.x;
    const jz = this.juggler.group.position.z;
    this.ballPos.set(jx + 0.34, 1.0 + yBounce, jz + 0.24);
    this.ballVisible = true;
    this.playerAnim[-1].juggleTap = u < 0.18 ? Math.sin((u / 0.18) * Math.PI) : 0;
  }

  _updateRally(dt) {
    const sh = this.shot;
    if (!sh) return;

    if (this.humanMode) {
      this.playerAnim[-1].targetZ = clamp(this.humanTargetZ, PP_TABLE.z - 0.78, PP_TABLE.z + 0.78);
    }

    // Comprobar si falta poco para que la pelota llegue al punto de golpeo del receptor -> iniciar preparación (windup)
    if (!sh.recvWindupTriggered && !sh.netFault) {
      let remaining = 0;
      const targetSegCount = sh.willMiss ? 2 : sh.segs.length;
      for (let i = sh.segIdx; i < targetSegCount; i++) {
        remaining += i === sh.segIdx ? Math.max(0, sh.segs[i].dur - sh.segT) : sh.segs[i].dur;
      }
      const windupLead = sh.willMiss ? 0.2 : 0.24;
      if (remaining <= windupLead) {
        sh.recvWindupTriggered = true;
        const rAnim = this.playerAnim[sh.to];
        if (this.humanMode && sh.to === -1) {
          if (Math.abs(rAnim.z - sh.endZ) <= 0.56) {
            const stroke = this._chooseStrokeSide(-1, sh.endZ, rAnim.z);
            this._triggerStroke(-1, this.humanSwingTimer > 0 && stroke === 'forehand' ? 'smash' : stroke, windupLead, 0.34);
          }
        } else if (sh.willMiss) {
          rAnim.lungeDir = sh.endZ >= rAnim.z ? 1 : -1;
          this._triggerStroke(sh.to, 'lunge', 0.16, 0.46);
        } else {
          const stroke = this._chooseStrokeSide(sh.to, sh.endZ, rAnim.z);
          const nextSmash = this.rally >= 3 && sh.endY > PP_TABLE.topY + 0.34 && stroke === 'forehand';
          this._triggerStroke(sh.to, nextSmash ? 'smash' : stroke, windupLead, 0.34);
        }
      }
    }

    // Avanzar la pelota en el segmento parabólico actual
    let seg = sh.segs[sh.segIdx];
    sh.segT += dt;
    while (seg && sh.segT >= seg.dur) {
      sh.segT -= seg.dur;
      if (seg.bounce) this._spawnRipple(seg.x1, seg.z1);
      sh.segIdx += 1;
      seg = sh.segs[sh.segIdx];
    }

    if (!seg) {
      // Fin del último segmento
      if (sh.netFault) {
        this._awardPoint(sh.to, 'Red · Punto rival');
      } else if (sh.willMiss) {
        this._awardPoint(sh.from, sh.humanMissed ? '¡No llegaste a la bola!' : sh.isSmash ? '¡Remate ganador!' : '¡Golpe ganador!');
      } else if (this.humanMode && sh.to === -1) {
        const rAnim = this.playerAnim[-1];
        const distZ = Math.min(Math.abs(rAnim.z - sh.endZ), Math.abs(this.humanTargetZ - sh.endZ));
        if (distZ <= 0.6) {
          const last = sh.segs[sh.segs.length - 1];
          this.ballPos.set(last.x1, last.y1, last.z1);
          const power = this.humanSwingTimer > 0;
          this.humanSwingTimer = 0;
          if (!rAnim.strokeActive) {
            const stroke = this._chooseStrokeSide(-1, sh.endZ, rAnim.z);
            this._triggerStroke(-1, power ? 'smash' : stroke, 0.06, 0.32);
          }
          this._launchReturn(-1, power);
        } else {
          // El jugador humano estaba lejos: se estira y la bola pasa de largo al suelo
          sh.willMiss = true;
          sh.humanMissed = true;
          rAnim.lungeDir = sh.endZ >= rAnim.z ? 1 : -1;
          this._triggerStroke(-1, 'lunge', 0.08, 0.42);
          const pastX = sh.endX - 0.92;
          const pastZ = sh.endZ + (sh.endZ - PP_TABLE.z) * 0.45;
          const T3 = 0.32;
          sh.segs.push({
            x0: sh.endX,
            y0: sh.endY,
            z0: sh.endZ,
            x1: pastX,
            y1: BALL_R,
            z1: pastZ,
            vy: solveVy(sh.endY, BALL_R, T3) * 0.55,
            dur: T3,
            bounce: false,
          });
          seg = sh.segs[sh.segIdx];
        }
        if (!seg) return;
      } else {
        // Devolución limpia del receptor
        const last = sh.segs[sh.segs.length - 1];
        this.ballPos.set(last.x1, last.y1, last.z1);
        this._launchReturn(sh.to);
        return;
      }
      if (!seg) return;
    }

    const u = clamp(sh.segT / seg.dur, 0, 1);
    const t = sh.segT;
    const bx = seg.x0 + (seg.x1 - seg.x0) * u;
    const bz = seg.z0 + (seg.z1 - seg.z0) * u;
    const by = Math.max(BALL_R, seg.y0 + seg.vy * t - 0.5 * GRAVITY * t * t);
    this.ballPos.set(bx, by, bz);
  }

  _syncBallVisuals() {
    this.ballMesh.visible = this.ballVisible;
    if (!this.ballVisible) {
      this.ballShadow.visible = false;
      for (const tm of this.trailMeshes) tm.visible = false;
      this._trailCount = 0;
      return;
    }

    this.ballMesh.position.copy(this.ballPos);

    // Sombra proyectada sobre la mesa (si está encima) o sobre el suelo
    const overTable =
      Math.abs(this.ballPos.x - PP_TABLE.x) <= HALF_L + 0.05 &&
      Math.abs(this.ballPos.z - PP_TABLE.z) <= HALF_W + 0.05;
    const surfY = overTable ? PP_TABLE.topY + 0.004 : 0.016;
    const heightAbove = Math.max(0, this.ballPos.y - surfY);
    this.ballShadow.visible = true;
    this.ballShadow.position.set(this.ballPos.x, surfY, this.ballPos.z);
    const shScale = clamp(1.15 - heightAbove * 0.55, 0.45, 1.15);
    this.ballShadow.scale.setScalar(shScale);
    this.ballShadow.material.opacity = clamp(0.32 - heightAbove * 0.2, 0.06, 0.32);

    // Estela de la bola sin asignaciones en heap (ring buffer)
    const showTrail = this.phase === 'rally';
    if (showTrail) {
      const len = this._trailRing.length;
      this._trailHead = (this._trailHead + 1) % len;
      this._trailRing[this._trailHead].copy(this.ballPos);
      if (this._trailCount < len) this._trailCount += 1;
      for (let i = 0; i < this.trailMeshes.length; i++) {
        const tm = this.trailMeshes[i];
        if (i + 1 < this._trailCount) {
          const idx = (this._trailHead - (i + 1) + len) % len;
          tm.visible = true;
          tm.position.copy(this._trailRing[idx]);
        } else {
          tm.visible = false;
        }
      }
    } else {
      for (const tm of this.trailMeshes) tm.visible = false;
      this._trailCount = 0;
    }
  }

  // ----------------------------------------- animaciones atléticas de pose
  poseActor(a, dt) {
    const isLeft = a === this.leftActor;
    const isRight = a === this.rightActor;
    const isJug = a === this.juggler;
    const playing = (isLeft || isRight || isJug) && (a.isGuest || a.arrived);

    // Escala fluida de la raqueta en la mano derecha
    if (a.parts.paddle) {
      const tgtPaddle = playing ? 1 : 0.001;
      a._paddleScale = damp(a._paddleScale || 0.001, tgtPaddle, 14, dt);
      a.parts.paddle.visible = a._paddleScale > 0.04;
      a.parts.paddle.scale.setScalar(a._paddleScale);
    }

    if (!playing) return false;

    const p = a.parts;
    const side = isRight ? 1 : -1;
    const st = this.playerAnim[side];
    const t = this.time + a.phase;
    const baseSpot = this.getPlayerSpot(side);

    // Orientación hacia la mesa
    a.targetYaw = side === -1 ? Math.PI / 2 : -Math.PI / 2;
    a.yaw = a.yaw + (a.targetYaw - a.yaw) * (1 - Math.exp(-12 * dt));
    a.group.rotation.y = a.yaw;

    // Desplazamiento lateral suave por la línea de fondo
    const prevZ = st.z;
    const trackSpeed = st.strokeType === 'lunge' && st.strokeActive ? 7.5 : 10.5;
    st.z = damp(st.z, isJug ? PP_TABLE.z : st.targetZ, trackSpeed, dt);
    st.xOff = damp(st.xOff, isJug ? 0 : st.targetXOff, 8, dt);
    st.vz = dt > 0.0001 ? (st.z - prevZ) / dt : 0;

    a.group.position.x = damp(a.group.position.x, baseSpot.x + st.xOff, 12, dt);
    a.group.position.z = damp(a.group.position.z, st.z, 14, dt);

    // Modo peloteo solitario esperando rival
    if (isJug) {
      this._poseJuggler(a, st, dt, t);
      return true;
    }

    const lateralSpeed = clamp(Math.abs(st.vz) / 2.2, 0, 1);
    const stepOsc = Math.sin(this.time * 16 + side);

    // Postura atlética base de tenis de mesa (rodillas semiflexionadas, tronco atento)
    let bodyY = -0.055 + Math.abs(Math.sin(t * 4.4)) * 0.018 + Math.abs(stepOsc) * 0.03 * lateralSpeed;
    let jumpY = 0;
    let stretchY = 1;
    let torsoX = 0.2;
    let torsoY = 0;
    let torsoZ = clamp(-st.vz * side * 0.05, -0.14, 0.14);

    let thighL = -0.26 + stepOsc * 0.22 * lateralSpeed;
    let thighR = -0.26 - stepOsc * 0.22 * lateralSpeed;
    let shinL = 0.46 + Math.max(0, -stepOsc) * 0.28 * lateralSpeed;
    let shinR = 0.46 + Math.max(0, stepOsc) * 0.28 * lateralSpeed;

    // Brazo derecho con raqueta listo frente al cuerpo, brazo izquierdo equilibrando
    let armRX = -0.58;
    let armRZ = -0.22;
    let elbowRX = -1.12;
    let armLX = -0.44;
    let armLZ = 0.28;
    let elbowLX = -0.82;
    let paddleRotX = Math.PI * 0.55;
    let paddleRotZ = 0;

    // 1. Lanzamiento de saque (mano izquierda lanza la bola)
    if (this.phase === 'serve_ready' && this.server === side) {
      torsoY = -0.35;
      torsoX = 0.22;
      armLX = -0.85;
      armLZ = 0.14;
      elbowLX = -0.7;
      armRX = -0.45;
      armRZ = -0.32;
      elbowRX = -0.95;
    }

    // 2. Golpes cinéticos (Anticipación -> Impacto -> Seguimiento)
    if (st.strokeActive) {
      const w = st.windupDur;
      const f = st.followDur;
      const u = st.strokeTimer;

      if (st.strokeType === 'serve') {
        if (u < 0) {
          const pW = smoothstep(1 + u / w); // 0 -> 1 hasta el impacto
          // Mano izquierda lanza hacia arriba y baja; brazo derecho arma atrás
          const tossLift = Math.sin(pW * Math.PI);
          armLX = -0.95 - tossLift * 0.65;
          elbowLX = -0.45 + tossLift * 0.25;
          torsoY = -0.48 * pW;
          torsoX = 0.24 - tossLift * 0.12;
          armRX = 0.35 * pW - 0.3;
          armRZ = -0.38;
          elbowRX = -0.65;
        } else {
          const pF = smoothstep(u / f);
          const snap = Math.sin(clamp(u / 0.12, 0, 1) * Math.PI * 0.5);
          const rec = 1 - smoothstep((u - 0.12) / Math.max(0.05, f - 0.12));
          torsoY = -0.48 * (1 - snap) + 0.44 * snap * rec;
          torsoX = 0.22 - 0.08 * snap * rec;
          armRX = -0.58 - 0.85 * snap * rec;
          armRZ = -0.22 + 0.45 * snap * rec;
          elbowRX = -1.12 - 0.25 * snap * rec;
          armLX = -0.44 + 0.2 * (1 - pF);
        }
      } else if (st.strokeType === 'forehand' || st.strokeType === 'smash') {
        const isSm = st.strokeType === 'smash';
        const amp = isSm ? 1.32 : 1.0;
        if (u < 0) {
          // Anticipación / preparación (torso rota atrás, brazo derecho abre)
          const pW = smoothstep(1 + u / w);
          torsoY = -0.54 * amp * pW;
          torsoX = 0.24 + (isSm ? -0.14 : 0.08) * pW;
          torsoZ = -0.09 * pW;
          armRX = (-0.35 + (isSm ? -0.85 : 0.72) * pW);
          armRZ = -0.22 - 0.42 * amp * pW;
          elbowRX = isSm ? -1.35 * pW - 0.4 : -0.62;
          armLX = -0.78 * pW - 0.2;
          armLZ = 0.18;
          bodyY -= 0.055 * pW;
        } else {
          // Impacto explosivo + saludo alto de seguimiento (topspin)
          const snap = smoothstep(u / 0.09);
          const rec = 1 - smoothstep((u - 0.14) / Math.max(0.05, f - 0.14));
          const k = snap * rec;
          torsoY = -0.42 * (1 - snap) + 0.56 * amp * k;
          torsoX = 0.18 + (isSm ? 0.18 : -0.06) * k;
          torsoZ = 0.11 * k;
          armRX = -0.58 - (isSm ? 1.15 : 0.92) * k;
          armRZ = -0.22 + 0.58 * k;
          elbowRX = -1.12 - 0.45 * k;
          armLX = -0.25 + 0.35 * k;
          armLZ = 0.45 * k + 0.22;
          paddleRotZ = -0.35 * k;
          if (isSm) jumpY = Math.sin(clamp(u / 0.22, 0, 1) * Math.PI) * 0.14;
        }
      } else if (st.strokeType === 'backhand') {
        if (u < 0) {
          // Preparación de revés: brazo cruza frente al abdomen, hombro cerrado
          const pW = smoothstep(1 + u / w);
          torsoY = 0.36 * pW;
          torsoX = 0.28 * pW + 0.1;
          armRX = -0.74 * pW - 0.2;
          armRZ = 0.44 * pW;
          elbowRX = -1.52 * pW - 0.3;
          paddleRotZ = 0.4 * pW;
          bodyY -= 0.045 * pW;
        } else {
          // Extensión limpia y enérgica de revés hacia fuera y arriba
          const snap = smoothstep(u / 0.09);
          const rec = 1 - smoothstep((u - 0.14) / Math.max(0.05, f - 0.14));
          const k = snap * rec;
          torsoY = 0.32 * (1 - snap) - 0.34 * k;
          torsoX = 0.22 - 0.08 * k;
          armRX = -0.58 - 0.78 * k;
          armRZ = -0.22 - 0.48 * k;
          elbowRX = -1.12 + 0.62 * k;
          paddleRotZ = -0.25 * k;
        }
      } else if (st.strokeType === 'lunge') {
        // Estirada dramática intentando salvar un golpe ganador
        const env = Math.sin(clamp((u + w) / (w + f), 0, 1) * Math.PI);
        const dir = st.lungeDir * -side;
        torsoX = 0.36 * env + 0.15;
        torsoZ = dir * 0.34 * env;
        torsoY = dir * 0.32 * env;
        bodyY -= 0.1 * env;
        thighL = -0.45 * env - 0.2;
        shinL = 0.72 * env + 0.3;
        armRX = -1.35 * env - 0.3;
        armRZ = -0.55 * env;
        elbowRX = -0.25;
        armLX = 0.25 * env;
        armLZ = 0.62 * env;
      }
    }

    // 3. Reacciones al punto y celebración de victoria del partido
    let headX = 0.1;
    let headY = 0;
    let headZ = 0;

    if (st.mood === 'celebrate_pt') {
      const m = st.moodTime;
      const pump = Math.sin(m * 14) * Math.exp(-m * 1.4);
      jumpY = Math.max(jumpY, Math.abs(Math.sin(Math.min(m, 0.55) * Math.PI / 0.55)) * 0.16);
      torsoX = -0.06;
      torsoY = -0.18;
      armRX = -1.65 + pump * 0.35;
      armRZ = -0.35;
      elbowRX = -1.35 + pump * 0.25;
      armLX = -1.35;
      armLZ = 0.32;
      elbowLX = -1.15;
      headX = -0.12;
      headZ = 0.06;
    } else if (st.mood === 'sad_pt') {
      const m = st.moodTime;
      torsoX = 0.18;
      armRX = -0.18;
      armRZ = -0.12;
      elbowRX = -0.4;
      armLX = -0.12;
      armLZ = 0.12;
      elbowLX = -0.35;
      headX = 0.18;
      headY = Math.sin(m * 10) * 0.24 * Math.exp(-m * 1.2);
    } else if (st.mood === 'win') {
      // Gran celebración de campeón del partido con salto elástico y chispas
      const wave = Math.sin(st.moodTime * 7.2);
      jumpY = Math.pow(Math.abs(wave), 0.78) * 0.3;
      stretchY = 1 + (jumpY / 0.3 - 0.35) * 0.13;
      torsoX = -0.1;
      torsoY = Math.sin(st.moodTime * 4.5) * 0.22;
      armRX = -2.75 + Math.sin(st.moodTime * 10) * 0.16;
      armRZ = -0.35;
      elbowRX = -0.25 + Math.sin(st.moodTime * 11) * 0.14;
      armLX = -2.65 + Math.sin(st.moodTime * 10 + 1.1) * 0.16;
      armLZ = 0.35;
      elbowLX = -0.28;
      headX = -0.16;
      headZ = Math.sin(st.moodTime * 5) * 0.08;
    } else if (st.mood === 'clap') {
      // Aplauso deportivo del rival tras terminar el partido
      const cl = Math.abs(Math.sin(st.moodTime * 8.5));
      torsoX = 0.05;
      armRX = -0.78;
      armRZ = 0.18 + cl * 0.16;
      elbowRX = -1.18;
      armLX = -0.78;
      armLZ = -0.18 - cl * 0.16;
      elbowLX = -1.18;
      headX = 0.06 + Math.sin(st.moodTime * 4) * 0.05;
    } else if (this.ballVisible) {
      // Seguimiento de mirada en tiempo real hacia la pelota 3D
      const dx = this.ballPos.x - a.group.position.x;
      const dy = this.ballPos.y - (a.group.position.y + 1.52);
      const dz = this.ballPos.z - a.group.position.z;
      const fwd = side === -1 ? dx : -dx;
      const lat = side === -1 ? -dz : dz;
      headY = clamp(Math.atan2(lat, Math.max(0.4, fwd)) * 0.82 - torsoY * 0.5, -0.58, 0.58);
      headX = clamp(-Math.atan2(dy, Math.max(0.6, Math.hypot(fwd, lat))) * 0.72, -0.38, 0.38);
    }

    // Aplicar amortiguación fluida en cada articulación
    const stretchXZ = 1 / Math.sqrt(stretchY);
    p.body.scale.set(
      damp(p.body.scale.x, stretchXZ, 14, dt),
      damp(p.body.scale.y, stretchY + Math.sin(t * 2.2) * 0.01, 14, dt),
      damp(p.body.scale.z, stretchXZ, 14, dt)
    );
    p.body.position.y = damp(p.body.position.y, bodyY, 16, dt);
    a.group.position.y = damp(a.group.position.y, jumpY, 18, dt);

    const shScale = clamp(1 - a.group.position.y * 1.1, 0.55, 1);
    p.shadow.scale.setScalar(shScale);
    p.shadow.material.opacity = (this.office.theme === 'dark' ? 0.26 : 0.15) * shScale;

    p.thighL.rotation.x = damp(p.thighL.rotation.x, thighL, 16, dt);
    p.thighR.rotation.x = damp(p.thighR.rotation.x, thighR, 16, dt);
    p.shinL.rotation.x = damp(p.shinL.rotation.x, shinL, 16, dt);
    p.shinR.rotation.x = damp(p.shinR.rotation.x, shinR, 16, dt);

    p.torso.rotation.x = damp(p.torso.rotation.x, torsoX, 15, dt);
    p.torso.rotation.y = damp(p.torso.rotation.y, torsoY, 18, dt);
    p.torso.rotation.z = damp(p.torso.rotation.z, torsoZ, 14, dt);

    p.head.rotation.x = damp(p.head.rotation.x, headX, 14, dt);
    p.head.rotation.y = damp(p.head.rotation.y, headY, 14, dt);
    p.head.rotation.z = damp(p.head.rotation.z, headZ, 12, dt);

    p.armR.rotation.x = damp(p.armR.rotation.x, armRX, 20, dt);
    p.armR.rotation.z = damp(p.armR.rotation.z, armRZ, 20, dt);
    p.elbowR.rotation.x = damp(p.elbowR.rotation.x, elbowRX, 22, dt);

    p.armL.rotation.x = damp(p.armL.rotation.x, armLX, 15, dt);
    p.armL.rotation.z = damp(p.armL.rotation.z, armLZ, 15, dt);
    p.elbowL.rotation.x = damp(p.elbowL.rotation.x, elbowLX, 15, dt);

    if (p.paddle) {
      p.paddle.rotation.x = damp(p.paddle.rotation.x, paddleRotX, 18, dt);
      p.paddle.rotation.z = damp(p.paddle.rotation.z, paddleRotZ, 18, dt);
    }

    // Chispas de celebración para el ganador del partido
    if (st.mood === 'win') {
      p.sparks.visible = true;
      const el = st.moodTime;
      const fade = clamp(1 - el / 3.1, 0, 1);
      p.sparks.children.forEach((sp, i) => {
        const ang = (i / 6) * Math.PI * 2 + el * 2.5;
        const rad = 0.3 + Math.sin(el * 3.2 + i) * 0.14 + el * 0.12;
        sp.position.set(Math.cos(ang) * rad, 1.55 + ((el * 0.75 + i * 0.19) % 1.05), Math.sin(ang) * rad);
        sp.scale.setScalar(0.8 + Math.sin(el * 9 + i) * 0.25);
      });
      p.sparks.children[0].material.color.setHex(0xfbbf24);
      p.sparks.children[0].material.opacity = fade * 0.95;
    } else if (p.sparks.visible) {
      p.sparks.visible = false;
    }

    const exprMood =
      st.mood === 'win' || st.mood === 'celebrate_pt'
        ? 'excited'
        : st.mood === 'sad_pt'
          ? 'sad'
          : st.mood === 'clap'
            ? 'happy'
            : st.strokeActive && st.strokeType === 'lunge'
              ? 'surprised'
              : 'focused';

    this.office._finishActivityPose(a, dt, t, exprMood);
    return true;
  }

  _poseJuggler(a, st, dt, t) {
    const p = a.parts;
    const tap = st.juggleTap || 0;
    p.body.position.y = damp(p.body.position.y, tap * 0.018, 14, dt);
    a.group.position.y = damp(a.group.position.y, 0, 14, dt);
    p.thighL.rotation.x = damp(p.thighL.rotation.x, -0.08, 12, dt);
    p.thighR.rotation.x = damp(p.thighR.rotation.x, -0.08, 12, dt);
    p.shinL.rotation.x = damp(p.shinL.rotation.x, 0.14, 12, dt);
    p.shinR.rotation.x = damp(p.shinR.rotation.x, 0.14, 12, dt);

    p.torso.rotation.x = damp(p.torso.rotation.x, 0.08, 10, dt);
    p.torso.rotation.y = damp(p.torso.rotation.y, Math.sin(t * 0.8) * 0.06, 10, dt);
    p.torso.rotation.z = damp(p.torso.rotation.z, Math.sin(t * 1.1) * 0.025, 10, dt);

    // Raqueta plana hacia arriba golpeando suavemente la pelota en el aire
    p.armR.rotation.x = damp(p.armR.rotation.x, -0.45 - tap * 0.12, 18, dt);
    p.armR.rotation.z = damp(p.armR.rotation.z, -0.1, 14, dt);
    p.elbowR.rotation.x = damp(p.elbowR.rotation.x, -1.12 - tap * 0.22, 22, dt);
    if (p.paddle) {
      p.paddle.rotation.x = damp(p.paddle.rotation.x, 0.04, 16, dt);
      p.paddle.rotation.z = damp(p.paddle.rotation.z, Math.PI, 16, dt);
    }

    p.armL.rotation.x = damp(p.armL.rotation.x, Math.sin(t * 1.2) * 0.06, 10, dt);
    p.armL.rotation.z = damp(p.armL.rotation.z, 0.14, 10, dt);
    p.elbowL.rotation.x = damp(p.elbowL.rotation.x, -0.26, 10, dt);

    // Cabeza sigue el bote vertical de la pelota
    const lookUp = clamp((this.ballPos.y - 1.22) * -0.45, -0.22, 0.25);
    p.head.rotation.x = damp(p.head.rotation.x, lookUp, 14, dt);
    p.head.rotation.y = damp(p.head.rotation.y, -0.16, 10, dt);
    p.head.rotation.z = damp(p.head.rotation.z, 0.04, 10, dt);

    this.office._finishActivityPose(a, dt, t, 'happy');
  }

  _updateCommonAccessories(a, dt, t) {
    const p = a.parts;
    // Parpadeo natural
    a.blinkTimer -= dt;
    if (a.blinkTimer <= 0) {
      a.blinkAmt = 1;
      a.blinkTimer = 2.6 + (this._rand() * 2.8);
    }
    if (a.blinkAmt > 0) a.blinkAmt = Math.max(0, a.blinkAmt - dt * 7.2);
    const eyeSY = 1 - (a.blinkAmt > 0 ? Math.sin(a.blinkAmt * Math.PI) : 0) * 0.88;
    p.eyeL.scale.y = eyeSY;
    p.eyeR.scale.y = eyeSY;

    // Baliza suave (oculta en invitados para mayor limpieza)
    p.beaconGroup.visible = !a.isGuest;
    if (!a.isGuest) {
      p.beaconGroup.position.y = damp(p.beaconGroup.position.y, 2.16 + Math.sin(t * 2.2) * 0.04, 12, dt);
      p.beacon.rotation.y += dt * 1.2;
      p.beaconHalo.rotation.z += dt * 0.9;
    }

    // Etiqueta y anillo
    const isSel = this.office.selectedId === a.id;
    const isHov = this.office.hoveredId === a.id;
    const showLabel = this.office.labelMode !== 'hidden' || isSel || isHov;
    a.label.sprite.visible = showLabel && !a.isGuest;
    if (a.label.sprite.visible) {
      a.label.sprite.position.y = damp(a.label.sprite.position.y, 2.58, 12, dt);
      a.label.sprite.material.opacity = damp(a.label.sprite.material.opacity, isSel || isHov ? 1 : 0.9, 10, dt);
    }
    const targetRingAlpha = isSel ? 0.88 : isHov ? 0.42 : 0;
    a.ringAlpha = damp(a.ringAlpha, targetRingAlpha, 12, dt);
    const showRing = a.ringAlpha > 0.015;
    p.ring.visible = showRing;
    p.ringOuter.visible = isSel && showRing;
    if (showRing) {
      p.ring.material.opacity = a.ringAlpha;
      p.ringOuter.material.opacity = a.ringAlpha * 0.38;
    }
  }

  // ------------------------------------------------ marcador 3D de pista
  _drawScoreboard(force = false) {
    const lName = this.leftActor ? this.office.displayName(this.leftActor) : 'Libre';
    const rName = this.rightActor ? this.office.displayName(this.rightActor) : 'Libre';
    const lCol = this.leftActor ? this.leftActor.role : 0x64748b;
    const rCol = this.rightActor ? this.rightActor.role : 0x64748b;
    const active = Boolean(this.leftActor && this.rightActor);
    const deuce = active && this._isDeuce();

    const key = `${lName}|${rName}|${lCol}|${rCol}|${this.score.left}|${this.score.right}|${this.server}|${this.phase}|${this.rally}|${this.office.theme}`;
    if (!force && key === this._boardKey) return;
    this._boardKey = key;
    if (this.office.bumpGamesVersion) this.office.bumpGamesVersion();

    const ctx = this.boardCanvas.getContext('2d');
    const W = 640;
    const H = 300;
    const dark = this.office.theme === 'dark';

    ctx.fillStyle = dark ? '#0f172a' : '#131d2b';
    ctx.fillRect(0, 0, W, H);

    // Barra superior
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, W, 56);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 22px "Instrument Sans", system-ui, sans-serif';
    ctx.fillText('PING-PONG · A 5 PTS (DIF. 2)', 24, 36);

    // Indicador de fase a la derecha
    const pillTxt =
      this.phase === 'match_over'
        ? 'GANADOR'
        : deuce
          ? 'DEUCE'
          : active
            ? `RALLY ×${this.rally}`
            : this.phase === 'juggling'
              ? 'PRÁCTICA'
              : 'MESA LIBRE';
    const pillCol =
      this.phase === 'match_over'
        ? '#10b981'
        : deuce
          ? '#f59e0b'
          : active
            ? '#3b82f6'
            : '#64748b';
    roundRectPath(ctx, W - 180, 12, 158, 34, 17);
    ctx.fillStyle = pillCol;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 18px "Instrument Sans", system-ui, sans-serif';
    const tw = ctx.measureText(pillTxt).width;
    ctx.fillText(pillTxt, W - 180 + Math.max(12, (158 - tw) / 2), 35);

    const fit = (text, maxW) => {
      let s = String(text);
      if (ctx.measureText(s).width <= maxW) return s;
      while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      return s + '…';
    };

    const drawSide = (x0, name, col, pts, isServing, isWinner) => {
      roundRectPath(ctx, x0, 72, 286, 170, 20);
      ctx.fillStyle = isWinner ? 'rgba(16,185,129,0.22)' : 'rgba(255,255,255,0.05)';
      ctx.fill();
      if (isWinner) {
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      // Punto de color del jugador
      ctx.fillStyle = cssHex(col);
      ctx.beginPath();
      ctx.arc(x0 + 28, 104, 11, 0, Math.PI * 2);
      ctx.fill();

      // Nombre
      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 26px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText(fit(name, 195), x0 + 50, 113);

      // Pelotita de saque activo
      if (active && isServing && this.phase !== 'match_over') {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(x0 + 260, 104, 8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Marcador grande
      ctx.fillStyle = isWinner ? '#34d399' : '#ffffff';
      ctx.font = '700 106px "Instrument Sans", system-ui, sans-serif';
      const stxt = String(pts);
      const sw = ctx.measureText(stxt).width;
      ctx.fillText(stxt, x0 + (286 - sw) / 2, 224);
    };

    drawSide(22, lName, lCol, this.score.left, this.server === -1, this.winnerSide === -1);
    drawSide(332, rName, rCol, this.score.right, this.server === 1, this.winnerSide === 1);

    // Pie de estado
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 20px "Instrument Sans", system-ui, sans-serif';
    const foot =
      this.phase === 'match_over'
        ? `🏆 ${this.lastEventText}`
        : active
          ? this.lastEventText || 'Saque cambia cada 2 pts · 1 en deuce'
          : this.phase === 'juggling'
            ? `${this.office.displayName(this.juggler)} practica esperando rival…`
            : 'Los agentes libres juegan automáticamente aquí';
    ctx.fillText(fit(foot, W - 48), 24, 280);

    this.boardTex.needsUpdate = true;
  }

  // --------------------------------------------------- estado para la UI HUD
  getState() {
    const active = Boolean(this.leftActor && this.rightActor);
    const makeP = (actor, side) =>
      actor
        ? {
            id: actor.id,
            name: this.office.displayName(actor),
            color: actor.role,
            score: side === -1 ? this.score.left : this.score.right,
            wins: this.wins.get(actor.id) || 0,
            serving: active && this.server === side && this.phase !== 'match_over',
            winner: this.winnerSide === side && this.phase === 'match_over',
            isGuest: Boolean(actor.isGuest),
          }
        : null;

    return {
      phase: this.phase,
      active,
      exhibition: this.exhibition,
      humanMode: this.humanMode,
      deuce: active && this._isDeuce(),
      rally: this.rally,
      bestRally: this.bestRally,
      winnerName: this.phase === 'match_over' ? this.winnerName : '',
      lastEvent: this.lastEventText,
      jugglerName: this.juggler ? this.office.displayName(this.juggler) : '',
      left: makeP(this.leftActor, -1),
      right: makeP(this.rightActor, 1),
      rules: PP_RULES,
    };
  }
}

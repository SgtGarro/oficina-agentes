// Escena 3D de la oficina.
// Recibe THREE por parámetro (así se puede probar sin navegador) y no usa el DOM
// salvo para crear canvas de etiquetas/texturas, que también se puede inyectar.
//
// Idea de diseño: una maqueta arquitectónica limpia, luminosa y serena.
// Superficies neutras suaves, madera escandinava clara y color vivo en cada
// personaje según su rol. Las animaciones están amortiguadas de forma continua
// para que caminar, sentarse, teclear, pensar, avisar y celebrar se sientan
// fluidos y naturales.

// ---- Valores fáciles de ajustar --------------------------------------------
import { PingPongArena, PP_TABLE } from './pingpong.js';
import { BilliardsArena, POOL_TABLE } from './billiards.js';
import { DartsArena, DARTS_ZONE } from './darts.js';

const LIGHT = { hemi: 1.35, sun: 1.75, fill: 0.45, ambient: 0.18 };
const WALK_SPEED = 2.85; // unidades por segundo

export const STATUS_COLOR = { working: 0x3b82f6, idle: 0x94a3b8, waiting: 0xf59e0b, done: 0x10b981, error: 0xef4444 };
export const STATUS_LABEL = { working: 'Trabajando', idle: 'Libre', waiting: 'Necesita tu atención', done: 'Terminó', error: 'Error' };

const MAIN_COLOR = 0x4f5ee8;
const ANTIGRAVITY_COLOR = 0x06b6d4;
const ROLE_COLORS = [0x14b8a6, 0xf59e0b, 0x8b5cf6, 0xf43f5e, 0x0ea5e9, 0x22c55e, 0xea580c, 0x64748b];
const SKINS = [0xf4cfb0, 0xe0ac82, 0xc3835a, 0x925e3e, 0xf8dcc4];
const HAIRS = [0x2a211b, 0x523724, 0x1d1e24, 0x8f6234, 0x9ca3af];

const THEMES = {
  light: {
    sky: 0xe4ecf2,
    fog: 0xe4ecf2,
    hemi: LIGHT.hemi,
    hemiSky: 0xf8fbff,
    hemiGround: 0xc2ced8,
    sun: LIGHT.sun,
    sunColor: 0xfff4e4,
    fill: LIGHT.fill,
    fillColor: 0xd9e9ff,
    ambient: LIGHT.ambient,
    windowGlass: 0xdbf0fb,
    lampGlow: 0.15,
  },
  dark: {
    sky: 0x121923,
    fog: 0x121923,
    hemi: 0.65,
    hemiSky: 0x8eb4db,
    hemiGround: 0x222d3a,
    sun: 0.95,
    sunColor: 0xffd7b0,
    fill: 0.55,
    fillColor: 0x6085bc,
    ambient: 0.14,
    windowGlass: 0x223854,
    lampGlow: 1.0,
  },
};

const C = {
  sky: THEMES.light.sky,
  wallBack: 0xf3f5f7,
  wallSide: 0xe9eef2,
  wallCap: 0xffffff,
  floorBase: 0x8795a1,
  floorTrim: 0xdbe3e9,
  carpet: '#d2dbe2',
  planks: '#e4d0b2',
  wood: 0xe4cca8,
  woodDark: 0xc29e74,
  metal: 0x475569,
  metalLight: 0x94a3b8,
  white: 0xf8fafc,
  pants: 0x2b3643,
  shoe: 0x1e252d,
  green: 0x5d9b6b,
  greenLight: 0x7cb684,
  greenDark: 0x437c52,
  glass: 0xbce0f2,
  deskMat: 0x36414f,
};

// ---- Distribución -----------------------------------------------------------
const CORRIDOR_Z = 6.2;
const DESK_COLS = [-9.5, -6, -2.5, 1];
const DESK_ROWS = [-5, -1, 3];
const LANE_OFFSET = 1.75;
const SEAT_DZ = 0.95;
const SPAWN = { x: -11.3, z: CORRIDOR_Z };
const LOUNGE_X = 4;
const SPOTS = [
  [5.35, 0.25], [11.0, 0.25], [5.35, 4.4],
  [11.0, 4.4], [11.05, -2.05], [8.1, 4.75],
  [5.4, -6.1], [9.15, -6.1], [11.1, -3.5],
];
const SIT_DROP = 0.34;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const cssHex = (n) => '#' + n.toString(16).padStart(6, '0');
const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
const dampAngle = (cur, target, lambda, dt) => cur + wrapAngle(target - cur) * (1 - Math.exp(-lambda * dt));

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

export function colorFor(d) {
  if (d.kind === 'main') {
    if (d.provider === 'antigravity' || d.type === 'antigravity') return ANTIGRAVITY_COLOR;
    return MAIN_COLOR;
  }
  return ROLE_COLORS[hash(String(d.type || d.name)) % ROLE_COLORS.length];
}

export class Office {
  constructor(THREE, opts = {}) {
    this.THREE = THREE;
    this.makeCanvas = opts.makeCanvas || (() => document.createElement('canvas'));
    this.scene = new THREE.Scene();
    this.theme = 'light';
    this.labelMode = 'full'; // 'full' | 'compact' | 'hidden'
    this.scene.background = new THREE.Color(THEMES.light.sky);
    this.scene.fog = new THREE.Fog(THEMES.light.fog, 40, 88);
    this.time = 0;
    this.actors = new Map();
    this.desks = [];
    this.spots = SPOTS.map(([x, z], i) => ({ index: i, x, z, owner: null }));
    this.selectedId = null;
    this.hoveredId = null;
    this._matCache = new Map();
    this._geoCache = new Map();
    this._boardKey = '';
    this._boardStats = { working: 0, waiting: 0, idle: 0, tools: 0 };
    this._windowMat = null;
    this._lampMats = [];
    this._lampLight = null;
    this._doorSlide = 0;
    this._tmpColor = new THREE.Color();
    this._tmpColor2 = new THREE.Color();
    this._pickBox = new THREE.Box3();
    this._pickHit = new THREE.Vector3();
    this._gamesDirty = true;
    this._gamesVersion = 1;
    this.firstPersonMode = true;
    this._atmoSettled = true;
    this._nowMs = Date.now();
    this._rng = 1234567;
    this._instancedStatic = [];

    this._buildLights();
    this._buildShell();
    this._buildDesks();
    this._buildLounge();
    this._buildDecor();
    this._buildBoard();
    this.pingPong = new PingPongArena(this);
    this.billiards = new BilliardsArena(this);
    this.darts = new DartsArena(this);
    this._optimizeStaticScene();
  }

  // ------------------------------------------------------------ utilidades
  _mat(color, o = {}) {
    const key = `${color}|${o.rough ?? 0.8}|${o.metal ?? 0}|${o.opacity ?? 1}|${o.emissive ?? 0}|${o.emissiveIntensity ?? 0}`;
    let m = this._matCache.get(key);
    if (!m) {
      const T = this.THREE;
      m = new T.MeshStandardMaterial({
        color,
        roughness: o.rough ?? 0.8,
        metalness: o.metal ?? 0,
        emissive: o.emissive ?? 0x000000,
        emissiveIntensity: o.emissiveIntensity ?? 0,
      });
      if (o.opacity !== undefined && o.opacity < 1) {
        m.transparent = true;
        m.opacity = o.opacity;
        m.depthWrite = false;
      }
      this._matCache.set(key, m);
    }
    return m;
  }

  _geo(key, make) {
    let g = this._geoCache.get(key);
    if (!g) {
      g = make();
      this._geoCache.set(key, g);
    }
    return g;
  }

  _mesh(geometry, material, x, y, z, parent, o = {}) {
    const T = this.THREE;
    const m = new T.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = o.cast !== false;
    m.receiveShadow = o.receive !== false;
    (parent || this.scene).add(m);
    return m;
  }

  _box(w, h, d, color, x, y, z, parent, o = {}) {
    const T = this.THREE;
    const m = this._mesh(this._geo('unitBox', () => new T.BoxGeometry(1, 1, 1)), this._mat(color, o), x, y, z, parent, o);
    m.scale.set(w, h, d);
    return m;
  }

  _cyl(rt, rb, h, color, x, y, z, parent, o = {}) {
    const T = this.THREE;
    const seg = o.seg || 20;
    return this._mesh(this._geo(`c${rt},${rb},${h},${seg}`, () => new T.CylinderGeometry(rt, rb, h, seg)), this._mat(color, o), x, y, z, parent, o);
  }

  _sphere(r, color, x, y, z, parent, o = {}) {
    const T = this.THREE;
    const seg = o.seg || 18;
    return this._mesh(this._geo(`s${r},${seg}`, () => new T.SphereGeometry(r, seg, Math.max(10, Math.round(seg * 0.75)))), this._mat(color, o), x, y, z, parent, o);
  }

  _capsule(r, len, color, x, y, z, parent, o = {}) {
    const T = this.THREE;
    const cap = o.cap || 8;
    const rad = o.rad || 14;
    return this._mesh(this._geo(`cap${r},${len},${cap},${rad}`, () => new T.CapsuleGeometry(r, len, cap, rad)), this._mat(color, o), x, y, z, parent, o);
  }

  _texture(w, h, repeatX, repeatY, draw) {
    const T = this.THREE;
    const c = this.makeCanvas();
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  // ---------------------------------------------------------------- luces
  _buildLights() {
    const T = this.THREE;
    this._hemi = new T.HemisphereLight(THEMES.light.hemiSky, THEMES.light.hemiGround, THEMES.light.hemi);
    this.scene.add(this._hemi);

    this._ambient = new T.AmbientLight(0xffffff, THEMES.light.ambient);
    this.scene.add(this._ambient);

    const sun = new T.DirectionalLight(THEMES.light.sunColor, THEMES.light.sun);
    sun.position.set(10, 21, 13);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.radius = 2;
    const s = sun.shadow.camera;
    s.left = -16.5;
    s.right = 16.5;
    s.top = 14.5;
    s.bottom = -14.5;
    s.near = 2;
    s.far = 55;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this._sun = sun;

    const fill = new T.DirectionalLight(THEMES.light.fillColor, THEMES.light.fill);
    fill.position.set(-12, 11, -8);
    this.scene.add(fill);
    this._fill = fill;
  }

  // ---------------------------------------------------------- estructura
  _buildShell() {
    const T = this.THREE;
    // Plataforma arquitectónica con bisel limpio
    this._box(25.2, 0.54, 17.2, C.floorBase, 0, -0.42, 0, null, { cast: false, rough: 0.9 });
    this._box(24.6, 0.14, 16.6, C.floorTrim, 0, -0.08, 0, null, { cast: false, rough: 0.78 });

    // Moqueta arquitectónica suave (zona de trabajo)
    const carpet = this._texture(256, 256, 8, 8, (ctx, w, h) => {
      ctx.fillStyle = C.carpet;
      ctx.fillRect(0, 0, w, h);
      // Trama textil muy sutil
      for (let i = 0; i < 240; i++) {
        const px = (i * 73) % w;
        const py = (i * 139) % h;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(71,85,105,0.05)';
        ctx.fillRect(px, py, 3, 2);
      }
      ctx.strokeStyle = 'rgba(71,85,105,0.075)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);
    });
    const carpetMesh = new T.Mesh(new T.PlaneGeometry(16, 16), new T.MeshStandardMaterial({ map: carpet, roughness: 0.94 }));
    carpetMesh.rotation.x = -Math.PI / 2;
    carpetMesh.position.set(-4, 0.003, 0);
    carpetMesh.receiveShadow = true;
    this.scene.add(carpetMesh);

    // Parquet escandinavo de roble claro (zona de descanso)
    const planks = this._texture(256, 256, 3, 4, (ctx, w, h) => {
      const tones = ['#e6d3b6', '#dfcaaa', '#e9d8be', '#dcc6a5'];
      const rows = 4;
      const rh = h / rows;
      for (let r = 0; r < rows; r++) {
        const y = r * rh;
        ctx.fillStyle = tones[r % tones.length];
        ctx.fillRect(0, y, w, rh);
        // Veta muy sutil
        ctx.fillStyle = 'rgba(160,122,74,0.055)';
        ctx.fillRect(0, y + rh * 0.25, w, 3);
        ctx.fillRect(0, y + rh * 0.68, w, 2);
        // Junta vertical escalonada
        const jx = ((r * 96 + 48) % w);
        ctx.fillStyle = 'rgba(138,105,64,0.16)';
        ctx.fillRect(jx, y, 2, rh);
        // Junta horizontal limpia
        ctx.fillStyle = 'rgba(138,105,64,0.16)';
        ctx.fillRect(0, y, w, 2);
      }
    });
    const planksMesh = new T.Mesh(new T.PlaneGeometry(8, 16), new T.MeshStandardMaterial({ map: planks, roughness: 0.68 }));
    planksMesh.rotation.x = -Math.PI / 2;
    planksMesh.position.set(8, 0.003, 0);
    planksMesh.receiveShadow = true;
    this.scene.add(planksMesh);

    // Perfil metálico de transición entre moqueta y madera
    this._box(0.08, 0.014, 16, C.metalLight, LOUNGE_X, 0.007, 0, null, { cast: false, rough: 0.35, metal: 0.5 });

    // Paredes limpias (fondo e izquierda abiertas en corte arquitectónico)
    this._box(24.8, 6.0, 0.4, C.wallBack, 0, 3, -8.2, null, { cast: false, rough: 0.9 });
    this._box(0.4, 6.0, 16.8, C.wallSide, -12.2, 3, 0, null, { cast: false, rough: 0.9 });
    // Remate superior arquitectónico
    this._box(24.88, 0.1, 0.48, C.wallCap, 0, 6.04, -8.2, null, { cast: false, rough: 0.6 });
    this._box(0.48, 0.1, 16.88, C.wallCap, -12.2, 6.04, 0, null, { cast: false, rough: 0.6 });
    // Rodapiés
    this._box(24.4, 0.16, 0.07, 0xd8dfe6, 0, 0.08, -7.96, null, { cast: false, rough: 0.7 });
    this._box(0.07, 0.16, 16.0, 0xcfd7df, -11.96, 0.08, 0, null, { cast: false, rough: 0.7 });

    // Ventanas industriales estilo loft Silicon Valley (marcos negro mate + alféizar de roble)
    const wMat = new T.MeshBasicMaterial({ color: THEMES.light.windowGlass });
    wMat.toneMapped = false;
    this._windowMat = wMat;
    for (const x of [-8.5, -3.5, 1.5, 7.6]) {
      this._box(3.16, 2.52, 0.14, 0x1e293b, x, 3.78, -7.96, null, { cast: false, rough: 0.45, metal: 0.35 });
      this._box(3.32, 0.08, 0.24, C.wood, x, 2.5, -7.88, null, { cast: false, rough: 0.58 });
      this._mesh(this._geo('winGlass', () => new T.PlaneGeometry(2.9, 2.24)), wMat, x, 3.78, -7.88, null, { cast: false, receive: false });
      const sheen = this._mesh(
        this._geo('winSheen', () => new T.PlaneGeometry(0.45, 2.15)),
        this._mat(0xffffff, { opacity: 0.22, rough: 0.1 }),
        x - 0.55,
        3.78,
        -7.872,
        null,
        { cast: false, receive: false }
      );
      sheen.rotation.z = -0.24;
      // Perfiles finos de acero negro tipo loft
      for (const mx of [-0.95, 0, 0.95]) {
        this._box(0.04, 2.24, 0.055, 0x1e293b, x + mx, 3.78, -7.85, null, { cast: false, rough: 0.45, metal: 0.4 });
      }
      this._box(2.9, 0.04, 0.055, 0x1e293b, x, 3.78, -7.85, null, { cast: false, rough: 0.45, metal: 0.4 });
    }

    // Puerta corredera arquitectónica moderna (pared izquierda)
    this._box(0.14, 3.65, 2.28, 0x1e293b, -11.96, 1.825, CORRIDOR_Z, null, { cast: false, rough: 0.45, metal: 0.35 });
    this._box(0.08, 3.44, 1.94, 0xdbe3ea, -12.02, 1.72, CORRIDOR_Z, null, { cast: false, rough: 0.92 });
    this._box(0.12, 0.08, 4.1, 0x1e293b, -11.86, 3.66, CORRIDOR_Z - 0.85, null, { cast: false, rough: 0.35, metal: 0.55 });

    const doorPanel = new T.Group();
    doorPanel.userData.dynamic = true;
    doorPanel.position.set(-11.84, 0, CORRIDOR_Z);
    this.scene.add(doorPanel);
    this._box(0.08, 3.46, 1.94, 0xa8865e, 0, 1.73, 0, doorPanel, { cast: true, rough: 0.62 });
    this._box(0.095, 2.2, 0.34, 0x1e293b, 0, 1.95, -0.42, doorPanel, { cast: false, rough: 0.45 });
    const doorGlass = this._mat(C.glass, { opacity: 0.45, rough: 0.12 });
    this._mesh(new T.BoxGeometry(0.105, 2.06, 0.24), doorGlass, 0, 1.95, -0.42, doorPanel, { cast: false });
    this._box(0.11, 0.52, 0.045, 0xe2e8f0, 0.03, 1.62, 0.72, doorPanel, { cast: false, rough: 0.25, metal: 0.7 });
    this._doorPanel = doorPanel;

    // Felpudo limpio de entrada
    this._box(1.5, 0.025, 0.95, 0x334155, -10.88, 0.014, CORRIDOR_Z, null, { cast: false, rough: 0.95 });

    // Mampara de cristal industrial Silicon Valley (acero negro + franja esmerilada)
    const glassMat = this._mat(C.glass, { opacity: 0.18, rough: 0.08, metal: 0.05 });
    const frostMat = this._mat(0xf8fafc, { opacity: 0.26, rough: 0.45 });
    this._mesh(new T.BoxGeometry(0.045, 1.72, 9.6), glassMat, LOUNGE_X, 0.88, -3.2, null, { cast: false });
    this._mesh(new T.BoxGeometry(0.052, 0.38, 9.56), frostMat, LOUNGE_X, 1.02, -3.2, null, { cast: false });
    this._box(0.085, 0.06, 9.66, 0x1e293b, LOUNGE_X, 1.76, -3.2, null, { cast: false, rough: 0.4, metal: 0.5 });
    this._box(0.085, 0.06, 9.66, 0x1e293b, LOUNGE_X, 0.03, -3.2, null, { cast: false, rough: 0.4, metal: 0.5 });
    for (const pz of [-7.95, -5.55, -3.15, -0.75, 1.6]) {
      this._box(0.075, 1.74, 0.06, 0x1e293b, LOUNGE_X, 0.89, pz, null, { cast: false, rough: 0.4, metal: 0.5 });
    }
  }

  // ---------------------------------------------------------- escritorios
  _buildDesks() {
    const T = this.THREE;
    // Textura de pantalla con código nítido y barra superior moderna
    this.screenTex = this._texture(256, 160, 1, 1, (ctx, w, h) => {
      ctx.fillStyle = '#0d1626';
      ctx.fillRect(0, 0, w, h);
      // Barra lateral sutil tipo editor
      ctx.fillStyle = '#132036';
      ctx.fillRect(0, 0, 34, h);
      const cols = ['#60a5fa', '#5eead4', '#c4b5fd', '#93c5fd', '#fcd34d'];
      let y = 10;
      let i = 0;
      while (y < h - 6) {
        // Número de línea tenue
        ctx.fillStyle = 'rgba(148,163,184,0.35)';
        ctx.fillRect(10, y + 1, 12, 4);
        const indent = (i % 4) * 14;
        const len = 36 + ((i * 59) % 120);
        ctx.fillStyle = cols[i % cols.length];
        roundRectPath(ctx, 44 + indent, y, Math.min(len, w - 54 - indent), 6, 3);
        ctx.fill();
        if (i % 3 === 1 && 44 + indent + len + 26 < w - 12) {
          ctx.fillStyle = cols[(i + 2) % cols.length];
          roundRectPath(ctx, 44 + indent + len + 8, y, 22, 6, 3);
          ctx.fill();
        }
        y += 14;
        i += 1;
      }
    });

    const mugPalette = [0xf8fafc, 0x60a5fa, 0x34d399, 0xfbbf24, 0xf472b6, 0xa78bfa];

    let idx = 0;
    for (const z of DESK_ROWS) {
      for (const x of DESK_COLS) {
        const g = new T.Group();
        g.position.set(x, 0, z);
        this.scene.add(g);

        // Tablero principal de madera clara con marco inferior limpio
        this._box(2.4, 0.075, 1.2, C.wood, 0, 0.78, 0, g, { rough: 0.62 });
        this._box(2.26, 0.04, 1.06, C.metal, 0, 0.725, 0, g, { rough: 0.45, metal: 0.4, cast: false });
        // Patas cilíndricas estilizadas con travesaños
        for (const [lx, lz] of [[-1.08, -0.48], [1.08, -0.48], [-1.08, 0.48], [1.08, 0.48]]) {
          this._cyl(0.036, 0.03, 0.72, C.metal, lx, 0.36, lz, g, { seg: 12, rough: 0.4, metal: 0.5 });
        }
        this._box(0.04, 0.04, 0.96, C.metal, -1.08, 0.14, 0, g, { rough: 0.4, metal: 0.5, cast: false });
        this._box(0.04, 0.04, 0.96, C.metal, 1.08, 0.14, 0, g, { rough: 0.4, metal: 0.5, cast: false });
        // Panel trasero de privacidad en tono madera cálido
        this._box(2.18, 0.34, 0.035, C.woodDark, 0, 0.54, -0.5, g, { rough: 0.72, cast: false });

        // Alfombrilla de fieltro para teclado y ratón
        this._box(1.18, 0.01, 0.46, C.deskMat, 0.05, 0.822, 0.18, g, { cast: false, rough: 0.92 });

        // Monitor ultrafino moderno
        this._box(1.1, 0.66, 0.035, 0x1e293b, 0, 1.28, -0.33, g, { rough: 0.38, metal: 0.25 });
        const screenMat = new T.MeshBasicMaterial({ map: this.screenTex, color: 0x1e293b });
        screenMat.toneMapped = false;
        const screenMesh = this._mesh(this._geo('screen', () => new T.PlaneGeometry(1.03, 0.59)), screenMat, 0, 1.28, -0.31, g, { cast: false, receive: false });
        screenMesh.userData.dynamic = true;

        // Brillo sutil de la pantalla proyectado sobre el escritorio
        const glowMat = new T.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0, depthWrite: false });
        glowMat.toneMapped = false;
        const glow = this._mesh(this._geo('screenGlow', () => new T.PlaneGeometry(1.15, 0.56)), glowMat, 0, 0.832, -0.02, g, { cast: false, receive: false });
        glow.rotation.x = -Math.PI / 2;
        glow.visible = false;
        glow.userData.dynamic = true;

        // Peana de aluminio limpia
        this._box(0.085, 0.3, 0.045, C.metalLight, 0, 0.99, -0.34, g, { rough: 0.3, metal: 0.65, cast: false });
        this._box(0.42, 0.018, 0.24, C.metalLight, 0, 0.828, -0.27, g, { rough: 0.3, metal: 0.65, cast: false });

        // Teclado compacto + ratón ergonómico
        this._box(0.64, 0.022, 0.2, 0xeef2f6, -0.08, 0.838, 0.18, g, { rough: 0.55, cast: false });
        this._capsule(0.038, 0.04, 0xeef2f6, 0.42, 0.84, 0.19, g, { rough: 0.45, cast: false }).rotation.x = Math.PI / 2;

        // Pequeño detalle limpio alterno (taza o mini libreta / macetita)
        const side = idx % 2 === 0 ? 1 : -1;
        const mugColor = mugPalette[idx % mugPalette.length];
        const mugX = side * 0.86;
        this._cyl(0.055, 0.05, 0.1, mugColor, mugX, 0.868, 0.06, g, { seg: 14, rough: 0.35, cast: false });
        this._cyl(0.044, 0.044, 0.01, 0x4b3222, mugX, 0.916, 0.06, g, { seg: 12, cast: false, rough: 0.4 });
        if (idx % 3 === 0) {
          // Mini suculenta de escritorio en el lado opuesto
          this._cyl(0.07, 0.055, 0.1, 0xe2e8f0, -side * 0.88, 0.868, -0.22, g, { seg: 12, rough: 0.7, cast: false });
          this._sphere(0.075, C.greenLight, -side * 0.88, 0.955, -0.22, g, { seg: 12, cast: false });
        } else {
          // Cuaderno limpio con bolígrafo
          this._box(0.24, 0.018, 0.32, 0xf8fafc, -side * 0.86, 0.828, 0.12, g, { cast: false, rough: 0.75 });
          this._box(0.24, 0.02, 0.035, ROLE_COLORS[idx % ROLE_COLORS.length], -side * 0.86, 0.829, -0.02, g, { cast: false, rough: 0.6 });
        }

        // Silla ergonómica moderna (respaldo hacia +z; el personaje mira hacia -z)
        const seatZ = z + SEAT_DZ;
        const chair = new T.Group();
        chair.position.set(x, 0, seatZ + 0.05);
        this.scene.add(chair);
        // Base elegante de 5 radios (geometría ligera y limpia)
        this._cyl(0.036, 0.036, 0.27, C.metal, 0, 0.16, 0, chair, { seg: 10, rough: 0.35, metal: 0.6, cast: false });
        this._cyl(0.06, 0.27, 0.055, C.metal, 0, 0.04, 0, chair, { seg: 5, rough: 0.35, metal: 0.6, cast: false });
        // Asiento y respaldo acolchado con bordes suaves
        const chairUpper = new T.Group();
        chairUpper.userData.dynamic = true;
        chair.add(chairUpper);
        this._cyl(0.32, 0.3, 0.085, 0x334155, 0, 0.33, 0, chairUpper, { seg: 20, rough: 0.78 });
        this._box(0.54, 0.56, 0.075, 0x334155, 0, 0.72, 0.28, chairUpper, { rough: 0.78 });
        // Remate superior suave del respaldo
        const topPad = this._capsule(0.04, 0.46, 0x3f4e63, 0, 1.0, 0.28, chairUpper, { rough: 0.75, cast: false });
        topPad.rotation.z = Math.PI / 2;
        // Reposabrazos minimalistas
        for (const sx of [-0.31, 0.31]) {
          this._box(0.04, 0.2, 0.04, C.metal, sx, 0.45, 0.05, chairUpper, { rough: 0.4, metal: 0.5, cast: false });
          this._box(0.06, 0.035, 0.26, 0x3f4e63, sx, 0.56, 0.02, chairUpper, { rough: 0.7, cast: false });
        }

        this.desks.push({
          index: idx,
          x,
          z,
          seatX: x,
          seatZ,
          laneX: x + LANE_OFFSET,
          screenMat,
          glowMat,
          glowMesh: glow,
          chairUpper,
          owner: null,
          _darkSettled: false,
        });
        idx += 1;
      }
    }
  }

  // ----------------------------------------- sala Silicon Valley & Chill Hub
  _buildLounge() {
    const T = this.THREE;
    // Alfombra tejida bajo la zona de sofá y pufs
    const rugTex = this._texture(256, 256, 1, 1, (ctx, w, h) => {
      ctx.fillStyle = '#6d9994';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.43, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(30,41,59,0.08)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.31, 0, Math.PI * 2);
      ctx.stroke();
    });
    const rug = new T.Mesh(new T.CircleGeometry(2.15, 48), new T.MeshStandardMaterial({ map: rugTex, roughness: 0.96 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(7.15, 0.012, -5.85);
    rug.receiveShadow = true;
    this.scene.add(rug);

    // Sofá mid-century Silicon Valley con cojines de acento
    const sofa = new T.Group();
    sofa.position.set(7.15, 0, -7.1);
    this.scene.add(sofa);
    for (const [lx, lz] of [[-1.35, -0.38], [1.35, -0.38], [-1.35, 0.38], [1.35, 0.38]]) {
      this._cyl(0.036, 0.025, 0.16, C.woodDark, lx, 0.08, lz, sofa, { seg: 10 });
    }
    this._box(3.0, 0.3, 0.98, 0x3d5c6c, 0, 0.29, 0, sofa, { rough: 0.88 });
    this._box(3.0, 0.78, 0.26, 0x3d5c6c, 0, 0.69, -0.39, sofa, { rough: 0.88 });
    for (const sx of [-1.4, 1.4]) {
      this._box(0.24, 0.58, 0.98, 0x334f5e, sx, 0.46, 0, sofa, { rough: 0.88 });
      const armTop = this._capsule(0.12, 0.74, 0x334f5e, sx, 0.74, 0, sofa, { rough: 0.85 });
      armTop.rotation.x = Math.PI / 2;
    }
    for (const sx of [-0.64, 0.64]) {
      this._box(1.24, 0.17, 0.76, 0x527687, sx, 0.52, 0.05, sofa, { rough: 0.9 });
      this._box(1.2, 0.42, 0.17, 0x527687, sx, 0.8, -0.2, sofa, { rough: 0.9 });
    }
    const pillow1 = this._box(0.38, 0.34, 0.13, 0xe07a5f, -0.98, 0.78, -0.04, sofa, { rough: 0.92 });
    pillow1.rotation.set(-0.18, 0.32, 0.12);
    const pillow2 = this._box(0.38, 0.34, 0.13, 0xf2b950, 0.98, 0.78, -0.04, sofa, { rough: 0.92 });
    pillow2.rotation.set(-0.18, -0.28, -0.1);

    // Mesita redonda de roble + 2 pufs (beanbags) estilo startup Silicon Valley
    this._cyl(0.68, 0.66, 0.06, C.wood, 7.15, 0.44, -5.35, null, { seg: 32, rough: 0.58 });
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2 + 0.4;
      const leg = this._cyl(0.028, 0.02, 0.44, C.woodDark, 7.15 + Math.sin(ang) * 0.32, 0.21, -5.35 + Math.cos(ang) * 0.32, null, { seg: 10 });
      leg.rotation.z = -Math.sin(ang) * 0.18;
      leg.rotation.x = Math.cos(ang) * 0.18;
    }
    this._cyl(0.055, 0.048, 0.11, 0xf59e0b, 6.92, 0.52, -5.26, null, { seg: 12, rough: 0.35, cast: false });
    this._cyl(0.055, 0.048, 0.11, 0xf8fafc, 7.4, 0.52, -5.44, null, { seg: 12, rough: 0.35, cast: false });

    // Pufs ergonómicos de startup
    const bean1 = this._sphere(0.42, 0xe8a849, 5.45, 0.26, -5.45, null, { seg: 18, rough: 0.92 });
    bean1.scale.set(1.1, 0.68, 1.05);
    const bean2 = this._sphere(0.4, 0x628f85, 8.8, 0.25, -5.4, null, { seg: 18, rough: 0.92 });
    bean2.scale.set(1.08, 0.66, 1.05);

    // Lámpara de pie cálida junto al sofá
    this._cyl(0.22, 0.22, 0.035, 0x1e293b, 4.95, 0.02, -7.1, null, { seg: 18, rough: 0.35, metal: 0.6, cast: false });
    this._cyl(0.022, 0.022, 2.15, 0x1e293b, 4.95, 1.09, -7.1, null, { seg: 12, rough: 0.35, metal: 0.6, cast: false });
    const shadeMat = new T.MeshStandardMaterial({
      color: 0xfbf7ef,
      roughness: 0.7,
      emissive: 0xffd18c,
      emissiveIntensity: THEMES.light.lampGlow,
    });
    this._lampMats.push(shadeMat);
    this._mesh(new T.CylinderGeometry(0.18, 0.3, 0.42, 24), shadeMat, 4.95, 2.25, -7.1, null, { cast: false });
    const lampLight = new T.PointLight(0xffcf88, 0, 9.5, 1.8);
    lampLight.position.set(4.95, 2.1, -7.1);
    lampLight.visible = false;
    this.scene.add(lampLight);
    this._lampLight = lampLight;

    // Barra Silicon Valley de Espresso, Matcha y Cold-Brew (junto a la mampara de cristal)
    const bar = new T.Group();
    bar.position.set(4.56, 0, -4.15);
    this.scene.add(bar);
    this._box(0.76, 0.98, 2.15, C.wood, 0, 0.49, 0, bar, { rough: 0.65 });
    this._box(0.84, 0.06, 2.22, C.white, 0, 1.01, 0, bar, { rough: 0.4 });
    // Cafetera espresso profesional
    this._box(0.42, 0.46, 0.56, 0x1e293b, -0.04, 1.27, -0.58, bar, { rough: 0.35, metal: 0.38 });
    this._box(0.44, 0.06, 0.58, C.metalLight, -0.04, 1.07, -0.58, bar, { rough: 0.25, metal: 0.72 });
    const ledMat = new T.MeshBasicMaterial({ color: 0x34d399 });
    ledMat.toneMapped = false;
    this._mesh(new T.SphereGeometry(0.022, 8, 8), ledMat, 0.18, 1.38, -0.42, bar, { cast: false });
    // Dispensador doble de Cold-Brew / Kombucha en acero cepillado
    this._box(0.14, 0.38, 0.26, C.metalLight, -0.02, 1.23, 0.18, bar, { rough: 0.22, metal: 0.78 });
    for (const tz of [0.11, 0.25]) {
      this._box(0.14, 0.035, 0.035, 0x1e293b, 0.1, 1.34, tz, bar, { cast: false, rough: 0.3, metal: 0.6 });
    }
    // Campana de cristal con bollería y tazas apiladas
    const domeMat = this._mat(0xffffff, { opacity: 0.32, rough: 0.12 });
    this._cyl(0.19, 0.19, 0.025, C.woodDark, 0.04, 1.055, 0.74, bar, { seg: 16, cast: false });
    this._mesh(new T.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), domeMat, 0.04, 1.06, 0.74, bar, { cast: false });
    this._sphere(0.065, 0xd99b52, 0.04, 1.11, 0.74, bar, { seg: 10, cast: false });
    this._cyl(0.055, 0.048, 0.11, 0xf8fafc, 0.12, 1.09, -0.08, bar, { seg: 12, rough: 0.35, cast: false });
    this._cyl(0.055, 0.048, 0.11, 0x60a5fa, 0.14, 1.09, 0.42, bar, { seg: 12, rough: 0.35, cast: false });

    // Pared de listones acústicos de roble + cartel luminoso LED estilo Silicon Valley ("AGENT LAB")
    for (let i = 0; i < 12; i++) {
      this._box(0.075, 2.55, 0.055, C.woodDark, 4.32 + i * 0.16, 2.75, -7.96, null, { cast: false, rough: 0.72 });
    }
    const neonTex = this._texture(512, 128, 1, 1, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      roundRectPath(ctx, 14, 18, w - 28, h - 36, 22);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
      ctx.fill();
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.fillStyle = '#e0e7ff';
      ctx.font = '700 56px "Instrument Sans", system-ui, sans-serif';
      const txt = 'AGENT LAB';
      ctx.fillText(txt, (w - ctx.measureText(txt).width) / 2, 83);
    });
    const neonMat = new T.MeshBasicMaterial({ map: neonTex, transparent: true });
    neonMat.toneMapped = false;
    this._mesh(new T.PlaneGeometry(1.78, 0.46), neonMat, 5.18, 2.85, -7.91, null, { cast: false, receive: false });

    // Tablero Kanban de sprints estilo startup en pared izquierda junto al tablero principal
    const kanbanTex = this._texture(384, 280, 1, 1, (ctx, w, h) => {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#0f172a';
      ctx.font = '700 26px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText('Sprint actual', 22, 40);
      const cols = ['#e2e8f0', '#dbeafe', '#d1fae5'];
      const notes = [
        ['#fde68a', '#fed7aa', '#bfdbfe'],
        ['#93c5fd', '#c4b5fd'],
        ['#86efac', '#6ee7b7', '#a7f3d0'],
      ];
      cols.forEach((bg, ci) => {
        const cx = 20 + ci * 118;
        roundRectPath(ctx, cx, 58, 108, 204, 10);
        ctx.fillStyle = bg;
        ctx.fill();
        notes[ci].forEach((nc, ni) => {
          roundRectPath(ctx, cx + 10, 72 + ni * 58, 88, 46, 6);
          ctx.fillStyle = nc;
          ctx.fill();
          ctx.fillStyle = 'rgba(15,23,42,0.28)';
          ctx.fillRect(cx + 18, 86 + ni * 58, 56, 6);
          ctx.fillRect(cx + 18, 98 + ni * 58, 38, 5);
        });
      });
    });
    this._box(0.06, 1.85, 2.48, 0x1e293b, -11.96, 3.1, 2.05, null, { cast: false, rough: 0.45 });
    const kMat = new T.MeshBasicMaterial({ map: kanbanTex });
    kMat.toneMapped = false;
    const kPlane = this._mesh(new T.PlaneGeometry(2.36, 1.73), kMat, -11.915, 3.1, 2.05, null, { cast: false, receive: false });
    kPlane.rotation.y = Math.PI / 2;
  }

  // ------------------------------------------------------------ decorado
  _plant(x, z, s = 1) {
    // Maceta cerámica mate + tierra + follaje orgánico en 3 tonos armoniosos
    this._cyl(0.32 * s, 0.24 * s, 0.52 * s, 0xf1ede6, x, 0.26 * s, z, null, { seg: 20, rough: 0.72 });
    this._cyl(0.28 * s, 0.28 * s, 0.03 * s, 0x5c4738, x, 0.51 * s, z, null, { seg: 16, cast: false });
    const leafGeo = this._geo('unitSphere16', () => new this.THREE.SphereGeometry(1, 16, 12));
    const leaves = [
      [0, 0.88, 0, 0.38, C.green],
      [0.21, 1.14, 0.11, 0.29, C.greenLight],
      [-0.2, 1.06, -0.12, 0.31, C.greenDark],
      [0.06, 1.32, -0.05, 0.24, C.greenLight],
      [-0.14, 0.84, 0.18, 0.24, C.green],
    ];
    for (const [dx, dy, dz, r, col] of leaves) {
      const m = this._mesh(leafGeo, this._mat(col, { rough: 0.85 }), x + dx * s, dy * s, z + dz * s, null, {});
      m.scale.setScalar(r * s);
    }
  }

  _buildDecor() {
    this._plant(-11.2, -7.2, 1.12);
    this._plant(3.35, -7.2, 1.08);
    this._plant(9.2, -7.35, 0.95);
    this._plant(4.55, 1.25, 0.96);
    this._plant(-11.2, 3.5, 0.92);

    // Estanterías abiertas minimalistas bajo las ventanas (libros y objetos bien visibles)
    const bookCols = [0x3b82f6, 0x14b8a6, 0xf59e0b, 0x6366f1, 0xe2e8f0, 0x8b5cf6, 0x64748b, 0xe07a5f];
    let k = 0;
    for (const x of [-10.2, -5.2, -0.2]) {
      // Fondo delgado + laterales + base y tapa superior de madera clara
      this._box(2.56, 1.98, 0.04, 0xe9eef2, x, 1.0, -7.93, null, { cast: false, rough: 0.85 });
      this._box(0.05, 1.98, 0.36, C.white, x - 1.26, 1.0, -7.75, null, { rough: 0.7 });
      this._box(0.05, 1.98, 0.36, C.white, x + 1.26, 1.0, -7.75, null, { rough: 0.7 });
      this._box(2.56, 0.05, 0.36, C.wood, x, 0.04, -7.75, null, { cast: false, rough: 0.65 });
      this._box(2.6, 0.06, 0.38, C.wood, x, 2.0, -7.74, null, { rough: 0.62 });
      for (const y of [0.52, 1.02, 1.52]) {
        this._box(2.48, 0.045, 0.34, C.wood, x, y, -7.75, null, { cast: false, rough: 0.65 });
        let bx = x - 1.1;
        for (let i = 0; i < 9; i++) {
          if ((k + i) % 7 === 0) {
            // Espacio respirable o cajita cerámica decorativa
            this._cyl(0.065, 0.055, 0.14, 0xf8fafc, bx + 0.08, y + 0.095, -7.73, null, { seg: 10, cast: false, rough: 0.5 });
            bx += 0.22;
            continue;
          }
          const w = 0.1 + ((k * 7 + i * 3) % 4) * 0.028;
          const h = 0.25 + ((k * 5 + i * 2) % 3) * 0.055;
          if (bx + w > x + 1.12) break;
          this._box(w, h, 0.23, bookCols[(k + i) % bookCols.length], bx + w / 2, y + 0.024 + h / 2, -7.73, null, { cast: false, rough: 0.72 });
          bx += w + 0.045;
        }
        k += 1;
      }
    }
  }

  // ---------------------------------------------- tablero de la pared
  _buildBoard() {
    const T = this.THREE;
    // Marco minimalista con sombra suave
    this._box(0.07, 2.52, 6.26, 0xe2e8f0, -11.96, 3.1, -3, null, { cast: false, rough: 0.5 });
    this.boardCanvas = this.makeCanvas();
    this.boardCanvas.width = 1200;
    this.boardCanvas.height = 460;
    this.boardTex = new T.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = T.SRGBColorSpace;
    this.boardTex.anisotropy = 4;
    const mat = new T.MeshBasicMaterial({ map: this.boardTex });
    mat.toneMapped = false;
    const plane = new T.Mesh(new T.PlaneGeometry(6.08, 2.34), mat);
    plane.rotation.y = Math.PI / 2;
    plane.position.set(-11.915, 3.1, -3);
    this.scene.add(plane);
    this._drawBoard(0, 0, 0, 0, true);
  }

  _drawBoard(working, waiting, idle, tools, force = false) {
    this._boardStats = { working, waiting, idle, tools };
    const key = `${working}|${waiting}|${idle}|${tools}|${this.theme}`;
    if (!force && key === this._boardKey) return;
    this._boardKey = key;

    const ctx = this.boardCanvas.getContext('2d');
    const W = 1200;
    const H = 460;
    const dark = this.theme === 'dark';

    ctx.fillStyle = dark ? '#182230' : '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Encabezado limpio
    ctx.fillStyle = dark ? '#e8eef5' : '#0f172a';
    ctx.font = '700 44px "Instrument Sans", system-ui, sans-serif';
    ctx.fillText('La oficina ahora', 52, 82);

    // Insignia "EN VIVO"
    roundRectPath(ctx, W - 210, 42, 158, 48, 24);
    ctx.fillStyle = dark ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.12)';
    ctx.fill();
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(W - 178, 66, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 26px "Instrument Sans", system-ui, sans-serif';
    ctx.fillText('En vivo', W - 156, 75);

    // 4 tarjetas limpias de métricas
    const cols = [
      [working, 'Trabajando', STATUS_COLOR.working, dark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.08)'],
      [waiting, 'Esperándote', STATUS_COLOR.waiting, dark ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.09)'],
      [idle, 'Libres', STATUS_COLOR.idle, dark ? 'rgba(148,163,184,0.14)' : 'rgba(148,163,184,0.12)'],
      [tools, 'Acciones', dark ? 0xe2e8f0 : 0x0f172a, dark ? 'rgba(226,232,240,0.08)' : 'rgba(15,23,42,0.05)'],
    ];
    const cardW = 256;
    const cardH = 290;
    const gap = 24;
    cols.forEach(([n, label, col, tint], i) => {
      const x = 52 + i * (cardW + gap);
      const y = 122;
      roundRectPath(ctx, x, y, cardW, cardH, 26);
      ctx.fillStyle = tint;
      ctx.fill();
      ctx.fillStyle = cssHex(col);
      ctx.font = '700 132px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText(String(n), x + 28, y + 178);
      ctx.fillStyle = dark ? '#94a3b8' : '#475569';
      ctx.font = '600 32px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText(label, x + 30, y + 246);
    });
    this.boardTex.needsUpdate = true;
  }

  _updateBoard(list) {
    let working = 0;
    let waiting = 0;
    let idle = 0;
    let tools = 0;
    for (const d of list) {
      if (d.status === 'working') working++;
      else if (d.status === 'waiting') waiting++;
      else if (d.status === 'idle') idle++;
      tools += d.toolCount || 0;
    }
    this._drawBoard(working, waiting, idle, tools);
  }

  // ---------------------------------------------------------- personajes
  _makeActor(d) {
    const T = this.THREE;
    const h = hash(d.id);
    const role = colorFor(d);
    const g = new T.Group();
    g.userData.agentId = d.id;

    // Sombra suave de contacto bajo los pies
    const shadowMat = new T.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.16, depthWrite: false });
    const shadow = new T.Mesh(this._geo('contactShadow', () => new T.CircleGeometry(0.36, 24)), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    shadow.raycast = () => {};
    g.add(shadow);

    const body = new T.Group();
    g.add(body);

    const shirt = new T.MeshStandardMaterial({ color: role, roughness: 0.62 });
    const skin = new T.MeshStandardMaterial({ color: SKINS[h % SKINS.length], roughness: 0.72 });
    const hairM = new T.MeshStandardMaterial({ color: HAIRS[(h >>> 3) % HAIRS.length], roughness: 0.82 });
    const pants = this._mat(C.pants, { rough: 0.8 });
    const shoe = this._mat(C.shoe, { rough: 0.65 });
    const sole = this._mat(0xf1f5f9, { rough: 0.75 });
    const collar = this._mat(0xf8fafc, { rough: 0.7 });
    const eyeMat = this._mat(0x111827, { rough: 0.25 });
    const blushMat = this._mat(0xf08a8a, { opacity: 0.35, rough: 0.9 });

    // Cadera / tronco articulado (para respiración, inclinación y giro natural)
    const torso = new T.Group();
    torso.position.set(0, 0.82, 0);
    body.add(torso);

    // Silueta de torso suave y redondeada (sin aristas duras)
    this._mesh(this._geo('torsoCore', () => new T.CylinderGeometry(0.19, 0.225, 0.44, 18)), shirt, 0, 0.27, 0, torso);
    this._mesh(this._geo('torsoShoulders', () => new T.SphereGeometry(0.195, 18, 12)), shirt, 0, 0.48, 0, torso).scale.set(1.12, 0.62, 0.92);
    this._mesh(this._geo('torsoPelvis', () => new T.SphereGeometry(0.225, 18, 10)), pants, 0, 0.025, 0, torso).scale.set(1.04, 0.6, 0.94);
    // Cuello de camiseta limpio
    this._mesh(this._geo('collarRing', () => new T.TorusGeometry(0.088, 0.022, 8, 18)), collar, 0, 0.565, 0.01, torso, { cast: false }).rotation.x = Math.PI / 2;

    // Cabeza con cuello y rasgos expresivos
    const head = new T.Group();
    head.position.set(0, 0.62, 0);
    torso.add(head);
    this._mesh(this._geo('neck', () => new T.CylinderGeometry(0.068, 0.075, 0.1, 12)), skin, 0, 0.02, 0, head);
    this._mesh(this._geo('headSphere', () => new T.SphereGeometry(0.205, 22, 18)), skin, 0, 0.21, 0, head);

    // Estilos de cabello limpios y variados por personaje
    const hairStyle = (h >>> 6) % 4;
    this._mesh(this._geo('hairCap', () => new T.SphereGeometry(0.218, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.52)), hairM, 0, 0.225, -0.015, head);
    if (hairStyle === 0) {
      // Flequillo suave
      const fringe = this._mesh(this._geo('hairFringe', () => new T.CapsuleGeometry(0.055, 0.14, 6, 10)), hairM, 0, 0.34, 0.125, head);
      fringe.rotation.z = Math.PI / 2 - 0.15;
    } else if (hairStyle === 1) {
      // Media melena redondeada atrás
      this._mesh(this._geo('hairBack', () => new T.SphereGeometry(0.18, 16, 12)), hairM, 0, 0.14, -0.09, head).scale.set(1.12, 0.95, 0.85);
    } else if (hairStyle === 2) {
      // Tupé limpio moderno
      const quiff = this._mesh(this._geo('hairQuiff', () => new T.SphereGeometry(0.11, 14, 10)), hairM, 0.03, 0.4, 0.06, head);
      quiff.scale.set(1.3, 0.72, 1.05);
    } else {
      // Moño minimalista atrás
      this._mesh(this._geo('hairBun', () => new T.SphereGeometry(0.088, 14, 10)), hairM, 0, 0.34, -0.19, head);
    }

    // Rasgos expresivos dinámicos: ojos, cejas, boca curva, boca abierta y rubor
    const eyeL = this._mesh(this._geo('eye', () => new T.SphereGeometry(0.025, 10, 10)), eyeMat, 0.072, 0.21, 0.188, head, { cast: false });
    const eyeR = this._mesh(this._geo('eye', () => new T.SphereGeometry(0.025, 10, 10)), eyeMat, -0.072, 0.21, 0.188, head, { cast: false });

    const browGeo = this._geo('brow', () => new T.CapsuleGeometry(0.009, 0.036, 4, 8));
    const browL = this._mesh(browGeo, hairM, 0.072, 0.258, 0.186, head, { cast: false });
    browL.rotation.z = Math.PI / 2;
    const browR = this._mesh(browGeo, hairM, -0.072, 0.258, 0.186, head, { cast: false });
    browR.rotation.z = Math.PI / 2;

    // Boca curva expresiva (sonrisa / neutral / ceño) + boca abierta (sorpresa / risa)
    const mouthMat = this._mat(0x1e293b, { rough: 0.4 });
    const mouthArc = this._mesh(
      this._geo('mouthArc', () => new T.TorusGeometry(0.038, 0.0085, 6, 14, Math.PI)),
      mouthMat,
      0,
      0.16,
      0.193,
      head,
      { cast: false }
    );
    mouthArc.rotation.z = Math.PI; // arco hacia abajo = sonrisa
    const mouthOpen = this._mesh(this._geo('mouthOpen', () => new T.SphereGeometry(0.024, 10, 8)), mouthMat, 0, 0.145, 0.192, head, { cast: false });
    mouthOpen.scale.set(0.001, 0.001, 0.4);

    const blushMatLocal = new T.MeshStandardMaterial({ color: 0xf47280, transparent: true, opacity: 0.28, roughness: 0.9, depthWrite: false });
    const blushL = this._mesh(this._geo('blush', () => new T.CircleGeometry(0.032, 12)), blushMatLocal, 0.115, 0.165, 0.175, head, { cast: false, receive: false });
    blushL.rotation.y = 0.45;
    const blushR = this._mesh(this._geo('blush', () => new T.CircleGeometry(0.032, 12)), blushMatLocal, -0.115, 0.165, 0.175, head, { cast: false, receive: false });
    blushR.rotation.y = -0.45;

    // Gafas minimalistas para algunos roles / hashes (aporta personalidad limpia)
    const hasGlasses = d.type === 'planificador' || d.type === 'revisor' || d.type === 'arquitecto' || (h % 5 === 0);
    if (hasGlasses) {
      const frameMat = this._mat(0x1e293b, { rough: 0.3, metal: 0.4 });
      for (const sx of [-1, 1]) {
        this._mesh(this._geo('glassLens', () => new T.TorusGeometry(0.046, 0.008, 8, 18)), frameMat, sx * 0.072, 0.21, 0.205, head, { cast: false });
      }
      this._mesh(this._geo('glassBridge', () => new T.BoxGeometry(0.052, 0.012, 0.012)), frameMat, 0, 0.215, 0.206, head, { cast: false });
    }

    // Brazos articulados con hombro + manga limpia + codo + antebrazo + mano suave
    const makeArm = (side) => {
      const arm = new T.Group();
      arm.position.set(side * 0.275, 0.49, 0);
      torso.add(arm);
      this._mesh(this._geo('shoulderCap', () => new T.SphereGeometry(0.068, 12, 10)), shirt, 0, 0, 0, arm);
      this._mesh(this._geo('upperArmCap', () => new T.CapsuleGeometry(0.056, 0.16, 6, 12)), shirt, 0, -0.13, 0, arm);
      this._mesh(this._geo('sleeveCuff', () => new T.TorusGeometry(0.055, 0.012, 6, 14)), shirt, 0, -0.22, 0, arm, { cast: false }).rotation.x = Math.PI / 2;

      const elbow = new T.Group();
      elbow.position.set(0, -0.25, 0);
      arm.add(elbow);
      this._mesh(this._geo('forearmCap', () => new T.CapsuleGeometry(0.047, 0.155, 6, 12)), skin, 0, -0.115, 0, elbow);
      this._mesh(this._geo('handSphere', () => new T.SphereGeometry(0.056, 12, 10)), skin, 0, -0.24, 0, elbow);
      return { arm, elbow };
    };

    // Piernas articuladas suaves con cápsulas (sin cortes ni huecos al caminar o sentarse)
    const makeLeg = (side) => {
      const thigh = new T.Group();
      thigh.position.set(side * 0.105, 0.78, 0);
      body.add(thigh);
      this._mesh(this._geo('hipBall', () => new T.SphereGeometry(0.084, 10, 8)), pants, 0, 0, 0, thigh, { cast: false });
      this._mesh(this._geo('thighCap', () => new T.CapsuleGeometry(0.078, 0.24, 6, 12)), pants, 0, -0.18, 0, thigh);

      const shin = new T.Group();
      shin.position.set(0, -0.37, 0);
      thigh.add(shin);
      this._mesh(this._geo('shinCap', () => new T.CapsuleGeometry(0.066, 0.23, 6, 12)), pants, 0, -0.175, 0, shin);
      // Zapatilla estilizada redondeada con suela perfectamente pegada
      const shoeMesh = this._mesh(this._geo('shoeCap', () => new T.CapsuleGeometry(0.054, 0.115, 6, 12)), shoe, 0, -0.352, 0.048, shin);
      shoeMesh.rotation.x = Math.PI / 2;
      shoeMesh.scale.set(1.12, 1.0, 0.76);
      const soleMesh = this._mesh(this._geo('soleCap', () => new T.CapsuleGeometry(0.052, 0.118, 4, 10)), sole, 0, -0.382, 0.048, shin, { cast: false });
      soleMesh.rotation.x = Math.PI / 2;
      soleMesh.scale.set(1.16, 1.03, 0.34);
      return { thigh, shin };
    };

    const armL = makeArm(1);
    const armR = makeArm(-1);
    const legL = makeLeg(1);
    const legR = makeLeg(-1);

    // Taza humeante de café interactiva (oculta salvo al invitar café)
    const coffeeProp = new T.Group();
    coffeeProp.position.set(0, -0.24, 0.06);
    coffeeProp.rotation.set(Math.PI * 0.42, 0, 0);
    coffeeProp.scale.setScalar(0.001);
    coffeeProp.visible = false;
    this._cyl(0.052, 0.045, 0.095, 0xf8fafc, 0, 0.02, 0, coffeeProp, { seg: 14, rough: 0.35, cast: false });
    this._cyl(0.043, 0.043, 0.01, 0x5c3a21, 0, 0.065, 0, coffeeProp, { seg: 12, cast: false });
    const mugHandle = this._mesh(this._geo('mugHandle', () => new T.TorusGeometry(0.026, 0.007, 6, 12)), this._mat(0xf8fafc, { rough: 0.35 }), 0.052, 0.02, 0, coffeeProp, { cast: false });
    mugHandle.rotation.z = Math.PI / 2;
    const steamMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    const steamPuffs = [];
    for (let si = 0; si < 3; si++) {
      const sp = new T.Mesh(this._geo('steamDot', () => new T.SphereGeometry(0.018, 8, 6)), steamMat);
      sp.position.set(0, 0.1 + si * 0.045, 0);
      coffeeProp.add(sp);
      steamPuffs.push(sp);
    }
    armR.elbow.add(coffeeProp);

    // Burbuja flotante de reacción (creada bajo demanda en la primera interacción)
    const reactSprite = new T.Sprite(new T.SpriteMaterial({ transparent: true, opacity: 0, depthTest: false }));
    reactSprite.scale.set(0.62, 0.62, 1);
    reactSprite.position.set(0.32, 2.38, 0);
    reactSprite.visible = false;
    reactSprite.renderOrder = 25;
    reactSprite.raycast = () => {};
    g.add(reactSprite);

    // Baliza de estado elegante (gema brillante + halo orbital suave)
    const beaconGroup = new T.Group();
    beaconGroup.position.y = 2.18;
    g.add(beaconGroup);

    const beaconMat = new T.MeshStandardMaterial({
      color: STATUS_COLOR.idle,
      emissive: STATUS_COLOR.idle,
      emissiveIntensity: 0.45,
      roughness: 0.2,
      metalness: 0.1,
    });
    const beacon = new T.Mesh(this._geo('beaconGem', () => new T.OctahedronGeometry(0.105, 1)), beaconMat);
    beacon.scale.set(0.88, 1.15, 0.88);
    beacon.raycast = () => {};
    beaconGroup.add(beacon);

    const haloMat = new T.MeshBasicMaterial({ color: STATUS_COLOR.idle, transparent: true, opacity: 0.35, depthWrite: false });
    haloMat.toneMapped = false;
    const beaconHalo = new T.Mesh(this._geo('beaconHalo', () => new T.TorusGeometry(0.175, 0.014, 8, 28)), haloMat);
    beaconHalo.rotation.x = Math.PI * 0.42;
    beaconHalo.raycast = () => {};
    beaconGroup.add(beaconHalo);

    // Partículas sutiles de celebración (visibles solo al terminar)
    const sparkMat = new T.MeshBasicMaterial({ color: STATUS_COLOR.done, transparent: true, opacity: 0, depthWrite: false });
    sparkMat.toneMapped = false;
    const sparks = new T.Group();
    sparks.visible = false;
    for (let i = 0; i < 6; i++) {
      const sp = new T.Mesh(this._geo('sparkDot', () => new T.SphereGeometry(0.036, 8, 6)), sparkMat);
      sp.raycast = () => {};
      sparks.add(sp);
    }
    g.add(sparks);

    // Anillo de selección / hover suave en el suelo
    const ringMat = new T.MeshBasicMaterial({ color: role, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false });
    const ring = new T.Mesh(this._geo('ring', () => new T.RingGeometry(0.52, 0.62, 48)), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    ring.visible = false;
    ring.raycast = () => {};
    g.add(ring);

    const ringOuterMat = new T.MeshBasicMaterial({ color: role, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false });
    const ringOuter = new T.Mesh(this._geo('ringOuter', () => new T.RingGeometry(0.68, 0.72, 48)), ringOuterMat);
    ringOuter.rotation.x = -Math.PI / 2;
    ringOuter.position.y = 0.024;
    ringOuter.visible = false;
    ringOuter.raycast = () => {};
    g.add(ringOuter);

    // Etiqueta flotante estilizada y compacta
    const canvas = this.makeCanvas();
    canvas.width = 720;
    canvas.height = 160;
    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.SRGBColorSpace;
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, opacity: 0.94, depthTest: false }));
    sprite.scale.set(2.2, 0.49, 1);
    sprite.position.y = 2.6;
    sprite.renderOrder = 20;
    sprite.raycast = () => {};
    g.add(sprite);

    g.position.set(SPAWN.x, 0, SPAWN.z + ((h % 7) - 3) * 0.08);
    g.scale.setScalar(0.05);
    this.scene.add(g);

    const actor = {
      id: d.id,
      data: d,
      group: g,
      parts: {
        body,
        torso,
        head,
        eyeL,
        eyeR,
        browL,
        browR,
        mouthArc,
        mouthOpen,
        blushL,
        blushR,
        armL: armL.arm,
        elbowL: armL.elbow,
        armR: armR.arm,
        elbowR: armR.elbow,
        thighL: legL.thigh,
        shinL: legL.shin,
        thighR: legR.thigh,
        shinR: legR.shin,
        coffeeProp,
        steamPuffs,
        shadow,
        beaconGroup,
        beacon,
        beaconHalo,
        sparks,
        ring,
        ringOuter,
      },
      mats: [shirt, skin, hairM, blushMatLocal, steamMat, shadowMat, beaconMat, haloMat, sparkMat, ringMat, ringOuterMat, sprite.material, reactSprite.material],
      label: { canvas, tex, sprite, key: '' },
      reaction: { canvas: null, tex: null, sprite: reactSprite, age: 99, dur: 2.3 },
      role,
      phase: (h % 628) / 100,
      yaw: Math.PI / 2,
      targetYaw: Math.PI / 2,
      sit: 0,
      speed: 0,
      walkBlend: 0,
      walkPhase: 0,
      spawnScale: 0.05,
      ringAlpha: 0,
      coffeeScale: 0.001,
      beaconColor: new T.Color(STATUS_COLOR.idle),
      blinkTimer: 1.8 + (h % 32) * 0.1,
      blinkAmt: 0,
      mood: 'neutral',
      interaction: null, // { type, t, dur, lookYaw }
      path: null,
      target: null,
      targetKey: '',
      arrived: false,
      desk: null,
      spot: null,
      leaving: false,
      doneAt: 0,
    };
    if (this.pingPong) this.pingPong.attachPaddle(actor);
    if (this.billiards) this.billiards.attachCue(actor);
    if (this.darts) this.darts.attachHandDart(actor);
    return actor;
  }

  _drawLabel(a, force = false) {
    const d = a.data;
    const compact = this.labelMode === 'compact';
    const isSelected = this.selectedId === a.id;
    const dark = this.theme === 'dark';

    const name = d.kind === 'main' ? `${d.name} · ${d.project}` : d.name;
    let line2;
    if (d.status === 'working') line2 = d.detail ? `${d.activity} · ${d.detail}` : d.activity;
    else if (d.status === 'waiting') line2 = 'Necesita tu atención';
    else if (d.status === 'done') line2 = 'Terminó su trabajo';
    else if (d.status === 'error') line2 = 'Error';
    else line2 = 'Libre';

    const key = `${name}|${line2}|${d.status}|${this.labelMode}|${this.theme}|${isSelected ? 1 : 0}`;
    if (!force && key === a.label.key) return;
    a.label.key = key;

    const W = 720;
    const H = 160;
    const ctx = a.label.canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const fit = (text, maxW) => {
      let t = String(text);
      if (ctx.measureText(t).width <= maxW) return t;
      while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
      return t + '…';
    };

    const statusHex = cssHex(STATUS_COLOR[d.status] || STATUS_COLOR.idle);
    const bgFill = dark ? 'rgba(20, 29, 41, 0.90)' : 'rgba(255, 255, 255, 0.92)';
    const borderStroke = isSelected ? cssHex(a.role) : dark ? 'rgba(226, 232, 240, 0.16)' : 'rgba(15, 23, 42, 0.10)';

    if (compact) {
      // Píldora minimalista de una sola línea (solo nombre + punto de estado)
      ctx.font = '700 42px "Instrument Sans", system-ui, sans-serif';
      const labelTxt = fit(name, 430);
      const tw = ctx.measureText(labelTxt).width;
      const pillW = clamp(tw + 140, 260, 580);
      const pillH = 92;
      const x0 = (W - pillW) / 2;
      const y0 = (H - pillH) / 2;

      roundRectPath(ctx, x0, y0, pillW, pillH, pillH / 2);
      ctx.fillStyle = bgFill;
      ctx.fill();
      ctx.strokeStyle = borderStroke;
      ctx.lineWidth = isSelected ? 5 : 3;
      ctx.stroke();

      ctx.fillStyle = cssHex(a.role);
      ctx.beginPath();
      ctx.arc(x0 + 44, H / 2, 16, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = dark ? '#f1f5f9' : '#0f172a';
      ctx.fillText(labelTxt, x0 + 78, H / 2 + 14);

      ctx.fillStyle = statusHex;
      ctx.beginPath();
      ctx.arc(x0 + pillW - 36, H / 2, 11, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Píldora limpia de dos líneas
      const x0 = 14;
      const y0 = 14;
      const pw = W - 28;
      const ph = H - 28;
      roundRectPath(ctx, x0, y0, pw, ph, 42);
      ctx.fillStyle = bgFill;
      ctx.fill();
      ctx.strokeStyle = borderStroke;
      ctx.lineWidth = isSelected ? 5 : 3;
      ctx.stroke();

      // Barra lateral sutil de color del rol
      roundRectPath(ctx, x0 + 18, y0 + 26, 12, ph - 52, 6);
      ctx.fillStyle = cssHex(a.role);
      ctx.fill();

      // Indicador de estado en esquina superior derecha
      ctx.fillStyle = statusHex;
      ctx.beginPath();
      ctx.arc(W - 52, 54, 11, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = dark ? '#f1f5f9' : '#0f172a';
      ctx.font = '700 42px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText(fit(name, W - 155), 62, 72);

      ctx.fillStyle = dark ? '#94a3b8' : '#475569';
      ctx.font = '500 31px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText(fit(line2, W - 105), 62, 118);
    }

    a.label.tex.needsUpdate = true;
  }

  // --------------------------------------------------- optimización estática
  _optimizeStaticScene() {
    const T = this.THREE;
    this.scene.updateMatrixWorld(true);

    const groups = new Map();
    const staticNodes = [];

    const canColorInstance = (mat) =>
      mat &&
      mat.isMeshStandardMaterial &&
      !mat.map &&
      !mat.transparent &&
      (mat.opacity === undefined || mat.opacity >= 1) &&
      (!mat.emissiveIntensity || mat.emissiveIntensity === 0);

    const collect = (node) => {
      if (node.userData && node.userData.dynamic) return;
      if (node.isLight || node.isCamera || node.isSprite) return;
      if (node.isMesh && !node.isInstancedMesh) {
        const usePerInstanceColor = canColorInstance(node.material);
        const matKey = usePerInstanceColor
          ? `std|${Math.round((node.material.roughness ?? 0.8) * 10)}|${Math.round((node.material.metalness ?? 0) * 10)}`
          : node.material.uuid;
        const key = `${node.geometry.uuid}|${matKey}|${node.castShadow ? 1 : 0}|${node.receiveShadow ? 1 : 0}`;
        let bucket = groups.get(key);
        if (!bucket) {
          bucket = { list: [], perInstanceColor: usePerInstanceColor };
          groups.set(key, bucket);
        }
        bucket.list.push(node);
        return;
      }
      if (node !== this.scene) staticNodes.push(node);
      for (let i = 0; i < node.children.length; i++) {
        collect(node.children[i]);
      }
    };
    collect(this.scene);

    for (const { list, perInstanceColor } of groups.values()) {
      if (list.length < 2) {
        const m = list[0];
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        continue;
      }
      const proto = list[0];
      const baseMat = perInstanceColor
        ? this._mat(0xffffff, {
            rough: Math.round((proto.material.roughness ?? 0.8) * 10) / 10,
            metal: Math.round((proto.material.metalness ?? 0) * 10) / 10,
          })
        : proto.material;
      const inst = new T.InstancedMesh(proto.geometry, baseMat, list.length);
      inst.castShadow = proto.castShadow;
      inst.receiveShadow = proto.receiveShadow;
      inst.matrixAutoUpdate = false;
      for (let i = 0; i < list.length; i++) {
        const src = list[i];
        inst.setMatrixAt(i, src.matrixWorld);
        if (perInstanceColor) inst.setColorAt(i, src.material.color);
        if (src.parent) src.parent.remove(src);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.updateMatrix();
      if (typeof inst.computeBoundingSphere === 'function') inst.computeBoundingSphere();
      else inst.frustumCulled = false;
      this.scene.add(inst);
      this._instancedStatic.push(inst);
    }

    for (const n of staticNodes) {
      n.matrixAutoUpdate = false;
      n.updateMatrix();
    }
  }

  get gamesVersion() {
    return this._gamesVersion;
  }

  setShadows(enabled) {
    if (this._sun) this._sun.castShadow = Boolean(enabled);
  }

  isSceneIdle() {
    if (this.actors.size > 0) return false;
    if (this.pingPong && (this.pingPong.exhibition || this.pingPong.humanMode || this.pingPong.guests.length > 0)) return false;
    if (this.billiards && (this.billiards.exhibition || this.billiards.humanMode || this.billiards.guests.length > 0)) return false;
    if (this.darts && (this.darts.exhibition || this.darts.humanMode || this.darts.guests.length > 0)) return false;
    if (!this._atmoSettled) return false;
    if (Math.abs(this._doorSlide) > 0.005) return false;
    return true;
  }

  // ---------------------------------------------------------- API pública
  setTheme(mode) {
    const next = mode === 'dark' ? 'dark' : 'light';
    if (this.theme === next) return;
    this.theme = next;
    this._atmoSettled = false;
    const b = this._boardStats;
    this._drawBoard(b.working, b.waiting, b.idle, b.tools, true);
    for (const a of this.actors.values()) this._drawLabel(a, true);
    if (this.pingPong) this.pingPong.onThemeChange();
    if (this.billiards) this.billiards.onThemeChange();
    if (this.darts) this.darts.onThemeChange();
  }

  setPingPongExhibition(enabled) {
    if (this.pingPong) this.pingPong.setExhibition(enabled);
    this.markGamesDirty();
  }

  setGameExhibition(game, enabled) {
    if (game === 'pingpong' && this.pingPong) this.pingPong.setExhibition(enabled);
    else if (game === 'billiards' && this.billiards) this.billiards.setExhibition(enabled);
    else if (game === 'darts' && this.darts) this.darts.setExhibition(enabled);
    this.markGamesDirty();
  }

  setGameHumanMode(game, enabled, opponentId = null) {
    const next = Boolean(enabled);
    if (next) {
      this.firstPersonMode = true;
      if (game !== 'pingpong' && this.pingPong) this.pingPong.setHumanMode(false);
      if (game !== 'billiards' && this.billiards) this.billiards.setHumanMode(false);
      if (game !== 'darts' && this.darts) this.darts.setHumanMode(false);
    }
    if (game === 'pingpong' && this.pingPong) this.pingPong.setHumanMode(next, opponentId);
    else if (game === 'billiards' && this.billiards) this.billiards.setHumanMode(next, opponentId);
    else if (game === 'darts' && this.darts) this.darts.setHumanMode(next, opponentId);
    this.markGamesDirty();
  }

  setFirstPersonMode(enabled) {
    this.firstPersonMode = Boolean(enabled);
    this.bumpGamesVersion();
  }

  humanCameraTarget() {
    if (!this.firstPersonMode) return null;
    if (this.pingPong && this.pingPong.humanMode) return this.pingPong.getFirstPersonCamera();
    if (this.billiards && this.billiards.humanMode) return this.billiards.getFirstPersonCamera();
    if (this.darts && this.darts.humanMode) return this.darts.getFirstPersonCamera();
    return null;
  }

  gameHumanInput(game, input) {
    if (game === 'pingpong' && this.pingPong) this.pingPong.handleHumanInput(input);
    else if (game === 'billiards' && this.billiards) this.billiards.handleHumanInput(input);
    else if (game === 'darts' && this.darts) this.darts.handleHumanInput(input);
  }

  pingPongState() {
    return this.pingPong ? this.pingPong.getState() : null;
  }

  displayName(actor) {
    const d = actor && actor.data;
    if (!d) return 'Agente';
    return d.name || d.type || 'Agente';
  }

  bumpGamesVersion() {
    this._gamesVersion = (this._gamesVersion || 0) + 1;
  }

  markGamesDirty() {
    this._gamesDirty = true;
    this.bumpGamesVersion();
  }

  gamesState() {
    return {
      pingpong: this.pingPong ? this.pingPong.getState() : null,
      billiards: this.billiards ? this.billiards.getState() : null,
      darts: this.darts ? this.darts.getState() : null,
    };
  }

  pingPongCameraView() {
    return this.gameCameraView('pingpong');
  }

  gameCameraView(game, human = false) {
    const T = this.THREE;
    if (game === 'billiards') {
      return human
        ? {
            pos: new T.Vector3(POOL_TABLE.x + 0.15, 5.4, POOL_TABLE.z + 4.35),
            target: new T.Vector3(POOL_TABLE.x, 0.84, POOL_TABLE.z),
          }
        : {
            pos: new T.Vector3(POOL_TABLE.x + 1.2, 5.2, POOL_TABLE.z + 6.4),
            target: new T.Vector3(POOL_TABLE.x + 0.1, 0.95, POOL_TABLE.z - 0.1),
          };
    }
    if (game === 'darts') {
      return human
        ? {
            pos: new T.Vector3(DARTS_ZONE.boardX - 0.55, 2.25, DARTS_ZONE.throwZ + 1.65),
            target: new T.Vector3(DARTS_ZONE.boardX + 0.22, DARTS_ZONE.boardY - 0.04, DARTS_ZONE.boardZ),
          }
        : {
            pos: new T.Vector3(DARTS_ZONE.boardX - 1.35, 3.35, DARTS_ZONE.throwZ + 4.35),
            target: new T.Vector3(DARTS_ZONE.boardX + 0.35, 1.48, DARTS_ZONE.boardZ + 0.6),
          };
    }
    return human
      ? {
          pos: new T.Vector3(PP_TABLE.x + 0.1, 5.1, PP_TABLE.z + 6.4),
          target: new T.Vector3(PP_TABLE.x + 0.25, 0.85, PP_TABLE.z - 0.05),
        }
      : {
          pos: new T.Vector3(PP_TABLE.x + 0.15, 5.5, PP_TABLE.z + 7.4),
          target: new T.Vector3(PP_TABLE.x + 0.55, 0.9, PP_TABLE.z - 0.15),
        };
  }

  _drawReactionBubble(a, icon, accent = '#4f5ee8') {
    if (!a.reaction.canvas) {
      const T = this.THREE;
      const c = this.makeCanvas();
      c.width = 160;
      c.height = 160;
      const tex = new T.CanvasTexture(c);
      tex.colorSpace = T.SRGBColorSpace;
      a.reaction.canvas = c;
      a.reaction.tex = tex;
      a.reaction.sprite.material.map = tex;
      a.reaction.sprite.material.needsUpdate = true;
    }
    const ctx = a.reaction.canvas.getContext('2d');
    const W = 160;
    const H = 160;
    ctx.clearRect(0, 0, W, H);
    // Burbuja redondeada limpia con puntita inferior
    roundRectPath(ctx, 18, 14, 124, 114, 42);
    ctx.fillStyle = this.theme === 'dark' ? 'rgba(20, 29, 43, 0.95)' : 'rgba(255, 255, 255, 0.96)';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(64, 124);
    ctx.lineTo(80, 148);
    ctx.lineTo(96, 124);
    ctx.closePath();
    ctx.fillStyle = this.theme === 'dark' ? 'rgba(20, 29, 43, 0.95)' : 'rgba(255, 255, 255, 0.96)';
    ctx.fill();

    ctx.font = '600 62px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    const tw = ctx.measureText(icon).width;
    ctx.fillStyle = this.theme === 'dark' ? '#f8fafc' : '#0f172a';
    ctx.fillText(icon, (W - tw) / 2, 94);
    a.reaction.tex.needsUpdate = true;
    a.reaction.age = 0;
    a.reaction.dur = 2.4;
    a.reaction.sprite.visible = true;
  }

  _allPickableActors() {
    const list = [...this.actors.values()];
    for (const arena of [this.pingPong, this.billiards, this.darts]) {
      if (!arena) continue;
      if (arena.humanActor && arena.humanActor.group.visible) list.push(arena.humanActor);
      for (const g of arena.guests) {
        if (g.group.visible) list.push(g);
      }
    }
    return list;
  }

  getActorById(id) {
    if (!id) return null;
    if (this.actors.has(id)) return this.actors.get(id);
    for (const arena of [this.pingPong, this.billiards, this.darts]) {
      if (!arena) continue;
      if (arena.humanActor && arena.humanActor.id === id && arena.humanActor.group.visible) return arena.humanActor;
      for (const g of arena.guests) {
        if (g.id === id && g.group.visible) return g;
      }
    }
    return null;
  }

  actorGame(id) {
    const a = this.getActorById(id);
    if (!a) return null;
    if (this.pingPong && (this.pingPong.isActivePlayer(a) || this.pingPong.guests.includes(a))) return 'pingpong';
    if (this.billiards && (this.billiards.isActivePlayer(a) || this.billiards.guests.includes(a))) return 'billiards';
    if (this.darts && (this.darts.isActivePlayer(a) || this.darts.guests.includes(a))) return 'darts';
    return null;
  }

  actorData(id) {
    const a = this.getActorById(id);
    if (!a) return null;
    return {
      ...a.data,
      isGuest: Boolean(a.isGuest),
      isHuman: Boolean(a.isHuman),
      game: this.actorGame(id),
    };
  }

  interact(id, action, cameraPos = null) {
    const a = this.getActorById(id);
    if (!a || a.leaving) return false;

    const lookYaw = cameraPos
      ? Math.atan2(cameraPos.x - a.group.position.x, cameraPos.z - a.group.position.z)
      : Math.PI * 0.25;

    if (action === 'play_pingpong' || action === 'play_billiards' || action === 'play_darts') {
      if (a.data.status !== 'idle') {
        this._drawReactionBubble(a, '💼', '#3b82f6');
        a.interaction = { type: 'wave', t: 0, dur: 1.8, lookYaw };
        return true;
      }
      this.pingPong?.removePlayer(a);
      this.billiards?.removePlayer(a);
      this.darts?.removePlayer(a);
      if (action === 'play_pingpong') {
        this.pingPong?.requestPlayer(a);
        this._drawReactionBubble(a, '🏓', '#3b82f6');
      } else if (action === 'play_billiards') {
        this.billiards?.requestPlayer(a);
        this._drawReactionBubble(a, '🎱', '#10b981');
      } else {
        this.darts?.requestPlayer(a);
        this._drawReactionBubble(a, '🎯', '#f59e0b');
      }
      a.interaction = null;
      this.markGamesDirty();
      return true;
    }

    const cfg = {
      wave: { dur: 2.6, icon: '👋', col: '#4f5ee8' },
      cheer: { dur: 2.8, icon: '🔥', col: '#f59e0b' },
      coffee: { dur: 4.2, icon: '☕', col: '#b45309' },
      dance: { dur: 4.0, icon: '🎵', col: '#ec4899' },
    }[action];
    if (!cfg) return false;

    a.interaction = { type: action, t: 0, dur: cfg.dur, lookYaw };
    this._drawReactionBubble(a, cfg.icon, cfg.col);
    return true;
  }

  // Mantiene etiquetas limpias, proporcionadas al zoom y sin tapar el lente de cerca
  syncLabelVisibility(cameraPos) {
    if (!cameraPos) return;
    const baseW = this.labelMode === 'compact' ? 1.98 : 2.2;
    const baseH = this.labelMode === 'compact' ? 0.44 : 0.49;
    for (const a of this._allPickableActors()) {
      const sp = a.label.sprite;
      if (!sp.visible) continue;
      const dist = Math.hypot(
        a.group.position.x - cameraPos.x,
        a.group.position.y + 2.4 - cameraPos.y,
        a.group.position.z - cameraPos.z
      );
      const isSel = this.selectedId === a.id;
      const isHov = this.hoveredId === a.id;
      const emphasis = isSel ? 1.07 : isHov ? 1.03 : 1;
      const distFactor = clamp(dist / 23, 0.36, 1.08);
      sp.scale.set(baseW * emphasis * distFactor, baseH * emphasis * distFactor, 1);
      if (dist < 4.5) {
        const fade = clamp((dist - 2.4) / 2.1, 0, 1);
        sp.material.opacity = Math.min(sp.material.opacity, fade * 0.9);
        if (fade < 0.04) sp.visible = false;
      }
    }
  }

  setLabelMode(mode) {
    const next = ['full', 'compact', 'hidden'].includes(mode) ? mode : 'full';
    if (this.labelMode === next) return;
    this.labelMode = next;
    for (const a of this.actors.values()) this._drawLabel(a, true);
  }

  setAgents(list) {
    const seen = new Set();
    for (const d of list) {
      seen.add(d.id);
      let a = this.actors.get(d.id);
      if (!a) {
        a = this._makeActor(d);
        a.desk = this._pickDesk(d);
        if (a.desk) a.desk.owner = d.id;
        a.spot = this._pickSpot();
        if (a.spot) a.spot.owner = (a.spot.owner || 0) + 1;
        a.ring = a.parts.ring;
        this.actors.set(d.id, a);
      }
      if (a.data.status !== 'done' && d.status === 'done') a.doneAt = this.time;
      a.data = d;
      if (a.leaving && d.status !== 'done') a.leaving = false;
      this._drawLabel(a);
    }
    for (const a of this.actors.values()) {
      if (!seen.has(a.id)) a.leaving = true;
    }
    this._gamesDirty = true;
    this._updateBoard(list);
  }

  setSelected(id) {
    const prev = this.selectedId;
    this.selectedId = id;
    for (const a of this._allPickableActors()) {
      if (a.id === prev || a.id === id) this._drawLabel(a, true);
    }
  }

  setHovered(id) {
    this.hoveredId = id;
  }

  actorPosition(id) {
    const a = this.getActorById(id);
    return a ? a.group.position.clone() : null;
  }

  pick(raycaster) {
    let bestId = null;
    let bestDistSq = Infinity;
    const box = this._pickBox;
    const hit = this._pickHit;
    const origin = raycaster.ray.origin;
    for (const a of this._allPickableActors()) {
      const p = a.group.position;
      const top = p.y + (2.08 - SIT_DROP * a.sit);
      box.min.set(p.x - 0.38, p.y, p.z - 0.38);
      box.max.set(p.x + 0.38, top, p.z + 0.38);
      if (raycaster.ray.intersectBox(box, hit)) {
        const dSq = origin.distanceToSquared(hit);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestId = a.id;
        }
      }
    }
    return bestId;
  }

  _pickDesk(d) {
    const free = this.desks.filter((x) => !x.owner);
    if (!free.length) return null;
    const parent = d.parent && this.actors.get(d.parent);
    if (parent && parent.desk) {
      const dist = (x) => Math.hypot(x.x - parent.desk.x, x.z - parent.desk.z);
      free.sort((p, q) => dist(p) - dist(q));
    }
    return free[0];
  }

  _pickSpot() {
    const free = this.spots.filter((s) => !s.owner);
    if (free.length) return free[0];
    return this.spots[Math.floor(Math.random() * this.spots.length)];
  }

  _dispose(a) {
    this.scene.remove(a.group);
    for (const m of a.mats) m.dispose();
    if (a.parts && a.parts.handDart && a.parts.handDart.userData && a.parts.handDart.userData.finMat) {
      a.parts.handDart.userData.finMat.dispose();
    }
    a.label.tex.dispose();
    if (a.reaction && a.reaction.tex) a.reaction.tex.dispose();
    if (a.desk && a.desk.owner === a.id) a.desk.owner = null;
    if (a.spot && a.spot.owner) a.spot.owner = Math.max(0, a.spot.owner - 1) || null;
    if (this.actors.get(a.id) === a) this.actors.delete(a.id);
    this._gamesDirty = true;
  }

  // -------------------------------------------------------------- rutas
  _nearestLane(x) {
    let best = DESK_COLS[0] + LANE_OFFSET;
    for (const c of DESK_COLS) {
      const lane = c + LANE_OFFSET;
      if (Math.abs(lane - x) < Math.abs(best - x)) best = lane;
    }
    return best;
  }

  _crossesBox(ax, az, bx, bz, minX, maxX, minZ, maxZ) {
    const dx = bx - ax;
    const dz = bz - az;
    let t0 = 0;
    let t1 = 1;
    const clip = (p, q) => {
      if (Math.abs(p) < 1e-6) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    return (
      clip(-dx, ax - minX) &&
      clip(dx, maxX - ax) &&
      clip(-dz, az - minZ) &&
      clip(dz, maxZ - az)
    );
  }

  _crossesLoungeObstacle(ax, az, bx, bz) {
    const hitPP = this._crossesBox(
      ax, az, bx, bz,
      PP_TABLE.x - PP_TABLE.len / 2 - 0.45,
      PP_TABLE.x + PP_TABLE.len / 2 + 0.45,
      PP_TABLE.z - PP_TABLE.wid / 2 - 0.42,
      PP_TABLE.z + PP_TABLE.wid / 2 + 0.42
    );
    if (hitPP) return true;
    return this._crossesBox(
      ax, az, bx, bz,
      POOL_TABLE.x - POOL_TABLE.len / 2 - 0.42,
      POOL_TABLE.x + POOL_TABLE.len / 2 + 0.42,
      POOL_TABLE.z - POOL_TABLE.wid / 2 - 0.42,
      POOL_TABLE.z + POOL_TABLE.wid / 2 + 0.42
    );
  }

  _appendLoungePath(path, from, to) {
    if (!this._crossesLoungeObstacle(from.x, from.z, to.x, to.z)) {
      path.push({ x: to.x, z: to.z });
      return;
    }
    // Pasillos laterales completamente despejados (oeste x=5.35, este x=10.95) y pasillo central z=0.2
    const westX = 5.35;
    const eastX = 10.95;
    const inTableZ = (z) =>
      (z >= PP_TABLE.z - PP_TABLE.wid / 2 - 0.42 && z <= PP_TABLE.z + PP_TABLE.wid / 2 + 0.42) ||
      (z >= POOL_TABLE.z - POOL_TABLE.wid / 2 - 0.42 && z <= POOL_TABLE.z + POOL_TABLE.wid / 2 + 0.42);
    const sideX = inTableZ(to.z)
      ? (to.x >= 8.0 ? eastX : westX)
      : ((from.x + to.x) * 0.5 < 8.0 ? westX : eastX);
    const crossMid = (from.x - 8.0) * (sideX - 8.0) < 0;
    if (inTableZ(from.z) && crossMid) {
      const clearZ = from.z > 0 ? 4.35 : 0.25;
      path.push({ x: from.x, z: clearZ });
      path.push({ x: sideX, z: clearZ });
    } else {
      path.push({ x: sideX, z: from.z });
    }
    path.push({ x: sideX, z: to.z });
    path.push({ x: to.x, z: to.z });
  }

  _computePath(pos, target) {
    const path = [];
    const onCorridor = pos.z >= CORRIDOR_Z - 0.4;
    const inLounge = !onCorridor && pos.x >= LOUNGE_X + 0.8;

    if (inLounge && target.type === 'spot') {
      this._appendLoungePath(path, pos, target.spot);
      return path.filter((p, i) => {
        const prev = i === 0 ? pos : path[i - 1];
        return Math.hypot(p.x - prev.x, p.z - prev.z) > 0.01;
      });
    }
    if (!onCorridor) {
      if (inLounge) {
        this._appendLoungePath(path, pos, { x: pos.x, z: CORRIDOR_Z });
      } else {
        const lane = this._nearestLane(pos.x);
        path.push({ x: lane, z: pos.z });
        path.push({ x: lane, z: CORRIDOR_Z });
      }
    }
    const entryX = target.type === 'seat' ? target.desk.laneX : target.type === 'spot' ? target.spot.x : SPAWN.x;
    if (target.type === 'spot') {
      const last = path.length ? path[path.length - 1] : pos;
      const startPt = { x: Math.max(last.x, LOUNGE_X + 0.9), z: CORRIDOR_Z };
      if (last.x < LOUNGE_X + 0.9) path.push(startPt);
      this._appendLoungePath(path, path.length ? path[path.length - 1] : pos, target.spot);
    } else {
      path.push({ x: entryX, z: CORRIDOR_Z });
      if (target.type === 'seat') {
        path.push({ x: target.desk.laneX, z: target.desk.seatZ });
        path.push({ x: target.desk.seatX, z: target.desk.seatZ });
      }
    }
    return path.filter((p, i) => {
      const prev = i === 0 ? pos : path[i - 1];
      return Math.hypot(p.x - prev.x, p.z - prev.z) > 0.01;
    });
  }

  _isInAnyGame(a) {
    return Boolean(
      (this.pingPong && this.pingPong.isActivePlayer(a)) ||
      (this.billiards && this.billiards.isActivePlayer(a)) ||
      (this.darts && this.darts.isActivePlayer(a))
    );
  }

  _wantedTarget(a) {
    if (a.leaving) return { key: 'exit', type: 'exit' };
    const s = a.data.status;
    if (s === 'idle') {
      const gameTarget =
        (this.pingPong && this.pingPong.getActorTarget(a)) ||
        (this.billiards && this.billiards.getActorTarget(a)) ||
        (this.darts && this.darts.getActorTarget(a));
      if (gameTarget) return gameTarget;
      if (a.spot) return { key: `spot${a.spot.index}`, type: 'spot', spot: a.spot };
      return { key: 'exit', type: 'exit' };
    }
    if (a.desk) return { key: `seat${a.desk.index}`, type: 'seat', desk: a.desk };
    return { key: `spot${a.spot ? a.spot.index : 0}`, type: 'spot', spot: a.spot || this.spots[0] };
  }

  _syncGames() {
    if (!this._gamesDirty) return;
    this._gamesDirty = false;
    const allIdle = [];
    for (const a of this.actors.values()) {
      if (!a.leaving && a.data.status === 'idle') allIdle.push(a);
    }
    const pinnedBillar = new Set(this.billiards ? this.billiards.requestedIds : []);
    const pinnedDarts = new Set(this.darts ? this.darts.requestedIds : []);

    // Ping-Pong recibe todos los libres que no fueron enviados explícitamente a Billar o Dardos
    const ppEligible = allIdle.filter((a) => !pinnedBillar.has(a.id) && !pinnedDarts.has(a.id));
    if (this.pingPong) this.pingPong.syncPlayers(ppEligible);

    const usedByPP = new Set(allIdle.filter((a) => this.pingPong && this.pingPong.isActivePlayer(a)).map((a) => a.id));
    const billarEligible = allIdle.filter((a) => !usedByPP.has(a.id) && !pinnedDarts.has(a.id));
    if (this.billiards) this.billiards.syncPlayers(billarEligible);

    const usedByBillar = new Set(allIdle.filter((a) => this.billiards && this.billiards.isActivePlayer(a)).map((a) => a.id));
    const dartsEligible = allIdle.filter((a) => !usedByPP.has(a.id) && !usedByBillar.has(a.id));
    if (this.darts) this.darts.syncPlayers(dartsEligible);
  }

  // ---------------------------------------------------------- animación
  update(dtRaw) {
    const dt = Math.min(Math.max(dtRaw, 0), 0.05);
    this.time += dt;
    this._nowMs = Date.now();
    this._updateAtmosphere(dt);
    this._syncGames();
    let someoneNearDoor = false;
    for (const a of this.actors.values()) {
      this._updateActor(a, dt);
      if (this.actors.has(a.id) && Math.hypot(a.group.position.x - SPAWN.x, a.group.position.z - SPAWN.z) < 2.2) {
        someoneNearDoor = true;
      }
    }
    if (this.pingPong) this.pingPong.update(dt);
    if (this.billiards) this.billiards.update(dt);
    if (this.darts) this.darts.update(dt);
    // Animación suave de la puerta corredera de entrada
    const targetSlide = someoneNearDoor ? -1.68 : 0;
    if (Math.abs(this._doorSlide - targetSlide) > 0.001) {
      this._doorSlide = damp(this._doorSlide, targetSlide, someoneNearDoor ? 9 : 5, dt);
      if (Math.abs(this._doorSlide - targetSlide) <= 0.001) this._doorSlide = targetSlide;
      if (this._doorPanel) this._doorPanel.position.z = CORRIDOR_Z + this._doorSlide;
    }

    this._updateScreens(dt);
  }

  _updateAtmosphere(dt) {
    if (this._atmoSettled) return;
    const cfg = THEMES[this.theme] || THEMES.light;
    const rate = 6;
    const alpha = 1 - Math.exp(-rate * dt);

    this._tmpColor.setHex(cfg.sky);
    this.scene.background.lerp(this._tmpColor, alpha);
    if (this.scene.fog) this.scene.fog.color.lerp(this._tmpColor, alpha);

    this._hemi.intensity = damp(this._hemi.intensity, cfg.hemi, rate, dt);
    this._tmpColor.setHex(cfg.hemiSky);
    this._hemi.color.lerp(this._tmpColor, alpha);
    this._tmpColor.setHex(cfg.hemiGround);
    this._hemi.groundColor.lerp(this._tmpColor, alpha);

    this._sun.intensity = damp(this._sun.intensity, cfg.sun, rate, dt);
    this._tmpColor.setHex(cfg.sunColor);
    this._sun.color.lerp(this._tmpColor, alpha);

    this._fill.intensity = damp(this._fill.intensity, cfg.fill, rate, dt);
    this._tmpColor.setHex(cfg.fillColor);
    this._fill.color.lerp(this._tmpColor, alpha);

    this._ambient.intensity = damp(this._ambient.intensity, cfg.ambient, rate, dt);

    if (this._windowMat) {
      this._tmpColor.setHex(cfg.windowGlass);
      this._windowMat.color.lerp(this._tmpColor, alpha);
    }
    for (const m of this._lampMats) m.emissiveIntensity = damp(m.emissiveIntensity, cfg.lampGlow, rate, dt);
    const tgtLamp = this.theme === 'dark' ? 4.2 : 0;
    if (this._lampLight) {
      this._lampLight.intensity = damp(this._lampLight.intensity, tgtLamp, rate, dt);
      this._lampLight.visible = this._lampLight.intensity > 0.02;
    }

    if (
      Math.abs(this._hemi.intensity - cfg.hemi) < 0.002 &&
      Math.abs(this._sun.intensity - cfg.sun) < 0.002 &&
      (!this._lampLight || Math.abs(this._lampLight.intensity - tgtLamp) < 0.005)
    ) {
      this.scene.background.setHex(cfg.sky);
      if (this.scene.fog) this.scene.fog.color.setHex(cfg.sky);
      this._hemi.intensity = cfg.hemi;
      this._hemi.color.setHex(cfg.hemiSky);
      this._hemi.groundColor.setHex(cfg.hemiGround);
      this._sun.intensity = cfg.sun;
      this._sun.color.setHex(cfg.sunColor);
      this._fill.intensity = cfg.fill;
      this._fill.color.setHex(cfg.fillColor);
      this._ambient.intensity = cfg.ambient;
      if (this._windowMat) this._windowMat.color.setHex(cfg.windowGlass);
      for (const m of this._lampMats) m.emissiveIntensity = cfg.lampGlow;
      if (this._lampLight) {
        this._lampLight.intensity = tgtLamp;
        this._lampLight.visible = tgtLamp > 0.02;
      }
      this._atmoSettled = true;
    }
  }

  _updateActor(a, dt) {
    const g = a.group;
    // Si llegó cuando no había escritorios libres, lo reclama en cuanto se libere uno.
    if (!a.desk && !a.leaving) {
      const free = this._pickDesk(a.data);
      if (free) {
        free.owner = a.id;
        a.desk = free;
      }
    }
    const want = this._wantedTarget(a);
    if (want.key !== a.targetKey) {
      a.targetKey = want.key;
      a.target = want;
      a.arrived = false;
      a.path = null;
    }

    // Celebración al terminar y después sale por la puerta
    if (a.data.status === 'done' && !a.leaving && a.doneAt && this.time - a.doneAt > 2.6) {
      a.leaving = true;
      this._gamesDirty = true;
    }

    let moving = false;
    if (!a.arrived) {
      if (a.sit > 0.02) {
        a.sit = Math.max(0, a.sit - dt * 3.8);
        a.speed = damp(a.speed, 0, 14, dt);
      } else {
        a.sit = 0;
        if (!a.path) a.path = this._computePath(g.position, a.target);
        if (a.path.length) {
          moving = this._stepMove(a, dt);
        } else {
          a.arrived = true;
          a.speed = 0;
          if (a.target.type === 'exit') {
            this._dispose(a);
            return;
          }
        }
      }
    }
    if (a.arrived) {
      a.speed = damp(a.speed, 0, 14, dt);
      if (a.target.type === 'seat') {
        a.targetYaw = Math.PI;
        a.sit = Math.min(1, a.sit + dt * 2.8);
      } else if (a.target.type === 'spot' && !this._isInAnyGame(a)) {
        const lookAtBall = this.pingPong && this.pingPong.lookTargetForSpectator();
        const tx = lookAtBall ? PP_TABLE.x : POOL_TABLE.x;
        const tz = lookAtBall ? PP_TABLE.z : POOL_TABLE.z;
        a.targetYaw = Math.atan2(tx - g.position.x, tz - g.position.z);
      }
      // Si el usuario saluda/baila con un personaje de pie, se gira hacia la cámara
      if (a.interaction && a.sit < 0.25 && (a.interaction.type === 'wave' || a.interaction.type === 'dance')) {
        a.targetYaw = a.interaction.lookYaw;
      }
    }

    // Aparición / desaparición suave en la puerta
    const distExit = a.leaving ? Math.hypot(g.position.x - SPAWN.x, g.position.z - SPAWN.z) : 99;
    const targetScale = a.leaving && distExit < 0.7 ? clamp(distExit / 0.7, 0.05, 1) : 1;
    a.spawnScale = damp(a.spawnScale, targetScale, 11, dt);
    g.scale.setScalar(a.spawnScale);

    a.yaw = dampAngle(a.yaw, a.targetYaw, moving ? 13 : 9, dt);
    g.rotation.y = a.yaw;

    this._pose(a, dt, moving);
  }

  _stepMove(a, dt) {
    const g = a.group;
    const t = a.path[0];
    const dx = t.x - g.position.x;
    const dz = t.z - g.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.005) {
      a.targetYaw = Math.atan2(dx, dz);
    }

    // Velocidad suave: acelera al arrancar, modula ligeramente en giros y suaviza al llegar
    const isFinal = a.path.length === 1;
    const yawErr = Math.abs(wrapAngle(a.targetYaw - a.yaw));
    const turnFactor = clamp(1 - (yawErr / Math.PI) * 0.25, 0.75, 1);
    const arriveFactor = isFinal && dist < 0.45 ? clamp(0.45 + (dist / 0.45) * 0.55, 0.45, 1) : 1;
    const desiredSpeed = WALK_SPEED * turnFactor * arriveFactor;
    a.speed = damp(a.speed, desiredSpeed, 14, dt);

    const step = Math.max(a.speed, WALK_SPEED * 0.45) * dt;
    let moved = 0;
    if (dist <= step) {
      moved = dist;
      g.position.x = t.x;
      g.position.z = t.z;
      a.path.shift();
    } else {
      moved = step;
      g.position.x += (dx / dist) * step;
      g.position.z += (dz / dist) * step;
    }

    // Fase acoplada a la distancia real recorrida (cero deslizamiento de pies)
    a.walkPhase += moved * 3.55;
    return true;
  }

  _shrinkUnusedProps(a, dt, keep = '') {
    const p = a.parts;
    if (keep !== 'paddle' && p.paddle && p.paddle.visible) {
      a._paddleScale = damp(a._paddleScale || 0.001, 0.001, 16, dt);
      p.paddle.scale.setScalar(a._paddleScale);
      if (a._paddleScale <= 0.04) p.paddle.visible = false;
    }
    if (keep !== 'cue' && p.cue && p.cue.visible) {
      a._cueScale = damp(a._cueScale || 0.001, 0.001, 16, dt);
      p.cue.scale.setScalar(a._cueScale);
      if (a._cueScale <= 0.04) p.cue.visible = false;
    }
    if (keep !== 'dart' && p.handDart && p.handDart.visible) {
      a._dartScale = damp(a._dartScale || 0.001, 0.001, 18, dt);
      p.handDart.scale.setScalar(a._dartScale);
      if (a._dartScale <= 0.04) p.handDart.visible = false;
    }
    if (keep !== 'coffee' && p.coffeeProp && p.coffeeProp.visible) {
      a.coffeeScale = damp(a.coffeeScale || 0.001, 0.001, 14, dt);
      p.coffeeProp.scale.setScalar(a.coffeeScale);
      if (a.coffeeScale <= 0.04) p.coffeeProp.visible = false;
    }
  }

  _updateExpression(a, dt, mood = 'neutral') {
    a.mood = mood;
    const p = a.parts;
    if (!p.browL || !p.mouthArc) return;

    // Parpadeo natural asíncrono (LCG sin asignaciones en heap)
    a.blinkTimer -= dt;
    if (a.blinkTimer <= 0) {
      a.blinkAmt = 1;
      this._rng = (Math.imul(this._rng, 1664525) + 1013904223) >>> 0;
      a.blinkTimer = 2.6 + (this._rng % 34) * 0.1;
    }
    if (a.blinkAmt > 0) a.blinkAmt = Math.max(0, a.blinkAmt - dt * 7.2);
    const blinkCurve = a.blinkAmt > 0 ? Math.sin(a.blinkAmt * Math.PI) : 0;

    let bLY = 0.258;
    let bRY = 0.258;
    let bLZ = Math.PI / 2;
    let bRZ = Math.PI / 2;
    let eyeSX = 1;
    let eyeSY = 1;
    let mSX = 0.72;
    let mSY = 0.48;
    let mY = 0.16;
    let mRot = Math.PI;
    let openS = 0.001;
    let blushOp = 0.22;

    if (mood === 'focused') {
      bLY = bRY = 0.249;
      bLZ = Math.PI / 2 + 0.2;
      bRZ = Math.PI / 2 - 0.2;
      eyeSY = 0.88;
      mSX = 0.62;
      mSY = 0.14;
      mY = 0.148;
      blushOp = 0.14;
    } else if (mood === 'thinking') {
      bLY = 0.274;
      bRY = 0.25;
      bLZ = Math.PI / 2 - 0.16;
      bRZ = Math.PI / 2 - 0.15;
      mSX = 0.48;
      mSY = 0.2;
      mY = 0.148;
      blushOp = 0.18;
    } else if (mood === 'happy') {
      bLY = bRY = 0.268;
      bLZ = Math.PI / 2 - 0.14;
      bRZ = Math.PI / 2 + 0.14;
      eyeSX = 1.12;
      eyeSY = 0.78;
      mSX = 1.05;
      mSY = 0.94;
      mY = 0.164;
      blushOp = 0.45;
    } else if (mood === 'excited' || mood === 'love') {
      bLY = bRY = 0.276;
      bLZ = Math.PI / 2 - 0.18;
      bRZ = Math.PI / 2 + 0.18;
      eyeSX = 1.18;
      eyeSY = 0.68;
      mSX = 1.12;
      mSY = 1.02;
      mY = 0.166;
      openS = mood === 'excited' ? 0.86 : 0.42;
      blushOp = 0.56;
    } else if (mood === 'surprised') {
      bLY = bRY = 0.284;
      bLZ = Math.PI / 2 - 0.12;
      bRZ = Math.PI / 2 + 0.12;
      eyeSX = 1.18;
      eyeSY = 1.26;
      mSX = 0.001;
      mSY = 0.001;
      openS = 0.95;
      blushOp = 0.24;
    } else if (mood === 'sad') {
      bLY = bRY = 0.264;
      bLZ = Math.PI / 2 - 0.28;
      bRZ = Math.PI / 2 + 0.28;
      eyeSY = 0.86;
      mSX = 0.82;
      mSY = 0.76;
      mY = 0.126;
      mRot = 0;
      blushOp = 0.12;
    }

    p.browL.position.y = damp(p.browL.position.y, bLY, 12, dt);
    p.browR.position.y = damp(p.browR.position.y, bRY, 12, dt);
    p.browL.rotation.z = damp(p.browL.rotation.z, bLZ, 12, dt);
    p.browR.rotation.z = damp(p.browR.rotation.z, bRZ, 12, dt);

    const finalEyeSY = Math.max(0.08, eyeSY * (1 - blinkCurve * 0.88));
    p.eyeL.scale.set(damp(p.eyeL.scale.x, eyeSX, 12, dt), finalEyeSY, 1);
    p.eyeR.scale.set(damp(p.eyeR.scale.x, eyeSX, 12, dt), finalEyeSY, 1);

    p.mouthArc.scale.set(damp(p.mouthArc.scale.x, mSX, 14, dt), damp(p.mouthArc.scale.y, mSY, 14, dt), 1);
    p.mouthArc.position.y = damp(p.mouthArc.position.y, mY, 14, dt);
    p.mouthArc.rotation.z = damp(p.mouthArc.rotation.z, mRot, 14, dt);

    const os = damp(p.mouthOpen.scale.x, openS, 14, dt);
    p.mouthOpen.scale.set(os, os * (mood === 'surprised' ? 1.12 : 0.85), 0.42);
    p.mouthOpen.visible = os > 0.05;

    if (p.blushL && p.blushL.material) {
      p.blushL.material.opacity = damp(p.blushL.material.opacity, blushOp, 10, dt);
    }
  }

  _updateReactionBubble(a, dt, sitEase = 0) {
    const r = a.reaction;
    if (!r) return;
    if (r.age < r.dur) {
      r.age += dt;
      const u = clamp(r.age / r.dur, 0, 1);
      const pop = u < 0.16 ? smoothstep(u / 0.16) * 1.14 : u < 0.28 ? 1.14 - ((u - 0.16) / 0.12) * 0.14 : 1;
      const fade = u > 0.72 ? 1 - smoothstep((u - 0.72) / 0.28) : 1;
      r.sprite.visible = fade > 0.02;
      r.sprite.scale.setScalar(0.64 * pop);
      r.sprite.position.set(0.36, 2.28 - SIT_DROP * sitEase + u * 0.42, 0);
      r.sprite.material.opacity = fade;
    } else if (r.sprite.visible) {
      r.sprite.visible = false;
    }
  }

  // Finalizador común usado por las 3 arenas de juegos (expresiones, baliza, aro y burbuja)
  _finishActivityPose(a, dt, t, mood = 'focused') {
    const p = a.parts;
    this._updateExpression(a, dt, mood);
    this._updateReactionBubble(a, dt, 0);

    p.beaconGroup.visible = !a.isGuest;
    if (!a.isGuest) {
      p.beaconGroup.position.y = damp(p.beaconGroup.position.y, 2.16 + Math.sin(t * 2.2) * 0.04, 12, dt);
      p.beacon.rotation.y += dt * 1.2;
      p.beaconHalo.rotation.z += dt * 0.9;
    }

    const isSel = this.selectedId === a.id;
    const isHov = this.hoveredId === a.id;
    const showLabel = this.labelMode !== 'hidden' || isSel || isHov;
    a.label.sprite.visible = (showLabel && (!a.isGuest || a.isHuman)) || isSel || isHov;
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

  _pose(a, dt, moving) {
    // Avanzar timer de interacción directa del usuario
    if (a.interaction) {
      a.interaction.t += dt;
      if (a.interaction.t >= a.interaction.dur) a.interaction = null;
    }

    // Si no está caminando ni haciendo una interacción directa, ceder a la arena de juego activa
    if (!moving && !a.interaction) {
      if (this.pingPong && this.pingPong.poseActor(a, dt)) {
        this._shrinkUnusedProps(a, dt, 'paddle');
        return;
      }
      if (this.billiards && this.billiards.poseActor(a, dt)) {
        this._shrinkUnusedProps(a, dt, 'cue');
        return;
      }
      if (this.darts && this.darts.poseActor(a, dt)) {
        this._shrinkUnusedProps(a, dt, 'dart');
        return;
      }
    }

    const drinkingCoffee = Boolean(a.interaction && a.interaction.type === 'coffee');
    this._shrinkUnusedProps(a, dt, drinkingCoffee ? 'coffee' : '');

    const p = a.parts;
    const d = a.data;
    const t = this.time + a.phase;
    const sitEase = smoothstep(a.sit);
    const seated = a.sit > 0.55;
    const celebrating = d.status === 'done' && a.arrived && !a.leaving;
    const recentErr = Boolean(d.errorAt && this._nowMs - d.errorAt < 2500);
    const isError = d.status === 'error' || recentErr;

    // Mezcla continua entre caminata y postura estática (cero saltos bruscos)
    a.walkBlend = damp(a.walkBlend, moving ? 1 : 0, 12, dt);
    const wb = a.walkBlend;

    // Respiración continua muy sutil
    const breath = Math.sin(t * 2.1);

    // Salto de celebración / interacción con squash-and-stretch suave
    let jumpY = 0;
    let stretchY = 1;
    let stretchXZ = 1;
    if (celebrating || (a.interaction && a.interaction.type === 'cheer' && !seated)) {
      const wave = Math.sin(t * 6.8);
      jumpY = Math.pow(Math.abs(wave), 0.78) * 0.26;
      const apex = jumpY / 0.26;
      stretchY = 1 + (apex - 0.35) * 0.12;
      stretchXZ = 1 / Math.sqrt(stretchY);
    } else if (a.interaction && a.interaction.type === 'dance' && !seated) {
      jumpY = Math.abs(Math.sin(a.interaction.t * 7.5)) * 0.08;
    }
    p.body.scale.set(
      damp(p.body.scale.x, stretchXZ, 14, dt),
      damp(p.body.scale.y, stretchY + breath * 0.012, 14, dt),
      damp(p.body.scale.z, stretchXZ, 14, dt)
    );

    // Posición vertical del cuerpo y sombra de contacto
    const walkBob = Math.abs(Math.sin(a.walkPhase)) * 0.045 * wb;
    const sitDrop = -SIT_DROP * sitEase;
    p.body.position.y = sitDrop + walkBob;
    a.group.position.y = damp(a.group.position.y, jumpY, 18, dt);

    const shadowScale = clamp(1 - a.group.position.y * 1.1, 0.55, 1);
    p.shadow.scale.setScalar(shadowScale);
    p.shadow.material.opacity = (this.theme === 'dark' ? 0.26 : 0.15) * shadowScale;

    // Objetivos de cada articulación
    const s = Math.sin(a.walkPhase);
    const c = Math.cos(a.walkPhase);

    const walkThighL = s * 0.58;
    const walkThighR = -s * 0.58;
    const walkShinL = Math.max(0, Math.sin(a.walkPhase + 0.65)) * 0.85;
    const walkShinR = Math.max(0, -Math.sin(a.walkPhase + 0.65)) * 0.85;

    let restThigh = (-Math.PI / 2) * sitEase;
    let restShin = (Math.PI / 2) * sitEase;
    let restThighR = restThigh;
    let restShinR = restShin;
    if (a.interaction && a.interaction.type === 'dance' && !seated) {
      const groove = Math.sin(a.interaction.t * 7.5);
      restThigh = -0.18 + Math.max(0, groove) * 0.28;
      restThighR = -0.18 + Math.max(0, -groove) * 0.28;
      restShin = 0.34 + Math.max(0, -groove) * 0.28;
      restShinR = 0.34 + Math.max(0, groove) * 0.28;
    }

    const tgtThighL = restThigh * (1 - wb) + walkThighL * wb;
    const tgtThighR = restThighR * (1 - wb) + walkThighR * wb;
    const tgtShinL = restShin * (1 - wb) + walkShinL * wb;
    const tgtShinR = restShinR * (1 - wb) + walkShinR * wb;

    p.thighL.rotation.x = damp(p.thighL.rotation.x, tgtThighL, 16, dt);
    p.thighR.rotation.x = damp(p.thighR.rotation.x, tgtThighR, 16, dt);
    p.shinL.rotation.x = damp(p.shinL.rotation.x, tgtShinL, 16, dt);
    p.shinR.rotation.x = damp(p.shinR.rotation.x, tgtShinR, 16, dt);

    // Inclinación y giro natural del tronco
    const standShift = Math.sin(a.sit * Math.PI) * 0.2;
    let torsoX = standShift + wb * 0.08;
    let torsoY = wb * s * 0.09;
    let torsoZ = wb * c * 0.035;

    let headX = 0;
    let headY = -torsoY * 0.65;
    let headZ = 0;

    let aLX = 0;
    let aLZ = 0.08;
    let eLX = -0.18;
    let aRX = 0;
    let aRZ = -0.08;
    let eRX = -0.18;
    let exprMood = 'neutral';

    if (wb > 0.35) {
      aLX = -s * 0.5;
      aRX = s * 0.5;
      aLZ = 0.07;
      aRZ = -0.07;
      eLX = -0.22 - Math.max(0, s) * 0.36;
      eRX = -0.22 - Math.max(0, -s) * 0.36;
      exprMood = d.status === 'idle' ? 'happy' : 'neutral';
    } else if (a.interaction) {
      const it = a.interaction.t;
      const type = a.interaction.type;
      if (type === 'wave') {
        exprMood = 'happy';
        torsoX = -0.04;
        torsoZ = 0.06;
        aLX = seated ? -0.42 : 0.05;
        eLX = seated ? -1.0 : -0.22;
        aRX = -2.62 + Math.sin(it * 10) * 0.14;
        aRZ = -0.32 - Math.sin(it * 10) * 0.22;
        eRX = -0.35 + Math.sin(it * 10 + 0.5) * 0.32;
        headX = -0.08;
        headZ = -0.1;
      } else if (type === 'cheer') {
        exprMood = 'excited';
        torsoX = -0.08;
        torsoY = Math.sin(it * 5.5) * 0.16;
        aLX = -2.65 + Math.sin(it * 11) * 0.22;
        aLZ = 0.35;
        eLX = -0.4 + Math.sin(it * 11) * 0.22;
        aRX = -2.65 + Math.sin(it * 11 + 1.2) * 0.22;
        aRZ = -0.35;
        eRX = -0.4 + Math.sin(it * 11 + 1.2) * 0.22;
        headX = -0.14;
        headZ = Math.sin(it * 6) * 0.08;
      } else if (type === 'coffee') {
        exprMood = 'love';
        // Dos sorbos relajados de café humeante
        const sipWave = Math.max(0, Math.sin(it * 2.5));
        torsoX = -0.02 - sipWave * 0.04;
        aLX = seated ? -0.42 : 0.06;
        eLX = seated ? -1.0 : -0.25;
        aRX = -0.78 - sipWave * 0.58;
        aRZ = 0.14 + sipWave * 0.16;
        eRX = -1.18 - sipWave * 0.55;
        headX = -0.06 - sipWave * 0.12;
        headZ = 0.06;
        if (p.coffeeProp) {
          a.coffeeScale = damp(a.coffeeScale || 0.001, 1, 12, dt);
          p.coffeeProp.visible = true;
          p.coffeeProp.scale.setScalar(a.coffeeScale);
          p.steamPuffs.forEach((sp, si) => {
            const ph = (this.time * 1.4 + si * 0.33) % 1;
            sp.position.set(Math.sin(ph * 6 + si) * 0.015, 0.09 + ph * 0.16, 0);
            sp.scale.setScalar((1 - ph) * 1.15 + 0.25);
          });
        }
      } else if (type === 'dance') {
        exprMood = 'excited';
        const g1 = Math.sin(it * 7.5);
        const g2 = Math.cos(it * 7.5);
        torsoX = 0.06 + Math.abs(g1) * 0.06;
        torsoY = g1 * 0.28;
        torsoZ = g2 * 0.12;
        aLX = -1.45 + g1 * 0.65;
        aLZ = 0.36 + g2 * 0.22;
        eLX = -1.15 - g2 * 0.45;
        aRX = -1.45 - g1 * 0.65;
        aRZ = -0.36 + g2 * 0.22;
        eRX = -1.15 + g2 * 0.45;
        headY = -g1 * 0.22;
        headZ = g2 * 0.14;
      }
    } else if (celebrating) {
      exprMood = 'excited';
      aLX = -2.65 + Math.sin(t * 9.5) * 0.16;
      aLZ = 0.32 + Math.sin(t * 7.5) * 0.12;
      eLX = -0.32 + Math.sin(t * 11) * 0.18;
      aRX = -2.65 + Math.sin(t * 9.5 + 1.1) * 0.16;
      aRZ = -0.32 - Math.sin(t * 7.5 + 0.5) * 0.12;
      eRX = -0.32 + Math.sin(t * 11 + 1.1) * 0.18;
      torsoX = -0.08;
      torsoY = Math.sin(t * 4.5) * 0.14;
      headX = -0.14 + Math.sin(t * 8) * 0.06;
      headZ = Math.sin(t * 5) * 0.08;
    } else if (d.status === 'waiting') {
      exprMood = 'surprised';
      aLX = seated ? -0.45 : 0.04;
      aLZ = seated ? 0.04 : 0.08;
      eLX = seated ? -1.05 : -0.2;
      aRX = -2.68 + Math.sin(t * 5.2) * 0.12;
      aRZ = -0.22 - Math.sin(t * 5.2) * 0.14;
      eRX = -0.38 + Math.sin(t * 5.2 + 0.6) * 0.28;
      torsoX = seated ? 0.02 : -0.04;
      torsoZ = 0.05;
      headX = -0.08;
      headY = Math.sin(t * 1.9) * 0.24;
      headZ = -0.07;
    } else if (isError) {
      exprMood = 'sad';
      aLX = seated ? -0.58 : -0.38;
      aRX = seated ? -0.58 : -0.38;
      aLZ = 0.22;
      aRZ = -0.22;
      eLX = -1.15;
      eRX = -1.15;
      torsoX = 0.12;
      headX = 0.08;
      headY = Math.sin(t * 11) * 0.22;
      headZ = Math.sin(t * 6) * 0.06;
    } else if (d.status === 'working') {
      const thinking = !d.tool || d.activity === 'Pensando' || d.activity === 'Arrancando';
      const reading = d.tool === 'Read' || d.tool === 'Grep' || d.tool === 'Glob' || d.tool === 'WebSearch' || d.tool === 'WebFetch';

      if (seated && thinking) {
        exprMood = 'thinking';
        torsoX = 0.08;
        aLX = -0.42;
        aLZ = 0.04;
        eLX = -1.05;
        aRX = -0.95 + Math.sin(t * 1.5) * 0.04;
        aRZ = 0.18;
        eRX = -1.58;
        headX = 0.04 + Math.sin(t * 1.1) * 0.04;
        headY = Math.sin(t * 0.75) * 0.12;
        headZ = 0.1 + Math.sin(t * 0.9) * 0.03;
      } else if (seated && reading) {
        exprMood = 'focused';
        torsoX = 0.09;
        aLX = -0.42;
        aLZ = 0.05;
        eLX = -1.08;
        aRX = -0.45 + Math.sin(t * 2.8) * 0.035;
        aRZ = -0.08 + Math.cos(t * 2.2) * 0.04;
        eRX = -1.06;
        headX = 0.11;
        headY = Math.sin(t * 1.35) * 0.14;
        headZ = Math.sin(t * 0.8) * 0.03;
      } else if (seated) {
        exprMood = 'focused';
        const burst = 0.45 + 0.55 * smoothstep(0.5 + 0.5 * Math.sin(t * 2.1));
        torsoX = 0.11 + Math.sin(t * 3.2) * 0.015;
        aLX = -0.46 + Math.sin(t * 13.5) * 0.045 * burst;
        aRX = -0.46 + Math.sin(t * 13.5 + 2.3) * 0.045 * burst;
        aLZ = 0.05;
        aRZ = -0.05;
        eLX = -1.16 + Math.cos(t * 14.5) * 0.08 * burst;
        eRX = -1.16 + Math.cos(t * 14.5 + 2.1) * 0.08 * burst;
        headX = 0.13 + Math.sin(t * 2.4) * 0.025;
        headY = Math.sin(t * 1.05) * 0.09;
      } else {
        exprMood = 'focused';
        torsoX = 0.06;
        aLX = -0.48;
        aRX = -0.52 + Math.sin(t * 9) * 0.04;
        aLZ = 0.04;
        aRZ = -0.04;
        eLX = -1.18;
        eRX = -1.15 + Math.cos(t * 9) * 0.06;
        headX = 0.18;
        headY = Math.sin(t * 0.9) * 0.08;
      }
    } else if (seated) {
      exprMood = 'neutral';
      torsoX = 0.04;
      aLX = -0.35;
      aRX = -0.35;
      eLX = -0.95;
      eRX = -0.95;
      headX = 0.05;
      headY = Math.sin(t * 0.6) * 0.14;
    } else {
      exprMood = 'happy';
      torsoZ = Math.sin(t * 0.9) * 0.028;
      torsoY = Math.sin(t * 0.55) * 0.06;
      aLX = Math.sin(t * 1.1) * 0.05;
      aRX = Math.sin(t * 1.1 + 1.4) * 0.05;
      aLZ = 0.09 + breath * 0.012;
      aRZ = -0.09 - breath * 0.012;
      eLX = -0.22 + Math.sin(t * 0.9) * 0.04;
      eRX = -0.22 + Math.cos(t * 0.9) * 0.04;
      const specBall = this.pingPong && this.pingPong.lookTargetForSpectator();
      if (specBall) {
        const ang = Math.atan2(specBall.x - a.group.position.x, specBall.z - a.group.position.z);
        headY = clamp(wrapAngle(ang - a.yaw), -0.65, 0.65);
        headX = 0.06;
      } else {
        headY = Math.sin(t * 0.65) * 0.28;
      }
      headZ = Math.sin(t * 0.48) * 0.05;
    }

    // Amortiguación exponencial uniforme en cada articulación
    p.torso.rotation.x = damp(p.torso.rotation.x, torsoX, 11, dt);
    p.torso.rotation.y = damp(p.torso.rotation.y, torsoY, 11, dt);
    p.torso.rotation.z = damp(p.torso.rotation.z, torsoZ, 11, dt);

    p.head.rotation.x = damp(p.head.rotation.x, headX, 10, dt);
    p.head.rotation.y = damp(p.head.rotation.y, headY, 9, dt);
    p.head.rotation.z = damp(p.head.rotation.z, headZ, 10, dt);

    p.armL.rotation.x = damp(p.armL.rotation.x, aLX, 13, dt);
    p.armL.rotation.z = damp(p.armL.rotation.z, aLZ, 13, dt);
    p.elbowL.rotation.x = damp(p.elbowL.rotation.x, eLX, 14, dt);

    p.armR.rotation.x = damp(p.armR.rotation.x, aRX, 13, dt);
    p.armR.rotation.z = damp(p.armR.rotation.z, aRZ, 13, dt);
    p.elbowR.rotation.x = damp(p.elbowR.rotation.x, eRX, 14, dt);

    // Expresión facial dinámica y burbuja flotante de reacción
    this._updateExpression(a, dt, exprMood);
    this._updateReactionBubble(a, dt, sitEase);

    // Baliza elegante con transición suave de color y halo giratorio
    const targetHex = isError ? STATUS_COLOR.error : STATUS_COLOR[d.status] || STATUS_COLOR.idle;
    this._tmpColor2.setHex(targetHex);
    a.beaconColor.lerp(this._tmpColor2, 1 - Math.exp(-8 * dt));
    p.beacon.material.color.copy(a.beaconColor);
    p.beacon.material.emissive.copy(a.beaconColor);
    p.beaconHalo.material.color.copy(a.beaconColor);

    const beaconY = 2.16 - SIT_DROP * sitEase + Math.sin(t * 2.2) * 0.045;
    p.beaconGroup.position.y = damp(p.beaconGroup.position.y, beaconY, 12, dt);
    p.beacon.rotation.y += dt * (d.status === 'working' ? 2.6 : 1.0);
    p.beaconHalo.rotation.z += dt * (d.status === 'working' ? 2.2 : 0.8);
    const pulse = d.status === 'waiting' ? 1 + Math.sin(t * 6.2) * 0.22 : 1 + Math.sin(t * 2.4) * 0.04;
    p.beaconGroup.scale.setScalar(damp(p.beaconGroup.scale.x, pulse, 12, dt));
    p.beaconHalo.material.opacity = d.status === 'waiting' ? 0.55 : d.status === 'working' ? 0.36 : 0.2;

    // Partículas sutiles al celebrar o recibir kudos/baile
    const showSparks = celebrating || (a.interaction && (a.interaction.type === 'cheer' || a.interaction.type === 'dance'));
    if (showSparks) {
      p.sparks.visible = true;
      const elapsed = celebrating ? Math.max(0, this.time - a.doneAt) : a.interaction.t;
      const dur = celebrating ? 2.6 : a.interaction.dur;
      const fade = clamp(1 - elapsed / dur, 0, 1);
      p.sparks.children.forEach((sp, i) => {
        const ang = (i / 6) * Math.PI * 2 + elapsed * 2.6;
        const rad = 0.28 + Math.sin(elapsed * 3 + i) * 0.14 + elapsed * 0.12;
        sp.position.set(Math.cos(ang) * rad, 1.5 - SIT_DROP * sitEase + ((elapsed * 0.7 + i * 0.2) % 1.05), Math.sin(ang) * rad);
        sp.scale.setScalar(0.75 + Math.sin(elapsed * 9 + i) * 0.25);
      });
      p.sparks.children[0].material.color.setHex(a.interaction?.type === 'dance' ? 0xec4899 : a.interaction?.type === 'cheer' ? 0xf59e0b : STATUS_COLOR.done);
      p.sparks.children[0].material.opacity = fade * 0.9;
    } else if (p.sparks.visible) {
      p.sparks.visible = false;
    }

    // Anillo de selección / hover suavemente animado
    const isSel = this.selectedId === a.id;
    const isHov = this.hoveredId === a.id;
    const targetRingAlpha = isSel ? 0.88 : isHov ? 0.42 : 0;
    a.ringAlpha = damp(a.ringAlpha, targetRingAlpha, 12, dt);
    const showRing = a.ringAlpha > 0.015;
    p.ring.visible = showRing;
    p.ringOuter.visible = isSel && showRing;
    if (showRing) {
      const ringPulse = isSel ? 1 + Math.sin(t * 3.4) * 0.04 : 1;
      p.ring.material.opacity = a.ringAlpha;
      p.ring.scale.setScalar(ringPulse);
      p.ringOuter.material.opacity = a.ringAlpha * 0.38;
      p.ringOuter.scale.setScalar(1 + Math.sin(t * 3.4 - 0.8) * 0.06);
    }

    // Visibilidad y posición suave de etiqueta flotante
    const showLabel = this.labelMode !== 'hidden' || isSel || isHov;
    a.label.sprite.visible = showLabel;
    if (showLabel) {
      const labelY = 2.58 - SIT_DROP * sitEase + (this.labelMode === 'compact' ? -0.05 : 0);
      a.label.sprite.position.y = damp(a.label.sprite.position.y, labelY, 12, dt);
      const targetOp = isSel || isHov ? 1 : 0.9;
      a.label.sprite.material.opacity = damp(a.label.sprite.material.opacity, targetOp, 10, dt);
    }
  }

  _updateScreens(dt) {
    const alpha = 1 - Math.exp(-8 * dt);
    let anyActiveScreen = false;
    for (const desk of this.desks) {
      const a = desk.owner ? this.actors.get(desk.owner) : null;
      const seatedHere = Boolean(a && a.arrived && a.target && a.target.type === 'seat' && a.sit > 0.5);
      if (!seatedHere && desk._darkSettled) continue;

      let hex = 0x1c2532;
      let glowHex = 0x3b82f6;
      let glowOpacity = 0;

      if (seatedHere) {
        desk._darkSettled = false;
        const s = a.data.status;
        if (s === 'working') {
          anyActiveScreen = true;
          hex = 0xffffff;
          glowHex = 0x60a5fa;
          glowOpacity = this.theme === 'dark' ? 0.24 : 0.11;
        } else if (s === 'waiting') {
          hex = 0xffcf7d;
          glowHex = 0xf59e0b;
          glowOpacity = this.theme === 'dark' ? 0.26 : 0.14;
        } else if (s === 'error') {
          hex = 0xff9494;
          glowHex = 0xef4444;
          glowOpacity = this.theme === 'dark' ? 0.26 : 0.14;
        } else {
          hex = 0x526173;
          glowOpacity = 0;
        }
      }

      this._tmpColor.setHex(hex);
      desk.screenMat.color.lerp(this._tmpColor, alpha);

      this._tmpColor2.setHex(glowHex);
      desk.glowMat.color.lerp(this._tmpColor2, alpha);
      desk.glowMat.opacity = damp(desk.glowMat.opacity, glowOpacity, 8, dt);
      if (desk.glowMesh) desk.glowMesh.visible = desk.glowMat.opacity > 0.005;

      // Leve giro orgánico de la silla acompañando al ocupante
      const chairTargetRot = seatedHere ? Math.sin(this.time * 0.9 + desk.index) * 0.045 : 0;
      desk.chairUpper.rotation.y = damp(desk.chairUpper.rotation.y, chairTargetRot, 6, dt);

      if (
        !seatedHere &&
        desk.glowMat.opacity <= 0.005 &&
        Math.abs(desk.chairUpper.rotation.y) < 0.001 &&
        Math.abs(desk.screenMat.color.r - this._tmpColor.r) < 0.004
      ) {
        desk.screenMat.color.setHex(hex);
        desk.glowMat.opacity = 0;
        if (desk.glowMesh) desk.glowMesh.visible = false;
        desk.chairUpper.rotation.y = 0;
        desk._darkSettled = true;
      }
    }
    if (anyActiveScreen) {
      this.screenTex.offset.y = (this.time * 0.28) % 1;
    }
  }
}

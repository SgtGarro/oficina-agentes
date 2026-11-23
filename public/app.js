import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { Office, STATUS_LABEL, colorFor } from './office.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

const SHORT_STATUS = {
  working: 'Activo',
  idle: 'Libre',
  waiting: 'Atención',
  done: 'Listo',
  error: 'Error',
};

const LABEL_MODES = [
  { id: 'full', text: 'Etiquetas' },
  { id: 'compact', text: 'Compactas' },
  { id: 'hidden', text: 'Ocultas' },
];

// ---------------------------------------------------------------- escena 3D
const canvas = $('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  $('fallback').hidden = false;
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const office = new Office(THREE);
const camera = new THREE.PerspectiveCamera(35, 1, 1, 160);
const HOME = { pos: new THREE.Vector3(16.8, 14.8, 19.2), target: new THREE.Vector3(-0.3, 0.7, 0.4) };
camera.position.copy(HOME.pos);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.rotateSpeed = 0.75;
controls.zoomSpeed = 0.85;
controls.panSpeed = 0.75;
controls.minDistance = 5.5;
controls.maxDistance = 46;
controls.maxPolarAngle = Math.PI * 0.465;
controls.update();

// Estado de vista / cámara suave
let viewportW = window.innerWidth;
let viewportH = window.innerHeight;
let panelCollapsed = false;
let curOffsetX = 0;
let curOffsetY = 0;
let tgtOffsetX = 0;
let tgtOffsetY = 0;
let focusId = null;
let cameraGlide = null;
let focusPullAnim = false;
let latestAgents = new Map();
let ppOpen = false;
let lastGamesVer = -1;
let lastGamesTab = '';
let ecoMode = false;
let needsRender = true;
let lastFrameAt = 0;

function wakeRender() {
  needsRender = true;
}

function computeTargetOffset() {
  if (viewportW > 760) {
    tgtOffsetX = panelCollapsed ? 0 : -174;
    tgtOffsetY = 0;
  } else {
    tgtOffsetX = 0;
    tgtOffsetY = panelCollapsed ? 0 : Math.round(viewportH * 0.2);
  }
}

function applyViewOffset(x, y) {
  camera.setViewOffset(viewportW, viewportH, Math.round(x), Math.round(y), viewportW, viewportH);
  camera.updateProjectionMatrix();
}

function resize() {
  viewportW = window.innerWidth;
  viewportH = window.innerHeight;
  renderer.setPixelRatio(ecoMode ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(viewportW, viewportH, false);
  camera.aspect = viewportW / viewportH;
  computeTargetOffset();
  curOffsetX = tgtOffsetX;
  curOffsetY = tgtOffsetY;
  applyViewOffset(curOffsetX, curOffsetY);
  wakeRender();
}
window.addEventListener('resize', resize);
resize();

controls.addEventListener('start', () => {
  cameraGlide = null;
  focusPullAnim = false;
  wakeRender();
});
controls.addEventListener('change', wakeRender);

// ------------------------------------------------------------ tema y opciones
function applyEcoMode(enabled) {
  ecoMode = Boolean(enabled);
  document.body.classList.toggle('eco-mode', ecoMode);
  renderer.setPixelRatio(ecoMode ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(viewportW, viewportH, false);
  renderer.shadowMap.enabled = !ecoMode;
  renderer.shadowMap.needsUpdate = true;
  office.setShadows(!ecoMode);
  const btn = $('ecoToggle');
  if (btn) {
    btn.classList.toggle('is-active', ecoMode);
    btn.setAttribute('aria-pressed', String(ecoMode));
    btn.title = ecoMode ? 'Modo ahorro activo (30 FPS, sin sombras ni blur)' : 'Modo ahorro: reduce sombras, blur y FPS para menor consumo de GPU';
  }
  wakeRender();
  try {
    localStorage.setItem('oficina-eco', ecoMode ? '1' : '0');
  } catch {}
}

try {
  if (localStorage.getItem('oficina-eco') === '1') applyEcoMode(true);
} catch {}

if ($('ecoToggle')) {
  $('ecoToggle').addEventListener('click', () => applyEcoMode(!ecoMode));
}

function applyTheme(mode) {
  const theme = mode === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  office.setTheme(theme);
  $('themeToggle').title = theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
  wakeRender();
  try {
    localStorage.setItem('oficina-theme', theme);
  } catch {}
}

let savedTheme = null;
try {
  savedTheme = localStorage.getItem('oficina-theme');
} catch {}
applyTheme(savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

$('themeToggle').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

let labelIdx = 0;
try {
  const savedLabel = localStorage.getItem('oficina-labels');
  const found = LABEL_MODES.findIndex((m) => m.id === savedLabel);
  if (found >= 0) labelIdx = found;
} catch {}

function applyLabelMode() {
  const m = LABEL_MODES[labelIdx];
  office.setLabelMode(m.id);
  $('labelToggleText').textContent = m.text;
  $('labelToggle').classList.toggle('is-active', m.id !== 'full');
  wakeRender();
  try {
    localStorage.setItem('oficina-labels', m.id);
  } catch {}
}
applyLabelMode();

$('labelToggle').addEventListener('click', () => {
  labelIdx = (labelIdx + 1) % LABEL_MODES.length;
  applyLabelMode();
});

function setPanelCollapsed(collapsed) {
  panelCollapsed = collapsed;
  document.body.classList.toggle('panel-collapsed', collapsed);
  computeTargetOffset();
  wakeRender();
}
$('panelCollapse').addEventListener('click', () => setPanelCollapsed(true));
$('panelReveal').addEventListener('click', () => setPanelCollapsed(false));

// ------------------------------------------------------------ bucle principal
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
const prevTarget = new THREE.Vector3();
const deltaVec = new THREE.Vector3();
const desiredPos = new THREE.Vector3();
const lastCamPos = new THREE.Vector3();
const lastCamTarget = new THREE.Vector3();

function renderFrame(now) {
  const minFrameMs = ecoMode ? 32 : 15.5;
  if (lastFrameAt && now - lastFrameAt < minFrameMs) return;
  lastFrameAt = now;

  const dt = Math.min(clock.getDelta(), 0.05);
  const offsetMoving = Math.abs(curOffsetX - tgtOffsetX) > 0.4 || Math.abs(curOffsetY - tgtOffsetY) > 0.4;
  const sceneIdle = office.isSceneIdle() && !cameraGlide && !focusId && !offsetMoving;

  if (sceneIdle && !needsRender) {
    controls.update();
    if (camera.position.distanceToSquared(lastCamPos) < 1e-6 && controls.target.distanceToSquared(lastCamTarget) < 1e-6) {
      return;
    }
  }
  needsRender = false;

  office.update(dt);

  // Desplazamiento suave del encuadre al colapsar/mostrar el panel
  if (offsetMoving) {
    curOffsetX = damp(curOffsetX, tgtOffsetX, 10, dt);
    curOffsetY = damp(curOffsetY, tgtOffsetY, 10, dt);
    applyViewOffset(curOffsetX, curOffsetY);
  }

  // Seguimiento en 1ª persona (POV) cuando el usuario está jugando un minijuego
  const fpCam = office.humanCameraTarget();
  if (fpCam) {
    cameraGlide = null;
    controls.enabled = false;
    const k = 1 - Math.exp(-11 * dt);
    camera.position.lerp(fpCam.pos, k);
    controls.target.lerp(fpCam.target, k);
  } else {
    if (!poolPointerCharging && !dartPointerAiming) {
      controls.enabled = true;
    }
    // Transición suave de cámara (restablecer o enfocar mesa)
    if (cameraGlide) {
      const k = 1 - Math.exp(-6.5 * dt);
      camera.position.lerp(cameraGlide.pos, k);
      controls.target.lerp(cameraGlide.target, k);
      if (camera.position.distanceTo(cameraGlide.pos) < 0.03 && controls.target.distanceTo(cameraGlide.target) < 0.03) {
        camera.position.copy(cameraGlide.pos);
        controls.target.copy(cameraGlide.target);
        cameraGlide = null;
      }
    } else if (focusId) {
      const p = office.actorPosition(focusId);
      if (p) {
        tmp.set(p.x, 1.05, p.z);
        prevTarget.copy(controls.target);
        const k = 1 - Math.exp(-6.5 * dt);
        controls.target.lerp(tmp, k);
        deltaVec.copy(controls.target).sub(prevTarget);
        camera.position.add(deltaVec);

        // Acercamiento gentil si la cámara estaba muy lejos al seleccionar
        if (focusPullAnim) {
          const dist = camera.position.distanceTo(controls.target);
          if (dist > 13.5) {
            desiredPos.copy(camera.position).sub(controls.target).setLength(12.2).add(controls.target);
            camera.position.lerp(desiredPos, 1 - Math.exp(-5 * dt));
          } else {
            focusPullAnim = false;
          }
        }
      }
    }
  }

  syncPingPongUI();
  controls.update();
  lastCamPos.copy(camera.position);
  lastCamTarget.copy(controls.target);
  office.syncLabelVisibility(camera.position);
  renderer.render(office.scene, camera);
}

renderer.setAnimationLoop(renderFrame);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    renderer.setAnimationLoop(null);
  } else {
    clock.getDelta();
    lastFrameAt = 0;
    wakeRender();
    renderer.setAnimationLoop(renderFrame);
  }
});

// -------------------------------------------------- selección, hover y juego interactivo en 3D
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const ppPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.76);
const ppPaddlePlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -6.64);
const poolPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.836);
const dartsPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 7.86);
const planeHit = new THREE.Vector3();
let downAt = null;
let lastMouseX = null;
let dragging = false;
let poolPointerCharging = false;
let dartPointerAiming = false;
let lastHoverCheck = 0;

function activeHumanGame() {
  const all = office.gamesState();
  if (all.pingpong && all.pingpong.humanMode) return 'pingpong';
  if (all.billiards && all.billiards.humanMode) return 'billiards';
  if (all.darts && all.darts.humanMode) return 'darts';
  return null;
}

function updatePointer(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
}

function updateHumanPingPongAim(e) {
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  if (office.firstPersonMode && raycaster.ray.intersectPlane(ppPaddlePlane, planeHit)) {
    const z = planeHit.z;
    const aimZ = 2.3 + (z - 2.3) * 1.12;
    office.gameHumanInput('pingpong', { type: 'move_z', z, aimZ });
    wakeRender();
    return true;
  }
  if (raycaster.ray.intersectPlane(ppPlane, planeHit)) {
    if (Math.abs(planeHit.x - 8.1) < 3.8 && Math.abs(planeHit.z - 2.3) < 1.85) {
      office.gameHumanInput('pingpong', { type: 'move_z', z: planeHit.z, aimZ: planeHit.z });
      wakeRender();
      return true;
    }
  }
  return false;
}

canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
  lastMouseX = e.clientX;
  dragging = true;

  const hGame = activeHumanGame();
  if (!hGame || e.button !== 0) return;

  if (hGame === 'pingpong') {
    updateHumanPingPongAim(e);
    if (office.firstPersonMode) {
      office.gameHumanInput('pingpong', { type: 'action' });
      lastGamesVer = -1;
      wakeRender();
      syncPingPongUI();
    }
  } else if (hGame === 'billiards') {
    const st = office.gamesState().billiards;
    if (st && st.p0 && st.p0.activeTurn && (st.phase === 'aim' || st.phase === 'position')) {
      if (office.firstPersonMode) {
        poolPointerCharging = true;
        controls.enabled = false;
        office.gameHumanInput('billiards', { type: 'charge_start' });
        wakeRender();
      } else {
        updatePointer(e);
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.ray.intersectPlane(poolPlane, planeHit)) {
          if (Math.abs(planeHit.x - 7.85) < 1.55 && Math.abs(planeHit.z - (-2.05)) < 1.0) {
            poolPointerCharging = true;
            controls.enabled = false;
            office.gameHumanInput('billiards', { type: 'aim_point', x: planeHit.x, z: planeHit.z });
            office.gameHumanInput('billiards', { type: 'charge_start' });
            wakeRender();
          }
        }
      }
    }
  } else if (hGame === 'darts') {
    const st = office.gamesState().darts;
    if (st && st.p0 && st.p0.activeTurn && st.phase === 'aim') {
      updatePointer(e);
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(dartsPlane, planeHit)) {
        if (office.firstPersonMode || Math.hypot(planeHit.x - 10.35, planeHit.y - 1.75) < 0.85) {
          dartPointerAiming = true;
          controls.enabled = false;
          office.gameHumanInput('darts', { type: 'aim_point', x: planeHit.x, y: planeHit.y });
          office.gameHumanInput('darts', { type: 'steady', active: true });
          wakeRender();
        }
      }
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  const dx = lastMouseX !== null ? e.clientX - lastMouseX : 0;
  lastMouseX = e.clientX;
  const hGame = activeHumanGame();

  if (hGame === 'pingpong' && (!dragging || office.firstPersonMode)) {
    updateHumanPingPongAim(e);
  } else if (hGame === 'billiards') {
    if (office.firstPersonMode) {
      if (poolPointerCharging && downAt) {
        if (Math.abs(dx) > 0) {
          office.gameHumanInput('billiards', { type: 'aim_delta', delta: dx * 0.0012 });
        }
        const dy = e.clientY - downAt.y;
        if (dy > 6) {
          const pwr = 1.3 + Math.min(2.5, (dy / 135) * 2.5);
          office.gameHumanInput('billiards', { type: 'power', power: pwr, manualPull: true });
        }
        wakeRender();
      } else if (!dragging && Math.abs(dx) > 0) {
        office.gameHumanInput('billiards', { type: 'aim_delta', delta: dx * 0.0046 });
        wakeRender();
      }
    } else if (!dragging || poolPointerCharging) {
      updatePointer(e);
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(poolPlane, planeHit)) {
        if (Math.abs(planeHit.x - 7.85) < 2.6 && Math.abs(planeHit.z - (-2.05)) < 1.75) {
          office.gameHumanInput('billiards', { type: 'aim_point', x: planeHit.x, z: planeHit.z });
          wakeRender();
        }
      }
    }
  } else if (hGame === 'darts' && (!dragging || dartPointerAiming || office.firstPersonMode)) {
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(dartsPlane, planeHit)) {
      if (office.firstPersonMode || Math.hypot(planeHit.x - 10.35, planeHit.y - 1.75) < 0.95) {
        office.gameHumanInput('darts', { type: 'aim_point', x: planeHit.x, y: planeHit.y });
        wakeRender();
      }
    }
  }

  if (office.humanCameraTarget()) return;

  if (dragging) {
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) {
      office.setHovered(null);
      canvas.classList.remove('is-hovering');
    }
    return;
  }
  const now = performance.now();
  if (now - lastHoverCheck < 45) return;
  lastHoverCheck = now;
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hit = office.pick(raycaster);
  office.setHovered(hit);
  canvas.classList.toggle('is-hovering', Boolean(hit));
  wakeRender();
});

canvas.addEventListener('pointerleave', () => {
  dragging = false;
  lastMouseX = null;
  if (poolPointerCharging) {
    poolPointerCharging = false;
    controls.enabled = !office.humanCameraTarget();
    office.gameHumanInput('billiards', { type: 'shoot' });
  }
  if (dartPointerAiming) {
    dartPointerAiming = false;
    controls.enabled = !office.humanCameraTarget();
    office.gameHumanInput('darts', { type: 'steady', active: false });
  }
  office.setHovered(null);
  canvas.classList.remove('is-hovering');
});

canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  if (poolPointerCharging) {
    poolPointerCharging = false;
    controls.enabled = !office.humanCameraTarget();
    office.gameHumanInput('billiards', { type: 'shoot' });
    lastGamesVer = -1;
    wakeRender();
    syncPingPongUI();
    return;
  }
  if (dartPointerAiming) {
    dartPointerAiming = false;
    controls.enabled = !office.humanCameraTarget();
    office.gameHumanInput('darts', { type: 'throw' });
    lastGamesVer = -1;
    wakeRender();
    syncPingPongUI();
    return;
  }
  if (office.humanCameraTarget()) return;
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);

  // En vista general (no 1ª persona), clic sobre la mesa de Ping-Pong o diana ejecuta la acción
  const hGame = activeHumanGame();
  if (hGame === 'pingpong' && raycaster.ray.intersectPlane(ppPlane, planeHit)) {
    if (Math.abs(planeHit.x - 8.1) < 2.9 && Math.abs(planeHit.z - 2.3) < 1.45) {
      office.gameHumanInput('pingpong', { type: 'move_z', z: planeHit.z, aimZ: planeHit.z });
      office.gameHumanInput('pingpong', { type: 'action' });
      lastGamesVer = -1;
      wakeRender();
      syncPingPongUI();
      return;
    }
  } else if (hGame === 'darts' && raycaster.ray.intersectPlane(dartsPlane, planeHit)) {
    if (Math.hypot(planeHit.x - 10.35, planeHit.y - 1.75) < 0.78) {
      office.gameHumanInput('darts', { type: 'aim_point', x: planeHit.x, y: planeHit.y });
      office.gameHumanInput('darts', { type: 'throw' });
      lastGamesVer = -1;
      wakeRender();
      syncPingPongUI();
      return;
    }
  }

  const hit = office.pick(raycaster);
  select(hit && hit === focusId ? null : hit);
});

canvas.addEventListener('dblclick', (e) => {
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hit = office.pick(raycaster);
  if (hit) {
    select(hit);
    office.interact(hit, 'wave', camera.position);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    select(null);
    return;
  }
  const hGame = activeHumanGame();
  if (!hGame) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    if (hGame === 'pingpong') office.gameHumanInput('pingpong', { type: 'action' });
    else if (hGame === 'billiards') office.gameHumanInput('billiards', { type: 'shoot' });
    else if (hGame === 'darts') office.gameHumanInput('darts', { type: 'throw' });
    lastGamesVer = -1;
    wakeRender();
    syncPingPongUI();
  } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
    e.preventDefault();
    if (hGame === 'pingpong') office.gameHumanInput('pingpong', { type: 'move_delta', delta: -0.15 });
    else if (hGame === 'billiards') office.gameHumanInput('billiards', { type: 'aim_delta', delta: -0.055 });
    else if (hGame === 'darts') office.gameHumanInput('darts', { type: 'aim_delta', dx: -0.032, dy: 0 });
    wakeRender();
  } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    if (hGame === 'pingpong') office.gameHumanInput('pingpong', { type: 'move_delta', delta: 0.15 });
    else if (hGame === 'billiards') office.gameHumanInput('billiards', { type: 'aim_delta', delta: 0.055 });
    else if (hGame === 'darts') office.gameHumanInput('darts', { type: 'aim_delta', dx: 0.032, dy: 0 });
    wakeRender();
  } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
    e.preventDefault();
    if (hGame === 'pingpong') office.gameHumanInput('pingpong', { type: 'move_delta', delta: -0.15 });
    else if (hGame === 'billiards') {
      const cur = office.gamesState().billiards;
      office.gameHumanInput('billiards', { type: 'power', power: (cur ? cur.humanPower : 2.6) + 0.15 });
    } else if (hGame === 'darts') office.gameHumanInput('darts', { type: 'aim_delta', dx: 0, dy: 0.032 });
    wakeRender();
  } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
    e.preventDefault();
    if (hGame === 'pingpong') office.gameHumanInput('pingpong', { type: 'move_delta', delta: 0.15 });
    else if (hGame === 'billiards') {
      const cur = office.gamesState().billiards;
      office.gameHumanInput('billiards', { type: 'power', power: (cur ? cur.humanPower : 2.6) - 0.15 });
    } else if (hGame === 'darts') office.gameHumanInput('darts', { type: 'aim_delta', dx: 0, dy: -0.032 });
    wakeRender();
  }
});

function initialOf(name) {
  const clean = String(name || '?').trim();
  return clean ? clean[0].toUpperCase() : '?';
}

function activityLine(a) {
  return a.status === 'working' ? (a.detail ? `${a.activity} · ${a.detail}` : a.activity) : a.detail || a.activity;
}

function updateFocusCard() {
  const card = $('focusCard');
  const a = focusId ? (latestAgents.get(focusId) || office.actorData(focusId)) : null;
  if (!a) {
    card.classList.remove('is-open');
    return;
  }
  const col = hex(colorFor(a));
  const av = $('focusAvatar');
  av.style.background = col;
  av.textContent = initialOf(a.name);

  $('focusName').textContent = a.kind === 'main' ? `${a.name} · ${a.project}` : a.isGuest ? `${a.name} · NPC` : a.name;
  const st = $('focusState');
  st.dataset.status = a.status || 'idle';
  $('focusStateText').textContent = STATUS_LABEL[a.status] || a.status;
  const metaParts = [];
  if (a.kind === 'sub' && a.provider === 'antigravity') metaParts.push('Antigravity');
  if (a.isGuest && !a.isHuman) metaParts.push('Sala de juegos');
  if (a.toolCount) metaParts.push(`${a.toolCount} ${a.toolCount === 1 ? 'acción' : 'acciones'}`);
  $('focusMeta').textContent = metaParts.join(' · ');
  $('focusDetail').textContent = activityLine(a) || 'En espera';

  const isIdle = a.status === 'idle';
  for (const btn of $('interactBar').querySelectorAll('.act-game')) {
    btn.classList.toggle('is-dim', !isIdle);
  }
  card.classList.add('is-open');
}

$('interactBar').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn || !focusId) return;
  const action = btn.dataset.action;
  if (action === 'challenge_game') {
    const targetId = focusId;
    const aData = office.actorData(targetId) || latestAgents.get(targetId);
    const game = (aData && aData.game) || activeGameTab || 'pingpong';
    activeGameTab = game;
    if (aData && !aData.isGuest && aData.status === 'idle') {
      office.interact(targetId, `play_${game}`, camera.position);
    }
    office.setGameHumanMode(game, true, targetId);
    setPingPongOpen(true);
    select(null);
    cameraGlide = office.gameCameraView(game, true);
    lastGamesVer = -1;
    wakeRender();
    syncPingPongUI();
    return;
  }
  office.interact(focusId, action, camera.position);
  if (action === 'play_pingpong') {
    activeGameTab = 'pingpong';
    lastGamesVer = -1;
  } else if (action === 'play_billiards') {
    activeGameTab = 'billiards';
    lastGamesVer = -1;
  } else if (action === 'play_darts') {
    activeGameTab = 'darts';
    lastGamesVer = -1;
  }
  wakeRender();
});

function select(id) {
  focusId = id;
  cameraGlide = null;
  focusPullAnim = Boolean(id);
  office.setSelected(id);
  for (const [aid, el] of items) el.firstChild.setAttribute('aria-pressed', String(aid === id));
  updateFocusCard();
  wakeRender();
}

$('focusClose').addEventListener('click', () => select(null));

$('resetView').addEventListener('click', () => {
  select(null);
  cameraGlide = { pos: HOME.pos.clone(), target: HOME.target.clone() };
  wakeRender();
});

// ------------------------------------------------------ Sala de juegos (3 tabs)
let activeGameTab = 'pingpong';

const GAME_META = {
  pingpong: {
    title: 'Ping-Pong',
    focusLabel: 'Ver mesa',
    rules: [
      'Gana quien llegue a <strong>5 pts</strong> con ventaja de <strong>2</strong> (deuce desde 4–4).',
      'El saque rota cada <strong>2 pts</strong> (cada 1 en deuce).',
      'El ganador permanece en mesa si hay más agentes libres.',
    ],
  },
  billiards: {
    title: 'Mesa de billar',
    focusLabel: 'Ver mesa',
    rules: [
      'Gana quien emboque primero <strong>4 bolas</strong> de color.',
      'Si embocas una bola limpia, <strong>repites turno</strong>.',
      'Falta con la bola blanca cede el turno al rival.',
    ],
  },
  darts: {
    title: 'Dardos',
    focusLabel: 'Ver diana',
    rules: [
      'Cada jugador lanza <strong>3 dardos</strong> por turno.',
      'Bullseye suma <strong>50 pts</strong>, centro <strong>25</strong>, dobles y triples multiplican.',
      'Gana quien alcance primero <strong>150 pts</strong>.',
    ],
  },
};

function setPingPongOpen(open) {
  ppOpen = open;
  $('ppCard').classList.toggle('is-open', open);
  $('ppToggle').classList.toggle('is-active', open);
  if (open) {
    lastGamesVer = -1;
    syncPingPongUI();
  }
}

$('ppToggle').addEventListener('click', () => setPingPongOpen(!ppOpen));
$('ppClose').addEventListener('click', () => setPingPongOpen(false));

for (const tab of document.querySelectorAll('.game-tab')) {
  tab.addEventListener('click', () => {
    activeGameTab = tab.dataset.game;
    for (const t of document.querySelectorAll('.game-tab')) {
      const on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    }
    lastGamesVer = -1;
    syncPingPongUI();
  });
}

$('ppFocusBtn').addEventListener('click', () => {
  select(null);
  const st = office.gamesState()[activeGameTab];
  if (st && st.humanMode) {
    office.setFirstPersonMode(!office.firstPersonMode);
    if (!office.firstPersonMode) {
      cameraGlide = office.gameCameraView(activeGameTab, true);
    }
    lastGamesVer = -1;
    syncPingPongUI();
  } else {
    cameraGlide = office.gameCameraView(activeGameTab, false);
  }
  wakeRender();
});

$('ppSimBtn').addEventListener('click', () => {
  const all = office.gamesState();
  const cur = all[activeGameTab];
  if (cur && cur.humanMode) {
    office.setGameHumanMode(activeGameTab, false);
  }
  const next = !(cur && cur.exhibition);
  office.setGameExhibition(activeGameTab, next);
  if (next) {
    select(null);
    cameraGlide = office.gameCameraView(activeGameTab, false);
  }
  lastGamesVer = -1;
  wakeRender();
  syncPingPongUI();
});

if ($('ppPlayBtn')) {
  $('ppPlayBtn').addEventListener('click', () => {
    const all = office.gamesState();
    const cur = all[activeGameTab];
    const next = !(cur && cur.humanMode);
    office.setGameHumanMode(activeGameTab, next, focusId);
    if (next) {
      select(null);
      cameraGlide = office.gameCameraView(activeGameTab, true);
    }
    lastGamesVer = -1;
    wakeRender();
    syncPingPongUI();
  });
}

if ($('ppActionBtn')) {
  $('ppActionBtn').addEventListener('click', () => {
    if (activeGameTab === 'pingpong') office.gameHumanInput('pingpong', { type: 'action' });
    else if (activeGameTab === 'billiards') office.gameHumanInput('billiards', { type: 'shoot' });
    else if (activeGameTab === 'darts') office.gameHumanInput('darts', { type: 'throw' });
    lastGamesVer = -1;
    wakeRender();
    syncPingPongUI();
  });
}

if ($('ppMoveLeftBtn')) {
  $('ppMoveLeftBtn').addEventListener('click', () => {
    office.gameHumanInput('pingpong', { type: 'move_delta', delta: -0.22 });
    wakeRender();
  });
}

if ($('ppMoveRightBtn')) {
  $('ppMoveRightBtn').addEventListener('click', () => {
    office.gameHumanInput('pingpong', { type: 'move_delta', delta: 0.22 });
    wakeRender();
  });
}

if ($('ppAimLeft')) {
  $('ppAimLeft').addEventListener('click', () => {
    office.gameHumanInput('billiards', { type: 'aim_delta', delta: -0.07 });
    wakeRender();
  });
}

if ($('ppAimRight')) {
  $('ppAimRight').addEventListener('click', () => {
    office.gameHumanInput('billiards', { type: 'aim_delta', delta: 0.07 });
    wakeRender();
  });
}

if ($('ppPowerInput')) {
  $('ppPowerInput').addEventListener('input', (e) => {
    office.gameHumanInput('billiards', { type: 'power', power: parseFloat(e.target.value) });
    wakeRender();
  });
}

function syncPingPongUI() {
  const ver = office.gamesVersion;
  if (ver === lastGamesVer && activeGameTab === lastGamesTab) return;
  lastGamesVer = ver;
  lastGamesTab = activeGameTab;

  const all = office.gamesState();
  const st = all[activeGameTab];
  if (!st) return;

  const anyLive = Boolean(
    (all.pingpong && all.pingpong.active) ||
    (all.billiards && all.billiards.active) ||
    (all.darts && all.darts.active)
  );
  $('ppLiveDot').hidden = !anyLive;
  if (!ppOpen) return;

  const left = activeGameTab === 'pingpong' ? st.left : st.p0;
  const right = activeGameTab === 'pingpong' ? st.right : st.p1;
  const leftTurn = activeGameTab === 'pingpong' ? Boolean(left && left.serving) : Boolean(left && left.activeTurn);
  const rightTurn = activeGameTab === 'pingpong' ? Boolean(right && right.serving) : Boolean(right && right.activeTurn);

  const meta = GAME_META[activeGameTab];
  $('ppTitle').textContent = meta.title;
  $('ppFocusBtn').textContent = st.humanMode
    ? (office.firstPersonMode ? '🎥 Vista mesa' : '👁️ 1ª persona')
    : meta.focusLabel;
  $('ppRulesList').innerHTML = meta.rules.map((r) => `<li>${r}</li>`).join('');

  for (const t of document.querySelectorAll('.game-tab')) {
    const on = t.dataset.game === activeGameTab;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  }

  const badge = $('ppBadge');
  if (st.phase === 'match_over') {
    badge.textContent = 'Ganador';
    badge.dataset.state = 'win';
  } else if (st.deuce) {
    badge.textContent = 'Deuce';
    badge.dataset.state = 'deuce';
  } else if (st.active) {
    badge.textContent = 'En juego';
    badge.dataset.state = 'playing';
  } else if (st.phase === 'juggling') {
    badge.textContent = 'Práctica';
    badge.dataset.state = 'playing';
  } else {
    badge.textContent = 'Libre';
    badge.dataset.state = '';
  }

  const paintSide = (prefix, p, isTurn) => {
    const box = $(prefix + 'Box');
    box.classList.toggle('is-winner', Boolean(p && p.winner));
    $(prefix + 'Color').style.background = p ? hex(p.color) : 'var(--idle)';
    $(prefix + 'Name').textContent = p ? p.name : 'Libre';
    $(prefix + 'Serve').hidden = !isTurn;
    $(prefix + 'Score').textContent = p ? String(p.score) : '0';
    $(prefix + 'Wins').textContent = p && p.wins > 0 ? `★ ${p.wins} ${p.wins === 1 ? 'victoria' : 'victorias'}` : '';

    const potEl = $(prefix + 'Potted');
    potEl.replaceChildren();
    if (p && Array.isArray(p.potted) && p.potted.length) {
      for (const c of p.potted.slice(0, 6)) {
        const dot = document.createElement('i');
        dot.style.background = hex(c);
        potEl.append(dot);
      }
    }
  };

  paintSide('ppLeft', left, leftTurn);
  paintSide('ppRight', right, rightTurn);

  if (activeGameTab === 'pingpong') {
    $('ppRally').textContent = st.active ? `Rally ×${st.rally}` : 'A 5 pts';
  } else if (activeGameTab === 'billiards') {
    $('ppRally').textContent = 'Meta 4';
  } else {
    const tags = st.visitTags && st.visitTags.length ? st.visitTags.join(' · ') : 'Meta 150';
    $('ppRally').textContent = tags;
  }

  const evEl = $('ppEvent');
  evEl.classList.toggle('is-win', st.phase === 'match_over');
  if (st.phase === 'match_over') {
    evEl.textContent = `🏆 ${st.lastEvent}`;
  } else if (st.active) {
    evEl.textContent = st.lastEvent || 'Partido en curso';
  } else if (st.phase === 'juggling') {
    evEl.textContent = `${st.jugglerName} pelotea esperando un rival libre…`;
  } else {
    evEl.textContent = 'Los agentes libres juegan aquí, simula IA o pulsa Jugar.';
  }

  const humanBar = $('ppHumanBar');
  if (humanBar) {
    humanBar.hidden = !st.humanMode;
    if (st.humanMode) {
      const powerRow = $('ppPowerRow');
      const moveL = $('ppMoveLeftBtn');
      const moveR = $('ppMoveRightBtn');
      const actBtn = $('ppActionBtn');
      const tagEl = $('ppHumanTag');
      const hintEl = $('ppHumanHint');

      if (activeGameTab === 'pingpong') {
        powerRow.hidden = true;
        moveL.hidden = false;
        moveR.hidden = false;
        const myServe = st.phase === 'serve_ready' && left && left.serving;
        tagEl.textContent = myServe ? 'Tu saque (1ª persona)' : '1ª persona';
        hintEl.textContent = 'Mueve la raqueta con el mouse · Clic para sacar/rematar';
        actBtn.textContent = myServe ? '🏓 Sacar (Clic / Espacio)' : '🔥 Rematar (Clic / Espacio)';
        actBtn.disabled = !(myServe || st.phase === 'rally');
      } else if (activeGameTab === 'billiards') {
        powerRow.hidden = false;
        moveL.hidden = true;
        moveR.hidden = true;
        const myTurn = Boolean(left && left.activeTurn && (st.phase === 'aim' || st.phase === 'position'));
        tagEl.textContent = myTurn ? 'Tu turno (1ª persona)' : 'Turno NPC';
        hintEl.textContent = myTurn
          ? 'Mueve mouse izq/der para apuntar · Mantén clic y tira atrás'
          : 'Observando tiro del rival…';
        actBtn.textContent = '🎱 Tirar (Clic / Espacio)';
        actBtn.disabled = !myTurn;
        if ($('ppPowerInput') && Number.isFinite(st.humanPower)) {
          $('ppPowerInput').value = String(st.humanPower);
        }
      } else {
        powerRow.hidden = true;
        moveL.hidden = true;
        moveR.hidden = true;
        const myTurn = Boolean(left && left.activeTurn && st.phase === 'aim');
        tagEl.textContent = left && left.activeTurn ? `Tu turno · ${(st.dartIdx || 0) + 1}/3` : 'Turno NPC';
        hintEl.textContent = myTurn && st.aimPreview
          ? `Mirilla: ${st.aimPreview.tag} (+${st.aimPreview.points} pts) · Clic para lanzar`
          : myTurn
            ? 'Apunta con el mouse · Mantén clic y suelta para lanzar'
            : 'El rival está lanzando…';
        actBtn.textContent = '🎯 Lanzar (Clic / Espacio)';
        actBtn.disabled = !myTurn;
      }
    }
  }

  const simBtn = $('ppSimBtn');
  const realMatch = st.active && !st.exhibition && !st.humanMode;
  if (realMatch) {
    simBtn.textContent = 'Partido real';
    simBtn.disabled = true;
    simBtn.classList.add('is-stop');
  } else if (st.exhibition) {
    simBtn.textContent = 'Parar IA';
    simBtn.disabled = false;
    simBtn.classList.add('is-stop');
  } else {
    simBtn.textContent = 'Simular IA';
    simBtn.disabled = false;
    simBtn.classList.remove('is-stop');
  }

  const playBtn = $('ppPlayBtn');
  if (playBtn) {
    if (st.humanMode) {
      playBtn.textContent = 'Salir';
      playBtn.classList.add('is-stop');
    } else {
      playBtn.textContent = '🎮 Jugar';
      playBtn.classList.remove('is-stop');
    }
  }
}

// ------------------------------------------------------------ panel de agentes
const rosterEl = $('roster');
const items = new Map();

function buildItem(a) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'agent';
  btn.setAttribute('aria-pressed', 'false');

  const avatar = document.createElement('span');
  avatar.className = 'avatar';

  const who = document.createElement('span');
  who.className = 'who';

  const nameRow = document.createElement('span');
  nameRow.className = 'name-row';
  const name = document.createElement('span');
  name.className = 'name';
  const proj = document.createElement('span');
  proj.className = 'proj-tag';
  proj.hidden = true;
  nameRow.append(name, proj);

  const sub = document.createElement('span');
  sub.className = 'sub';
  who.append(nameRow, sub);

  const state = document.createElement('span');
  state.className = 'state';
  const dot = document.createElement('i');
  const stateText = document.createElement('span');
  state.append(dot, stateText);

  btn.append(avatar, who, state);
  btn.addEventListener('click', () => select(focusId === a.id ? null : a.id));
  li.append(btn);
  li._refs = { avatar, name, proj, sub, state, stateText };
  return li;
}

function updateItem(li, a) {
  const r = li._refs;
  r.avatar.style.background = hex(colorFor(a));
  r.avatar.textContent = initialOf(a.name);

  r.name.textContent = a.name;
  if (a.kind === 'main' && a.project) {
    r.proj.hidden = false;
    r.proj.textContent = a.project;
    r.proj.title = a.project;
  } else {
    r.proj.hidden = true;
  }

  const line = activityLine(a);
  r.sub.textContent = line;
  r.sub.title = line;

  r.state.dataset.status = a.status || 'idle';
  r.state.title = STATUS_LABEL[a.status] || a.status;
  r.stateText.textContent = SHORT_STATUS[a.status] || STATUS_LABEL[a.status] || a.status;
}

function updateStats(list) {
  let working = 0;
  let waiting = 0;
  let idle = 0;
  for (const a of list) {
    if (a.status === 'working') working++;
    else if (a.status === 'waiting') waiting++;
    else if (a.status === 'idle') idle++;
  }
  $('statsStrip').hidden = list.length === 0;
  $('statWorking').textContent = String(working);
  $('statWorkingLbl').textContent = working === 1 ? 'activo' : 'activos';
  $('statWaiting').textContent = String(waiting);
  $('statWaitingLbl').textContent = 'espera';
  $('statIdle').textContent = String(idle);
  $('statIdleLbl').textContent = idle === 1 ? 'libre' : 'libres';
  $('statWaitingPill').classList.toggle('is-alert', waiting > 0);
  $('rosterCount').textContent = String(list.length);
  $('revealCount').textContent = String(list.length);
}

function renderRoster(list) {
  latestAgents = new Map(list.map((a) => [a.id, a]));
  updateStats(list);

  const ids = new Set(list.map((a) => a.id));
  for (const [id, el] of items) {
    if (!ids.has(id)) {
      el.remove();
      items.delete(id);
      if (focusId === id) select(null);
    }
  }
  list.forEach((a, i) => {
    let li = items.get(a.id);
    if (!li) {
      li = buildItem(a);
      items.set(a.id, li);
    }
    updateItem(li, a);
    li.firstChild.setAttribute('aria-pressed', String(a.id === focusId));
    if (rosterEl.children[i] !== li) rosterEl.insertBefore(li, rosterEl.children[i] || null);
  });
  $('empty').hidden = list.length > 0;
  updateFocusCard();
}

// ------------------------------------------------------------ registro de actividad
const logEl = $('log');
let lastLogN = -1;
const timeFmt = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function renderLog(entries) {
  const lastN = entries.length ? entries[entries.length - 1].n : 0;
  if (lastN === lastLogN) return;
  lastLogN = lastN;
  logEl.replaceChildren();
  for (const e of entries.slice(-16).reverse()) {
    const li = document.createElement('li');
    if (e.level === 'error' || e.level === 'warn' || e.level === 'ok') li.className = e.level;

    const dot = document.createElement('span');
    dot.className = 'log-dot';

    const time = document.createElement('time');
    time.textContent = timeFmt.format(new Date(e.t));

    const msg = document.createElement('span');
    msg.className = 'log-msg';
    msg.title = `${e.agent}: ${e.text}`;
    const who = document.createElement('b');
    who.textContent = e.agent;
    msg.append(who, ' ' + e.text);

    li.append(dot, time, msg);
    logEl.append(li);
  }
}

// ---------------------------------------------------------------- conexión en vivo
const connDot = $('connDot');
const connText = $('connText');

function apply(snap) {
  office.setAgents(snap.agents);
  renderRoster(snap.agents);
  renderLog(snap.log || []);
  $('demoFoot').hidden = !snap.demo;
  wakeRender();
}

function connect() {
  const es = new EventSource('/events');
  es.onopen = () => {
    connDot.className = 'on';
    connText.textContent = 'En vivo';
  };
  es.onmessage = (e) => {
    try {
      apply(JSON.parse(e.data));
    } catch (err) {
      console.error('Mensaje inválido', err);
    }
  };
  es.onerror = () => {
    connDot.className = 'off';
    connText.textContent = 'Reconectando…';
  };
}
connect();

const post = (url) => fetch(url, { method: 'POST' }).catch(() => {});
$('demoStart').addEventListener('click', () => post('/demo/start'));
$('demoBtn').addEventListener('click', () => post('/demo/stop'));

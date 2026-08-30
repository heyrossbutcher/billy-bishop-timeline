import './style.css';
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { Line2 }        from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { events as localEvents } from './data/events.js';
import { fetchEvents } from './sanity.js';

// ── Constants ─────────────────────────────────────────────────────────────────
// Horizontal (wide) layout
const SPACING      = 600;
const CARD_Y       = 100;
const LABEL_Y      = 35;
const CARD_HALF_H  = 55;   // estimated half-height of card in THREE units

// Vertical (narrow ≤ BREAKPOINT) layout
const VERT_SPACING      = 260;
const VERT_CARD_X       = 150;  // cards left/right of centre line
const VERT_LABEL_OFFSET = 30;   // year label above/below dot (not between dot + card)
const CARD_HALF_W       = 70;   // half the card's effective width (280px × 0.5 ÷ 2)

const CARD_SCALE  = 0.5;
const FOV         = 50;
const CAM_Y       = 80;    // slight downward tilt in horizontal mode
const MIN_Z       = 350;
const MAX_Z       = 1800;
const INITIAL_Z   = 1500;
const THRESHOLD_Z = 1075;
const BREAKPOINT  = 728;

// ── Status colours ────────────────────────────────────────────────────────────
const STATUS = {
  good:      { hex: 0x4ade80, css: '#4ade80' },
  worrisome: { hex: 0xfacc15, css: '#facc15' },
  bad:       { hex: 0xf87171, css: '#f87171' },
};
function statusColor(status) {
  return STATUS[status] ?? { hex: 0xffffff, css: 'rgba(255,255,255,0.15)' };
}

// ── Timeline year mapping ─────────────────────────────────────────────────────
const YEAR_START    = 1931;
const YEAR_END      = 2026;
const TOTAL_LENGTH  = 12000;  // total line length in THREE units
const GROUP_SPREAD  = 150;    // units between same-year events when fully spread
const SPREAD_START_Z = THRESHOLD_Z;
const SPREAD_END_Z   = 650;

function yearToPos(year, vert) {
  const t = (year - YEAR_START) / (YEAR_END - YEAR_START);
  return vert ? -t * TOTAL_LENGTH : t * TOTAL_LENGTH - TOTAL_LENGTH / 2;
}

// ── Renderer setup (done once) ────────────────────────────────────────────────
const scene    = new THREE.Scene();
const cssScene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 1, 30000);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
Object.assign(renderer.domElement.style, {
  position: 'absolute', top: '0', left: '0', pointerEvents: 'none',
});
document.body.appendChild(renderer.domElement);

const cssRenderer = new CSS3DRenderer();
cssRenderer.setSize(innerWidth, innerHeight);
Object.assign(cssRenderer.domElement.style, {
  position: 'absolute', top: '0', left: '0',
});
document.body.appendChild(cssRenderer.domElement); // on top of WebGL so cards cover dots

scene.add(new THREE.AmbientLight(0xffffff, 1));

// ── Glow texture (created once, shared) ───────────────────────────────────────
function makeGlowTexture() {
  const size = 128, r = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0,    'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.4)');
  g.addColorStop(0.6,  'rgba(255,255,255,0.08)');
  g.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
const glowTex = makeGlowTexture();

// ── Scene state ───────────────────────────────────────────────────────────────
let isVertical = innerWidth <= BREAKPOINT;
let backbone   = null;
let dotMeshes  = [], glowSprites = [], connectors = [], lineMaterials = [];
let yearEls    = [], cardEls = [];
let yearObjs   = [], cardObjs = [];
let positions  = [];
let spreadDeltas = [];
let zoomedIn   = null;

// ── Camera / pan state ────────────────────────────────────────────────────────
let targetPan  = 0, currentPan = 0;
let targetZ    = INITIAL_Z, currentZ = INITIAL_Z;
let targetCamY = CAM_Y, currentCamY = CAM_Y;
let focusedEventIndex = -1;
let minPan     = 0, maxPan = 0;
let hoveredDotIndex = -1;

// ── Line2 helper ──────────────────────────────────────────────────────────────
function makeLine2(p1, p2, linewidth, opacity = 1) {
  const geo = new LineGeometry();
  geo.setPositions([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]);
  const mat = new LineMaterial({
    color: 0xffffff,
    linewidth,
    transparent: opacity < 1,
    opacity,
    resolution: new THREE.Vector2(innerWidth, innerHeight),
    depthTest: true,
  });
  lineMaterials.push(mat);
  const line = new Line2(geo, mat);
  line.computeLineDistances();
  return line;
}

// ── Wavy backbone ─────────────────────────────────────────────────────────────
const WAVE_AMP  = 60;
const WAVE_FREQ = 3;
const WAVE_Z_AMP  = 80;
const WAVE_Z_FREQ = 1.7;

function waveOffset(t) {
  let amp;
  if (t <= 0.25) {
    amp = WAVE_AMP * THREE.MathUtils.lerp(2, 1, t / 0.25);
  } else {
    amp = WAVE_AMP * (1 - (t - 0.25) / 0.75);
  }
  return amp * Math.sin(t * Math.PI * 2 * WAVE_FREQ);
}

function waveOffsetZ(t) {
  return WAVE_Z_AMP * Math.sin(t * Math.PI * 2 * WAVE_Z_FREQ + 1.2);
}

function makeWavyBackbone(start, end, vert) {
  const segments = 120;
  const pts  = [];
  for (let i = 0; i <= segments; i++) {
    const t      = i / segments;
    const x      = THREE.MathUtils.lerp(start.x, end.x, t);
    const y      = THREE.MathUtils.lerp(start.y, end.y, t);
    const offset = waveOffset(t);
    const offsetZ = waveOffsetZ(t);
    pts.push(vert ? x + offset : x, vert ? y : y + offset, offsetZ);
  }
  const geo = new LineGeometry();
  geo.setPositions(pts);
  const mat = new LineMaterial({
    color: 0xffffff,
    linewidth: 0.5,
    resolution: new THREE.Vector2(innerWidth, innerHeight),
    depthTest: true,
  });
  lineMaterials.push(mat);
  const line = new Line2(geo, mat);
  line.computeLineDistances();
  return line;
}

// ── Zoom state ────────────────────────────────────────────────────────────────
function setZoomState(isZoomedIn) {
  if (isZoomedIn === zoomedIn) return;
  zoomedIn = isZoomedIn;
  cardEls.forEach(el => {
    el.style.opacity       = isZoomedIn ? '1' : '0';
    el.style.pointerEvents = isZoomedIn ? 'auto' : 'none';
  });
  yearEls.forEach(el => {
    el.style.opacity       = isZoomedIn ? '0' : '1';
    el.style.pointerEvents = isZoomedIn ? 'none' : 'auto';
  });
  connectors.forEach(c => { c.visible = isZoomedIn; });
}

// ── Scene teardown ────────────────────────────────────────────────────────────
function clearScene() {
  if (backbone) { scene.remove(backbone); backbone.geometry.dispose(); backbone = null; }

  dotMeshes.forEach(d => { scene.remove(d); d.geometry.dispose(); d.material.dispose(); });
  dotMeshes.length = 0;

  glowSprites.forEach(s => { scene.remove(s); s.material.dispose(); });
  glowSprites.length = 0;

  connectors.forEach(c => { scene.remove(c); c.geometry.dispose(); });
  connectors.length = 0;

  lineMaterials.forEach(m => m.dispose());
  lineMaterials.length = 0;

  // Remove CSS3D objects and their DOM elements
  cssScene.children.slice().forEach(c => cssScene.remove(c));
  yearEls.forEach(el => el.parentNode?.removeChild(el));
  cardEls.forEach(el  => el.parentNode?.removeChild(el));
  yearEls.length = 0;
  cardEls.length = 0;
  yearObjs.length = 0;
  cardObjs.length = 0;
  spreadDeltas.length = 0;

  hoveredDotIndex = -1;
  document.body.style.cursor = '';
  zoomedIn = null;
}

// ── Scene build ───────────────────────────────────────────────────────────────
function buildScene(vert) {
  clearScene();
  isVertical = vert;

  // Group events by year for spread calculation
  const yearGroups = {};
  events.forEach((ev, i) => {
    if (!yearGroups[ev.year]) yearGroups[ev.year] = [];
    yearGroups[ev.year].push(i);
  });

  // Max spread is right-only: (n-1) × GROUP_SPREAD past the year position
  const maxSpread   = Math.max(...events.map(ev => (yearGroups[ev.year].length - 1) * GROUP_SPREAD));
  const hBackboneEnd = yearToPos(YEAR_END, false) + maxSpread;
  const hBackboneLen = hBackboneEnd - yearToPos(YEAR_START, false);

  // Compute 3-D positions — vertical: evenly spaced; horizontal: proportional by year
  positions = events.map((ev, i) => {
    const alt = i % 2 === 0;
    let base, t;
    if (vert) {
      base = -i * VERT_SPACING;
      t    = events.length > 1 ? i / (events.length - 1) : 0;
    } else {
      base = yearToPos(ev.year, false);
      // t relative to the extended backbone so dots sit exactly on the wave
      t    = (base - yearToPos(YEAR_START, false)) / hBackboneLen;
    }
    const wave  = waveOffset(t);
    const waveZ = waveOffsetZ(t);
    if (vert) {
      return {
        dot:   new THREE.Vector3(wave, base, waveZ),
        card:  new THREE.Vector3(wave, base, waveZ),
        label: new THREE.Vector3(wave, base + (alt ? VERT_LABEL_OFFSET : -VERT_LABEL_OFFSET), waveZ),
        alt,
      };
    } else {
      return {
        dot:   new THREE.Vector3(base, wave,                           waveZ),
        card:  new THREE.Vector3(base, wave + (alt ? CARD_Y : -CARD_Y), waveZ),
        label: new THREE.Vector3(base, wave + (alt ? LABEL_Y : -LABEL_Y), waveZ),
        alt,
      };
    }
  });

  // Spread deltas — same-year events go right only (index 0 stays at year pos)
  spreadDeltas = events.map((ev, i) => {
    const group = yearGroups[ev.year];
    if (group.length === 1) return 0;
    return group.indexOf(i) * GROUP_SPREAD;
  });
  // Vertical mode: each event already has a unique Y slot — no spread needed
  if (vert) spreadDeltas.fill(0);

  // Pan limits
  if (vert) {
    minPan = 0;
    maxPan = -(events.length - 1) * VERT_SPACING;
  } else {
    minPan = yearToPos(YEAR_START, false);
    maxPan = hBackboneEnd;
  }
  targetPan = currentPan = vert ? 0 : yearToPos(YEAR_START, false);

  // Camera orientation (set once here; animate only moves position)
  if (vert) {
    camera.position.set(0, 0, INITIAL_Z);
    camera.lookAt(0, 0, 0);
  } else {
    camera.position.set(yearToPos(YEAR_START, false), CAM_Y, INITIAL_Z);
    camera.lookAt(yearToPos(YEAR_START, false), CAM_Y, 0);
  }

  // Backbone — extends to cover fully-spread same-year events
  const lineStart = vert
    ? new THREE.Vector3(0, 0, 0)
    : new THREE.Vector3(yearToPos(YEAR_START, false), 0, 0);
  const lineEnd = vert
    ? new THREE.Vector3(0, -(events.length - 1) * VERT_SPACING, 0)
    : new THREE.Vector3(hBackboneEnd, 0, 0);
  backbone = makeWavyBackbone(lineStart, lineEnd, vert);
  scene.add(backbone);

  // Per-event objects
  events.forEach((ev, i) => {
    const { dot: dotPos, card: cardPos, label: labelPos, alt } = positions[i];
    const dir = alt ? 1 : -1;

    // Dot
    const col = statusColor(ev.status);
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(7, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    dot.position.copy(dotPos);
    dot.userData.eventIndex = i;
    scene.add(dot);
    dotMeshes.push(dot);

    // Glow
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      color: col.hex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.55,
    }));
    glow.position.copy(dotPos);
    glow.scale.setScalar(32);
    scene.add(glow);
    glowSprites.push(glow);

    // Connector — vertical mode: card is centred on dot so no stem needed
    // Geometry is origin-relative so conn.position can track the dot during spread
    if (!vert) {
      const connStart = new THREE.Vector3(0, dir * 9,                     0);
      const connEnd   = new THREE.Vector3(0, dir * (CARD_Y - CARD_HALF_H), 0);
      const conn      = makeLine2(connStart, connEnd, 2, 0.35);
      conn.position.x = dotPos.x;
      conn.position.y = dotPos.y;
      conn.position.z = dotPos.z;
      conn.visible    = false;
      scene.add(conn);
      connectors.push(conn);
    }

    // Year label (CSS3D)
    const labelDiv = document.createElement('div');
    labelDiv.className = 'year-label';
    labelDiv.textContent = ev.year;
    labelDiv.addEventListener('click', () => zoomToEvent(i));
    const labelObj = new CSS3DObject(labelDiv);
    labelObj.position.copy(labelPos);
    labelObj.scale.setScalar(CARD_SCALE);
    cssScene.add(labelObj);
    yearEls.push(labelDiv);
    yearObjs.push(labelObj);

    // Card (CSS3D)
    const cardDiv = document.createElement('div');
    cardDiv.className = 'timeline-card';
    cardDiv.style.borderLeft = `3px solid ${col.css}`;
    cardDiv.innerHTML = `
      <div class="card-year">${ev.year}</div>
      <div class="card-title">${ev.title}</div>
      <div class="card-desc">${ev.description}</div>
    `;
    const cardObj = new CSS3DObject(cardDiv);
    cardObj.position.copy(cardPos);
    cardObj.scale.setScalar(CARD_SCALE);
    cssScene.add(cardObj);
    cardEls.push(cardDiv);
    cardObjs.push(cardObj);
  });

  setZoomState(false);

  // Force CSS3DRenderer to sync its DOM
  cssRenderer.render(cssScene, camera);
}

// ── HUD (inserted once) ───────────────────────────────────────────────────────
document.body.insertAdjacentHTML('beforeend', `
  <div id="title-block">
    <h1>Billy Bishop Toronto City Airport</h1>
    <p>A history — 1931 to 2014</p>
  </div>
  <div id="hint">Drag to explore &nbsp;·&nbsp; Scroll to zoom in</div>
  <div id="zoom-controls">
    <button id="zoom-in"  aria-label="Zoom in">+</button>
    <button id="zoom-out" aria-label="Zoom out">−</button>
  </div>
  <button id="nav-prev" aria-label="Previous event">&#8592;</button>
  <button id="nav-next" aria-label="Next event">&#8594;</button>
`);
setTimeout(() => { document.getElementById('hint').style.opacity = '0'; }, 5000);

function updateNavButtons() {
  const prev = document.getElementById('nav-prev');
  const next = document.getElementById('nav-next');
  const show = focusedEventIndex >= 0 && !isVertical;
  prev.classList.toggle('visible', show);
  next.classList.toggle('visible', show);
  if (show) {
    prev.style.opacity = focusedEventIndex === 0 ? '0.2' : '';
    next.style.opacity = focusedEventIndex === events.length - 1 ? '0.2' : '';
  }
}

function navigateEvent(dir) {
  if (focusedEventIndex < 0) return;
  const next = Math.max(0, Math.min(events.length - 1, focusedEventIndex + dir));
  zoomToEvent(next);
}

document.getElementById('nav-prev').addEventListener('click', () => navigateEvent(-1));
document.getElementById('nav-next').addEventListener('click', () => navigateEvent(1));

const ZOOM_STEP = 250;
document.getElementById('zoom-in').addEventListener('click',  () => {
  targetZ = Math.max(MIN_Z, targetZ - ZOOM_STEP);
});
document.getElementById('zoom-out').addEventListener('click', () => {
  targetZ = Math.min(MAX_Z, targetZ + ZOOM_STEP);
});

// ── Derived helpers ───────────────────────────────────────────────────────────
function pixelToUnit(px) {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  if (isVertical) {
    return (px / innerHeight) * (2 * camera.position.z * tanHalf);
  }
  return (px / innerWidth) * (2 * camera.position.z * tanHalf * camera.aspect);
}

function clampPan(v) {
  const lo = Math.min(minPan, maxPan);
  const hi = Math.max(minPan, maxPan);
  return Math.max(lo, Math.min(hi, v));
}

function zoomToEvent(index) {
  const spreadT = THREE.MathUtils.clamp(
    (SPREAD_START_Z - currentZ) / (SPREAD_START_Z - SPREAD_END_Z),
    0, 1,
  );
  const base  = positions[index].dot;
  const delta = (spreadDeltas[index] || 0) * spreadT;
  const pan   = isVertical ? base.y + delta : base.x + delta;
  targetPan   = clampPan(pan);
  targetZ     = 300;
  if (!isVertical) targetCamY = positions[index].card.y;
  focusedEventIndex = index;
  updateNavButtons();
}

// ── Interaction ───────────────────────────────────────────────────────────────
let dragging = false, dragStart = 0, dragStartPan = 0, totalDrag = 0;
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

document.addEventListener('mousedown', e => {
  dragging = true; totalDrag = 0;
  dragStart    = isVertical ? e.clientY : e.clientX;
  dragStartPan = targetPan;
  document.body.classList.add('is-dragging');
});

document.addEventListener('mousemove', e => {
  if (dragging) {
    const delta = (isVertical ? e.clientY : e.clientX) - dragStart;
    totalDrag = Math.abs(delta);
    targetPan = clampPan(dragStartPan - pixelToUnit(delta));
    return;
  }
  // Dot hover
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits   = raycaster.intersectObjects(dotMeshes);
  const newIdx = hits.length ? hits[0].object.userData.eventIndex : -1;
  if (newIdx !== hoveredDotIndex) {
    hoveredDotIndex = newIdx;
    document.body.style.cursor = hoveredDotIndex >= 0 ? 'pointer' : '';
  }
});

document.addEventListener('mouseup', e => {
  document.body.classList.remove('is-dragging');
  if (totalDrag < 5) {
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(dotMeshes);
    if (hits.length) {
      zoomToEvent(hits[0].object.userData.eventIndex);
    } else if (!e.target.closest('.timeline-card, .year-label, #zoom-controls, #nav-prev, #nav-next')) {
      targetZ           = INITIAL_Z;
      targetCamY        = CAM_Y;
      focusedEventIndex = -1;
      updateNavButtons();
    }
  }
  dragging = false;
});

document.addEventListener('mouseleave', () => {
  dragging = false;
  document.body.classList.remove('is-dragging');
});

document.addEventListener('wheel', e => {
  e.preventDefault();
  const isH = Math.abs(e.deltaX) > Math.abs(e.deltaY);
  if (isVertical) {
    // V-scroll pans the timeline; H-scroll zooms
    if (!isH) targetPan = clampPan(targetPan - pixelToUnit(e.deltaY));
    else       targetZ   = Math.max(MIN_Z, Math.min(MAX_Z, targetZ + e.deltaX * 0.7));
  } else if (focusedEventIndex >= 0) {
    // Focused on a card — disable pan, only allow zoom
    if (!isH) targetZ = Math.max(MIN_Z, Math.min(MAX_Z, targetZ + e.deltaY * 0.7));
  } else {
    // H-scroll pans; V-scroll zooms
    if (isH)  targetPan = clampPan(targetPan + pixelToUnit(e.deltaX) * 1.4);
    else       targetZ   = Math.max(MIN_Z, Math.min(MAX_Z, targetZ + e.deltaY * 0.7));
  }
}, { passive: false });

let touchStart0 = 0, touchPan0 = 0;
document.addEventListener('touchstart', e => {
  touchStart0 = isVertical ? e.touches[0].clientY : e.touches[0].clientX;
  touchPan0   = targetPan;
});
document.addEventListener('touchmove', e => {
  const cur = isVertical ? e.touches[0].clientY : e.touches[0].clientX;
  targetPan = clampPan(touchPan0 - pixelToUnit(cur - touchStart0));
}, { passive: false });

document.addEventListener('keydown', e => {
  const step = 400;
  if (isVertical) {
    if (e.key === 'ArrowUp')    targetPan = clampPan(targetPan + step);
    if (e.key === 'ArrowDown')  targetPan = clampPan(targetPan - step);
    if (e.key === 'ArrowLeft')  targetZ   = Math.max(MIN_Z, targetZ - 200);
    if (e.key === 'ArrowRight') targetZ   = Math.min(MAX_Z, targetZ + 200);
  } else if (focusedEventIndex >= 0) {
    if (e.key === 'ArrowLeft')  navigateEvent(-1);
    if (e.key === 'ArrowRight') navigateEvent(1);
    if (e.key === 'ArrowUp')    targetZ = Math.max(MIN_Z, targetZ - 200);
    if (e.key === 'ArrowDown')  targetZ = Math.min(MAX_Z, targetZ + 200);
  } else {
    if (e.key === 'ArrowLeft')  targetPan = clampPan(targetPan - step);
    if (e.key === 'ArrowRight') targetPan = clampPan(targetPan + step);
    if (e.key === 'ArrowUp')    targetZ   = Math.max(MIN_Z, targetZ - 200);
    if (e.key === 'ArrowDown')  targetZ   = Math.min(MAX_Z, targetZ + 200);
  }
  if (e.key === 'Escape') { targetZ = INITIAL_Z; targetCamY = CAM_Y; focusedEventIndex = -1; updateNavButtons(); }
});

// ── Animate ───────────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);

  currentPan  = THREE.MathUtils.lerp(currentPan,  targetPan,  0.09);
  currentZ    = THREE.MathUtils.lerp(currentZ,    targetZ,    0.09);
  currentCamY = THREE.MathUtils.lerp(currentCamY, targetCamY, 0.09);

  if (isVertical) {
    camera.position.set(0, currentPan, currentZ);
    camera.lookAt(0, currentPan, 0);
  } else {
    camera.position.set(currentPan, currentCamY, currentZ);
    camera.lookAt(currentPan, currentCamY, 0);
  }

  setZoomState(currentZ < THRESHOLD_Z);

  // Spread same-year events as camera zooms in
  if (spreadDeltas.length) {
    const spreadT = THREE.MathUtils.clamp(
      (SPREAD_START_Z - currentZ) / (SPREAD_START_Z - SPREAD_END_Z),
      0, 1,
    );
    dotMeshes.forEach((dot, i) => {
      const base  = positions[i];
      const delta = spreadDeltas[i] * spreadT;
      if (isVertical) {
        const ny = base.dot.y + delta;
        dot.position.y            = ny;
        glowSprites[i].position.y = ny;
        if (cardObjs[i])  cardObjs[i].position.y  = base.card.y  + delta;
        if (yearObjs[i])  yearObjs[i].position.y  = base.label.y + delta;
      } else {
        const nx = base.dot.x + delta;
        dot.position.x            = nx;
        glowSprites[i].position.x = nx;
        if (cardObjs[i])   { cardObjs[i].position.x  = base.card.x  + delta; cardObjs[i].position.z  = base.card.z; }
        if (yearObjs[i])   { yearObjs[i].position.x  = base.label.x + delta; yearObjs[i].position.z  = base.label.z; }
        if (connectors[i]) { connectors[i].position.x = nx; connectors[i].position.y = base.dot.y; connectors[i].position.z = base.dot.z; }
      }
    });
  }

  const t = performance.now() * 0.001;
  glowSprites.forEach((glow, i) => {
    const pulse = Math.sin(t * 1.6 + i * 0.85) * 0.5 + 0.5;
    glow.scale.setScalar(50 + pulse * 40);
    glow.material.opacity = 0.75 - pulse * 0.25;
  });

  dotMeshes.forEach((dot, i) => {
    const target = i === hoveredDotIndex ? 1.6 : 1;
    dot.scale.x = THREE.MathUtils.lerp(dot.scale.x, target, 0.14);
    dot.scale.y = dot.scale.x;
    dot.scale.z = dot.scale.x;
  });

  renderer.render(scene, camera);
  cssRenderer.render(cssScene, camera);
}

// ── Resize + breakpoint detection ─────────────────────────────────────────────
let prevVertical = isVertical;

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  cssRenderer.setSize(innerWidth, innerHeight);
  lineMaterials.forEach(m => m.resolution.set(innerWidth, innerHeight));

  const nowVertical = innerWidth <= BREAKPOINT;
  if (nowVertical !== prevVertical) {
    prevVertical = nowVertical;
    buildScene(nowVertical);
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
let events = localEvents;

animate();

fetchEvents().then(remote => {
  if (remote && remote.length > 0) {
    events = remote;
    buildScene(isVertical);
  } else {
    buildScene(isVertical);
  }
}).catch(() => {
  buildScene(isVertical);
});

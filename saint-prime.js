/**
 * SAINT PRIME — CORE INTELLIGENCE ENGINE v1.2
 * Hand tracking, Gesture recognition, and UI Logic
 */

const CONFIG = {
  PINCH_THRESHOLD: 0.08, // Normalized distance
  FIST_THRESHOLD: 0.12,  // Distance between finger tips and palm
  SMOOTHING: 0.6,
  PARTICLE_COUNT: 40
};

let state = {
  initialized: false,
  handPresent: false,
  mode: 'STANDBY',
  tool: 'draw',
  color: '#00f5ff',
  strokeSize: 4,
  lastHandPos: { x: 0, y: 0 },
  isDrawing: false,
  isAnimateActive: false,
  zoomScale: 1.0,
  rotation: 0,
  offset: { x: 0, y: 0 },
  lastPinchDist: 0,
  grabbedWidget: null,
  grabOffset: { x: 0, y: 0 },
  paths: [], // Each path will now track its "organism" position
  currentPath: null,
  fps: 0,
  lastFrameTime: performance.now()
};

const elements = {
  video: document.getElementById('video'),
  landmarkCanvas: document.getElementById('landmark-canvas'),
  drawCanvas: document.getElementById('draw-canvas'),
  particleCanvas: document.getElementById('particle-canvas'),
  handCursor: document.getElementById('hand-cursor'),
  cursorTrails: document.getElementById('cursor-trails'),
  modeLabel: document.getElementById('mode-label'),
  modeDisplay: document.getElementById('mode-display'),
  fpsDisplay: document.getElementById('fps-display'),
  handStatus: document.getElementById('hand-status'),
  clockTime: document.getElementById('clock-time'),
  clockDate: document.getElementById('clock-date'),
  gestState: document.getElementById('gesture-state-display'),
  gestConf: document.getElementById('gesture-confidence'),
  bootStatus: document.getElementById('boot-status'),
  bootScreen: document.getElementById('boot-screen'),
  appContainer: document.getElementById('app')
};

const lCtx = elements.landmarkCanvas.getContext('2d');
const dCtx = elements.drawCanvas.getContext('2d');
const pCtx = elements.particleCanvas.getContext('2d');

function init() {
  window.addEventListener('resize', handleResize);
  handleResize();
  startTime();
  initMediaPipe();

  // Boot UI logic
  setTimeout(() => {
    elements.bootStatus.innerText = "Biological Interface Syncing...";
    setTimeout(() => {
      elements.bootScreen.style.opacity = '0';
      setTimeout(() => {
        elements.bootScreen.classList.add('hidden');
        elements.appContainer.classList.remove('hidden');
      }, 800);
      state.initialized = true;
      showToast("SAINT PRIME: NEURAL LINK ESTABLISHED");
    }, 1500);
  }, 1000);

  requestAnimationFrame(mainRenderLoop);
  requestAnimationFrame(particleLoop);
}

function handleResize() {
  elements.landmarkCanvas.width = elements.landmarkCanvas.clientWidth;
  elements.landmarkCanvas.height = elements.landmarkCanvas.clientHeight;
  elements.drawCanvas.width = window.innerWidth;
  elements.drawCanvas.height = window.innerHeight;
  elements.particleCanvas.width = window.innerWidth;
  elements.particleCanvas.height = window.innerHeight;
}

function startTime() {
  setInterval(() => {
    const now = new Date();
    elements.clockTime.innerText = now.toLocaleTimeString('en-US', { hour12: false });
    elements.clockDate.innerText = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }, 1000);
}

function initMediaPipe() {
  if (typeof Hands === 'undefined') return;

  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
  });

  hands.onResults(onResults);

  const camera = new Camera(elements.video, {
    onFrame: async () => {
      await hands.send({ image: elements.video });
    },
    width: 640,
    height: 480
  });
  camera.start();
}

function onResults(results) {
  const now = performance.now();
  state.fps = Math.round(1000 / (now - state.lastFrameTime));
  state.lastFrameTime = now;
  elements.fpsDisplay.innerText = `FPS: ${state.fps}`;

  lCtx.clearRect(0, 0, elements.landmarkCanvas.width, elements.landmarkCanvas.height);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    state.handPresent = true;
    elements.handStatus.innerText = "LINKED";
    elements.handStatus.classList.add('active');

    const landmarks = results.multiHandLandmarks[0];
    drawLandmarks(landmarks);
    processGestures(landmarks);
  } else {
    state.handPresent = false;
    elements.handStatus.innerText = "--";
    elements.handStatus.classList.remove('active');
    state.mode = 'STANDBY';
    elements.handCursor.style.display = 'none';
    stopDrawing();
    clearGrab();
    updateUI();
  }
}

function drawLandmarks(landmarks) {
  lCtx.save();
  lCtx.strokeStyle = 'var(--cyan)';
  lCtx.lineWidth = 1;
  const connections = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20], [5, 9, 13, 17], [0, 17]];
  connections.forEach(line => {
    lCtx.beginPath();
    line.forEach((idx, i) => {
      const x = landmarks[idx].x * elements.landmarkCanvas.width;
      const y = landmarks[idx].y * elements.landmarkCanvas.height;
      if (i === 0) lCtx.moveTo(x, y); else lCtx.lineTo(x, y);
    });
    lCtx.stroke();
  });
  lCtx.restore();
}

function processGestures(landmarks) {
  const indexTip = landmarks[8];
  const thumbTip = landmarks[4];
  const screenX = (1 - indexTip.x) * window.innerWidth;
  const screenY = indexTip.y * window.innerHeight;

  elements.handCursor.style.display = 'block';
  elements.handCursor.style.left = `${screenX}px`;
  elements.handCursor.style.top = `${screenY}px`;

  // Math for Gestures
  const distPinch = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
  const isPinching = distPinch < CONFIG.PINCH_THRESHOLD;

  const isFist = [8, 12, 16, 20].every(i => Math.hypot(landmarks[i].x - landmarks[0].x, landmarks[i].y - landmarks[0].y) < 0.2);
  const isPalm = [8, 12, 16, 20].every(i => landmarks[i].y < landmarks[i - 2].y);

  if (isFist) {
    if (!state.isAnimateActive) triggerAnimation();
    state.mode = 'ANIMATE';
  } else if (isPinching) {
    if (state.grabbedWidget) {
      state.mode = 'GRAB';
      moveWidget({ x: screenX, y: screenY });
    } else {
      // ZOOM LOGIC: If pinching in empty space, adjust global scale
      state.mode = 'ZOOM';
      if (state.lastPinchDist > 0) {
        const delta = distPinch - state.lastPinchDist;
        state.zoomScale = Math.max(0.1, Math.min(5, state.zoomScale + delta * 5));
      }
      state.lastPinchDist = distPinch;
    }
    stopDrawing();
  } else if (landmarks[8].y < landmarks[6].y && landmarks[12].y > landmarks[10].y) {
    state.mode = 'DRAW';
    state.lastPinchDist = 0; // Reset pinch
    clearGrab();
    handleDrawing({ x: screenX, y: screenY });
  } else {
    state.mode = 'STANDBY';
    state.lastPinchDist = 0;
    stopDrawing();
    clearGrab();
  }
  updateUI();
}

function updateUI() {
  elements.modeLabel.innerText = state.mode;
  elements.gestState.innerText = state.mode;
  elements.modeDisplay.className = 'hud-mode-pill ' + (state.mode !== 'STANDBY' ? 'active' : '');
  if (state.mode === 'ANIMATE') elements.modeDisplay.classList.add('animate-mode');
}

function handleDrawing(pos) {
  if (state.tool !== 'draw') return;
  if (!state.isDrawing) {
    state.isDrawing = true;
    state.currentPath = { color: state.color, size: state.strokeSize, points: [pos], time: Date.now() };
    state.paths.push(state.currentPath);
    showToast("DRAWING ACTIVE");
  } else {
    state.currentPath.points.push(pos);
  }
  createTrail(pos);
}

function stopDrawing() { state.isDrawing = false; state.currentPath = null; }

function mainRenderLoop() {
  dCtx.clearRect(0, 0, elements.drawCanvas.width, elements.drawCanvas.height);
  dCtx.lineCap = 'round';
  dCtx.lineJoin = 'round';

  const time = Date.now() * 0.002;

  dCtx.save();
  // Apply Global Zoom based on pinch
  dCtx.translate(window.innerWidth / 2, window.innerHeight / 2);
  dCtx.scale(state.zoomScale, state.zoomScale);
  dCtx.translate(-window.innerWidth / 2, -window.innerHeight / 2);

  state.paths.forEach(path => {
    if (path.points.length < 2) return;

    // Roaming behavior: move the whole entity
    if (state.isAnimateActive) {
      if (!path.driftX) {
        path.driftX = 0; path.driftY = 0;
        path.vx = (Math.random() - 0.5) * 4;
        path.vy = (Math.random() - 0.5) * 4;
      }
      path.driftX += path.vx;
      path.driftY += path.vy;

      // Screen wrap
      const cx = path.points[0].x + path.driftX;
      const cy = path.points[0].y + path.driftY;
      if (cx < -200 || cx > window.innerWidth + 200) path.vx *= -1;
      if (cy < -200 || cy > window.innerHeight + 200) path.vy *= -1;
    } else {
      path.driftX = 0; path.driftY = 0; // Reset when life terminated
    }

    dCtx.beginPath();
    dCtx.strokeStyle = path.color;
    dCtx.lineWidth = path.size;
    dCtx.shadowBlur = 15;
    dCtx.shadowColor = path.color;

    const startX = path.points[0].x + (path.driftX || 0);
    const startY = path.points[0].y + (path.driftY || 0);
    dCtx.moveTo(startX, startY);

    path.points.forEach((pt, i) => {
      let x = pt.x + (path.driftX || 0);
      let y = pt.y + (path.driftY || 0);

      // PERSISTENT ORGANIC LIFE
      if (state.isAnimateActive) {
        const effect = document.getElementById('anim-effect').value;
        const offset = i * 0.15;

        if (effect === 'parasite') {
          // Snake-like slithering: lateral undulation
          const wave = Math.sin(time * 8 - offset) * (15 + i * 0.5);
          x += wave;
          y += Math.cos(time * 4 - offset) * 5;
        } else if (effect === 'organism') {
          // Pulsing, organic expansion
          const pulse = Math.sin(time * 12 + offset) * 8;
          x += (Math.random() - 0.5) * 2 + pulse;
          y += (Math.random() - 0.5) * 2 + pulse;
        } else if (effect === 'wave') {
          y += Math.sin(i * 0.2 + time * 5) * 10;
        } else if (effect === 'glow') {
          dCtx.shadowBlur = 15 + Math.sin(time * 10) * 10;
        } else if (effect === 'float') {
          y -= (Math.sin(time + i * 0.1) * 20);
        }
      }

      dCtx.lineTo(x, y);
    });
    dCtx.stroke();
  });
  dCtx.restore();
  requestAnimationFrame(mainRenderLoop);
}

function triggerAnimation() {
  state.isAnimateActive = true;
  showToast("LIFE CYCLE INITIATED");
}

function terminateLife() {
  state.isAnimateActive = false;
  showToast("BIOLOGICAL LIFE TERMINATED");
}

function checkWidgetGrab(pos) {
  const widgets = document.querySelectorAll('.widget');
  widgets.forEach(w => {
    const rect = w.getBoundingClientRect();
    if (pos.x > rect.left && pos.x < rect.right && pos.y > rect.top && pos.y < rect.bottom) {
      state.grabbedWidget = w;
      state.grabOffset = { x: pos.x - rect.left, y: pos.y - rect.top };
      w.classList.add('grabbed');
    }
  });
}

function moveWidget(pos) {
  if (!state.grabbedWidget) return;
  state.grabbedWidget.style.left = `${pos.x - state.grabOffset.x}px`;
  state.grabbedWidget.style.top = `${pos.y - state.grabOffset.y}px`;
}

function clearGrab() {
  if (state.grabbedWidget) {
    state.grabbedWidget.classList.remove('grabbed');
    state.grabbedWidget = null;
  }
}

// UI Buttons
window.clearCanvas = () => { state.paths = []; showToast("MEMORY PURGED"); };
window.setTool = (t) => { state.tool = t; showToast(`TOOL: ${t.toUpperCase()}`); };
window.setColor = (c) => { state.color = c; showToast(`NEON: ${c}`); };
window.triggerAnimation = triggerAnimation;
window.terminateLife = terminateLife;

function particleLoop() {
  pCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if (particles.length < CONFIG.PARTICLE_COUNT) {
    particles.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5, size: Math.random() * 2 });
  }
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0 || p.x > innerWidth) p.vx *= -1;
    if (p.y < 0 || p.y > innerHeight) p.vy *= -1;
    pCtx.fillStyle = 'rgba(0, 245, 255, 0.1)';
    pCtx.beginPath(); pCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2); pCtx.fill();
  });
  requestAnimationFrame(particleLoop);
}
let particles = [];

function createTrail(pos) {
  const t = document.createElement('div');
  t.className = 'trail-dot';
  t.style.left = `${pos.x}px`; t.style.top = `${pos.y}px`;
  elements.cursorTrails.appendChild(t);
  setTimeout(() => t.remove(), 500);
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerText = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2000);
}

init();

import { Car }             from './entities/Car';
import { Track }           from './entities/Track';
import { Input }           from './utils/Input';
import { AudioEngine }     from './utils/AudioEngine';
import { Hud }             from './ui/Hud';
import { Controls }        from './ui/Controls';
import { Countdown }       from './ui/Countdown';
import { generateTrack }   from './engine/TrackGenerator';
import { CAMERA, RACE, CAR as CAR_CONFIG } from './config';

// ─── Canvas ──────────────────────────────────────────────────────────────────

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx    = canvas.getContext('2d')!;

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ─── Engine objects ──────────────────────────────────────────────────────────

const input     = new Input();
const audio     = new AudioEngine();
const hud       = new Hud();
const controls  = new Controls(input);
const countdown = new Countdown();

let audioStarted     = false;
let track            = new Track();
let car:             Car;
let lastTime         = performance.now();
let currentTrackName = 'oval';
let currentSeed      = 0;

// Camera state
let cameraZoom       = CAMERA.DEFAULT_ZOOM;
let smoothedCamSpeed = 0;

// FPS counter
let fpsDisplay = 0, fpsCount = 0, fpsTimer = 0;

// Pre-compute top speed for audio scaling (px/s)
const CAR_TOP_SPEED = CAR_CONFIG.ACCELERATION / (60 * (1 - CAR_CONFIG.FRICTION));

// ─── Game state ──────────────────────────────────────────────────────────────

type GameState = 'menu' | 'countdown' | 'test' | 'race' | 'summary';
let gameState: GameState = 'menu';

let currentCheckpoint = 0;
let isPaused          = false;

// Test (free drive) mode
let timerStartTime: number | null = null;
let timerPausedAt:  number | null = null;
let testLapTimes:   number[]      = [];
let testLapStart:   number | null = null;

// Race mode
let raceTotalLaps    = RACE.DEFAULT_LAPS;
let raceLap          = 0;
let raceLastLapStart = 0;
let raceLapTimes:    number[]     = [];

// ─── DOM references ──────────────────────────────────────────────────────────

const menuScreen    = document.getElementById('menu-screen')!;
const pauseMenu     = document.getElementById('pause-menu')!;
const summaryScreen = document.getElementById('summary-screen')!;

// ─── Controls screen wiring ──────────────────────────────────────────────────

controls.onClose = () => hud.setVisible(false);

// ─── Main menu ───────────────────────────────────────────────────────────────
document.getElementById('btn-test-mode')!.addEventListener('click', () => {
  currentTrackName = getSelectedTrack();
  startTestMode();
});
document.getElementById('btn-race-mode')!.addEventListener('click', () => {
  currentTrackName = getSelectedTrack();
  const checked = document.querySelector<HTMLInputElement>(
    'input[name="menu-track"]:checked'
  );
  if (checked?.dataset.loop === 'true') {
    showLapModal();
  } else {
    raceTotalLaps = 1;
    startRaceMode();
  }
});

// Show / hide the seed input row based on track selection
document.querySelectorAll<HTMLInputElement>('input[name="menu-track"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const isProc = radio.value.startsWith('procedural');
    document.getElementById('procedural-seed-section')!.style.display = isProc ? '' : 'none';
  });
});

function getSelectedTrack(): string {
  const val = document.querySelector<HTMLInputElement>('input[name="menu-track"]:checked')?.value ?? 'oval';
  return val.startsWith('procedural') ? 'procedural' : val;
}

function getProceduralLength(): 'short' | 'medium' | 'long' | 'xl' {
  const val = document.querySelector<HTMLInputElement>('input[name="menu-track"]:checked')?.value ?? '';
  if (val === 'procedural-medium') return 'medium';
  if (val === 'procedural-long')   return 'long';
  if (val === 'procedural-xl')     return 'xl';
  return 'short';
}

const SEED_STORAGE_KEY = 'racing_procedural_seed';

/**
 * FNV-1a 32-bit hash — deterministic on every platform/browser.
 * Any text string maps to the same uint32 everywhere.
 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h  = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Reads the seed input field.
 *  - Pure digits → used as-is (uint32).
 *  - Any other non-empty text → FNV-1a hashed to a uint32 (same result on every machine).
 *  - Blank → random uint32 generated and written back to the field.
 *  The resolved seed is always persisted to localStorage so it survives refreshes. */
function getSelectedSeed(): number {
  const el  = document.getElementById('procedural-seed') as HTMLInputElement;
  const raw = el?.value.trim();
  let seed: number;
  if (raw) {
    seed = /^\d+$/.test(raw) ? (parseInt(raw, 10) >>> 0) : hashString(raw);
  } else {
    seed = (Math.random() * 0xFFFFFFFF) >>> 0;
  }
  if (el) el.value = String(seed);
  try { localStorage.setItem(SEED_STORAGE_KEY, String(seed)); } catch { /* quota */ }
  return seed;
}

/** Restore the last-used procedural seed into the input field on page load. */
function restoreLastSeed(): void {
  try {
    const stored = localStorage.getItem(SEED_STORAGE_KEY);
    if (stored && /^\d+$/.test(stored)) {
      const el = document.getElementById('procedural-seed') as HTMLInputElement;
      if (el && !el.value.trim()) el.value = stored;
    }
  } catch { /* storage unavailable */ }
}
restoreLastSeed();

/** Load the current track — either from a JSON file or via the procedural generator. */
async function loadCurrentTrack(): Promise<void> {
  if (currentTrackName === 'procedural') {
    currentSeed = getSelectedSeed();
    track.buildGeometry(generateTrack(currentSeed, getProceduralLength()));
  } else {
    await track.load(`/tracks/${currentTrackName}.json`);
  }
}

// ─── Pause menu ──────────────────────────────────────────────────────────────

document.getElementById('btn-resume')!.addEventListener('click', () =>
  setPaused(false)
);
document.getElementById('btn-main-menu')!.addEventListener('click', () => {
  setPaused(false);
  showMenu();
});


// ─── Summary screen ──────────────────────────────────────────────────────────

document.getElementById('btn-summary-menu')!.addEventListener('click', showMenu);
document.getElementById('btn-summary-retry')!.addEventListener('click', () => {
  summaryScreen.classList.remove('visible');
  if (gameState === 'summary') startRaceMode();
});

// ─── Lap count modal ─────────────────────────────────────────────────────────

function showLapModal() {
  (document.getElementById('lap-modal-input') as HTMLInputElement).value =
    String(raceTotalLaps);
  document.getElementById('lap-modal')!.classList.add('visible');
}

document.getElementById('btn-lap-modal-start')!.addEventListener('click', () => {
  const v = parseInt(
    (document.getElementById('lap-modal-input') as HTMLInputElement).value,
    10
  );
  raceTotalLaps = isNaN(v)
    ? RACE.DEFAULT_LAPS
    : Math.max(RACE.MIN_LAPS, Math.min(RACE.MAX_LAPS, v));
  document.getElementById('lap-modal')!.classList.remove('visible');
  startRaceMode();
});
document.getElementById('btn-lap-modal-cancel')!.addEventListener('click', () => {
  document.getElementById('lap-modal')!.classList.remove('visible');
});

// ─── Keyboard & scroll ───────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  const key = e.key.toLowerCase();
  if (key === input.bindings.pause) {
    if (gameState === 'test' || gameState === 'race') setPaused(!isPaused);
    else if (gameState === 'countdown') showMenu();
  }
});
window.addEventListener('wheel', e => {
  cameraZoom *= e.deltaY < 0 ? CAMERA.ZOOM_STEP_IN : CAMERA.ZOOM_STEP_OUT;
  cameraZoom  = Math.min(Math.max(cameraZoom, CAMERA.MIN_ZOOM), CAMERA.MAX_ZOOM);
});

// ─── State helpers ───────────────────────────────────────────────────────────

function showMenu() {
  gameState = 'menu';
  menuScreen.classList.add('visible');
  summaryScreen.classList.remove('visible');
  pauseMenu.classList.remove('visible');
  document.getElementById('controls-screen')!.classList.remove('visible');
  document.getElementById('lap-modal')!.classList.remove('visible');
  countdown.hide();
  hud.hideLap();
  hud.setTimer('00:00:000');
  hud.setVisible(false);
  audio.silence();
}

function setPaused(p: boolean) {
  isPaused = p;
  pauseMenu.classList.toggle('visible', p);
  if (p) audio.silence();
  if (p && timerStartTime !== null && timerPausedAt === null) {
    timerPausedAt = performance.now();
  } else if (!p && timerPausedAt !== null && timerStartTime !== null) {
    timerStartTime += performance.now() - timerPausedAt;
    timerPausedAt   = null;
  }
  // Free-drive lap scoreboard in the pause menu
  const scoreSection = document.getElementById('pause-score-section')!;
  if (p && gameState === 'test') {
    scoreSection.style.display = '';
    const best  = testLapTimes.length ? Math.min(...testLapTimes) : null;
    const tbody = document.getElementById('pause-score-body')!;
    tbody.innerHTML = testLapTimes.length
      ? testLapTimes
          .map((t, i) =>
            `<tr class="${t === best && testLapTimes.length > 1 ? 'best-lap' : ''}">
               <td>Lap ${i + 1}</td><td>${Hud.formatTime(t)}</td>
             </tr>`
          )
          .join('')
      : '<tr><td colspan="2" style="color:#555;text-align:center">No laps yet</td></tr>';
    document.getElementById('pause-best-lap')!.innerText =
      best !== null ? Hud.formatTime(best) : '—';
  } else {
    scoreSection.style.display = 'none';
  }

  // Procedural seed display
  const pauseSeedRow = document.getElementById('pause-seed-row')!;
  if (p && currentTrackName === 'procedural') {
    pauseSeedRow.style.display = '';
    document.getElementById('pause-seed')!.innerText = String(currentSeed);
  } else {
    pauseSeedRow.style.display = 'none';
  }
}

function resetCar() {
  const behindX = Math.cos(track.startHeading) * -60;
  const behindY = Math.sin(track.startHeading) * -60;
  car = new Car(
    track.startPos.x + behindX,
    track.startPos.y + behindY,
    track.startHeading
  );
  input.resetRequested = false;
  input.interacted     = false;
  input.throttle       = 0;
  input.brake          = 0;
  input.keys           = {};
  currentCheckpoint    = 1;
  hud.setTimer('00:00:000');
}

async function startTestMode() {
  menuScreen.classList.remove('visible');
  summaryScreen.classList.remove('visible');
  gameState = 'test';
  hud.hideLap();
  hud.setVisible(true, controls.buildHint());
  await loadCurrentTrack();
  resetCar();
  timerStartTime = null;
  timerPausedAt  = null;
  testLapTimes   = [];
  testLapStart   = null;
}

async function startRaceMode() {
  menuScreen.classList.remove('visible');
  summaryScreen.classList.remove('visible');
  hud.setVisible(true, controls.buildHint());
  raceLap      = 0;
  raceLapTimes = [];
  hud.showLap(1, raceTotalLaps);
  await loadCurrentTrack();
  resetCar();
  if (!audioStarted) {
    audio.init();
    audioStarted = true;
  }
  gameState = 'countdown';
  countdown.start();
}

// ─── Checkpoint / lap logic ──────────────────────────────────────────────────
function handleCheckpoints() {
  if (!car || track.checkpoints.length === 0) return;
  if (currentCheckpoint >= track.checkpoints.length) return;

  const cp   = track.checkpoints[currentCheckpoint];
  const midX = (cp.p1.x + cp.p2.x) / 2;
  const midY = (cp.p1.y + cp.p2.y) / 2;
  if (Math.hypot(car.pos.x - midX, car.pos.y - midY) >= 100) return;

  currentCheckpoint++;
  const completedLap = currentCheckpoint >= track.checkpoints.length;
  if (!completedLap) return;
  currentCheckpoint = 0;

  if (gameState === 'test') {
    if (testLapStart !== null) {
      testLapTimes.push(performance.now() - testLapStart);
    }
    testLapStart   = performance.now();
    timerStartTime = performance.now();
    timerPausedAt  = null;
    return;
  }

  if (gameState === 'race') {
    const now     = performance.now();
    const lapTime = now - raceLastLapStart;
    raceLastLapStart = now;
    raceLap++;
    raceLapTimes.push(lapTime);
    if (raceLap >= raceTotalLaps) {
      showRaceSummary();
    } else {
      hud.showLap(raceLap + 1, raceTotalLaps);
    }
  }
}

function showRaceSummary() {
  gameState = 'summary';
  audio.silence();
  summaryScreen.querySelector('h2')!.textContent = 'RACE COMPLETE';
  const total = raceLapTimes.reduce((a, b) => a + b, 0);
  const best  = Math.min(...raceLapTimes);
  document.getElementById('summary-laps')!.innerHTML = raceLapTimes
    .map((t, i) =>
      `<tr class="${t === best && raceLapTimes.length > 1 ? 'best-lap' : ''}">
         <td>Lap ${i + 1}</td><td>${Hud.formatTime(t)}</td>
       </tr>`
    )
    .join('');
  document.getElementById('summary-total')!.innerText     = Hud.formatTime(total);
  document.getElementById('summary-best')!.innerText      = Hud.formatTime(best);
  document.getElementById('summary-track')!.innerText     = capitalize(currentTrackName);
  document.getElementById('summary-laps-done')!.innerText = String(raceTotalLaps);
  setSummarySeed();
  summaryScreen.classList.add('visible');
  hud.hideLap();
}

function showDQ() {
  gameState = 'summary';
  audio.silence();
  countdown.hide();
  summaryScreen.querySelector('h2')!.textContent = 'FALSE START';
  document.getElementById('summary-track')!.innerText     = capitalize(currentTrackName);
  document.getElementById('summary-laps-done')!.innerText = '—';
  document.getElementById('summary-laps')!.innerHTML =
    `<tr><td colspan="2" style="text-align:center;padding:18px 0">
       <span style="color:#ef5350;font-size:15px;font-weight:700;letter-spacing:1px">DISQUALIFIED</span><br>
       <span style="color:#888;font-size:12px">Moved before all 5 lights were lit</span>
     </td></tr>`;
  document.getElementById('summary-total')!.innerText = '—';
  document.getElementById('summary-best')!.innerText  = '—';
  setSummarySeed();
  summaryScreen.classList.add('visible');
  hud.hideLap();
  hud.setVisible(false);
}

function setSummarySeed() {
  const row = document.getElementById('summary-seed-row')!;
  if (currentTrackName === 'procedural') {
    row.style.display = '';
    document.getElementById('summary-seed')!.innerText = String(currentSeed);
  } else {
    row.style.display = 'none';
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── HUD update ──────────────────────────────────────────────────────────────

function updateHUD() {
  if (gameState === 'test' && timerStartTime !== null && input.interacted) {
    hud.setTimer(
      Hud.formatTime((timerPausedAt ?? performance.now()) - timerStartTime)
    );
  }
  if (gameState === 'race' && raceLap < raceTotalLaps) {
    hud.setTimer(Hud.formatTime(performance.now() - raceLastLapStart));
  }
  if (car) hud.setSpeed(car.vel.mag());
}

// ─── Input indicator ─────────────────────────────────────────────────────────

function drawInputIndicator() {
  if (!car || gameState === 'summary') return;

  const cx = canvas.width - 80;
  const cy = canvas.height - 108;
  const ir = 50;

  ctx.save();
  ctx.translate(cx, cy);

  // Steering arc background
  ctx.beginPath();
  ctx.arc(0, 0, ir, -Math.PI, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.11)';
  ctx.lineWidth   = 8;
  ctx.lineCap     = 'round';
  ctx.stroke();

  const steer = Math.max(-1, Math.min(1, car.currentSteer));
  if (Math.abs(steer) > 0.02) {
    const mid = -Math.PI / 2;
    const end = mid + steer * (Math.PI / 2);
    ctx.beginPath();
    ctx.arc(0, 0, ir, Math.min(mid, end), Math.max(mid, end));
    ctx.strokeStyle = steer > 0
      ? 'rgba(239,83,80,0.92)'
      : 'rgba(66,165,245,0.92)';
    ctx.lineWidth = 8;
    ctx.stroke();
  }

  // Needle dot
  const dotA = -Math.PI / 2 + steer * (Math.PI / 2);
  ctx.beginPath();
  ctx.arc(Math.cos(dotA) * ir, Math.sin(dotA) * ir, 7, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();

  // Centre tick
  ctx.beginPath();
  ctx.moveTo(0, -ir - 7);
  ctx.lineTo(0, -ir + 5);
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth   = 2;
  ctx.stroke();

  // Pedal bars
  const barW = 18, barH = 52, barTop = 12;
  const gap  = 12;
  const tX   = -(barW + gap / 2);
  const bX   = gap / 2;

  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(tX, barTop, barW, barH);
  ctx.fillRect(bX, barTop, barW, barH);

  const tVal = input.throttle;
  if (tVal > 0.01) {
    ctx.fillStyle = `rgba(76,175,80,${0.55 + tVal * 0.40})`;
    ctx.fillRect(tX, barTop + barH * (1 - tVal), barW, barH * tVal);
  }

  const bVal = input.brake;
  if (bVal > 0.01) {
    ctx.fillStyle = `rgba(239,83,80,${0.55 + bVal * 0.40})`;
    ctx.fillRect(bX, barTop + barH * (1 - bVal), barW, barH * bVal);
  }

  ctx.font      = 'bold 10px Segoe UI, system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.fillText('T', tX + barW / 2, barTop + barH + 14);
  ctx.fillText('B', bX + barW / 2, barTop + barH + 14);

  ctx.restore();
}

// ─── Game loop ───────────────────────────────────────────────────────────────

function gameLoop(time: number) {
  requestAnimationFrame(gameLoop);

  let dt = (time - lastTime) / 1000;
  if (dt > 0.1) dt = 0.1;
  lastTime = time;

  fpsTimer += dt;
  fpsCount++;
  if (fpsTimer >= 0.5) {
    fpsDisplay = Math.round(fpsCount / fpsTimer);
    fpsCount   = 0;
    fpsTimer   = 0;
  }

  input.update();

  if (!isPaused && input.resetRequested && gameState === 'test') {
    resetCar();
    timerStartTime = null;
    timerPausedAt  = null;
  }
  input.resetRequested = false;

  if (gameState === 'test' && !isPaused && input.interacted && timerStartTime === null) {
    timerStartTime = performance.now();
  }

  if (input.interacted && !audioStarted && gameState !== 'menu') {
    audio.init();
    audioStarted = true;
  }
  audio.resume();

  // Countdown
  if (gameState === 'countdown') {
    const result = countdown.update(dt, input, audio);
    if (result?.type === 'dq') {
      showDQ();
    } else if (result?.type === 'go') {
      gameState        = 'race';
      raceLastLapStart = performance.now() - result.penaltyMs;
    }
  }

  const playing =
    (gameState === 'test' || gameState === 'race' || gameState === 'countdown') &&
    !isPaused;

  if (playing && car && track.innerWall.length > 0) {
    car.update(dt, input, track);
    car.resolveCollisions([...track.barrierInner, ...track.barrierOuter]);
    handleCheckpoints();
  }

  // Re-evaluate: handleCheckpoints() above may have changed gameState (e.g. to 'summary')
  const soundActive =
    (gameState === 'test' || gameState === 'race' || gameState === 'countdown') &&
    !isPaused;
  if (soundActive && car) {
    audio.update(car.vel.mag(), CAR_TOP_SPEED, car.squealIntensity);
  }

  updateHUD();

  // Clear
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (gameState === 'menu' || !car) return;

  // World-space rendering
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  smoothedCamSpeed += (car.vel.mag() - smoothedCamSpeed) * CAMERA.SPEED_SMOOTH;
  const zoom = cameraZoom / (1 + smoothedCamSpeed * CAMERA.SPEED_ZOOM_SCALE);
  ctx.scale(zoom, zoom);
  ctx.rotate(-car.heading - Math.PI / 2);
  ctx.translate(-car.pos.x, -car.pos.y);
  track.draw(ctx, currentCheckpoint);
  car.draw(ctx);
  ctx.restore();

  // Screen-space overlays
  ctx.save();
  ctx.font      = 'bold 13px Segoe UI, system-ui';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(`${fpsDisplay} FPS`, canvas.width - 12, 22);
  ctx.restore();

  drawInputIndicator();
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

showMenu();
requestAnimationFrame(gameLoop);


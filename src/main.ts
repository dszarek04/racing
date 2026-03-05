import { Car } from './entities/Car';
import { Track } from './entities/Track';
import { Input } from './utils/Input';
import { AudioEngine } from './utils/AudioEngine';

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// Resize handling
function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resize);
resize();

// Engine State
const input = new Input();
const audio = new AudioEngine();
let audioStarted = false;
let track = new Track();
let car: Car;
let lastTime = performance.now();
let timerStartTime: number | null = null;
let timerPausedAt: number | null = null;
let currentCheckpoint = 0;
let isPaused = false;
let speedUnit: 'kmh' | 'mph' = 'kmh';
let currentTrackName = 'oval';

// Camera
let cameraZoom = 1.5;
let smoothedCamSpeed = 0;

// Pause menu
const pauseMenu = document.getElementById('pause-menu')!;

function setPaused(p: boolean) {
  isPaused = p;
  pauseMenu.classList.toggle('visible', p);
  if (p && timerStartTime !== null && timerPausedAt === null) {
    timerPausedAt = performance.now();
  } else if (!p && timerPausedAt !== null && timerStartTime !== null) {
    timerStartTime += performance.now() - timerPausedAt;
    timerPausedAt = null;
  }
}

document.getElementById('btn-resume')!.addEventListener('click', () => setPaused(false));

document.querySelectorAll<HTMLButtonElement>('.track-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.track!;
    document.querySelectorAll('.track-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (name !== currentTrackName) {
      currentTrackName = name;
      loadTrack(name);
    }
    setPaused(false);
  });
});

document.querySelectorAll<HTMLButtonElement>('.unit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    speedUnit = btn.dataset.unit as 'kmh' | 'mph';
    document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') setPaused(!isPaused);
});

// Timer / speed HUD
const timerEl = document.getElementById('timer')!;
const speedEl = document.getElementById('speed')!;

function updateHUD() {
  if (timerStartTime !== null && input.interacted) {
    const now = timerPausedAt ?? performance.now();
    const elapsed = now - timerStartTime;
    const m  = Math.floor(elapsed / 60000).toString().padStart(2, '0');
    const s  = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
    const ms = Math.floor(elapsed % 1000).toString().padStart(3, '0');
    timerEl.innerText = `${m}:${s}:${ms}`;
  }
  if (car) {
    const ms = car.vel.mag() * 0.05; // px/s → m/s  (car is 80px = 4m)
    speedEl.innerText = speedUnit === 'kmh'
      ? `${Math.round(ms * 3.6)} km/h`
      : `${Math.round(ms * 2.237)} mph`;
  }
}

// Joystick input indicator (drawn on canvas each frame)
function drawInputIndicator() {
  const r  = 72; // 55 * 1.3
  const cx = canvas.width  - r - 28;
  const cy = canvas.height - r - 62;

  ctx.save();

  // Background circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Tick marks along axes
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  const tickLen = 5;
  for (let t = -2; t <= 2; t++) {
    if (t === 0) continue;
    const off = (t / 2) * r * 0.85;
    // Horizontal ticks on X axis
    ctx.beginPath(); ctx.moveTo(cx + off, cy - tickLen); ctx.lineTo(cx + off, cy + tickLen); ctx.stroke();
    // Vertical ticks on Y axis
    ctx.beginPath(); ctx.moveTo(cx - tickLen, cy + off); ctx.lineTo(cx + tickLen, cy + off); ctx.stroke();
  }

  // Cross lines
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();

  // Labels
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = 'bold 11px Segoe UI, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('W', cx, cy - r + 12);
  ctx.fillText('S', cx, cy + r - 4);
  ctx.textAlign = 'left';
  ctx.fillText('A', cx - r + 4, cy + 4);
  ctx.textAlign = 'right';
  ctx.fillText('D', cx + r - 4, cy + 4);

  // Dot position: X = right-left (steer), Y = brake-throttle (down=brake, up=throttle)
  // Clamp to circle so it doesn't escape into corners
  const rawX = (input.right - input.left)    * r * 0.82;
  const rawY = (input.brake - input.throttle) * r * 0.82;
  const rawLen = Math.hypot(rawX, rawY);
  const maxLen = r * 0.82;
  const clamp  = rawLen > maxLen ? maxLen / rawLen : 1;
  const dotX = cx + rawX * clamp;
  const dotY = cy + rawY * clamp;

  // Glow
  ctx.beginPath();
  ctx.arc(dotX, dotY, 11, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(100, 200, 255, 0.25)';
  ctx.fill();

  // Dot
  ctx.beginPath();
  ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#64c8ff';
  ctx.fill();

  // Handbrake (SPACE) bar below the joystick circle
  const hbW = r * 1.4, hbH = 18;
  const hbX = cx - hbW / 2, hbY = cy + r + 12;
  const handbrakeActive = !!(input.keys[' ']);
  ctx.beginPath();
  ctx.roundRect(hbX, hbY, hbW, hbH, 5);
  ctx.fillStyle = handbrakeActive ? 'rgba(100, 200, 255, 0.55)' : 'rgba(0,0,0,0.45)';
  ctx.fill();
  ctx.strokeStyle = handbrakeActive ? 'rgba(100, 200, 255, 0.9)' : 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = handbrakeActive ? '#fff' : 'rgba(255,255,255,0.45)';
  ctx.font = 'bold 11px Segoe UI, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('SPACE', cx, hbY + 13);

  ctx.restore();
}

function resetGame() {
  const behindX = Math.cos(track.startHeading) * -60;
  const behindY = Math.sin(track.startHeading) * -60;
  car = new Car(track.startPos.x + behindX, track.startPos.y + behindY, track.startHeading);
  timerStartTime = performance.now();
  timerPausedAt = null;
  currentCheckpoint = 1;
  input.resetRequested = false;
  input.interacted = false;
  input.throttle = 0;
  input.brake = 0;
  timerEl.innerText = '00:00:000';
}

async function loadTrack(name: string) {
  input.keys = {};
  input.throttle = 0;
  input.brake = 0;
  input.left = 0;
  input.right = 0;
  input.interacted = false;
  await track.load(`/tracks/${name}.json`);
  resetGame();
}

window.addEventListener('wheel', e => {
  cameraZoom *= e.deltaY < 0 ? 1.05 : 0.95;
  cameraZoom = Math.min(Math.max(cameraZoom, 0.5), 2);
});

function gameLoop(time: number) {
  requestAnimationFrame(gameLoop);

  let dt = (time - lastTime) / 1000;
  if (dt > 0.1) dt = 0.1;
  lastTime = time;

  input.update();
  if (!isPaused && input.resetRequested) resetGame();
  input.resetRequested = false;

  if (!isPaused && input.interacted && timerStartTime === null) {
    timerStartTime = performance.now();
  }

  // Start audio on first interaction (browser autoplay policy)
  if (input.interacted && !audioStarted) {
    audio.init();
    audioStarted = true;
  }
  audio.resume();

  if (!isPaused && car && track.innerWall.length > 0) {
    car.update(dt, input, track);
    car.resolveCollisions([...track.barrierInner, ...track.barrierOuter]);

    if (currentCheckpoint < track.checkpoints.length) {
      const cp = track.checkpoints[currentCheckpoint];
      const dist = Math.hypot(car.pos.x - (cp.p1.x + cp.p2.x) / 2, car.pos.y - (cp.p1.y + cp.p2.y) / 2);
      if (dist < 100) {
        currentCheckpoint++;
        if (currentCheckpoint >= track.checkpoints.length) {
          currentCheckpoint = 0;
          timerStartTime = performance.now();
        }
      }
    }
  }

  if (car) {
    const topSpeed = 500 / (60 * (1 - 0.990)); // matches Car friction/acceleration
    audio.update(car.vel.mag(), topSpeed, car.driftRatio);
  }

  updateHUD();

  // Clear
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!car) return;

  // World render
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  smoothedCamSpeed += (car.vel.mag() - smoothedCamSpeed) * 0.08;
  const baseZoom = cameraZoom / (1 + smoothedCamSpeed * 0.001);
  ctx.scale(baseZoom, baseZoom);
  ctx.rotate(-car.heading - Math.PI / 2);
  ctx.translate(-car.pos.x, -car.pos.y);
  track.draw(ctx, currentCheckpoint);
  car.draw(ctx);
  ctx.restore();

  // Screen-space HUD overlays
  drawInputIndicator();
}

loadTrack('oval').then(() => requestAnimationFrame(gameLoop));

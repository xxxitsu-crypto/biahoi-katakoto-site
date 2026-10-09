// PC操作確認版。既存の InputHandler / SealPlayer / Ball / drawCourt を継承。
// 数値は60回/秒の固定更新を前提とする。描画回数とは切り離す。
const CANVAS_WIDTH = 256;
const CANVAS_HEIGHT = 240;
const SETTINGS = {
  stepMs: 1000 / 60,
  moveImpulse: 1.2,
  dashImpulse: 4.2,
  verticalRatio: 0.7,
  friction: 0.85,
  rhythmFirstMaxMs: 180,
  rhythmSecondMinMs: 120,
  rhythmSecondMaxMs: 280,
  swingTicks: 12,
  hitRadius: 14,       // コート平面上でラケットが届く距離（仮）
  hitHeight: 12,      // ラケットの高さから上下に届く距離（仮）
  gravity: 0.08,
};
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const modeButton = document.getElementById('btn-mode');
const resetButton = document.getElementById('btn-reset');
const guideButton = document.getElementById('btn-guide');
let practiceMode = 'rally'; // 'rally' または 'serve'
let showGuide = false;
const score = { player: 0, cpu: 0 };

const SPRITE_CONFIG = {
  file: 'seal_move_sheet.png',
  frames: 4,
  frameWidth: 71,
  frameHeight: 76,
  drawWidth: 32,
  drawHeight: 34,
};

const DASH_SPRITE = {
  file: 'seal_dash.png',
  frames: 2,
  frameWidth: 101,
  frameHeight: 63,
  drawWidth: 46,
  drawHeight: 28,
  offsetX: -7,
  offsetY: -14,
};

const VOLLEY = {
  fore: {
    file: 'volley_right.png',
    frames: 7,
    sourceWidth: 71,
    sourceHeight: 76,
    cropX: 0,
    cropY: 0,
    drawOffsetX: -7,
    drawOffsetY: -20,
    phases: [
      { frame: 0, ticks: 3, quality: null },
      { frame: 1, ticks: 3, quality: 'float' },
      { frame: 2, ticks: 4, quality: 'critical' },
      { frame: 3, ticks: 4, quality: 'critical' },
      { frame: 4, ticks: 4, quality: 'float' },
      { frame: 5, ticks: 4, quality: null },
      { frame: 6, ticks: 4, quality: null },
    ],
    racketRadii: [[7, 6], [7, 6], [8, 6], [8, 6], [7, 6], [6, 6], [5, 5]],
    racketCenters: [[43, 62], [47, 53], [54, 45], [54, 38], [51, 35], [44, 39], [34, 47]],
  },
  back: {
    file: 'volley_left.png',
    frames: 7,
    sourceWidth: 71,
    sourceHeight: 76,
    cropX: 0,
    cropY: 0,
    drawOffsetX: -7,
    drawOffsetY: -20,
    phases: [
      { frame: 0, ticks: 3, quality: null },
      { frame: 1, ticks: 3, quality: 'float' },
      { frame: 2, ticks: 4, quality: 'critical' },
      { frame: 3, ticks: 4, quality: 'critical' },
      { frame: 4, ticks: 4, quality: 'float' },
      { frame: 5, ticks: 4, quality: null },
      { frame: 6, ticks: 4, quality: null },
    ],
    racketRadii: [[7, 6], [7, 6], [8, 6], [8, 6], [7, 6], [6, 6], [5, 5]],
    racketCenters: [[30, 62], [26, 53], [19, 45], [19, 38], [22, 35], [29, 39], [39, 47]],
  },
  smash: {
    file: 'serve_smash.png',
    frames: 5,
    sourceWidth: 80,
    sourceHeight: 101,
    cropX: 0,
    cropY: 0,
    drawOffsetX: -11,
    drawOffsetY: -31,
    drawWidth: 36,
    drawHeight: 45,
    phases: [
      { frame: 0, ticks: 4, quality: null },
      { frame: 1, ticks: 3, quality: 'smash' },
      { frame: 2, ticks: 4, quality: 'smash' },
      { frame: 3, ticks: 5, quality: 'float' },
      { frame: 4, ticks: 6, quality: null },
    ],
    racketRadii: [[7, 7], [8, 8], [9, 8], [8, 7], [7, 6]],
    racketCenters: [[52, 42], [57, 24], [62, 29], [62, 48], [55, 69]],
  },
  serve: {
    file: 'serve_smash.png',
    frames: 5,
    sourceWidth: 80,
    sourceHeight: 101,
    cropX: 0,
    cropY: 0,
    drawOffsetX: -11,
    drawOffsetY: -31,
    drawWidth: 36,
    drawHeight: 45,
    phases: [
      { frame: 0, ticks: 4, quality: null },
      { frame: 1, ticks: 3, quality: 'serve' },
      { frame: 2, ticks: 4, quality: 'serve' },
      { frame: 3, ticks: 5, quality: 'float' },
      { frame: 4, ticks: 6, quality: null },
    ],
    racketRadii: [[7, 7], [8, 8], [9, 8], [8, 7], [7, 6]],
    racketCenters: [[52, 42], [57, 24], [62, 29], [62, 48], [55, 69]],
  },
};

const sealImage = new Image();
sealImage.src = 'assets/move_01.png';

const spriteImages = {
  moveRight: { file: 'seal_move_sheet.png' },
  moveLeft: { file: 'seal_move_L_sheet.png' },
  dashRight: { file: 'seal_dash.png' },
  dashLeft: { file: 'seal_dash_L.png' },
};
for (const config of Object.values(spriteImages)) {
  const image = new Image();
  image.src = `assets/${config.file}`;
  config.image = image;
}

for (const config of Object.values(VOLLEY)) {
  config.image = new Image();
  config.image.src = `assets/${config.file}`;
}

class InputHandler {
  constructor() {
    this.action = false;
    this.actionDown = false;
    this.actionUp = false;
    this.history = { up: [], down: [], left: [], right: [] };
    this.consumeQueue = [];
    this.heldDirections = new Set();
    this.touchDirection = null;
    this.initKeyboard();
    this.initTouch();
  }
  registerPress(dir) {
    const now = performance.now();
    const h = this.history[dir];
    h.push(now);
    if (h.length > 3) h.shift();
    let isRhythmJump = false;
    if (h.length === 3) {
      const interval1 = h[1] - h[0];
      const interval2 = h[2] - h[1];
      if (
        interval1 < SETTINGS.rhythmFirstMaxMs &&
        interval2 >= SETTINGS.rhythmSecondMinMs &&
        interval2 <= SETTINGS.rhythmSecondMaxMs
      ) {
        isRhythmJump = true;
        this.history[dir] = [];
      }
    }
    this.consumeQueue.push({ dir, isRhythmJump });
  }
  initKeyboard() {
    const map = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    window.addEventListener('keydown', (e) => {
      if (map[e.key]) {
        e.preventDefault();
        this.heldDirections.add(map[e.key]);
        if (!e.repeat) this.registerPress(map[e.key]);
      }
      if ((e.key === 'z' || e.key === 'Z' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        this.action = true;
        this.actionDown = true;
      }
    });
    window.addEventListener('keyup', (e) => {
      if (map[e.key]) {
        this.heldDirections.delete(map[e.key]);
      }
      if (e.key === 'z' || e.key === 'Z' || e.key === ' ') {
        this.action = false;
        this.actionUp = true;
      }
    });
  }
  initTouch() {
    const list = [
      { id: 'btn-up', dir: 'up' },
      { id: 'btn-down', dir: 'down' },
      { id: 'btn-left', dir: 'left' },
      { id: 'btn-right', dir: 'right' },
    ];
    list.forEach(({ id, dir }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const start = (e) => {
        e.preventDefault();
        this.heldDirections.add(dir);
        this.registerPress(dir);
      };
      const stop = (e) => {
        e.preventDefault();
        this.heldDirections.delete(dir);
      };
      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('touchend', stop, { passive: false });
      el.addEventListener('mousedown', start);
      el.addEventListener('mouseup', stop);
      el.addEventListener('mouseleave', stop);
    });
    const act = document.getElementById('btn-action');
    if (act) {
      const trigger = (e) => {
        e.preventDefault();
        this.action = true;
        this.actionDown = true;
      };
      const stop = (e) => {
        e.preventDefault();
        this.action = false;
        this.actionUp = true;
      };
      act.addEventListener('touchstart', trigger, { passive: false });
      act.addEventListener('touchend', stop, { passive: false });
      act.addEventListener('mousedown', trigger);
      act.addEventListener('mouseup', stop);
    }
  }
  popAction() { return this.consumeQueue.shift(); }
  pollActionDown() {
    const down = this.actionDown;
    this.actionDown = false;
    return down;
  }
  pollActionUp() {
    const up = this.actionUp;
    this.actionUp = false;
    return up;
  }
  isHeld(dir) { return this.heldDirections.has(dir); }
}

class SealPlayer {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.width = 16;
    this.height = 12;
    this.isDashing = false;
    this.animationTick = 0;
    this.facing = 1; // 1: 右, -1: 左
    this.shotType = 'fore';
    this.isPreparing = false;
    this.isSwinging = false;
    this.swingTimer = 0;
    this.swingProgress = 0;
    this.hasHit = false;
  }
  decideShotType(ball) {
    if (practiceMode === 'serve' && ball.serveWaiting) return 'serve';
    if (ball.z >= 16 && ball.y < this.y) return 'smash';
    return this.facing === 1 ? 'fore' : 'back';
  }
  getShotDuration() {
    const config = VOLLEY[this.shotType];
    return config.phases.reduce((sum, phase) => sum + phase.ticks, 0);
  }
  getShotPhase() {
    const config = VOLLEY[this.shotType];
    let time = this.swingProgress;
    for (const phase of config.phases) {
      if (time < phase.ticks) return phase;
      time -= phase.ticks;
    }
    return null;
  }
  getHitQuality() {
    if (!this.isSwinging || this.hasHit) return null;
    return this.getShotPhase()?.quality || null;
  }
  getVolleyFrame() {
    if (!VOLLEY[this.shotType]) return null;
    if (this.isSwinging) return this.getShotPhase()?.frame ?? null;
    return this.isPreparing || this.shotType === 'serve' ? 0 : null;
  }
  getRacketPosition() {
    const config = VOLLEY[this.shotType];
    const frame = this.getVolleyFrame();
    if (config && frame !== null) {
      const [sourceX, sourceY] = config.racketCenters[frame];
      const lift = config.frameLifts?.[frame] ?? 0;
      const projectedX = Math.round(this.x + config.drawOffsetX) +
        (sourceX - config.cropX) * (config.drawWidth ?? SPRITE_CONFIG.drawWidth) / (config.sourceWidth ?? 71);
      const projectedY = Math.round(this.y + (config.drawOffsetY ?? -20) - lift) +
        (sourceY - config.cropY) * (config.drawHeight ?? SPRITE_CONFIG.drawHeight) / (config.sourceHeight ?? 76);
      const groundY = this.y + 6;
      const [rx, ry] = config.racketRadii[frame];
      const radiusX = rx * (config.drawWidth ?? SPRITE_CONFIG.drawWidth) / (config.sourceWidth ?? 71);
      const radiusY = ry * (config.drawHeight ?? SPRITE_CONFIG.drawHeight) / (config.sourceHeight ?? 76);
      return { x: projectedX, y: groundY, z: groundY - projectedY,
        radiusX, radiusY, hitRadius: SETTINGS.hitRadius, hitHeight: SETTINGS.hitHeight };
    }
    const offsetX = this.facing === 1 ? this.width + 4 : -4;
    return { x: this.x + offsetX, y: this.y + 6, z: 10,
      radiusX: 6, radiusY: 5, hitRadius: SETTINGS.hitRadius, hitHeight: SETTINGS.hitHeight };
  }
  update(input, ball) {
    if (input.pollActionDown()) {
      if (practiceMode === 'serve' && ball.serveWaiting) {
        if (ball.servePhase === 'waiting') {
          this.shotType = 'serve';
          this.isPreparing = true;
          ball.beginServePreparation();
        } else if (ball.servePhase === 'toss') {
          this.shotType = 'serve';
          this.isPreparing = false;
          this.isSwinging = true;
          this.swingTimer = this.getShotDuration();
          this.swingProgress = 0;
          this.hasHit = false;
        }
      } else if (!this.isSwinging) {
        this.shotType = this.decideShotType(ball);
        this.isPreparing = true;
      }
    }
    if (practiceMode !== 'serve' && input.pollActionUp() && this.isPreparing && !this.isSwinging) {
      this.isPreparing = false;
      this.isSwinging = true;
      this.swingTimer = this.getShotDuration();
      this.swingProgress = 0;
      this.hasHit = false;
    }
    let act;
    while ((act = input.popAction())) {
      const { dir, isRhythmJump } = act;
      const speed = isRhythmJump ? SETTINGS.dashImpulse : SETTINGS.moveImpulse;
      if (isRhythmJump) {
        this.isDashing = true;
        this.animationTick = 0;
      }
      if (dir === 'left') { this.vx -= speed; this.facing = -1; }
      if (dir === 'right') { this.vx += speed; this.facing = 1; }
      if (dir === 'up') this.vy -= speed * SETTINGS.verticalRatio;
      if (dir === 'down') this.vy += speed * SETTINGS.verticalRatio;
    }
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= SETTINGS.friction;
    this.vy *= SETTINGS.friction;
    if (Math.abs(this.vx) < 0.05) this.vx = 0;
    if (Math.abs(this.vy) < 0.05) this.vy = 0;
    if (this.vx === 0 && this.vy === 0) this.isDashing = false;
    this.x = Math.max(24, Math.min(CANVAS_WIDTH - 24 - this.width, this.x));
    this.y = Math.max(130, Math.min(218 - this.height, this.y));
    const moving = this.vx !== 0 || this.vy !== 0 ||
      input.isHeld('left') || input.isHeld('right') || input.isHeld('up') || input.isHeld('down');
    if (moving) this.animationTick++;
    else if (!this.isDashing) this.animationTick = 0;
    if (this.isSwinging) {
      this.swingProgress++;
      this.swingTimer--;
      if (this.swingTimer <= 0) {
        this.isSwinging = false;
        this.swingProgress = 0;
        this.hasHit = false;
        if (practiceMode === 'serve' && ball.servePhase === 'rally') ball.resetPlayerServe();
      }
    }
  }
  draw(context) {
    context.fillStyle = 'rgba(0, 0, 0, 0.4)';
    context.fillRect(this.x, this.y + this.height - 2, this.width, 3);
    const moving = this.vx !== 0 || this.vy !== 0;
    const volley = VOLLEY[this.shotType];
    const volleyFrame = this.getVolleyFrame();
    if (volley && volley.image.complete && volley.image.naturalWidth && volleyFrame !== null) {
      const cropX = volley.cropX + volleyFrame * volley.sourceWidth;
      const cropY = volley.cropY;
      const frameLift = volley.frameLifts?.[volleyFrame] ?? 0;
      context.drawImage(
        volley.image,
        cropX, cropY, volley.sourceWidth, volley.sourceHeight,
        Math.round(this.x + volley.drawOffsetX),
        Math.round(this.y + volley.drawOffsetY - frameLift),
        volley.drawWidth ?? SPRITE_CONFIG.drawWidth,
        volley.drawHeight ?? SPRITE_CONFIG.drawHeight
      );
    } else {
      const dash = moving && this.isDashing;
      const spriteKey = dash
        ? (this.facing === 1 ? 'dashRight' : 'dashLeft')
        : (this.facing === 1 ? 'moveRight' : 'moveLeft');
      const sprite = spriteImages[spriteKey];
      if (sprite && sprite.image.complete && sprite.image.naturalWidth) {
        if (dash) {
          const frame = Math.floor(this.animationTick / 6) % DASH_SPRITE.frames;
          const sx = frame * DASH_SPRITE.frameWidth;
          context.drawImage(
            sprite.image,
            sx, 0, DASH_SPRITE.frameWidth, DASH_SPRITE.frameHeight,
            Math.round(this.x + DASH_SPRITE.offsetX),
            Math.round(this.y + DASH_SPRITE.offsetY),
            DASH_SPRITE.drawWidth, DASH_SPRITE.drawHeight
          );
        } else {
          const frame = moving ? Math.floor(this.animationTick / 8) % SPRITE_CONFIG.frames : 0;
          const sx = frame * SPRITE_CONFIG.frameWidth;
          context.drawImage(
            sprite.image,
            sx, 0, SPRITE_CONFIG.frameWidth, SPRITE_CONFIG.frameHeight,
            Math.round(this.x - 7), Math.round(this.y - 20),
            SPRITE_CONFIG.drawWidth, SPRITE_CONFIG.drawHeight
          );
        }
      } else if (sealImage.complete && sealImage.naturalWidth) {
        context.drawImage(sealImage, Math.round(this.x - 7), Math.round(this.y - 20), 32, 34);
      } else {
        context.fillStyle = this.isDashing ? '#e0ffff' : '#68c2d3';
        context.fillRect(Math.floor(this.x), Math.floor(this.y), this.width, this.height);
      }
    }
    if (showGuide && (this.isSwinging || this.isPreparing)) {
      const r = this.getRacketPosition();
      context.strokeStyle = ['critical', 'smash', 'serve'].includes(this.getHitQuality()) ? '#66ff99' : this.getHitQuality() === 'float' ? '#ff9966' : this.isPreparing ? '#ffff66' : '#8feaff';
      context.lineWidth = 1;
      context.beginPath();
      context.ellipse(r.x, r.y - r.z, r.radiusX, r.radiusY, 0, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      context.beginPath();
      context.ellipse(r.x, r.y, r.radiusX, r.radiusY * 0.5, 0, 0, Math.PI * 2);
      context.stroke();
    }
  }
}

const CPU_SPRITES = {
  moveRight: { file: '2P_seal_move_sheet.png', frames: 4, w: 71, h: 76 },
  moveLeft:  { file: '2P_seal_move_L_sheet.png', frames: 4, w: 71, h: 76 },
  dashRight: { file: '2P_seal_dash.png', frames: 2, w: 101, h: 63 },
  dashLeft:  { file: '2P_seal_dash_L.png', frames: 2, w: 101, h: 63 },
  volleyRight: { file: '2p_bolay.png', frames: 7, w: 71, h: 76 },
  volleyLeft:  { file: '2p_bolay_L.png', frames: 7, w: 71, h: 76 },
  overhead:    { file: '2p_sarv.png', frames: 5, w: 80, h: 101 },
};
for (const [key, cfg] of Object.entries(CPU_SPRITES)) {
  const image = new Image(); image.src = `assets/${cfg.file}`;
  CPU_SPRITES[key].image = image;
}

const CPU_SHOTS = {
  volleyRight: {
    phases: [
      { frame: 0, ticks: 3, quality: null },
      { frame: 1, ticks: 3, quality: 'float' },
      { frame: 2, ticks: 4, quality: 'critical' },
      { frame: 3, ticks: 4, quality: 'critical' },
      { frame: 4, ticks: 4, quality: 'float' },
      { frame: 5, ticks: 4, quality: null },
      { frame: 6, ticks: 4, quality: null },
    ],
    radii: [[7,6],[7,6],[8,6],[8,6],[7,6],[6,6],[5,5]],
    centers: [[43,62],[47,53],[54,45],[54,38],[51,35],[44,39],[34,47]],
  },
  volleyLeft: {
    phases: [
      { frame: 0, ticks: 3, quality: null },
      { frame: 1, ticks: 3, quality: 'float' },
      { frame: 2, ticks: 4, quality: 'critical' },
      { frame: 3, ticks: 4, quality: 'critical' },
      { frame: 4, ticks: 4, quality: 'float' },
      { frame: 5, ticks: 4, quality: null },
      { frame: 6, ticks: 4, quality: null },
    ],
    radii: [[7,6],[7,6],[8,6],[8,6],[7,6],[6,6],[5,5]],
    centers: [[30,62],[26,53],[19,45],[19,38],[22,35],[29,39],[39,47]],
  },
  overhead: {
    phases: [
      { frame: 0, ticks: 4, quality: null },
      { frame: 1, ticks: 3, quality: 'smash' },
      { frame: 2, ticks: 4, quality: 'smash' },
      { frame: 3, ticks: 5, quality: 'float' },
      { frame: 4, ticks: 6, quality: null },
    ],
    radii: [[7,7],[8,8],[9,8],[8,7],[7,6]],
    centers: [[52,42],[57,24],[62,29],[62,48],[55,69]],
  },
};

class CpuPlayer {
  constructor(x, y) {
    this.homeX = x; this.homeY = y;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.facing = 1; this.visualFacing = 1;
    this.animationTick = 0;
    this.isSwinging = false; this.swingTick = 0;
    this.shotKind = 'volleyRight';
    this.hasHit = false;
    this.dashTimer = 0; this.serveAge = 0;
    this.moving = false;
  }
  reset() {
    this.x = this.homeX; this.y = this.homeY;
    this.vx = 0; this.vy = 0;
    this.isSwinging = false; this.swingTick = 0;
    this.hasHit = false; this.dashTimer = 0;
    this.serveAge = 0; this.moving = false;
  }
  shotConfig() { return CPU_SHOTS[this.shotKind]; }
  phase() {
    if (!this.isSwinging) return null;
    let t = this.swingTick;
    for (const p of this.shotConfig().phases) {
      if (t < p.ticks) return p;
      t -= p.ticks;
    }
    return null;
  }
  startSwing(kind) {
    this.shotKind = kind;
    this.isSwinging = true;
    this.swingTick = 0;
    this.hasHit = false;
  }
  racket() {
    const p = this.phase();
    const frame = p ? p.frame : 0;
    const cfg = this.shotConfig();
    const [cx, cy] = cfg.centers[frame];
    const [rx, ry] = cfg.radii[frame];
    const scale = 32 / 71;
    const ox = this.shotKind === 'overhead' ? -55 * scale : -15;
    const oy = this.shotKind === 'overhead' ? -90 * scale : -32;
    const px = Math.round(this.x + ox) + cx * scale;
    const py = Math.round(this.y + oy) + cy * scale;
    const groundY = this.y + 4;
    return {
      x: px, y: groundY, z: groundY - py,
      radiusX: rx * scale, radiusY: ry * scale,
      hitRadius: SETTINGS.hitRadius, hitHeight: SETTINGS.hitHeight,
    };
  }
  update(ball) {
    if (this.isSwinging) {
      this.swingTick++;
      const total = this.shotConfig().phases.reduce((s, p) => s + p.ticks, 0);
      if (this.swingTick >= total) {
        this.isSwinging = false;
        this.swingTick = 0;
        this.hasHit = false;
      }
    }
    const ballComing = ball.vy < 0 && ball.y < 128 && ball.lastHitter === 'player';
    let targetX = this.homeX, targetY = this.homeY;
    if (ballComing) {
      targetX = Math.max(36, Math.min(220, ball.x));
      targetY = Math.max(48, Math.min(84, ball.y));
    }
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy);
    this.moving = dist > 2;
    if (this.moving) {
      this.facing = dx >= 0 ? 1 : -1;
      this.visualFacing = this.facing;
      const speed = dist > 42 ? 2.4 : 1.1;
      this.vx = (dx / dist) * speed;
      this.vy = (dy / dist) * speed * 0.7;
      this.animationTick++;
    } else {
      this.vx *= 0.8; this.vy *= 0.8;
      this.visualFacing = ball.x >= this.x ? 1 : -1;
      this.animationTick = 0;
    }
    this.x += this.vx; this.y += this.vy;
    this.x = Math.max(28, Math.min(228, this.x));
    this.y = Math.max(42, Math.min(88, this.y));
    if (ballComing && !this.isSwinging && !this.hasHit && ball.y < 92) {
      const rx = ball.x - this.x;
      const shouldSmash = ball.z >= 14;
      const kind = shouldSmash ? 'overhead' : (rx >= 0 ? 'volleyRight' : 'volleyLeft');
      const timeToRacket = (ball.y - this.y) / Math.abs(ball.vy || 1);
      if (timeToRacket <= 5) this.startSwing(kind);
    }
  }
  canHit(ball) {
    if (!this.isSwinging || this.hasHit || !this.phase()?.quality || ball.lastHitter !== 'player' || ball.vy >= 0 || ball.y >= 120) return false;
    const r = this.racket();
    return Math.hypot(ball.x - r.x, ball.y - r.y) < r.hitRadius && Math.abs(ball.z - r.z) < r.hitHeight;
  }
  hit(ball) {
    const quality = this.phase()?.quality; if (!quality || this.hasHit) return;
    this.hasHit = true; ball.lastHitter = 'cpu'; ball.bouncesInCurrentCourt = 0;
    ball.curve = 0;
    ball.launch(128 + (Math.random() * 56 - 28), 176, quality === 'smash' ? 46 : quality === 'float' ? 76 : 62);
    ball.message = quality === 'smash' ? 'CPUスマッシュ' : quality === 'float' ? 'CPU浮き球' : 'CPUクリティカル';
  }
  updateServe(ball) {
    this.serveAge++;
    if (this.serveAge <= 30) {
      this.shotKind = 'overhead';
      Object.assign(ball, { x: this.x + (34 - 55) * 32 / 71, y: this.y, z: 30 * 32 / 71, vx: 0, vy: 0, vz: 2 });
      ball.message = 'CPUサーブ：構え'; return;
    }
    ball.z += ball.vz; ball.vz -= ball.gravity;
    if (this.serveAge === 40) this.startSwing('overhead');
    if (this.isSwinging && !this.hasHit && this.phase()?.quality) {
      const r = this.racket();
      if (Math.hypot(ball.x - r.x, ball.y - r.y) < r.hitRadius && Math.abs(ball.z - r.z) < r.hitHeight) {
        this.hasHit = true; ball.cpuServing = false; ball.lastHitter = 'cpu'; ball.bouncesInCurrentCourt = 0;
        ball.launch(128 + (Math.random() * 40 - 20), 176, 62); ball.message = 'CPUサーブ'; return;
      }
    }
    if (ball.z <= 0) { this.reset(); ball.message = 'CPUサーブやり直し'; }
  }
  draw(context) {
    context.fillStyle = 'rgba(0,0,0,0.4)'; context.fillRect(this.x - 8, this.y + 1, 16, 3);
    const overheadReady = ball.cpuServing;
    const shot = this.isSwinging || overheadReady;
    const key = shot ? this.shotKind : (this.dashTimer && this.moving ? 'dash' : 'move') + (this.visualFacing < 0 ? 'Left' : 'Right');
    const cfg = CPU_SPRITES[key];
    const frame = shot ? (this.phase()?.frame ?? 0) : this.moving ? Math.floor(this.animationTick / (this.dashTimer ? 6 : 5)) % cfg.frames : 0;
    const scale = 32 / 71;
    const width = cfg.w * scale, height = cfg.h * scale;
    const ox = shot ? -55 * scale : -15, oy = shot ? -90 * scale : -32;
    const lift = shot ? (CPU_SHOTS[this.shotKind].lifts?.[frame] ?? 0) : 0;
    if (cfg.image.complete && cfg.image.naturalWidth === cfg.w * cfg.frames && cfg.image.naturalHeight === cfg.h)
      context.drawImage(cfg.image, frame * cfg.w, 0, cfg.w, cfg.h, this.x + ox, this.y + oy - lift, width, height);
    else { context.fillStyle = '#ff9b00'; context.fillRect(this.x - 8, this.y - 14, 16, 16); }
    if (showGuide && shot) {
      const r = this.racket(); context.strokeStyle = this.phase()?.quality ? '#66ff99' : '#8feaff';
      context.beginPath(); context.ellipse(r.x, r.y - r.z, r.radiusX, r.radiusY, 0, 0, Math.PI * 2); context.stroke();
    }
  }
}

class Ball {
  constructor() { this.returnCount = 0; this.resetServe(); }
  resetServe() {
    this.x = CANVAS_WIDTH / 2 + (Math.random() * 24 - 12);
    this.y = 56; this.z = 16;
    this.gravity = SETTINGS.gravity;
    this.bounce = -0.85; this.radius = 3;
    this.bouncesInCurrentCourt = 0;
    this.hitNet = false;
    this.curve = 0;
    this.lastHitter = 'cpu';
    this.resetTimer = 0;
    this.message = practiceMode === 'serve' ? '1回押すと構え→トス' : 'CPUサーブ';
    this.serveWaiting = practiceMode === 'serve';
    this.serving = false;
    this.servePhase = this.serveWaiting ? 'waiting' : 'rally';
    this.cpuServing = practiceMode === 'rally';
    this.servePrepareTicks = 0;
    this.launch(CANVAS_WIDTH / 2 + (Math.random() * 40 - 20), 176, 58);
  }
  launch(targetX, targetY, ticks) {
    this.vx = (targetX - this.x) / ticks;
    this.vy = (targetY - this.y) / ticks;
    this.vz = (0.5 * this.gravity * ticks * (ticks - 1) - this.z) / ticks;
  }
  resetPlayerServe() {
    this.servePhase = 'waiting';
    this.serveWaiting = true;
    this.serving = false;
    this.servePrepareTicks = 0;
    this.vx = this.vy = this.vz = 0;
    this.message = '1回押すと構え→トス';
  }
  beginServePreparation() {
    this.servePhase = 'preparing';
    this.servePrepareTicks = 12;
    this.message = '構え';
  }
  getServeHandPosition(player) {
    const config = VOLLEY.serve;
    const handX = Math.round(player.x + config.drawOffsetX) + 64 * config.drawWidth / 80;
    const handScreenY = Math.round(player.y + config.drawOffsetY) + 59 * config.drawHeight / 101;
    const groundY = player.y + 6;
    return { x: handX, y: groundY, z: groundY - (handScreenY - this.radius) };
  }
  updatePlayerServe(player) {
    if (this.servePhase === 'waiting' || this.servePhase === 'preparing') {
      Object.assign(this, this.getServeHandPosition(player));
      this.vx = this.vy = this.vz = 0;
      if (this.servePhase === 'preparing' && --this.servePrepareTicks <= 0) {
        this.servePhase = 'toss';
        this.serveWaiting = false;
        this.serving = true;
        this.vz = 2.2;
        this.message = 'トス：もう一度押してサーブ';
      }
      return;
    }
    if (this.servePhase === 'miss') {
      if (!player.isSwinging) {
        player.isPreparing = false;
        this.resetPlayerServe();
        Object.assign(this, this.getServeHandPosition(player));
      }
      return;
    }
    this.z += this.vz;
    this.vz -= this.gravity;
    if (player.getHitQuality() === 'serve') {
      const r = player.getRacketPosition();
      if (Math.hypot(this.x - r.x, this.y - r.y) < r.hitRadius &&
          Math.abs(this.z - r.z) < r.hitHeight) {
        player.hasHit = true;
        this.serving = false;
        this.serveWaiting = false;
        this.servePhase = 'rally';
        this.lastHitter = 'player';
        this.bouncesInCurrentCourt = 0;
        this.curve = 0;
        this.launch(128, 60, 40);
        this.message = 'サーブ';
        return;
      }
    }
    if (this.z <= 0) {
      this.z = 0;
      this.servePhase = 'miss';
      this.message = '空振り：構え直し';
    }
  }
  endRally(message, winner = null) {
    if (this.resetTimer) return;
    if (winner) score[winner]++;
    this.message = (winner === 'player' ? 'YOU +1：' : winner === 'cpu' ? 'CPU +1：' : '') + message;
    this.resetTimer = 54;
  }
  update(player, opponent) {
    if (this.serveWaiting || this.serving) {
      this.updatePlayerServe(player);
      return;
    }
    if (this.resetTimer) {
      if (--this.resetTimer === 0) {
        this.resetServe();
        opponent?.reset();
      }
      return;
    }
    if (this.cpuServing) { opponent.updateServe(this); return; }
    if (this.curve) { this.vx += this.curve; }
    const oldY = this.y, oldZ = this.z;
    this.x += this.vx; this.y += this.vy;
    this.z += this.vz; this.vz -= this.gravity;
    const crossing = (oldY < 120 && this.y >= 120) || (oldY > 120 && this.y <= 120);
    if (crossing) {
      const fraction = (120 - oldY) / (this.y - oldY);
      const crossingHeight = oldZ + (this.z - oldZ) * fraction;
      if (crossingHeight < 12) {
        this.hitNet = true;
        this.endRally('ネット / 自動再開', this.lastHitter === 'player' ? 'cpu' : 'player');
        return;
      }
      this.bouncesInCurrentCourt = 0;
    }
    if (this.z <= 0 && oldZ > 0) {
      this.z = 0;
      this.vz *= this.bounce;
      this.bouncesInCurrentCourt++;
      // 1バウンド目のラインアウト判定
      if (this.bouncesInCurrentCourt === 1) {
        const isCpuCourt = this.y < 120;
        const courtTop = isCpuCourt ? 46 : 120;
        const courtBottom = isCpuCourt ? 120 : 204;
        if (this.x < 36 || this.x > 220 || this.y < courtTop || this.y > courtBottom) {
          const winner = this.lastHitter === 'player' ? 'cpu' : 'player';
          this.endRally('アウト！ / 自動再開', winner);
          return;
        }
      }
      if (this.bouncesInCurrentCourt >= 2) {
        this.endRally('2バウンド / 自動再開', this.y < 120 ? 'player' : 'cpu');
        return;
      }
    }
    const quality = player.getHitQuality();
    if (quality && this.lastHitter === 'cpu' && this.y > 120) {
      const r = player.getRacketPosition();
      const distance = Math.hypot(this.x - r.x, this.y - r.y);
      if (distance < r.hitRadius && Math.abs(this.z - r.z) < r.hitHeight) {
        player.hasHit = true;
        this.lastHitter = 'player';
        const isVolley = (this.bouncesInCurrentCourt === 0);
        this.bouncesInCurrentCourt = 0;
        this.returnCount++;
        // ダッシュボレー時のカーブ
        if (player.isDashing && isVolley) {
          this.curve = player.vx > 0 ? 0.04 : -0.04;
        } else {
          this.curve = 0;
        }
        const targetX = Math.max(34, Math.min(222, 128 + (this.x - r.x) * 4));
        if (quality === 'smash') {
          this.launch(targetX, 58, 34);
          this.message = 'スマッシュ！';
        } else if (quality === 'critical') {
          this.launch(targetX, 60, 44);
          this.message = (player.isDashing && isVolley) ? 'カーブボレー！' : 'クリティカル！';
        } else {
          if (this.z < 10) {
            this.launch(targetX, 90, 48); // 打点が低いとネット直撃リスク増
            this.message = '低い打球（ネット注意）';
          } else {
            this.launch(targetX, 66, 70);
            this.message = '浮き球';
          }
        }
      }
    }
    if (opponent?.canHit(this)) opponent.hit(this);
    if (this.y > CANVAS_HEIGHT + 10 || this.y < -30 || this.x < -20 || this.x > CANVAS_WIDTH + 20) {
      const winner = this.y < 0 ? 'player' : this.y > CANVAS_HEIGHT ? 'cpu' :
        this.lastHitter === 'player' ? 'cpu' : 'player';
      this.endRally('取り逃し / 自動再開', winner);
    }
  }
  draw(context) {
    context.fillStyle = 'rgba(0,0,0,0.45)';
    context.beginPath();
    context.ellipse(this.x, this.y, this.radius, this.radius * 0.5, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#ffff33';
    context.beginPath();
    context.arc(this.x, this.y - Math.max(0, this.z), this.radius, 0, Math.PI * 2);
    context.fill();
  }
}

function drawCourt(context) {
  context.fillStyle = '#1c7a31';
  context.fillRect(24, 36, 208, 178);
  context.strokeStyle = '#ffffff'; context.lineWidth = 1;
  context.strokeRect(36, 46, 184, 158);
  context.beginPath();
  context.moveTo(36, 84); context.lineTo(220, 84);
  context.moveTo(36, 166); context.lineTo(220, 166);
  context.moveTo(128, 84); context.lineTo(128, 166);
  context.stroke();
  context.fillStyle = 'rgba(230,230,230,0.5)';
  context.fillRect(24, 108, 208, 12);
  context.strokeStyle = '#eeeeee';
  context.beginPath();
  context.moveTo(24, 108); context.lineTo(232, 108);
  context.moveTo(24, 120); context.lineTo(232, 120);
  context.stroke();
}

const VIEW = { width: 512, height: 640 };
const sceneImages = {};
const sceneLoadErrors = new Set();
['court_background', 'court', 'net'].forEach((name) => {
  const image = new Image();
  image.src = `assets/${name}.png`;
  image.addEventListener('error', () => sceneLoadErrors.add(name));
  sceneImages[name] = image;
});

const COURT_ART = { x: 59, y: 199, width: 394, height: 406, sourceHeight: 396 };
const COURT_Y = [[46,18], [84,67], [120,172.5], [166,278], [204,370]];
function projectCourt(x, y) {
  let i = 0;
  while (i < COURT_Y.length - 2 && y > COURT_Y[i + 1][0]) i++;
  const [wa, sa] = COURT_Y[i], [wb, sb] = COURT_Y[i + 1];
  const t = Math.max(0, Math.min(1, (y - wa) / (wb - wa)));
  const sy = sa + (sb - sa) * t;
  const left = 32 + (0 - 32) * (sy / COURT_ART.sourceHeight);
  const right = 362 + (394 - 362) * (sy / COURT_ART.sourceHeight);
  const scale = (right - left) / 184;
  return { x: COURT_ART.x + left + (x - 36) * scale,
    y: COURT_ART.y + sy * COURT_ART.height / COURT_ART.sourceHeight, scale };
}

function imageReady(image) { return image.complete && image.naturalWidth > 0; }
function drawProjected(context, object, x, y) {
  const p = projectCourt(x, y);
  context.save();
  context.translate(p.x, p.y);
  context.scale(p.scale, p.scale);
  context.translate(-x, -y);
  object.draw(context);
  context.restore();
}
function drawProjectedNet(context) {
  const a = projectCourt(24, 120);
  const b = projectCourt(232, 120);
  const height = 24 * a.scale;
  if (imageReady(sceneImages.net))
    context.drawImage(sceneImages.net, a.x, a.y - height, b.x - a.x, height);
}
function drawScene(context) {
  if (imageReady(sceneImages.court_background))
    context.drawImage(sceneImages.court_background, 0, 0, VIEW.width, VIEW.height);
  else { context.fillStyle = '#0f172a'; context.fillRect(0, 0, VIEW.width, VIEW.height); }
  if (imageReady(sceneImages.court)) context.drawImage(sceneImages.court,
    COURT_ART.x, COURT_ART.y, COURT_ART.width, COURT_ART.height);
  else { context.save(); context.scale(2, 2); drawCourt(context); context.restore(); }
  if (sceneLoadErrors.size > 0) {
    context.fillStyle = '#ffcc00'; context.font = '12px monospace';
    context.fillText('画像を読めません: ' + [...sceneLoadErrors].join(', ') + '（assetsを確認）', 8, 22);
  }
}

const input = new InputHandler();
const player = new SealPlayer(CANVAS_WIDTH / 2 - 8, 180);
const cpu = new CpuPlayer(CANVAS_WIDTH / 2 - 8, 56);
const ball = new Ball();

class FixedClock {
  constructor(stepMs, onStep) {
    this.stepMs = stepMs; this.onStep = onStep;
    this.accumulator = 0; this.lastTime = null;
  }
  tick(now) {
    if (this.lastTime === null) this.lastTime = now;
    let delta = now - this.lastTime;
    this.lastTime = now;
    if (delta > 250) delta = 250;
    this.accumulator += delta;
    while (this.accumulator >= this.stepMs) {
      this.onStep();
      this.accumulator -= this.stepMs;
    }
  }
}
const clock = new FixedClock(SETTINGS.stepMs, () => {
  player.update(input, ball);
  cpu.update(ball);
  ball.update(player, cpu);
});

function toggleServePractice() {
  practiceMode = practiceMode === 'rally' ? 'serve' : 'rally';
  if (modeButton) modeButton.textContent = practiceMode === 'serve' ? 'ラリーに戻す' : 'サーブ切替';
  resetPractice();
}
function resetPractice() {
  score.player = 0; score.cpu = 0;
  ball.returnCount = 0;
  cpu.reset();
  ball.resetServe();
}
if (modeButton) modeButton.addEventListener('click', toggleServePractice);
if (resetButton) resetButton.addEventListener('click', resetPractice);
if (guideButton) guideButton.addEventListener('click', () => {
  showGuide = !showGuide;
  guideButton.style.backgroundColor = showGuide ? '#2563eb' : '';
});

let paused = false;
window.addEventListener('blur', () => { paused = true; });
window.addEventListener('focus', () => { paused = false; clock.lastTime = null; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) paused = true;
  else { paused = false; clock.lastTime = null; }
});

function gameLoop(now) {
  if (!paused) clock.tick(now);
  ctx.clearRect(0, 0, VIEW.width, VIEW.height);
  drawScene(ctx);
  const drawOrder = [
    { y: cpu.y, draw: () => drawProjected(ctx, cpu, cpu.x, cpu.y) },
    { y: 120, draw: () => drawProjectedNet(ctx) },
    { y: player.y, draw: () => drawProjected(ctx, player, player.x, player.y) },
    { y: ball.y, draw: () => drawProjected(ctx, ball, ball.x, ball.y) },
  ].sort((a, b) => a.y - b.y);
  drawOrder.forEach((item) => item.draw());
  const names = { fore: 'フォアボレー', back: 'バックボレー', smash: 'スマッシュ', serve: 'サーブ' };
  if (status) status.textContent = paused ? '一時停止：画面に戻ると再開' :
    `${player.isSwinging ? 'スイング' : player.isPreparing ? '構え' : '待機'} / ${names[player.shotType]}${player.getVolleyFrame() !== null ? ' ' + String(player.getVolleyFrame() + 1).padStart(2, '0') : ''}${player.isDashing ? ' / ダッシュ' : ''} ｜ ${ball.message} ｜ YOU ${score.player} : ${score.cpu} CPU ｜ 返球 ${ball.returnCount}`;
  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

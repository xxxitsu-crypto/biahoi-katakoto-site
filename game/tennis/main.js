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
  curveAcceleration: 0.035, // ダッシュボレーの横カーブ（座標/tick²）
  curveTicks: 42,
};
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const sealImage = new Image();
sealImage.src = 'assets/move_01.png';
// コマ寸法は提供データの実寸。画像は加工・反転せず読み込む。
const SPRITE_CONFIG = {
  frameWidth: 71, frameHeight: 76,
  drawWidth: 32, drawHeight: 34,
  moveFrameTicks: 5,   // 1コマ約83ms。3コマを循環。
  dashFrameTicks: 6,   // 1コマ100ms。最後のコマは停止まで維持。
};
const sprites = {};
for (const [key, file, frames] of [
  ['moveRight', 'seal_move_sheet.png', 3],
  ['moveLeft', 'seal_move_L_sheet.png', 3],
  ['dashRight', 'seal_dash.png', 3],
  ['dashLeft', 'seal_dash_L.png', 3],
  ['dashVertical', 'dash_y_seet.png', 2],
]) {
  const image = new Image();
  image.src = `assets/${file}`;
  sprites[key] = { image, frames };
}
// スイングのコマと判定は別管理。戻りで同じ絵を使っても再ヒットしない。
const VOLLEY = {
  forehand: {
    key: 'volleyRight', file: 'volley_right.png', cellWidth: 70, cellHeight: 75,
    sourceWidth: 70, sourceHeight: 75,
    cropX: 0, cropY: 0, drawOffsetX: -7,
    phases: [
      { frame: 1, ticks: 2, quality: 'normal' }, { frame: 2, ticks: 2, quality: 'normal' },
      { frame: 3, ticks: 4, quality: 'critical' },
      { frame: 4, ticks: 4, quality: 'float' },
      { frame: 5, ticks: 3, quality: 'normal' }, { frame: 6, ticks: 3, quality: 'normal' },
      { frame: 7, ticks: 3, quality: 'normal' },
    ],
  },
  backhand: {
    key: 'volleyLeft', file: 'volley_left.png', cellWidth: 96, cellHeight: 76,
    cropX: 0, cropY: 0, sourceWidth: 96, sourceHeight: 76,
    drawWidth: 96 * 32 / 71, drawHeight: 34, drawOffsetX: -12,
    phases: [
      { frame: 1, ticks: 4, quality: 'normal' },
      { frame: 2, ticks: 4, quality: 'float' },
      { frame: 3, ticks: 4, quality: 'critical' },
      { frame: 4, ticks: 4, quality: 'float' },
      { frame: 3, ticks: 3, quality: 'normal' }, { frame: 2, ticks: 3, quality: 'normal' }, { frame: 1, ticks: 3, quality: 'normal' },
    ],
  },
};
// 提供PNGの黄色いラケット面を測定。半径は輪郭を含めた元画像上の値。
VOLLEY.forehand.racketCenters = [[13.41, 22.04], [22.89, 47.05], [39.54, 51.57], [56.29, 52.85], [56.35, 30.49], [30.44, 12.45], [56.35, 30.49], [39.54, 51.57]];
VOLLEY.forehand.racketRadii = [[12.41, 15.04], [12.11, 12.05], [9.54, 12.57], [12.29, 11.15], [12.65, 12.49], [11.56, 12.55], [12.65, 12.49], [9.54, 12.57]];
VOLLEY.backhand.racketCenters = [[61.68, 22.57], [49.57, 42.45], [13.91, 49.98], [11.74, 37.69], [20.75, 10.49]];
VOLLEY.backhand.racketRadii = [[13.68, 15.57], [12.43, 13.45], [13.09, 13.02], [14.26, 14.69], [12.25, 11.51]];
// サーブ・スマッシュ共通：03/04で打球、05は0.3秒の振り下ろし。
for (const kind of ['smash', 'serve']) {
  VOLLEY[kind] = {
    key: kind, file: 'serve_smash.png', cellWidth: 80, cellHeight: 101,
    cropX: 0, cropY: 0, sourceWidth: 80, sourceHeight: 101,
    drawOffsetX: -10, drawOffsetY: 14 - 101 * 34 / 76,
    drawWidth: 80 * 32 / 71, drawHeight: 101 * 34 / 76,
    // 04の低い打点を頭上へ合わせる従来の仮ジャンプ。03は絵自体が頭上打点。
    frameLifts: [0, 6, 0, 16, 0],
    racketCenters: [[26.39, 88.58], [15.52, 41.91], [60.33, 17.13], [63.14, 66.66], [32.15, 19.04]],
    racketRadii: [[11.39, 11.58], [13.52, 12.91], [14.33, 15.87], [9.86, 11.66], [13.85, 13.96]],
    phases: [
      { frame: 1, ticks: 4 },
      { frame: 2, ticks: 4, quality: kind },
      { frame: 3, ticks: 4, quality: kind },
      { frame: 4, ticks: 18 },
    ],
  };
}
let practiceMode = 'rally'; // CPUサーブ／プレイヤーサーブの切替。
const score = { player: 0, cpu: 0 };
const CPU_SETTINGS = { speed: 0.9, reactionTicks: 10, reach: 14, minHeight: 3, maxHeight: 32 };
for (const config of Object.values(VOLLEY)) {
  config.totalTicks = config.phases.reduce((total, phase) => total + phase.ticks, 0);
  config.image = new Image();
  config.image.src = `assets/${config.file}`;
}
let showGuide = !window.matchMedia?.('(any-pointer: coarse)').matches;

class InputHandler {
  constructor() {
    this.history = { up: [], down: [], left: [], right: [] };
    this.consumeQueue = [];
    this.shotQueue = [];
    this.actionSources = new Set();
    this.keys = new Set();
    this.cancelVersion = 0;
    this.initKeyboard();
    this.initTouch();
  }
  get action() { return this.actionSources.size > 0; }
  registerPress(dir, now = performance.now()) {
    const h = this.history[dir];
    h.push(now);
    if (h.length > 3) h.shift();
    let isRhythmJump = false;
    if (h.length === 3) {
      const a = h[1] - h[0], b = h[2] - h[1];
      if (a > 0 && a < SETTINGS.rhythmFirstMaxMs &&
          b >= SETTINGS.rhythmSecondMinMs && b <= SETTINGS.rhythmSecondMaxMs) {
        isRhythmJump = true;
        this.history[dir] = [];
      }
    }
    this.consumeQueue.push({ dir, isRhythmJump });
  }
  pressShot(source) {
    if (this.actionSources.has(source)) return;
    if (!this.action) this.shotQueue.push('press');
    this.actionSources.add(source);
  }
  releaseShot(source) {
    if (!this.actionSources.delete(source)) return;
    if (!this.action) this.shotQueue.push('release');
  }
  cancel() {
    this.keys.clear();
    this.actionSources.clear();
    this.consumeQueue.length = 0;
    this.shotQueue.length = 0;
    Object.keys(this.history).forEach(key => this.history[key] = []);
    this.cancelVersion++;
  }
  initKeyboard() {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    window.addEventListener('keydown', e => {
      const shot = e.code === 'KeyZ' || e.code === 'Space';
      if (map[e.code] || shot) e.preventDefault();
      if (e.repeat || this.keys.has(e.code)) return;
      this.keys.add(e.code);
      if (map[e.code]) this.registerPress(map[e.code]);
      if (shot) this.pressShot(e.code);
      if (e.code === 'KeyD') showGuide = !showGuide;
      if (e.code === 'KeyR') resetPractice();
      if (e.code === 'KeyS') toggleServePractice();
    });
    window.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      if (map[e.code] || e.code === 'KeyZ' || e.code === 'Space') e.preventDefault();
      this.releaseShot(e.code);
    });
    window.addEventListener('blur', () => this.cancel());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.cancel();
    });
  }
  // 複数指で移動と構えを同時操作。長押しの自動移動・連打はしない。
  initTouch() {
    for (const dir of ['up', 'down', 'left', 'right']) {
      const el = document.getElementById(`btn-${dir}`);
      el?.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        this.registerPress(dir);
      });
    }
    const el = document.getElementById('btn-action');
    if (!el) return;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.pressShot(`pointer-${e.pointerId}`);
    });
    el.addEventListener('pointerup', e => {
      e.preventDefault();
      this.releaseShot(`pointer-${e.pointerId}`);
    });
    el.addEventListener('pointercancel', () => this.cancel());
    el.addEventListener('lostpointercapture', e => {
      if (this.actionSources.has(`pointer-${e.pointerId}`)) this.cancel();
    });
  }
  popAction() { return this.consumeQueue.shift(); }
}

class SealPlayer {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.width = 16; this.height = 12;
    this.friction = SETTINGS.friction;
    this.isSwinging = false; this.swingTimer = 0;
    this.isDashing = false;
    this.isPreparing = false;
    this.facing = 1;
    this.shotType = 'forehand';
    this.hasHit = false;
    this.cancelVersion = 0;
    this.swingCount = 0;
    this.swingElapsed = 0;
    this.visualFacing = 1; // 移動画像の左右。自動打球選択のfacingとは独立。
    this.dashDirection = null;
    this.animationKey = 'moveRight';
    this.animationTick = 0;
    this.animationFrame = 0;
    this.wasMoving = false;
  }
  selectShot(ball) {
    if (ball.serveWaiting || ball.serving) { this.shotType = 'serve'; return; }
    const dx = ball.x - (this.x + this.width / 2);
    const dy = ball.y - (this.y + 6);
    if (ball.z >= 22 && Math.abs(dx) <= 14 && Math.abs(dy) <= 24) {
      this.shotType = 'smash';
    } else {
      // 中心付近で左右が細かく切り替わらないように幅を持たせる。
      if (dx > 3) this.facing = 1;
      else if (dx < -3) this.facing = -1;
      this.shotType = this.facing === 1 ? 'forehand' : 'backhand';
    }
  }
  getShotPhase() {
    const config = VOLLEY[this.shotType];
    if (!this.isSwinging || !config) return null;
    let time = this.swingElapsed;
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
        radius: radiusX, radiusX, radiusY,
        // ボール半径3と、操作感を保つ補助幅。元絵を変更せずコマごとに追従。
        hitRadius: radiusX + 3 + 6,
        hitHeight: radiusY + 3 + (this.shotType === 'serve' ? 2 : 5) };
    }
    return {
      x: this.x + this.width / 2 + (this.shotType === 'smash' ? 5 : this.facing * 12),
      y: this.y + 6, z: this.shotType === 'smash' ? 26 : 12, radius: 8,
    };
  }
  update(input, ball) {
    if (this.cancelVersion !== input.cancelVersion) {
      this.cancelVersion = input.cancelVersion;
      this.isPreparing = false;
      this.isSwinging = false;
      this.swingTimer = 0;
      this.vx = this.vy = 0;
      if (ball.serveWaiting || ball.serving) ball.resetPlayerServe();
    }
    const previousX = this.x, previousY = this.y;
    // 構え・スイングとは独立して移動する。長押しの自動移動は追加しない。
    let act;
    while ((act = input.popAction())) {
      const speed = act.isRhythmJump ? SETTINGS.dashImpulse : SETTINGS.moveImpulse;
      if (act.dir === 'left') this.visualFacing = -1;
      if (act.dir === 'right') this.visualFacing = 1;
      // 上下入力では直前の左右の向きを保持する。
      if (act.isRhythmJump) {
        this.isDashing = true;
        this.dashDirection = act.dir;
        this.animationKey = ''; // 再度ダッシュしたら先頭コマから再生。
      }
      if (act.dir === 'left') this.vx -= speed;
      if (act.dir === 'right') this.vx += speed;
      if (act.dir === 'up') this.vy -= speed * SETTINGS.verticalRatio;
      if (act.dir === 'down') this.vy += speed * SETTINGS.verticalRatio;
    }
    this.x += this.vx; this.y += this.vy;
    this.vx *= this.friction; this.vy *= this.friction;
    if (Math.abs(this.vx) < 0.05) this.vx = 0;
    if (Math.abs(this.vy) < 0.05) this.vy = 0;
    if (this.vx === 0 && this.vy === 0) this.isDashing = false;
    this.x = Math.max(24, Math.min(CANVAS_WIDTH - 24 - this.width, this.x));
    this.y = Math.max(130, Math.min(218 - this.height, this.y));

    if (this.swingTimer > 0) {
      this.swingTimer--;
      this.swingElapsed++;
    }
    this.isSwinging = this.swingTimer > 0;
    if (!this.isSwinging) this.selectShot(ball);
    // キューを使い、1回の更新より短い押す→離すも取りこぼさない。
    for (const event of input.shotQueue.splice(0)) {
      if (ball.serveWaiting || ball.serving || (this.isSwinging && this.shotType === 'serve')) {
        // サーブ専用：離す操作では振らない。最初の押下で準備→トス、次の押下で振る。
        if (event === 'press' && !this.isSwinging) {
          if (ball.servePhase === 'waiting') {
            this.shotType = 'serve';
            this.isPreparing = true;
            ball.beginServePreparation();
          } else if (ball.servePhase === 'toss') {
            this.shotType = 'serve';
            this.isPreparing = false;
            this.isSwinging = true;
            this.swingElapsed = 0;
            this.swingTimer = VOLLEY.serve.totalTicks;
            this.hasHit = false;
            this.swingCount++;
          }
        }
        continue;
      }
      if (event === 'press') {
        this.isPreparing = true;
      } else {
        if (this.isPreparing && !this.isSwinging) {
          this.selectShot(ball); // 離した瞬間に種類を確定。振っている間は変更しない。
          this.isSwinging = true;
          this.swingTimer = VOLLEY[this.shotType]?.totalTicks ?? SETTINGS.swingTicks;
          this.swingElapsed = 0;
          this.hasHit = false;
          this.swingCount++;
        }
        this.isPreparing = false;
      }
    }
    const moved = Math.hypot(this.x - previousX, this.y - previousY) > 0.001;
    this.updateAnimation(moved);
  }
  updateAnimation(moving) {
    const moveKey = this.visualFacing === 1 ? 'moveRight' : 'moveLeft';
    let key = moveKey;
    const dash = moving && this.isDashing;
    if (dash) {
      key = this.dashDirection === 'left' ? 'dashLeft' :
        this.dashDirection === 'right' ? 'dashRight' : 'dashVertical';
    }
    if (!moving || key !== this.animationKey || !this.wasMoving) {
      this.animationTick = 0;
    } else {
      this.animationTick++;
    }
    this.animationKey = key;
    const ticks = dash ? SPRITE_CONFIG.dashFrameTicks : SPRITE_CONFIG.moveFrameTicks;
    const frame = Math.floor(this.animationTick / ticks);
    this.animationFrame = !moving ? 0 : dash ?
      Math.min(frame, sprites[key].frames - 1) : frame % sprites[key].frames;
    this.wasMoving = moving;
  }
  draw(context) {
    context.fillStyle = 'rgba(0,0,0,0.4)';
    context.fillRect(this.x, this.y + this.height - 2, this.width, 3);
    const sprite = sprites[this.animationKey];
    const config = SPRITE_CONFIG;
    const volley = VOLLEY[this.shotType];
    const volleyFrame = this.getVolleyFrame();
    if (volley && volleyFrame !== null && volley.image.complete &&
        volley.image.naturalWidth === volley.cellWidth * volley.racketCenters.length &&
        volley.image.naturalHeight === volley.cellHeight) {
      context.drawImage(volley.image,
        volleyFrame * volley.cellWidth + volley.cropX, volley.cropY,
        volley.sourceWidth ?? 71, volley.sourceHeight ?? 76,
        Math.round(this.x + volley.drawOffsetX),
        Math.round(this.y + (volley.drawOffsetY ?? -20) - (volley.frameLifts?.[volleyFrame] ?? 0)),
        volley.drawWidth ?? config.drawWidth, volley.drawHeight ?? config.drawHeight);
    } else if (sprite.image.complete &&
        sprite.image.naturalWidth === config.frameWidth * sprite.frames &&
        sprite.image.naturalHeight === config.frameHeight) {
      context.drawImage(sprite.image,
        this.animationFrame * config.frameWidth, 0, config.frameWidth, config.frameHeight,
        Math.round(this.x - 7), Math.round(this.y - 20), config.drawWidth, config.drawHeight);
    } else if (sealImage.complete && sealImage.naturalWidth) {
      context.drawImage(sealImage, Math.round(this.x - 7), Math.round(this.y - 20), 32, 34);
    } else {
      context.fillStyle = '#68c2d3';
      context.fillRect(Math.floor(this.x), Math.floor(this.y), this.width, this.height);
    }
    if (showGuide) {
      const r = this.getRacketPosition();
      context.strokeStyle = ['critical', 'smash', 'serve'].includes(this.getHitQuality()) ? '#66ff99' : this.getHitQuality() === 'float' ? '#ff9966' : this.isPreparing ? '#ffff66' : '#8feaff';
      context.lineWidth = 1;
      context.beginPath();
      context.ellipse(r.x, r.y - r.z, r.radiusX ?? r.radius, r.radiusY ?? r.radius, 0, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 0.4;
      context.beginPath();
      context.moveTo(r.x, r.y - r.z);
      context.lineTo(r.x, r.y);
      context.stroke();
      context.globalAlpha = 1;
    }
  }
}

// 2P画像を原寸のコマで切り出す。反転・画像加工は行わない。
const CPU_SPRITES = {};
for (const [key,file,frames,w,h] of [
 ['moveRight','2P_seal_move_sheet.png',3,71,76],
 ['moveLeft','2P_seal_move_L_sheet.png',3,71,76],
 ['dashRight','2P_seal_dash.png',3,71,76],
 ['dashLeft','2P_seal_dash_L.png',3,71,76],
 ['leftShot','2p_bolay.png',7,100,100],
 ['rightShot','2p_bolay_L.png',7,100,100],
 ['overhead','2p_sarv.png',6,100,100],
]) {
 const image = new Image(); image.src = `assets/${file}`;
 CPU_SPRITES[key] = { image, frames, w, h };
}
const CPU_SHOTS = {
 leftShot: { centers: [[39.31,21.75],[23.82,40.04],[17.78,69.03],[18.07,76.47],[73.02,48.47],[17.78,69.03],[23.82,40.04]],
 radii: [[11,14],[11,11],[12,10],[11,9],[11,10],[12,10],[11,11]] },
 rightShot: { centers: [[68.33,28.76],[77.56,39.3],[81.03,67.83],[74.88,73.18],[24.5,34.77],[81.03,67.83],[77.56,39.3]],
 radii: [[11,14],[11,13],[14,11],[12,11],[11,13],[14,11],[11,13]] },
 overhead: { centers: [[39.55,75.77],[82.79,59.98],[55.66,25.94],[32.66,17.82],[39.51,72.82],[77.15,54.89]],
 radii: [[6,9],[11,12],[12,11],[11,14],[12,9],[10,10]], lifts: [0,0,0,0,24,0] },
};
for(const kind of ['leftShot','rightShot']) CPU_SHOTS[kind].phases = [
 {frame:1,ticks:4,quality:'normal'}, {frame:2,ticks:4,quality:'critical'}, {frame:3,ticks:4,quality:'float'},
 {frame:4,ticks:3,quality:'normal'}, {frame:5,ticks:3,quality:'normal'}, {frame:6,ticks:3,quality:'normal'},
];
CPU_SHOTS.overhead.phases = [
 {frame:1,ticks:4},{frame:2,ticks:4},{frame:3,ticks:4,quality:'smash'},
 {frame:4,ticks:4,quality:'smash'},{frame:5,ticks:18},
];
class CpuPlayer {
 constructor() { this.reset(); }
 reset() {
  this.x=128;this.y=46;this.targetX=128;this.targetY=46;
  this.visualFacing=1;this.animationTick=0;this.moving=false;
  this.shotKind='leftShot';this.swingElapsed=0;this.isSwinging=false;this.hasHit=false;
  this.reactionTimer=0;this.dashTimer=0;this.dashCooldown=0;
  this.serveAge=0;this.plan=null;
 }
 phase() {
  if(!this.isSwinging)return null;
  let t=this.swingElapsed;
  for(const p of CPU_SHOTS[this.shotKind].phases){if(t<p.ticks)return p;t-=p.ticks;}
  return null;
 }
 startSwing(kind) {this.shotKind=kind;this.swingElapsed=0;this.isSwinging=true;this.hasHit=false;}
 racket(kind=this.shotKind, frame=this.phase()?.frame ?? 0) {
  const c=CPU_SHOTS[kind], scale=32/71;
  const [x,y]=c.centers[frame], [rx,ry]=c.radii[frame];
  return {x:this.x+(x-55)*scale,y:this.y,z:(90-y)*scale+(c.lifts?.[frame]??0),
   radiusX:rx*scale,radiusY:ry*scale,hitRadius:rx*scale+9,hitHeight:ry*scale+8};
 }
 // 予測は打ち始めるために使用。実際の返球にはコマ・位置・高さの接触が必要。
 predict(ball) {
  let x=ball.x,y=ball.y,z=ball.z,vz=ball.vz,bounces=ball.bouncesInCurrentCourt;
  for(let n=1;n<=100;n++) {
   const oldY=y;x+=ball.vx;y+=ball.vy;z+=vz;vz-=ball.gravity;
   if(oldY>120&&y<=120)bounces=0;
   if(z<=0){z=0;vz*=ball.bounce;if(++bounces>=2)break;}
   if(y<30)break;
   if(y>108)continue;
   const kinds=z>=24?['overhead','leftShot','rightShot']:['leftShot','rightShot'];
   for(const kind of kinds){
    const windup=kind==='overhead'?8:4;
    if(n<windup)continue;
    const r=this.racket(kind,kind==='overhead'?3:2);
    if(Math.abs(z-r.z)>r.hitHeight-2)continue;
    const tx=Math.max(24,Math.min(232,x-(r.x-this.x)));
    const ty=Math.max(34,Math.min(108,y));
    const distance=Math.hypot(tx-this.x,ty-this.y);
    if(distance<=CPU_SETTINGS.speed*n+4)return {x:tx,y:ty,n,kind,windup};
   }
  }
  return null;
 }
 update(ball) {
  if(this.isSwinging){this.swingElapsed++;if(!this.phase())this.isSwinging=false;}
  if(this.dashTimer>0)this.dashTimer--;
  if(this.dashCooldown>0)this.dashCooldown--;
  if(ball.resetTimer){this.moving=false;return;}
  if(ball.cpuServing){this.moving=false;return;}
  const incoming=ball.lastHitter==='player'&&ball.vy<0&&!ball.serving&&!ball.serveWaiting;
  if(incoming&&!this.isSwinging){
   this.plan=this.predict(ball);
   if(this.plan){this.targetX=this.plan.x;this.targetY=this.plan.y;}
   else {this.targetX=Math.max(24,Math.min(232,ball.x));this.targetY=46;}
  }else if(!this.isSwinging){this.targetX=128;this.targetY=46;}
  const dx=this.targetX-this.x,dy=this.targetY-this.y,distance=Math.hypot(dx,dy);
  if(incoming&&distance>38&&!this.dashCooldown&&!this.isSwinging){this.dashTimer=18;this.dashCooldown=100;}
  const speed=this.dashTimer?1.5:CPU_SETTINGS.speed;
  if(distance>0.1){const step=Math.min(speed,distance);this.x+=dx/distance*step;this.y+=dy/distance*step;}
  this.moving=distance>0.1;
  if(Math.abs(dx)>0.1)this.visualFacing=Math.sign(dx);
  this.animationTick=this.moving?this.animationTick+1:0;
  if(incoming&&!this.isSwinging&&this.plan&&this.plan.n<=this.plan.windup+1){
   this.startSwing(this.plan.kind);
  }
 }
 canHit(ball) {
  if(!this.isSwinging||this.hasHit||!this.phase()?.quality||ball.lastHitter!=='player'||ball.vy>=0||ball.y>=120)return false;
  const r=this.racket();
  return Math.hypot(ball.x-r.x,ball.y-r.y)<r.hitRadius&&Math.abs(ball.z-r.z)<r.hitHeight;
 }
 hit(ball) {
  const quality=this.phase()?.quality;if(!quality||this.hasHit)return;
  this.hasHit=true;ball.lastHitter='cpu';ball.bouncesInCurrentCourt=0;
  const r=this.racket();
  const contact=Math.max(-1,Math.min(1,(ball.x-r.x)/Math.max(1,r.hitRadius)));
  const aimX=Math.max(39,Math.min(217,128+contact*42+(this.targetX-this.x)*0.2));
  ball.launch(aimX,176,quality==='smash'?34:quality==='critical'?46:quality==='float'?72:58);
  ball.message=quality==='smash'?'CPUスマッシュ':quality==='float'?'CPU浮き球':'CPUクリティカル';
 }
 updateServe(ball) {
  this.serveAge++;
  if(this.serveAge<=30){
   this.shotKind='overhead';
   // 1コマ目の左手付近に保持してから、上へトスする。
   Object.assign(ball,{x:this.x+(34-55)*32/71,y:this.y,z:30*32/71,vx:0,vy:0,vz:2});
   ball.message='CPUサーブ：構え';return;
  }
  ball.z+=ball.vz;ball.vz-=ball.gravity;
  if(this.serveAge===40)this.startSwing('overhead');
  if(this.isSwinging&&!this.hasHit&&this.phase()?.quality){
   const r=this.racket();
   if(Math.hypot(ball.x-r.x,ball.y-r.y)<r.hitRadius&&Math.abs(ball.z-r.z)<r.hitHeight){
    this.hasHit=true;ball.cpuServing=false;ball.lastHitter='cpu';ball.bouncesInCurrentCourt=0;
    ball.launch(128+(Math.random()*40-20),176,62);ball.message='CPUサーブ';return;
   }
  }
  if(ball.z<=0){this.reset();ball.message='CPUサーブやり直し';}
 }
 draw(context) {
  context.fillStyle='rgba(0,0,0,0.4)';context.fillRect(this.x-8,this.y+1,16,3);
  const overheadReady=ball.cpuServing;
  const shot=this.isSwinging||overheadReady;
  const key=shot?this.shotKind:(this.dashTimer&&this.moving?'dash':'move')+(this.visualFacing<0?'Left':'Right');
  const cfg=CPU_SPRITES[key];
  const frame=shot?(this.phase()?.frame??0):this.moving?Math.floor(this.animationTick/(this.dashTimer?6:5))%cfg.frames:0;
  const scale=32/71;
  const width=cfg.w*scale,height=cfg.h*scale;
  const ox=shot?-55*scale:-15,oy=shot?-90*scale:-32;
  const lift=shot?(CPU_SHOTS[this.shotKind].lifts?.[frame]??0):0;
  if(cfg.image.complete&&cfg.image.naturalWidth===cfg.w*cfg.frames&&cfg.image.naturalHeight===cfg.h)
   context.drawImage(cfg.image,frame*cfg.w,0,cfg.w,cfg.h,this.x+ox,this.y+oy-lift,width,height);
  else {context.fillStyle='#ff9b00';context.fillRect(this.x-8,this.y-14,16,16);}
  if(showGuide&&shot){const r=this.racket();context.strokeStyle=this.phase()?.quality?'#66ff99':'#8feaff';context.beginPath();context.ellipse(r.x,r.y-r.z,r.radiusX,r.radiusY,0,0,Math.PI*2);context.stroke();}
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
    this.curveTicks = 0;
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
    this.curve = 0;
    this.curveTicks = 0;
    this.vx = (targetX - this.x) / ticks;
    this.vy = (targetY - this.y) / ticks;
    // update内の積分順に合わせ、指定時間後に着地する初速度を計算。
    this.vz = (0.5 * this.gravity * ticks * (ticks - 1) - this.z) / ticks;
  }
  isInsideCourt(x = this.x, y = this.y) {
    // 線に触れた球はイン。判定位置は球の中心と半径で見る。
    return x + this.radius >= 36 && x - this.radius <= 220 &&
      y + this.radius >= 46 && y - this.radius <= 204;
  }
  isOnReceiverSide(y = this.y) {
    return this.lastHitter === 'player' ? y < 120 : y > 120;
  }
  launchFromPlayer(player, racket, quality) {
    const contact = Math.max(-1, Math.min(1,
      (this.x - racket.x) / Math.max(1, racket.hitRadius)));
    // ラケット面の打点が左右へずれるほど角度が付き、横移動も狙いに少し加わる。
    const movementAim = Math.max(-1, Math.min(1, player.vx / SETTINGS.dashImpulse));
    const targetX = Math.max(39, Math.min(217, 128 + contact * 44 + movementAim * 20));
    const targetY = 60;
    const travelTicks = quality === 'smash' ? 32 : quality === 'critical' ? 42 :
      quality === 'float' ? 70 : 54;
    this.lastHitter = 'player';
    this.bouncesInCurrentCourt = 0;
    this.returnCount++;
    let curve = 0, curveTicks = 0;
    if (player.isDashing && ['forehand', 'backhand'].includes(player.shotType)) {
      const dir = player.dashDirection === 'left' ? -1 :
        player.dashDirection === 'right' ? 1 : player.visualFacing;
      curve = dir * SETTINGS.curveAcceleration;
      curveTicks = SETTINGS.curveTicks;
    }
    this.launch(targetX, targetY, travelTicks);
    this.curve = curve;
    this.curveTicks = curveTicks;
    this.message = player.shotType === 'smash' ? 'スマッシュ！' :
      this.curveTicks ? 'ダッシュカーブ！' : quality === 'critical' ? 'クリティカル！' :
      quality === 'float' ? '浮き球' : 'ナイスショット';
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
    this.servePrepareTicks = 12; // 左手に乗った球と構えを0.2秒見せてからトス。
    this.message = '構え';
  }
  getServeHandPosition(player) {
    // sarv01の伸ばした左手上面。ボールの下端を手の上に接する位置へ置く。
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
    // 手を離れた球はプレイヤーに追従せず、重力で上下する。
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
    const oldY = this.y, oldZ = this.z;
    if (this.curveTicks > 0) {
      this.vx += this.curve;
      this.curve *= 0.97;
      this.curveTicks--;
    } else this.curve = 0;
    this.x += this.vx; this.y += this.vy;
    this.z += this.vz; this.vz -= this.gravity;
    const crossing = (oldY < 120 && this.y >= 120) || (oldY > 120 && this.y <= 120);
    if (crossing) {
      const fraction = (120 - oldY) / (this.y - oldY);
      const crossingHeight = oldZ + (this.z - oldZ) * fraction;
      if (crossingHeight < 12) {
        this.hitNet = true;
        this.endRally('ネット！', this.lastHitter === 'player' ? 'cpu' : 'player');
        return;
      }
      this.bouncesInCurrentCourt = 0;
    }
    if (this.z <= 0 && oldZ > 0) {
      this.z = 0;
      this.vz *= this.bounce;
      this.bouncesInCurrentCourt++;
      if (!this.isInsideCourt() || !this.isOnReceiverSide()) {
        this.endRally('アウト！', this.lastHitter === 'player' ? 'cpu' : 'player');
        return;
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
        this.bouncesInCurrentCourt = 0;
        this.returnCount++;
        this.launchFromPlayer(player, r, quality);
      }
    }
    if (opponent?.canHit(this)) opponent.hit(this);
    if (this.y > CANVAS_HEIGHT + 10 || this.y < -30 || this.x < -20 || this.x > CANVAS_WIDTH + 20) {
      // ラインのアウト判定は省略。相手側へ抜けた球を取り逃しとして扱う。
      const winner = this.y < 0 ? 'player' : this.y > CANVAS_HEIGHT ? 'cpu' :
        this.lastHitter === 'player' ? 'cpu' : 'player';
      this.endRally('取り逃し', winner);
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

// 表示だけを512×640へ投影。移動・打球の計算座標は従来の256×240を維持。
const VIEW = { width: 512, height: 640 };
// 提供された3枚を別レイヤーとして読み込む。
const sceneImages = {};
const sceneLoadErrors = new Set();
for (const name of ['background', 'court', 'net']) {
  const image = new Image();
  image.onerror = () => sceneLoadErrors.add(name);
  image.onload = () => sceneLoadErrors.delete(name);
  image.src = `assets/${name}.png`;
  sceneImages[name] = image;
}
const COURT_ART = { x: 59, y: 199, width: 394, height: 406, sourceHeight: 396 };
// 白線の奥・サービスライン・ネット・サービスライン・手前に対応。
const COURT_Y = [[46,18], [84,67], [120,172.5], [166,278], [204,370]];
function projectCourt(x, y) {
  let i = 0;
  while (i < COURT_Y.length - 2 && y > COURT_Y[i + 1][0]) i++;
  const [wa, sa] = COURT_Y[i], [wb, sb] = COURT_Y[i + 1];
  const sy = sa + (y - wa) / (wb - wa) * (sb - sa);
  const t = (sy - 18) / 352;
  const left = 81 - 54 * t, right = 310 + 56 * t;
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
  const a = projectCourt(24, 120), b = projectCourt(232, 120);
  // 上端を従来の衝突判定（高さ12）に合わせる。
  const height = 12 * a.scale;
  if (imageReady(sceneImages.net))
    context.drawImage(sceneImages.net, a.x, a.y - height, b.x - a.x, height);
}
function drawScene(context) {
  context.fillStyle = '#10171a'; context.fillRect(0,0,VIEW.width,VIEW.height);
  if (imageReady(sceneImages.background)) context.drawImage(sceneImages.background,0,0,VIEW.width,VIEW.height);
  if (imageReady(sceneImages.court)) context.drawImage(sceneImages.court,
    COURT_ART.x, COURT_ART.y, COURT_ART.width, COURT_ART.height);
  drawProjected(context,cpu,cpu.x,cpu.y);
  if(ball.y < 120) drawProjected(context,ball,ball.x,ball.y);
  drawProjectedNet(context);
  drawProjected(context,player,player.x+8,player.y+6);
  if(ball.y >= 120) drawProjected(context,ball,ball.x,ball.y);
  if (sceneLoadErrors.size) {
    context.fillStyle = '#600'; context.fillRect(0,0,512,32);
    context.fillStyle = '#fff'; context.font = '14px sans-serif';
    context.fillText('画像を読めません: ' + [...sceneLoadErrors].join(', ') + '（assetsを確認）',8,22);
  }
}

// 固定更新器。描画60Hz/120Hz/144Hzでも同じ経過時間なら同じ回数更新する。
class FixedClock {
  constructor(update) { this.update = update; this.reset(); }
  reset() { this.last = null; this.accumulator = 0; }
  advance(now) {
    if (this.last === null) { this.last = now; return; }
    const elapsed = Math.min(100, Math.max(0, now - this.last));
    this.last = now;
    this.accumulator += elapsed;
    while (this.accumulator + 1e-8 >= SETTINGS.stepMs) {
      this.update();
      this.accumulator -= SETTINGS.stepMs;
    }
  }
}
const input = new InputHandler();
const player = new SealPlayer(CANVAS_WIDTH / 2 - 8, 180);
const ball = new Ball();
const cpu = new CpuPlayer();
const clock = new FixedClock(() => { player.update(input, ball); cpu.update(ball); ball.update(player, cpu); });
let paused = false;
function toggleServePractice() {
  practiceMode = practiceMode === 'serve' ? 'rally' : 'serve';
  resetPractice();
}
function resetPractice() {
  input.cancel();
  Object.assign(player, new SealPlayer(CANVAS_WIDTH / 2 - 8, 180));
  player.cancelVersion = input.cancelVersion;
  score.player = score.cpu = 0;
  cpu.reset();
  ball.returnCount = 0;
  ball.resetServe();
  if (practiceMode === 'serve') {
    player.y = 198;
    player.selectShot(ball);
    ball.updatePlayerServe(player);
  }
  clock.reset();
}
window.addEventListener('blur', () => { paused = true; clock.reset(); });
window.addEventListener('focus', () => { paused = document.hidden; clock.reset(); });
document.addEventListener('visibilitychange', () => {
  paused = document.hidden || !document.hasFocus();
  clock.reset();
});
document.getElementById('restart')?.addEventListener('click', resetPractice);
document.getElementById('serve-mode')?.addEventListener('click', toggleServePractice);
document.getElementById('guide-toggle')?.addEventListener('click', () => { showGuide = !showGuide; });
window.addEventListener('pagehide', () => { input.cancel(); clock.reset(); });
function gameLoop(now) {
  if (!paused && !document.hidden) clock.advance(now);
  ctx.imageSmoothingEnabled = false;
  drawScene(ctx);
  const names = { forehand: 'フォア', backhand: 'バック', smash: 'スマッシュ', serve: 'サーブ' };
  const guideButton = document.getElementById('guide-toggle');
  guideButton?.setAttribute('aria-pressed', String(showGuide));
  const modeButton = document.getElementById('serve-mode');
  if (modeButton) modeButton.textContent = practiceMode === 'serve' ? 'CPUサーブへ' : '自分のサーブへ';
  if (status) status.textContent = paused ? '一時停止：画面に戻ると再開' :
    `${player.isSwinging ? 'スイング' : player.isPreparing ? '構え' : '待機'} / ${names[player.shotType]}${player.getVolleyFrame() !== null ? ' ' + String(player.getVolleyFrame() + 1).padStart(2, '0') : ''}${player.isDashing ? ' / ダッシュ' : ''} ｜ ${ball.message} ｜ YOU ${score.player} : ${score.cpu} CPU ｜ 返球 ${ball.returnCount}`;
  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);


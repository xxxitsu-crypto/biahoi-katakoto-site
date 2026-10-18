// PC操作確認版。既存の InputHandler / SealPlayer / Ball / drawCourt を継承。
// 数値は60回/秒の固定更新を前提とする。描画回数とは切り離す。
const CANVAS_WIDTH = 256;
const CANVAS_HEIGHT = 240;
const ASSET_VERSION = '20261018-60';
function assetUrl(file) { return `assets/${file}?v=${ASSET_VERSION}`; }
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
  curveAcceleration: 0.085, // ダッシュボレーが見て分かる横カーブ
  curveTicks: 36,
  shotAnimationScale: 1.5, // プレイヤーのショットを約1.5倍ゆっくり見せる
};
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');

// 短い効果音を端末内で合成。初回のユーザー操作で音声を有効化する。
const sound = {
  enabled: true, context: null, master: null, noise: null,
  unlock() {
    if (!this.enabled) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      if (!this.context) {
        this.context = new Audio();
        this.master = this.context.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.context.destination);
        this.noise = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * 0.15), this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        // ゲームの乱数に影響しない固定のノイズ。
        let seed = 12345;
        for (let i = 0; i < data.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          data[i] = seed / 2147483648 - 1;
        }
      }
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
      endingMusic.prepare(this.context);
    } catch (_) { /* 音声非対応でもゲームは続行する。 */ }
  },
  play(kind) {
    if (!this.enabled || !this.context || this.context.state !== 'running' || document.hidden) return;
    try {
      const audio = this.context, now = audio.currentTime;
      const duration = kind === 'net' ? 0.085 : kind === 'hit' ? 0.075 : 0.09;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(kind === 'net' ? 0.24 : 0.22, now + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      gain.connect(this.master);
      let source, filter;
      if (kind === 'net') {
        // 丸く短い「ポコ」。ラケットの矩形波・バウンドの三角波と区別する。
        source = audio.createOscillator(); source.type = 'sine';
        source.frequency.setValueAtTime(520, now);
        source.frequency.exponentialRampToValueAtTime(180, now + duration);
        source.connect(gain);
      } else {
        source = audio.createOscillator(); source.type = kind === 'hit' ? 'square' : 'triangle';
        source.frequency.setValueAtTime(kind === 'hit' ? 760 : 240, now);
        source.frequency.exponentialRampToValueAtTime(kind === 'hit' ? 330 : 95, now + duration);
        source.connect(gain);
      }
      source.onended = () => { source.disconnect(); filter?.disconnect(); gain.disconnect(); };
      source.start(now); source.stop(now + duration + 0.01);
    } catch (_) { /* 音声の失敗でラリーを止めない。 */ }
  },
  tune(kind) {
    if (!this.enabled || !this.context || this.context.state !== 'running' || document.hidden) return;
    const songs = {
      start: [[659,.10],[784,.10],[988,.10],[784,.10],[1047,.42]],
      in: [[784,.09],[1047,.30]],
      sad: [[659,.10],[494,.12],[330,.30]],
      win: [[523,.12],[659,.12],[784,.16],[1047,.50]],
      lose: [[494,.20],[440,.20],[392,.24],[262,.55]]
    };
    try {
      const audio = this.context; let when = audio.currentTime;
      for (const [frequency, duration] of songs[kind] || []) {
        const source = audio.createOscillator(), gain = audio.createGain();
        source.type = 'square'; source.frequency.setValueAtTime(frequency, when);
        gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(.16, when + .005);
        gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
        source.connect(gain); gain.connect(this.master);
        source.onended = () => { source.disconnect(); gain.disconnect(); };
        source.start(when); source.stop(when + duration + .005); when += duration + .025;
      }
    } catch (_) { /* 音声の失敗でゲーム進行を止めない。 */ }
  },
  toggle() {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.setValueAtTime(this.enabled ? 0.35 : 0, this.context.currentTime);
    if (this.enabled) this.unlock();
    endingMusic.sync();
    const button = document.getElementById('sound-toggle');
    if (button) { button.textContent = this.enabled ? '音：オン' : '音：オフ'; button.setAttribute('aria-pressed', String(this.enabled)); }
  }
};
window.addEventListener('pointerdown', () => sound.unlock(), { capture: true });
window.addEventListener('keydown', () => sound.unlock(), { capture: true });

const sealImage = new Image();
sealImage.src = assetUrl('move_01.png');
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
  image.src = assetUrl(file);
  sprites[key] = { image, frames };
}
// スイングのコマと判定は別管理。戻りで同じ絵を使っても再ヒットしない。
const VOLLEY = {
  forehand: {
    key: 'volleyRight', file: 'volley_right.png', cellWidth: 70, cellHeight: 75,
    sourceWidth: 70, sourceHeight: 75,
    cropX: 0, cropY: 0, drawOffsetX: -7,
    phases: [
      { frame: 1, ticks: 4 },
      { frame: 2, ticks: 4, quality: 'normal', aim: 1 },
      { frame: 3, ticks: 4, quality: 'critical', aim: 0 },
      { frame: 4, ticks: 4, quality: 'normal', aim: -1, smashFloat: true },
      { frame: 5, ticks: 3 }, { frame: 6, ticks: 3 }, { frame: 7, ticks: 3 },
    ],
  },
  backhand: {
    key: 'volleyLeft', file: 'volley_left.png', cellWidth: 96, cellHeight: 76,
    cropX: 0, cropY: 0, sourceWidth: 96, sourceHeight: 76,
    drawWidth: 96 * 32 / 71, drawHeight: 34, drawOffsetX: -12,
    phases: [
      { frame: 1, ticks: 4 },
      { frame: 2, ticks: 4, quality: 'normal', aim: -1 },
      { frame: 3, ticks: 4, quality: 'critical', aim: 0 },
      { frame: 4, ticks: 4, quality: 'normal', aim: 1, smashFloat: true },
      { frame: 3, ticks: 3 }, { frame: 2, ticks: 3 }, { frame: 1, ticks: 3 },
    ],
  },
};
// 提供PNGの黄色いラケット面を測定。半径は輪郭を含めた元画像上の値。
VOLLEY.forehand.racketCenters = [[13.41, 22.04], [22.89, 47.05], [39.54, 51.57], [56.29, 52.85], [56.35, 30.49], [30.44, 12.45], [56.35, 30.49], [39.54, 51.57]];
VOLLEY.forehand.racketRadii = [[12.41, 15.04], [12.11, 12.05], [9.54, 12.57], [12.29, 11.15], [12.65, 12.49], [11.56, 12.55], [12.65, 12.49], [9.54, 12.57]];
VOLLEY.backhand.racketCenters = [[61.5, 22.5], [50, 42], [14, 50], [12, 37.5], [21, 10.5]];
VOLLEY.backhand.racketRadii = [[13.5, 15.5], [12, 13], [13, 13], [14, 14.5], [12, 11.5]];
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
      { frame: 2, ticks: 4, quality: kind === 'serve' ? 'serve_fast' : kind },
      { frame: 3, ticks: 4, quality: kind === 'serve' ? 'serve_safe' : kind },
      { frame: 4, ticks: 18 },
    ],
  };
}
let practiceMode = 'rally'; // CPUサーブ／プレイヤーサーブの切替。
const campaign = { stage: [2,3].includes(window.SEAL_START_STAGE) ? window.SEAL_START_STAGE : 1, selectedStage: [2,3].includes(window.SEAL_START_STAGE) ? window.SEAL_START_STAGE : 1, transitionTicks: 0 };
const score = { player: 0, cpu: 0 };
const openingImages = {};
for (const [key, file] of Object.entries({ background: 'opening-scroll.jpg', logo: 'logo.png', cursor: 'choice-ball.png' })) {
  const image = new Image(); image.src = assetUrl(file); openingImages[key] = image;
}
const screen = { phase: 'title', ticks: 0 };
const stageMenu = { sequence: [], selected: 1 };
const STAGE_COMMAND = ['up','up','down','down','left','right','left','right'];
const MENU_PHASES = ['title', 'stage-reveal', 'stage-choice', 'ending-win', 'ending'];
function menuDirection(dir) {
  if (!MENU_PHASES.includes(screen.phase)) return false;
  if (screen.phase === 'title') {
    stageMenu.sequence.push(dir);
    while (stageMenu.sequence.length && !stageMenu.sequence.every((value, i) => value === STAGE_COMMAND[i])) stageMenu.sequence.shift();
  } else if (screen.phase === 'stage-choice' && ['left','right'].includes(dir)) {
    stageMenu.selected = (stageMenu.selected + (dir === 'right' ? 1 : -1) + 2) % 3 + 1;
    updateStageMenuLabel();
  }
  return true;
}
function updateStageMenuLabel() {
  canvas.setAttribute('aria-label', 'ステージ選択 ST0' + stageMenu.selected + '。左右で選択、ショットで決定');
}
function menuShot() {
  if (!MENU_PHASES.includes(screen.phase)) return false;
  if (screen.phase === 'ending') {
    if (screen.ticks >= 120) returnToOpening();
  } else if (screen.phase === 'title') {
    if (stageMenu.sequence.length === STAGE_COMMAND.length) {
      stageMenu.sequence = []; stageMenu.selected = 1;
      input.cancel(); sound.unlock(); sound.play('hit');
      screen.phase = 'stage-reveal'; screen.ticks = 48;
      document.getElementById('game-container').dataset.screen = 'stage-choice';
      updateStageMenuLabel();
    } else { campaign.selectedStage = 1; startOpening(); }
  } else if (screen.phase === 'stage-choice') {
    campaign.selectedStage = stageMenu.selected;
    screen.phase = 'title'; startOpening();
  }
  return true;
}
function drawOpeningBackground(context, progress = 0) {
  context.fillStyle = '#5bdcf4'; context.fillRect(0, 0, 512, 640);
  if (!imageReady(openingImages.background)) return;
  const image = openingImages.background;
  // 同じ縦長画像の下640pxから上640pxへ、切り出し位置だけを移動する。
  const sourceY = Math.round(Math.max(0, image.height - 640) * (1 - progress));
  context.drawImage(image, 0, sourceY, 512, 640, 0, 0, 512, 640);
}
function drawOpeningLogo(context) {
  if (imageReady(openingImages.logo)) context.drawImage(openingImages.logo, 121, 60, 270, 95);
}
function drawStageChoice(context, now) {
  drawOpeningBackground(context, 1);
  drawOpeningLogo(context);
  context.save(); context.fillStyle = '#fff'; context.textAlign = 'center';
  context.font = 'italic 26px Georgia, serif';
  for (let n = 0; n < 3; n++) context.fillText('ST0' + (n + 1), [140,255,370][n], 370);
  context.restore();
  if (imageReady(openingImages.cursor)) context.drawImage(openingImages.cursor, [140,255,370][stageMenu.selected-1]-12, 400+Math.round(Math.sin(now/180)*3), 24, 24);
}
function drawStageReveal(context, now) {
  const progress = 1 - screen.ticks / 48;
  drawOpeningBackground(context, 1 - Math.pow(1 - progress, 3));
  drawOpeningLogo(context);
}
const endingImage = new Image(); endingImage.src = assetUrl('ending.jpg');
const ENDING_MESSAGE = 'congratulations !　you are No.1  Azarashi.';
const endingMusic = {
  buffer: null, loading: null, source: null, offset: 0, startedAt: 0, finished: false,
  prepare(context) {
    if (this.buffer || this.loading || !context || typeof fetch !== 'function') return;
    this.loading = fetch(assetUrl('ending.mp3'))
      .then(response => { if (!response.ok) throw new Error('ending audio'); return response.arrayBuffer(); })
      .then(data => context.decodeAudioData(data))
      .then(buffer => { this.buffer = buffer; this.sync(); })
      .catch(() => { this.loading = null; });
  },
  pause() {
    if (!this.source) return;
    this.offset = Math.min(this.buffer.duration, this.offset + sound.context.currentTime - this.startedAt);
    const source = this.source; this.source = null; source.onended = null;
    source.stop(); source.disconnect();
  },
  reset() { this.pause(); this.offset = 0; this.finished = false; },
  sync() {
    const active = screen.phase === 'ending' && screen.ticks >= 120 && sound.enabled && !paused && !document.hidden;
    if (!active) { this.pause(); return; }
    if (this.source || this.finished || !this.buffer || sound.context?.state !== 'running') return;
    if (this.offset >= this.buffer.duration) { this.finished = true; return; }
    const source = sound.context.createBufferSource(); source.buffer = this.buffer;
    source.connect(sound.master); this.source = source; this.startedAt = sound.context.currentTime;
    source.onended = () => { if (this.source === source) { this.source = null; this.finished = true; source.disconnect(); } };
    source.start(0, this.offset);
  }
};
function beginEnding() {
  input.cancel(); endingMusic.reset(); screen.phase = 'ending'; screen.ticks = 0;
  document.getElementById('game-container').dataset.screen = 'ending';
  canvas.setAttribute('role', 'button'); canvas.setAttribute('aria-label', 'エンディング。ショットでオープニングへ');
}
function drawEnding(context) {
  context.fillStyle = '#5bdcf4'; context.fillRect(0, 0, 512, 640);
  if (imageReady(endingImage)) context.drawImage(endingImage, 0, 0, 512, 640);
  context.save(); context.beginPath(); context.rect(0, 32, 512, 150); context.clip();
  context.fillStyle = '#fff'; context.textAlign = 'left'; context.font = '24px Georgia, serif';
  const width = context.measureText(ENDING_MESSAGE).width;
  const x = 512 - (screen.ticks * 1.1) % (512 + width + 80);
  context.fillText(ENDING_MESSAGE, x, 112); context.restore();
}
const stageIntros = [null,...[1,2,3].map((stage)=>{
 const card=new Image();card.src=assetUrl(`intro-stage${stage}.png`);
 const portrait=new Image();portrait.src=assetUrl(`intro-${['cha','ich','erin'][stage-1]}.png`);
 return{card,portrait};
})];
function drawStageIntro(context){
 const intro=stageIntros[campaign.stage];
 context.fillStyle='#252525';context.fillRect(0,0,512,640);
 // 見本の文字をそのまま使い、元のキャラクター素材を同じ位置へ配置。
 if(imageReady(intro.card))context.drawImage(intro.card,0,0,512,640);
 if(imageReady(intro.portrait))context.drawImage(intro.portrait,78,247,115,147);
}
function beginStageIntro(){
 input.cancel();screen.phase='intro';screen.ticks=60;
 document.getElementById('game-container').dataset.screen='intro';
 canvas.setAttribute('aria-label','ステージ'+campaign.stage+' キャラクター紹介');
}
function drawOpening(context, now) {
  drawOpeningBackground(context);
  drawOpeningLogo(context);
  if (Math.floor(now / (screen.phase === 'confirming' ? 80 : 650)) % 2 === 0) {
    context.save(); context.fillStyle = '#fff'; context.textAlign = 'center';
    context.font = 'bold italic 26px Georgia, serif';
    context.fillText('push to play', 256, 228); context.restore();
  }
}
const judgeImages = {};
for (const [key, file] of Object.entries({ referee: 'sinpan.png', bubble: 'fukidasi.png', win: 'WIN.png', lose: 'gameover.png' })) {
  const image = new Image(); image.src = assetUrl(file); judgeImages[key] = image;
}
const referee = { text: '', ticks: 0, frame: 1,
  call(text, ticks = 90) {
    if (!['インッ', 'アウト', 'フォルト', 'Wフォルト', 'ワンモア', 'GAME', 'プレイッ'].includes(text)) return;
    this.text = text; this.ticks = ticks;
  },
  update() {
    if (this.ticks > 0 && --this.ticks === 0) this.text = '';
    // 奥・ネット付近・手前の球を、提供された顔の3コマで追う。
    this.frame = ball.y < 100 ? 2 : ball.y > 145 ? 0 : 1;
  },
  draw(context) {
    const image = judgeImages.referee;
    if (imageReady(image)) {
      const starts = [0, 48, 96], widths = [48, 48, 46];
      const width = widths[this.frame] * 1.5, height = 83 * 1.5;
      context.drawImage(image, starts[this.frame], 0, widths[this.frame], 83, 476 - width / 2, 353.5 - height / 2, width, height);
    }
    if (!this.text || !imageReady(judgeImages.bubble)) return;
    context.drawImage(judgeImages.bubble, 444, 244, 63, 57);
    context.save(); context.fillStyle = '#000'; context.font = 'bold 12px sans-serif';
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(this.text, 475.5, 267, 55); context.restore();
  }
};
const match = {
  games: { player: 0, cpu: 0 }, server: 'cpu', faults: 0, winner: null, boardTicks: 90,
  reset(server = 'cpu') { score.player = score.cpu = 0; this.games.player = this.games.cpu = 0; this.server = server; this.faults = 0; this.winner = null; this.boardTicks = 90; referee.text = ''; referee.ticks = 0; },
  award(winner) {
    if (this.winner) return;
    score[winner]++; this.faults = 0;
    const other = winner === 'player' ? 'cpu' : 'player';
    if (score[winner] >= 4 && score[winner] - score[other] >= 2) {
      this.games[winner]++; score.player = score.cpu = 0;
      referee.call('GAME', 150); this.boardTicks = 150;
      if (this.games[winner] >= 3) { this.winner = winner; sound.tune(winner === 'player' ? 'win' : 'lose'); if (winner === 'player' && campaign.stage < 3) campaign.transitionTicks = 150; if (winner === 'player' && campaign.stage === 3) { screen.phase='ending-win'; screen.ticks=180; } if (winner === 'cpu') { screen.phase='gameover'; screen.ticks=120; } }
      else this.server = this.server === 'player' ? 'cpu' : 'player';
    }
  },
  points() {
    if (score.player >= 3 && score.cpu >= 3) return score.player === score.cpu ? 'デュース' : 'アドバンテージ ' + (score.player > score.cpu ? 'YOU' : 'CPU');
    const labels = ['0', '15', '30', '40']; return labels[score.player] + ' : ' + labels[score.cpu];
  }
};
const CPU_SETTINGS = { speed: 0.9, reactionTicks: 10, reach: 14, minHeight: 3, maxHeight: 32 };
const SHOT_PROFILES = {
  normal: { ticks: 48, gravity: 0.090 },    // 通常返球はネットを越えやすい山なり軌道
  critical: { ticks: 38, gravity: 0.105 }, // ジャスト返球は速く、ネットも越える
  float: { ticks: 62, gravity: 0.080 },
  smash: { ticks: 30, gravity: 0.080 },
};
function serveAimX(p) { return Math.max(114, Math.min(142, 128 + (128 - (p.x + p.width / 2)) * 0.45)); }
const SERVE_PROFILES = {
  // 早い打点は速い反面、低い打球になりネットしやすい。
  serve_fast: { ticks: 54, gravity: 0.070, targetY: 60 },
  // 少し遅い打点は高く通り、速度は落ちる。
  serve_safe: { ticks: 72, gravity: 0.075, targetY: 60 },
};
for (const config of Object.values(VOLLEY)) {
  config.phases = config.phases.map(phase => ({
    ...phase,
    ticks: Math.max(1, Math.round(phase.ticks * SETTINGS.shotAnimationScale)),
  }));
  config.totalTicks = config.phases.reduce((total, phase) => total + phase.ticks, 0);
  config.image = new Image();
  config.image.src = assetUrl(config.file);
}
let showGuide = false;

class InputHandler {
  constructor() {
    this.history = { up: [], down: [], left: [], right: [] };
    this.consumeQueue = [];
    this.shotQueue = [];
    this.actionSources = new Set();
    this.pointerDirections = new Map();
    this.keys = new Set();
    this.cancelVersion = 0;
    this.initKeyboard();
    this.initTouch();
  }
  get action() { return this.actionSources.size > 0; }
  get horizontalAim() {
    const directions = [...this.pointerDirections.values()];
    const left = this.keys.has('ArrowLeft') || directions.includes('left');
    const right = this.keys.has('ArrowRight') || directions.includes('right');
    return Number(right) - Number(left);
  }
  get downHeld() {
    return [...this.pointerDirections.values()].includes('down') || this.keys.has('ArrowDown');
  }
  registerPress(dir, now = performance.now()) {
    if (menuDirection(dir)) return;
    if (dir === 'down' && this.action) {
      // ショットを構えた状態で下を押した瞬間にロブを開始する。下移動にはしない。
      this.shotQueue.push({ type: 'lob' });
      return;
    }
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
    if (menuShot()) return;
    if(screen.phase==='continue'){ input.cancel(); resetPractice(); return; }
    if (this.actionSources.has(source)) return;
    if (!this.action) {
      // 下を先に押している場合も、ショットを押した瞬間にロブを開始する。
      this.shotQueue.push({ type: this.downHeld ? 'lob' : 'press', shotPress: true });
    }
    this.actionSources.add(source);
  }
  releaseShot(source) {
    if (!this.actionSources.delete(source)) return;
    if (!this.action) {
      this.shotQueue.push({ type: 'release', aim: this.horizontalAim });
    }
  }
  releaseDirection(pointerId) {
    this.pointerDirections.delete(pointerId);
  }
  cancel() {
    this.keys.clear();
    this.pointerDirections.clear();
    this.actionSources.clear();
    this.consumeQueue.length = 0;
    this.shotQueue.length = 0;
    Object.keys(this.history).forEach(key => this.history[key] = []);
    this.cancelVersion++;
  }
  initKeyboard() {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    window.addEventListener('keydown', e => {
      if (MENU_PHASES.includes(screen.phase)) return;
      const shot = e.code === 'KeyZ' || e.code === 'Space';
      if (map[e.code] || shot) e.preventDefault();
      if (e.repeat || this.keys.has(e.code)) return;
      this.keys.add(e.code);
      if (map[e.code]) this.registerPress(map[e.code]);
      if (shot) this.pressShot(e.code);
      if (e.code === 'KeyD') showGuide = !showGuide;
      if (e.code === 'KeyR') resetCampaign();
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
        this.pointerDirections.set(e.pointerId, dir);
        this.registerPress(dir);
      });
      el?.addEventListener('pointerup', e => this.releaseDirection(e.pointerId));
      el?.addEventListener('pointercancel', e => this.releaseDirection(e.pointerId));
      el?.addEventListener('lostpointercapture', e => this.releaseDirection(e.pointerId));
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
    this.lobShot = false;
    this.incomingWasSmash = false;
    this.hasHit = false;
    this.cancelVersion = 0;
    this.swingCount = 0;
    this.swingAim = 0;
    this.swingDashDirection = null;
    this.swingElapsed = 0;
    this.visualFacing = 1; // 移動画像の左右。自動打球選択のfacingとは独立。
    this.dashDirection = null;
    this.animationKey = 'moveRight';
    this.animationTick = 0;
    this.animationFrame = 0;
    this.wasMoving = false;
  }
  selectShot(ball, forceVolley = false) {
    if (ball.serveWaiting || ball.serving) { this.shotType = 'serve'; return; }
    // Predict the ball at the first active frame, including its first bounce.
    let x=ball.x,y=ball.y,z=ball.z,vz=ball.vz,g=ball.gravity;
    let bounceFactor=ball.nextBounceFactor,bounceCap=ball.nextBounceMaxVz;
    let vx=ball.vx,curve=ball.curve||0;
    const lead=VOLLEY.smash.phases[0].ticks;
    for(let i=0;i<lead;i++){
      if(i<(ball.curveTicks||0)){vx+=curve;curve*=.985;}
      x+=vx;y+=ball.vy;z+=vz;vz-=g;
      if(z<0){z=0;vz*=- (bounceFactor??Math.abs(ball.bounce));
        if(bounceCap!=null)vz=Math.min(vz,bounceCap);
        bounceFactor=null;bounceCap=null;g=SETTINGS.gravity;}
    }
    const dx = x - (this.x + this.width / 2);
    const dy = y - (this.y + 6);
    if (!forceVolley && z >= 22 && Math.abs(dx) <= 14 && Math.abs(dy) <= 24) {
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
    if (this.swingTimer > 0) {
      this.swingTimer--;
      this.swingElapsed++;
    }
    this.isSwinging = this.swingTimer > 0;
    if (!this.isSwinging) this.selectShot(ball);
    const servePositioning = ball.serveWaiting || ball.serving;
    const serveLocked = servePositioning && !['waiting', 'toss'].includes(ball.servePhase);
    const previousX = this.x, previousY = this.y;
    // 構え・スイングとは独立して移動する。長押しの自動移動は追加しない。
    let act;
    while ((act = input.popAction())) {
      if (servePositioning && (serveLocked || act.dir === 'up' || act.dir === 'down')) continue;
      const speed = act.isRhythmJump ? SETTINGS.dashImpulse : SETTINGS.moveImpulse;
      if (act.dir === 'left') this.visualFacing = -1;
      if (act.dir === 'right') this.visualFacing = 1;
      // 上下入力では直前の左右の向きを保持する。
      if (act.isRhythmJump) {
        this.isDashing = true;
        this.dashDirection = act.dir;
        if (ball.servePhase === 'toss' && ['left', 'right'].includes(act.dir)) ball.serveDashDirection = act.dir;
        this.animationKey = ''; // 再度ダッシュしたら先頭コマから再生。
      }
      if (act.dir === 'left') this.vx -= speed;
      if (act.dir === 'right') this.vx += speed;
      if (act.dir === 'up') this.vy -= speed * SETTINGS.verticalRatio;
      if (act.dir === 'down') this.vy += speed * SETTINGS.verticalRatio;
    }
    if (servePositioning) { this.vy=0; if(serveLocked)this.vx=0; }
    this.x += this.vx; this.y += this.vy;
    this.vx *= this.friction; this.vy *= this.friction;
    if (Math.abs(this.vx) < 0.05) this.vx = 0;
    if (Math.abs(this.vy) < 0.05) this.vy = 0;
    if (this.vx === 0 && this.vy === 0) this.isDashing = false;
    this.x = Math.max(24, Math.min(CANVAS_WIDTH - 24 - this.width, this.x));
    this.y = Math.max(130, Math.min(218 - this.height, this.y));
    if (servePositioning) { this.x=Math.max(90,Math.min(150,this.x));this.y=206; }

    // キューを使い、1回の更新より短い押す→離すも取りこぼさない。
    for (const event of input.shotQueue.splice(0)) {
      if (ball.serveWaiting || ball.serving || (this.isSwinging && this.shotType === 'serve')) {
        // サーブ専用：離す操作では振らない。最初の押下で準備→トス、次の押下で振る。
        if ((event.type === 'press' || event.shotPress) && !this.isSwinging) {
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
      if (event.type === 'lob') {
        if (!this.isSwinging) {
          this.swingDashDirection = this.isDashing && ['left','right'].includes(this.dashDirection) ? this.dashDirection : null;
          this.swingAim = event.aim ?? input.horizontalAim;
          this.lobShot = true;
          this.selectShot(ball, true);
          this.isSwinging = true;
          this.swingTimer = VOLLEY[this.shotType]?.totalTicks ?? SETTINGS.swingTicks;
          this.swingElapsed = 0;
          this.hasHit = false;
          this.swingCount++;
        }
        this.isPreparing = false;
      } else if (event.type === 'press') {
        this.isPreparing = true;
      } else {
        if (this.isPreparing && !this.isSwinging) {
          this.swingDashDirection = this.isDashing && ['left','right'].includes(this.dashDirection) ? this.dashDirection : null;
          this.swingAim = event.aim ?? input.horizontalAim;
          this.lobShot = false;
          this.selectShot(ball);
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
      const hitQuality = this.getHitQuality();
      context.strokeStyle = ['critical', 'smash', 'serve'].includes(hitQuality) ? '#66ff99' :
        hitQuality === 'float' ? '#ff9966' : hitQuality === 'normal' && r.z < 10 ? '#ff5555' :
        this.isPreparing ? '#ffff66' : '#8feaff';
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
 const image = new Image(); image.src = assetUrl(file);
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
  this.reactionTimer=0;this.dashTimer=0;this.dashCooldown=0;this.dashSpeed=1.3;
  this.serveAge=0;this.plan=null;
  this.fatigueShots=0;this.fatigueMoveShots=0;this.fatigueTriggered=false;this.observedHits=-1;
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
  let x=ball.x,y=ball.y,z=ball.z,vz=ball.vz,bounces=ball.bouncesInCurrentCourt,g=ball.gravity;
  for(let n=1;n<=100;n++) {
   const oldY=y;x+=ball.vx;y+=ball.vy;z+=vz;vz-=g;
   if(oldY>120&&y<=120)bounces=0;
   if(z<=0){z=0;vz*=ball.bounce;g=SETTINGS.gravity;if(++bounces>=2)break;}
   if(y<30)break;
   if(y>(ball.rallyHits===0?90:108))continue;
   const kinds=z>=24?['overhead','leftShot','rightShot']:['leftShot','rightShot'];
   for(const kind of kinds){
    const windup=kind==='overhead'?8:4;
    if(n<windup)continue;
    const r=this.racket(kind,kind==='overhead'?3:2);
    if(Math.abs(z-r.z)>r.hitHeight-2)continue;
    const tx=Math.max(24,Math.min(232,x-(r.x-this.x)));
    const ty=Math.max(34,Math.min(108,y));
    const distance=Math.hypot(tx-this.x,ty-this.y);
    // Right-side coverage includes the dash that can actually be used.
    const rightWide=tx>160&&tx-this.x>18;
    const dashFrames=this.dashTimer>0?Math.min(n,this.dashTimer):
      rightWide&&!this.dashCooldown?Math.min(n,26):0;
    const dashSpeed=this.dashTimer>0?this.dashSpeed:rightWide?2.1:1.3;
    const reach=(CPU_SETTINGS.speed*n+(dashSpeed-CPU_SETTINGS.speed)*dashFrames)*
      (ty<this.y?.65:1)*(this.fatigueMoveShots>0?.6:1);
    if(distance<=reach+4)return {x:tx,y:ty,n,kind,windup};
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
  // サーブ準備中は後方で待ち、サーバーの位置から受球位置を合わせる。
  if(ball.serveWaiting||ball.serving){
   this.targetX=ball.servePhase==='waiting'?serveAimX(player):ball.serviceTargetX;
   this.targetY=58;
   const dx=this.targetX-this.x,dy=this.targetY-this.y,d=Math.hypot(dx,dy);
   if(d>0.1){const step=Math.min(CPU_SETTINGS.speed,d);this.x+=dx/d*step;this.y+=dy/d*step;}
   this.moving=d>0.1;if(Math.abs(dx)>0.1)this.visualFacing=Math.sign(dx);
   this.animationTick=this.moving?this.animationTick+1:0;
   return;
  }
  const incoming=ball.lastHitter==='player'&&ball.vy<0&&!ball.serving&&!ball.serveWaiting;
  if(incoming&&!this.isSwinging){
   if(this.observedHits!==ball.rallyHits){this.observedHits=ball.rallyHits;this.reactionTimer=6;this.plan=null;}
   if(this.reactionTimer>0)this.reactionTimer--;
   else this.plan=this.predict(ball);
   if(this.plan){this.targetX=this.plan.x;this.targetY=this.plan.y;}
   else {this.targetX=Math.max(24,Math.min(232,ball.x));this.targetY=ball.rallyHits===0?58:100;}
  }else if(!this.isSwinging||this.hasHit){this.targetX=ball.rallyHits===0?128:Math.max(36,Math.min(220,ball.x));this.targetY=ball.rallyHits===0?58:100;}
  const dx=this.targetX-this.x,dy=this.targetY-this.y,distance=Math.hypot(dx,dy);
  const rightWide=this.targetX>160&&dx>18;
  if(incoming&&distance>(rightWide?22:38)&&!this.dashCooldown&&!this.isSwinging){
   this.dashTimer=rightWide?26:18;this.dashCooldown=rightWide?45:100;
   this.dashSpeed=rightWide?2.1:1.3;
  }
  const speed=(this.dashTimer?this.dashSpeed:CPU_SETTINGS.speed)*(dy<0?0.65:1)*(this.fatigueMoveShots>0?0.6:1);
  if(distance>0.1){const step=Math.min(speed,distance);this.x+=dx/distance*step;this.y+=dy/distance*step;}
  this.moving=distance>0.1;
  if(Math.abs(dx)>0.1)this.visualFacing=Math.sign(dx);
  this.animationTick=this.moving?this.animationTick+1:0;
  if(incoming&&!this.isSwinging&&this.plan&&this.plan.n<=this.plan.windup+1){
   this.startSwing(this.plan.kind);
  }
 }
 canHit(ball) {
  if(ball.servicePending||!this.isSwinging||this.hasHit||!this.phase()?.quality||ball.lastHitter!=='player'||ball.vy>=0||ball.y>=120)return false;
  const r=this.racket();
  return Math.hypot(ball.x-r.x,ball.y-r.y)<r.hitRadius&&Math.abs(ball.z-r.z)<r.hitHeight;
 }
 hit(ball) {
  const quality=this.phase()?.quality;if(!quality||this.hasHit)return;
  if(referee.text==='・・・'){referee.text='';referee.ticks=0;}
  sound.play('hit');
  this.hasHit=true;ball.lastHitter='cpu';ball.bouncesInCurrentCourt=0;
  ball.lastShotQuality=quality;
  ball.recordReturn();
  if(this.fatigueMoveShots>0)this.fatigueMoveShots--;
  if(campaign.stage===1&&ball.rallyHits>=10&&!this.fatigueTriggered){this.fatigueTriggered=true;this.fatigueShots=5;this.fatigueMoveShots=5;}
  const tired=this.fatigueShots>0;
  const r=this.racket();
  const contact=Math.max(-1,Math.min(1,(ball.x-r.x)/Math.max(1,r.hitRadius)));
  const aimX=Math.max(39,Math.min(217,128+contact*52+(this.targetX-this.x)*0.28));
  const profile=SHOT_PROFILES[quality]??SHOT_PROFILES.normal;
  // ステージ1の10ラリー後、5球分は移動速度だけでなく返球もゆっくりにする。
  // 飛行時間を約1.25倍にして速度を通常の約80%にし、低い弾道を保つ。
  const fatigueTicks = Math.round(profile.ticks / 0.8);
  const fatigueGravity = 0.018 * Math.pow(profile.ticks / fatigueTicks, 2);
  ball.launch(aimX,176,tired?fatigueTicks:profile.ticks,tired?fatigueGravity:profile.gravity);
  if(tired)this.fatigueShots--;
  ball.message=tired?'CPU息切れ：低い返球':quality==='smash'?'CPUスマッシュ':quality==='float'?'CPU浮き球':
   quality==='critical'?'CPUクリティカル':'CPU返球';
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
  const serveQuality=this.phase()?.frame===3?'serve_fast':this.phase()?.frame===4?'serve_safe':null;
  if(this.isSwinging&&!this.hasHit&&serveQuality){
   const r=this.racket();
   if(Math.hypot(ball.x-r.x,ball.y-r.y)<r.hitRadius&&Math.abs(ball.z-r.z)<r.hitHeight){
    this.hasHit=true;ball.cpuServing=false;ball.lastHitter='cpu';ball.bouncesInCurrentCourt=0;
    const profile=SERVE_PROFILES[serveQuality];
    ball.launch(ball.serviceTargetX,144,profile.ticks,profile.gravity);
    ball.nextBounceMaxVz=1.45;
    ball.startService();
    ball.message=serveQuality==='serve_fast'?'CPU速いサーブ':'CPU安定サーブ';return;
   }
  }
  if(ball.z<=0)ball.fault();
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

// 添付画像のセル位置をそのまま切り出す。左右反転はしない。
const BOY_SPRITES = {};
for (const [key,file,cuts,h] of [
 ['leftShot','boy-back.png',[0,110,220,330,440,550],99],
 ['rightShot','boy-fore.png',[0,110,220,330,440,550,660],99],
 ['overhead','boy-serve.png',[0,126,251,377,503,629,754,880],130],
 ['walk','boy-walk.png',[0,126,252,378,503],111]
]) { const image=new Image();image.src=assetUrl(file); BOY_SPRITES[key]={image,cuts,h}; }
const BOY_SHOTS = {
 leftShot: { centers:[[10,33],[64,18],[98,32],[98,61],[10,33]], anchor:[40,92], phases:[
  {frame:1,ticks:7},{frame:2,ticks:6,quality:'float'},{frame:3,ticks:7,quality:'critical'},{frame:4,ticks:8}] },
 rightShot: { centers:[[16,40],[24,10],[14,54],[10,83],[70,88],[14,54]], anchor:[40,94], phases:[
  {frame:1,ticks:7},{frame:2,ticks:7,quality:'critical'},{frame:3,ticks:6,quality:'float'},{frame:4,ticks:7},{frame:5,ticks:7}] },
 overhead: { centers:[[27,65],[28,41],[36,39],[39,39],[44,14],[113,106],[20,80]], anchor:[55,120], phases:[
  {frame:1,ticks:7},{frame:2,ticks:7},{frame:3,ticks:7},{frame:4,ticks:8,quality:'smash'},{frame:5,ticks:12},{frame:6,ticks:8}] }
};
class BoyPlayer extends CpuPlayer {
 shots() { return BOY_SHOTS; }
 reset() { super.reset(); this.curveBlunderUsed=false; }
 update(ball) {
  if(this.isSwinging){this.swingElapsed++;if(!this.phase())this.isSwinging=false;}
  if(ball.resetTimer||ball.cpuServing){this.moving=false;return;}
  const incoming=ball.lastHitter==='player'&&ball.vy<0&&!ball.serving&&!ball.serveWaiting;
  if(ball.serveWaiting||ball.serving){this.targetX=ball.servePhase==='waiting'?serveAimX(player):ball.serviceTargetX;this.targetY=58;}
  else if(incoming&&!this.isSwinging){
   if(this.observedHits!==ball.rallyHits){this.observedHits=ball.rallyHits;this.reactionTimer=ball.x>128?11:6;this.plan=null;}
   if(this.reactionTimer>0)this.reactionTimer--;else this.plan=this.predict(ball);
   this.targetX=this.plan?.x??Math.max(24,Math.min(232,ball.x));this.targetY=this.plan?.y??58;
  }else if(!this.isSwinging||this.hasHit){this.targetX=128;this.targetY=58;}
  // 前へ突進せず、後方から長いリーチで返球する。
  this.targetY=Math.max(46,Math.min(84,this.targetY));
  const dx=this.targetX-this.x,dy=this.targetY-this.y,d=Math.hypot(dx,dy);
  if(d>.1){const speed=CPU_SETTINGS.speed*(this.fatigueMoveShots>0?.6:1),step=Math.min(speed,d);this.x+=dx/d*step;this.y+=dy/d*step;}
  this.y=Math.min(84,this.y);this.moving=d>.1;this.animationTick=this.moving?this.animationTick+1:0;
  if(Math.abs(dx)>.1)this.visualFacing=Math.sign(dx);
  if(incoming&&!this.isSwinging&&this.plan&&this.plan.n<=this.plan.windup+1)this.startSwing(this.plan.kind);
 }
 canHit(ball) {
  if(!super.canHit(ball))return false;
  // 苦手なバックのジャスト打点は短い。浮きのコマはそのまま使う。
  if(this.shotKind==='leftShot'&&this.phase()?.quality==='critical')return this.swingElapsed<17;
  return true;
 }
 hit(ball) {
  const kind=this.shotKind,r=this.racket(),offCenter=Math.abs(ball.x-r.x);
  super.hit(ball);
  if(!this.hasHit)return;
  const profile=SHOT_PROFILES[ball.lastShotQuality]??SHOT_PROFILES.normal;
  const ticks=Math.round(profile.ticks*1.25),gravity=ball.gravity*Math.pow(profile.ticks/ticks,2);
  const side=ball.rallyHits%2===0?-1:1;
  // 少しだけ左右に振り、滞空時間を延ばして約20%減速する。
  ball.launch(128+side*10,176,ticks,gravity);
  if(ball.rallyHits>=16&&!this.curveBlunderUsed){
   this.curveBlunderUsed=true;ball.z=Math.max(24,ball.z);
   ball.launch(280,176,75,.07);ball.curve=.14;ball.curveTicks=75;ball.lastShotQuality='critical';
   ball.message='大カーブ：右へ曲がりすぎ';
  }else if(kind==='leftShot'&&offCenter>10){
   // 右へ振られたバックは、芯を外すと弱い低い返球になる。
   ball.launch(128+side*10,176,78,.018);ball.lastShotQuality='float';
  }
 }

 phase() {
  if(!this.isSwinging)return null;let t=this.swingElapsed;
  for(const p of this.shots()[this.shotKind].phases){if(t<p.ticks)return p;t-=p.ticks;}return null;
 }
 racket(kind=this.shotKind,frame=this.phase()?.frame??0) {
  const c=this.shots()[kind], [x,y]=c.centers[frame], [ax,ay]=c.anchor, scale=32/71;
  return {x:this.x+(x-ax)*scale,y:this.y,z:Math.max(2,(ay-y)*scale),radiusX:5,radiusY:5,hitRadius:kind==='leftShot'?18:26,hitHeight:15};
 }
 predict(ball) {
  let x=ball.x,y=ball.y,z=ball.z,vz=ball.vz,bounces=ball.bouncesInCurrentCourt,g=ball.gravity;
  for(let n=1;n<=110;n++){
   const oldY=y;x+=ball.vx;y+=ball.vy;z+=vz;vz-=g;
   if(oldY>120&&y<=120)bounces=0;
   if(z<=0){z=0;vz*=ball.bounce;g=SETTINGS.gravity;if(++bounces>=2)break;}
   if(y<30)break;if(y>98)continue;
   for(const kind of z>=36?['overhead',x>128?'leftShot':'rightShot']:[x>128?'leftShot':'rightShot']){
    const phases=this.shots()[kind].phases, target=phases.find(p=>p.quality==='critical'||p.quality==='smash');
    const windup=phases.slice(0,phases.indexOf(target)).reduce((v,p)=>v+p.ticks,0);
    if(n<windup)continue;const r=this.racket(kind,target.frame);
    if(Math.abs(z-r.z)>r.hitHeight-2)continue;
    const tx=Math.max(24,Math.min(232,x-(r.x-this.x))),ty=Math.max(34,Math.min(84,y));
    if(Math.hypot(tx-this.x,ty-this.y)<=CPU_SETTINGS.speed*n+4)return{x:tx,y:ty,n,kind,windup};
   }
  }return null;
 }
 updateServe(ball) {
  this.serveAge++;this.shotKind='overhead';
  if(this.serveAge<=30){Object.assign(ball,{x:this.x-8,y:this.y,z:23,vx:0,vy:0,vz:2.7});return;}
  ball.z+=ball.vz;ball.vz-=ball.gravity;
  if(this.serveAge===40)this.startSwing('overhead');
  if(this.isSwinging&&!this.hasHit&&this.phase()?.frame===4){
   // 5コマ目のラケット面をサーブの打点にする。
   const r=this.racket();Object.assign(ball,{x:r.x,y:r.y,z:r.z});
   this.hasHit=true;ball.cpuServing=false;ball.lastHitter='cpu';ball.bouncesInCurrentCourt=0;
   // サーブは低い弾道と小さなバウンド。左右差は中心から8だけ。
   ball.serviceTargetX=128+(match.games.player+match.games.cpu+score.player+score.cpu+match.faults)%2*16-8;
   const serveSpeed=1.3;
   // Increase horizontal speed by 30%, retaining the low flight arc and bounce.
   ball.launch(ball.serviceTargetX,144,90/serveSpeed,.035*serveSpeed*serveSpeed);
   ball.nextBounceFactor=.72/serveSpeed;ball.nextBounceMaxVz=1.53;
   ball.startService();return;
  }
  if(ball.z<=0)ball.fault();
 }
 draw(context) {
  const shot=this.isSwinging||ball.cpuServing,key=shot?this.shotKind:'walk',cfg=BOY_SPRITES[key];
  const frame=shot?(this.phase()?.frame??0):this.moving?Math.floor(this.animationTick/7)%4:0;
  const [ax,ay]=shot?this.shots()[key].anchor:[62,104],scale=32/71;
  if(imageReady(cfg.image))context.drawImage(cfg.image,cfg.cuts[frame],0,cfg.cuts[frame+1]-cfg.cuts[frame],cfg.h,
   this.x-ax*scale,this.y-ay*scale,(cfg.cuts[frame+1]-cfg.cuts[frame])*scale,cfg.h*scale);
  if(showGuide&&shot){const r=this.racket();context.strokeStyle=this.phase()?.quality?'#66ff99':'#8feaff';context.beginPath();context.ellipse(r.x,r.y-r.z,r.radiusX,r.radiusY,0,0,Math.PI*2);context.stroke();}
 }
}

const ERIN_SPRITES = {};
for(const [key,file,frames,w,h] of [
 ['leftShot','erin-back.png',5,98,108],['rightShot','erin-fore.png',5,98,100],
 ['overhead','erin-serve.png',6,97,125],['moveLeft','erin-left.png',5,98,108],['moveRight','erin-right.png',5,98,108]
]){const image=new Image();image.src=assetUrl(file);ERIN_SPRITES[key]={image,frames,w,h};}
const ERIN_SHOTS = {
 leftShot:{anchor:[44,99],centers:[[76.84,72.09],[13.69,37.58],[23.74,64.34],[64.68,42.17],[84.78,26.60]],radii:[[14,14],[14,14],[14,15],[10,16],[14,14]],phases:[{frame:1,ticks:3},{frame:2,ticks:5,quality:'critical'},{frame:3,ticks:3,quality:'float'},{frame:4,ticks:7}]},
 rightShot:{anchor:[44,93],centers:[[83.84,64.09],[79.19,28.21],[83.86,52.35],[27.06,49.30],[13.84,37.54]],radii:[[14,14],[14,14],[14,13],[10,16],[12,13]],phases:[{frame:1,ticks:3},{frame:2,ticks:5,quality:'critical'},{frame:3,ticks:3,quality:'float'},{frame:4,ticks:7}]},
 overhead:{anchor:[44,120],centers:[[76.84,89.09],[81.53,84.14],[81.24,61.87],[82.73,48.98],[78.93,20.99],[19.69,91.61]],radii:[[14,14],[14,12],[14,14],[15,14],[15,16],[14,12]],phases:[{frame:1,ticks:3},{frame:2,ticks:3},{frame:3,ticks:3},{frame:4,ticks:5,quality:'smash'},{frame:5,ticks:8}]}
};
function launchOverNet(ball,x,y,ticks,gravity=.06){
 const q=(120-ball.y)/(y-ball.y)*ticks;
 if(q>0&&q<ticks){const clearance=campaign.stage===3?30:35;
  gravity=Math.max(gravity,2*(clearance-ball.z*(1-q/ticks))/(q*(ticks-q)));
 }
 ball.launch(x,y,ticks,gravity);
}
class ErinPlayer extends BoyPlayer {
 shots(){return ERIN_SHOTS;}
 reset(){super.reset();this.superUsed=false;this.lastMoveY=46;this.smashRecovery=0;this.lobCooldown=0;}
 racket(kind=this.shotKind,frame=this.phase()?.frame??0){
  const c=this.shots()[kind],[x,y]=c.centers[frame],[ax,ay]=c.anchor,scale=32/71;
  const [rx,ry]=c.radii[frame];
  return{x:this.x+(x-ax)*scale,y:this.y,z:Math.max(2,(ay-y)*scale),
   radiusX:rx*scale,radiusY:ry*scale,hitRadius:rx*scale+6,hitHeight:ry*scale+6};
 }
 phaseAt(kind,elapsed){
  for(const phase of this.shots()[kind].phases){if(elapsed<phase.ticks)return phase;elapsed-=phase.ticks;}
  return null;
 }
 canHit(ball){
  if(ball.guaranteedWinner||ball.erinRecoveryMiss)return false;
  // 打球コマのラケット位置でのみ返球する。近接時のコマ飛ばしは行わない。
  return CpuPlayer.prototype.canHit.call(this,ball)&&this.contactAt(ball.x,ball.y,ball.z,this.racket(),this.x,this.y,ball.radius);
 }
 contactAt(x,y,z,r,actorX,actorY,radius=3){
  const offset=r.x-this.x;
  if(Math.hypot(x-actorX-offset,y-actorY)>=r.hitRadius||Math.abs(z-r.z)>=r.hitHeight)return false;
  const p=projectCourt(actorX,actorY),b=projectCourt(x,y);
  const dx=b.x-(p.x+offset*p.scale),dy=b.y-z*b.scale-(p.y-r.z*p.scale);
  const rx=r.radiusX*p.scale+radius*b.scale+1,ry=r.radiusY*p.scale+radius*b.scale+1;
  return (dx/rx)**2+(dy/ry)**2<=1;
 }
 predict(ball){
  let x=ball.x,y=ball.y,z=ball.z,vx=ball.vx,vz=ball.vz,g=ball.gravity;
  let bounces=ball.bouncesInCurrentCourt,curve=ball.curve,curveTicks=ball.curveTicks;
  let nextBounce=ball.nextBounceFactor,nextBounceMaxVz=ball.nextBounceMaxVz;
  for(let n=1;n<=140;n++){
   if(curveTicks>0){vx+=curve;curve*=.985;curveTicks--;}
   const oldY=y;x+=vx;y+=ball.vy;z+=vz;vz-=g;
   if(oldY>120&&y<=120)bounces=0;
   if(z<=0){z=0;vz*=-(nextBounce??Math.abs(ball.bounce));
    if(nextBounceMaxVz!==null&&nextBounceMaxVz!==undefined)vz=Math.min(vz,nextBounceMaxVz);
    nextBounce=null;nextBounceMaxVz=null;g=SETTINGS.gravity;if(++bounces>=2)break;}
   if(y<24)break;
   if(y>108||x<24||x>232||z>85||(ball.servicePending&&bounces===0))continue;
   const kinds=this.isSwinging?[this.shotKind]:z>=32?['overhead','leftShot','rightShot']:[x<this.x?'leftShot':'rightShot',x<this.x?'rightShot':'leftShot'];
   for(const kind of kinds){
    let windup=0,phase;
    if(this.isSwinging){phase=this.phaseAt(kind,this.swingElapsed+n-1);if(this.hasHit||!phase?.quality)continue;}
    else{for(const p of this.shots()[kind].phases){if(p.quality){phase=p;break;}windup+=p.ticks;}
     if(n<windup+1)continue;}
    const r=this.racket(kind,phase.frame);
    if(Math.abs(z-r.z)>=r.hitHeight-2)continue;
    // 遠近投影後のラケット面を未来のボール位置へ合わせる。
    const bp=projectCourt(x,y),screenY=bp.y-z*bp.scale;
    let low=36,high=88;
    for(let i=0;i<12;i++){const mid=(low+high)/2,p=projectCourt(128,mid);
     if(p.y-r.z*p.scale<screenY)low=mid;else high=mid;}
    const ty=(low+high)/2,p=projectCourt(128,ty);
    const tx=Math.max(28,Math.min(228,128+(bp.x-p.x)/p.scale-(r.x-this.x)));
    if(!this.contactAt(x,y,z,r,tx,ty,ball.radius))continue;
    if(Math.hypot(tx-this.x,ty-this.y)<=2.2*n){return{x:tx,y:ty,n,kind,windup};}
   }
  }
  return null;
 }
 update(ball){
  this.lastMoveY=this.y;
  if(this.isSwinging){this.swingElapsed++;if(!this.phase())this.isSwinging=false;}
  if(ball.resetTimer||ball.cpuServing){this.moving=false;return;}
  const incoming=ball.lastHitter==='player'&&ball.vy<0&&!ball.serving&&!ball.serveWaiting&&!ball.guaranteedWinner&&!ball.erinRecoveryMiss;
  if(ball.serveWaiting||ball.serving){
   this.targetX=ball.servePhase==='waiting'?serveAimX(player):ball.serviceTargetX;this.targetY=58;
  }else if(incoming){
   this.plan=this.predict(ball);
   this.targetX=this.plan?.x??Math.max(28,Math.min(228,ball.x));
   this.targetY=this.plan?.y??Math.max(36,Math.min(88,ball.y));
  }else{this.targetX=128;this.targetY=58;this.plan=null;}
  const dx=this.targetX-this.x,dy=this.targetY-this.y,d=Math.hypot(dx,dy);
  if(d>.1){const step=Math.min(incoming?2.2:1.2,d);this.x+=dx/d*step;this.y+=dy/d*step;}
  this.moving=d>.1;this.animationTick=this.moving?this.animationTick+1:0;
  if(Math.abs(dx)>.1)this.visualFacing=Math.sign(dx);
  if(incoming&&!this.isSwinging&&this.plan&&this.plan.n<=this.plan.windup+1)this.startSwing(this.plan.kind);
 }
 launchShot(ball,x,y,ticks,gravity){
  // 到達時間を2/3にし、重力も合わせて弾道の高さを保つ。
  launchOverNet(ball,x,y,ticks/1.5,gravity*1.5*1.5);
 }
 hit(ball){
  const quality=this.phase()?.quality;if(!quality||this.hasHit)return;
  const serveReturn=ball.rallyHits===0&&match.server==='player';
  const curveReturn=ball.wasCurveShot===true||ball.erinOpeningSmash===true;
  const punishFloat=ball.lastShotQuality==='float';
  const recovering=this.smashRecovery>0,canLob=this.lobCooldown===0;
  if(this.smashRecovery>0)this.smashRecovery--;
  if(this.lobCooldown>0)this.lobCooldown--;
  this.hasHit=true;ball.lastHitter='cpu';ball.bouncesInCurrentCourt=0;ball.recordReturn();sound.play('hit');
  const targetX=Math.max(42,Math.min(214,player.x+player.width/2));
  if(curveReturn){
   // 曲がり終わった後もカーブだったことを覚え、必ずチャンスの浮き玉を返す。
   launchOverNet(ball,targetX,Math.max(180,Math.min(198,player.y+28)),78,.10);ball.lastShotQuality='float';ball.erinSmashOpening=true;ball.nextBounceMaxVz=2;
  }else if(ball.rallyHits>=20&&!this.superUsed){
   this.superUsed=true; // 接触時の姿勢・打球位置を維持して必殺返球へ切り替える。
   this.launchShot(ball,targetX,176,24,.10);ball.erinSuper=true;ball.bodyAim=true;ball.lastShotQuality='smash';
  }else if(serveReturn){
   launchOverNet(ball,128,166,60,.045);ball.nextBounceMaxVz=1.45;ball.lastShotQuality='normal';
  }else if(punishFloat&&!recovering){
   this.smashRecovery=1;
   this.launchShot(ball,targetX,176,36,.08);ball.bodyAim=true;ball.lastShotQuality='smash';
  }else if(player.y<145&&canLob&&!recovering){
   this.lobCooldown=2;
   const inCourt=Math.random()<.70;
   this.launchShot(ball,targetX,inCourt?199:222,88,.095);ball.lastShotQuality='lob';
  }else{
   this.launchShot(ball,128+(ball.rallyHits%2?18:-18),176,54,.06);ball.lastShotQuality='normal';ball.nextBounceMaxVz=2;
  }
 }
 updateServe(ball){
  this.serveAge++;this.shotKind='overhead';
  if(this.serveAge<=30){Object.assign(ball,{x:this.x+8,y:this.y,z:23,vx:0,vy:0,vz:2.7});return;}
  if(this.serveAge===31){
   const phases=this.shots().overhead.phases,hitIndex=phases.findIndex(p=>p.quality==='smash');
   const windup=phases.slice(0,hitIndex).reduce((sum,p)=>sum+p.ticks,0);
   const ticks=40+windup-30,r=this.racket('overhead',phases[hitIndex].frame);
   ball.vx=(r.x-ball.x)/ticks;
   ball.vz=(r.z-ball.z+0.5*ball.gravity*ticks*(ticks-1))/ticks;
  }
  ball.x+=ball.vx;ball.z+=ball.vz;ball.vz-=ball.gravity;
  if(this.serveAge===40)this.startSwing('overhead');
  if(this.isSwinging&&!this.hasHit&&this.phase()?.quality==='smash'){
   const r=this.racket();
   if(Math.hypot(ball.x-r.x,ball.y-r.y)<r.hitRadius&&Math.abs(ball.z-r.z)<r.hitHeight){
    this.hasHit=true;ball.cpuServing=false;ball.lastHitter='cpu';ball.bouncesInCurrentCourt=0;
    ball.serviceTargetX=128;launchOverNet(ball,128,150,45,.14);ball.nextBounceFactor=.65;ball.nextBounceMaxVz=1.3;ball.startService();return;
   }
  }
  if(ball.z<=0)ball.fault();
 }
 draw(context){
  const shot=this.isSwinging||ball.cpuServing;
  const vertical=Math.abs(this.targetY-this.lastMoveY)>Math.abs(this.targetX-this.x);
  const facing=vertical?(this.targetY<this.y?-1:1):this.visualFacing;
  const key=shot?this.shotKind:facing<0?'moveLeft':'moveRight',cfg=ERIN_SPRITES[key];
  const frame=shot?(this.phase()?.frame??0):this.moving?Math.floor(this.animationTick/7)%cfg.frames:0;
  const [ax,ay]=shot?this.shots()[key].anchor:[44,99],scale=32/71;
  if(imageReady(cfg.image))context.drawImage(cfg.image,frame*cfg.w,0,cfg.w,cfg.h,this.x-ax*scale,this.y-ay*scale,cfg.w*scale,cfg.h*scale);
  if(showGuide&&shot){const r=this.racket();context.strokeStyle=this.phase()?.quality?'#66ff99':'#8feaff';context.beginPath();context.ellipse(r.x,r.y-r.z,r.radiusX,r.radiusY,0,0,Math.PI*2);context.stroke();}
 }
}
function createOpponent(){return campaign.stage===3?new ErinPlayer():campaign.stage===2?new BoyPlayer():new CpuPlayer();}

class Ball {
  constructor() { this.returnCount = 0; this.resetServe(); }
  resetServe() {
    practiceMode = match.server === 'player' ? 'serve' : 'rally';
    this.servicePending = false; this.netTouched = false; this.erinSuper=false; this.bodyAim=false; this.guaranteedWinner=null;
    this.serviceTargetX = 128;
    this.x = CANVAS_WIDTH / 2 + (Math.random() * 24 - 12);
    this.y = 56; this.z = 16;
    this.gravity = SETTINGS.gravity;
    this.bounce = -0.85; this.radius = 3;
    this.bouncesInCurrentCourt = 0;
    this.hitNet = false;
    this.rallyHits = 0;
    this.returnCount = 0;
    this.lastShotQuality = null;
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
    this.playTicks = 75; referee.call('プレイッ', 75);
  }
  startService() {
    sound.play('hit');
    this.servicePending = true; this.netTouched = false;
  }
  serviceIn() {
    const left = this.serviceTargetX < 128;
    return this.x + this.radius >= (left ? 36 : 128) && this.x - this.radius <= (left ? 128 : 220) &&
      (match.server === 'player' ? this.y + this.radius >= 84 && this.y - this.radius <= 120 : this.y + this.radius >= 120 && this.y - this.radius <= 166);
  }
  fault() {
    if (this.resetTimer) return;
    this.servicePending = false; this.serveWaiting = this.serving = this.cpuServing = false;
    match.faults++;
    const text = match.faults >= 2 ? 'Wフォルト' : 'フォルト';
    referee.call(text); this.message = text; this.resetTimer = 90;
    if (match.faults >= 2) match.award(match.server === 'player' ? 'cpu' : 'player');
    if (!match.winner) sound.tune('sad');
  }
  recordReturn() {
    this.rallyHits++;
    this.returnCount = this.rallyHits;
  }
  launch(targetX, targetY, ticks, gravity = SETTINGS.gravity) {
    this.nextBounceFactor = null; this.nextBounceMaxVz=null; this.wasCurveShot=false;this.erinSmashOpening=false;this.erinOpeningSmash=false;this.erinRecoveryMiss=false; this.erinSuper=false; this.bodyAim=false; this.guaranteedWinner=null;
    this.curve = 0;
    this.curveTicks = 0;
    this.netTouched = false;
    this.gravity = gravity;
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
  launchFromPlayer(player, racket, quality, counterQuality = quality) {
    sound.play('hit');
    if(referee.text==='・・・'){referee.text='';referee.ticks=0;}
    const contact = Math.max(-1, Math.min(1,
      (this.x - racket.x) / Math.max(1, racket.hitRadius)));
    // 押している横方向を優先。無入力なら、フォア／バックの打球コマで打ち分ける。
    const movementAim = Math.max(-1, Math.min(1, player.vx / SETTINGS.dashImpulse));
    const timingAim = !player.lobShot ? (player.getShotPhase()?.aim ?? 0) : 0;
    const heldAim = input.horizontalAim || player.swingAim || 0;
    const aimOffset = heldAim ? heldAim * (player.shotType === 'smash' ? 78 : 64) + contact * 8 : timingAim * 52 + contact * 20 + movementAim * 12;
    let targetX = Math.max(39, Math.min(217, 128 + aimOffset));
    const targetY = player.lobShot ? 50 : 60;
    // CPUスマッシュへの返球はプレイヤー側の打点タイミングで難度を付ける。
    const counteringSmash = player.incomingWasSmash === true;
    const serveReception = this.lastHitter === 'cpu' && this.rallyHits === 0;
    if (serveReception && player.shotType === 'smash') quality = counterQuality = 'normal';
    const profile = player.lobShot
      ? { ticks: 78, gravity: 0.095 }
      : counteringSmash
      ? (counterQuality === 'critical'
          ? { ticks: 30, gravity: 0.160 }
          : counterQuality === 'float'
            ? (campaign.stage===3 ? { ticks: 62, gravity: 0.105 } : { ticks: 48, gravity: 0.065 })
            : { ticks: 45, gravity: 0.100 })
      : (SHOT_PROFILES[quality] ?? SHOT_PROFILES.normal);
    this.lastHitter = 'player';
    this.lastShotQuality = player.lobShot ? 'lob' : quality;
    this.bouncesInCurrentCourt = 0;
    this.recordReturn();
    let curve = 0, curveTicks = 0;
    const dashDirection = player.swingDashDirection || (player.isDashing ? player.dashDirection : null);
    if (!player.lobShot && ['left','right'].includes(dashDirection) && ['forehand', 'backhand'].includes(player.shotType)) {
      // Right-dash forehand bends left; left-dash backhand bends right.
      // The two opposite-hand combinations retain their existing directions.
      const dir = dashDirection === 'right' ? -1 : 1;
      curve = dir * SETTINGS.curveAcceleration;
      curveTicks = SETTINGS.curveTicks;
      targetX = Math.max(54, Math.min(202, targetX));
    }
    // 通常・ジャストのカウンターは、前後の位置に合わせてネット通過高さを補う。
    const fraction = (this.y - 120) / (this.y - targetY);
    const clearanceGravity = counteringSmash && counterQuality !== 'float' && fraction > 0 && fraction < 1
      ? Math.max(0, (18 - this.z * (1 - fraction)) / (0.5 * profile.ticks * profile.ticks * fraction * (1 - fraction)))
      : 0;
    if(curveTicks || campaign.stage===3&&(player.lobShot||counteringSmash))
      launchOverNet(this,targetX,targetY,profile.ticks,Math.max(profile.gravity,clearanceGravity));
    else this.launch(targetX, targetY, profile.ticks, Math.max(profile.gravity, clearanceGravity));
    if(curveTicks){
      // Compensate acceleration so the arc lands on its intended target.
      // Cap the bow to 24 world units, avoiding extreme sideways excursions.
      const ticks=profile.ticks;
      let acceleration=curve,velocity=0,displacement=0;
      const offsets=[];
      for(let n=0;n<ticks;n++){
        if(n<curveTicks){velocity+=acceleration;acceleration*=.985;}
        displacement+=velocity;offsets.push(displacement);
      }
      let bow=0;
      for(let n=0;n<ticks;n++)bow=Math.max(bow,Math.abs(offsets[n]-displacement*(n+1)/ticks));
      const scale=Math.min(1,24/Math.max(1,bow));
      curve*=scale;this.vx-=displacement*scale/ticks;
    }
    this.curve = curve;
    this.curveTicks = curveTicks;
    this.wasCurveShot=curveTicks>0;
    this.message = player.lobShot ? 'ロブ' : counteringSmash && counterQuality === 'critical' ? 'スマッシュをカウンター' :
      counteringSmash && counterQuality === 'float' ? 'スマッシュに押された' :
      player.shotType === 'smash' ? 'スマッシュ' :
      this.curveTicks ? 'ダッシュカーブ' : quality === 'critical' ? 'クリティカル' :
      quality === 'float' ? '浮き球' : 'ナイスショット';
  }
  resetPlayerServe() {
    this.serveDashDirection = null;
    this.servePhase = 'waiting';
    this.serveWaiting = true;
    this.serving = false;
    this.servePrepareTicks = 0;
    this.vx = this.vy = this.vz = 0;
    this.message = '1回押すと構え→トス';
  }
  beginServePreparation() {
    this.serveDashDirection = null;
    this.serviceTargetX=serveAimX(player);
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
    const serveQuality = player.getHitQuality();
    if (serveQuality === 'serve_fast' || serveQuality === 'serve_safe') {
      const r = player.getRacketPosition();
      if (Math.hypot(this.x - r.x, this.y - r.y) < r.hitRadius &&
          Math.abs(this.z - r.z) < r.hitHeight) {
        player.hasHit = true;
        this.serving = false;
        this.serveWaiting = false;
        this.servePhase = 'rally';
        this.lastHitter = 'player';
        this.bouncesInCurrentCourt = 0;
        const profile = SERVE_PROFILES[serveQuality];
        // トスの位置を固定したまま、ラケット面の左右の当たり方でコースを調整。
        const contact = Math.max(-1, Math.min(1, (this.x - r.x) / r.hitRadius));
        this.serviceTargetX = Math.max(96, Math.min(160, this.serviceTargetX + contact * 24));
        const dashCurve = player.isDashing && this.serveDashDirection === player.dashDirection &&
          ['left', 'right'].includes(this.serveDashDirection);
        if (dashCurve) {
          // サービスエリアの内側を狙い、カーブの横ずれを初速で補正する。
          this.serviceTargetX = this.serviceTargetX < 128 ? Math.min(116, this.serviceTargetX) : Math.max(140, this.serviceTargetX);
          launchOverNet(this, this.serviceTargetX, 102, profile.ticks, profile.gravity);
          this.curve = (this.serveDashDirection === 'right' ? 1 : -1) * SETTINGS.curveAcceleration;
          this.curveTicks = SETTINGS.curveTicks;
          let acceleration = this.curve, displacement = 0;
          for (let n = 0; n < Math.min(this.curveTicks, profile.ticks); n++) {
            displacement += acceleration * (profile.ticks - n);
            acceleration *= 0.985;
          }
          this.vx -= displacement / profile.ticks;
          this.wasCurveShot = true;
        } else if(campaign.stage===3)launchOverNet(this,this.serviceTargetX,102,profile.ticks,profile.gravity);
        else this.launch(this.serviceTargetX,102,profile.ticks,profile.gravity);
        this.startService();
        this.message = serveQuality === 'serve_fast' ? '速いサーブネット注意' : '安定サーブ';
        return;
      }
    }
    if (this.z <= 0) {
      this.z = 0;
      this.fault();
    }
  }
  endRally(message, winner = null) {
    if (this.resetTimer || match.winner) return;
    this.servicePending = false;
    this.message = message;
    referee.call(['取り逃し', '2バウンド'].includes(message) ? 'インッ' : 'アウト');
    if (winner) match.award(winner);
    if (!match.winner) sound.tune(['取り逃し', '2バウンド'].includes(message) ? 'in' : 'sad');
    this.resetTimer = Math.max(90, match.boardTicks);
  }
  update(player, opponent) {
    if (match.winner) return;
    if (this.resetTimer) {
      if (--this.resetTimer === 0) {
        input.cancel();
        Object.assign(player, new SealPlayer(128, match.server === 'player' ? 206 : 180));
        player.cancelVersion = input.cancelVersion;
        opponent?.reset();
        this.resetServe();
        player.x = 120;
        if (opponent) { opponent.x=128;opponent.targetX=128; }
      }
      return;
    }
    if (this.playTicks > 0) return;
    if (this.serveWaiting || this.serving) { this.updatePlayerServe(player); return; }
    if (this.cpuServing) { opponent.updateServe(this); return; }
    const oldY = this.y, oldZ = this.z;
    if (this.curveTicks > 0) {
      this.vx += this.curve;
      this.curve *= 0.985;
      this.curveTicks--;
    } else this.curve = 0;
    this.x += this.vx; this.y += this.vy;
    this.z += this.vz; this.vz -= this.gravity;
    const crossing = (oldY < 120 && this.y >= 120) || (oldY > 120 && this.y <= 120);
    if (crossing) {
      const fraction = (120 - oldY) / (this.y - oldY);
      const crossingHeight = oldZ + (this.z - oldZ) * fraction;
      // 上端に触れた球は減速して続行。低い接触は自分側へ落ちる。
      const netHeight = campaign.stage === 3 ? 27/projectCourt(128,120).scale : campaign.stage === 2 ? 25 / projectCourt(128, 120).scale : 12;
      if (crossingHeight - this.radius < netHeight && !this.netTouched) {
        this.hitNet = true; this.netTouched = true;
        sound.play('net');
        // 得失点とサーブのワンモアは着地で判定する。
        if (crossingHeight >= netHeight - 2) { this.vx *= 0.6; this.vy *= 0.6; this.vz *= 0.55; }
        else { this.vx *= 0.65; this.y = oldY < 120 ? 119 : 121; this.vy *= -0.12; this.vz = Math.min(this.vz, 0); }
      }
      this.bouncesInCurrentCourt = 0;
    }
    if (this.z <= 0 && oldZ > 0) {
      sound.play('bounce');
      this.z = 0;
      if (this.servicePending) {
        if (!this.serviceIn() || !this.isOnReceiverSide()) { this.fault(); return; }
        if (this.netTouched) {
          referee.call('ワンモア'); this.message = 'ワンモア';
          this.servicePending = false; this.resetTimer = 90; return;
        }
        this.servicePending = false; match.faults = 0;
      }
      if(this.guaranteedWinner&&this.isOnReceiverSide()&&this.isInsideCourt()){this.endRally('取り逃し',this.guaranteedWinner);return;}
      if (this.bouncesInCurrentCourt === 0 && (!this.isInsideCourt() || !this.isOnReceiverSide())) {
        this.endRally(this.netTouched && !this.isOnReceiverSide() ? 'ネット' : 'アウト', this.lastHitter === 'player' ? 'cpu' : 'player'); return;
      }
      if (referee.text === '・・・') { referee.text = ''; referee.ticks = 0; }
      this.vz *= -(this.nextBounceFactor ?? Math.abs(this.bounce));
      if(this.nextBounceMaxVz!==null&&this.nextBounceMaxVz!==undefined)this.vz=Math.min(this.vz,this.nextBounceMaxVz);
      this.nextBounceFactor = null; this.nextBounceMaxVz=null; this.gravity = SETTINGS.gravity;
      this.bouncesInCurrentCourt++;
      if (this.bouncesInCurrentCourt >= 2) { this.endRally('2バウンド', this.lastHitter); return; }
    }
    const quality = player.getHitQuality();
    if (quality && this.lastHitter === 'cpu' && this.y > 120) {
      const r = player.getRacketPosition();
      const distance = Math.hypot(this.x - r.x, this.y - r.y);
      if (distance < r.hitRadius && Math.abs(this.z - r.z) < r.hitHeight) {
        const superCounter=this.erinSuper;
        const openingSmash=campaign.stage===3&&this.erinSmashOpening&&quality==='smash'&&!player.lobShot;
        if (this.servicePending) { this.endRally('サーブはバウンド後', 'cpu'); return; }
        player.hasHit = true;
        // 狙い撃ちスマッシュは芯とタイミングの両方が必要。判定範囲はロブも通常と同じ。
        const solidContact=(quality==='critical'||quality==='smash')&&distance<r.hitRadius*.7&&Math.abs(this.z-r.z)<r.hitHeight*.7;
        const counteringSmash = this.lastShotQuality === 'smash';
        const volley = ['forehand', 'backhand'].includes(player.shotType) && !player.lobShot;
        const fifthFrameFloat = volley && counteringSmash && player.getShotPhase()?.smashFloat === true;
        const bodyMiss = !volley && campaign.stage === 3 && this.bodyAim && !player.lobShot && !solidContact;
        const counterQuality = fifthFrameFloat || bodyMiss ? 'float' : quality;
        this.bouncesInCurrentCourt = 0;
        player.incomingWasSmash = counteringSmash;
        this.launchFromPlayer(player, r, counterQuality, counterQuality);
        if(superCounter){launchOverNet(this,128,58,40,.13);this.guaranteedWinner='player';}
        else if(openingSmash){
          const miss=Math.random()<.30;
          launchOverNet(this,128,58,30,.16);this.erinRecoveryMiss=miss;this.erinOpeningSmash=true;
        }
        player.incomingWasSmash = false;
        player.incomingCounterQuality = null;
      }
    }
    if (opponent?.canHit(this)) {
      if (this.servicePending) { this.endRally('サーブはバウンド後', 'player'); return; }
      opponent.hit(this);
    }
    if (this.y > CANVAS_HEIGHT + 10 || this.y < -30 || this.x < -20 || this.x > CANVAS_WIDTH + 20) {
      // ラインのアウト判定は省略。相手側へ抜けた球を取り逃しとして扱う。
      const winner = this.y < 0 ? 'player' : this.y > CANVAS_HEIGHT ? 'cpu' :
        this.lastHitter === 'player' ? 'cpu' : 'player';
      if (this.servicePending) this.fault();
      else this.endRally(this.bouncesInCurrentCourt > 0 ? '取り逃し' : 'アウト', this.bouncesInCurrentCourt > 0 ? this.lastHitter : (this.lastHitter === 'player' ? 'cpu' : 'player'));
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

// 表示だけを512×640へ投影。移動・打球の計算座標は従来の256×240を維持。
const VIEW = { width: 512, height: 640 };
// 各ステージ画像はコートとネットを含む完成背景。
const sceneImages = {};
const sceneLoadErrors = new Set();
for (const name of ['background']) {
  const image = new Image();
  image.onerror = () => { sceneLoadErrors.add(name); };
  image.onload = () => { sceneLoadErrors.delete(name); };
  image.src = assetUrl(`${name}.png`);
  sceneImages[name] = image;
}
// 背景のシングルスラインとネットの接地位置へ計算座標を投影する。
const STAGE_COURTS = {
  1: { rows: [[46,226],[84,277],[120,389],[166,485],[204,578]], left: [143,89], right: [370,429], net: [83,364,347,28] },
  2: { rows: [[46,225],[84,277],[120,390],[166,486],[204,578]], left: [144,85], right: [369,428], net: [83,365,348,25] },
  3: { rows: [[46,242],[84,286],[120,390],[166,475],[204,557]], left: [144,89], right: [368,423], net: [86,363,338,31] }
};
const stage2Image = new Image(); stage2Image.src = assetUrl('stage2.png');
const stage3Image = new Image();stage3Image.src = assetUrl('stage3.png');
const continueImage = new Image();continueImage.src = assetUrl('contenu.png');
function projectCourt(x, y) {
  const court = STAGE_COURTS[campaign.stage], rows = court.rows;
  let i = 0;
  while (i < rows.length - 2 && y > rows[i + 1][0]) i++;
  const [wa,sa] = rows[i], [wb,sb] = rows[i + 1];
  const sy = sa + (y - wa) / (wb - wa) * (sb - sa);
  const t = (sy - rows[0][1]) / (rows[rows.length - 1][1] - rows[0][1]);
  const left = court.left[0] + (court.left[1] - court.left[0]) * t;
  const right = court.right[0] + (court.right[1] - court.right[0]) * t;
  const scale = (right - left) / 184;
  return { x: left + (x - 36) * scale, y: sy, scale };
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
  const image = campaign.stage === 1 ? sceneImages.background : campaign.stage === 2 ? stage2Image : stage3Image;
  const [x,y,width,height] = STAGE_COURTS[campaign.stage].net;
  // 背景内ネットを前景に重ね、奥側の球・人物との前後関係を保つ。
  if (imageReady(image)) context.drawImage(image,x,y,width,height,x,y,width,height);
}
function drawScene(context) {
  context.fillStyle = '#10171a'; context.fillRect(0,0,VIEW.width,VIEW.height);
  if(campaign.stage===3&&imageReady(stage3Image))context.drawImage(stage3Image,0,0,512,640);
  if (campaign.stage === 2 && imageReady(stage2Image)) context.drawImage(stage2Image,0,0,512,640);
  if (campaign.stage === 1 && imageReady(sceneImages.background)) context.drawImage(sceneImages.background,0,0,VIEW.width,VIEW.height);
  if(screen.phase==='continue'){drawContinue(context);return;}
  drawProjected(context,cpu,cpu.x,cpu.y);
  if(ball.y < 120) drawProjected(context,ball,ball.x,ball.y);
  drawProjectedNet(context);
  drawProjected(context,player,player.x+8,player.y+6);
  if(ball.y >= 120) drawProjected(context,ball,ball.x,ball.y);
  referee.draw(context);
  drawScoreboard(context);
  if (match.winner && screen.phase !== 'continue') {
    const image = judgeImages[match.winner === 'player' ? 'win' : 'lose'];
    if (imageReady(image)) {
      const width = 486, height = width * image.naturalHeight / image.naturalWidth;
      context.drawImage(image, (VIEW.width - width) / 2, (VIEW.height - height) / 2, width, height);
    }
  }
  if (sceneLoadErrors.size) {
    context.fillStyle = '#600'; context.fillRect(0,0,512,32);
    context.fillStyle = '#fff'; context.font = '14px sans-serif';
    context.fillText('画像を読めません: ' + [...sceneLoadErrors].join(', ') + '（assetsを確認）',8,22);
  }
}

function drawContinue(context){
  context.save();context.imageSmoothingEnabled=false;
  if(imageReady(continueImage))context.drawImage(continueImage,76,304,113,145);
  context.fillStyle='#ff4b00';context.textAlign='center';context.textBaseline='alphabetic';
  context.font='36px sans-serif';context.fillText('コンテニュー？',338,335);
  context.font='96px serif';context.fillText(String(Math.ceil(screen.ticks/60)),342,443);
  context.restore();
}
function drawScoreboard(context) {
  if (match.winner || !(ball.resetTimer || ball.playTicks || match.boardTicks)) return;
  context.save(); context.fillStyle = '#ffa500'; context.fillRect(176, 344, 160, 72);
  context.fillStyle = '#fff'; context.textAlign = 'center'; context.font = 'bold 11px sans-serif';
  context.fillText('YOU', 214, 359); context.fillText('COM', 298, 359);
  if (match.boardTicks > 0 && referee.text === 'GAME') {
    for (const [side, x] of [['player', 190], ['cpu', 280]]) {
      for (let i = 0; i < 3; i++) {
        context.fillStyle = i < match.games[side] ? '#ff3030' : '#fff';
        context.beginPath(); context.arc(x + i * 22, 389, 7, 0, Math.PI * 2); context.fill();
      }
    }
  } else {
    let labels = ['00', '15', '30', '40'];
    let left = labels[Math.min(3, score.player)], right = labels[Math.min(3, score.cpu)];
    if (score.player >= 3 && score.cpu >= 3 && score.player !== score.cpu) {
      left = score.player > score.cpu ? 'AD' : '40'; right = score.cpu > score.player ? 'AD' : '40';
    }
    context.font = 'bold 34px sans-serif'; context.fillText(left, 214, 400); context.fillText(right, 298, 400);
    context.font = 'bold 24px sans-serif'; context.fillText('-', 256, 397);
  }
  context.restore();
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
let cpu = createOpponent();
cpu.x = 128; cpu.targetX = 128;
const clock = new FixedClock(() => {
  if (screen.phase === 'ending-win') { input.cancel(); if (--screen.ticks === 0) beginEnding(); return; }
  if (screen.phase === 'ending') { input.cancel(); screen.ticks++; endingMusic.sync(); return; }
  if (screen.phase === 'title' || screen.phase === 'stage-choice') { input.cancel(); return; }
  if (screen.phase === 'stage-reveal') { input.cancel(); if (--screen.ticks === 0) screen.phase = 'stage-choice'; return; }
  if (screen.phase === 'confirming') {
    input.cancel(); if (--screen.ticks === 0) beginStageIntro(); return;
  }
  if(screen.phase==='intro'){input.cancel();if(--screen.ticks===0){resetPractice();canvas.setAttribute('aria-label','アザラシテニス');}return;}
  if (screen.phase === 'starting') {
    input.cancel(); referee.update(); screen.ticks--;
    if (screen.ticks === 60) referee.call('プレイッ', 60);
    if (screen.ticks === 0) { screen.phase = 'playing'; referee.text = ''; referee.ticks = 0; }
    return;
  }
  if(screen.phase==='gameover'){
    input.cancel();if(--screen.ticks===0){screen.phase='continue';screen.ticks=300;}return;
  }
  if(screen.phase==='continue'){
    input.cancel();if(--screen.ticks===0)returnToOpening();return;
  }
  referee.update(); if (match.boardTicks > 0) match.boardTicks--;
  if (match.winner) {
    if (campaign.transitionTicks > 0 && --campaign.transitionTicks === 0) { campaign.stage++; cpu = createOpponent(); beginStageIntro(); }
    return;
  }
  if (ball.playTicks > 0 && !ball.resetTimer) {
    input.cancel(); ball.playTicks--; return;
  }
  if (!ball.resetTimer) { player.update(input, ball); cpu.update(ball); }
  ball.update(player, cpu);
});
let paused = false;
function toggleServePractice() {
  practiceMode = practiceMode === 'serve' ? 'rally' : 'serve';
  resetPractice();
}
function resetPractice() {
  endingMusic.reset();
  screen.phase = 'starting'; screen.ticks = 120;
  document.getElementById('game-container').dataset.screen = 'playing';
  input.cancel();
  Object.assign(player, new SealPlayer(CANVAS_WIDTH / 2 - 8, 180));
  player.cancelVersion = input.cancelVersion;
  match.reset(practiceMode === 'serve' ? 'player' : 'cpu');
  cpu.reset();
  ball.returnCount = 0;
  ball.resetServe();
  player.x = 120;
  cpu.x = 128; cpu.targetX = 128;
  if (practiceMode === 'serve') {
    player.y = 206;
    player.selectShot(ball);
    ball.updatePlayerServe(player);
  }
  ball.playTicks = 0; match.boardTicks = 0; referee.text = ''; referee.ticks = 0;
  clock.reset();
}
function returnToOpening() {
  endingMusic.reset();
  input.cancel();campaign.transitionTicks=0;match.reset('cpu');cpu.reset();ball.resetServe();
  screen.phase='title';screen.ticks=0;referee.text='';referee.ticks=0;
  document.getElementById('game-container').dataset.screen='title';
  stageMenu.sequence=[];stageMenu.selected=1;campaign.selectedStage=1;
  canvas.setAttribute('role','button');canvas.setAttribute('aria-label','push to play');clock.reset();
}
function startOpening() {
  if (screen.phase !== 'title') return;
  stageMenu.sequence=[];
  campaign.stage=campaign.selectedStage;campaign.transitionTicks=0;cpu=createOpponent();
  sound.unlock(); sound.tune('start');
  screen.phase = 'confirming'; screen.ticks = 72;
  canvas.removeAttribute('role'); canvas.setAttribute('aria-label', 'アザラシテニス');
}
canvas.setAttribute('role', 'button'); canvas.setAttribute('aria-label', 'push to play'); canvas.tabIndex = 0;
canvas.addEventListener('click', event => {
  if (screen.phase === 'title' || screen.phase === 'ending') { menuShot(); return; }
  if (screen.phase !== 'stage-choice') return;
  const bounds=canvas.getBoundingClientRect();
  const x=(event.clientX-bounds.left)*512/bounds.width, y=(event.clientY-bounds.top)*640/bounds.height;
  if (y>=218 && y<=380) {
    const column=[[97,184],[212,299],[327,414]].findIndex(([left,right])=>x>=left&&x<=right);
    if(column>=0){stageMenu.selected=column+1;updateStageMenuLabel();}
  }
});
window.addEventListener('keydown', event => {
  if (!MENU_PHASES.includes(screen.phase)) return;
  const directions={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};
  if (directions[event.code] || ['Enter','Space','KeyZ'].includes(event.code)) {
    event.preventDefault(); event.stopImmediatePropagation();
    if(event.repeat)return;
    if(directions[event.code])menuDirection(directions[event.code]);else menuShot();
  }
}, { capture: true });
window.addEventListener('blur', () => { paused = true; endingMusic.pause(); clock.reset(); });
window.addEventListener('focus', () => { paused = document.hidden; endingMusic.sync(); clock.reset(); });
document.addEventListener('visibilitychange', () => {
  paused = document.hidden || !document.hasFocus();
  endingMusic.sync(); clock.reset();
});
document.getElementById('sound-toggle')?.addEventListener('click', () => sound.toggle());
function resetCampaign() { campaign.stage = campaign.selectedStage; campaign.transitionTicks = 0; cpu = createOpponent(); resetPractice(); }
document.getElementById('restart')?.addEventListener('click', resetCampaign);
document.getElementById('serve-mode')?.addEventListener('click', toggleServePractice);
document.getElementById('guide-toggle')?.addEventListener('click', () => { showGuide = !showGuide; });
window.addEventListener('pagehide', () => { input.cancel(); endingMusic.pause(); clock.reset(); });
function gameLoop(now) {
  if (!paused && !document.hidden) clock.advance(now);
  ctx.imageSmoothingEnabled = false;
  if(screen.phase==='ending')drawEnding(ctx);else if(screen.phase==='stage-reveal')drawStageReveal(ctx,now);else if(screen.phase==='stage-choice')drawStageChoice(ctx,now);else if (screen.phase === 'title' || screen.phase === 'confirming') drawOpening(ctx, now); else if(screen.phase==='intro')drawStageIntro(ctx); else drawScene(ctx);
  const guideButton = document.getElementById('guide-toggle');
  guideButton?.setAttribute('aria-pressed', String(showGuide));
  const modeButton = document.getElementById('serve-mode');
  if (modeButton) modeButton.textContent = practiceMode === 'serve' ? 'CPUサーブへ' : '自分のサーブへ';
  if (status) status.textContent = paused ? '一時停止' : '';
  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);


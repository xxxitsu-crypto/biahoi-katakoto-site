// 画面定数
const CANVAS_WIDTH = 256;
const CANVAS_HEIGHT = 240;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// 入力状態管理
const keys = {
  up: false,
  down: false,
  left: false,
  right: false,
  action: false
};

// 入力イベントリスナー (キーボード)
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') keys.up = true;
  if (e.key === 'ArrowDown') keys.down = true;
  if (e.key === 'ArrowLeft') keys.left = true;
  if (e.key === 'ArrowRight') keys.right = true;
  if (e.key === 'z' || e.key === 'Z' || e.key === ' ') keys.action = true;
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowUp') keys.up = false;
  if (e.key === 'ArrowDown') keys.down = false;
  if (e.key === 'ArrowLeft') keys.left = false;
  if (e.key === 'ArrowRight') keys.right = false;
  if (e.key === 'z' || e.key === 'Z' || e.key === ' ') keys.action = false;
});

// 入力イベントリスナー (モバイルタッチ)
const bindTouch = (id, keyName) => {
  const elem = document.getElementById(id);
  const press = (e) => { e.preventDefault(); keys[keyName] = true; };
  const release = (e) => { e.preventDefault(); keys[keyName] = false; };
  elem.addEventListener('touchstart', press);
  elem.addEventListener('touchend', release);
  elem.addEventListener('mousedown', press);
  elem.addEventListener('mouseup', release);
};

bindTouch('btn-up', 'up');
bindTouch('btn-down', 'down');
bindTouch('btn-left', 'left');
bindTouch('btn-right', 'right');
bindTouch('btn-action', 'action');

// プレイヤー（アザラシ）クラス: もどかしい慣性を実装
class SealPlayer {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.width = 16;
    this.height = 12;
    // 慣性パラメータ: 加速度は鈍く、摩擦で滑る
    this.accel = 0.08;
    this.friction = 0.94;
    this.maxSpeed = 1.2;
    this.isSwinging = false;
    this.swingTimer = 0;
  }

  update() {
    let ax = 0;
    let ay = 0;

    if (keys.left) ax -= this.accel;
    if (keys.right) ax += this.accel;
    if (keys.up) ay -= this.accel;
    if (keys.down) ay += this.accel;

    // 速度更新
    this.vx = (this.vx + ax) * this.friction;
    this.vy = (this.vy + ay) * this.friction;

    // 速度制限
    this.vx = Math.max(-this.maxSpeed, Math.min(this.maxSpeed, this.vx));
    this.vy = Math.max(-this.maxSpeed, Math.min(this.maxSpeed, this.vy));

    this.x += this.vx;
    this.y += this.vy;

    // コート外移動制限 (手前側半面)
    this.x = Math.max(20, Math.min(CANVAS_WIDTH - 20 - this.width, this.x));
    this.y = Math.max(130, Math.min(220 - this.height, this.y));

    // スイング制御
    if (keys.action && !this.isSwinging) {
      this.isSwinging = true;
      this.swingTimer = 15; // 15フレーム持続
    }

    if (this.isSwinging) {
      this.swingTimer--;
      if (this.swingTimer <= 0) {
        this.isSwinging = false;
      }
    }
  }

  draw(context) {
    context.fillStyle = this.isSwinging ? '#fff' : '#68c2d3';
    // 仮描画: アザラシ胴体（横長矩形）
    context.fillRect(Math.floor(this.x), Math.floor(this.y), this.width, this.height);

    // スイング当たり判定の可視化
    if (this.isSwinging) {
      context.strokeStyle = '#ffff00';
      context.strokeRect(this.x - 4, this.y - 4, this.width + 8, this.height + 8);
    }
  }
}

// 疑似3Dボールクラス (X, Y平面 + Z高さ)
class Ball {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = CANVAS_WIDTH / 2;
    this.y = 70;
    this.z = 20; // 地面からの高さ
    this.vx = (Math.random() - 0.5) * 0.8;
    this.vy = 1.2;
    this.vz = 0;
    this.gravity = 0.1;
    this.bounce = -0.75;
    this.radius = 3;
    this.bounceCount = 0;
  }

  update(player) {
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    this.vz -= this.gravity;

    // 地面バウンド判定
    if (this.z <= 0) {
      this.z = 0;
      this.vz = this.vz * this.bounce;
      if (Math.abs(this.vz) < 0.3) this.vz = 0;
      this.bounceCount++;
    }

    // プレイヤーのスイングによるヒット判定
    if (player.isSwinging) {
      const dx = (this.x) - (player.x + player.width / 2);
      const dy = (this.y) - (player.y + player.height / 2);
      const dist = Math.hypot(dx, dy);

      // 一定距離内かつ、ボールが低い位置（Z < 15）にある時に打てる
      if (dist < 18 && this.z < 15 && this.vy > 0) {
        this.vy = -1.8;
        this.vx = dx * 0.15;
        this.vz = 2.2; // 打ち返す際に上向きの初速を付与
        this.bounceCount = 0;
      }
    }

    // 壁・奥での折り返し (仮の簡易CPU返球挙動)
    if (this.y < 50) {
      this.vy = 1.2;
      this.vz = 1.8;
      this.bounceCount = 0;
    }

    // アウト判定（手前の境界を超えて2バウンド以上でリセット）
    if (this.y > 230 || this.bounceCount >= 2) {
      this.reset();
    }
  }

  draw(context) {
    // 影（地面座標）
    context.fillStyle = 'rgba(0, 0, 0, 0.4)';
    context.beginPath();
    context.ellipse(this.x, this.y, this.radius, this.radius * 0.5, 0, 0, Math.PI * 2);
    context.fill();

    // ボール本体（地面座標 - 高さZ）
    context.fillStyle = '#ffff55';
    context.beginPath();
    context.arc(this.x, this.y - this.z, this.radius, 0, Math.PI * 2);
    context.fill();
  }
}

// コート描画関数
function drawCourt(context) {
  // コートベース（緑）
  context.fillStyle = '#008800';
  context.fillRect(28, 40, 200, 170);

  // 白線
  context.strokeStyle = '#ffffff';
  context.lineWidth = 1;
  context.strokeRect(36, 48, 184, 154);

  // ネット
  context.strokeStyle = '#dddddd';
  context.beginPath();
  context.moveTo(24, 120);
  context.lineTo(232, 120);
  context.stroke();
}

// 初期化
const player = new SealPlayer(CANVAS_WIDTH / 2 - 8, 180);
const ball = new Ball();

// メインゲームループ (60fps固定更新)
function gameLoop() {
  // 更新
  player.update();
  ball.update(player);

  // 描画
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  drawCourt(ctx);
  ball.draw(ctx);
  player.draw(ctx);

  requestAnimationFrame(gameLoop);
}

// ループ開始
requestAnimationFrame(gameLoop);

// 画面定数
const CANVAS_WIDTH = 256;
const CANVAS_HEIGHT = 240;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// 入力バッファとタップ検知管理
class InputHandler {
  constructor() {
    this.action = false;
    this.taps = {
      up: { count: 0, lastTime: 0, pressed: false },
      down: { count: 0, lastTime: 0, pressed: false },
      left: { count: 0, lastTime: 0, pressed: false },
      right: { count: 0, lastTime: 0, pressed: false }
    };
    this.consumeQueue = [];
    this.initKeyboard();
    this.initTouch();
  }

  registerPress(direction) {
    const now = performance.now();
    const entry = this.taps[direction];

    if (entry.pressed) return; // 押しっぱなし防止
    entry.pressed = true;

    // 400ms以内の連続入力を判定
    if (now - entry.lastTime < 400) {
      entry.count++;
    } else {
      entry.count = 1;
    }
    entry.lastTime = now;

    const isTripleTap = (entry.count >= 3);
    if (isTripleTap) {
      entry.count = 0; // トリプル発動でカウントリセット
    }

    this.consumeQueue.push({ direction, isTripleTap });
  }

  registerRelease(direction) {
    if (this.taps[direction]) {
      this.taps[direction].pressed = false;
    }
  }

  initKeyboard() {
    const keyMap = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right'
    };

    window.addEventListener('keydown', (e) => {
      if (keyMap[e.key]) {
        e.preventDefault();
        this.registerPress(keyMap[e.key]);
      }
      if (e.key === 'z' || e.key === 'Z' || e.key === ' ') {
        e.preventDefault();
        this.action = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      if (keyMap[e.key]) {
        this.registerRelease(keyMap[e.key]);
      }
      if (e.key === 'z' || e.key === 'Z' || e.key === ' ') {
        this.action = false;
      }
    });
  }

  initTouch() {
    const map = [
      { id: 'btn-up', dir: 'up' },
      { id: 'btn-down', dir: 'down' },
      { id: 'btn-left', dir: 'left' },
      { id: 'btn-right', dir: 'right' }
    ];

    map.forEach(({ id, dir }) => {
      const elem = document.getElementById(id);
      if (!elem) return;

      const handlePress = (e) => {
        e.preventDefault();
        this.registerPress(dir);
      };
      const handleRelease = (e) => {
        e.preventDefault();
        this.registerRelease(dir);
      };

      elem.addEventListener('touchstart', handlePress, { passive: false });
      elem.addEventListener('touchend', handleRelease, { passive: false });
      elem.addEventListener('mousedown', handlePress);
      elem.addEventListener('mouseup', handleRelease);
      elem.addEventListener('mouseleave', handleRelease);
    });

    const actBtn = document.getElementById('btn-action');
    if (actBtn) {
      actBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.action = true; }, { passive: false });
      actBtn.addEventListener('touchend', (e) => { e.preventDefault(); this.action = false; }, { passive: false });
      actBtn.addEventListener('mousedown', () => { this.action = true; });
      actBtn.addEventListener('mouseup', () => { this.action = false; });
    }
  }

  popAction() {
    return this.consumeQueue.shift();
  }
}

// プレイヤー（アザラシ）
class SealPlayer {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.width = 16;
    this.height = 12;
    this.friction = 0.88; // 滑り感の減衰
    this.isSwinging = false;
    this.swingTimer = 0;
    this.isDashing = false;
  }

  update(input) {
    // 蓄積されたタップ入力を処理
    let action;
    while ((action = input.popAction())) {
      const { direction, isTripleTap } = action;
      
      // 移動インパルス（1回押し: ズリッ、3回押し: 跳躍ダッシュ）
      const stepSpeed = isTripleTap ? 3.6 : 1.4;

      if (isTripleTap) {
        this.isDashing = true;
      }

      if (direction === 'left') this.vx -= stepSpeed;
      if (direction === 'right') this.vx += stepSpeed;
      if (direction === 'up') this.vy -= stepSpeed * 0.8;
      if (direction === 'down') this.vy += stepSpeed * 0.8;
    }

    // 速度更新と慣性
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= this.friction;
    this.vy *= this.friction;

    if (Math.abs(this.vx) < 0.05) this.vx = 0;
    if (Math.abs(this.vy) < 0.05) {
      this.vy = 0;
      this.isDashing = false;
    }

    // コート外移動制限
    this.x = Math.max(20, Math.min(CANVAS_WIDTH - 20 - this.width, this.x));
    this.y = Math.max(128, Math.min(220 - this.height, this.y));

    // スイング制御
    if (input.action && !this.isSwinging) {
      this.isSwinging = true;
      this.swingTimer = 14;
    }

    if (this.isSwinging) {
      this.swingTimer--;
      if (this.swingTimer <= 0) {
        this.isSwinging = false;
      }
    }
  }

  draw(context) {
    // アザラシ本体描画（通常時：水色、ダッシュ/ジャンプ時：白寄り、スイング時：枠線点滅）
    context.fillStyle = this.isDashing ? '#d8f8ff' : '#68c2d3';
    context.fillRect(Math.floor(this.x), Math.floor(this.y), this.width, this.height);

    if (this.isSwinging) {
      context.strokeStyle = '#ffff00';
      context.lineWidth = 1;
      context.strokeRect(this.x - 3, this.y - 3, this.width + 6, this.height + 6);
    }
  }
}

// 疑似3Dボール
class Ball {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = CANVAS_WIDTH / 2;
    this.y = 60;
    this.z = 18;
    this.vx = (Math.random() - 0.5) * 0.5; // 水平拡散を抑えめ
    this.vy = 0.8;                         // 速度を全体的にマイルドに調整
    this.vz = 0;
    this.gravity = 0.06;                   // ふんわり跳ねる低重力
    this.bounce = -0.72;
    this.radius = 3;
    this.bounceCount = 0;
    this.isOut = false;
  }

  update(player) {
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    this.vz -= this.gravity;

    // 地面バウンド
    if (this.z <= 0) {
      this.z = 0;
      this.vz = this.vz * this.bounce;
      if (Math.abs(this.vz) < 0.2) this.vz = 0;
      this.bounceCount++;
    }

    // プレイヤー返球判定
    if (player.isSwinging && !this.isOut) {
      const dx = this.x - (player.x + player.width / 2);
      const dy = this.y - (player.y + player.height / 2);
      const dist = Math.hypot(dx, dy);

      // ヒット範囲内かつ適切な高さ
      if (dist < 20 && this.z < 18 && this.vy > 0) {
        this.vy = -1.2;          // 返球時の速度
        this.vx = dx * 0.12;     // 打球角度
        this.vz = 1.6;           // ふんわり返球
        this.bounceCount = 0;
      }
    }

    // 相手コート（奥側）での簡易返球
    if (this.y < 50 && this.vy < 0) {
      this.vy = 0.85;
      this.vz = 1.3;
      this.bounceCount = 0;
    }

    // 画面外フレームアウトの厳密判定（完全に外へ出てからリセット）
    if (this.y > CANVAS_HEIGHT + 10 || this.x < -10 || this.x > CANVAS_WIDTH + 10) {
      this.reset();
    }
  }

  draw(context) {
    // 影
    context.fillStyle = 'rgba(0, 0, 0, 0.45)';
    context.beginPath();
    context.ellipse(this.x, this.y, this.radius, this.radius * 0.5, 0, 0, Math.PI * 2);
    context.fill();

    // ボール本体
    context.fillStyle = '#ffff55';
    context.beginPath();
    context.arc(this.x, this.y - Math.max(0, this.z), this.radius, 0, Math.PI * 2);
    context.fill();
  }
}

// コート描画
function drawCourt(context) {
  context.fillStyle = '#008800';
  context.fillRect(28, 40, 200, 170);

  // 白線
  context.strokeStyle = '#ffffff';
  context.lineWidth = 1;
  context.strokeRect(36, 48, 184, 154);

  // ネット
  context.strokeStyle = '#eeeeee';
  context.beginPath();
  context.moveTo(24, 120);
  context.lineTo(232, 120);
  context.stroke();
}

// インスタンス化
const input = new InputHandler();
const player = new SealPlayer(CANVAS_WIDTH / 2 - 8, 180);
const ball = new Ball();

// メインループ
function gameLoop() {
  player.update(input);
  ball.update(player);

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  drawCourt(ctx);
  ball.draw(ctx);
  player.draw(ctx);

  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

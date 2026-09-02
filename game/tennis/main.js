const CANVAS_WIDTH = 256;
const CANVAS_HEIGHT = 240;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// 入力管理：リズム判定（たたん、たん）
class InputHandler {
  constructor() {
    this.action = false;
    this.history = {
      up: [],
      down: [],
      left: [],
      right: []
    };
    this.consumeQueue = [];
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
      const interval1 = h[1] - h[0]; // 1→2打目
      const interval2 = h[2] - h[1]; // 2→3打目

      // リズム定義: 「たたん(高速)」＋「たん(微タメ)」
      if (interval1 < 180 && interval2 >= 120 && interval2 <= 280) {
        isRhythmJump = true;
        this.history[dir] = []; // 発動後リセット
      }
    }

    this.consumeQueue.push({ dir, isRhythmJump });
  }

  initKeyboard() {
    const map = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right'
    };

    window.addEventListener('keydown', (e) => {
      if (map[e.key] && !e.repeat) {
        e.preventDefault();
        this.registerPress(map[e.key]);
      }
      if ((e.key === 'z' || e.key === 'Z' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        this.action = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'z' || e.key === 'Z' || e.key === ' ') {
        this.action = false;
      }
    });
  }

  initTouch() {
    const list = [
      { id: 'btn-up', dir: 'up' },
      { id: 'btn-down', dir: 'down' },
      { id: 'btn-left', dir: 'left' },
      { id: 'btn-right', dir: 'right' }
    ];

    list.forEach(({ id, dir }) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.registerPress(dir);
      }, { passive: false });
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.registerPress(dir);
      });
    });

    const act = document.getElementById('btn-action');
    if (act) {
      const trigger = (e) => { e.preventDefault(); this.action = true; };
      const stop = (e) => { e.preventDefault(); this.action = false; };
      act.addEventListener('touchstart', trigger, { passive: false });
      act.addEventListener('touchend', stop, { passive: false });
      act.addEventListener('mousedown', trigger);
      act.addEventListener('mouseup', stop);
    }
  }

  popAction() {
    return this.consumeQueue.shift();
  }
}

// プレイヤー
class SealPlayer {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.width = 16;
    this.height = 12;
    this.friction = 0.85;
    this.isSwinging = false;
    this.swingTimer = 0;
    this.isDashing = false;
  }

  // ラケットヘッドのワールド座標（身体の少し前方・右手側）
  getRacketPosition() {
    return {
      x: this.x + this.width + 4,
      y: this.y - 4,
      radius: 8
    };
  }

  update(input) {
    let act;
    while ((act = input.popAction())) {
      const { dir, isRhythmJump } = act;
      const speed = isRhythmJump ? 4.2 : 1.2;

      if (isRhythmJump) this.isDashing = true;

      if (dir === 'left') this.vx -= speed;
      if (dir === 'right') this.vx += speed;
      if (dir === 'up') this.vy -= speed * 0.7;
      if (dir === 'down') this.vy += speed * 0.7;
    }

    this.x += this.vx;
    this.y += this.vy;
    this.vx *= this.friction;
    this.vy *= this.friction;

    if (Math.abs(this.vx) < 0.05) this.vx = 0;
    if (Math.abs(this.vy) < 0.05) {
      this.vy = 0;
      this.isDashing = false;
    }

    // 手前コート移動制限（ネット手前まで）
    this.x = Math.max(24, Math.min(CANVAS_WIDTH - 24 - this.width, this.x));
    this.y = Math.max(130, Math.min(218 - this.height, this.y));

    if (input.action && !this.isSwinging) {
      this.isSwinging = true;
      this.swingTimer = 12; // 12フレーム有効
    }

    if (this.isSwinging) {
      this.swingTimer--;
      if (this.swingTimer <= 0) this.isSwinging = false;
    }
  }

  draw(context) {
    // 影
    context.fillStyle = 'rgba(0, 0, 0, 0.4)';
    context.fillRect(this.x, this.y + this.height - 2, this.width, 3);

    // アザラシ胴体
    context.fillStyle = this.isDashing ? '#e0ffff' : '#68c2d3';
    context.fillRect(Math.floor(this.x), Math.floor(this.y), this.width, this.height);

    // ラケット描画
    const r = this.getRacketPosition();
    context.strokeStyle = this.isSwinging ? '#ff4444' : '#ffffff';
    context.lineWidth = 1;
    context.beginPath();
    context.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
    context.stroke();

    // シャフト
    context.beginPath();
    context.moveTo(this.x + this.width, this.y + 6);
    context.lineTo(r.x, r.y);
    context.stroke();
  }
}

// ボール（物理演算・ネット越え・スマッシュ対応）
class Ball {
  constructor() {
    this.resetServe();
  }

  // 奥コートからのサーブ初期化
  resetServe() {
    this.x = CANVAS_WIDTH / 2 + (Math.random() * 40 - 20);
    this.y = 56;
    this.z = 24;
    this.vx = (Math.random() - 0.5) * 0.4;
    this.vy = 1.1;
    this.vz = 0.5;
    this.gravity = 0.08;
    this.bounce = -0.7;
    this.radius = 3;
    this.bouncesInCurrentCourt = 0;
    this.hitNet = false;
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
      if (Math.abs(this.vz) < 0.25) this.vz = 0;
      this.bouncesInCurrentCourt++;
    }

    // ネット（Y=120, 高さZ=12）の衝突判定
    if (!this.hitNet && Math.abs(this.y - 120) < 3) {
      if (this.z < 12) {
        this.hitNet = true;
        this.vy = -this.vy * 0.2; // ネットに引っかかり失速
        this.vz = 0.5;
      }
    }

    // コート通過によるバウンドカウントリセット
    if (this.y > 120 && this.vy > 0 && this.bouncesInCurrentCourt > 0 && this.y - this.vy <= 120) {
      this.bouncesInCurrentCourt = 0;
    }

    // ラケットによるヒット判定
    if (player.isSwinging && !this.hitNet) {
      const racket = player.getRacketPosition();
      const dist2D = Math.hypot(this.x - racket.x, this.y - racket.y);

      // ラケット枠内（半径10px以内）判定
      if (dist2D < 10 && this.vy > 0) {
        this.bouncesInCurrentCourt = 0;

        if (this.z >= 16) {
          // 【自動スマッシュ】高い球を叩きつける
          this.vy = -2.8;
          this.vx = (this.x - (player.x + 8)) * 0.15;
          this.vz = -0.4; // 斜め下へ高速射出
        } else if (this.z > 2) {
          // 【通常ストローク】ネットを越える放物線を描く
          this.vy = -1.5;
          this.vx = (this.x - racket.x) * 0.2;
          this.vz = 2.4; // ネット上空（Z>12）を通過する初速
        }
      }
    }

    // 奥コート（簡易AI）の打ち返し
    if (this.y < 52 && this.vy < 0) {
      this.vy = 1.05;
      this.vz = 2.2;
      this.vx = (Math.random() - 0.5) * 0.8;
      this.bouncesInCurrentCourt = 0;
      this.hitNet = false;
    }

    // 画面外または2バウンド以上で再サーブ
    if (this.y > CANVAS_HEIGHT + 10 || this.y < 20 || this.bouncesInCurrentCourt >= 2) {
      this.resetServe();
    }
  }

  draw(context) {
    // 影
    context.fillStyle = 'rgba(0, 0, 0, 0.45)';
    context.beginPath();
    context.ellipse(this.x, this.y, this.radius, this.radius * 0.5, 0, 0, Math.PI * 2);
    context.fill();

    // ボール本体
    context.fillStyle = '#ffff33';
    context.beginPath();
    context.arc(this.x, this.y - Math.max(0, this.z), this.radius, 0, Math.PI * 2);
    context.fill();
  }
}

// コート描画（ネットの高さを立体表現）
function drawCourt(context) {
  // ベースコート
  context.fillStyle = '#1c7a31';
  context.fillRect(24, 36, 208, 178);

  // コートライン
  context.strokeStyle = '#ffffff';
  context.lineWidth = 1;
  context.strokeRect(36, 46, 184, 158);

  // サービスライン
  context.beginPath();
  context.moveTo(36, 84);
  context.lineTo(220, 84);
  context.moveTo(36, 166);
  context.lineTo(220, 166);
  // センターライン
  context.moveTo(128, 84);
  context.lineTo(128, 166);
  context.stroke();

  // ネット（Y=120, 高さ12pxのメッシュ）
  context.fillStyle = 'rgba(230, 230, 230, 0.5)';
  context.fillRect(24, 120 - 12, 208, 12);
  context.strokeStyle = '#eeeeee';
  context.beginPath();
  context.moveTo(24, 120 - 12);
  context.lineTo(232, 120 - 12); // トップコード
  context.moveTo(24, 120);
  context.lineTo(232, 120); // ボトムライン
  context.stroke();
}

const input = new InputHandler();
const player = new SealPlayer(CANVAS_WIDTH / 2 - 8, 180);
const ball = new Ball();

function gameLoop() {
  player.update(input);
  ball.update(player);

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  drawCourt(ctx);
  player.draw(ctx);
  ball.draw(ctx);

  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

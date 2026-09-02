const CANVAS_WIDTH = 256;
const CANVAS_HEIGHT = 240;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// 入力管理
class InputHandler {
  constructor() {
    this.action = false;
    this.history = { up: [], down: [], left: [], right: [] };
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
      const interval1 = h[1] - h[0];
      const interval2 = h[2] - h[1];
      if (interval1 < 180 && interval2 >= 120 && interval2 <= 280) {
        isRhythmJump = true;
        this.history[dir] = [];
      }
    }
    this.consumeQueue.push({ dir, isRhythmJump });
  }

  initKeyboard() {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    window.addEventListener('keydown', (e) => {
      if (map[e.key] && !e.repeat) { e.preventDefault(); this.registerPress(map[e.key]); }
      if ((e.key === 'z' || e.key === 'Z' || e.key === ' ') && !e.repeat) { e.preventDefault(); this.action = true; }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'z' || e.key === 'Z' || e.key === ' ') this.action = false;
    });
  }

  initTouch() {
    const list = [{ id: 'btn-up', dir: 'up' }, { id: 'btn-down', dir: 'down' }, { id: 'btn-left', dir: 'left' }, { id: 'btn-right', dir: 'right' }];
    list.forEach(({ id, dir }) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); this.registerPress(dir); }, { passive: false });
      el.addEventListener('mousedown', (e) => { e.preventDefault(); this.registerPress(dir); });
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

  popAction() { return this.consumeQueue.shift(); }
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
    this.facing = 1; // 1: 右(フォア), -1: 左(バック)
  }

  getRacketPosition() {
    // 向きに応じてラケットのX座標を反転
    const offsetX = this.facing === 1 ? this.width + 4 : -4;
    return {
      x: this.x + offsetX,
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
      if (dir === 'left') { this.vx -= speed; this.facing = -1; }
      if (dir === 'right') { this.vx += speed; this.facing = 1; }
      if (dir === 'up') this.vy -= speed * 0.7;
      if (dir === 'down') this.vy += speed * 0.7;
    }

    this.x += this.vx;
    this.y += this.vy;
    this.vx *= this.friction;
    this.vy *= this.friction;

    if (Math.abs(this.vx) < 0.05) this.vx = 0;
    if (Math.abs(this.vy) < 0.05) { this.vy = 0; this.isDashing = false; }

    this.x = Math.max(24, Math.min(CANVAS_WIDTH - 24 - this.width, this.x));
    this.y = Math.max(130, Math.min(218 - this.height, this.y));

    if (input.action && !this.isSwinging) {
      this.isSwinging = true;
      this.swingTimer = 12;
    }

    if (this.isSwinging) {
      this.swingTimer--;
      if (this.swingTimer <= 0) this.isSwinging = false;
    }
  }

  draw(context) {
    context.fillStyle = 'rgba(0, 0, 0, 0.4)';
    context.fillRect(this.x, this.y + this.height - 2, this.width, 3);

    context.fillStyle = this.isDashing ? '#e0ffff' : '#68c2d3';
    context.fillRect(Math.floor(this.x), Math.floor(this.y), this.width, this.height);

    const r = this.getRacketPosition();
    context.strokeStyle = this.isSwinging ? '#ff4444' : '#ffffff';
    context.lineWidth = 1;
    context.beginPath();
    context.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
    context.stroke();

    context.beginPath();
    // シャフトの付け根も向きに応じて切り替え
    context.moveTo(this.facing === 1 ? this.x + this.width : this.x, this.y + 6);
    context.lineTo(r.x, r.y);
    context.stroke();
  }
}

// ボール
class Ball {
  constructor() {
    this.resetServe();
  }

  resetServe() {
    this.x = CANVAS_WIDTH / 2 + (Math.random() * 40 - 20);
    this.y = 56;
    this.z = 24;
    this.vx = (Math.random() - 0.5) * 0.4;
    this.vy = 1.1;
    this.vz = 0.5;
    this.gravity = 0.08;
    this.bounce = -0.85; // バウンドを大きく
    this.radius = 3;
    this.bouncesInCurrentCourt = 0;
    this.hitNet = false;
  }

  update(player) {
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    this.vz -= this.gravity;

    if (this.z <= 0) {
      this.z = 0;
      this.vz = this.vz * this.bounce;
      if (Math.abs(this.vz) < 0.25) this.vz = 0;
      this.bouncesInCurrentCourt++;
    }

    if (!this.hitNet && Math.abs(this.y - 120) < 3) {
      if (this.z < 12) {
        this.hitNet = true;
        this.vy = -this.vy * 0.2;
        this.vz = 0.5;
      }
    }

    if (this.y > 120 && this.vy > 0 && this.bouncesInCurrentCourt > 0 && this.y - this.vy <= 120) {
      this.bouncesInCurrentCourt = 0;
    }

    // 2バウンド未満の時のみ打撃判定を有効化
    if (this.bouncesInCurrentCourt < 2) {
      if (player.isSwinging && !this.hitNet) {
        const racket = player.getRacketPosition();
        const dist2D = Math.hypot(this.x - racket.x, this.y - racket.y);

        if (dist2D < 12 && this.vy > 0) {
          this.bouncesInCurrentCourt = 0;
          if (this.z >= 16) {
            this.vy = -2.8;
            this.vx = (this.x - (player.x + 8)) * 0.15;
            this.vz = -0.4;
          } else if (this.z > 2) {
            this.vy = -1.5;
            this.vx = (this.x - racket.x) * 0.2;
            this.vz = 2.4;
          }
        }
      }

      // 奥コートの打ち返し（2バウンド未満限定）
      if (this.y < 52 && this.vy < 0) {
        this.vy = 1.05;
        this.vz = 2.2;
        this.vx = (Math.random() - 0.5) * 0.8;
        this.bouncesInCurrentCourt = 0;
        this.hitNet = false;
      }
    }

    // 完全に画面外へ消えるまでリセットしない
    if (this.y > CANVAS_HEIGHT + 30 || this.y < -30 || this.x < -20 || this.x > CANVAS_WIDTH + 20) {
      this.resetServe();
    }
  }

  draw(context) {
    context.fillStyle = 'rgba(0, 0, 0, 0.45)';
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

  context.strokeStyle = '#ffffff';
  context.lineWidth = 1;
  context.strokeRect(36, 46, 184, 158);

  context.beginPath();
  context.moveTo(36, 84);
  context.lineTo(220, 84);
  context.moveTo(36, 166);
  context.lineTo(220, 166);
  context.moveTo(128, 84);
  context.lineTo(128, 166);
  context.stroke();

  context.fillStyle = 'rgba(230, 230, 230, 0.5)';
  context.fillRect(24, 120 - 12, 208, 12);
  context.strokeStyle = '#eeeeee';
  context.beginPath();
  context.moveTo(24, 120 - 12);
  context.lineTo(232, 120 - 12);
  context.moveTo(24, 120);
  context.lineTo(232, 120);
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

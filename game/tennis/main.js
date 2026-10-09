const CANVAS_WIDTH = 256;
const CANVAS_HEIGHT = 240;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// コートの白線範囲（判定用）
const COURT_LINES = {
  left: 36,
  right: 220,
  top: 46,
  bottom: 204,
  netY: 120,
  netHeight: 12
};

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
    context.moveTo(this.facing === 1 ? this.x + this.width : this.x, this.y + 6);
    context.lineTo(r.x, r.y);
    context.stroke();
  }
}

// ボール
class Ball {
  constructor() {
    this.resetServe();
    this.message = '';
    this.messageTimer = 0;
  }

  resetServe() {
    // サーブ位置と軌道のバリエーション（たまにサイドラインを攻める）
    this.x = CANVAS_WIDTH / 2 + (Math.random() * 60 - 30);
    this.y = 56;
    this.z = 24;
    this.vx = (Math.random() - 0.5) * 0.8;
    this.vy = 1.2 + Math.random() * 0.3;
    this.vz = 0.6;
    this.gravity = 0.08;
    this.bounce = -0.85;
    this.radius = 3;
    this.bouncesInCurrentCourt = 0;
    this.hitNet = false;
    this.curve = 0; // カーブ値
    this.isDead = false;
  }

  update(player) {
    if (this.messageTimer > 0) {
      this.messageTimer--;
      if (this.messageTimer === 0) this.resetServe();
      return;
    }

    // カーブによる横移動の変化
    this.vx += this.curve;
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    this.vz -= this.gravity;

    // バウンド処理とアウト判定
    if (this.z <= 0) {
      this.z = 0;
      this.vz = this.vz * this.bounce;
      if (Math.abs(this.vz) < 0.25) this.vz = 0;
      this.bouncesInCurrentCourt++;

      // 1回目のバウンドが白線外ならアウト判定
      if (this.bouncesInCurrentCourt === 1 && !this.isDead) {
        const isOut = (
          this.x < COURT_LINES.left ||
          this.x > COURT_LINES.right ||
          this.y < COURT_LINES.top ||
          this.y > COURT_LINES.bottom
        );
        if (isOut) {
          this.isDead = true;
          this.message = 'OUT!';
          this.messageTimer = 60;
        }
      }
    }

    // ネット衝突判定（高さがネット以下なら引っかかる）
    if (!this.hitNet && Math.abs(this.y - COURT_LINES.netY) < 4) {
      if (this.z < COURT_LINES.netHeight) {
        this.hitNet = true;
        this.vy = -this.vy * 0.15; // 勢いが死んでネット手前に落ちる
        this.vz = 0.3;
        this.curve = 0;
        this.message = 'NET!';
        this.messageTimer = 50;
      }
    }

    // コートをまたいだらバウンド回数をリセット
    if (this.y > COURT_LINES.netY && this.vy > 0 && this.bouncesInCurrentCourt > 0 && (this.y - this.vy) <= COURT_LINES.netY) {
      this.bouncesInCurrentCourt = 0;
    }

    // プレイヤーの打球処理
    if (this.bouncesInCurrentCourt < 2 && !this.isDead) {
      if (player.isSwinging && !this.hitNet) {
        const racket = player.getRacketPosition();
        const dist2D = Math.hypot(this.x - racket.x, this.y - racket.y);

        if (dist2D < 13 && this.vy > 0) {
          const isVolley = (this.bouncesInCurrentCourt === 0);
          this.bouncesInCurrentCourt = 0;

          // 1. ダッシュボレー時のカーブ（スライス）処理
          if (player.isDashing && isVolley) {
            // ダッシュしている方向に応じて弧を描くカーブを与える
            this.curve = player.vx > 0 ? 0.05 : -0.05;
          } else {
            this.curve = 0;
          }

          // 2. 打点の高さ・位置による打ち分けとネットミス判定
          if (this.z >= 16) {
            // 【スマッシュ】鋭い角度で叩きつける（奥を狙いすぎるとアウト、ネット直近だとネットにかかる）
            this.vy = -3.2;
            this.vx = (this.x - (player.x + 8)) * 0.22;
            this.vz = -0.3;
          } else if (this.z <= 5) {
            // 【打点が低すぎる（ミスショット）】高さが出せず、ネットに突き刺さりやすい！
            this.vy = -1.6;
            this.vx = (this.x - racket.x) * 0.25;
            this.vz = 1.0; // 高さが足りずネット直撃のリスク増
          } else {
            // 【通常ストローク】
            this.vy = -2.0;
            this.vx = (this.x - racket.x) * 0.2;
            this.vz = 2.5;
          }
        }
      }

      // 相手コート（奥）の返球
      if (this.y < 52 && this.vy < 0) {
        this.vy = 1.1 + Math.random() * 0.2;
        this.vz = 2.1;
        // 相手もたまに角度をつけてサイドラインギリギリを狙ってくる
        this.vx = (Math.random() - 0.5) * 1.4;
        this.curve = 0;
        this.bouncesInCurrentCourt = 0;
        this.hitNet = false;
      }
    }

    // 画面外リセット
    if (this.y > CANVAS_HEIGHT + 30 || this.y < -30 || this.x < -20 || this.x > CANVAS_WIDTH + 20) {
      this.resetServe();
    }
  }

  draw(context) {
    // 影
    context.fillStyle = 'rgba(0, 0, 0, 0.45)';
    context.beginPath();
    context.ellipse(this.x, this.y, this.radius, this.radius * 0.5, 0, 0, Math.PI * 2);
    context.fill();

    // ボール本体（カーブ時は少し青白く光る演出）
    context.fillStyle = this.curve !== 0 ? '#80ffff' : '#ffff33';
    context.beginPath();
    context.arc(this.x, this.y - Math.max(0, this.z), this.radius, 0, Math.PI * 2);
    context.fill();

    // OUTやNETのメッセージ表示
    if (this.messageTimer > 0) {
      context.fillStyle = '#ff3333';
      context.font = 'bold 12px sans-serif';
      context.textAlign = 'center';
      context.fillText(this.message, CANVAS_WIDTH / 2, 110);
    }
  }
}

function drawCourt(context) {
  context.fillStyle = '#1c7a31';
  context.fillRect(24, 36, 208, 178);

  context.strokeStyle = '#ffffff';
  context.lineWidth = 1;
  context.strokeRect(COURT_LINES.left, COURT_LINES.top, COURT_LINES.right - COURT_LINES.left, COURT_LINES.bottom - COURT_LINES.top);

  context.beginPath();
  context.moveTo(COURT_LINES.left, 84);
  context.lineTo(COURT_LINES.right, 84);
  context.moveTo(COURT_LINES.left, 166);
  context.lineTo(COURT_LINES.right, 166);
  context.moveTo(128, 84);
  context.lineTo(128, 166);
  context.stroke();

  context.fillStyle = 'rgba(230, 230, 230, 0.5)';
  context.fillRect(24, COURT_LINES.netY - COURT_LINES.netHeight, 208, COURT_LINES.netHeight);
  context.strokeStyle = '#eeeeee';
  context.beginPath();
  context.moveTo(24, COURT_LINES.netY - COURT_LINES.netHeight);
  context.lineTo(232, COURT_LINES.netY - COURT_LINES.netHeight);
  context.moveTo(24, COURT_LINES.netY);
  context.lineTo(232, COURT_LINES.netY);
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

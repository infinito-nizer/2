// ============================================================
// Unified desktop + touch input
// ============================================================
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.lookDX = 0;
    this.lookDY = 0;
    this.fireHeld = false;
    this.firePressed = false;
    this.rightHeld = false;
    this.sensitivity = 1;
    this.locked = false;
    this.pointerLockAvailable = 'requestPointerLock' in canvas;
    this.joy = { x: 0, y: 0, active: false };
    this.isTouch = (window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false) || 'ontouchstart' in window;
    this.enabled = false;
    this.onKey = null;

    this._bindKeyboard();
    this._bindMouse();
    if (this.isTouch) this._bindTouch();
  }

  requestLock() {
    if (!this.pointerLockAvailable || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {
      /* pointer lock may be blocked in an iframe — drag-look fallback is used */
    }
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys[e.code] && this.onKey) this.onKey(e.code);
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    window.addEventListener('blur', () => {
      this.keys = Object.create(null);
      this.fireHeld = false;
    });
  }

  _bindMouse() {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this._lockedAt = performance.now();
    });

    // Free aim: works both with pointer lock and, as a fallback, without it.
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      this.lookDX += e.movementX || 0;
      this.lookDY += e.movementY || 0;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) {
        this._dragging = true;
        if (!this.locked) this.requestLock();
        this.fireHeld = true;
        this.firePressed = true;
      } else if (e.button === 2) {
        this.rightHeld = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this._dragging = false;
        this.fireHeld = false;
      } else if (e.button === 2) {
        this.rightHeld = false;
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      if (e.deltaY > 0) this.wheelDown = true;
      else this.wheelUp = true;
    }, { passive: true });
  }

  _bindTouch() {
    const joyEl = document.getElementById('joy');
    const knob = document.getElementById('joy-knob');
    let joyId = null;
    let lookId = null;
    let lookX = 0, lookY = 0;

    const joyStart = (e) => {
      const t = e.changedTouches[0];
      joyId = t.identifier;
      this.joy.active = true;
      e.preventDefault();
    };
    const joyMove = (e) => {
      if (joyId === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== joyId) continue;
        const r = joyEl.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        let dx = (t.clientX - cx) / (r.width * 0.42);
        let dy = (t.clientY - cy) / (r.height * 0.42);
        const len = Math.hypot(dx, dy);
        if (len > 1) { dx /= len; dy /= len; }
        this.joy.x = dx;
        this.joy.y = dy;
        knob.style.transform = `translate(${dx * r.width * 0.32}px, ${dy * r.height * 0.32}px)`;
      }
      e.preventDefault();
    };
    const joyEnd = () => {
      joyId = null;
      this.joy.active = false;
      this.joy.x = this.joy.y = 0;
      knob.style.transform = 'translate(0,0)';
    };
    if (joyEl) {
      joyEl.addEventListener('touchstart', joyStart, { passive: false });
      joyEl.addEventListener('touchmove', joyMove, { passive: false });
      joyEl.addEventListener('touchend', joyEnd);
      joyEl.addEventListener('touchcancel', joyEnd);
    }

    // look-drag on the right side of the screen
    this.canvas.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.clientX > window.innerWidth * 0.4 && lookId === null) {
          lookId = t.identifier;
          lookX = t.clientX;
          lookY = t.clientY;
        }
      }
    }, { passive: true });

    this.canvas.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== lookId) continue;
        this.lookDX += (t.clientX - lookX) * 1.9;
        this.lookDY += (t.clientY - lookY) * 1.9;
        lookX = t.clientX;
        lookY = t.clientY;
      }
      e.preventDefault();
    }, { passive: false });

    const lookEnd = (e) => {
      for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
    };
    this.canvas.addEventListener('touchend', lookEnd);
    this.canvas.addEventListener('touchcancel', lookEnd);
  }

  consumeLook() {
    const dx = this.lookDX;
    const dy = this.lookDY;
    this.lookDX = 0;
    this.lookDY = 0;
    return { dx, dy };
  }

  consumeFire() {
    const f = this.firePressed;
    this.firePressed = false;
    return f;
  }

  consumeWheel() {
    if (this.wheelUp) { this.wheelUp = false; return -1; }
    if (this.wheelDown) { this.wheelDown = false; return 1; }
    return 0;
  }

  down(code) {
    return !!this.keys[code];
  }

  moveVector() {
    let x = 0, z = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) z += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) z -= 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.joy.active) {
      x += this.joy.x;
      z -= this.joy.y;
    }
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }
}

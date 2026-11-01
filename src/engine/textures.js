import * as THREE from 'three';

// ============================================================
// Procedural canvas textures — no external assets required
// ============================================================
function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function finish(canvas, { repeat = 1, srgb = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Soft radial gradient sprite (used for glow / smoke / sparks). */
export function radialTexture(size = 128, stops = [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) g.addColorStop(p, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(c);
}

/** Organic smoke blob. */
export function smokeTexture(size = 128) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // puffs
  for (let i = 0; i < 26; i++) {
    const x = size / 2 + (Math.random() - 0.5) * size * 0.55;
    const y = size / 2 + (Math.random() - 0.5) * size * 0.55;
    const r = size * (0.06 + Math.random() * 0.16);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,0.18)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(c);
}

/** Bullet-hole decal with soft dark ring and cracks. */
export function bulletHoleTexture(size = 128) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.translate(size / 2, size / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.42);
  g.addColorStop(0, 'rgba(0,0,0,0.98)');
  g.addColorStop(0.25, 'rgba(12,12,12,0.9)');
  g.addColorStop(0.5, 'rgba(30,26,22,0.55)');
  g.addColorStop(1, 'rgba(40,34,28,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    const a = Math.random() * Math.PI * 2;
    const r2 = size * (0.16 + Math.random() * 0.28);
    ctx.moveTo(Math.cos(a) * size * 0.1, Math.sin(a) * size * 0.1);
    ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
    ctx.lineWidth = Math.random() * 2.4 + 0.6;
    ctx.stroke();
  }
  return finish(c);
}

/** Fine grayscale detail noise for terrain / walls. */
export function detailTexture(size = 256, contrast = 0.55) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // layered blobs
      let v = 0.5;
      v += (Math.random() - 0.5) * contrast;
      v += (Math.sin(x * 0.11) * Math.cos(y * 0.13)) * 0.06;
      const i = (y * size + x) * 4;
      const g = Math.max(0, Math.min(255, v * 255));
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // soften
  ctx.globalAlpha = 0.5;
  ctx.drawImage(c, 0, 0, size / 2, size / 2, 0, 0, size, size);
  ctx.globalAlpha = 1;
  return finish(c);
}

/** Concrete-ish wall texture used by buildings. */
export function wallTexture(size = 256, base = [58, 62, 58]) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i++) {
    const a = Math.random() * 0.16;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    const s = Math.random() * 5 + 1;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  // horizontal grime bands
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    ctx.fillRect(0, Math.random() * size, size, Math.random() * 12 + 2);
  }
  return finish(c, { srgb: true });
}

/** Palm frond alpha sprite. */
export function frondTexture(size = 256) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size * 0.96);
  const grad = ctx.createLinearGradient(0, 0, 0, -size);
  grad.addColorStop(0, '#1c3d16');
  grad.addColorStop(0.6, '#3f7a24');
  grad.addColorStop(1, '#79b53b');
  ctx.fillStyle = grad;
  ctx.strokeStyle = grad;
  // central spine
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(6, -size * 0.5, 0, -size * 0.94);
  ctx.lineWidth = 4;
  ctx.stroke();
  // leaflets
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const y = -size * (0.08 + t * 0.85);
    const len = size * (0.34 * (1 - t * 0.55) + 0.05);
    const droop = size * 0.16 * t;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(dir * len * 0.5, y - len * 0.18, dir * len, y + droop);
      ctx.quadraticCurveTo(dir * len * 0.45, y - len * 0.02, 0, y + 4);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Grass blade billboard alpha. */
export function grassTexture(size = 128) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 16; i++) {
    const x = size * (0.12 + Math.random() * 0.76);
    const h = size * (0.45 + Math.random() * 0.5);
    const w = size * 0.035;
    const bend = (Math.random() - 0.5) * size * 0.22;
    const g = ctx.createLinearGradient(0, size, 0, size - h);
    g.addColorStop(0, 'rgba(38,69,26,0.95)');
    g.addColorStop(0.6, 'rgba(76,120,38,0.95)');
    g.addColorStop(1, 'rgba(133,178,74,0.92)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w, size);
    ctx.quadraticCurveTo(x + bend * 0.4, size - h * 0.6, x + bend, size - h);
    ctx.quadraticCurveTo(x + bend * 0.4 + w * 0.55, size - h * 0.6, x + w, size);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Metal crate texture. */
export function crateTexture(size = 256, tint = [92, 70, 40]) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, size - 8, size - 8);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < 4; i++) ctx.fillRect(14, 22 + i * 56, size - 28, 8);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(0, 0, size, 6);
  // hazard stripe
  ctx.save();
  ctx.translate(size / 2, size * 0.62);
  ctx.rotate(-0.14);
  for (let i = -8; i < 8; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,170,30,0.75)' : 'rgba(20,20,20,0.75)';
    ctx.fillRect(i * 20, -9, 20, 18);
  }
  ctx.restore();
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.08)';
    ctx.fillRect(Math.random() * size, Math.random() * size, 3, 3);
  }
  return finish(c, { srgb: true });
}

/** Simple icon texture for the loot beacon (a glowing diamond). */
export function beaconTexture(size = 128) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,220,160,0.95)');
  g.addColorStop(0.35, 'rgba(255,170,70,0.35)');
  g.addColorStop(1, 'rgba(255,150,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(c);
}

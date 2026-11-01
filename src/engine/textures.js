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

// ============================================================
// High-fidelity tileable PBR texture generators (albedo/normal/rough)
// Pixel builders are pure functions so they can be unit-tested offline.
// ============================================================

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(x, y, seed = 0) {
  let h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}
function wrapMod(i, p) {
  return ((i % p) + p) % p;
}
/** Tileable value noise: u,v in [0,1), freq = integer cells per tile. */
function tileNoise(u, v, freq, seed = 0) {
  const x = u * freq;
  const y = v * freq;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const h = (i, j) => hash(wrapMod(i, freq), wrapMod(j, freq), seed);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}
function tileFbm(u, v, freq = 4, octaves = 4, seed = 0, gain = 0.5) {
  let amp = 1, sum = 0, norm = 0, f = freq;
  for (let i = 0; i < octaves; i++) {
    sum += amp * tileNoise(u, v, f, seed + i * 13);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}
function smooth(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function toCanvas(arr, size, { srgb = false } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  img.data.set(arr);
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Sobel a tileable height field into an RGB normal map (OpenGL convention). */
function heightToNormal(height, size, strength = 2.0) {
  const out = new Uint8ClampedArray(size * size * 4);
  const at = (x, y) => height[wrapMod(y, size) * size + wrapMod(x, size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Ground micro-detail: neutral-toned grit, pebbles and cracks. */
export function buildGroundMaps(size = 512, base = 205) {
  const H = new Float32Array(size * size);
  const albedo = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let h = tileFbm(u, v, 8, 5, 1) * 0.55 + tileFbm(u, v, 32, 3, 2) * 0.25;
      // grit specks
      h += (hash(x * 3.1, y * 2.7) - 0.5) * 0.22;
      // small pebbles (tileable blobs on a jittered grid)
      const cell = 42;
      const gx = (x / cell) | 0, gy = (y / cell) | 0;
      const jx = hash(gx, gy, 3) * cell, jy = hash(gx, gy, 4) * cell;
      const px = (x % cell) - jx + cell / 2, py = (y % cell) - jy + cell / 2;
      const pr = 2 + hash(gx, gy, 5) * 5;
      const d = Math.hypot(px, py);
      if (d < pr) h += smooth(pr, pr * 0.3, d) * 0.3;
      H[y * size + x] = h;

      const g = base + (h - 0.5) * 84;
      const i = (y * size + x) * 4;
      albedo[i] = g * 1.02;
      albedo[i + 1] = g * 1.0;
      albedo[i + 2] = g * 0.92;
      albedo[i + 3] = 255;
      const r = 215 - h * 55;
      rough[i] = rough[i + 1] = rough[i + 2] = r;
      rough[i + 3] = 255;
    }
  }
  return { albedo, normal: heightToNormal(H, size, 2.4), rough };
}

/** Weathered plaster / concrete wall. */
export function buildWallMaps(size = 512, tone = 0.72) {
  const H = new Float32Array(size * size);
  const albedo = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let h = tileFbm(u, v, 6, 5, 7) * 0.5 + tileFbm(u, v, 24, 3, 9) * 0.3;
      h += (hash(x * 1.7, y * 1.3) - 0.5) * 0.1;

      // mortar panel seams
      const seam = Math.min(
        Math.abs(((u * 4) % 1) - 0.5),
        Math.abs(((v * 4) % 1) - 0.5)
      );
      const seamMask = 1 - smooth(0.005, 0.02, seam);
      h -= seamMask * 0.35;

      // cracks
      const crackN = tileFbm(u, v, 12, 3, 21);
      const crack = smooth(0.014, 0.0, Math.abs(crackN - 0.52));
      h -= crack * 0.4;

      // rain streaks
      const streak = smooth(0.55, 0.9, tileFbm(u * 4, v * 0.5, 8, 3, 31));
      H[y * size + x] = h;

      let g = tone * 255 + (h - 0.5) * 46;
      g -= streak * 22 + crack * 26;
      const i = (y * size + x) * 4;
      albedo[i] = g * 1.02;
      albedo[i + 1] = g * 0.99;
      albedo[i + 2] = g * 0.94;
      albedo[i + 3] = 255;

      const r = 200 + (1 - h) * 45 + crack * 20;
      rough[i] = rough[i + 1] = rough[i + 2] = Math.min(255, r);
      rough[i + 3] = 255;
    }
  }
  return { albedo, normal: heightToNormal(H, size, 2.2), rough };
}

/** Corrugated / ribbed metal with rust, used for roofs and containers. */
export function buildMetalMaps(size = 512, color = [150, 158, 164], ribs = 12) {
  const H = new Float32Array(size * size);
  const albedo = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const rib = Math.sin(u * Math.PI * 2 * ribs) * 0.5 + 0.5;
      let h = rib * 0.55 + tileFbm(u, v, 8, 3, 41) * 0.18;
      const rustN = tileFbm(u, v, 5, 4, 43);
      const rust = smooth(0.56, 0.78, rustN);

      H[y * size + x] = h;
      const i = (y * size + x) * 4;
      const shade = 0.72 + rib * 0.35;
      albedo[i] = color[0] * shade * (1 - rust * 0.35) + rust * 88;
      albedo[i + 1] = color[1] * shade * (1 - rust * 0.45) + rust * 48;
      albedo[i + 2] = color[2] * shade * (1 - rust * 0.55) + rust * 26;
      albedo[i + 3] = 255;

      const r = 70 + rust * 130 + (1 - rib) * 40;
      rough[i] = rough[i + 1] = rough[i + 2] = Math.min(255, r);
      rough[i + 3] = 255;
    }
  }
  return { albedo, normal: heightToNormal(H, size, 1.6), rough };
}

/** Weathered wood planks. */
export function buildWoodMaps(size = 512, tone = [126, 94, 60]) {
  const H = new Float32Array(size * size);
  const albedo = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const plank = Math.floor(v * 6);
      const gap = Math.abs(((v * 6) % 1) - 0.5);
      const plankMask = 1 - smooth(0.44, 0.5, gap);
      const grain = tileFbm(u * 0.7, v * 6, 16, 4, 51);
      const h = plankMask * 0.5 + grain * 0.35 + (hash(plank, 3) - 0.5) * 0.05;
      H[y * size + x] = h;
      const i = (y * size + x) * 4;
      const tint = 0.72 + grain * 0.5 + (hash(plank, 9) - 0.5) * 0.18;
      albedo[i] = tone[0] * tint;
      albedo[i + 1] = tone[1] * tint;
      albedo[i + 2] = tone[2] * tint;
      albedo[i + 3] = 255;
      const r = 195 + grain * 40;
      rough[i] = rough[i + 1] = rough[i + 2] = r;
      rough[i + 3] = 255;
    }
  }
  return { albedo, normal: heightToNormal(H, size, 2.2), rough };
}

// ---- material helpers -------------------------------------------------
export function makePBRTextures(maps, size, { repeat = 1, normalScale = 1 } = {}) {
  const map = toCanvas(maps.albedo, size, { srgb: true });
  const normalMap = toCanvas(maps.normal, size);
  const roughnessMap = toCanvas(maps.rough, size);
  const setRep = (t) => { t.repeat.set(repeat, repeat); };
  setRep(map); setRep(normalMap); setRep(roughnessMap);
  return { map, normalMap, roughnessMap, normalScale };
}

const _pbrCache = new Map();
function cachedSet(key, build) {
  if (!_pbrCache.has(key)) _pbrCache.set(key, build());
  return _pbrCache.get(key);
}

/** One shared ground set (the most visible surface — highest resolution). */
export function groundTextures(size = 512) {
  return cachedSet(`ground${size}`, () => makePBRTextures(buildGroundMaps(size), size, { repeat: 220 }));
}

export function wallTextures(size = 256, tone = 0.72) {
  return cachedSet(`wall${size}_${tone}`, () => makePBRTextures(buildWallMaps(size, tone), size, { repeat: 1 }));
}

export function metalTextures(size = 256, color = [150, 158, 164], ribs = 12) {
  return cachedSet(`metal${size}_${ribs}`, () => makePBRTextures(buildMetalMaps(size, color, ribs), size, { repeat: 1 }));
}

export function woodTextures(size = 256, tone = [126, 94, 60]) {
  return cachedSet(`wood${size}_${tone}`, () => makePBRTextures(buildWoodMaps(size, tone), size, { repeat: 1 }));
}

/** Alpha-tested leaf cluster used for tree canopies (pure pixel build, AA'd). */
export function buildLeafCard(size = 256) {
  const out = new Uint8ClampedArray(size * size * 4);
  const rnd = mulberry32(1337);
  const cx0 = size / 2, cy0 = size / 2;
  const leaves = [];
  for (let i = 0; i < 30; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * size * 0.3;
    leaves.push({
      x: cx0 + Math.cos(a) * r,
      y: cy0 + Math.sin(a) * r,
      len: size * (0.17 + rnd() * 0.17),
      wid: size * (0.045 + rnd() * 0.045),
      ang: rnd() * Math.PI * 2,
      hue: 92 + rnd() * 40,
      shade: 0.72 + rnd() * 0.5,
    });
  }
  const sample = (px, py) => {
    // composite top-most leaf that covers this point
    let cr = 0, cg = 0, cb = 0, ca = 0;
    for (const L of leaves) {
      const dx = px - L.x, dy = py - L.y;
      const ca2 = Math.cos(L.ang), sa = Math.sin(L.ang);
      const lx = dx * ca2 + dy * sa;
      const ly = -dx * sa + dy * ca2;
      // tapered ellipse: narrower towards the tip
      const t = (ly / L.len + 0.5);
      if (t < 0 || t > 1) continue;
      const w = L.wid * Math.sin(Math.PI * Math.pow(t, 0.75)) ;
      if (Math.abs(lx) > w) continue;
      const edge = 1 - Math.abs(lx) / Math.max(w, 1e-3);
      // hsl -> rgb (s ~ 0.45, l from 0.24..0.42 by t and shade)
      const l = (0.30 + t * 0.13) * L.shade;
      const sat = 0.42;
      const c = hslToRgb(L.hue / 360, sat, Math.min(0.62, l));
      const shade = 0.62 + edge * 0.42;
      const rib = Math.abs(lx) < Math.max(1, L.wid * 0.05) ? 0.7 : 1;
      cr = c[0] * 255 * shade * rib;
      cg = c[1] * 255 * shade * rib;
      cb = c[2] * 255 * shade * rib;
      ca = 1;
    }
    return [cr, cg, cb, ca];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 2x2 supersampling for soft alpha edges
      let r = 0, g = 0, b = 0, a = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const px = sample(x + ox, y + oy);
        r += px[0] * px[3]; g += px[1] * px[3]; b += px[2] * px[3]; a += px[3];
      }
      const i = (y * size + x) * 4;
      if (a > 0) {
        out[i] = r / a; out[i + 1] = g / a; out[i + 2] = b / a;
      }
      out[i + 3] = (a / 4) * 255;
    }
  }
  return out;
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

export function leafCardTexture(size = 256) {
  const data = buildLeafCard(size);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Rough tree-bark albedo. */
export function barkTexture(size = 256) {
  const maps = buildWoodMaps(size, [86, 68, 48]);
  return toCanvas(maps.albedo, size, { srgb: true });
}

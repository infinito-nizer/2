import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wallTexture, crateTexture, wallTextures, metalTextures, woodTextures } from '../engine/textures.js';
import { mulberry32, rand, pick, clamp } from '../engine/utils.js';
import { WORLD } from '../engine/terrain.js';
import { buildLootWeapon, WEAPONS } from './weapons.js';

// ============================================================
// Island settlements: buildings, props, loot and collision
// ============================================================

/** Collects transformed geometries and merges them per material. */
class Batcher {
  constructor() {
    this.map = new Map();
  }
  add(geo, material, matrix) {
    if (matrix) geo.applyMatrix4(matrix);
    if (!this.map.has(material)) this.map.set(material, []);
    this.map.get(material).push(geo);
  }
  build(group) {
    for (const [material, list] of this.map) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, material);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      list.forEach((g) => g.dispose());
    }
    this.map.clear();
  }
}

function scaleUV(geo, s) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s);
  }
  return geo;
}

const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const V = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Oriented box collider set. */
export class Colliders {
  constructor() {
    this.boxes = [];
  }
  add(x, z, hw, hd, rot, y0, y1) {
    this.boxes.push({ x, z, hw, hd, rot, cos: Math.cos(rot), sin: Math.sin(rot), y0, y1 });
  }
  /** Push a capsule/circle out of any colliders it overlaps. */
  resolve(pos, radius, feetY) {
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.boxes) {
        if (feetY > b.y1 - 0.1 || feetY + 1.7 < b.y0) continue;
        const dx = pos.x - b.x;
        const dz = pos.z - b.z;
        const lx = dx * b.cos - dz * b.sin;
        const lz = dx * b.sin + dz * b.cos;
        const px = b.hw + radius - Math.abs(lx);
        const pz = b.hd + radius - Math.abs(lz);
        if (px <= 0 || pz <= 0) continue;
        if (px < pz) {
          const nx = (lx >= 0 ? 1 : -1) * px;
          pos.x += nx * b.cos;
          pos.z += -nx * b.sin;
        } else {
          const nz = (lz >= 0 ? 1 : -1) * pz;
          pos.x += nz * b.sin;
          pos.z += nz * b.cos;
        }
      }
    }
    return pos;
  }
  pointInside(x, y, z, pad = 0) {
    for (const b of this.boxes) {
      if (y > b.y1 || y < b.y0) continue;
      const dx = x - b.x, dz = z - b.z;
      const lx = dx * b.cos - dz * b.sin;
      const lz = dx * b.sin + dz * b.cos;
      if (Math.abs(lx) < b.hw + pad && Math.abs(lz) < b.hd + pad) return true;
    }
    return false;
  }
  /** Segment vs colliders (ray occlusion). Returns the nearest t in [0,1]. */
  segmentHit(ax, ay, az, bx, by, bz) {
    let best = 1;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    for (const b of this.boxes) {
      // transform segment into box space
      const ox = ax - b.x, oz = az - b.z;
      const lox = ox * b.cos - oz * b.sin;
      const loz = ox * b.sin + oz * b.cos;
      const ldx = dx * b.cos - dz * b.sin;
      const ldz = dx * b.sin + dz * b.cos;
      let tmin = 0, tmax = 1;
      // x slab
      let t1 = (-b.hw - lox) / (ldx || 1e-9);
      let t2 = (b.hw - lox) / (ldx || 1e-9);
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      // z slab
      t1 = (-b.hd - loz) / (ldz || 1e-9);
      t2 = (b.hd - loz) / (ldz || 1e-9);
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      // y slab
      t1 = (b.y0 - ay) / (dy || 1e-9);
      t2 = (b.y1 - ay) / (dy || 1e-9);
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);

      if (tmin <= tmax && tmin < best && tmin > 0) best = tmin;
    }
    return best;
  }
}

export class World {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.colliders = new Colliders();
    this.loot = [];
    this.buildings = [];
    this.rng = mulberry32(777);
    this.time = 0;
    this.onLootCollected = null;
    this._initMaterials();
    this._buildTowns();
    this._buildProps();
    this.batcher.build(this.group);
    this._placeLoot();
  }

  _initMaterials() {
    // shared PBR sets (cached) — tints vary per material, mobile uses half res
    const px = this.terrain.quality && this.terrain.quality.grass === 0 ? 128 : 256;
    const wt = wallTextures(px, 0.80);
    const wt2 = wallTextures(px, 0.64);
    const mt = metalTextures(px, [148, 156, 162], 14);
    const mtFine = metalTextures(px, [120, 128, 134], 26);
    const wtWood = woodTextures(px, [124, 92, 58]);

    const wall = (tint, tex) => new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.roughnessMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 1.0,
      color: tint,
      envMapIntensity: 0.8,
    });
    const metal = (tint, tex) => new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.roughnessMap,
      roughness: 0.85,
      metalness: 0.62,
      color: tint,
      envMapIntensity: 1.0,
    });

    const crate = crateTexture(256, [110, 84, 48]);
    this.mats = {
      wallA: wall(0xc9cabb, wt),
      wallB: wall(0xc2ab96, wt2),
      wallC: wall(0x93a1a8, wt),
      concrete: wall(0x8f8d84, wt2),
      roof: metal(0x6d767c, mt),
      metal: metal(0x8d979d, mtFine),
      darkMetal: metal(0x3c444a, mtFine),
      rust: metal(0x9a5836, mt),
      wood: new THREE.MeshStandardMaterial({
        map: wtWood.map, normalMap: wtWood.normalMap, roughnessMap: wtWood.roughnessMap,
        roughness: 1.0, color: 0xa98a63, envMapIntensity: 0.5,
      }),
      woodDark: new THREE.MeshStandardMaterial({
        map: wtWood.map, normalMap: wtWood.normalMap, roughnessMap: wtWood.roughnessMap,
        roughness: 1.0, color: 0x6c4f36, envMapIntensity: 0.45,
      }),
      glass: new THREE.MeshStandardMaterial({
        color: 0x1b3b47, roughness: 0.08, metalness: 0.95,
        emissive: 0x05141a, envMapIntensity: 1.6,
      }),
      containerRed: metal(0xa8482f, mt),
      containerBlue: metal(0x2f668c, mt),
      containerGreen: metal(0x43714f, mt),
      sandbag: new THREE.MeshStandardMaterial({
        color: 0x9c8b64, roughness: 0.95, normalMap: wt.normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
      }),
      crate: new THREE.MeshStandardMaterial({
        map: crate, roughness: 0.88, normalMap: wtWood.normalMap, normalScale: new THREE.Vector2(0.6, 0.6),
      }),
      accent: new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6, emissive: 0x772800, emissiveIntensity: 0.5 }),
    };
  }

  _box(M, w, h, d, x, y, z, material, opts = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleUV(geo, (w + h + d) * 0.16);
    this.batcher.add(geo, material, M);
    if (opts.collide !== false) {
      V.set(x, 0, z).applyMatrix4(M);
      const rot = Math.atan2(-M.elements[2], M.elements[0]);
      const gy = this.terrain.heightAt(V.x, V.z);
      this.colliders.add(V.x, V.z, w / 2, d / 2, rot, gy + y - h / 2 + (opts.collideFrom ?? 0), gy + y + h / 2);
    }
  }

  _cyl(M, rt, rb, h, x, y, z, material, collide = false, radius = 0) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, 10, 1);
    this.batcher.add(geo, material, M);
    if (collide) {
      V.set(x, 0, z).applyMatrix4(M);
      const gy = this.terrain.heightAt(V.x, V.z);
      this.colliders.add(V.x, V.z, radius, radius, 0, gy - 1, gy + y + h / 2);
    }
  }

  // ---------------- buildings ----------------
  _house(x, z, rot, opt = {}) {
    const w = opt.w ?? 8;
    const d = opt.d ?? 7;
    const h = opt.h ?? 3.4;
    const gy = this.terrain.heightAt(x, z) - 0.15;
    M4.compose(new THREE.Vector3(x, gy, z), Q.setFromAxisAngle(UP, rot), new THREE.Vector3(1, 1, 1));
    const M = M4.clone();
    const wallMat = opt.mat ?? this.mats.wallA;
    const t = 0.32;

    // flush floor slab (no step, so doors are walkable)
    this._box(M, w + 0.3, 0.16, d + 0.3, 0, 0.06, 0, this.mats.concrete, { collide: false });

    const doorW = 2.0;
    const segW = (w - doorW) / 2;
    // front wall with door gap (+z side)
    this._box(M, segW, h, t, -(doorW / 2 + segW / 2), h / 2 + 0.12, d / 2 - t / 2, wallMat);
    this._box(M, segW, h, t, doorW / 2 + segW / 2, h / 2 + 0.12, d / 2 - t / 2, wallMat);
    // door lintel
    this._box(M, doorW, 0.6, t, 0, h - 0.1, d / 2 - t / 2, wallMat, { collide: false });
    // back & sides
    this._box(M, w, h, t, 0, h / 2 + 0.12, -d / 2 + t / 2, wallMat);
    this._box(M, t, h, d - 2 * t, -w / 2 + t / 2, h / 2 + 0.12, 0, wallMat);
    this._box(M, t, h, d - 2 * t, w / 2 - t / 2, h / 2 + 0.12, 0, wallMat);

    const roofY = h + 0.28;
    this._box(M, w + 0.5, 0.28, d + 0.5, 0, roofY + 0.14, 0, this.mats.roof);
    // parapet
    this._box(M, w + 0.5, 0.65, 0.18, 0, roofY + 0.6, d / 2 + 0.16, this.mats.concrete, { collide: false });
    this._box(M, w + 0.5, 0.65, 0.18, 0, roofY + 0.6, -d / 2 - 0.16, this.mats.concrete, { collide: false });
    this._box(M, 0.18, 0.65, d + 0.5, w / 2 + 0.16, roofY + 0.6, 0, this.mats.concrete, { collide: false });
    this._box(M, 0.18, 0.65, d + 0.5, -w / 2 - 0.16, roofY + 0.6, 0, this.mats.concrete, { collide: false });
    // rooftop unit + water tank + antenna for a stronger silhouette
    this._box(M, 1.4, 0.9, 1.1, w * 0.22, roofY + 0.7, -d * 0.2, this.mats.metal, { collide: false });
    if (opt.tank !== false) {
      const tank = new THREE.CylinderGeometry(0.85, 0.85, 1.5, 10);
      this.batcher.add(tank, this.mats.containerBlue, M4.clone().multiply(new THREE.Matrix4().makeTranslation(-w * 0.22, roofY + 1.2, d * 0.18)));
      this._box(M, 0.4, 0.4, 0.4, -w * 0.22, roofY + 0.45, d * 0.18, this.mats.darkMetal, { collide: false });
    }
    const mast = new THREE.CylinderGeometry(0.05, 0.05, 3.2, 5);
    this.batcher.add(mast, this.mats.darkMetal, M4.clone().multiply(new THREE.Matrix4().makeTranslation(w * 0.34, roofY + 1.8, -d * 0.3)));
    this._box(M, 0.9, 0.06, 0.06, w * 0.34, roofY + 3.2, -d * 0.3, this.mats.darkMetal, { collide: false });

    // windows
    for (const s of [-1, 1]) {
      this._box(M, 0.06, 1.0, 1.3, s * (w / 2 + 0.01), 2.1, d * 0.16, this.mats.glass, { collide: false });
      this._box(M, 1.2, 1.0, 0.06, -w * 0.18, 2.1, s * (d / 2 + 0.01), this.mats.glass, { collide: false });
    }
    // door frame
    this._box(M, doorW + 0.25, 0.16, 0.14, 0, h + 0.2, d / 2 + 0.02, this.mats.darkMetal, { collide: false });

    // interior props
    const crateMat = this.mats.crate;
    this._box(M, 1.1, 1.1, 1.1, -w * 0.28, 1.2, -d * 0.2, crateMat);
    this._box(M, 0.9, 0.7, 1.6, w * 0.3, 1.0, -d * 0.25, this.mats.wood);
    // exterior awning
    this._box(M, w * 0.55, 0.12, 1.8, 0, h + 0.05, d / 2 + 0.9, this.mats.rust, { collide: false });

    this.buildings.push({ x, z, w, d, h, type: 'house', gy });
    return new THREE.Vector3(x + Math.sin(rot) * 1.4, gy + 1.6, z + Math.cos(rot) * 1.4);
  }

  _warehouse(x, z, rot) {
    const w = 15, d = 11, h = 5.6;
    const gy = this.terrain.heightAt(x, z) - 0.15;
    M4.compose(new THREE.Vector3(x, gy, z), Q.setFromAxisAngle(UP, rot), new THREE.Vector3(1, 1, 1));
    const M = M4.clone();
    const t = 0.4;
    const mat = this.mats.wallC;

    this._box(M, w + 0.8, 0.5, d + 0.8, 0, 0.25, 0, this.mats.concrete);
    this._box(M, w, 0.2, d, 0, 0.56, 0, this.mats.concrete, { collide: false });

    const gateW = 6.5;
    const segW = (w - gateW) / 2;
    this._box(M, segW, h, t, -(gateW / 2 + segW / 2), h / 2 + 0.12, d / 2 - t / 2, mat);
    this._box(M, segW, h, t, gateW / 2 + segW / 2, h / 2 + 0.12, d / 2 - t / 2, mat);
    this._box(M, gateW, 1.0, t, 0, h - 0.2, d / 2 - t / 2, mat, { collide: false });
    this._box(M, w, h, t, 0, h / 2 + 0.12, -d / 2 + t / 2, mat);
    this._box(M, t, h, d - 2 * t, -w / 2 + t / 2, h / 2 + 0.12, 0, mat);
    this._box(M, t, h, d - 2 * t, w / 2 - t / 2, h / 2 + 0.12, 0, mat);

    // corrugated roof with slight overhang
    this._box(M, w + 1.2, 0.3, d + 1.2, 0, h + 0.3, 0, this.mats.roof);
    this._box(M, w + 1.2, 0.1, 0.5, 0, h + 0.5, d / 2 + 0.55, this.mats.darkMetal, { collide: false });
    // support beams
    for (let i = -1; i <= 1; i++) {
      this._box(M, 0.28, h, 0.28, i * w * 0.3, h / 2 + 0.12, d * 0.2, this.mats.darkMetal, { collide: false });
    }
    // interior stacks
    this._box(M, 2.4, 2.2, 2.0, -w * 0.28, 1.7, -d * 0.2, this.mats.crate);
    this._box(M, 2.0, 1.4, 1.6, -w * 0.28, 1.0, d * 0.12, this.mats.containerBlue);
    this._box(M, 1.6, 1.6, 1.6, w * 0.3, 1.4, -d * 0.24, this.mats.crate);
    this._box(M, 3.2, 1.2, 1.4, w * 0.18, 1.2, d * 0.22, this.mats.wood);
    // signage
    this._box(M, 4.0, 1.0, 0.12, 0, h - 0.4, d / 2 + 0.1, this.mats.accent, { collide: false });

    this.buildings.push({ x, z, w, d, h, type: 'warehouse', gy });
    return new THREE.Vector3(x + Math.sin(rot) * 2, gy + 1.6, z + Math.cos(rot) * 2);
  }

  _container(x, z, rot, stack = 1) {
    const colors = [this.mats.containerRed, this.mats.containerBlue, this.mats.containerGreen];
    const gy = this.terrain.heightAt(x, z) - 0.1;
    M4.compose(new THREE.Vector3(x, gy, z), Q.setFromAxisAngle(UP, rot), new THREE.Vector3(1, 1, 1));
    const M = M4.clone();
    const mat = pick(colors);
    const w = 7.0, h = 2.7, d = 2.6;
    for (let s = 0; s < stack; s++) {
      this._box(M, w, h, d, 0, 0.3 + h / 2 + s * h, 0, mat);
      // ribs
      for (let i = -2; i <= 2; i++) {
        this._box(M, 0.12, h * 0.92, d + 0.05, i * 1.35, 0.3 + h / 2 + s * h, 0, this.mats.darkMetal, { collide: false });
      }
    }
    this.buildings.push({ x, z, w, d, h: h * stack, type: 'container', gy });
  }

  _tower(x, z, rot) {
    const gy = this.terrain.heightAt(x, z) - 0.1;
    M4.compose(new THREE.Vector3(x, gy, z), Q.setFromAxisAngle(UP, rot), new THREE.Vector3(1, 1, 1));
    const M = M4.clone();
    const H = 7;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this._box(M, 0.3, H, 0.3, sx * 1.6, H / 2, sz * 1.6, this.mats.woodDark);
      }
    }
    // cross braces
    for (const sz of [-1, 1]) {
      const brace = new THREE.BoxGeometry(0.12, 3.4, 0.12);
      brace.rotateZ(0.62);
      this.batcher.add(brace, this.mats.woodDark, M4.clone().multiply(new THREE.Matrix4().makeTranslation(0, 3.6, sz * 1.6)));
    }
    this._box(M, 4.2, 0.3, 4.2, 0, H, 0, this.mats.wood);
    // railings
    for (const s of [-1, 1]) {
      this._box(M, 4.2, 0.9, 0.1, 0, H + 0.45, s * 2.05, this.mats.woodDark, { collide: false });
      this._box(M, 0.1, 0.9, 4.2, s * 2.05, H + 0.45, 0, this.mats.woodDark, { collide: false });
    }
    // roof
    const roof = new THREE.ConeGeometry(3.4, 1.4, 4);
    roof.rotateY(Math.PI / 4);
    this.batcher.add(roof, this.mats.roof, M4.clone().multiply(new THREE.Matrix4().makeTranslation(0, H + 1.1, 0)));
    this.buildings.push({ x, z, w: 4, d: 4, h: H, type: 'tower', gy });
  }

  _shack(x, z, rot) {
    const gy = this.terrain.heightAt(x, z) - 0.1;
    M4.compose(new THREE.Vector3(x, gy, z), Q.setFromAxisAngle(UP, rot), new THREE.Vector3(1, 1, 1));
    const M = M4.clone();
    const w = 4.4, d = 4.0, h = 2.5;
    this._box(M, w, 0.2, d, 0, 0.2, 0, this.mats.woodDark, { collide: false });
    this._box(M, w, h, 0.2, 0, h / 2 + 0.2, -d / 2, this.mats.wood);
    this._box(M, 0.2, h, d, -w / 2, h / 2 + 0.2, 0, this.mats.wood);
    this._box(M, 0.2, h, d, w / 2, h / 2 + 0.2, 0, this.mats.wood);
    this._box(M, w * 0.3, h, 0.2, -w * 0.35, h / 2 + 0.2, d / 2, this.mats.wood);
    this._box(M, w * 0.3, h, 0.2, w * 0.35, h / 2 + 0.2, d / 2, this.mats.wood);
    // rusty slanted roof
    const roof = new THREE.BoxGeometry(w + 0.8, 0.16, d + 0.8);
    roof.rotateX(0.12);
    this.batcher.add(roof, this.mats.rust, M4.clone().multiply(new THREE.Matrix4().makeTranslation(0, h + 0.4, 0)));
    this.buildings.push({ x, z, w, d, h, type: 'shack', gy });
  }

  _cover(x, z, rot, len = 3.4) {
    const gy = this.terrain.heightAt(x, z);
    M4.compose(new THREE.Vector3(x, gy, z), Q.setFromAxisAngle(UP, rot), new THREE.Vector3(1, 1, 1));
    const M = M4.clone();
    this._box(M, len, 0.6, 0.9, 0, 0.55, 0, this.mats.sandbag);
    this._box(M, len * 0.9, 0.55, 0.85, 0, 1.1, 0, this.mats.sandbag);
  }

  _barrels(x, z) {
    const gy = this.terrain.heightAt(x, z);
    for (let i = 0; i < 4; i++) {
      const px = x + (this.rng() - 0.5) * 3;
      const pz = z + (this.rng() - 0.5) * 3;
      const m = new THREE.Matrix4().makeTranslation(px, gy + 0.55, pz);
      this._cyl(m, 0.34, 0.34, 1.1, 0, 0.55, 0, this.rng() > 0.5 ? this.mats.rust : this.mats.containerBlue, false);
      this._cyl(m, 0.34, 0.34, 1.1, 0, 1.1, 0, this.mats.metal, false);
    }
  }

  _truck(x, z, rot) {
    const gy = this.terrain.heightAt(x, z);
    M4.compose(new THREE.Vector3(x, gy, z), Q.setFromAxisAngle(UP, rot), new THREE.Vector3(1, 1, 1));
    const M = M4.clone();
    this._box(M, 2.3, 2.4, 5.4, 0, 1.4, 0, this.mats.rust);
    this._box(M, 2.1, 1.6, 2.0, 0, 1.0, 3.6, this.mats.darkMetal);
    for (const sx of [-1, 1]) {
      for (const sz of [-1.6, 1.6, 3.6]) {
        const wheel = new THREE.CylinderGeometry(0.55, 0.55, 0.35, 10);
        wheel.rotateZ(Math.PI / 2);
        this.batcher.add(wheel, this.mats.darkMetal, M4.clone().multiply(new THREE.Matrix4().makeTranslation(sx * 1.15, 0.55, sz)));
      }
    }
  }

  // ---------------- towns ----------------
  _buildTowns() {
    const rng = this.rng;
    this.batcher = new Batcher();
    this.lootSpots = [];

    for (const poi of this.terrain.pois) {
      const count = Math.max(6, Math.floor(poi.r / 9.5));
      const placed = [];
      for (let attempt = 0; attempt < count * 8 && placed.length < count; attempt++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * poi.r * 0.82;
        const x = poi.x + Math.cos(a) * r;
        const z = poi.z + Math.sin(a) * r;
        if (this.terrain.heightAt(x, z) < 2.5) continue;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 14)) continue;
        const rot = Math.floor(rng() * 4) * (Math.PI / 2) + (rng() - 0.5) * 0.25;
        const roll = rng();
        let spot = null;
        if (roll < 0.42) spot = this._house(x, z, rot, { mat: pick([this.mats.wallA, this.mats.wallB]) });
        else if (roll < 0.6) spot = this._warehouse(x, z, rot);
        else if (roll < 0.78) { this._container(x, z, rot, rng() > 0.6 ? 2 : 1); spot = new THREE.Vector3(x, 1, z); }
        else if (roll < 0.9) this._tower(x, z, rot);
        else this._shack(x, z, rot);
        placed.push({ x, z });
        if (spot) this.lootSpots.push(spot);
      }

      // scattered cover & barrels around the settlement
      const coverCount = 5 + Math.floor(poi.r / 16);
      for (let i = 0; i < coverCount; i++) {
        const a = rng() * Math.PI * 2;
        const r = poi.r * (0.35 + rng() * 0.8);
        const x = poi.x + Math.cos(a) * r;
        const z = poi.z + Math.sin(a) * r;
        if (this.terrain.heightAt(x, z) < 2.2) continue;
        if (rng() > 0.55) this._cover(x, z, rng() * Math.PI, 2.6 + rng() * 2.4);
      }
      for (let i = 0; i < 3; i++) {
        const a = rng() * Math.PI * 2;
        const r = poi.r * (0.4 + rng() * 0.6);
        const x = poi.x + Math.cos(a) * r;
        const z = poi.z + Math.sin(a) * r;
        if (this.terrain.heightAt(x, z) > 2.5) this._barrels(x, z);
      }
    }

    // roadside wrecks
    for (let i = 0; i < 16; i++) {
      const p = this.terrain.randomLandPoint(this.rng, 4);
      if (!p) continue;
      if (this.terrain.nearPOI(p.x, p.z, -10)) continue;
      this._truck(p.x, p.z, this.rng() * Math.PI * 2);
    }
  }

  _buildProps() {
    // A few tent camps for visual interest
    for (let i = 0; i < 6; i++) {
      const p = this.terrain.randomLandPoint(this.rng, 5);
      const gy = this.terrain.heightAt(p.x, p.z);
      for (let t = 0; t < 3; t++) {
        const tex = new THREE.ConeGeometry(2.2, 2.2, 4);
        tex.rotateY(Math.PI / 4);
        const m = new THREE.Matrix4().makeTranslation(p.x + t * 4.4, gy + 1.1, p.z + (this.rng() - 0.5) * 2);
        this.batcher.add(tex, t % 2 ? this.mats.wood : this.mats.containerGreen, m);
      }
    }
  }

  // ---------------- loot ----------------
  _mergeByMaterial(group) {
    group.updateMatrixWorld(true);
    const buckets = new Map();
    group.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      if (!buckets.has(o.material)) buckets.set(o.material, []);
      buckets.get(o.material).push(g);
    });
    const out = new THREE.Group();
    for (const [mat, geos] of buckets) {
      const merged = mergeGeometries(geos, false);
      if (merged) out.add(new THREE.Mesh(merged, mat));
      geos.forEach((g) => g.dispose());
    }
    return out;
  }

  _makeLootMesh(type, weaponId) {
    const group = new THREE.Group();
    let height = 0.55;
    if (type === 'weapon') {
      const gun = this._mergeByMaterial(buildLootWeapon(weaponId));
      gun.rotation.z = 0.2;
      group.add(gun);
      height = 0.75;
    } else if (type === 'medkit') {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.36, 0.42),
        new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 })
      );
      box.castShadow = true;
      group.add(box);
      const crossMat = new THREE.MeshStandardMaterial({ color: 0xd8352a, roughness: 0.6, emissive: 0x330a08 });
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.44), crossMat);
      c1.position.y = 0.02;
      group.add(c1);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.44), crossMat);
      c2.position.y = 0.02;
      group.add(c2);
    } else if (type === 'armor') {
      const vest = new THREE.Mesh(
        new THREE.BoxGeometry(0.52, 0.4, 0.3),
        new THREE.MeshStandardMaterial({ color: 0x2e6f9c, roughness: 0.5, metalness: 0.4 })
      );
      vest.castShadow = true;
      group.add(vest);
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.24, 0.34),
        new THREE.MeshStandardMaterial({ color: 0x76c7f2, roughness: 0.3, metalness: 0.6 })
      );
      group.add(plate);
    } else {
      const ammo = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.28, 0.34),
        new THREE.MeshStandardMaterial({ color: 0x8a6b2e, roughness: 0.65, metalness: 0.3 })
      );
      ammo.castShadow = true;
      group.add(ammo);
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.48, 0.09, 0.36),
        new THREE.MeshStandardMaterial({ color: 0xffb43a, emissive: 0x633f00, roughness: 0.5 })
      );
      group.add(stripe);
    }

    const glowTex = this.sparkGlow();
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffb161,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    glow.scale.setScalar(1.9);
    group.add(glow);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.78, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffa040,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -height + 0.06;
    group.add(ring);

    group.userData.baseY = height;
    group.userData.ring = ring;
    group.userData.glow = glow;
    return group;
  }

  sparkGlow() {
    if (!this._glow) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.4, 'rgba(255,190,110,0.4)');
      g.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      this._glow = new THREE.CanvasTexture(c);
    }
    return this._glow;
  }

  addLoot(x, z, type, weaponId = null, amount = 0) {
    const gy = this.terrain.heightAt(x, z);
    const mesh = this._makeLootMesh(type, weaponId);
    mesh.position.set(x, gy, z);
    this.group.add(mesh);
    const item = { type, weaponId, amount, mesh, x, z, y: gy, taken: false, phase: Math.random() * 6.28 };
    this.loot.push(item);
    return item;
  }

  _placeLoot() {
    const rng = this.rng;
    const weaponIds = ['ak', 'm4', 'mp40', 'shotgun', 'awm', 'scar', 'ak', 'm4', 'mp40'];
    
    // guaranteed village loot
    for (const spot of this.lootSpots) {
      if (rng() > 0.82) continue;
      const roll = rng();
      if (roll < 0.5) this.addLoot(spot.x + (rng() - 0.5) * 1.6, spot.z + (rng() - 0.5) * 1.6, 'weapon', pick(weaponIds));
      else if (roll < 0.7) this.addLoot(spot.x + (rng() - 0.5) * 1.6, spot.z + (rng() - 0.5) * 1.6, 'ammo', null, 60);
      else if (roll < 0.88) this.addLoot(spot.x + (rng() - 0.5) * 1.6, spot.z + (rng() - 0.5) * 1.6, 'medkit');
      else this.addLoot(spot.x + (rng() - 0.5) * 1.6, spot.z + (rng() - 0.5) * 1.6, 'armor');
    }

    // outdoor loot spread across the island
    for (let i = 0; i < 46; i++) {
      const p = this.terrain.randomLandPoint(rng, 4);
      if (!p) continue;
      const roll = rng();
      if (roll < 0.42) this.addLoot(p.x, p.z, 'weapon', pick(weaponIds));
      else if (roll < 0.66) this.addLoot(p.x, p.z, 'ammo', null, 45 + Math.floor(rng() * 60));
      else if (roll < 0.86) this.addLoot(p.x, p.z, 'medkit');
      else this.addLoot(p.x, p.z, 'armor');
    }
  }

  /** Animate loot & handle proximity pickups. */
  update(dt, player, onPickup) {
    this.time += dt;
    for (const item of this.loot) {
      if (item.taken) continue;
      const m = item.mesh;
      if (player) {
        const ddx = player.position.x - item.x;
        const ddz = player.position.z - item.z;
        const near = ddx * ddx + ddz * ddz < 90 * 90;
        if (m.visible !== near) m.visible = near;
        if (!near) continue;
      }
      const bob = Math.sin(this.time * 2 + item.phase) * 0.09;
      m.position.y = item.y + m.userData.baseY + bob + 0.35;
      m.rotation.y += dt * 1.1;
      m.userData.ring.scale.setScalar(1 + Math.sin(this.time * 3 + item.phase) * 0.08);
      if (player && player.alive) {
        const dx = player.position.x - item.x;
        const dz = player.position.z - item.z;
        const dy = player.position.y - item.y;
        if (dx * dx + dz * dz < 4.6 && Math.abs(dy) < 2.4) {
          if (onPickup(item)) {
            item.taken = true;
            this.group.remove(m);
            m.traverse((o) => {
              if (o.isMesh) {
                if (o.geometry) o.geometry.dispose();
              }
            });
          }
        }
      }
    }
  }

  reset() {
    for (const item of this.loot) {
      if (item.taken) {
        item.taken = false;
        this.group.add(item.mesh);
      }
    }
  }
}

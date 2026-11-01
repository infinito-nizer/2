import * as THREE from 'three';
import { radialTexture, smokeTexture, bulletHoleTexture } from '../engine/textures.js';
import { rand } from '../engine/utils.js';

// ============================================================
// VFX: bullets, impacts, decals, particles, explosions
// ============================================================
const MAX_PARTICLES = 520;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.aoIgnore = [];
    this.transients = [];
    this.decalPool = [];
    this.decalIndex = 0;
    this.sparkTex = radialTexture(64, [
      [0, 'rgba(255,255,255,1)'],
      [0.35, 'rgba(255,220,150,0.85)'],
      [1, 'rgba(255,140,30,0)'],
    ]);
    this.smokeTex = smokeTexture(128);
    this.holeTex = bulletHoleTexture(128);
    this.onDamageNumber = null;

    this._initParticles();
    this._initTracers();
    this._initDecals();

    this.flashLight = new THREE.PointLight(0xffb166, 0, 26, 2);
    this.flashLight.castShadow = false;
    scene.add(this.flashLight);
    this.flashLife = 0;

    this.boomLight = new THREE.PointLight(0xff8636, 0, 90, 2);
    this.boomLight.castShadow = false;
    scene.add(this.boomLight);
    this.boomLife = 0;
  }

  // ---------------- particles ----------------
  _initParticles() {
    this.parts = [];
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.pAlpha = new Float32Array(MAX_PARTICLES);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3));
    this.pGeo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    this.pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.pAlpha, 1));
    this.pGeo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: this.sparkTex },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uPixelRatio;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPixelRatio * (260.0 / max(0.4, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          if (t.a < 0.02) discard;
          gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.pGeo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.scene.add(this.points);
  }

  spawnParticle(x, y, z, opts = {}) {
    if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
    this.parts.push({
      x, y, z,
      vx: opts.vx ?? 0, vy: opts.vy ?? 0, vz: opts.vz ?? 0,
      life: opts.life ?? 0.5,
      maxLife: opts.life ?? 0.5,
      size: opts.size ?? 4,
      r: opts.r ?? 1, g: opts.g ?? 0.8, b: opts.b ?? 0.4,
      gravity: opts.gravity ?? 9,
      drag: opts.drag ?? 1.6,
      fade: opts.fade ?? 1,
    });
  }

  // ---------------- tracers ----------------
  _initTracers() {
    this.tracers = [];
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, 0.5);
    for (let i = 0; i < 26; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe0a8,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.tracers.push({ mesh, mat, life: 0, max: 0.09 });
    }
    this.tracerIdx = 0;
  }

  tracer(from, to, color = 0xffe0a8) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    const len = from.distanceTo(to);
    t.mesh.scale.set(0.045, 0.045, Math.max(0.2, len));
    t.mesh.visible = true;
    t.mat.color.setHex(color);
    t.mat.opacity = 1;
    t.life = t.max;
  }

  // ---------------- decals ----------------
  _initDecals() {
    const geo = new THREE.PlaneGeometry(0.34, 0.34);
    for (let i = 0; i < 90; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.holeTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      this.decalPool.push({ mesh, mat, life: 0 });
    }
  }

  decal(point, normal) {
    const d = this.decalPool[this.decalIndex];
    this.decalIndex = (this.decalIndex + 1) % this.decalPool.length;
    d.mesh.position.copy(point).addScaledVector(normal, 0.02);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    d.mesh.quaternion.copy(q);
    d.mesh.rotateZ(Math.random() * Math.PI * 2);
    d.mesh.visible = true;
    d.mat.opacity = 0.95;
    d.mesh.scale.setScalar(0.7 + Math.random() * 0.6);
    d.life = 30;
  }

  // ---------------- high-level effects ----------------
  muzzleFlash(pos, dir) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.sparkTex,
        color: 0xffcf8a,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      })
    );
    sprite.position.copy(pos).addScaledVector(dir, 0.1);
    const s = 0.55 + Math.random() * 0.3;
    sprite.scale.set(s, s, s);
    this.scene.add(sprite);
    this.transients.push({ obj: sprite, life: 0.06, max: 0.06, type: 'sprite' });

    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 12;
    this.flashLight.distance = 26;
    this.flashLife = 0.055;

    // sparks out of the muzzle
    for (let i = 0; i < 3; i++) {
      this.spawnParticle(pos.x, pos.y, pos.z, {
        vx: dir.x * rand(4, 12) + rand(-2, 2),
        vy: dir.y * rand(4, 12) + rand(-1, 2),
        vz: dir.z * rand(4, 12) + rand(-2, 2),
        life: rand(0.08, 0.2),
        size: rand(2, 5),
        r: 1, g: 0.75, b: 0.35,
        gravity: 2,
      });
    }
  }

  impact(point, normal, flesh = false) {
    const n = normal.clone();
    if (!flesh) this.decal(point, n);

    const base = flesh ? [1, 0.55, 0.3] : [1, 0.85, 0.6];
    for (let i = 0; i < (flesh ? 12 : 9); i++) {
      const spread = 6;
      this.spawnParticle(point.x, point.y, point.z, {
        vx: (n.x * 3 + rand(-1, 1)) * rand(1, spread),
        vy: (n.y * 3 + rand(-0.2, 1.2)) * rand(1, spread),
        vz: (n.z * 3 + rand(-1, 1)) * rand(1, spread),
        life: rand(0.18, 0.5),
        size: rand(2, 5.5),
        r: base[0], g: base[1], b: base[2],
        gravity: 14,
        drag: 2,
      });
    }
    // dust puff
    for (let i = 0; i < 4; i++) {
      this.spawnParticle(point.x, point.y, point.z, {
        vx: n.x * rand(0.5, 2) + rand(-0.7, 0.7),
        vy: rand(0.3, 1.6),
        vz: n.z * rand(0.5, 2) + rand(-0.7, 0.7),
        life: rand(0.4, 0.9),
        size: rand(8, 15),
        r: 0.55, g: 0.5, b: 0.42,
        gravity: 1.2,
        drag: 2.4,
      });
    }
  }

  bloodMist(point) {
    for (let i = 0; i < 6; i++) {
      this.spawnParticle(point.x, point.y, point.z, {
        vx: rand(-2, 2), vy: rand(0.5, 3), vz: rand(-2, 2),
        life: rand(0.25, 0.5), size: rand(5, 10),
        r: 0.65, g: 0.12, b: 0.1, gravity: 3, drag: 2,
      });
    }
  }

  deathBurst(point) {
    for (let i = 0; i < 18; i++) {
      this.spawnParticle(point.x, point.y + rand(0, 1), point.z, {
        vx: rand(-4, 4), vy: rand(1, 6), vz: rand(-4, 4),
        life: rand(0.3, 0.9), size: rand(6, 14),
        r: 0.8, g: 0.15, b: 0.1, gravity: 5, drag: 1.4,
      });
    }
  }

  explosion(pos) {
    const mat = new THREE.SpriteMaterial({
      map: this.sparkTex,
      color: 0xffb060,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const spr = new THREE.Sprite(mat);
    spr.position.copy(pos);
    spr.scale.setScalar(2);
    this.scene.add(spr);
    this.transients.push({ obj: spr, life: 0.5, max: 0.5, type: 'boom' });

    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = rand(0, 1);
      const sp = rand(3, 16);
      this.spawnParticle(pos.x, pos.y, pos.z, {
        vx: Math.cos(a) * sp,
        vy: up * sp * 0.8,
        vz: Math.sin(a) * sp,
        life: rand(0.35, 1.1),
        size: rand(5, 16),
        r: 1, g: rand(0.4, 0.8), b: 0.2,
        gravity: 8, drag: 1.2,
      });
    }
    for (let i = 0; i < 22; i++) {
      this.spawnParticle(pos.x, pos.y + 0.4, pos.z, {
        vx: rand(-3, 3), vy: rand(0.5, 4), vz: rand(-3, 3),
        life: rand(0.9, 2.2),
        size: rand(18, 40),
        r: 0.18, g: 0.17, b: 0.16,
        gravity: 1.1, drag: 2.2,
      });
    }
    this.boomLight.position.copy(pos).add(new THREE.Vector3(0, 1, 0));
    this.boomLight.intensity = 400;
    this.boomLife = 0.45;
  }

  // ---------------- update ----------------
  update(dt) {
    // particles (swap-remove dead)
    const parts = this.parts;
    let write = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.gravity * dt;
      const dragF = Math.max(0, 1 - p.drag * dt);
      p.vx *= dragF; p.vz *= dragF;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

      const k = write * 3;
      this.pPos[k] = p.x; this.pPos[k + 1] = p.y; this.pPos[k + 2] = p.z;
      const t = p.life / p.maxLife;
      const fade = Math.pow(t, 0.7);
      this.pCol[k] = p.r; this.pCol[k + 1] = p.g; this.pCol[k + 2] = p.b;
      this.pSize[write] = p.size * (0.4 + t * 0.8);
      this.pAlpha[write] = fade * p.fade;
      parts[write] = p;
      write++;
    }
    parts.length = write;
    this.pGeo.setDrawRange(0, write);
    if (write > 0) {
      this.pGeo.attributes.position.needsUpdate = true;
      this.pGeo.attributes.aColor.needsUpdate = true;
      this.pGeo.attributes.aSize.needsUpdate = true;
      this.pGeo.attributes.aAlpha.needsUpdate = true;
    }

    // tracers
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mat.opacity = Math.max(0, t.life / t.max);
      if (t.life <= 0) t.mesh.visible = false;
    }

    // decals fade out near end of life
    for (const d of this.decalPool) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life < 2) d.mat.opacity = Math.max(0, d.life / 2) * 0.95;
      if (d.life <= 0) d.mesh.visible = false;
    }

    // muzzle light
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flashLight.intensity = Math.max(0, this.flashLife / 0.055) * 12;
      if (this.flashLife <= 0) this.flashLight.intensity = 0;
    }
    if (this.boomLife > 0) {
      this.boomLife -= dt;
      this.boomLight.intensity = Math.max(0, this.boomLife / 0.45) * 400;
      if (this.boomLife <= 0) this.boomLight.intensity = 0;
    }

    // transients
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const t = this.transients[i];
      t.life -= dt;
      const k = Math.max(0, t.life / t.max);
      if (t.type === 'sprite') {
        t.obj.material.opacity = k;
        t.obj.scale.multiplyScalar(1 + dt * 4);
      } else if (t.type === 'boom') {
        t.obj.material.opacity = k;
        t.obj.scale.setScalar(2 + (1 - k) * 16);
      }
      if (t.life <= 0) {
        this.scene.remove(t.obj);
        if (t.obj.material) t.obj.material.dispose();
        this.transients.splice(i, 1);
      }
    }
  }
}

import * as THREE from 'three';
import { clamp, lerp, formatTime } from '../engine/utils.js';

// ============================================================
// Shrinking safe zone with an animated barrier
// ============================================================
const PHASES = [
  { r: 400, wait: 42, shrink: 26, dmg: 2 },
  { r: 285, wait: 32, shrink: 22, dmg: 3.5 },
  { r: 200, wait: 26, shrink: 20, dmg: 5 },
  { r: 138, wait: 22, shrink: 17, dmg: 7 },
  { r: 88, wait: 18, shrink: 14, dmg: 9 },
  { r: 48, wait: 14, shrink: 12, dmg: 12 },
  { r: 20, wait: 10, shrink: 20, dmg: 16 },
];

export class Zone {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.center = new THREE.Vector2(0, 20);
    this.radius = 600;
    this.startRadius = 600;
    this.nextRadius = PHASES[0].r;
    this.nextCenter = new THREE.Vector2(0, 20);
    this.phase = 0;
    this.state = 'wait';
    this.timer = PHASES[0].wait;
    this.damagePerSecond = 2;
    this.time = 0;
    this.onPhase = null;

    this.uniforms = {
      uTime: { value: 0 },
      uRadius: { value: 600 },
      uColor: { value: new THREE.Color(0x36c8ff) },
      uOpacity: { value: 0.42 },
    };

    const geo = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        uniform float uTime, uOpacity;
        uniform vec3 uColor;
        void main() {
          float v = vUv.y;
          // vertical falloff
          float fade = smoothstep(0.0, 0.10, v) * smoothstep(1.0, 0.72, v);
          // flowing energy bands
          float bands = sin(vWorld.y * 0.55 - uTime * 2.4 + sin(vWorld.x * 0.06 + uTime) * 3.0);
          bands = smoothstep(0.35, 1.0, bands);
          float scan = smoothstep(0.0, 0.03, abs(fract(v * 5.0 - uTime * 0.5) - 0.5));
          float grid = smoothstep(0.85, 1.0, sin(vWorld.x * 0.35 + uTime * 0.4) * cos(vWorld.z * 0.35 - uTime * 0.35));
          float a = uOpacity * (0.32 + bands * 0.55 + grid * 0.25 + scan * 0.2) * fade;
          gl_FragColor = vec4(uColor * (1.1 + bands * 0.6), a);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  reset() {
    this.phase = 0;
    this.center.set(0, 20);
    this.radius = this.startRadius;
    this.nextRadius = PHASES[0].r;
    this.state = 'wait';
    this.timer = PHASES[0].wait;
    this.damagePerSecond = PHASES[0].dmg;
    this.time = 0;
    this._pickNextCenter();
    this.mesh.visible = true;
    this._syncMesh();
  }

  _pickNextCenter() {
    const p = PHASES[Math.min(this.phase, PHASES.length - 1)];
    this.nextRadius = p.r;
    const maxOffset = Math.max(0, this.radius - p.r) * 0.82;
    let found = false;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * maxOffset;
      const x = this.center.x + Math.cos(a) * r;
      const z = this.center.y + Math.sin(a) * r;
      if (this.terrain.heightAt(x, z) > -2) {
        this.nextCenter.set(x, z);
        found = true;
        break;
      }
    }
    if (!found) this.nextCenter.copy(this.center);
  }

  contains(x, z, margin = 0) {
    const dx = x - this.center.x;
    const dz = z - this.center.y;
    return dx * dx + dz * dz < (this.radius - margin) * (this.radius - margin);
  }

  get timeLeft() {
    return Math.max(0, this.timer);
  }

  update(dt, game) {
    this.time += dt;
    this.timer -= dt;
    const phaseData = PHASES[Math.min(this.phase, PHASES.length - 1)];

    if (this.state === 'wait') {
      if (this.timer <= 0) {
        this.state = 'shrink';
        this.timer = phaseData.shrink;
        this.shrinkFrom = this.radius;
        this.shrinkFromCenter = this.center.clone();
        this.shrinkTotal = phaseData.shrink;
        if (this.onPhase) this.onPhase('shrink', this);
        game.hud.banner('ZONE CLOSING', 1600);
      }
    } else if (this.state === 'shrink') {
      const t = 1 - clamp(this.timer / (this.shrinkTotal || 1), 0, 1);
      this.radius = lerp(this.shrinkFrom, this.nextRadius, t);
      this.center.set(
        lerp(this.shrinkFromCenter.x, this.nextCenter.x, t),
        lerp(this.shrinkFromCenter.y, this.nextCenter.y, t)
      );
      if (this.timer <= 0) {
        this.radius = this.nextRadius;
        this.center.copy(this.nextCenter);
        this.phase++;
        this.state = 'wait';
        const next = PHASES[Math.min(this.phase, PHASES.length - 1)];
        this.timer = next.wait;
        this.damagePerSecond = next.dmg;
        this._pickNextCenter();
        if (this.phase >= PHASES.length) {
          this.state = 'final';
          this.timer = 9999;
          this.damagePerSecond = 20;
        }
        if (this.onPhase) this.onPhase('wait', this);
      }
    }

    this._syncMesh();

    // damage everyone outside
    this.outsideTick = (this.outsideTick || 0) + dt;
    if (this.outsideTick > 0.5) {
      this.outsideTick = 0;
      const p = game.player;
      if (p.alive && !this.contains(p.position.x, p.position.z, 0)) {
        p.damage(this.damagePerSecond * 0.5, null);
        game.hud.setZoneWarning(true);
      } else if (p.alive) {
        game.hud.setZoneWarning(false);
      }
    }

    this.uniforms.uTime.value = this.time;
  }

  _syncMesh() {
    this.mesh.position.set(this.center.x, 40, this.center.y);
    this.mesh.scale.set(this.radius, 110, this.radius);
    this.uniforms.uRadius.value = this.radius;
    this.uniforms.uOpacity.value = this.state === 'shrink' ? 0.5 : 0.36;
  }

  getLabel() {
    if (this.state === 'final') return 'FINAL ZONE';
    return this.state === 'shrink' ? 'ZONE CLOSING' : 'NEXT ZONE';
  }

  timeLabel() {
    return formatTime(this.timer);
  }
}

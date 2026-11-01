import * as THREE from 'three';

// ============================================================
// Physical-ish sky dome: gradient + HDR sun + drifting fbm clouds
// ============================================================
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // push to far plane
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uCloudy;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + 7.1;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, 0.0, 1.0);

  vec3 sky = mix(uHorizon, uTop, pow(h, 0.42));
  sky = mix(uGround, sky, smoothstep(-0.18, 0.015, dir.y));

  float sunD = max(dot(dir, uSunDir), 0.0);
  // wide scattering halo
  sky += uSunColor * pow(sunD, 6.0) * 0.16;
  sky += uSunColor * pow(sunD, 90.0) * 0.55;
  // sun disk (HDR — feeds bloom)
  sky += uSunColor * smoothstep(0.9985, 0.9995, sunD) * 9.0;

  // ---- clouds ----
  if (dir.y > 0.004) {
    vec2 uv = dir.xz / (dir.y + 0.16) * 0.55;
    uv += vec2(uTime * 0.0055, uTime * 0.0022);
    float n = fbm(uv * 1.35);
    float n2 = fbm(uv * 2.7 + 3.7);
    float cover = smoothstep(0.53 - uCloudy * 0.1, 0.80, n * 0.72 + n2 * 0.28);
    // fade at horizon
    cover *= smoothstep(0.0, 0.22, dir.y) * (0.75 + uCloudy * 0.35);
    float sunAmt = pow(sunD, 2.4);
    vec3 lit = mix(vec3(0.62, 0.68, 0.80), uSunColor * 1.25 + vec3(0.25), 0.28 + 0.5 * sunAmt);
    float shade = fbm(uv * 3.3 + 11.0);
    lit *= mix(0.62, 1.06, shade);
    // silver lining near the sun
    lit += uSunColor * pow(sunD, 22.0) * 1.6;
    sky = mix(sky, lit, clamp(cover, 0.0, 0.95));
  }

  gl_FragColor = vec4(sky, 1.0);
}
`;

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.sunDir = new THREE.Vector3(0.52, 0.38, -0.76).normalize();
    this.top = new THREE.Color(0x1a4f94);
    this.horizon = new THREE.Color(0xf6d3a4);
    this.ground = new THREE.Color(0x9a8f80);
    this.sunColor = new THREE.Color(0xfff0d2).multiplyScalar(1.0);

    this.uniforms = {
      uTop: { value: this.top.clone() },
      uHorizon: { value: this.horizon.clone() },
      uGround: { value: this.ground.clone() },
      uSunDir: { value: this.sunDir.clone() },
      uSunColor: { value: this.sunColor.clone() },
      uTime: { value: 0 },
      uCloudy: { value: 0.45 },
    };

    const geo = new THREE.SphereGeometry(1, 32, 20);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.setScalar(1);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    scene.add(this.mesh);

    // ---------- lights ----------
    this.sun = new THREE.DirectionalLight(0xffe7c4, 2.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 700;
    const s = 150;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.045;
    this.sun.shadow.radius = 2.2;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xa9cdf0, 0x4a4034, 0.85);
    scene.add(this.hemi);
    this.fill = new THREE.AmbientLight(0x5a7392, 0.22);
    scene.add(this.fill);
  }

  setShadowQuality(size) {
    this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** Keep the sky centered on camera and shadows tight around the player. */
  update(time, camera, focus) {
    this.uniforms.uTime.value = time;
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(4000);
    // scale is applied to a unit sphere -> radius 4000

    this.sun.position.copy(focus).addScaledVector(this.sunDir, 260);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
  }
}

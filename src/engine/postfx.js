import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.72 },
    uSat: { value: 1.14 },
    uAber: { value: 0.55 },
    uDamage: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uSat, uAber, uDamage;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float d = length(c);
      float ab = uAber * d * d * 0.02;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab).b;

      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * 1.045 + 0.5;
      // warm highlight lift / cool shadow lift (subtle cinematic grade)
      col += vec3(0.012, 0.004, -0.008) * smoothstep(0.55, 1.0, l);
      col += vec3(-0.01, 0.0, 0.016) * (1.0 - smoothstep(0.0, 0.4, l));

      float vig = smoothstep(0.92, 0.28, d);
      col *= mix(1.0, vig, uVignette);

      // damage pulse at the edges
      col = mix(col, vec3(0.55, 0.02, 0.02), uDamage * smoothstep(0.28, 0.95, d));

      float grain = fract(sin(dot(uv * vec2(12.9898, 78.233) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      col += (grain - 0.5) * 0.018;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export const QUALITY = {
  low: { dpr: 1.0, shadow: 1024, bloom: false, smaa: false, exposure: 1.0 },
  medium: { dpr: 1.35, shadow: 1536, bloom: true, smaa: false, exposure: 1.02 },
  high: { dpr: 2.0, shadow: 2048, bloom: true, smaa: true, exposure: 1.05 },
};

export class RenderPipeline {
  constructor(canvas, scene, camera, qualityName = 'high') {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = scene;
    this.camera = camera;

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.75, 0.82);
    this.outputPass = new OutputPass();
    this.gradePass = new ShaderPass(GradeShader);
    this.smaaPass = new SMAAPass();

    // linear HDR chain: scene -> bloom -> SMAA -> tonemap/encode -> cinematic grade
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.smaaPass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.gradePass);

    this.setQuality(qualityName);
    this.resize();
  }

  setQuality(name) {
    const q = QUALITY[name] || QUALITY.high;
    this.qualityName = name;
    this.q = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    this.renderer.toneMappingExposure = q.exposure;
    this.bloom.enabled = q.bloom;
    this.smaaPass.enabled = q.smaa;
    this.resize();
  }

  setDamage(v) {
    this.gradePass.uniforms.uDamage.value = v;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.smaaPass.setSize) this.smaaPass.setSize(w, h);
  }

  render(time, dt) {
    this.gradePass.uniforms.uTime.value = time;
    this.composer.render(dt);
  }
}

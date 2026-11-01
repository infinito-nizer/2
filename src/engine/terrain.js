import * as THREE from 'three';
import { fbm, ridged, smoothstep, clamp, lerp, mulberry32, valueNoise } from './utils.js';
import {
  frondTexture, grassTexture, groundTextures, barkTexture, leafCardTexture,
} from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WORLD = { size: 1500, half: 750, waterLevel: 0 };
const GRID = 257;

/** Points of interest — main loot towns. */
export const POIS = [
  { name: 'CAPE TOWN', x: 0, z: 30, r: 78 },
  { name: 'BERMUDA', x: -285, z: 195, r: 58 },
  { name: 'RIVERSIDE', x: 280, z: -145, r: 62 },
  { name: 'CLOCKTOWER', x: 120, z: 335, r: 54 },
  { name: 'SHIPYARD', x: -300, z: -255, r: 60 },
  { name: 'PEAK CAMP', x: 70, z: -330, r: 48 },
  { name: 'SUNSET DOCKS', x: 375, z: 130, r: 50 },
];

const C = {
  wetSand: new THREE.Color(0x8f8060),
  sand: new THREE.Color(0xdcc99a),
  grassA: new THREE.Color(0x78954c),
  grassB: new THREE.Color(0x55713b),
  forest: new THREE.Color(0x35492c),
  rock: new THREE.Color(0x87806f),
  rockHi: new THREE.Color(0x9a9182),
  dirt: new THREE.Color(0x7b6b4d),
};

export class Terrain {
  constructor(scene, quality = {}) {
    this.scene = scene;
    this.quality = quality;
    this.G = GRID;
    this.spacing = WORLD.size / (GRID - 1);
    this.heights = new Float32Array(GRID * GRID);
    this.pois = POIS.map((p) => ({ ...p, h: 20 }));
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.rng = mulberry32(1337);
  }

  // ---------------- height field ----------------
  rawHeight(x, z) {
    const d = Math.hypot(x, z * 0.94);
    const warp = (fbm(x * 0.0042 + 31.7, z * 0.0042 + 8.3, 3) - 0.5) * 118;
    const dd = (d + warp) / 548;
    const island = smoothstep(1.05, 0.56, dd);
    const base = (fbm(x * 0.0042 + 5.2, z * 0.0042 + 1.3, 4) - 0.44) * 84;
    const detail = (fbm(x * 0.013 + 2.0, z * 0.013 + 9.0, 3) - 0.5) * 9;
    const ridge = ridged(x * 0.0075 + 7.0, z * 0.0075 + 2.0, 3) * 30;
    const massif = smoothstep(0.48, 0.92, fbm(x * 0.0026 + 21.3, z * 0.0026 + 9.1, 3)) * 26;
    let h = 15 + base * 0.66 + ridge * 0.62 + detail + massif;
    h *= island;
    h -= 17 * (1 - island);
    return h;
  }

  generateField() {
    const { G, spacing, heights } = this;
    for (let j = 0; j < G; j++) {
      const z = -WORLD.half + j * spacing;
      for (let i = 0; i < G; i++) {
        const x = -WORLD.half + i * spacing;
        heights[j * G + i] = this.rawHeight(x, z);
      }
    }
    // Flatten town sites so buildings sit on level ground.
    for (const poi of this.pois) {
      const center = this.sampleFieldRaw(poi.x, poi.z);
      poi.h = Math.max(center, 6.5);
      const R = poi.r;
      for (let j = 0; j < G; j++) {
        const z = -WORLD.half + j * spacing;
        for (let i = 0; i < G; i++) {
          const x = -WORLD.half + i * spacing;
          const d = Math.hypot(x - poi.x, z - poi.z);
          if (d > R) continue;
          const t = smoothstep(R, R * 0.35, d);
          const idx = j * G + i;
          heights[idx] = lerp(heights[idx], poi.h, t);
        }
      }
    }
  }

  sampleFieldRaw(x, z) {
    const gx = clamp((x + WORLD.half) / this.spacing, 0, GRID - 1.001);
    const gz = clamp((z + WORLD.half) / this.spacing, 0, GRID - 1.001);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const h = this.heights;
    const a = h[j * GRID + i], b = h[j * GRID + i + 1];
    const c = h[(j + 1) * GRID + i], d = h[(j + 1) * GRID + i + 1];
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
  }

  /** Bilinear terrain sample — the single source of truth for ground height. */
  heightAt(x, z) {
    return this.sampleFieldRaw(x, z);
  }

  normalAt(x, z) {
    const e = 2.0;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return new THREE.Vector3(hl - hr, 2 * e, hd - hu).normalize();
  }

  slopeAt(x, z) {
    return 1 - this.normalAt(x, z).y;
  }

  isLand(x, z, margin = 0.6) {
    return this.heightAt(x, z) > WORLD.waterLevel + margin;
  }

  nearPOI(x, z, pad = 0) {
    for (const p of this.pois) {
      if (Math.hypot(x - p.x, z - p.z) < p.r + pad) return p;
    }
    return null;
  }

  // ---------------- mesh ----------------
  buildMesh() {
    const { G, spacing, heights } = this;
    const count = G * G;
    const pos = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const colors = new Float32Array(count * 3);

    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const k = j * G + i;
        const x = -WORLD.half + i * spacing;
        const z = -WORLD.half + j * spacing;
        pos[k * 3] = x;
        pos[k * 3 + 1] = heights[k];
        pos[k * 3 + 2] = z;
        uv[k * 2] = i / (G - 1);
        uv[k * 2 + 1] = j / (G - 1);
      }
    }

    const idx = new Uint32Array((G - 1) * (G - 1) * 6);
    let o = 0;
    for (let j = 0; j < G - 1; j++) {
      for (let i = 0; i < G - 1; i++) {
        const a = j * G + i, b = a + 1, c = a + G, d = c + 1;
        idx[o++] = a; idx[o++] = c; idx[o++] = b;
        idx[o++] = b; idx[o++] = c; idx[o++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    const normals = geo.attributes.normal.array;
    const tmp = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
      const ny = normals[k * 3 + 1];
      const n = valueNoise(x * 0.05, z * 0.05);
      const n2 = fbm(x * 0.012 + 4.1, z * 0.012 + 8.7, 2);
      const n3 = fbm(x * 0.038 + 11.3, z * 0.038 + 2.9, 3);   // mid-scale mottling
      const n4 = valueNoise(x * 0.31, z * 0.31);              // fine speckle

      if (y < 0.4) {
        // wet, dark sand right at the waterline
        tmp.copy(C.wetSand).multiplyScalar(0.82 + n * 0.1);
      } else if (y < 2.1) {
        tmp.copy(C.wetSand).lerp(C.sand, smoothstep(0.4, 1.9, y));
        tmp.multiplyScalar(0.88 + smoothstep(0.4, 1.9, y) * 0.12);
      } else if (y < 3.4) {
        tmp.copy(C.sand).lerp(C.grassA, smoothstep(2.1, 3.4, y));
      } else {
        tmp.copy(C.grassA).lerp(C.grassB, smoothstep(5, 24, y) * 0.85 + n2 * 0.25);
        tmp.lerp(C.forest, smoothstep(0.42, 0.8, n2) * 0.62);
        // organic mid-scale patchiness so large fields never look flat
        tmp.lerp(C.grassB, smoothstep(0.45, 0.78, n3) * 0.4);
        tmp.lerp(C.forest, smoothstep(0.6, 0.86, n3) * 0.3);
        if (y > 42) tmp.lerp(C.rock, smoothstep(42, 62, y) * 0.55);
      }
      // dirt / trodden patches
      if (y > 3.2 && n2 > 0.62 && ny > 0.9) tmp.lerp(C.dirt, (n2 - 0.62) * 1.6);
      if (y > 4 && n3 > 0.72 && ny > 0.94) tmp.lerp(C.dirt, (n3 - 0.72) * 0.9);
      // cliffs + strata
      const steep = smoothstep(0.86, 0.58, ny);
      if (steep > 0) {
        tmp.lerp(ny > 0.7 ? C.rock : C.rockHi, steep * 0.92);
        const strata = 0.5 + 0.5 * Math.sin(y * 1.35 + n3 * 6.0);
        tmp.multiplyScalar(1 - steep * (0.1 + strata * 0.12));
      }
      // fine grain + brightness variation
      const v = (0.9 + n * 0.2) * (0.97 + n4 * 0.06);
      colors[k * 3] = tmp.r * v;
      colors[k * 3 + 1] = tmp.g * v;
      colors[k * 3 + 2] = tmp.b * v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // ---- PBR ground detail: tileable normal + roughness + albedo grain ----
    const gt = groundTextures(this.quality.grass === 0 ? 256 : 512);
    const detail = gt.map;
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
    gt.normalMap.repeat.set(280, 280);
    gt.roughnessMap.repeat.set(90, 90);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      normalMap: gt.normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughnessMap: gt.roughnessMap,
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: 0.75,
    });
    // Albedo micro-grain injected as a multiplier (keeps the vertex palette intact).
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDetail = { value: detail };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vDetailUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vDetailUv = uv * 280.0;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nvarying vec2 vDetailUv;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\n  diffuseColor.rgb *= mix(1.0, texture2D(uDetail, vDetailUv).rgb * 1.55, 0.55);'
        );
    };

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.group.add(this.mesh);

    // height texture for the water shader
    const data = new Uint8Array(GRID * GRID * 4);
    for (let k = 0; k < count; k++) {
      const v = clamp((heights[k] + 30) / 150, 0, 1);
      data[k * 4] = Math.round(v * 255);
      data[k * 4 + 3] = 255;
    }
    this.heightTexture = new THREE.DataTexture(data, GRID, GRID, THREE.RGBAFormat);
    this.heightTexture.minFilter = THREE.LinearFilter;
    this.heightTexture.magFilter = THREE.LinearFilter;
    this.heightTexture.wrapS = this.heightTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTexture.needsUpdate = true;
  }

  // ---------------- water ----------------
  buildWater() {
    const uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.52, 0.38, -0.76).normalize() },
      uSunColor: { value: new THREE.Color(0xffe6bd) },
      uSkyColor: { value: new THREE.Color(0x8fb6d8) },
      uHorizon: { value: new THREE.Color(0xf3d3a8) },
      uDeep: { value: new THREE.Color(0x06202e) },
      uShallow: { value: new THREE.Color(0x1f7f78) },
      uCamPos: { value: new THREE.Vector3() },
      uHeightTex: { value: this.heightTexture },
      uWorldSize: { value: WORLD.size },
      uFogColor: { value: new THREE.Color(0xd8cdb8) },
      uFogDensity: { value: 0.00052 },
      uTimeOffset: { value: 0 },
    };
    this.waterUniforms = uniforms;

    const mat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vWorld;
        uniform float uTime;
        uniform vec3 uSunDir, uSunColor, uSkyColor, uHorizon, uDeep, uShallow, uCamPos, uFogColor;
        uniform sampler2D uHeightTex;
        uniform float uWorldSize, uFogDensity;

        float terrainH(vec2 xz) {
          vec2 uv = xz / uWorldSize + 0.5;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return -30.0;
          return texture2D(uHeightTex, uv).r * 150.0 - 30.0;
        }

        // Procedural sky reflection so the ocean mirrors the real horizon + sun.
        vec3 skyColor(vec3 R) {
          float h = clamp(R.y, 0.0, 1.0);
          vec3 c = mix(uHorizon, uSkyColor * 0.62, pow(h, 0.52));
          float sd = max(dot(R, uSunDir), 0.0);
          c += uSunColor * pow(sd, 14.0) * 0.5;
          c += uSunColor * pow(sd, 500.0) * 7.0;
          c = mix(uDeep * 0.55, c, smoothstep(-0.06, 0.015, R.y));
          return c;
        }

        void main() {
          vec2 p = vWorld.xz;
          float t = uTime;
          // layered gerstner-ish normal
          vec3 n = vec3(0.0, 1.0, 0.0);
          n.x += sin(p.x * 0.085 + t * 0.95) * 0.062;
          n.x += sin(p.x * 0.21 - t * 1.45 + p.y * 0.05) * 0.028;
          n.x += sin((p.x + p.y) * 0.13 + t * 0.55) * 0.03;
          n.z += cos(p.y * 0.095 + t * 0.82) * 0.062;
          n.z += cos(p.y * 0.24 - t * 1.2 + p.x * 0.04) * 0.028;
          n.z += cos((p.x - p.y) * 0.115 + t * 0.48) * 0.03;
          n = normalize(n);

          vec3 V = normalize(uCamPos - vWorld);
          float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.2);
          float depth = clamp(-terrainH(p), 0.0, 30.0);

          vec3 col = mix(uShallow, uDeep, smoothstep(0.5, 14.0, depth));
          // subsurface glow in the shallows
          col += uShallow * smoothstep(4.0, 0.4, depth) * 0.35;
          // mirror the sky
          vec3 R = reflect(-V, n);
          vec3 refl = skyColor(R);
          col = mix(col, refl, clamp(fres * 1.25, 0.0, 0.94));

          // sun specular (sharp glint + broad sheen)
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(n, H), 0.0), 420.0);
          col += uSunColor * spec * 4.5;
          float gloss = pow(max(dot(n, H), 0.0), 26.0);
          col += uSunColor * gloss * 0.16;
          // fine sparkle from the small wave octaves
          float spark = pow(max(dot(normalize(n + vec3(0.06, 0.0, 0.05)), H), 0.0), 900.0);
          col += uSunColor * spark * 6.0;

          // shoreline foam
          float shore = smoothstep(2.2, 0.05, depth);
          float wob = sin(p.x * 0.5 + t * 1.7) * cos(p.y * 0.42 - t * 1.3);
          float foam = shore * smoothstep(0.35, 0.95, 0.55 + 0.45 * wob);
          foam += smoothstep(0.55, 0.0, depth) * 0.35;
          col = mix(col, vec3(0.9, 0.95, 0.92), clamp(foam, 0.0, 0.8));

          // distance fog
          float dist = length(uCamPos - vWorld);
          float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist * 1.6);
          col = mix(col, uFogColor, clamp(fogF, 0.0, 0.95));

          float alpha = mix(0.62, 1.0, smoothstep(0.0, 3.5, depth));
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    const geo = new THREE.CircleGeometry(3400, 96);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = WORLD.waterLevel;
    this.water.renderOrder = 2;
    this.water.frustumCulled = false;
    this.group.add(this.water);
  }

  // ---------------- vegetation & props ----------------
  scatterProps() {
    const rng = mulberry32(90210);
    const R = 470;

    const validPoint = (minH = 2.2, maxH = 70, maxSlope = 0.52, poiPad = 0) => {
      for (let tries = 0; tries < 24; tries++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * R;
        const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.95;
        const h = this.heightAt(x, z);
        if (h < minH || h > maxH) continue;
        if (this.slopeAt(x, z) > maxSlope) continue;
        if (poiPad && this.nearPOI(x, z, poiPad)) continue;
        return { x, z, h };
      }
      return null;
    };

    // ---- trunks: tapered, gently bent, bark-textured ----
    const trunkGeo = new THREE.CylinderGeometry(0.19, 0.5, 7.0, 8, 4);
    trunkGeo.translate(0, 3.5, 0);
    {
      const p = trunkGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const t = Math.max(0, y) / 7.0;
        p.setX(i, p.getX(i) + t * t * 0.55);
      }
      trunkGeo.computeVertexNormals();
    }
    const bark = barkTexture(256);
    bark.wrapS = bark.wrapT = THREE.RepeatWrapping;
    bark.repeat.set(1.2, 2.6);

    const TREES = this.quality.grass === 0 ? 120 : 250;
    const trunkMat = new THREE.MeshStandardMaterial({
      map: bark,
      color: 0xa99b86,
      roughness: 0.97,
      metalness: 0.0,
      envMapIntensity: 0.35,
    });

    // ---- canopies: clusters of alpha-tested leaf cards (real silhouette) ----
    const leafTex = leafCardTexture(256);
    const leafMat = new THREE.MeshStandardMaterial({
      map: leafTex,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 0.78,
      metalness: 0.0,
      color: 0xffffff,
      envMapIntensity: 0.6,
    });
    this._addSway(leafMat, 0.05, 1.0);

    const canopyCards = [];
    for (let c = 0; c < 13; c++) {
      const a = rng() * Math.PI * 2;
      const rr = Math.pow(rng(), 0.7) * 1.9;
      const card = new THREE.PlaneGeometry(3.4, 3.0);
      const eul = new THREE.Euler((rng() - 0.5) * 1.1, a, (rng() - 0.5) * 1.1, 'YXZ');
      card.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(eul));
      card.translate(Math.cos(a) * rr, (rng() - 0.3) * 1.5 + 0.4, Math.sin(a) * rr);
      canopyCards.push(card);
    }
    const canopyGeo = mergeGeometries(canopyCards);

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREES);
    const leaves = new THREE.InstancedMesh(canopyGeo, leafMat, TREES);
    trunks.castShadow = true;
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    trunks.receiveShadow = true;

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const col = new THREE.Color();
    let li = 0;

    for (let i = 0; i < TREES; i++) {
      const p = validPoint(2.6, 64, 0.42, 12) || { x: (rng() - 0.5) * 500, z: (rng() - 0.5) * 500, h: 20 };
      const scale = 0.8 + rng() * 0.9;
      e.set(0, rng() * Math.PI * 2, (rng() - 0.5) * 0.06);
      q.setFromEuler(e);
      s.set(scale, scale * (0.85 + rng() * 0.45), scale);
      m4.compose(pos.set(p.x, p.h - 0.2, p.z), q, s);
      trunks.setMatrixAt(i, m4);

      // canopy sits on top of the trunk, slightly larger than the crown
      const cs = scale * (1.25 + rng() * 0.55);
      e.set(0, rng() * Math.PI * 2, 0);
      q.setFromEuler(e);
      m4.compose(
        pos.set(p.x + 0.5 * scale, p.h + 5.4 * scale, p.z),
        q,
        s.set(cs, cs * (0.82 + rng() * 0.35), cs)
      );
      leaves.setMatrixAt(li, m4);
      const g = 0.62 + rng() * 0.45;
      col.setRGB(g * 0.92, g, g * 0.82);
      leaves.setColorAt(li, col);
      li++;
    }
    leaves.count = li;
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    this.group.add(trunks, leaves);
    this.foliage = this.foliage || [];
    this.foliage.push(trunks, leaves);

    // ---------------- palm trees (merged, instanced) ----------------
    const palmSpots = [];
    for (let i = 0; i < 60; i++) {
      const p = validPoint(0.9, 7.5, 0.6, 0);
      if (p) palmSpots.push(p);
    }
    if (palmSpots.length) {
      const trunkPts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        trunkPts.push(new THREE.Vector3(Math.pow(t, 2) * 1.9, t * 7.6, 0));
      }
      const curve = new THREE.CatmullRomCurve3(trunkPts);
      const palmTrunkGeo = new THREE.TubeGeometry(curve, 8, 0.26, 6, false);
      // taper is faked with two cones on top
      const palmBark = barkTexture(128);
      palmBark.wrapS = palmBark.wrapT = THREE.RepeatWrapping;
      palmBark.repeat.set(1, 4);
      const palmTrunkMat = new THREE.MeshStandardMaterial({ map: palmBark, color: 0xa8987c, roughness: 0.92 });

      const frondGeos = [];
      const frondTex = frondTexture(256);
      for (let f = 0; f < 9; f++) {
        const g = new THREE.PlaneGeometry(1.5, 4.4, 1, 1);
        g.translate(0, 2.2, 0);
        const m = new THREE.Matrix4();
        const eul = new THREE.Euler(
          -Math.PI * (0.62 + (f % 3) * 0.09),
          (f / 9) * Math.PI * 2,
          0,
          'YXZ'
        );
        m.makeRotationFromEuler(eul);
        g.applyMatrix4(m);
        g.translate(1.7, 7.2, 0);
        frondGeos.push(g);
      }
      const palmFrondGeo = mergeGeometries(frondGeos);
      const palmFrondMat = new THREE.MeshStandardMaterial({
        map: frondTex,
        transparent: true,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        roughness: 0.72,
        color: 0xc4dd9c,
        envMapIntensity: 0.5,
      });
      this._addSway(palmFrondMat, 0.09, 1.0);

      const tMesh = new THREE.InstancedMesh(palmTrunkGeo, palmTrunkMat, palmSpots.length);
      const fMesh = new THREE.InstancedMesh(palmFrondGeo, palmFrondMat, palmSpots.length);
      tMesh.castShadow = true;
      fMesh.castShadow = true;
      palmSpots.forEach((p, i) => {
        const sc = 0.8 + rng() * 0.55;
        e.set(0, rng() * Math.PI * 2, 0);
        q.setFromEuler(e);
        m4.compose(pos.set(p.x, p.h - 0.3, p.z), q, s.set(sc, sc * (0.9 + rng() * 0.3), sc));
        tMesh.setMatrixAt(i, m4);
        fMesh.setMatrixAt(i, m4);
      });
      this.group.add(tMesh, fMesh);
      this.foliage = this.foliage || [];
      this.foliage.push(tMesh, fMesh);
    }

    // ---------------- rocks ----------------
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b8578, roughness: 0.98, flatShading: true });
    const ROCKS = 140;
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCKS);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    for (let i = 0; i < ROCKS; i++) {
      const p = validPoint(0.2, 70, 0.75, 0) || { x: (rng() - 0.5) * 500, z: (rng() - 0.5) * 500, h: 12 };
      const sc = 0.7 + rng() * 2.6;
      e.set(rng() * 3, rng() * 3, rng() * 3);
      q.setFromEuler(e);
      m4.compose(pos.set(p.x, p.h - sc * 0.35, p.z), q, s.set(sc, sc * (0.6 + rng() * 0.5), sc));
      rocks.setMatrixAt(i, m4);
    }
    this.group.add(rocks);

    // ---------------- bushes / shrubs ---------------- (leaf cards)
    const bushCards = [];
    for (let c = 0; c < 6; c++) {
      const a = rng() * Math.PI * 2;
      const card = new THREE.PlaneGeometry(1.5, 1.35);
      card.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler((rng() - 0.5) * 0.7, a, (rng() - 0.5) * 0.7, 'YXZ')
      ));
      card.translate(Math.cos(a) * 0.42, 0.55 + rng() * 0.35, Math.sin(a) * 0.42);
      bushCards.push(card);
    }
    const bushGeo = mergeGeometries(bushCards);
    const bushMat = new THREE.MeshStandardMaterial({
      map: leafTex, alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.85, color: 0x9fd08a, envMapIntensity: 0.4,
    });
    this._addSway(bushMat, 0.04, 1.0);
    const BUSHES = this.quality.grass === 0 ? 120 : 260;
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, BUSHES);
    bushes.castShadow = true;
    bushes.receiveShadow = true;
    for (let i = 0; i < BUSHES; i++) {
      const p = validPoint(2.4, 62, 0.5, 8) || { x: (rng() - 0.5) * 460, z: (rng() - 0.5) * 460, h: 20 };
      const sc = 0.7 + rng() * 1.35;
      e.set(0, rng() * 3, 0);
      q.setFromEuler(e);
      m4.compose(pos.set(p.x, p.h - 0.08, p.z), q, s.set(sc, sc * (0.75 + rng() * 0.5), sc));
      bushes.setMatrixAt(i, m4);
      const g = 0.8 + rng() * 0.35;
      col.setRGB(0.82 * g, g, 0.78 * g);
      bushes.setColorAt(i, col);
    }
    if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
    this.group.add(bushes);
    this.foliage = this.foliage || [];
    this.foliage.push(bushes);

    // ---------------- ferns / undergrowth ----------------
    if (this.quality.grass > 0) {
      const fernCards = [];
      for (let c = 0; c < 4; c++) {
        const a = (c / 4) * Math.PI * 2 + rng() * 0.5;
        const card = new THREE.PlaneGeometry(1.15, 1.0);
        card.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(
          new THREE.Euler(-0.5 - rng() * 0.3, a, 0, 'YXZ')
        ));
        card.translate(Math.cos(a) * 0.3, 0.42, Math.sin(a) * 0.3);
        fernCards.push(card);
      }
      const fernGeo = mergeGeometries(fernCards);
      const fernMat = new THREE.MeshStandardMaterial({
        map: leafTex, alphaTest: 0.42, side: THREE.DoubleSide,
        roughness: 0.9, color: 0xa6c98c, envMapIntensity: 0.35,
      });
      this._addSway(fernMat, 0.06, 1.0);
      const FERNS = 900;
      const ferns = new THREE.InstancedMesh(fernGeo, fernMat, FERNS);
      ferns.receiveShadow = true;
      for (let i = 0; i < FERNS; i++) {
        const p = validPoint(3.4, 58, 0.42, 10) || { x: (rng() - 0.5) * 460, z: (rng() - 0.5) * 460, h: 20 };
        const sc = 0.7 + rng() * 0.9;
        e.set(0, rng() * Math.PI * 2, 0);
        q.setFromEuler(e);
        m4.compose(pos.set(p.x, p.h - 0.05, p.z), q, s.set(sc, sc, sc));
        ferns.setMatrixAt(i, m4);
        const g = 0.78 + rng() * 0.4;
        col.setRGB(0.78 * g, g, 0.7 * g);
        ferns.setColorAt(i, col);
      }
      if (ferns.instanceColor) ferns.instanceColor.needsUpdate = true;
      this.group.add(ferns);
      this.foliage.push(ferns);
    }

    // ---------------- grass ----------------
    if (this.quality.grass > 0) this.buildGrass(rng);
  }

  /** Wind sway injected into a material (works with instancing). */
  _addSway(mat, amount = 0.06, heightScale = 1.0) {
    const uniforms = { uTime: { value: 0 } };
    mat.userData.sway = uniforms;
    if (!this.swayMaterials) this.swayMaterials = [];
    this.swayMaterials.push(uniforms);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            vec3 anchor = vec3(0.0);
            #ifdef USE_INSTANCING
              anchor = instanceMatrix[3].xyz;
            #endif
            float ph = anchor.x * 0.35 + anchor.z * 0.27;
            float sw = sin(uTime * 1.35 + ph) * ${amount.toFixed(3)} + sin(uTime * 2.7 + ph * 1.7) * ${(amount * 0.4).toFixed(3)};
            transformed.x += sw * max(transformed.y, 0.0) * ${heightScale.toFixed(2)};
            transformed.z += sw * 0.6 * max(transformed.y, 0.0) * ${heightScale.toFixed(2)};
          }`
        );
    };
  }

  buildGrass(rng) {
    const COUNT = this.quality.grass;
    const tex = grassTexture(128);
    // a clump of several crossed blades reads much denser than a single quad
    const blades = [];
    for (let b = 0; b < 5; b++) {
      const plane = new THREE.PlaneGeometry(0.95, 0.9, 1, 1);
      plane.translate(0, 0.45, 0);
      plane.rotateY((b / 5) * Math.PI * 2 + rng() * 0.6);
      plane.rotateZ((rng() - 0.5) * 0.18);
      plane.translate((rng() - 0.5) * 0.75, 0, (rng() - 0.5) * 0.75);
      blades.push(plane);
    }
    const geo = mergeGeometries(blades);

    const mat = new THREE.MeshLambertMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      color: 0xffffff,
    });
    const uniforms = { uTime: { value: 0 } };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 iPos = instanceMatrix[3].xyz;
            float sway = sin(uTime * 1.7 + iPos.x * 0.6 + iPos.z * 0.45) * 0.14
                       + sin(uTime * 3.1 + iPos.x * 1.3) * 0.05;
            transformed.x += sway * transformed.y;
            transformed.z += sway * 0.5 * transformed.y;
          #endif`
        );
    };
    this.grassUniforms = uniforms;

    const grass = new THREE.InstancedMesh(geo, mat, COUNT);
    grass.frustumCulled = false;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < COUNT; i++) {
      let x, z, h;
      for (let tries = 0; tries < 12; tries++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * 470;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r * 0.95;
        h = this.heightAt(x, z);
        if (h > 3.2 && h < 60 && this.slopeAt(x, z) < 0.45) break;
      }
      e.set(0, rng() * Math.PI, 0);
      q.setFromEuler(e);
      const sc = 0.75 + rng() * 0.95;
      s.set(sc * 1.5, sc * 0.95, sc * 1.5);
      m4.compose(p.set(x, h - 0.05, z), q, s);
      grass.setMatrixAt(i, m4);
    }
    this.grass = grass;
    this.group.add(grass);
  }

  buildDistantIslands() {
    const rng = mulberry32(4242);
    const mats = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: false });
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + rng() * 0.5;
      const dist = 1150 + rng() * 620;
      const r = 180 + rng() * 260;
      const hgt = 46 + rng() * 62;
      const geo = new THREE.SphereGeometry(1, 26, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) {
        const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
        const warp = 0.72 + 0.55 * fbm(px * 2.4 + i * 7.3, pz * 2.4 + i * 3.1, 3);
        pos.setXYZ(v, px * warp, py * (0.75 + 0.5 * fbm(px * 1.7 + 3.1, pz * 1.7 + 6.2, 2)), pz * warp);
        const t = Math.max(0, Math.min(1, py * 1.6));
        // deep green to hazy blue-grey at height
        const c = new THREE.Color(0x2c4a33).lerp(new THREE.Color(0x6e7f7a), t * 0.85);
        colors[v * 3] = c.r; colors[v * 3 + 1] = c.g; colors[v * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.scale(r, hgt, r * (0.7 + rng() * 0.6));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mats);
      mesh.position.set(Math.cos(angle) * dist, -1.5, Math.sin(angle) * dist);
      mesh.rotation.y = rng() * Math.PI * 2;
      this.group.add(mesh);
    }
  }

  build(quality) {
    this.quality = quality;
    this.generateField();
    this.buildMesh();
    this.buildWater();
    this.buildDistantIslands();
    this.scatterProps();
    return this;
  }

  update(time, camera) {
    if (this.swayMaterials) {
      for (const u of this.swayMaterials) u.uTime.value = time;
    }
    if (this.waterUniforms) {
      this.waterUniforms.uTime.value = time;
      this.waterUniforms.uCamPos.value.copy(camera.position);
      this.waterUniforms.uFogDensity.value = this.scene.fog ? this.scene.fog.density : 0.00052;
      if (this.scene.fog) this.waterUniforms.uFogColor.value.copy(this.scene.fog.color);
    }
    if (this.grassUniforms) this.grassUniforms.uTime.value = time;
  }

  /** Random dry-land point for spawns, avoiding POIs if requested. */
  randomLandPoint(rng = Math.random, minH = 3) {
    for (let i = 0; i < 200; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 440;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.95;
      if (this.heightAt(x, z) > minH && this.slopeAt(x, z) < 0.4) return { x, z, y: this.heightAt(x, z) };
    }
    return { x: 0, z: 40, y: this.heightAt(0, 40) };
  }
}

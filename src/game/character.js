import * as THREE from 'three';
import { clamp, lerp } from '../engine/utils.js';

// ============================================================
// Procedural low-poly operator with a simple joint rig
// ============================================================
function mat(color, rough = 0.72, metal = 0.12) {
  return new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal, envMapIntensity: 0.7,
  });
}

function mesh(geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

export function createCharacter(opts = {}) {
  const skin = opts.skin ?? 0xc79b7a;
  const shirt = opts.shirt ?? 0x24313f;
  const pants = opts.pants ?? 0x1d2733;
  const accent = opts.accent ?? 0xff7a1a;
  const vestColor = opts.vest ?? 0x2c3a44;
  const hairColor = opts.hair ?? 0x171310;

  const M = {
    skin: mat(skin, 0.85, 0),
    shirt: mat(shirt, 0.78, 0.05),
    pants: mat(pants, 0.82, 0.04),
    accent: mat(accent, 0.6, 0.25),
    vest: mat(vestColor, 0.68, 0.18),
    dark: mat(0x14181d, 0.7, 0.3),
    hair: mat(hairColor, 0.9, 0),
    metal: mat(0x535c66, 0.4, 0.8),
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // ---- hips ----
  const hips = mesh(new THREE.BoxGeometry(0.34, 0.24, 0.24), M.pants);
  hips.position.y = 0.9;
  body.add(hips);
  const belt = mesh(new THREE.BoxGeometry(0.37, 0.08, 0.27), M.dark);
  belt.position.y = 1.02;
  body.add(belt);

  // ---- upper body ----
  const upper = new THREE.Group();
  upper.position.y = 0.95;
  body.add(upper);

  const torso = mesh(new THREE.BoxGeometry(0.46, 0.5, 0.27), M.shirt);
  torso.position.y = 0.3;
  upper.add(torso);

  const chestRig = mesh(new THREE.BoxGeometry(0.4, 0.32, 0.12), M.vest);
  chestRig.position.set(0, 0.33, 0.16);
  upper.add(chestRig);
  // magazine pouches
  for (let i = -1; i <= 1; i++) {
    const p = mesh(new THREE.BoxGeometry(0.09, 0.14, 0.07), M.dark);
    p.position.set(i * 0.13, 0.28, 0.24);
    upper.add(p);
  }
  // backpack
  const pack = mesh(new THREE.BoxGeometry(0.34, 0.38, 0.18), M.vest);
  pack.position.set(0, 0.33, -0.21);
  upper.add(pack);
  const packTop = mesh(new THREE.BoxGeometry(0.26, 0.1, 0.14), M.dark);
  packTop.position.set(0, 0.54, -0.21);
  upper.add(packTop);
  // chest cross-straps
  for (const s of [-1, 1]) {
    const strap = mesh(new THREE.BoxGeometry(0.045, 0.46, 0.045), M.dark);
    strap.position.set(s * 0.13, 0.33, 0.225);
    strap.rotation.z = s * 0.24;
    upper.add(strap);
  }
  // radio on the left shoulder strap
  const radio = mesh(new THREE.BoxGeometry(0.07, 0.11, 0.045), M.dark);
  radio.position.set(-0.17, 0.44, 0.16);
  upper.add(radio);
  const antenna = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5), M.metal);
  antenna.position.set(-0.17, 0.56, 0.16);
  upper.add(antenna);
  // shoulders: rounded pauldrons
  for (const s of [-1, 1]) {
    const pad = mesh(new THREE.CapsuleGeometry(0.085, 0.05, 4, 8), M.accent);
    pad.rotation.z = Math.PI / 2;
    pad.scale.set(1, 1, 1.15);
    pad.position.set(s * 0.275, 0.485, 0);
    upper.add(pad);
  }

  // ---- head ----
  const neck = mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 6), M.skin);
  neck.position.y = 0.58;
  upper.add(neck);
  const head = mesh(new THREE.SphereGeometry(0.135, 12, 10), M.skin);
  head.scale.set(0.92, 1.05, 0.95);
  head.position.y = 0.71;
  upper.add(head);
  const hair = mesh(new THREE.SphereGeometry(0.138, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), M.hair);
  hair.scale.set(0.95, 0.95, 0.98);
  hair.position.y = 0.725;
  upper.add(hair);
  const helmet = mesh(
    new THREE.SphereGeometry(0.152, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
    opts.helmetColor ? mat(opts.helmetColor, 0.5, 0.3) : M.vest
  );
  helmet.scale.set(1, 0.92, 1.04);
  helmet.position.y = 0.735;
  upper.add(helmet);
  const visor = mesh(new THREE.BoxGeometry(0.19, 0.045, 0.06), M.dark);
  visor.position.set(0, 0.73, 0.115);
  upper.add(visor);
  const goggleL = mesh(new THREE.BoxGeometry(0.055, 0.045, 0.02), M.accent);
  goggleL.position.set(0, 0.743, 0.143);
  upper.add(goggleL);
  // helmet brim
  const brim = mesh(new THREE.CylinderGeometry(0.155, 0.16, 0.022, 14, 1, true), M.dark);
  brim.position.y = 0.688;
  upper.add(brim);
  // face mask (chin/mouth cover) + eyes
  const maskGeo = new THREE.BoxGeometry(0.145, 0.075, 0.075);
  const faceMask = mesh(maskGeo, M.dark);
  faceMask.position.set(0, 0.672, 0.075);
  upper.add(faceMask);
  for (const s of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.016, 6, 5), M.dark);
    eye.position.set(s * 0.048, 0.712, 0.118);
    upper.add(eye);
  }

  // ---- arms ----
  const arms = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.29, 0.47, 0);
    upper.add(shoulder);

    const upArm = mesh(new THREE.CapsuleGeometry(0.058, 0.19, 4, 8), M.shirt);
    upArm.position.y = -0.15;
    shoulder.add(upArm);

    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    const foreArm = mesh(new THREE.CapsuleGeometry(0.052, 0.18, 4, 8), M.skin);
    foreArm.position.y = -0.14;
    elbow.add(foreArm);
    const glove = mesh(new THREE.BoxGeometry(0.09, 0.11, 0.1), M.dark);
    glove.position.y = -0.29;
    elbow.add(glove);

    arms[side] = { shoulder, elbow, glove };
  }

  // ---- legs ----
  const legs = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;
    const hip = new THREE.Group();
    hip.position.set(s * 0.115, 0.86, 0);
    body.add(hip);

    const thigh = mesh(new THREE.CapsuleGeometry(0.077, 0.24, 4, 8), M.pants);
    thigh.position.y = -0.2;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);
    const shin = mesh(new THREE.CapsuleGeometry(0.066, 0.23, 4, 8), M.pants);
    shin.position.y = -0.18;
    knee.add(shin);
    const kneepad = mesh(new THREE.SphereGeometry(0.075, 8, 6), M.dark);
    kneepad.scale.set(1, 0.8, 0.7);
    kneepad.position.set(0, 0, 0.04);
    knee.add(kneepad);
    const boot = mesh(new THREE.BoxGeometry(0.115, 0.11, 0.22), M.dark);
    boot.position.set(0, -0.4, 0.035);
    knee.add(boot);
    const sole = mesh(new THREE.BoxGeometry(0.12, 0.028, 0.235), M.hair);
    sole.position.set(0, -0.459, 0.035);
    knee.add(sole);
    if (side === 'R') {
      const holster = mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), M.dark);
      holster.position.set(0.06, -0.12, 0.02);
      hip.add(holster);
      const grip = mesh(new THREE.BoxGeometry(0.035, 0.07, 0.05), M.metal);
      grip.position.set(0.075, 0.02, 0.02);
      hip.add(grip);
    }

    legs[side] = { hip, knee };
  }

  // ---- weapon mount (chest height, forward) ----
  const gunMount = new THREE.Group();
  gunMount.position.set(0.14, 0.36, 0.22);
  upper.add(gunMount);

  // default hold pose
  arms.R.shoulder.rotation.set(-1.25, 0, 0.18);
  arms.R.elbow.rotation.set(-0.25, 0, -0.35);
  arms.L.shoulder.rotation.set(-1.3, 0, -0.5);
  arms.L.elbow.rotation.set(-0.3, 0, 0.7);

  const rig = {
    root, body, upper, head, arms, legs, gunMount,
    walkPhase: 0,
    recoil: 0,
    crouchAmt: 0,
    /** drive the walk / aim cycle */
    animate(dt, state) {
      const speed = state.speed || 0;
      const moving = speed > 0.4;
      const aiming = state.aiming !== false;
      this.walkPhase += dt * (2.2 + speed * 1.35);
      const amp = clamp(speed / 6.5, 0, 1) * (state.crouch ? 0.55 : 1);

      const sin = Math.sin(this.walkPhase);
      const sin2 = Math.sin(this.walkPhase * 2);

      // legs
      legs.L.hip.rotation.x = sin * 0.62 * amp + (state.crouch ? 0.55 : 0);
      legs.R.hip.rotation.x = -sin * 0.62 * amp + (state.crouch ? 0.55 : 0);
      legs.L.knee.rotation.x = Math.max(0, -sin) * 0.9 * amp - (state.crouch ? 1.0 : 0);
      legs.R.knee.rotation.x = Math.max(0, sin) * 0.9 * amp - (state.crouch ? 1.0 : 0);

      // body bob & lean
      this.crouchAmt = lerp(this.crouchAmt, state.crouch ? 1 : 0, clamp(dt * 10, 0, 1));
      body.position.y = -this.crouchAmt * 0.34 + (moving ? Math.abs(sin2) * 0.035 * amp : 0);
      upper.rotation.x = (moving ? 0.07 + amp * 0.06 : 0.02) + this.crouchAmt * 0.22;
      upper.rotation.z = sin * 0.03 * amp;

      // arms
      if (aiming) {
        const aimPitch = clamp(state.aimPitch || 0, -0.9, 0.9);
        arms.R.shoulder.rotation.x = -1.25 - aimPitch * 0.45;
        arms.R.elbow.rotation.x = -0.25 - aimPitch * 0.15;
        arms.L.shoulder.rotation.x = -1.32 - aimPitch * 0.45;
        arms.L.elbow.rotation.x = -0.3 - aimPitch * 0.1;
        arms.R.shoulder.rotation.z = 0.18;
        arms.L.shoulder.rotation.z = -0.5;
      } else {
        arms.R.shoulder.rotation.x = -sin * 0.5 * amp - 0.2;
        arms.L.shoulder.rotation.x = sin * 0.5 * amp - 0.2;
        arms.R.elbow.rotation.x = -0.4;
        arms.L.elbow.rotation.x = -0.4;
        arms.R.shoulder.rotation.z = 0.12;
        arms.L.shoulder.rotation.z = -0.12;
      }

      // weapon follows aim pitch + recoil kick
      this.recoil = Math.max(0, this.recoil - dt * 7);
      gunMount.rotation.x = clamp(-(state.aimPitch || 0), -1.0, 1.0) + this.recoil * 0.35;
      gunMount.position.z = 0.22 - this.recoil * 0.08;

      // jump / falling pose
      if (state.airborne) {
        legs.L.hip.rotation.x = -0.5;
        legs.R.hip.rotation.x = 0.35;
        legs.L.knee.rotation.x = -0.9;
        legs.R.knee.rotation.x = -0.4;
      }
    },
  };

  return rig;
}

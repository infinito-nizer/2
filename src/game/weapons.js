import * as THREE from 'three';

// ============================================================
// Weapon definitions + procedural weapon models
// ============================================================
export const WEAPONS = {
  pistol: {
    name: 'M500', type: 'PISTOL', dmg: 26, rpm: 320, mag: 7, spread: 1.5, auto: false,
    pellets: 1, range: 130, reload: 1.25, recoil: 1.1, zoom: 1.35, sound: 'pistol',
    tint: 0x3a3f46, accent: 0x707880, len: 0.42,
  },
  ak: {
    name: 'AK47', type: 'ASSAULT RIFLE', dmg: 27, rpm: 560, mag: 30, spread: 1.05, auto: true,
    pellets: 1, range: 240, reload: 2.15, recoil: 1.35, zoom: 1.25, sound: 'rifle',
    tint: 0x2c2f33, accent: 0x8a5a2a, len: 0.92,
  },
  m4: {
    name: 'M4A1', type: 'ASSAULT RIFLE', dmg: 23, rpm: 720, mag: 30, spread: 0.85, auto: true,
    pellets: 1, range: 250, reload: 1.95, recoil: 0.95, zoom: 1.3, sound: 'rifle',
    tint: 0x33383d, accent: 0x1d2124, len: 0.9,
  },
  mp40: {
    name: 'MP40', type: 'SMG', dmg: 17, rpm: 920, mag: 35, spread: 1.5, auto: true,
    pellets: 1, range: 130, reload: 1.7, recoil: 0.7, zoom: 1.2, sound: 'rifle',
    tint: 0x2a2d30, accent: 0x4a4f55, len: 0.66,
  },
  shotgun: {
    name: 'M1014', type: 'SHOTGUN', dmg: 12, rpm: 145, mag: 6, spread: 4.2, auto: false,
    pellets: 8, range: 70, reload: 2.6, recoil: 2.4, zoom: 1.15, sound: 'shotgun',
    tint: 0x2b2e31, accent: 0x6b4a2c, len: 0.95,
  },
  awm: {
    name: 'AWM', type: 'SNIPER', dmg: 98, rpm: 48, mag: 5, spread: 0.22, auto: false,
    pellets: 1, range: 500, reload: 3.0, recoil: 3.4, zoom: 3.2, sound: 'sniper',
    tint: 0x232629, accent: 0x5b6b4a, len: 1.18,
  },
  scar: {
    name: 'SCAR-H', type: 'BATTLE RIFLE', dmg: 31, rpm: 480, mag: 20, spread: 0.95, auto: true,
    pellets: 1, range: 280, reload: 2.35, recoil: 1.5, zoom: 1.4, sound: 'rifle',
    tint: 0x4a4436, accent: 0x2b2a26, len: 0.95,
  },
};

export const STARTER_WEAPON = 'pistol';

const matCache = new Map();
function mat(color, rough = 0.55, metal = 0.7, emissive = 0x000000) {
  const key = `${color}-${rough}-${metal}-${emissive}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive }));
  }
  return matCache.get(key);
}

function box(w, h, d, x, y, z, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function cyl(rt, rb, h, x, y, z, material, rotX = Math.PI / 2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 10, 1), material);
  m.position.set(x, y, z);
  m.rotation.x = rotX;
  m.castShadow = true;
  return m;
}

/** Build a stylised firearm. Muzzle points toward +Z. */
export function buildGunMesh(id) {
  const spec = WEAPONS[id] || WEAPONS.ak;
  const g = new THREE.Group();
  const L = spec.len;
  const metal = mat(spec.tint, 0.42, 0.8);
  const accent = mat(spec.accent, 0.62, 0.25);
  const dark = mat(0x15181b, 0.5, 0.7);

  const bodyLen = L * 0.5;
  g.add(box(0.075, 0.11, bodyLen, 0, 0, L * 0.08, metal));
  // handguard
  g.add(box(0.062, 0.07, L * 0.3, 0, -0.005, L * 0.34, accent));
  // barrel
  g.add(cyl(0.017, 0.019, L * 0.42, 0, 0.012, L * 0.62, dark));
  // muzzle brake
  g.add(cyl(0.03, 0.028, 0.07, 0, 0.012, L * 0.83, dark));
  // magazine
  const magH = id === 'pistol' ? 0.13 : 0.2;
  const mag = box(0.05, magH, 0.1, 0, -0.12 - magH * 0.2, L * 0.02, dark);
  mag.rotation.x = -0.16;
  g.add(mag);
  // grip
  const grip = box(0.055, 0.14, 0.07, 0, -0.1, -L * 0.04, accent);
  grip.rotation.x = 0.3;
  g.add(grip);
  // stock
  if (id !== 'pistol' && id !== 'mp40') {
    g.add(box(0.055, 0.1, L * 0.22, 0, 0.005, -L * 0.32, accent));
    g.add(box(0.06, 0.13, 0.05, 0, -0.01, -L * 0.44, dark));
  }
  // scope / sights
  if (id === 'awm' || id === 'scar' || id === 'm4') {
    const scope = cyl(0.032, 0.032, 0.22, 0, 0.095, L * 0.12, dark, Math.PI / 2);
    g.add(scope);
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.03, 12),
      new THREE.MeshStandardMaterial({ color: 0x1a6f8a, emissive: 0x0a3b4a, metalness: 0.9, roughness: 0.1 })
    );
    lens.position.set(0, 0.095, L * 0.12 + 0.115);
    g.add(lens);
  } else {
    g.add(box(0.02, 0.035, 0.02, 0, 0.085, L * 0.55, dark));
    g.add(box(0.045, 0.02, 0.02, 0, 0.085, L * 0.06, dark));
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, L * 0.87);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  g.userData.spec = spec;
  return g;
}

/** Weapon icon silhouette used by the ground-loot display (scaled up model). */
export function buildLootWeapon(id) {
  const g = buildGunMesh(id);
  g.scale.setScalar(1.55);
  return g;
}

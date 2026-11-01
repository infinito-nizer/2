import * as THREE from 'three';
import { createCharacter } from './character.js';
import { buildGunMesh, WEAPONS, STARTER_WEAPON } from './weapons.js';
import { clamp, damp, lerp, rand } from '../engine/utils.js';
import { WORLD } from '../engine/terrain.js';
import { audio } from '../engine/audio.js';

const GRAVITY = 24;
const EYE = 1.55;

export class Player {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;

    this.rig = createCharacter({
      skin: 0xc2916b,
      shirt: 0x1d2c3a,
      pants: 0x18222c,
      accent: 0xff7a1a,
      vest: 0x25333f,
      helmetColor: 0x2c3b46,
    });
    this.root = this.rig.root;
    this.scene.add(this.root);

    this.gunMount = this.rig.gunMount;
    this.gunMesh = null;
    this.gunId = null;

    // parachute
    this.chute = this._buildChute();
    this.chute.visible = false;
    this.root.add(this.chute);

    this.position = new THREE.Vector3(0, 30, 0);
    this.velocity = new THREE.Vector3();
    this.radius = 0.42;

    this.yaw = 0;
    this.pitch = 0;
    this.pitchKick = 0;
    this.yawKick = 0;
    this.shake = 0;

    this.health = 100;
    this.maxHealth = 100;
    this.armor = 0;
    this.medkits = 1;
    this.vests = 0;

    this.slots = [null, null];
    this.slot = 0;
    this.alive = true;
    this.state = 'drop';
    this.onGround = false;
    this.crouch = false;
    this.sprint = false;
    this.ads = false;
    this.moving = false;
    this.speed = 0;

    this.fireCooldown = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.reloadTotal = 1;
    this.spreadBloom = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.survived = 0;
    this.lastDamageTime = -10;

    this.cameraDist = 3.6;
    this.cameraFov = 72;

    this.dropChute = false;
    this.dropSpeed = 0;
  }

  _buildChute() {
    const g = new THREE.Group();
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0xff7a1a,
      roughness: 0.75,
      side: THREE.DoubleSide,
      emissive: 0x401200,
      emissiveIntensity: 0.35,
    });
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.9, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), canopyMat);
    canopy.position.y = 4.1;
    canopy.scale.set(1, 0.75, 1);
    g.add(canopy);
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.03, 4, 24, 0.5), stripeMat);
      s.rotation.x = Math.PI / 2;
      s.rotation.z = (i / 4) * Math.PI * 2;
      s.position.y = 4.05;
      s.scale.set(1, 1, 0.8);
      g.add(s);
    }
    const lineMat = new THREE.LineBasicMaterial({ color: 0x22262a, transparent: true, opacity: 0.8 });
    const lineGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      pts.push(Math.cos(a) * 1.8, 4.0, Math.sin(a) * 1.8, 0, 1.4, 0);
    }
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(lineGeo, lineMat));
    return g;
  }

  // ---------------- loadout ----------------
  reset(spawn) {
    this.position.copy(spawn);
    this.velocity.set(0, 0, 0);
    this.health = 100;
    this.armor = 40;
    this.medkits = 1;
    this.vests = 0;
    this.slots = [null, null];
    this.slot = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.survived = 0;
    this.alive = true;
    this.state = 'drop';
    this.crouch = false;
    this.ads = false;
    this.reloading = false;
    this.pitchKick = 0;
    this.yawKick = 0;
    this.shake = 0;
    this.spreadBloom = 0;
    this.pitch = -0.35;
    this.yaw = Math.PI;
    this.dropChute = false;
    this.root.rotation.set(0, 0, 0);
    this.chute.visible = false;
    this.rig.body.rotation.set(0, 0, 0);
    this.equipWeapon(STARTER_WEAPON, true);
    this.updateGunMesh();
  }

  get weapon() {
    return this.slots[this.slot];
  }
  get spec() {
    const w = this.weapon;
    return w ? WEAPONS[w.id] : null;
  }

  equipWeapon(id, replaceEmpty = false) {
    const empty = this.slots.findIndex((s) => !s);
    const spec = WEAPONS[id];
    if (!spec) return false;
    const inst = { id, ammo: spec.mag, reserve: spec.mag * 3 };
    if (empty >= 0) {
      this.slots[empty] = inst;
      if (replaceEmpty || this.slots[this.slot] == null) this.slot = empty;
    } else {
      inst.reserve = Math.floor(spec.mag * 1.5);
      this.slots[this.slot] = inst;
    }
    this.updateGunMesh();
    this.reloading = false;
    this.fireCooldown = 0.12;
    return true;
  }

  updateGunMesh() {
    if (this.gunMesh) {
      this.gunMount.remove(this.gunMesh);
      this.gunMesh.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
      this.gunMesh = null;
    }
    const w = this.weapon;
    if (!w) { this.gunId = null; return; }
    this.gunMesh = buildGunMesh(w.id);
    this.gunMesh.position.set(0, -0.05, 0.06);
    // point the weapon toward local +Z of the mount
    this.gunMesh.rotation.set(0, 0, 0);
    this.gunMount.add(this.gunMesh);
    this.gunId = w.id;
  }

  swapWeapon() {
    if (!this.slots[1] && !this.slots[0]) return;
    const other = this.slot === 0 ? 1 : 0;
    if (!this.slots[other]) {
      this.game.hud.toast('NO SECOND WEAPON');
      return;
    }
    this.slot = other;
    this.reloading = false;
    this.fireCooldown = 0.2;
    this.updateGunMesh();
    audio.click(300, 0.12, 0.05);
    this.game.hud.refreshWeapon();
  }

  // ---------------- loot ----------------
  pickLoot(item) {
    const hud = this.game.hud;
    if (item.type === 'weapon') {
      const spec = WEAPONS[item.weaponId];
      if (!spec) return false;
      this.equipWeapon(item.weaponId);
      hud.toast(`PICKED UP ${spec.name}`);
      audio.pickup();
      return true;
    }
    if (item.type === 'ammo') {
      const w = this.weapon;
      if (!w) { hud.toast('NEED A WEAPON FOR AMMO'); return false; }
      const amount = item.amount || 45;
      w.reserve = Math.min(w.reserve + amount, WEAPONS[w.id].mag * 8);
      hud.toast(`+${amount} ${WEAPONS[w.id].name} AMMO`);
      audio.pickup();
      return true;
    }
    if (item.type === 'medkit') {
      if (this.medkits >= 5) { hud.toast('MEDKITS FULL'); return false; }
      this.medkits++;
      hud.toast('+1 MEDKIT');
      audio.pickup();
      return true;
    }
    if (item.type === 'armor') {
      if (this.armor >= 100) { hud.toast('ARMOR FULL'); return false; }
      this.armor = Math.min(100, this.armor + 50);
      hud.toast('+50 ARMOR');
      audio.pickup();
      return true;
    }
    return false;
  }

  useMedkit() {
    if (!this.alive || this.state === 'drop') return;
    if (this.medkits <= 0) { this.game.hud.toast('NO MEDKITS'); return; }
    if (this.health >= this.maxHealth) { this.game.hud.toast('HEALTH FULL'); return; }
    this.medkits--;
    this.healOverTime = { t: 2.2, per: 50 / 2.2, left: 50 };
    audio.heal();
    this.game.hud.toast('USING MEDKIT…');
  }

  // ---------------- combat ----------------
  startReload() {
    const w = this.weapon;
    if (!w || this.reloading) return;
    const spec = WEAPONS[w.id];
    if (w.ammo >= spec.mag || w.reserve <= 0) return;
    this.reloading = true;
    this.reloadTotal = spec.reload;
    this.reloadT = spec.reload;
    audio.reload();
    this.game.hud.setReloading(true);
  }

  fire() {
    const w = this.weapon;
    if (!w || !this.alive || this.state !== 'ground' || this.reloading) return;
    const spec = WEAPONS[w.id];
    if (this.fireCooldown > 0) return;
    if (w.ammo <= 0) {
      audio.click(180, 0.1, 0.04);
      this.startReload();
      return;
    }
    w.ammo--;
    this.fireCooldown = 60 / spec.rpm;

    const camera = this.game.camera;
    const origin = camera.position.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

    const muzzleWorld = new THREE.Vector3();
    this.root.updateMatrixWorld(true);
    if (this.gunMesh) {
      this.gunMesh.userData.muzzle.getWorldPosition(muzzleWorld);
    } else {
      muzzleWorld.copy(this.position).add(new THREE.Vector3(0, 1.4, 0));
    }

    // cone spread
    const moveFactor = this.moving ? 1.7 : 1;
    const spreadBase = spec.spread * (this.ads ? 0.45 : 1) * (this.crouch ? 0.7 : 1) * moveFactor + this.spreadBloom;
    const spread = THREE.MathUtils.degToRad(spreadBase);

    for (let p = 0; p < spec.pellets; p++) {
      const d = dir.clone();
      const r = Math.random() * spread;
      const a = Math.random() * Math.PI * 2;
      const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, d).normalize();
      d.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();

      const hit = this.game.raycastShot(origin, d, spec.range, this);
      const end = hit ? hit.point : origin.clone().addScaledVector(d, spec.range);
      const tracerStart = muzzleWorld.clone();
      // avoid tracer starting behind the camera plane
      this.game.effects.tracer(tracerStart, end, 0xffd79a);

      if (hit) {
        if (hit.bot) {
          const falloff = clamp(1 - (hit.dist / spec.range) * 0.4, 0.6, 1);
          const dmg = spec.dmg * falloff * (hit.head ? 2.1 : 1);
          hit.bot.takeDamage(dmg, hit.head, hit.point, this);
          this.damageDealt += dmg;
          this.game.hud.hitmarker(hit.head);
          this.game.hud.damageNumber(hit.point, Math.round(dmg), hit.head);
          this.game.effects.bloodMist(hit.point);
          audio.hitmarker(hit.head);
        } else {
          this.game.effects.impact(hit.point, hit.normal, false);
          audio.impact();
        }
      }
    }

    this.game.effects.muzzleFlash(muzzleWorld, dir);
    audio.shot(spec.sound);

    // recoil & bloom
    this.pitchKick += spec.recoil * 0.022 * (this.ads ? 0.6 : 1);
    this.yawKick += (Math.random() - 0.5) * spec.recoil * 0.012;
    this.shake = Math.min(1.4, this.shake + spec.recoil * 0.12);
    this.spreadBloom = Math.min(5.5, this.spreadBloom + spec.recoil * 0.55);
    if (this.rig) this.rig.recoil = 1;

    this.game.hud.refreshAmmo();
    if (w.ammo === 0) this.startReload();
  }

  damage(amount, fromPos = null) {
    if (!this.alive) return;
    let dmg = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.55);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.health -= dmg;
    this.lastDamageTime = this.survived;
    this.shake = Math.min(2, this.shake + 0.5);
    audio.hurt();
    this.game.hud.damageFlash(clamp(dmg / 35, 0.25, 1));
    if (fromPos) this.game.hud.damageDirection(fromPos, this.position);
    if (this.health <= 0) {
      this.health = 0;
      this.die();
    }
    this.game.hud.refreshVitals();
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'dead';
    this.rig.root.rotation.z = Math.PI * 0.46;
    this.rig.root.position.y = this.position.y + 0.15;
    this.game.onPlayerDeath();
  }

  // ---------------- update ----------------
  update(dt, input) {
    if (!this.alive) {
      this.rig.animate(dt, { speed: 0, aiming: false, crouch: true });
      return;
    }
    this.survived += dt;

    // ---- look ----
    const look = input.consumeLook();
    const sens = 0.0022 * input.sensitivity * (this.ads ? 0.55 : 1);
    this.yaw -= look.dx * sens;
    this.pitch -= look.dy * sens;
    this.pitch = clamp(this.pitch, -1.05, 0.95);

    // recoil recovery
    this.pitchKick = damp(this.pitchKick, 0, 9, dt);
    this.yawKick = damp(this.yawKick, 0, 9, dt);
    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.spreadBloom = Math.max(0, this.spreadBloom - dt * 6.5);

    if (this.healOverTime) {
      const h = this.healOverTime;
      const amt = Math.min(h.left, h.per * dt);
      this.health = Math.min(this.maxHealth, this.health + amt);
      h.left -= amt;
      if (h.left <= 0) this.healOverTime = null;
      this.game.hud.refreshVitals();
    }

    // ---- drop phase ----
    if (this.state === 'drop') {
      this.updateDrop(dt, input);
    } else {
      this.updateGround(dt, input);
    }

    // ---- weapon state ----
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.reloading) {
      this.reloadT -= dt;
      this.game.hud.setReloadProgress(1 - this.reloadT / this.reloadTotal);
      if (this.reloadT <= 0) {
        const w = this.weapon;
        if (w) {
          const spec = WEAPONS[w.id];
          const need = spec.mag - w.ammo;
          const take = Math.min(need, w.reserve);
          w.ammo += take;
          w.reserve -= take;
          this.game.hud.refreshAmmo();
        }
        this.reloading = false;
        this.game.hud.setReloading(false);
      }
    }

    // ---- firing ----
    if (this.state === 'ground' && this.weapon) {
      const spec = this.spec;
      const pressed = input.consumeFire();
      if (spec.auto ? input.fireHeld || pressed : pressed) this.fire();
    }

    // ---- reload / idle weapon motion ----
    const gm = this.gunMount;
    if (this.reloading) {
      const p = clamp(1 - this.reloadT / this.reloadTotal, 0, 1);
      const swing = Math.sin(p * Math.PI);
      gm.rotation.z = -swing * 0.85;
      gm.position.y = -0.05 - swing * 0.16;
      gm.rotation.y = swing * 0.25;
    } else {
      gm.rotation.z = damp(gm.rotation.z, 0, 10, dt);
      gm.rotation.y = damp(gm.rotation.y, 0, 10, dt);
      gm.position.y = damp(gm.position.y, -0.05, 10, dt);
    }

    // ---- animation ----
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = this.yaw;
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.rig.animate(dt, {
      speed: this.state === 'drop' ? 0 : horizontalSpeed,
      aiming: true,
      aimPitch: this.pitch,
      crouch: this.crouch && this.state === 'ground',
      airborne: this.state === 'drop' || !this.onGround,
    });
    this.chute.visible = this.state === 'drop' && this.dropChute;
    if (this.state === 'drop') {
      this.rig.root.rotation.x = this.dropChute ? 0.12 : clamp(-this.velocity.y * 0.01, -0.2, 0.5);
    } else {
      this.rig.root.rotation.x = 0;
    }

    this.updateCamera(dt);
  }

  updateDrop(dt, input) {
    const move = input.moveVector();
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const groundY = this.game.terrain.heightAt(this.position.x, this.position.z);
    const alt = this.position.y - groundY;

    if (!this.dropChute && (alt < 62 || input.down('Space'))) {
      this.dropChute = true;
      this.game.hud.toast('PARACHUTE DEPLOYED');
      this.game.hud.banner('LANDING', 900);
    }

    const driftSpeed = this.dropChute ? 13 : 21;
    const wish = new THREE.Vector3()
      .addScaledVector(forward, move.z * driftSpeed)
      .addScaledVector(right, move.x * driftSpeed);
    this.velocity.x = damp(this.velocity.x, wish.x, this.dropChute ? 1.6 : 0.9, dt);
    this.velocity.z = damp(this.velocity.z, wish.z, this.dropChute ? 1.6 : 0.9, dt);

    if (this.dropChute) {
      this.velocity.y = damp(this.velocity.y, -8.5, 4, dt);
    } else {
      this.velocity.y = Math.max(-52, this.velocity.y - GRAVITY * 0.55 * dt);
    }

    this.position.addScaledVector(this.velocity, dt);
    this.position.y = Math.min(this.position.y, 400);
    this.rig.animate(dt, { speed: 0, aiming: false, airborne: true });

    if (alt <= 0.4) {
      this.position.y = groundY;
      this.velocity.set(0, 0, 0);
      this.state = 'ground';
      this.onGround = true;
      this.pitch = -0.06;
      this.pitchKick = 0;
      this.dropChute = false;
      this.chute.visible = false;
      this.game.effects.impact(
        this.position.clone().add(new THREE.Vector3(0, 0.1, 0)),
        new THREE.Vector3(0, 1, 0),
        false
      );
      audio.footstep();
      this.game.hud.banner('LOOT UP', 1300);
      this.game.onLanded();
    }
  }

  updateGround(dt, input) {
    const move = input.moveVector();
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));

    this.crouch = input.down('KeyC') || input.crouchToggle === true;
    this.sprint = (input.down('ShiftLeft') || input.down('ShiftRight')) && !this.crouch && move.z > 0.1;
    this.ads = input.rightHeld && !this.sprint;
    this.cameraFov = this.ads ? 52 : this.sprint ? 78 : 72;
    this.cameraDist = this.ads ? 1.95 : this.sprint ? 4.05 : 3.6;

    const groundY = this.game.terrain.heightAt(this.position.x, this.position.z);
    const inWater = groundY < -0.7;

    let speed = this.crouch ? 3.0 : this.sprint ? 8.2 : 5.5;
    if (this.ads) speed *= 0.6;
    if (inWater) speed = Math.min(speed, 2.6);

    const wish = new THREE.Vector3()
      .addScaledVector(forward, move.z)
      .addScaledVector(right, move.x);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    const accel = this.onGround ? 14 : 4;
    this.velocity.x = damp(this.velocity.x, wish.x, accel, dt);
    this.velocity.z = damp(this.velocity.z, wish.z, accel, dt);
    this.velocity.y -= GRAVITY * dt;

    if (this.onGround && input.jumpQueued) {
      this.velocity.y = 7.4;
      this.onGround = false;
      input.jumpQueued = false;
    }
    if (!this.onGround) input.jumpQueued = false;

    this.position.addScaledVector(this.velocity, dt);

    // terrain collision
    const gy2 = this.game.terrain.heightAt(this.position.x, this.position.z);
    const floorY = Math.max(gy2, WORLD.waterLevel - 1.15);
    if (this.position.y <= floorY) {
      if (!this.onGround && this.velocity.y < -8) {
        audio.footstep();
        this.game.effects.impact(this.position.clone(), new THREE.Vector3(0, 1, 0), false);
      }
      this.position.y = floorY;
      this.velocity.y = 0;
      this.onGround = true;
    } else if (this.position.y > floorY + 0.15) {
      this.onGround = false;
    }

    // building collision
    this.game.world.colliders.resolve(this.position, this.radius, this.position.y);

    // footsteps
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.moving = this.speed > 0.6;
    if (this.moving && this.onGround) {
      this._stepT = (this._stepT || 0) + dt * this.speed;
      if (this._stepT > 2.4) {
        this._stepT = 0;
        audio.footstep();
      }
    }

    // keep inside world
    const limit = WORLD.half - 20;
    this.position.x = clamp(this.position.x, -limit, limit);
    this.position.z = clamp(this.position.z, -limit, limit);
  }

  updateCamera(dt) {
    const camera = this.game.camera;
    const yaw = this.yaw + this.yawKick;
    const pitch = clamp(this.pitch + this.pitchKick, -1.3, 1.25);
    const dir = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    ).normalize();
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw)).normalize();

    const pivot = this.position.clone().add(new THREE.Vector3(0, EYE + (this.crouch ? -0.28 : 0), 0));
    let dist = this.state === 'drop' ? 7.5 : this.cameraDist;
    const shoulder = this.state === 'drop' ? 0.4 : this.ads ? 0.5 : 0.78;

    // pull the camera in if it would clip terrain or a wall
    let camPos = pivot.clone().addScaledVector(dir, -dist).addScaledVector(right, shoulder);
    const clearance = (p) => {
      const ty = this.game.terrain.heightAt(p.x, p.z);
      return p.y - ty;
    };
    let tries = 0;
    while (tries < 8 && (clearance(camPos) < 0.7 || this.game.world.colliders.pointInside(camPos.x, camPos.y, camPos.z, 0.2))) {
      dist *= 0.78;
      camPos = pivot.clone().addScaledVector(dir, -dist).addScaledVector(right, shoulder);
      tries++;
    }

    // shake
    if (this.shake > 0.01) {
      const s = this.shake * 0.05;
      camPos.x += rand(-s, s);
      camPos.y += rand(-s, s);
      camPos.z += rand(-s, s);
    }

    camera.position.copy(camPos);
    const lookAt = camPos.clone().addScaledVector(dir, 60);
    camera.lookAt(lookAt);

    const targetFov = this.cameraFov;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = damp(camera.fov, targetFov, 9, dt);
      camera.updateProjectionMatrix();
    }
  }

  getMuzzleWorld() {
    const v = new THREE.Vector3();
    if (this.gunMesh) this.gunMesh.userData.muzzle.getWorldPosition(v);
    else v.copy(this.position).add(new THREE.Vector3(0, 1.4, 0));
    return v;
  }
}

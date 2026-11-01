import * as THREE from 'three';
import { createCharacter } from './character.js';
import { buildGunMesh, WEAPONS } from './weapons.js';
import { clamp, damp, rand, pick, mulberry32 } from '../engine/utils.js';
import { audio } from '../engine/audio.js';

const PRESETS = [
  { name: 'SHADOW', shirt: 0x24202c, accent: 0x8b5cf6, skin: 0x9c6b4a, pants: 0x1a1720 },
  { name: 'VIPER', shirt: 0x1f3326, accent: 0x51d88a, skin: 0x8a5c3c, pants: 0x16241b },
  { name: 'BLAZE', shirt: 0x3a1f1c, accent: 0xff6b35, skin: 0xc79b7a, pants: 0x241311 },
  { name: 'FROST', shirt: 0x22303a, accent: 0x5ad1ff, skin: 0xd9b394, pants: 0x18232b },
  { name: 'NOVA', shirt: 0x2f2340, accent: 0xff5ad1, skin: 0x8d5a3c, pants: 0x1f1729 },
  { name: 'TITAN', shirt: 0x3a3320, accent: 0xffc233, skin: 0x6f4a30, pants: 0x241f13 },
  { name: 'ROGUE', shirt: 0x2a2f33, accent: 0xe2e8ef, skin: 0xb98763, pants: 0x1b1f22 },
  { name: 'SPECTRE', shirt: 0x1c2a2e, accent: 0x2ee6c9, skin: 0x9e6f4d, pants: 0x121c1f },
  { name: 'HAVOC', shirt: 0x33202a, accent: 0xff4d6d, skin: 0x7d5236, pants: 0x201419 },
];

const BOT_WEAPONS = ['ak', 'm4', 'mp40', 'scar', 'shotgun', 'ak', 'm4', 'awm'];

export class Bot {
  constructor(game, index, spawn) {
    this.game = game;
    this.index = index;
    this.preset = PRESETS[index % PRESETS.length];
    this.name = this.preset.name;

    this.rig = createCharacter({
      skin: this.preset.skin,
      shirt: this.preset.shirt,
      pants: this.preset.pants,
      accent: this.preset.accent,
      vest: 0x1a2027,
      helmetColor: this.preset.shirt,
    });
    this.root = this.rig.root;
    game.scene.add(this.root);

    this.weaponId = pick(BOT_WEAPONS);
    this.spec = WEAPONS[this.weaponId];
    this.gun = buildGunMesh(this.weaponId);
    this.gun.position.set(0, -0.05, 0.06);
    this.rig.gunMount.add(this.gun);

    this.position = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.velocity = new THREE.Vector3();
    this.yaw = rand(0, Math.PI * 2);
    this.radius = 0.4;
    this.health = 100;
    this.maxHealth = 100;
    this.alive = true;
    this.state = 'patrol';
    this.target = null;
    this.targetIsPlayer = false;
    this.fireTimer = rand(1, 3);
    this.burst = 0;
    this.reactionTimer = 0;
    this.wander = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.wanderTimer = 0;
    this.deadTimer = 0;
    this.speed = rand(3.6, 5.2);
    this.accuracy = rand(0.55, 0.95);
    this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    this.strafeTimer = rand(1, 3);
    this.spottedPlayer = 0;
    this.aimYaw = this.yaw;
    this.hitFlash = 0;
  }

  get headPos() {
    return new THREE.Vector3(this.position.x, this.position.y + 1.72, this.position.z);
  }
  get chestPos() {
    return new THREE.Vector3(this.position.x, this.position.y + 1.15, this.position.z);
  }

  muzzleWorld() {
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    this.gun.userData.muzzle.getWorldPosition(v);
    return v;
  }

  takeDamage(amount, head, point, fromPlayer = null) {
    if (!this.alive) return;
    this.health -= amount;
    this.hitFlash = 1;
    this.game.effects.bloodMist(point);
    // getting shot makes bots turn and fight
    if (fromPlayer) {
      this.target = fromPlayer;
      this.targetIsPlayer = true;
      this.spottedPlayer = Math.max(this.spottedPlayer, 6);
      this.reactionTimer = Math.min(this.reactionTimer, 0.12);
    }
    if (this.health <= 0) this.die(fromPlayer);
  }

  die(killer) {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'dead';
    this.deadTimer = 0;
    this.game.effects.deathBurst(this.chestPos);
    this.rig.root.rotation.z = (Math.random() > 0.5 ? 1 : -1) * Math.PI * 0.48;
    this.game.onBotKilled(this, killer);
  }

  hasLineOfSight(from, to) {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.5) return true;
    dir.normalize();
    const steps = Math.ceil(dist / 6);
    for (let i = 1; i < steps; i++) {
      const d = (i / steps) * dist;
      const p = from.clone().addScaledVector(dir, d);
      if (p.y < this.game.terrain.heightAt(p.x, p.z) + 0.25) return false;
    }
    const hit = this.game.world.colliders.segmentHit(from.x, from.y, from.z, to.x, to.y, to.z);
    return hit >= 0.999;
  }

  pickTarget() {
    const game = this.game;
    let best = null;
    let bestDist = Infinity;

    if (game.player.alive) {
      const d = this.position.distanceTo(game.player.position);
      if (d < 145) {
        const canSee = this.hasLineOfSight(this.chestPos, game.player.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
        if (canSee || this.spottedPlayer > 0) {
          best = game.player;
          bestDist = d;
        }
      }
    }

    for (const b of game.bots.list) {
      if (b === this || !b.alive) continue;
      const d = this.position.distanceTo(b.position);
      if (d > 110 || d > bestDist) continue;
      if (this.hasLineOfSight(this.chestPos, b.chestPos)) {
        best = b;
        bestDist = d;
      }
    }
    return best;
  }

  update(dt) {
    if (!this.alive) {
      this.deadTimer += dt;
      this.rig.root.position.y = Math.max(-1.2, this.rig.root.position.y - dt * 0.12);
      return;
    }

    const game = this.game;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.spottedPlayer = Math.max(0, this.spottedPlayer - dt);
    this.fireTimer -= dt;
    this.reactionTimer = Math.max(0, this.reactionTimer - dt);
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = rand(1.2, 3);
      this.strafeDir *= -1;
    }

    // periodic target scan
    this._scanT = (this._scanT || 0) - dt;
    if (this._scanT <= 0) {
      this._scanT = 0.35;
      const t = this.pickTarget();
      if (t) {
        if (t !== this.target) this.reactionTimer = rand(0.25, 0.6);
        this.target = t;
        this.targetIsPlayer = t === game.player;
        this.spottedPlayer = 5;
      } else if (this.spottedPlayer <= 0) {
        this.target = null;
      }
    }

    const move = new THREE.Vector3();
    let shooting = false;
    const speedMult = this.target ? 1.0 : 0.62;

    if (this.target) {
      const targetPos = this.targetIsPlayer ? this.target.position : this.target.chestPos;
      const toTarget = targetPos.clone().sub(this.position);
      toTarget.y = 0;
      const dist = toTarget.length();
      const desiredYaw = Math.atan2(toTarget.x, toTarget.z);
      this.aimYaw = desiredYaw;
      this.yaw = this.yaw + (this.angleTo(desiredYaw)) * clamp(dt * 6, 0, 1);

      const inRange = dist < this.spec.range * 0.8;
      const los = this.hasLineOfSight(this.chestPos, this.targetIsPlayer
        ? this.target.position.clone().add(new THREE.Vector3(0, 1.15, 0))
        : this.target.chestPos);

      if (dist > (this.weaponId === 'shotgun' ? 16 : 26)) {
        // close the distance
        move.copy(toTarget).normalize();
        if (los && dist < 60) {
          // strafe while advancing
          move.x += -toTarget.z / dist * this.strafeDir * 0.5;
          move.z += toTarget.x / dist * this.strafeDir * 0.5;
        }
      } else {
        // circle strafe
        move.set(-toTarget.z / (dist || 1), 0, toTarget.x / (dist || 1)).multiplyScalar(this.strafeDir);
        if (dist < 10) move.addScaledVector(toTarget.clone().normalize(), -0.4);
      }

      shooting = los && inRange && this.reactionTimer <= 0 && dist < this.spec.range;
    } else {
      // wander toward the safe zone
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0 || this.position.distanceTo(this.wander) < 6) {
        this.wanderTimer = rand(6, 12);
        const zone = game.zone;
        if (zone && !zone.contains(this.position.x, this.position.z, 0.7)) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * zone.radius * 0.6;
          this.wander.set(zone.center.x + Math.cos(a) * r, 0, zone.center.z + Math.sin(a) * r);
        } else {
          const p = game.terrain.randomLandPoint(Math.random, 3);
          this.wander.copy(p);
        }
      }
      const dir = this.wander.clone().sub(this.position);
      dir.y = 0;
      if (dir.lengthSq() > 1) {
        dir.normalize();
        move.copy(dir);
        this.yaw = this.yaw + this.angleTo(Math.atan2(dir.x, dir.z)) * clamp(dt * 3, 0, 1);
      }
    }

    if (shooting) {
      this.aimYaw = Math.atan2(
        (this.targetIsPlayer ? this.target.position.x : this.target.position.x) - this.position.x,
        (this.targetIsPlayer ? this.target.position.z : this.target.position.z) - this.position.z
      );
      if (this.fireTimer <= 0) {
        this.shootAtTarget(dt);
      }
    }

    // ---- locomotion ----
    move.y = 0;
    if (move.lengthSq() > 1) move.normalize();
    const targetSpeed = this.speed * speedMult;
    this.velocity.x = damp(this.velocity.x, move.x * targetSpeed, 7, dt);
    this.velocity.z = damp(this.velocity.z, move.z * targetSpeed, 7, dt);
    this.velocity.y -= 24 * dt;

    // crude obstacle avoidance
    const ahead = this.position.clone().addScaledVector(new THREE.Vector3(move.x, 0, move.z), 2.2);
    if (move.lengthSq() > 0.1 &&
        (game.world.colliders.pointInside(ahead.x, this.position.y + 1, ahead.z, 0.4) ||
         game.terrain.slopeAt(ahead.x, ahead.z) > 0.55)) {
      const side = new THREE.Vector3(-move.z, 0, move.x).multiplyScalar(this.strafeDir);
      this.velocity.x = damp(this.velocity.x, side.x * targetSpeed, 6, dt);
      this.velocity.z = damp(this.velocity.z, side.z * targetSpeed, 6, dt);
    }

    this.position.addScaledVector(this.velocity, dt);

    const groundY = Math.max(game.terrain.heightAt(this.position.x, this.position.z), -1.0);
    if (this.position.y <= groundY) {
      this.position.y = groundY;
      this.velocity.y = 0;
    }
    game.world.colliders.resolve(this.position, this.radius, this.position.y);

    // keep on the island-ish
    const limit = 620;
    this.position.x = clamp(this.position.x, -limit, limit);
    this.position.z = clamp(this.position.z, -limit, limit);

    // zone damage
    if (game.zone && !game.zone.contains(this.position.x, this.position.z, 0)) {
      this.zoneTick = (this.zoneTick || 0) + dt;
      if (this.zoneTick > 1) {
        this.zoneTick = 0;
        this.takeDamage(game.zone.damagePerSecond, false, this.chestPos, null);
      }
    }

    // ---- presentation ----
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    this.rig.animate(dt, {
      speed: hs,
      aiming: !!this.target,
      aimPitch: 0,
      crouch: false,
      airborne: false,
    });
    this.gun.rotation.x = 0;
    if (this.hitFlash > 0) {
      // brief emissive flash on the chest rig is faked with a scale pop
      this.rig.upper.scale.setScalar(1 + this.hitFlash * 0.04);
    } else {
      this.rig.upper.scale.setScalar(1);
    }
  }

  angleTo(target) {
    let d = (target - this.yaw) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  shootAtTarget() {
    const game = this.game;
    const spec = this.spec;
    const muzzle = this.muzzleWorld();
    const targetPos = this.targetIsPlayer ? this.target.position.clone().add(new THREE.Vector3(0, 1.1, 0)) : this.target.chestPos;
    const dist = muzzle.distanceTo(targetPos);

    // firing cadence
    const rate = 60 / spec.rpm;
    this.burst = this.burst > 0 ? this.burst - 1 : 3 + Math.floor(Math.random() * 3);
    this.fireTimer = this.burst > 0 ? rate * 1.2 : rand(0.55, 1.2) * (this.weaponId === 'awm' ? 2.2 : 1);

    const dir = targetPos.clone().sub(muzzle).normalize();
    // accuracy falls with distance
    const skill = this.accuracy * (this.targetIsPlayer ? 0.75 : 0.9);
    const spread = clamp(0.11 - skill * 0.06, 0.02, 0.11) + dist * 0.0011;
    dir.x += rand(-spread, spread);
    dir.y += rand(-spread * 0.7, spread * 0.7);
    dir.z += rand(-spread, spread);
    dir.normalize();

    const end = muzzle.clone().addScaledVector(dir, Math.min(spec.range, dist + 30));
    // did it connect?
    let hitPoint = null;
    const targetHead = this.targetIsPlayer
      ? this.target.position.clone().add(new THREE.Vector3(0, 1.3, 0))
      : this.target.chestPos;
    const toTargetVec = targetHead.clone().sub(muzzle);
    const along = toTargetVec.dot(dir);
    if (along > 0) {
      const closest = muzzle.clone().addScaledVector(dir, along);
      const miss = closest.distanceTo(targetHead);
      if (miss < 0.78 && dist < spec.range) hitPoint = targetHead;
    }

    const blocked = game.world.colliders.segmentHit(muzzle.x, muzzle.y, muzzle.z, end.x, end.y, end.z);
    const terrainBlocked = this.hasLineOfSight(muzzle, end);
    if (hitPoint && blocked < 1) hitPoint = null;
    if (hitPoint && !terrainBlocked) hitPoint = null;

    if (hitPoint) {
      game.effects.tracer(muzzle, hitPoint, this.targetIsPlayer ? 0xffa463 : 0xffd0a0);
      game.effects.impact(hitPoint, new THREE.Vector3(0, 1, 0), true);
      if (this.targetIsPlayer) {
        const dmg = clamp(spec.dmg * 0.16, 3, 9);
        this.target.damage(dmg * rand(0.85, 1.15), this.position.clone());
      } else {
        this.target.takeDamage(clamp(spec.dmg * 0.3, 6, 18), false, hitPoint, null);
      }
    } else {
      const missEnd = end.clone();
      game.effects.tracer(muzzle, missEnd, 0xffc48a);
      if (this.targetIsPlayer && Math.random() < 0.4) {
        // near-miss whizz dust
        game.effects.impact(
          this.target.position.clone().add(new THREE.Vector3(rand(-1.5, 1.5), rand(0.2, 1.8), rand(-1.5, 1.5))),
          new THREE.Vector3(0, 1, 0),
          false
        );
      }
    }

    game.effects.muzzleFlash(muzzle, dir);
    const playerDist = this.position.distanceTo(game.player.position);
    audio.shot(spec.sound, playerDist);
  }
}

export class BotManager {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(count = 9) {
    this.clear();
    const rng = mulberry32(Date.now() & 0xffff);
    const placed = [];
    for (let i = 0; i < count; i++) {
      let p = null;
      for (let tries = 0; tries < 90; tries++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * 330;
        const cx = Math.cos(a) * r;
        const cz = Math.sin(a) * r * 0.95;
        if (this.game.terrain.heightAt(cx, cz) < 3) continue;
        p = { x: cx, z: cz, y: this.game.terrain.heightAt(cx, cz) };
        if (placed.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 45)) break;
      }
      if (!p) p = this.game.terrain.randomLandPoint(rng, 3);
      placed.push(p);
      const bot = new Bot(this.game, i, { x: p.x, y: p.y, z: p.z });
      this.list.push(bot);
    }
  }

  clear() {
    for (const b of this.list) {
      this.game.scene.remove(b.root);
      b.root.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
        }
      });
    }
    this.list = [];
  }

  get aliveCount() {
    return this.list.filter((b) => b.alive).length;
  }

  update(dt) {
    for (const b of this.list) b.update(dt);
  }
}

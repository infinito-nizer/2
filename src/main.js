import * as THREE from 'three';
import './style.css';
import { RenderPipeline, QUALITY } from './engine/postfx.js';
import { Sky } from './engine/sky.js';
import { Terrain, WORLD } from './engine/terrain.js';
import { World } from './game/world.js';
import { Effects } from './game/effects.js';
import { Player } from './game/player.js';
import { BotManager } from './game/bots.js';
import { Zone } from './game/zone.js';
import { Input } from './game/input.js';
import { HUD } from './ui/hud.js';
import { audio } from './engine/audio.js';

const IS_MOBILE = (window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false) || /iOS|Android/i.test(navigator.userAgent);
const DEFAULT_QUALITY = IS_MOBILE ? 'medium' : 'high';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function raySphere(origin, dir, center, radius) {
  const ocx = center.x - origin.x;
  const ocy = center.y - origin.y;
  const ocz = center.z - origin.z;
  const t = ocx * dir.x + ocy * dir.y + ocz * dir.z;
  if (t < 0) return null;
  const d2 = ocx * ocx + ocy * ocy + ocz * ocz - t * t;
  const r2 = radius * radius;
  if (d2 > r2) return null;
  const th = Math.sqrt(r2 - d2);
  const t0 = t - th;
  return t0 > 0 ? t0 : t + th;
}

class Game {
  constructor() {
    this.canvas = $('scene');
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xd8ccb6, 0.00052);
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.12, 6500);

    this.quality = DEFAULT_QUALITY;
    this.pipeline = new RenderPipeline(this.canvas, this.scene, this.camera, this.quality);
    this.sky = new Sky(this.scene, this.pipeline.renderer);
    this.sky.setShadowQuality(QUALITY[this.quality].shadow);

    this.mode = 'boot'; // boot | menu | playing | over
    this.matchTime = 0;
    this.cinematicT = 0;
    this.clock = new THREE.Clock();
    this.stats = this.loadStats();
    this.time = 0;
    this.player = null;

    this.input = new Input(this.canvas);
    this.input.sensitivity = 1;

    this._bindUI();
    window.addEventListener('resize', () => this.pipeline.resize());

    this.loop = this.loop.bind(this);
  }

  // ================= boot =================
  async boot() {
    const steps = [
      ['GENERATING ISLAND TERRAIN', () => {
        this.terrain = new Terrain(this.scene, { grass: IS_MOBILE ? 0 : 9000 });
        this.terrain.generateField();
      }],
      ['SCULPTING LANDMASS', () => this.terrain.buildMesh()],
      ['FILLING THE OCEAN', () => {
        this.terrain.buildWater();
        this.terrain.buildDistantIslands();
        this.pipeline.aoIgnore.push(this.terrain.water, this.sky.mesh);
      }],
      ['GROWING VEGETATION', () => {
        this.terrain.scatterProps();
        if (this.terrain.grass) this.pipeline.aoIgnore.push(this.terrain.grass);
        if (this.terrain.foliage) this.pipeline.aoIgnore.push(...this.terrain.foliage);
      }],
      ['CONSTRUCTING SETTLEMENTS', () => { this.world = new World(this.scene, this.terrain); }],
      ['SYSTEMS ONLINE', () => {
        this.effects = new Effects(this.scene);
        this.pipeline.aoIgnore.push(...this.effects.aoIgnore);
        this.zone = new Zone(this.scene, this.terrain);
        if (this.zone.mesh) this.pipeline.aoIgnore.push(this.zone.mesh);
        this.player = new Player(this);
        this.player.root.visible = false;
        this.bots = new BotManager(this);
        this.hud = new HUD(this);
        this.scene.fog = this.scene.fog || new THREE.FogExp2(0xd8ccb6, 0.00052);
      }],
      ['CALIBRATING OPTICS', () => {
        this.pipeline.setQuality(this.quality);
        this.sky.setShadowQuality(QUALITY[this.quality].shadow);
        this.camera.fov = 58;
        this.camera.updateProjectionMatrix();
      }],
    ];

    const fill = $('load-fill');
    const text = $('load-text');
    for (let i = 0; i < steps.length; i++) {
      const [label, fn] = steps[i];
      text.textContent = label + '…';
      fill.style.width = `${(i / steps.length) * 100}%`;
      await nextFrame();
      fn();
    }
    fill.style.width = '100%';
    text.textContent = 'READY TO DEPLOY';
    await nextFrame();

    // prime the camera at a scenic angle
    this.cinematicT = 2.2;
    this.mode = 'menu';
    $('loading').classList.add('hidden');
    $('menu').classList.remove('hidden');
    this.refreshMenuStats();
    requestAnimationFrame(this.loop);
  }

  // ================= UI bindings =================
  _bindUI() {
    document.querySelectorAll('#quality-seg button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#quality-seg button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.quality = btn.dataset.q;
        this.pipeline.setQuality(this.quality);
        this.sky.setShadowQuality(QUALITY[this.quality].shadow);
      });
    });

    const sens = $('sens');
    sens.addEventListener('input', () => {
      this.input.sensitivity = parseFloat(sens.value);
      $('sens-val').textContent = parseFloat(sens.value).toFixed(2);
    });

    $('play-btn').addEventListener('click', () => this.startMatch());
    $('again-btn').addEventListener('click', () => this.startMatch());
    $('menu-btn').addEventListener('click', () => this.toMenu());

    // keyboard actions
    this.input.onKey = (code) => {
      if (code === 'Escape') return;
      if (this.mode === 'menu' && (code === 'Enter' || code === 'Space')) {
        this.startMatch();
        return;
      }
      if (this.mode !== 'playing' || !this.player) return;
      if (code === 'Space') this.input.jumpQueued = true;
      if (code === 'KeyR') this.player.startReload();
      if (code === 'KeyQ') this.player.swapWeapon();
      if (code === 'KeyH') this.player.useMedkit();
      if (code === 'Digit1' && this.player.slots[0]) {
        this.player.slot = 0; this.player.updateGunMesh(); this.player.reloading = false;
      }
      if (code === 'Digit2' && this.player.slots[1]) {
        this.player.slot = 1; this.player.updateGunMesh(); this.player.reloading = false;
      }
    };

    this._bindMobile();
  }

  _bindMobile() {
    const fire = $('m-fire');
    const hold = (el, on, off) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); off && off(); }, { passive: false });
      el.addEventListener('touchcancel', () => off && off());
      el.addEventListener('mousedown', (e) => { e.preventDefault(); on(); });
      el.addEventListener('mouseup', () => off && off());
    };
    hold(fire, () => { this.input.fireHeld = true; this.input.firePressed = true; }, () => { this.input.fireHeld = false; });
    hold($('m-jump'), () => { this.input.jumpQueued = true; });
    hold($('m-crouch'), () => { this.input.crouchToggle = !this.input.crouchToggle; });
    hold($('m-reload'), () => this.player && this.player.startReload());
    hold($('m-swap'), () => this.player && this.player.swapWeapon());
    hold($('m-heal'), () => this.player && this.player.useMedkit());

    if (IS_MOBILE) this.hud && this.hud.setMobile(true);
    this._mobile = IS_MOBILE;
  }

  refreshMenuStats() {
    $('ls-matches').textContent = this.stats.matches;
    $('ls-wins').textContent = this.stats.wins;
    $('ls-kills').textContent = this.stats.kills;
    const tips = [
      'Land near a settlement, loot a rifle fast, then rotate early. The blue wall hurts more every phase.',
      'Aim for the head — headshots deal more than double damage. Tap R the moment your mag runs dry.',
      'Third-partying is a strategy: let rivals trade fire, then clean up the survivor.',
      'Crouching tightens your spread. Armor soaks over half of incoming damage.',
      'Watch your minimap — red dots only appear when enemies are close. Use the compass to hold a rotation.',
    ];
    $('tip-text').textContent = tips[Math.floor(Math.random() * tips.length)];
  }

  loadStats() {
    try {
      const raw = localStorage.getItem('firezone_stats_v1');
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return { matches: 0, wins: 0, kills: 0 };
  }

  saveStats() {
    try { localStorage.setItem('firezone_stats_v1', JSON.stringify(this.stats)); } catch (e) { /* ignore */ }
  }

  // ================= match flow =================
  flashFade() {
    const fade = $('fade');
    if (!fade) return;
    fade.style.transition = 'none';
    fade.style.opacity = '1';
    requestAnimationFrame(() => {
      fade.style.transition = 'opacity .55s ease';
      fade.style.opacity = '0';
    });
  }

  startMatch() {
    if (this.mode === 'playing') return;
    audio.init();
    audio.resume();

    $('menu').classList.add('hidden');
    $('endscreen').classList.add('hidden');
    this.hud.hideEnd();
    this.hud.show();
    this.hud.setMobile(IS_MOBILE);

    this.mode = 'playing';
    this.matchTime = 0;
    this.ended = false;
    this.cinematicT = 0;

    const spawn = this.terrain.randomLandPoint(Math.random, 4);
    const start = new THREE.Vector3(spawn.x, 195, spawn.z);
    this.player.reset(start);
    this.player.root.visible = true;
    this.player.root.position.copy(start);
    this.player.pitch = -0.55;
    this.player.yaw = Math.random() * Math.PI * 2;
    this.player.ads = false;

    this.hud.clearNameplates();
    this.bots.spawn(IS_MOBILE ? 7 : 9);
    this.world.reset();
    this.zone.reset();
    this.hud.refreshWeapon();
    this.hud.refreshVitals();
    this.hud.setZoneWarning(false);
    this.hud.setDropHint(true);
    this.hud.banner('DROP IN', 1800);

    this.input.enabled = true;
    this.input.fireHeld = false;
    this.input.firePressed = false;
    this.input.crouchToggle = false;
    this.input.requestLock();

    this.camera.fov = 72;
    this.camera.updateProjectionMatrix();
    this.cinematicT = 0;
    this.flashFade();
  }

  toMenu() {
    this.mode = 'menu';
    this.player.root.visible = false;
    this.hud.hide();
    this.hud.hideEnd();
    this.bots.clear();
    this.zone.mesh.visible = false;
    this.input.enabled = false;
    $('menu').classList.remove('hidden');
    this.cinematicT = 1.5;
    this.camera.fov = 58;
    this.camera.updateProjectionMatrix();
    this.refreshMenuStats();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  onLanded() {
    this.hud.setDropHint(false);
    this.hud.toast('WEAPON READY — GO LOOT');
  }

  totalPlayers() {
    return 1 + (this.bots ? this.bots.list.length : 9);
  }

  totalAlive() {
    if (!this.bots) return 10;
    return (this.player && this.player.alive ? 1 : 0) + this.bots.aliveCount;
  }

  onBotKilled(bot, killer) {
    const byPlayer = killer === this.player;
    this.hud.addFeed(byPlayer ? 'YOU' : killer && killer.name ? killer.name : 'ZONE', bot.name, false, byPlayer);
    audio.click(byPlayer ? 880 : 420, 0.12, 0.12);

    if (byPlayer) {
      this.player.kills++;
      this.hud.banner(`<em>ELIMINATED</em> ${bot.name}`, 1100);
    }

    // drop a reward
    const roll = Math.random();
    const x = bot.position.x, z = bot.position.z;
    if (roll < 0.55) this.world.addLoot(x, z, 'weapon', bot.weaponId);
    else if (roll < 0.75) this.world.addLoot(x, z, 'ammo', null, 60);
    else if (roll < 0.92) this.world.addLoot(x, z, 'medkit');
    else this.world.addLoot(x, z, 'armor');

    if (this.player.alive && this.bots.aliveCount === 0) this.endMatch(true);
  }

  onPlayerDeath() {
    this.hud.banner('ELIMINATED', 1600);
    audio.click(120, 0.25, 0.5);
    this.endMatch(false);
  }

  endMatch(win) {
    if (this.ended) return;
    this.ended = true;
    this.mode = 'over';
    this.input.enabled = false;
    this.input.fireHeld = false;
    const place = win ? 1 : this.bots.aliveCount + 1;
    this.stats.matches++;
    if (win) this.stats.wins++;
    this.stats.kills += this.player.kills;
    this.saveStats();

    if (document.pointerLockElement) document.exitPointerLock();

    setTimeout(() => {
      this.hud.showEnd({
        win,
        place,
        kills: this.player.kills,
        damage: this.player.damageDealt,
        time: this.matchTime,
        total: this.totalPlayers(),
      });
      this.hud.hide();
    }, win ? 1100 : 1600);
  }

  // ================= raycasting =================
  raycastShot(origin, dir, maxDist, shooter) {
    let best = null;
    let bestDist = maxDist;

    // bots
    for (const bot of this.bots.list) {
      if (!bot.alive || bot === shooter) continue;
      const headC = new THREE.Vector3(bot.position.x, bot.position.y + 1.66, bot.position.z);
      const bodyC = new THREE.Vector3(bot.position.x, bot.position.y + 1.12, bot.position.z);
      const hipC = new THREE.Vector3(bot.position.x, bot.position.y + 0.72, bot.position.z);
      const legC = new THREE.Vector3(bot.position.x, bot.position.y + 0.32, bot.position.z);

      let hitT = raySphere(origin, dir, headC, 0.24);
      let head = hitT !== null;
      if (hitT === null) {
        const b = raySphere(origin, dir, bodyC, 0.34);
        if (b !== null) hitT = b;
      }
      if (hitT === null) {
        const h = raySphere(origin, dir, hipC, 0.3);
        if (h !== null) hitT = h;
      }
      if (hitT === null) {
        const l = raySphere(origin, dir, legC, 0.28);
        if (l !== null) hitT = l;
      }
      if (hitT !== null && hitT < bestDist) {
        bestDist = hitT;
        best = {
          bot,
          head,
          dist: hitT,
          point: origin.clone().addScaledVector(dir, hitT),
          normal: dir.clone().negate(),
        };
      }
    }

    // buildings
    const end = origin.clone().addScaledVector(dir, maxDist);
    const boxT = this.world.colliders.segmentHit(origin.x, origin.y, origin.z, end.x, end.y, end.z);
    if (boxT < 1) {
      const d = boxT * maxDist;
      if (d < bestDist) {
        bestDist = d;
        best = {
          dist: d,
          point: origin.clone().addScaledVector(dir, d),
          normal: dir.clone().negate(),
        };
      }
    }

    // terrain (march)
    let t = 0.5;
    while (t < bestDist) {
      const step = Math.max(0.8, t * 0.02);
      t += step;
      const px = origin.x + dir.x * t;
      const py = origin.y + dir.y * t;
      const pz = origin.z + dir.z * t;
      if (py < this.terrain.heightAt(px, pz)) {
        bestDist = t;
        best = {
          dist: t,
          point: new THREE.Vector3(px, py, pz),
          normal: this.terrain.normalAt(px, pz),
        };
        break;
      }
      if (t > 620) break;
    }

    return best;
  }

  // ================= frame loop =================
  loop() {
    requestAnimationFrame(this.loop);
    const dtRaw = this.clock.getDelta();
    const dt = Math.min(dtRaw, 0.05);
    this.time += dt;

    if (this.mode === 'menu' || this.mode === 'boot') {
      this.cinematicT += dt;
      this.updateCinematic(dt);
    } else if (this.mode === 'playing') {
      this.matchTime += dt;
      this.input.enabled = true;
      this.player.update(dt, this.input);
      this.bots.update(dt);
      this.zone.update(dt, this);
      this.world.update(dt, this.player, (item) => this.player.pickLoot(item));
      this.effects.update(dt);
      this.hud.update(dt);
      this.hud.setDropHint(this.player.state === 'drop');
    } else if (this.mode === 'over') {
      this.bots.update(dt);
      this.effects.update(dt);
      this.hud.update(dt);
      this.player.updateCamera(dt);
    }

    this.terrain.update(this.time, this.camera);
    this.sky.update(this.time, this.camera, this.camera.position);
    this.pipeline.render(this.time, dt);
  }

  updateCinematic(dt) {
    const a = this.cinematicT * 0.055 + 1.2;
    const r = 330 + Math.sin(this.cinematicT * 0.12) * 40;
    const y = 120 + Math.sin(this.cinematicT * 0.2) * 22;
    this.camera.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    this.camera.lookAt(0, 18, 20);
    if (Math.abs(this.camera.fov - 58) > 0.01) {
      this.camera.fov = 58;
      this.camera.updateProjectionMatrix();
    }
    this.sky.update(this.time, this.camera, this.camera.position);
  }
}

const game = new Game();
window.__game = game;
game.boot().catch((err) => {
  console.error(err);
  const t = document.getElementById('load-text');
  if (t) t.textContent = 'BOOT ERROR: ' + err.message;
});

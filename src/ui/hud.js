import * as THREE from 'three';
import { clamp, formatTime, damp } from '../engine/utils.js';
import { WORLD } from '../engine/terrain.js';

const $ = (id) => document.getElementById(id);
const MAP_SPAN = 640; // world half-extent shown on the minimap

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'),
      alive: $('alive-count'),
      kills: $('kill-count'),
      clock: $('match-clock'),
      hpFill: $('hp-fill'),
      hpText: $('hp-text'),
      arFill: $('ar-fill'),
      arText: $('ar-text'),
      medCount: $('med-count'),
      shieldCount: $('shield-count'),
      wpnName: $('wpn-name'),
      wpnType: $('wpn-type'),
      wpnSlot: $('wpn-slot'),
      ammoMag: $('ammo-mag'),
      ammoRes: $('ammo-res'),
      reloadRow: $('reload-row'),
      reloadFill: $('reload-fill'),
      slot1: $('slot-1'),
      slot2: $('slot-2'),
      slot1Name: $('slot-1-name'),
      slot2Name: $('slot-2-name'),
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      toast: $('loot-toast'),
      banner: $('banner'),
      zoneWarn: $('zone-warn'),
      zoneText: $('zone-text'),
      zoneTime: $('zone-time'),
      zoneChip: $('zone-chip'),
      feed: $('killfeed'),
      dmgNumbers: $('dmg-numbers'),
      dmgDirs: $('dmg-dirs'),
      dropHint: $('drop-hint'),
      compassStrip: $('compass-strip'),
      minimap: $('minimap'),
      matchClock: $('match-clock'),
      endScreen: $('endscreen'),
      endTitle: $('end-title'),
      endKicker: $('end-kicker'),
      endSub: $('end-sub'),
      endKills: $('end-kills'),
      endDmg: $('end-dmg'),
      endPlace: $('end-place'),
      endTime: $('end-time'),
      mobile: $('mobile-ui'),
    };
    this.ctx = this.el.minimap.getContext('2d');
    this.minimapSize = 440;
    this.el.minimap.width = this.minimapSize;
    this.el.minimap.height = this.minimapSize;

    this.damage = 0;
    this.mapTimer = 0;
    this.hitTimer = 0;
    this._buildCompass();
    this._buildMinimapBg();
    this._buildNameplates();
    this._vitals = { hp: -1, armor: -1, med: -1, shield: -1 };
    this._lastWeapon = null;
  }

  clearNameplates() {
    if (!this.nameplateHost) return;
    this.nameplateHost.innerHTML = '';
    this.nameplates.clear();
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  // ---------------- compass ----------------
  _buildCompass() {
    const pxPerDeg = 2.4;
    this.pxPerDeg = pxPerDeg;
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    const frag = document.createDocumentFragment();
    for (let deg = -180; deg <= 540; deg += 15) {
      const d = ((deg % 360) + 360) % 360;
      const span = document.createElement('span');
      span.textContent = labels[d] ?? String(d).padStart(3, '0');
      if (labels[d]) span.style.color = d === 0 ? '#ff9a4d' : 'rgba(210,240,255,.95)';
      span.style.position = 'absolute';
      span.style.left = `${(deg + 180) * pxPerDeg}px`;
      span.style.transform = 'translateX(-50%)';
      frag.appendChild(span);
    }
    this.el.compassStrip.style.width = `${720 * pxPerDeg}px`;
    this.el.compassStrip.appendChild(frag);
  }

  // ---------------- minimap ----------------
  _buildMinimapBg() {
    const size = 220;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const t = this.game.terrain;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const wx = (x / size - 0.5) * MAP_SPAN * 2;
        const wz = (y / size - 0.5) * MAP_SPAN * 2;
        const h = t.heightAt(wx, wz);
        const slope = t.slopeAt(wx, wz);
        let r, g, b;
        if (h < -2) { r = 12; g = 46; b = 74; }
        else if (h < 0.6) { r = 18; g = 74; b = 96; }
        else if (h < 2.6) { r = 196; g = 178; b = 128; }
        else if (h < 6) { r = 150; g = 164; b = 96; }
        else if (h < 30) { r = 74; g = 112; b = 58; }
        else if (h < 48) { r = 58; g = 92; b = 50; }
        else { r = 110; g = 106; b = 92; }
        if (slope > 0.35) { r = Math.min(255, r + 35); g = Math.min(255, g + 30); b = Math.min(255, b + 25); }
        const i = (y * size + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // subtle grid
    ctx.strokeStyle = 'rgba(120,220,255,0.10)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo((size / 4) * i, 0); ctx.lineTo((size / 4) * i, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (size / 4) * i); ctx.lineTo(size, (size / 4) * i); ctx.stroke();
    }
    this.mapBg = c;
  }

  _buildNameplates() {
    const container = document.createElement('div');
    container.id = 'nameplates';
    container.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    this.el.hud.appendChild(container);
    this.nameplateHost = container;
    this.nameplates = new Map();
    this._npVector = new THREE.Vector3();
  }

  // ---------------- basic setters ----------------
  setAlive(n) {
    if (this.el.alive.textContent !== String(n)) this.el.alive.textContent = String(n);
  }

  setClock(sec) {
    const t = formatTime(sec);
    if (this.el.clock.textContent !== t) this.el.clock.textContent = t;
  }

  setKills(k) {
    // kills displayed through the feed/alive counter context; store for end screen
    this.kills = k;
  }

  refreshVitals() {
    const p = this.game.player;
    const hp = Math.ceil(p.health);
    if (hp !== this._vitals.hp) {
      this.el.hpFill.style.width = `${clamp(p.health, 0, 100)}%`;
      this.el.hpText.textContent = hp;
      this.el.hpFill.style.background = p.health < 30
        ? 'linear-gradient(90deg,#d92222,#ff7676)'
        : 'linear-gradient(90deg,#16d97a,#6bffb8)';
      this._vitals.hp = hp;
    }
    const armor = Math.ceil(p.armor);
    if (armor !== this._vitals.armor) {
      this.el.arFill.style.width = `${clamp(p.armor, 0, 100)}%`;
      this.el.arText.textContent = armor;
      this._vitals.armor = armor;
    }
    if (p.medkits !== this._vitals.med) {
      this.el.medCount.textContent = `×${p.medkits}`;
      this._vitals.med = p.medkits;
    }
  }

  refreshWeapon() {
    const p = this.game.player;
    const w = p.weapon;
    if (!w) {
      this.el.wpnName.textContent = 'UNARMED';
      this.el.wpnType.textContent = 'FISTS';
      this.el.ammoMag.textContent = '—';
      this.el.ammoRes.textContent = '—';
      this.el.slot1Name.textContent = '—';
      this.el.slot2Name.textContent = '—';
      return;
    }
    const spec = this.game.player.spec;
    this.el.wpnName.textContent = spec.name;
    this.el.wpnType.textContent = spec.type;
    this.el.wpnSlot.textContent = String(p.slot + 1);
    this.el.slot1.classList.toggle('active', p.slot === 0);
    this.el.slot2.classList.toggle('active', p.slot === 1);
    this.el.slot1Name.textContent = p.slots[0] ? specById(p.slots[0].id) : '—';
    this.el.slot2Name.textContent = p.slots[1] ? specById(p.slots[1].id) : '—';
    this.refreshAmmo();

    function specById(id) {
      return id.toUpperCase();
    }
  }

  refreshAmmo() {
    const p = this.game.player;
    const w = p.weapon;
    if (!w) return;
    this.el.ammoMag.textContent = String(w.ammo);
    this.el.ammoRes.textContent = String(w.reserve);
    this.el.ammoMag.style.color = w.ammo <= 3 ? '#ff6b6b' : '#fff';
  }

  setReloading(on) {
    this.el.reloadRow.classList.toggle('active', on);
    if (!on) this.el.reloadFill.style.width = '0%';
  }

  setReloadProgress(t) {
    this.el.reloadFill.style.width = `${clamp(t, 0, 1) * 100}%`;
  }

  setAmmoLow(v) {
    this.el.ammoMag.classList.toggle('low', v);
  }

  hitmarker(crit = false) {
    const el = this.el.hitmarker;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    el.style.filter = crit ? 'hue-rotate(-20deg) brightness(1.3)' : '';
  }

  damageFlash(amount) {
    this.damage = Math.min(1, this.damage + amount);
    if (this.game.pipeline) this.game.pipeline.setDamage(this.damage * 0.55);
  }

  damageDirection(fromPos, playerPos) {
    const dx = fromPos.x - playerPos.x;
    const dz = fromPos.z - playerPos.z;
    const angle = Math.atan2(dx, dz);
    const p = this.game.player;
    const rel = angle - p.yaw;
    const el = document.createElement('div');
    el.className = 'dmg-dir';
    el.style.transform = `rotate(${-rel}rad)`;
    this.el.dmgDirs.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  damageNumber(worldPos, amount, crit) {
    if (!worldPos) return;
    const v = worldPos.clone().project(this.game.camera);
    if (v.z > 1) return;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const el = document.createElement('div');
    el.className = `dmg-num${crit ? ' crit' : ''}`;
    el.textContent = crit ? `${amount}` : String(amount);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.el.dmgNumbers.appendChild(el);
    setTimeout(() => el.remove(), 850);
  }

  toast(text) {
    const el = this.el.toast;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('show'), 1500);
  }

  banner(text, ms = 1400) {
    const el = this.el.banner;
    el.innerHTML = text;
    el.classList.add('show');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => el.classList.remove('show'), ms);
  }

  setZoneWarning(on) {
    this.el.zoneWarn.classList.toggle('show', on);
  }

  setZoneInfo(label, time, closing) {
    this.el.zoneText.textContent = label;
    this.el.zoneTime.textContent = time;
    this.el.zoneChip.style.borderColor = closing ? 'rgba(90,210,255,.6)' : 'rgba(110,200,245,.18)';
  }

  addFeed(killer, victim, headshot = false, byPlayer = false) {
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = `<b>${killer}</b><span class="kf-vs">eliminated</span>${victim}${headshot ? ' <span class="kf-hs">◎ HS</span>' : ''}`;
    if (byPlayer) row.style.borderLeftColor = '#2ee6ff';
    this.el.feed.prepend(row);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
    setTimeout(() => {
      row.style.opacity = '0';
      row.style.transition = 'opacity .4s';
      setTimeout(() => row.remove(), 400);
    }, 6500);
  }

  setDropHint(on) {
    this.el.dropHint.classList.toggle('show', on);
  }

  // ---------------- frame update ----------------
  update(dt) {
    const game = this.game;
    const p = game.player;

    // damage red-out decay
    if (this.damage > 0) {
      this.damage = Math.max(0, this.damage - dt * 1.8);
      if (game.pipeline) game.pipeline.setDamage(this.damage * 0.55);
    }
    const lowHp = p.alive && p.health < 32;
    if (game.pipeline) game.pipeline.setDamage(Math.max(this.damage * 0.55, lowHp ? 0.22 + Math.sin(performance.now() / 260) * 0.06 : 0));

    // crosshair spread
    const spreadPx = 4 + (p.spreadBloom * 2.2 + (p.moving ? 5 : 0) + (p.state === 'drop' ? 10 : 0)) * (p.ads ? 0.4 : 1);
    this.el.crosshair.style.setProperty('--spread', `${spreadPx.toFixed(1)}px`);
    this.el.crosshair.style.opacity = p.state === 'drop' || !p.alive ? '0.15' : p.ads ? '0.4' : '1';

    // compass
    const heading = ((Math.atan2(Math.sin(p.yaw), -Math.cos(p.yaw)) * 180) / Math.PI + 360) % 360;
    const tx = 150 - (heading + 180) * this.pxPerDeg;
    this.el.compassStrip.style.transform = `translateX(${tx}px)`;

    // zone info
    const z = game.zone;
    this.setZoneInfo(z.getLabel(), z.state === 'final' ? 'FINAL' : z.timeLabel(), z.state === 'shrink');

    // weapon panel sync
    const w = p.weapon;
    const key = w ? `${w.id}|${p.slot}|${p.slots[0] ? p.slots[0].id : '-'}|${p.slots[1] ? p.slots[1].id : '-'}` : 'none';
    if (key !== this._lastWeapon) {
      this._lastWeapon = key;
      this.refreshWeapon();
    }
    this.refreshVitals();

    // clock
    this.setClock(game.matchTime);
    this.setAlive(game.totalAlive());
    if (this.el.kills && this.el.kills.textContent !== String(p.kills)) this.el.kills.textContent = String(p.kills);

    // minimap (10 fps)
    this.mapTimer -= dt;
    if (this.mapTimer <= 0) {
      this.mapTimer = 0.1;
      this.drawMinimap();
    }

    this.updateNameplates(dt);
  }

  drawMinimap() {
    const ctx = this.ctx;
    const DPR = this.minimapSize / 220;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const size = 220;
    const scale = size / (MAP_SPAN * 2);
    const toMap = (x, z) => [(x + MAP_SPAN) * (size / (MAP_SPAN * 2)), (z + MAP_SPAN) * (size / (MAP_SPAN * 2))];
    const game = this.game;

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.mapBg, 0, 0, size, size);

    // zone circles
    const z = game.zone;
    ctx.save();
    ctx.beginPath();
    ctx.arc(...toMap(z.center.x, z.center.y), z.radius * scale, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(70,220,255,0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(60,200,255,0.07)';
    ctx.fill();

    if (z.state !== 'final') {
      ctx.beginPath();
      ctx.arc(...toMap(z.nextCenter.x, z.nextCenter.y), z.nextRadius * scale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // POI labels
    ctx.font = '600 8px Rajdhani, sans-serif';
    ctx.fillStyle = 'rgba(220,245,255,0.65)';
    ctx.textAlign = 'center';
    for (const poi of game.terrain.pois) {
      const [mx, my] = toMap(poi.x, poi.z);
      ctx.fillText(poi.name, mx, my);
    }

    // enemies within scanner range
    const p = game.player;
    for (const bot of game.bots.list) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.position.x - p.position.x, bot.position.z - p.position.z);
      if (d > 95) continue;
      const [mx, my] = toMap(bot.position.x, bot.position.z);
      ctx.beginPath();
      ctx.arc(mx, my, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4d4d';
      ctx.shadowColor = '#ff4d4d';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // player arrow
    const [px, py] = toMap(p.position.x, p.position.z);
    ctx.save();
    ctx.translate(px, py);
    const heading = Math.atan2(Math.sin(p.yaw), -Math.cos(p.yaw));
    ctx.rotate(heading);
    // fov cone
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 34, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    ctx.closePath();
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
    grad.addColorStop(0, 'rgba(120,230,255,0.35)');
    grad.addColorStop(1, 'rgba(120,230,255,0)');
    ctx.fillStyle = grad;
    ctx.fill();
    // arrow
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fillStyle = '#8ef0ff';
    ctx.strokeStyle = '#032630';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  updateNameplates(dt) {
    const game = this.game;
    const cam = game.camera;
    const w = window.innerWidth, h = window.innerHeight;
    const camDir = new THREE.Vector3();
    cam.getWorldDirection(camDir);

    for (const bot of game.bots.list) {
      let plate = this.nameplates.get(bot);
      if (!plate) {
        const el = document.createElement('div');
        el.style.cssText = 'position:absolute;transform:translate(-50%,-100%);text-align:center;transition:opacity .12s;';
        el.innerHTML = `<div style="font:600 11px Rajdhani,sans-serif;letter-spacing:1.4px;color:#ffd9d9;text-shadow:0 1px 4px #000;white-space:nowrap;">
            <span class="np-name"></span></div>
          <div style="width:56px;height:4px;background:rgba(0,0,0,.6);margin:2px auto 0;border:1px solid rgba(255,255,255,.2);">
            <div class="np-hp" style="height:100%;width:100%;background:linear-gradient(90deg,#ff3d3d,#ff8f8f);"></div>
          </div>`;
        this.nameplateHost.appendChild(el);
        plate = { el, hp: el.querySelector('.np-hp'), name: el.querySelector('.np-name'), shown: false };
        plate.name.textContent = bot.name;
        this.nameplates.set(bot, plate);
      }

      const visible = bot.alive && game.player.alive;
      if (!visible) {
        if (plate.shown) { plate.el.style.opacity = '0'; plate.shown = false; }
        continue;
      }

      const world = bot.headPos;
      const dist = world.distanceTo(cam.position);
      const toBot = world.clone().sub(cam.position).normalize();
      const facing = camDir.dot(toBot) > 0.25;
      const v = world.project(cam);
      const onScreen = v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1 && v.z < 1;

      if (!facing || !onScreen || dist > 150) {
        if (plate.shown) { plate.el.style.opacity = '0'; plate.shown = false; }
        continue;
      }

      plate.el.style.opacity = String(clamp(1 - dist / 160, 0.15, 1));
      plate.el.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
      plate.el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
      plate.hp.style.width = `${clamp(bot.health / bot.maxHealth, 0, 1) * 100}%`;
      plate.shown = true;
    }
  }

  showEnd(data) {
    const el = this.el;
    el.endScreen.classList.remove('hidden');
    el.endTitle.textContent = data.win ? 'BOOYAH!' : 'ELIMINATED';
    el.endTitle.classList.toggle('lose', !data.win);
    el.endKicker.textContent = data.win ? 'VICTORY ROYALE' : 'MATCH COMPLETE';
    el.endSub.textContent = data.win
      ? `#1 OF ${data.total} · YOU ARE THE LAST ONE STANDING`
      : `#${data.place} OF ${data.total} · BETTER LUCK NEXT DROP`;
    el.endKills.textContent = String(data.kills);
    el.endDmg.textContent = String(Math.round(data.damage));
    el.endPlace.textContent = `#${data.place}`;
    el.endTime.textContent = formatTime(data.time);
  }

  hideEnd() {
    this.el.endScreen.classList.add('hidden');
  }

  setMobile(on) {
    this.el.mobile.classList.toggle('hidden', !on);
  }
}

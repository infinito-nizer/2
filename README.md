# 🔥 FIRE ZONE — Browser Battle Royale

A complete 3D battle-royale shooter that runs in the browser, inspired by mobile BR titles like Free Fire.
Everything — terrain, ocean, sky, towns, characters, weapons and sound — is **generated procedurally at runtime**.
No external models, textures or audio files: the whole game is code.

![style](https://img.shields.io/badge/engine-three.js%20r187-orange) ![vite](https://img.shields.io/badge/build-vite%208-2ee6ff)

---

## ▶ Run it

```bash
npm install
npm run dev     # http://localhost:5173
```

Production build:

```bash
npm run build && npm run preview
```

---

## 🎮 What's in the box

**World**
- 1.5 km procedural island with fbm + ridged noise heightfield, warped coastline, beaches, cliffs and a 26 m massif
- Vertex-coloured biome blending (wet sand → sand → grass → forest → rock) plus injected micro-detail shading
- HDR sky-dome shader with a real sun disc, atmospheric scattering and drifting 5-octave fbm clouds
- Ocean shader with layered wave normals, fresnel sky reflection, sun glitter, **depth-based shoreline foam** (sampled from the terrain height texture) and manual distance fog
- Five hazy islands on the horizon for depth
- 9 000 instanced grass clumps with GPU wind, 250 instanced trees, instanced palms, rocks and bushes

**Towns & combat spaces**
- 7 named settlements (Cape Town, Bermuda, Riverside, Clocktower, Shipyard, Peak Camp, Sunset Docks)
- Procedurally assembled houses, warehouses, shipping containers, watchtowers, shacks, sandbag cover, barrels, wrecks and tents
- All static geometry is **merged per material** at load: 80+ buildings draw in a couple dozen calls
- Oriented-box collider system with circle push-out, ray occlusion and point queries — doors, interiors and rooftops are all real

**Combat**
- 7 weapons (M500, AK47, M4A1, MP40, M1014, AWM, SCAR-H) with unique procedural models, recoil, spread, bloom, reload timing, pellets and damage falloff
- Third-person over-shoulder camera with ADS zoom, sprint FOV kick, recoil kick, camera shake and terrain/building camera collision
- Hitscan with head/chest/hip/leg hitboxes, headshot multiplier, distance falloff, hit markers and floating damage numbers
- Tracers, muzzle flash + dynamic light, impact decals, spark/dust particles, blood mist, death bursts, explosions
- 9 AI operators with patrol → engage → strafe states, line-of-sight checks, accuracy falloff, bot-vs-bot fights, zone awareness and loot drops
- Shrinking safe zone with an animated energy barrier, escalating damage, and a minimap that shows the next circle

**Presentation**
- ACES filmic tone mapping, HDR bloom, SMAA, cinematic colour grade with vignette + chromatic aberration and a damage red-out
- HUD: alive/kill counters, compass, minimap, kill feed, health/armour, weapon card + 2-slot inventory, reload bar, hit markers, damage direction arcs, zone warnings
- Fully procedural WebAudio: gunshots, reloads, impacts, footsteps, pickups, explosions, ambient wind
- Main menu with a live cinematic island flyover, quality profiles (Smooth / Balanced / Ultra), sensitivity and career stats saved to localStorage
- Touch controls (virtual stick, look drag, fire/jump/crouch/reload/swap/heal) that appear automatically on mobile

---

## 🕹 Controls

| Action | Desktop | Mobile |
| --- | --- | --- |
| Move | `W A S D` | left stick |
| Look / aim | mouse | drag right side |
| Fire | left click | FIRE |
| Aim down sights | right click | — |
| Sprint | `Shift` | — |
| Jump / parachute | `Space` | JUMP |
| Crouch | `C` | CROUCH |
| Reload | `R` | RELOAD |
| Swap weapon | `Q` / `1` `2` / wheel | SWAP |
| Medkit | `H` | HEAL |
| Deploy / lock mouse | click the scene | — |

---

## 🧭 How to win

1. **Drop** — hold `W` to glide toward a settlement, `Space` deploys the chute early.
2. **Loot** — walk over beacons: weapons, ammo, medkits and armour. Weapons auto-equip into the two slots.
3. **Fight** — aim at heads (2.1× damage), burst-fire for accuracy, crouch to tighten spread.
4. **Rotate** — the blue wall shrinks every phase and hurts more each time. Check the minimap for the next circle.
5. **Survive** — last operator standing gets the **BOOYAH!**

---

## 🗂 Structure

```
src/
├─ main.js              game loop, match flow, raycasting, win/lose
├─ style.css            HUD / menu / mobile UI
├─ engine/
│  ├─ terrain.js        island heightfield, water shader, vegetation
│  ├─ sky.js            sky-dome shader, sun & lights, clouds
│  ├─ postfx.js         composer: bloom → SMAA → output → grade
│  ├─ textures.js       procedural canvas textures
│  ├─ audio.js          procedural WebAudio SFX
│  └─ utils.js          noise, rng, math helpers
├─ game/
│  ├─ world.js          towns, buildings, colliders, loot
│  ├─ player.js         movement, camera, shooting, inventory
│  ├─ bots.js           enemy AI
│  ├─ character.js      procedural operator rig + walk cycle
│  ├─ weapons.js        weapon stats and models
│  ├─ effects.js        tracers, particles, decals, explosions
│  ├─ zone.js           safe zone + barrier shader
│  └─ input.js          keyboard / mouse / touch
└─ ui/hud.js            DOM HUD, minimap, nameplates
```

---

## ⚙️ Performance notes

Pick **SMOOTH** on the main menu for integrated GPUs and phones: it lowers the render scale, shadow resolution and disables bloom/SMAA.
**ULTRA** raises the device-pixel-ratio cap to 2×, uses 2048² dynamic shadows and full post-processing.
Grass density is decided at boot based on whether the device reports a coarse pointer (touch); mobile gets none.

---

*Fan-made technical demo. Not affiliated with, endorsed by, or containing any assets from any commercial game.*

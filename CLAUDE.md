# Tower Dungeon — Claude Context

## Project Overview

Tower Dungeon is a roguelike dungeon crawler in a **single file**: `index.html` (3509 lines).
- Vanilla JS + HTML5 Canvas, no frameworks
- All visuals currently drawn with canvas primitives (rectangles, circles, Unicode symbols)
- Tile-based top-down grid movement, max tile size 24px
- 10 hand-crafted floors + procedural generation beyond floor 10
- Audio via Tone.js (synthesized, no audio files)
- Font: Press Start 2P (Google Fonts)

## Active Feature Branch

`claude/pokemon-gameboy-assets-OJUOT`

## Current Task: Game Boy Pokemon Style Assets

The goal is to replace all canvas-primitive rendering with Game Boy Color pixel art sprites, making the game look and feel like a Pokemon Gen 1/2 dungeon.

### Asset Spec
- **Tile size**: 16×16 pixels
- **Palette**: Game Boy Color — max 4–5 colors per sprite
- **Style**: Pokemon Gold/Silver dungeon/cave aesthetic
- **Background**: Solid hot pink/magenta `#FF00FF` chroma key (Gemini can't output true transparency — strip it in-engine at load time)
- **No anti-aliasing**, hard pixel edges, bold 1px black outline

### Gemini Prompt Base Style String
Append to every prompt below:
> "16x16 pixel art, Game Boy Color palette, 4-5 colors maximum, hard pixel edges, no anti-aliasing, no gradients, bold 1-pixel black outline, solid hot pink #FF00FF background, Pokemon Gold/Silver dungeon aesthetic"

---

## Gemini Asset Prompts

### Tileset

| Asset | Prompt |
|-------|--------|
| Stone Wall | "16x16 pixel art tile, dungeon stone brick wall, dark gray bricks with black mortar lines and subtle cracks, seamless repeating tile, top-down view, Pokemon Mt. Moon cave wall style" |
| Stone Floor | "16x16 pixel art tile, dungeon stone floor, light gray with subtle worn texture and faint cracks, seamless repeating tile, top-down view, Pokemon dungeon walkable floor" |
| Water Hazard | "16x16 pixel art tile, dungeon water/swamp hazard, dark navy blue with light blue highlight pixels suggesting ripples, seamless tile, top-down view, Pokemon surf water tile style" |
| Dark/Shadow Tile | "16x16 pixel art tile, shadowy cave floor, almost completely black with faint dark-gray texture, fog-of-war exploration tile, Pokemon dark cave floor" |
| Exit/Staircase | "16x16 pixel art sprite, downward stone staircase, top-down perspective, steps descending into darkness with faint glow at base, Pokemon dungeon exit staircase style" |

### Player

| Asset | Prompt |
|-------|--------|
| Player (4-dir sheet) | "16x16 pixel art sprite sheet, top-down RPG hero, 4 sprites in a row facing down/up/left/right (total 64x16), adventurer with cape and short sword, Pokemon trainer proportions" |

### Monsters (4 Power Tiers)

| Asset | Power Range | Prompt |
|-------|------------|--------|
| Slime | 1–5 | "16x16 pixel art sprite, small green slime creature, top-down view, round blobby body with dot eyes, cute but threatening, Pokemon wild encounter design" |
| Goblin | 6–10 | "16x16 pixel art sprite, goblin enemy, top-down view, small green humanoid with pointy ears and red eyes, holding a crude dagger, Pokemon dungeon encounter style" |
| Orc Warrior | 11–14 | "16x16 pixel art sprite, orc warrior, top-down view, stocky muscular figure with crude iron armor and war axe, Pokemon sub-boss encounter style" |
| Shadow Demon | 15+ | "16x16 pixel art sprite, shadow demon wraith, top-down view, dark cloaked figure with glowing red eyes and dark-purple aura, Pokemon legendary boss silhouette style" |

### Items

| Asset | Prompt |
|-------|--------|
| Torch | "16x16 pixel art, lit torch icon, brown handle, orange-yellow flame with cinders, Pokemon item bag style" |
| Dagger | "16x16 pixel art, short dagger icon, silver blade, brown leather hilt, diagonal orientation" |
| Sword | "16x16 pixel art, iron sword icon, gray blade, brown crossguard and hilt, diagonal orientation" |
| Axe | "16x16 pixel art, battle axe icon, dark gray crescent head on brown handle, angled" |
| Shield | "16x16 pixel art, round wooden shield icon, brown planks with central metal boss, wear marks" |
| Bread/Food | "16x16 pixel art, bread loaf icon, warm tan/brown round loaf with crust lines" |
| Potion | "16x16 pixel art, health potion bottle, small red bottle with cork stopper and faint glow" |
| Iron Ore | "16x16 pixel art, rough iron ore chunk, dark gray jagged rock with metallic sheen" |
| Crystal | "16x16 pixel art, blue-purple crystal shard, faceted gem with highlight pixels" |
| Compass | "16x16 pixel art, explorer's compass, round face with red needle, gold rim, Pokemon Key Item style" |
| Boat | "16x16 pixel art, small wooden rowboat, brown hull with tiny oar, top-down view, Pokemon HM Surf style" |

---

## Integration Plan (code changes to index.html)

### 1. Chroma Key Removal
Add a helper that strips `#FF00FF` from each PNG at load time and returns a cleaned `ImageBitmap`:

```js
async function loadSprite(src) {
  const img = await createImageBitmap(await (await fetch(src)).blob());
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height);
  for (let i = 0; i < data.data.length; i += 4) {
    if (data.data[i] === 255 && data.data[i+1] === 0 && data.data[i+2] === 255) {
      data.data[i+3] = 0; // make #FF00FF transparent
    }
  }
  ctx.putImageData(data, 0, 0);
  return await createImageBitmap(canvas);
}
```

### 2. Sprite Map
Load all sprites into a map at game start:
```js
const SPRITES = {};
async function loadAllSprites() {
  const files = {
    wall: 'assets/wall.png',
    floor: 'assets/floor.png',
    water: 'assets/water.png',
    dark: 'assets/dark.png',
    exit: 'assets/exit.png',
    player: 'assets/player.png',   // 64x16 sheet, 4 directions
    monster_1: 'assets/slime.png',
    monster_2: 'assets/goblin.png',
    monster_3: 'assets/orc.png',
    monster_4: 'assets/demon.png',
    // items...
  };
  for (const [key, src] of Object.entries(files)) {
    SPRITES[key] = await loadSprite(src);
  }
}
```

### 3. Rendering Swap
- `ctx.imageSmoothingEnabled = false` — must be set to keep pixels crisp at any scale
- Replace tile `fillRect` calls with `ctx.drawImage(SPRITES.wall, px, py, tileSize, tileSize)`
- Monster tier: `power <= 5 → monster_1`, `<= 10 → monster_2`, `<= 14 → monster_3`, else `monster_4`
- Player direction: slice correct 16x16 from the 64x16 sheet based on `player.dir`
- Fall back to current canvas drawing if a sprite hasn't loaded

### Key rendering functions in index.html to modify:
- Map/tile drawing: search for `ctx.fillStyle = 'rgba(102,102,102'` (walls) around line 2704
- Monster drawing: search for `drawMonster` or Unicode star symbols `✷✸✹✺✻`
- Player drawing: search for `drawPlayer`
- Item/loot drawing: search for `drawLoot` or item rendering

---

## Asset Folder Convention
Place all PNGs in `/assets/` at the repo root once generated.

## Session Teleport Note
To resume a Claude Code web session locally:
```bash
claude --teleport session_01KpaCLTrBcdvGiFWn8fVk9E
```

# Visual Polish Guide: From Grid to Game

## Current State Analysis

**What You Have:**
- Top-down orthogonal view with 64×64 square tiles
- Flat terrain colors with subtle hash-based variation
- Soft border gradients between terrain types
- Basic textures (noise, mowing patterns, water waves)
- Nice UI chrome (rounded frames, soft shadows, radial gradients)
- Dual rendering (Canvas 2D + Pixi.js WebGL)

**What Makes It Feel Like "Just a Canvas with Squares":**
1. Perfect square grid is very visible
2. No depth or perspective
3. Flat, top-down view with no 3D feel
4. Minimal visual variety within terrain types
5. Static scene (no animation)
6. Hard geometric edges despite soft gradients

---

## Transformation Strategy: 7 Levels of Polish

### 🎨 **Level 1: Hide the Grid (Quick Wins - 1-2 days)**

**Problem:** Square tiles are too obvious, making it look like a spreadsheet

**Solutions:**

#### 1.1 Rounded Tile Corners
```typescript
// In drawTileTexture(), round the corners slightly
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// Use: ctx.clip() or ctx.fill() with rounded path
// Radius: size * 0.08 for subtle rounding
```

#### 1.2 Stronger Edge Blending
```typescript
// Increase soft edge thickness from 0.24 to 0.35-0.45
const t = Math.max(1, Math.min(12, Math.floor(size * 0.35)));

// Make transitions more organic with multi-stop gradients
g.addColorStop(0, c0);
g.addColorStop(0.4, cMid);  // Add middle color
g.addColorStop(1, c1);
```

#### 1.3 Irregular Tile Offsets
```typescript
// Add subtle per-tile position jitter (1-2px at most)
const jitterX = (hash01(seed + 1000) - 0.5) * 2;
const jitterY = (hash01(seed + 2000) - 0.5) * 2;
// Apply to drawing position, NOT collision/logic
```

**Impact:** Grid becomes 30-40% less noticeable

---

### 🌍 **Level 2: Isometric/Dimetric View (Medium - 3-5 days)**

**Problem:** Top-down view is flat and boring, no sense of depth

**Solution:** Add isometric or dimetric (2:1) projection

#### 2.1 Choose Projection Style

**Option A: Dimetric (2:1 ratio) - RECOMMENDED**
- Easier to implement than true isometric
- Better for UI (less distortion)
- Similar to SimGolf/RollerCoaster Tycoon
- Tile footprint: width = size * 2, height = size * 1

**Option B: True Isometric (30°)**
- Classic isometric look
- More complex depth sorting
- Tile footprint: diamond shape

#### 2.2 Implementation (Dimetric)

```typescript
// Camera transform
interface CameraState {
  zoom: number;
  offsetX: number;
  offsetY: number;
  projection: 'orthogonal' | 'dimetric';
  dimetricAngle: number; // typically 26.565° (arctan(0.5))
}

// World to screen (dimetric)
function worldToScreen(
  worldX: number,
  worldY: number,
  tileSize: number
): { x: number, y: number } {
  // Dimetric 2:1 projection
  const screenX = (worldX - worldY) * tileSize;
  const screenY = (worldX + worldY) * (tileSize * 0.5);
  return { x: screenX, y: screenY };
}

// Screen to world (for mouse picking)
function screenToWorld(
  screenX: number,
  screenY: number,
  tileSize: number
): { x: number, y: number } {
  const worldX = (screenX / tileSize + screenY / (tileSize * 0.5)) / 2;
  const worldY = (screenY / (tileSize * 0.5) - screenX / tileSize) / 2;
  return { x: worldX, y: worldY };
}

// Render tiles with depth sorting (back-to-front)
function renderDimetric(course: Course, tileSize: number) {
  // Sort tiles by depth (y + x) for proper layering
  const tiles = [];
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      tiles.push({ x, y, depth: x + y });
    }
  }

  // Render back-to-front
  tiles.sort((a, b) => a.depth - b.depth);

  for (const tile of tiles) {
    const { x: sx, y: sy } = worldToScreen(tile.x, tile.y, tileSize);
    drawDimetricTile(ctx, tile, sx, sy, tileSize);
  }
}
```

#### 2.3 Tile Shapes for Dimetric

```typescript
// Draw diamond-shaped tile footprint
function drawDimetricTile(
  ctx: CanvasRenderingContext2D,
  tile: { x: number, y: number, terrain: Terrain },
  screenX: number,
  screenY: number,
  tileSize: number
) {
  const w = tileSize;
  const h = tileSize * 0.5;

  // Diamond path
  ctx.beginPath();
  ctx.moveTo(screenX, screenY);           // top
  ctx.lineTo(screenX + w, screenY + h);   // right
  ctx.lineTo(screenX, screenY + h * 2);   // bottom
  ctx.lineTo(screenX - w, screenY + h);   // left
  ctx.closePath();

  // Fill with terrain texture
  ctx.fillStyle = COLORS[tile.terrain];
  ctx.fill();
}
```

**Impact:** Completely transforms the visual feel, adds depth

---

### 🎭 **Level 3: Height & Elevation (Medium - 2-4 days)**

**Problem:** Everything is flat, no sense of topology

**Solution:** Add height data and visual depth cues

#### 3.1 Add Height Map

```typescript
interface Course {
  tiles: Terrain[];
  heights: number[];  // NEW: 0-255 height per tile
  // ... rest
}

// Generate height map (perlin noise or diamond-square)
function generateHeightMap(width: number, height: number, seed: number): number[] {
  const heights = new Array(width * height);
  // Use simplex/perlin noise for smooth elevation
  // Or: import a noise library like simplex-noise
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      heights[idx] = perlinNoise(x * 0.1, y * 0.1, seed) * 128 + 128;
    }
  }
  return heights;
}
```

#### 3.2 Render Height Visually

**Method A: Vertical Offset (Isometric)**
```typescript
// Raise tiles based on height
const heightOffset = heights[tileIdx] * 0.1; // scale factor
const screenY = baseScreenY - heightOffset;
```

**Method B: Shading (Top-Down)**
```typescript
// Lighter = higher elevation, darker = lower
const heightValue = heights[tileIdx]; // 0-255
const shadeFactor = (heightValue - 128) / 255 * 0.15; // ±0.15
ctx.fillStyle = shadeHex(COLORS[terrain], shadeFactor);
```

**Method C: Contour Lines**
```typescript
// Draw subtle contour lines every N height units
if (heights[tileIdx] % 20 < 2) {
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, size, size);
}
```

**Impact:** Adds topographic realism, strategic depth

---

### 🌲 **Level 4: Rich Terrain Textures (Medium - 3-5 days)**

**Problem:** Terrain looks flat and repetitive despite subtle variations

**Solutions:**

#### 4.1 Autotiling (Marching Squares)

Replace flat tiles with context-aware sprites that blend with neighbors.

```typescript
// Calculate tile variant based on 8 neighbors (256 combinations)
function getAutotileIndex(
  course: Course,
  x: number,
  y: number,
  targetTerrain: Terrain
): number {
  let index = 0;
  const offsets = [
    [-1, -1], [0, -1], [1, -1],  // top row
    [-1,  0],          [1,  0],  // middle
    [-1,  1], [0,  1], [1,  1],  // bottom
  ];

  for (let i = 0; i < 8; i++) {
    const [dx, dy] = offsets[i];
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < course.width && ny < course.height) {
      const nTerrain = course.tiles[ny * course.width + nx];
      if (nTerrain === targetTerrain) {
        index |= (1 << i);
      }
    }
  }

  return index;
}

// Simplified: Use 4-neighbor bitmask for 16 variants
function getSimpleAutotile(course: Course, x: number, y: number): number {
  const N = getNeighbor(x, y - 1) === currentTerrain ? 1 : 0;
  const E = getNeighbor(x + 1, y) === currentTerrain ? 2 : 0;
  const S = getNeighbor(x, y + 1) === currentTerrain ? 4 : 0;
  const W = getNeighbor(x - 1, y) === currentTerrain ? 8 : 0;
  return N | E | S | W;
}
```

**Autotile Variants (16-tile set):**
```
0: Island (all different)
1-14: Various edges/corners
15: Center (all same)
```

#### 4.2 Procedural Texture Detail

```typescript
// Generate richer textures for each terrain type

// GRASS (fairway/rough/deep_rough)
function drawGrassTexture(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, size: number,
  darkness: number, seed: number
) {
  const baseColor = shadeHex(COLORS.fairway, darkness);
  ctx.fillStyle = baseColor;
  ctx.fillRect(x, y, size, size);

  // Grass blades (tiny random strokes)
  ctx.strokeStyle = `rgba(0,0,0,0.06)`;
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 12; i++) {
    const gx = x + hash01(seed + i * 13) * size;
    const gy = y + hash01(seed + i * 17) * size;
    const angle = hash01(seed + i * 19) * Math.PI;
    const len = 2 + hash01(seed + i * 23) * 2;

    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + Math.cos(angle) * len, gy + Math.sin(angle) * len);
    ctx.stroke();
  }

  // Mowing pattern (directional stripes)
  const stripeDir = Math.floor(seed / 100) % 2; // alternate direction
  ctx.globalAlpha = 0.03;
  ctx.fillStyle = stripeDir ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
  if ((Math.floor(x / size) + Math.floor(y / size)) % 2 === stripeDir) {
    ctx.fillRect(x, y, size, size);
  }
  ctx.globalAlpha = 1;
}

// WATER
function drawWaterTexture(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, size: number,
  time: number  // animation frame
) {
  // Animated water using sine waves
  const baseColor = COLORS.water;
  ctx.fillStyle = baseColor;
  ctx.fillRect(x, y, size, size);

  // Ripples (animated)
  ctx.globalAlpha = 0.15;
  for (let i = 0; i < 3; i++) {
    const phase = (time * 0.02 + i * 0.3) % 1;
    const wave = Math.sin(phase * Math.PI * 2) * 0.5 + 0.5;
    const yPos = y + size * phase;

    ctx.fillStyle = `rgba(255,255,255,${wave * 0.6})`;
    ctx.fillRect(x, yPos, size, 1.5);
  }
  ctx.globalAlpha = 1;

  // Reflection shimmer
  const shimmer = Math.sin(time * 0.05) * 0.1;
  ctx.globalAlpha = 0.08 + shimmer;
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, size, size);
  ctx.globalAlpha = 1;
}

// SAND
function drawSandTexture(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, size: number, seed: number
) {
  ctx.fillStyle = COLORS.sand;
  ctx.fillRect(x, y, size, size);

  // Sand granules (many tiny dots)
  for (let i = 0; i < 20; i++) {
    const sx = x + hash01(seed + i * 11) * size;
    const sy = y + hash01(seed + i * 13) * size;
    const brightness = hash01(seed + i * 17) > 0.5 ? 1 : -1;

    ctx.fillStyle = `rgba(${brightness > 0 ? 255 : 0},${brightness > 0 ? 255 : 0},${brightness > 0 ? 200 : 0},0.08)`;
    ctx.fillRect(sx, sy, 1, 1);
  }

  // Bunker rake lines (if adjacent to grass)
  // ... (draw subtle parallel lines for raked sand effect)
}
```

#### 4.3 Texture Atlases for Pixi.js

For better performance with Pixi.js, pre-render textures to a sprite atlas:

```typescript
// Generate 256×256 texture atlas with all terrain variants
function generateTerrainAtlas(): PIXI.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d')!;

  const tileSize = 128;
  let atlasX = 0, atlasY = 0;

  for (const terrain of Object.keys(COLORS)) {
    for (let variant = 0; variant < 16; variant++) {
      // Draw autotile variant
      drawTerrainVariant(ctx, atlasX, atlasY, tileSize, terrain, variant);

      atlasX += tileSize;
      if (atlasX >= 2048) {
        atlasX = 0;
        atlasY += tileSize;
      }
    }
  }

  return PIXI.Texture.from(canvas);
}
```

**Impact:** Eliminates repetitive look, adds visual richness

---

### ✨ **Level 5: Shadows & Lighting (Advanced - 4-6 days)**

**Problem:** No sense of light source or depth

**Solutions:**

#### 5.1 Directional Shadows

```typescript
// Add shadow layer for obstacles/trees
function drawObstacleShadow(
  ctx: CanvasRenderingContext2D,
  obstacle: Obstacle,
  lightAngle: number = Math.PI * 0.25  // 45° from top-right
) {
  const shadowLength = obstacle.radius * 0.6;
  const shadowX = obstacle.x + Math.cos(lightAngle) * shadowLength;
  const shadowY = obstacle.y + Math.sin(lightAngle) * shadowLength;

  // Radial gradient shadow
  const gradient = ctx.createRadialGradient(
    obstacle.x, obstacle.y, 0,
    shadowX, shadowY, obstacle.radius * 1.2
  );
  gradient.addColorStop(0, 'rgba(0,0,0,0.25)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(
    shadowX - obstacle.radius * 1.2,
    shadowY - obstacle.radius * 1.2,
    obstacle.radius * 2.4,
    obstacle.radius * 2.4
  );
}
```

#### 5.2 Ambient Occlusion

```typescript
// Darken tiles surrounded by obstacles/trees
function calculateAmbientOcclusion(
  course: Course,
  obstacles: Obstacle[],
  tileX: number,
  tileY: number,
  tileSize: number
): number {
  let occlusion = 0;
  const centerX = (tileX + 0.5) * tileSize;
  const centerY = (tileY + 0.5) * tileSize;

  for (const obs of obstacles) {
    if (obs.type !== 'tree') continue;

    const dist = Math.hypot(obs.x - centerX, obs.y - centerY);
    const radius = obs.radius * 2; // shadow radius

    if (dist < radius) {
      occlusion += (1 - dist / radius) * 0.15;
    }
  }

  return Math.min(occlusion, 0.3); // cap at 30% darkening
}

// Apply when drawing tile
const ao = calculateAmbientOcclusion(course, obstacles, tx, ty, tileSize);
ctx.fillStyle = shadeHex(baseColor, -ao);
```

#### 5.3 Time of Day Lighting

```typescript
// Add global lighting state
interface LightingState {
  timeOfDay: number;  // 0-24 hours
  ambientColor: string;
  shadowIntensity: number;
}

function getLightingForTime(hour: number): LightingState {
  if (hour >= 6 && hour < 8) {
    // Dawn - warm orange
    return {
      timeOfDay: hour,
      ambientColor: 'rgba(255, 200, 150, 0.15)',
      shadowIntensity: 0.2
    };
  } else if (hour >= 8 && hour < 18) {
    // Day - neutral
    return {
      timeOfDay: hour,
      ambientColor: 'rgba(255, 255, 255, 0.05)',
      shadowIntensity: 0.3
    };
  } else if (hour >= 18 && hour < 20) {
    // Dusk - warm purple
    return {
      timeOfDay: hour,
      ambientColor: 'rgba(200, 150, 255, 0.2)',
      shadowIntensity: 0.4
    };
  } else {
    // Night - cool blue
    return {
      timeOfDay: hour,
      ambientColor: 'rgba(100, 120, 200, 0.35)',
      shadowIntensity: 0.5
    };
  }
}

// Apply as overlay after rendering
function applyLighting(ctx: CanvasRenderingContext2D, lighting: LightingState) {
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = lighting.ambientColor;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.globalCompositeOperation = 'source-over';
}
```

**Impact:** Dramatic depth improvement, atmospheric polish

---

### 🎬 **Level 6: Animation & Life (Advanced - 5-7 days)**

**Problem:** Static scene feels lifeless

**Solutions:**

#### 6.1 Animated Water

```typescript
// Add animation frame counter
let animationFrame = 0;

function renderLoop() {
  animationFrame++;

  // Update water tiles every frame
  for (const tile of waterTiles) {
    drawWaterTexture(ctx, tile.x, tile.y, tileSize, animationFrame);
  }

  requestAnimationFrame(renderLoop);
}
```

#### 6.2 Swaying Trees/Flags

```typescript
// Wind animation
function drawSwayingTree(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  frame: number
) {
  const swayAmount = Math.sin(frame * 0.05 + x * 0.1) * 2;

  ctx.save();
  ctx.translate(x + swayAmount, y);
  // Draw tree sprite
  ctx.restore();
}

// Flag animation on pin
function drawFlagPin(
  ctx: CanvasRenderingContext2D,
  green: Point,
  frame: number
) {
  const wave = Math.sin(frame * 0.08) * 3;

  // Pin pole
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(green.x, green.y);
  ctx.lineTo(green.x, green.y - 20);
  ctx.stroke();

  // Flag (triangle)
  ctx.fillStyle = '#ff0000';
  ctx.beginPath();
  ctx.moveTo(green.x, green.y - 20);
  ctx.lineTo(green.x + 10 + wave, green.y - 17);
  ctx.lineTo(green.x, green.y - 14);
  ctx.closePath();
  ctx.fill();
}
```

#### 6.3 Particle Effects

```typescript
// Simple particle system
class Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.1; // gravity
    this.life--;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const alpha = this.life / this.maxLife;
    ctx.fillStyle = this.color.replace('1)', `${alpha})`);
    ctx.fillRect(this.x, this.y, this.size, this.size);
  }
}

// Splash when ball lands in water
function createWaterSplash(x: number, y: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < 10; i++) {
    particles.push(new Particle({
      x, y,
      vx: (Math.random() - 0.5) * 4,
      vy: -Math.random() * 5,
      life: 30,
      maxLife: 30,
      color: 'rgba(255,255,255,1)',
      size: 2
    }));
  }
  return particles;
}
```

#### 6.4 Cloud Shadows

```typescript
// Slow-moving clouds cast shadows
let cloudX = 0;

function updateCloudShadows(frame: number) {
  cloudX = (frame * 0.1) % (COURSE_WIDTH * tileSize + 200);
}

function drawCloudShadow(ctx: CanvasRenderingContext2D) {
  const gradient = ctx.createRadialGradient(
    cloudX, 100, 0,
    cloudX, 100, 300
  );
  gradient.addColorStop(0, 'rgba(0,0,0,0.08)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(cloudX - 300, 0, 600, COURSE_HEIGHT * tileSize);
}
```

**Impact:** Game feels alive and dynamic

---

### 🎨 **Level 7: UI Polish (Medium - 3-4 days)**

**Problem:** UI looks functional but not polished

**Solutions:**

#### 7.1 Custom Course Frame Border

```typescript
// Replace simple border-radius with ornate frame
function drawCourseFrame(ctx: CanvasRenderingContext2D, width: number, height: number) {
  // Wood grain texture
  const woodGradient = ctx.createLinearGradient(0, 0, 0, height);
  woodGradient.addColorStop(0, '#8b6f47');
  woodGradient.addColorStop(0.5, '#6b5437');
  woodGradient.addColorStop(1, '#8b6f47');

  // Frame border (16px thick)
  const thickness = 16;
  ctx.fillStyle = woodGradient;
  ctx.fillRect(0, 0, width, thickness); // top
  ctx.fillRect(0, height - thickness, width, thickness); // bottom
  ctx.fillRect(0, 0, thickness, height); // left
  ctx.fillRect(width - thickness, 0, thickness, height); // right

  // Corner embellishments
  drawCornerOrnament(ctx, thickness, thickness);
  drawCornerOrnament(ctx, width - thickness, thickness);
  drawCornerOrnament(ctx, thickness, height - thickness);
  drawCornerOrnament(ctx, width - thickness, height - thickness);
}
```

#### 7.2 Better Buttons & Icons

```css
/* Glass morphism buttons */
.game-button {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 12px;
  padding: 12px 24px;
  color: var(--cc-ink);
  font-weight: 600;
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  transition: all 0.2s ease;
}

.game-button:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: translateY(-2px);
  box-shadow:
    0 6px 16px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.game-button:active {
  transform: translateY(0);
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

/* Neumorphic terrain buttons */
.terrain-button {
  background: linear-gradient(145deg, #f0f0f0, #cacaca);
  box-shadow:
    5px 5px 10px rgba(0, 0, 0, 0.1),
    -5px -5px 10px rgba(255, 255, 255, 0.7);
  border: none;
  border-radius: 14px;
  padding: 16px;
  transition: all 0.2s ease;
}

.terrain-button.active {
  background: linear-gradient(145deg, #cacaca, #f0f0f0);
  box-shadow:
    inset 5px 5px 10px rgba(0, 0, 0, 0.1),
    inset -5px -5px 10px rgba(255, 255, 255, 0.7);
}
```

#### 7.3 Tooltips & Hover States

```typescript
// Rich tooltip system
interface Tooltip {
  title: string;
  description: string;
  cost?: string;
  hotkey?: string;
}

function drawTooltip(
  ctx: CanvasRenderingContext2D,
  tooltip: Tooltip,
  x: number, y: number
) {
  const width = 220;
  const height = tooltip.cost ? 100 : 80;

  // Background with shadow
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
  roundRect(ctx, x, y, width, height, 8);
  ctx.fill();

  ctx.shadowColor = 'transparent';

  // Content
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px var(--font-body)';
  ctx.fillText(tooltip.title, x + 12, y + 24);

  ctx.font = '12px var(--font-body)';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  wrapText(ctx, tooltip.description, x + 12, y + 44, width - 24, 16);

  if (tooltip.cost) {
    ctx.fillStyle = '#ffd700';
    ctx.fillText(tooltip.cost, x + 12, y + height - 12);
  }

  if (tooltip.hotkey) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = 'italic 11px var(--font-body)';
    ctx.textAlign = 'right';
    ctx.fillText(tooltip.hotkey, x + width - 12, y + height - 12);
  }
}
```

#### 7.4 Transition Animations

```css
/* Smooth panel transitions */
.sidebar-panel {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.sidebar-panel.collapsed {
  transform: translateX(100%);
}

/* Fade-in for new elements */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.hole-card {
  animation: fadeInUp 0.4s ease-out;
}
```

**Impact:** Professional game UI feel

---

## Implementation Roadmap

### Phase 1: Quick Visual Wins (Week 1)
**Time:** 3-5 days
**Effort:** Low
**Impact:** Medium

- [ ] Level 1: Hide the Grid (rounded corners, stronger blending)
- [ ] Level 4.2: Richer terrain textures (grass blades, better water)
- [ ] Level 7.2: Button polish (glass morphism styles)

**Deliverable:** Noticeably less "grid-like", more polished UI

---

### Phase 2: Add Depth (Week 2-3)
**Time:** 7-10 days
**Effort:** Medium-High
**Impact:** High

- [ ] Level 2: Dimetric projection (transform entire rendering)
- [ ] Level 3: Height maps (add topology)
- [ ] Level 5.1-5.2: Shadows (obstacles, ambient occlusion)

**Deliverable:** 3D-looking game with depth and dimension

---

### Phase 3: Bring to Life (Week 4)
**Time:** 5-7 days
**Effort:** Medium
**Impact:** High

- [ ] Level 6.1-6.2: Animations (water, trees, flags)
- [ ] Level 4.1: Autotiling (context-aware terrain)
- [ ] Level 7.3-7.4: UI animations (tooltips, transitions)

**Deliverable:** Dynamic, living game world

---

### Phase 4: Final Polish (Week 5)
**Time:** 3-5 days
**Effort:** Low-Medium
**Impact:** Medium

- [ ] Level 5.3: Time of day lighting
- [ ] Level 6.3-6.4: Particle effects, cloud shadows
- [ ] Level 7.1: Custom course frame
- [ ] Performance optimization for all new features

**Deliverable:** AAA-feeling indie game

---

## Visual References & Inspiration

### Games to Study:
1. **SimGolf (2002)** - Dimetric view, soft terrain, good UI
2. **RollerCoaster Tycoon** - Isometric projection, rich detail
3. **Stardew Valley** - Tile blending, depth, charm
4. **Golf Story** - Stylized golf, pixel art polish
5. **Mini Metro** - Minimalist polish, smooth animations

### Key Principles:
- **Hide the math** - Grid should feel invisible
- **Add organic irregularity** - Nature isn't perfect squares
- **Use depth cues** - Shadows, height, overlap
- **Keep it moving** - Subtle animation everywhere
- **Polish ruthlessly** - Every pixel matters

---

## Performance Considerations

### Optimization Strategies:

1. **Texture Caching**
   ```typescript
   const textureCache = new Map<string, HTMLCanvasElement>();

   function getCachedTexture(key: string, generator: () => HTMLCanvasElement) {
     if (!textureCache.has(key)) {
       textureCache.set(key, generator());
     }
     return textureCache.get(key)!;
   }
   ```

2. **Dirty Rectangle Rendering**
   ```typescript
   // Only redraw changed regions
   const dirtyRects: { x: number, y: number, w: number, h: number }[] = [];

   function markDirty(x: number, y: number, width: number, height: number) {
     dirtyRects.push({ x, y, w: width, h: height });
   }

   function renderDirtyRegions() {
     for (const rect of dirtyRects) {
       renderRegion(rect.x, rect.y, rect.w, rect.h);
     }
     dirtyRects.length = 0;
   }
   ```

3. **Layer Separation**
   ```typescript
   // Render static layers once, animate only what changes
   const layers = {
     terrain: offscreenCanvas1,    // Static (or rarely changes)
     obstacles: offscreenCanvas2,  // Semi-static
     markers: offscreenCanvas3,    // Changes with holes
     effects: offscreenCanvas4,    // Animated (water, particles)
     ui: offscreenCanvas5          // Hover states, selection
   };

   // Composite layers on each frame
   function compositeFrame() {
     ctx.clearRect(0, 0, width, height);
     ctx.drawImage(layers.terrain, 0, 0);
     ctx.drawImage(layers.obstacles, 0, 0);
     ctx.drawImage(layers.markers, 0, 0);
     ctx.drawImage(layers.effects, 0, 0);
     ctx.drawImage(layers.ui, 0, 0);
   }
   ```

4. **Sprite Batching (Pixi.js)**
   ```typescript
   // Use ParticleContainer for many similar sprites
   const treeContainer = new PIXI.ParticleContainer(1000, {
     scale: true,
     position: true,
     rotation: true,
     alpha: true
   });

   // Add all trees to batch
   for (const tree of obstacles.filter(o => o.type === 'tree')) {
     const sprite = new PIXI.Sprite(treeTexture);
     sprite.position.set(tree.x, tree.y);
     treeContainer.addChild(sprite);
   }
   ```

5. **Adaptive Detail**
   ```typescript
   // Reduce detail when zoomed out
   function getDetailLevel(zoom: number): 'low' | 'medium' | 'high' {
     if (zoom < 0.5) return 'low';
     if (zoom < 1.0) return 'medium';
     return 'high';
   }

   // Skip expensive effects at low detail
   if (detailLevel === 'low') {
     // No grass blades, no particles, simple water
   }
   ```

---

## Testing Checklist

### Visual Quality
- [ ] Grid is not obvious at default zoom
- [ ] Terrain transitions look smooth and natural
- [ ] Depth feels convincing (isometric/shadows)
- [ ] Animations are smooth (60fps or 30fps locked)
- [ ] UI feels responsive and polished
- [ ] Colors are harmonious and pleasant
- [ ] Text is readable at all zoom levels

### Performance
- [ ] 60fps at 1920×1080 on mid-range GPU
- [ ] 30fps minimum on integrated graphics
- [ ] No frame drops during terrain painting
- [ ] Smooth zoom/pan interactions
- [ ] Fast initial load (< 3 seconds)
- [ ] Memory usage stable (no leaks)

### Cross-Browser
- [ ] Chrome/Edge (WebGL + Canvas)
- [ ] Firefox (WebGL + Canvas)
- [ ] Safari (WebGL + Canvas, with fallbacks)
- [ ] Mobile Safari (performance mode)
- [ ] Mobile Chrome (touch interactions)

---

## Quick Start: 1-Day Polish Sprint

If you only have **one day** to improve the visuals, focus on:

### Morning (4 hours):
1. **Stronger Edge Blending** (1 hour)
   - Increase soft edge thickness to 0.35-0.45
   - Add multi-stop gradients

2. **Better Terrain Textures** (2 hours)
   - Enhance water with animated waves
   - Add grass blade details
   - Improve sand with more grain

3. **UI Button Polish** (1 hour)
   - Add glass morphism styles
   - Improve hover states
   - Add subtle transitions

### Afternoon (4 hours):
4. **Obstacle Shadows** (2 hours)
   - Add directional shadows for trees/bunkers
   - Ambient occlusion around obstacles

5. **Animated Water** (1 hour)
   - Simple sine wave animation
   - Reflection shimmer

6. **Course Frame Enhancement** (1 hour)
   - Better border styling
   - Vignette effect
   - Subtle grain texture

**Result:** 50-70% visual improvement in one day

---

## Conclusion

The transformation from "canvas with squares" to "polished game" requires:

1. **Hiding the grid** through soft edges and organic shapes
2. **Adding depth** with isometric view, shadows, and height
3. **Enriching textures** with autotiling and procedural detail
4. **Bringing to life** through animation and effects
5. **Polishing UI** with modern design patterns

Start with **Quick Wins (Level 1)**, then progressively add depth and polish. Each level compounds to create a professional-looking game.

The key is **subtlety** - many small improvements that add up to a big difference. SimGolf's charm came from thousands of tiny details working together.

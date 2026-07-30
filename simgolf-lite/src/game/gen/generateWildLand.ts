import type { LandTheme, Terrain, Obstacle, ObstacleType } from "../models/types";
import { getBiomeDefinition, type ThemeGenConfig } from "../models/biomes";
import { isWaterHazard } from "../models/terrainRules";
import { shuffleInPlace } from "../../utils/array";

// Seeded RNG using mulberry32
class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
}

// Generation constants now come from the land theme (ZKU-166); parkland is
// the identity theme carrying the exact values this module shipped with.

interface Point {
  x: number;
  y: number;
}

/**
 * Generate a wild piece of land with natural terrain distribution
 */
export function generateWildLand(
  width: number,
  height: number,
  seed: number,
  theme?: LandTheme
): Terrain[] {
  const cfg: ThemeGenConfig = getBiomeDefinition(theme).generation;
  const rng = new SeededRNG(seed);
  const totalTiles = width * height;
  const tiles: Terrain[] = Array.from({ length: totalTiles }, () => "rough");

  // Helper to get tile at position
  const getTile = (x: number, y: number): Terrain | null => {
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    return tiles[y * width + x];
  };

  const setTile = (x: number, y: number, terrain: Terrain): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    tiles[y * width + x] = terrain;
  };

  // Helper to check if point is valid and not on border
  const isValid = (x: number, y: number, borderMargin: number = 0): boolean => {
    return (
      x >= borderMargin &&
      y >= borderMargin &&
      x < width - borderMargin &&
      y < height - borderMargin
    );
  };

  // Helper to get neighbors
  const getNeighbors = (x: number, y: number): Point[] => {
    return [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ].filter((p) => isValid(p.x, p.y));
  };

  // Step 1: Generate deep rough clusters
  const deepRoughClusters = rng.nextInt(cfg.deepRough.clustersMin, cfg.deepRough.clustersMax);
  for (let i = 0; i < deepRoughClusters; i++) {
    // Pick a random seed point
    const seedX = rng.nextInt(2, width - 3);
    const seedY = rng.nextInt(2, height - 3);
    const clusterSize = rng.nextInt(cfg.deepRough.sizeMin, cfg.deepRough.sizeMax);

    // Grow cluster using random walk
    const visited = new Set<string>();
    const queue: Point[] = [{ x: seedX, y: seedY }];
    visited.add(`${seedX},${seedY}`);

    let placed = 0;
    while (queue.length > 0 && placed < clusterSize) {
      const current = queue.shift()!;
      setTile(current.x, current.y, "deep_rough");
      placed++;

      // Add neighbors with some probability
      for (const neighbor of getNeighbors(current.x, current.y)) {
        const key = `${neighbor.x},${neighbor.y}`;
        if (!visited.has(key) && getTile(neighbor.x, neighbor.y) === "rough") {
          if (rng.next() < 0.6) {
            // 60% chance to add to cluster
            visited.add(key);
            queue.push(neighbor);
          }
        }
      }
    }
  }

  // Step 2: Generate water bodies (connected, away from borders)
  const waterBodies = rng.nextInt(cfg.water.bodiesMin, cfg.water.bodiesMax);
  const waterBorderMargin = 1; // Keep water 1 tile away from border

  for (let i = 0; i < waterBodies; i++) {
    // Pick a seed point away from borders
    const seedX = rng.nextInt(waterBorderMargin + 1, width - waterBorderMargin - 2);
    const seedY = rng.nextInt(waterBorderMargin + 1, height - waterBorderMargin - 2);
    const targetSize = Math.floor(totalTiles * rng.nextFloat(cfg.water.fracMin, cfg.water.fracMax) / waterBodies);

    // Grow water body ensuring connectivity
    const visited = new Set<string>();
    const queue: Point[] = [{ x: seedX, y: seedY }];
    visited.add(`${seedX},${seedY}`);

    let placed = 0;
    while (queue.length > 0 && placed < targetSize) {
      const current = queue.shift()!;
      if (isValid(current.x, current.y, waterBorderMargin)) {
        setTile(current.x, current.y, "water");
        placed++;
      }

      // Add neighbors (prefer existing water neighbors for connectivity)
      const neighbors = getNeighbors(current.x, current.y);
      // Shuffle neighbors for more organic growth
      shuffleInPlace(neighbors, rng);

      for (const neighbor of neighbors) {
        const key = `${neighbor.x},${neighbor.y}`;
        if (!visited.has(key) && isValid(neighbor.x, neighbor.y, waterBorderMargin)) {
          const neighborTile = getTile(neighbor.x, neighbor.y);
          // Prefer growing into rough/deep_rough, avoid existing water clusters
          if (neighborTile === "rough" || neighborTile === "deep_rough") {
            // Higher probability if neighbor is already water
            const isAdjacentToWater = getNeighbors(neighbor.x, neighbor.y).some(
              (n) => getTile(n.x, n.y) === "water"
            );
            const prob = isAdjacentToWater ? 0.7 : 0.4;
            if (rng.next() < prob) {
              visited.add(key);
              queue.push(neighbor);
            }
          }
        }
      }
    }
  }

  // Step 2b (links): a broad open-sea shelf with a wandering dune/rock shore.
  // Gated by theme so parkland/desert retain their exact historical RNG path.
  if (cfg.water.coastalEdge) {
    const edge = rng.nextInt(0, 3); // 0=N 1=E 2=S 3=W
    const along = edge === 0 || edge === 2 ? width : height;
    const across = edge === 0 || edge === 2 ? height : width;
    // Estates need both shallow coastal sites and occasional bays that reach
    // the central starter property. Keeping the range proportional makes the
    // same generator work for previews and full 220×140 maps while leaving
    // most of every estate buildable.
    const minDepth = Math.max(5, Math.floor(across * 0.16));
    const maxDepth = Math.max(minDepth + 2, Math.floor(across * 0.32));
    let depth = rng.nextInt(minDepth, maxDepth);
    for (let i = 0; i < along; i++) {
      // Low-frequency random walk makes bays and headlands without isolated
      // water pockets or the ruler-straight silhouette of the old 1–3 band.
      const stepRoll = rng.next();
      if (stepRoll < 0.24) depth--;
      else if (stepRoll > 0.76) depth++;
      if (i % 11 === 0) depth += rng.nextInt(-1, 1);
      depth = Math.max(minDepth, Math.min(maxDepth, depth));
      for (let d = 0; d < depth; d++) {
        if (edge === 0) setTile(i, d, "water");
        else if (edge === 2) setTile(i, height - 1 - d, "water");
        else if (edge === 3) setTile(d, i, "water");
        else setTile(width - 1 - d, i, "water");
      }
      // Pale dune beach with occasional exposed rocky/fescue breaks. This is
      // the first dry tile inland, so it follows the same natural silhouette.
      const shoreTerrain: Terrain = rng.next() < 0.72 ? "sand" : "deep_rough";
      if (edge === 0) setTile(i, depth, shoreTerrain);
      else if (edge === 2) setTile(i, height - 1 - depth, shoreTerrain);
      else if (edge === 3) setTile(depth, i, shoreTerrain);
      else setTile(width - 1 - depth, i, shoreTerrain);
    }
  }

  // Step 3: Generate sand pockets (small clusters, near water or in rough)
  const sandPockets = rng.nextInt(cfg.sand.pocketsMin, cfg.sand.pocketsMax);
  for (let i = 0; i < sandPockets; i++) {
    // Try to place near water, but fallback to anywhere in rough
    let seedX = rng.nextInt(1, width - 2);
    let seedY = rng.nextInt(1, height - 2);
    let attempts = 0;

    // Prefer placement near water (within 2 tiles)
    while (attempts < 20) {
      const testX = rng.nextInt(1, width - 2);
      const testY = rng.nextInt(1, height - 2);
      const hasNearbyWater = getNeighbors(testX, testY).some((n) => getTile(n.x, n.y) === "water");
      if (hasNearbyWater && getTile(testX, testY) === "rough") {
        seedX = testX;
        seedY = testY;
        break;
      }
      attempts++;
    }

    const pocketSize = rng.nextInt(cfg.sand.sizeMin, cfg.sand.sizeMax);
    const visited = new Set<string>();
    const queue: Point[] = [{ x: seedX, y: seedY }];
    visited.add(`${seedX},${seedY}`);

    let placed = 0;
    while (queue.length > 0 && placed < pocketSize) {
      const current = queue.shift()!;
      if (getTile(current.x, current.y) === "rough") {
        setTile(current.x, current.y, "sand");
        placed++;
      }

      for (const neighbor of getNeighbors(current.x, current.y)) {
        const key = `${neighbor.x},${neighbor.y}`;
        if (!visited.has(key) && getTile(neighbor.x, neighbor.y) === "rough") {
          if (rng.next() < 0.5) {
            visited.add(key);
            queue.push(neighbor);
          }
        }
      }
    }
  }

  const environmental = [...tiles];
  const wetlandCandidates: number[] = [];
  const wasteCandidates: number[] = [];
  let wetlandsPlaced = 0;
  let wastePlaced = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const native = getTile(x, y);
      if (native !== "rough" && native !== "deep_rough") continue;
      const neighbors = getNeighbors(x, y).map((point) => getTile(point.x, point.y));
      const index = y * width + x;
      if (neighbors.includes("water")) {
        wetlandCandidates.push(index);
        if (rng.next() < cfg.environmental.wetlandEdgeChance) {
          environmental[index] = "wetland";
          wetlandsPlaced++;
        }
      } else if (native === "rough" && neighbors.includes("sand")) {
        wasteCandidates.push(index);
        if (rng.next() < cfg.environmental.wasteAreaEdgeChance) {
          environmental[index] = "waste_area";
          wastePlaced++;
        }
      }
    }
  }
  if (wetlandsPlaced === 0 && wetlandCandidates.length > 0) environmental[wetlandCandidates[0]] = "wetland";
  if (wastePlaced === 0 && wasteCandidates.length > 0) environmental[wasteCandidates[0]] = "waste_area";
  for (let i = 0; i < tiles.length; i++) tiles[i] = environmental[i];

  // Step 4: Smoothing pass (cellular automata) for organic shapes
  const smoothingPasses = 2;
  for (let pass = 0; pass < smoothingPasses; pass++) {
    const newTiles = [...tiles];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const current = getTile(x, y)!;
        const neighbors = getNeighbors(x, y);
        const neighborCounts = new Map<Terrain, number>();
        for (const n of neighbors) {
          const t = getTile(n.x, n.y)!;
          neighborCounts.set(t, (neighborCounts.get(t) || 0) + 1);
        }

        // Smooth water: if 3+ neighbors are water, make this water (if it's rough/deep_rough)
        if (current !== "water" && (neighborCounts.get("water") || 0) >= 3) {
          if (current === "rough" || current === "deep_rough") {
            newTiles[y * width + x] = "water";
          }
        }

        // Smooth deep_rough: if 2+ neighbors are deep_rough, make this deep_rough (if it's rough)
        if (current === "rough" && (neighborCounts.get("deep_rough") || 0) >= 2) {
          newTiles[y * width + x] = "deep_rough";
        }

        // Smooth sand: if 2+ neighbors are sand, make this sand (if it's rough)
        if (current === "rough" && (neighborCounts.get("sand") || 0) >= 2) {
          newTiles[y * width + x] = "sand";
        }
      }
    }
    // Apply changes
    for (let i = 0; i < tiles.length; i++) {
      tiles[i] = newTiles[i];
    }
  }

  // Step 5: Ensure connectivity - check if water splits the map
  // Path from the first to the last non-water tile (row-major scan). For
  // parkland this is exactly the old top-left → bottom-right check, since
  // its borders are never water; coastal themes may start further in.
  let startIdx = 0;
  while (startIdx < tiles.length && isWaterHazard(tiles[startIdx])) startIdx++;
  let endIdx = tiles.length - 1;
  while (endIdx > 0 && isWaterHazard(tiles[endIdx])) endIdx--;
  const startPt = { x: startIdx % width, y: Math.floor(startIdx / width) };
  const endPt = { x: endIdx % width, y: Math.floor(endIdx / width) };

  const visited = new Set<string>();
  const queue: Point[] = [startPt];
  visited.add(`${startPt.x},${startPt.y}`);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.x === endPt.x && current.y === endPt.y) {
      // Reached the far corner of land, map is connected
      break;
    }

    for (const neighbor of getNeighbors(current.x, current.y)) {
      const key = `${neighbor.x},${neighbor.y}`;
      if (!visited.has(key)) {
        const tile = getTile(neighbor.x, neighbor.y);
        if (tile && !isWaterHazard(tile)) {
          visited.add(key);
          queue.push(neighbor);
        }
      }
    }
  }

  // If map is split, remove some water tiles to restore connectivity
  if (!visited.has(`${endPt.x},${endPt.y}`)) {
    // Find water tiles that block connectivity and convert some to rough
    const waterTiles: Point[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (isWaterHazard(getTile(x, y))) {
          waterTiles.push({ x, y });
        }
      }
    }

    // Remove up to 20% of water tiles, prioritizing those away from water clusters
    const toRemove = Math.floor(waterTiles.length * 0.2);
    shuffleInPlace(waterTiles, rng);
    for (let i = 0; i < Math.min(toRemove, waterTiles.length); i++) {
      const p = waterTiles[i];
      // Check if this water tile has few water neighbors (isolated)
      const waterNeighbors = getNeighbors(p.x, p.y).filter((n) => isWaterHazard(getTile(n.x, n.y))).length;
      if (waterNeighbors <= 2) {
        setTile(p.x, p.y, "rough");
      }
    }
  }

  return tiles;
}

/**
 * Generate obstacles for a wild piece of land
 */
export function generateObstacles(
  width: number,
  height: number,
  tiles: Terrain[],
  seed: number,
  reservedZones: Point[] = [], // Reserved zones (e.g., tee/green positions) where obstacles should not be placed
  theme?: LandTheme
): Obstacle[] {
  const obstacleCfg = getBiomeDefinition(theme).generation.obstacles;
  const rng = new SeededRNG(seed + 1000000); // Offset seed to ensure different sequence from terrain
  const obstacles: Obstacle[] = [];
  const obstacleSet = new Set<string>(); // Track placed obstacles to avoid duplicates

  // Helper to get tile at position
  const getTile = (x: number, y: number): Terrain | null => {
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    return tiles[y * width + x];
  };

  // Helper to check if point is valid
  const isValid = (x: number, y: number): boolean => {
    return x >= 0 && y >= 0 && x < width && y < height;
  };

  // Helper to get neighbors
  const getNeighbors = (x: number, y: number): Point[] => {
    return [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ].filter((p) => isValid(p.x, p.y));
  };

  // Helper to check if position is in reserved zone (safety radius of 2 tiles)
  const isReserved = (x: number, y: number): boolean => {
    for (const zone of reservedZones) {
      const dx = x - zone.x;
      const dy = y - zone.y;
      if (dx * dx + dy * dy <= 4) return true; // 2 tile radius
    }
    return false;
  };

  // Helper to check if position can have an obstacle
  const canPlaceObstacle = (x: number, y: number, type: ObstacleType): boolean => {
    if (!isValid(x, y)) return false;
    if (isReserved(x, y)) return false;
    if (obstacleSet.has(`${x},${y}`)) return false;

    const terrain = getTile(x, y);
    if (!terrain) return false;

    // Never place on water, sand, green, tee
    if (terrain === "water" || terrain === "wetland" || terrain === "sand" || terrain === "green" || terrain === "tee") {
      return false;
    }

    // Trees and bushes prefer deep_rough, can be on rough
    if (type === "tree" || type === "bush") {
      return terrain === "deep_rough" || terrain === "rough";
    }

    // Rocks prefer near sand edges or near borders
    if (type === "rock") {
      if (terrain !== "rough" && terrain !== "deep_rough") return false;
      // Check if near sand (within 2 tiles)
      const nearSand = getNeighbors(x, y).some((n) => {
        const t = getTile(n.x, n.y);
        return t === "sand";
      }) || getNeighbors(x, y).some((n) => {
        // Check neighbors of neighbors
        return getNeighbors(n.x, n.y).some((nn) => getTile(nn.x, nn.y) === "sand");
      });
      // Check if near border (within 2 tiles)
      const nearBorder = x <= 2 || y <= 2 || x >= width - 3 || y >= height - 3;
      return nearSand || nearBorder;
    }

    return false;
  };

  // Calculate target obstacle counts
  const nonWaterTiles = tiles.filter((t) => t !== "water").length;
  const targetObstacles = Math.floor(nonWaterTiles * obstacleCfg.density);
  const targetTrees = Math.floor(targetObstacles * obstacleCfg.treeRatio);
  const targetBushes = Math.floor(targetObstacles * obstacleCfg.bushRatio);
  const targetRocks = Math.floor(targetObstacles * obstacleCfg.rockRatio);
  const shorelineTreeReserve = Math.min(targetTrees, Math.ceil(targetTrees * (obstacleCfg.shoreTreeChance > 0.15 ? 0.4 : 0.12)));
  const shorelineBushReserve = Math.min(targetBushes, Math.ceil(targetBushes * (obstacleCfg.shoreBushChance > 0.25 ? 0.3 : 0.16)));
  const coreTargetTrees = targetTrees - shorelineTreeReserve;
  const coreTargetBushes = targetBushes - shorelineBushReserve;

  // Step 1: Generate tree/bush clusters in deep rough
  const treeBushClusters = rng.nextInt(obstacleCfg.clustersMin, obstacleCfg.clustersMax);
  let treesPlaced = 0;
  let bushesPlaced = 0;

  for (let i = 0; i < treeBushClusters && (treesPlaced < coreTargetTrees || bushesPlaced < coreTargetBushes); i++) {
    const lineAxis = rng.next() < 0.5 ? "x" : "y";
    // Find a seed point in deep_rough
    let seedX = rng.nextInt(1, width - 2);
    let seedY = rng.nextInt(1, height - 2);
    let attempts = 0;

    while (attempts < 50) {
      const testX = rng.nextInt(1, width - 2);
      const testY = rng.nextInt(1, height - 2);
      if (getTile(testX, testY) === "deep_rough" && !isReserved(testX, testY)) {
        seedX = testX;
        seedY = testY;
        break;
      }
      attempts++;
    }

    // Determine cluster type (tree or bush)
    const clusterType: ObstacleType = treesPlaced < coreTargetTrees && rng.next() < 0.6 ? "tree" : "bush";
    const clusterSize = rng.nextInt(5, 25);
    const targetCount = clusterType === "tree" ? coreTargetTrees : coreTargetBushes;
    const currentCount = clusterType === "tree" ? treesPlaced : bushesPlaced;

    if (currentCount >= targetCount) continue;

    // Grow cluster using random walk
    const visited = new Set<string>();
    const queue: Point[] = [{ x: seedX, y: seedY }];
    visited.add(`${seedX},${seedY}`);

    let placed = 0;
    while (queue.length > 0 && placed < clusterSize && currentCount + placed < targetCount) {
      const current = queue.shift()!;
      if (canPlaceObstacle(current.x, current.y, clusterType)) {
        obstacles.push({ x: current.x, y: current.y, type: clusterType });
        obstacleSet.add(`${current.x},${current.y}`);
        placed++;
        if (clusterType === "tree") treesPlaced++;
        else bushesPlaced++;
      }

      // Add neighbors with probability
      for (const neighbor of getNeighbors(current.x, current.y)) {
        const key = `${neighbor.x},${neighbor.y}`;
        if (!visited.has(key)) {
          const terrain = getTile(neighbor.x, neighbor.y);
          if (terrain === "deep_rough" || terrain === "rough") {
            const alongLine = lineAxis === "x" ? neighbor.y === current.y : neighbor.x === current.x;
            const probability = 0.42 + (alongLine ? obstacleCfg.lineBias : 0);
            if (rng.next() < probability) {
              visited.add(key);
              queue.push(neighbor);
            }
          }
        }
      }
    }
  }

  // Step 2: Place additional bushes in rough areas (sparse)
  while (bushesPlaced < coreTargetBushes) {
    const x = rng.nextInt(1, width - 2);
    const y = rng.nextInt(1, height - 2);
    if (canPlaceObstacle(x, y, "bush")) {
      obstacles.push({ x, y, type: "bush" });
      obstacleSet.add(`${x},${y}`);
      bushesPlaced++;
    }
    // Prevent infinite loop
    if (bushesPlaced >= coreTargetBushes || obstacles.length > targetObstacles * 1.2) break;
  }

  // Step 3: Place rocks near sand edges or borders
  let rocksPlaced = 0;
  const rockAttempts = Math.max(8, Math.min(20, Math.floor((width * height) / 50))); // Scale by map size

  while (rocksPlaced < targetRocks && rocksPlaced < rockAttempts) {
    const x = rng.nextInt(0, width - 1);
    const y = rng.nextInt(0, height - 1);
    if (canPlaceObstacle(x, y, "rock")) {
      obstacles.push({ x, y, type: "rock" });
      obstacleSet.add(`${x},${y}`);
      rocksPlaced++;
    }
    // Prevent infinite loop
    if (rocksPlaced >= targetRocks || obstacles.length > targetObstacles * 1.2) break;
  }

  // Ecological shoreline pass: pond-edge reeds in parkland, sparse marram
  // on links, and oasis palms/scrub in desert. It only fills remaining
  // semantic quotas, so obstacle density and gameplay state stay bounded.
  const shoreline: Point[] = [];
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const terrain = getTile(x, y);
    if (terrain !== "rough" && terrain !== "deep_rough") continue;
    if (getNeighbors(x, y).some((point) => isWaterHazard(getTile(point.x, point.y)))) shoreline.push({ x, y });
  }
  shuffleInPlace(shoreline, rng);
  for (const point of shoreline) {
    if (treesPlaced < targetTrees && rng.next() < obstacleCfg.shoreTreeChance && canPlaceObstacle(point.x, point.y, "tree")) {
      obstacles.push({ ...point, type: "tree" });
      obstacleSet.add(`${point.x},${point.y}`);
      treesPlaced++;
      continue;
    }
    if (bushesPlaced < targetBushes && rng.next() < obstacleCfg.shoreBushChance && canPlaceObstacle(point.x, point.y, "bush")) {
      obstacles.push({ ...point, type: "bush" });
      obstacleSet.add(`${point.x},${point.y}`);
      bushesPlaced++;
    }
  }

  // Step 4: Smoothing pass - remove isolated single obstacles (optional, light pass)
  const obstaclesToKeep: Obstacle[] = [];
  for (const obs of obstacles) {
    const neighbors = getNeighbors(obs.x, obs.y);
    const adjacentObstacles = neighbors.filter((n) => obstacleSet.has(`${n.x},${n.y}`)).length;
    // Keep if has at least one neighbor OR is a rock (rocks can be isolated)
    if (adjacentObstacles > 0 || obs.type === "rock" || rng.next() < 0.3) {
      obstaclesToKeep.push(obs);
    }
  }

  return obstaclesToKeep;
}

/**
 * Generate both terrain and obstacles for a wild piece of land
 */
/**
 * Gentle rolling elevation via two octaves of value noise (ZKU-143).
 * Deterministic from seed; integer steps 0..4 so new land reads as terrain
 * rather than a billiard table. Water tiles are forced to base level so
 * lakes sit in depressions once elevation renders (ZKU-144).
 */
export function generateElevations(
  width: number,
  height: number,
  seed: number,
  tiles: Terrain[],
  theme?: LandTheme
): number[] {
  const { amplitude, offset, maxStep } = getBiomeDefinition(theme).generation.elevation;
  const rng = new SeededRNG((seed ^ 0x5eed) >>> 0);

  // Coarse random lattices for two octaves.
  const makeLattice = (cell: number) => {
    const gw = Math.ceil(width / cell) + 2;
    const gh = Math.ceil(height / cell) + 2;
    const values = Array.from({ length: gw * gh }, () => rng.next());
    return { cell, gw, values };
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sample = (l: { cell: number; gw: number; values: number[] }, x: number, y: number) => {
    const fx = x / l.cell;
    const fy = y / l.cell;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const v = (gx: number, gy: number) => l.values[gy * l.gw + gx];
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx;
    const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };

  const octave1 = makeLattice(14); // broad hills
  const octave2 = makeLattice(6); // local undulation

  const elevations = new Array<number>(width * height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (tiles[idx] === "water") continue; // water stays at base level
      const n = sample(octave1, x, y) * 0.72 + sample(octave2, x, y) * 0.28;
      elevations[idx] = Math.max(0, Math.min(maxStep, Math.round(n * amplitude + offset)));
    }
  }
  return elevations;
}

export function generateWildLandWithObstacles(
  width: number,
  height: number,
  seed: number,
  reservedZones: Point[] = [],
  theme?: LandTheme
): { tiles: Terrain[]; obstacles: Obstacle[]; elevations: number[] } {
  const tiles = generateWildLand(width, height, seed, theme);
  const obstacles = generateObstacles(width, height, tiles, seed, reservedZones, theme);
  const elevations = generateElevations(width, height, seed, tiles, theme);
  return { tiles, obstacles, elevations };
}

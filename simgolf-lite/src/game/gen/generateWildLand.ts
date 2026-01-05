import type { Terrain, Obstacle, ObstacleType } from "../models/types";
import { generateGolfCourseHeightMap } from "./generateHeightMap";

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

// Configuration constants
const CONFIG = {
  rough: { min: 0.70, max: 0.80 },
  deepRough: { min: 0.12, max: 0.20 },
  sand: { min: 0.02, max: 0.06 },
  water: { min: 0.03, max: 0.08 },
} as const;

// Obstacle generation constants
const OBSTACLE_CONFIG = {
  density: 0.03, // 3% of tiles
  treeRatio: 0.55, // 55% of obstacles
  bushRatio: 0.35, // 35% of obstacles
  rockRatio: 0.10, // 10% of obstacles
  minFreeTiles: 0.85, // At least 85% of non-water tiles remain obstacle-free
} as const;

interface Point {
  x: number;
  y: number;
}

/**
 * Generate a wild piece of land with natural terrain distribution
 */
export function generateWildLand(width: number, height: number, seed: number): Terrain[] {
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

  // Step 1: Generate deep rough clusters (4-10 clusters)
  const deepRoughClusters = rng.nextInt(4, 10);
  for (let i = 0; i < deepRoughClusters; i++) {
    // Pick a random seed point
    const seedX = rng.nextInt(2, width - 3);
    const seedY = rng.nextInt(2, height - 3);
    const clusterSize = rng.nextInt(8, 20);

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

  // Step 2: Generate water bodies (1-2 bodies, connected, away from borders)
  const waterBodies = rng.nextInt(1, 2);
  const waterBorderMargin = 1; // Keep water 1 tile away from border

  for (let i = 0; i < waterBodies; i++) {
    // Pick a seed point away from borders
    const seedX = rng.nextInt(waterBorderMargin + 1, width - waterBorderMargin - 2);
    const seedY = rng.nextInt(waterBorderMargin + 1, height - waterBorderMargin - 2);
    const targetSize = Math.floor(totalTiles * rng.nextFloat(CONFIG.water.min, CONFIG.water.max) / waterBodies);

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
      neighbors.sort(() => rng.next() - 0.5);

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

  // Step 3: Generate sand pockets (3-8 small clusters, near water or in rough)
  const sandPockets = rng.nextInt(3, 8);
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

    const pocketSize = rng.nextInt(2, 6);
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
  // Simple check: ensure there's a path from top-left to bottom-right through non-water tiles
  const visited = new Set<string>();
  const queue: Point[] = [{ x: 0, y: 0 }];
  visited.add("0,0");

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.x === width - 1 && current.y === height - 1) {
      // Reached bottom-right, map is connected
      break;
    }

    for (const neighbor of getNeighbors(current.x, current.y)) {
      const key = `${neighbor.x},${neighbor.y}`;
      if (!visited.has(key)) {
        const tile = getTile(neighbor.x, neighbor.y);
        if (tile && tile !== "water") {
          visited.add(key);
          queue.push(neighbor);
        }
      }
    }
  }

  // If map is split, remove some water tiles to restore connectivity
  if (!visited.has(`${width - 1},${height - 1}`)) {
    // Find water tiles that block connectivity and convert some to rough
    const waterTiles: Point[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (getTile(x, y) === "water") {
          waterTiles.push({ x, y });
        }
      }
    }

    // Remove up to 20% of water tiles, prioritizing those away from water clusters
    const toRemove = Math.floor(waterTiles.length * 0.2);
    waterTiles.sort(() => rng.next() - 0.5); // Shuffle
    for (let i = 0; i < Math.min(toRemove, waterTiles.length); i++) {
      const p = waterTiles[i];
      // Check if this water tile has few water neighbors (isolated)
      const waterNeighbors = getNeighbors(p.x, p.y).filter((n) => getTile(n.x, n.y) === "water").length;
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
  reservedZones: Point[] = [] // Reserved zones (e.g., tee/green positions) where obstacles should not be placed
): Obstacle[] {
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
    if (terrain === "water" || terrain === "sand" || terrain === "green" || terrain === "tee") {
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
  const targetObstacles = Math.floor(nonWaterTiles * OBSTACLE_CONFIG.density);
  const targetTrees = Math.floor(targetObstacles * OBSTACLE_CONFIG.treeRatio);
  const targetBushes = Math.floor(targetObstacles * OBSTACLE_CONFIG.bushRatio);
  const targetRocks = Math.floor(targetObstacles * OBSTACLE_CONFIG.rockRatio);

  // Step 1: Generate tree/bush clusters in deep rough
  const treeBushClusters = rng.nextInt(6, 14);
  let treesPlaced = 0;
  let bushesPlaced = 0;

  for (let i = 0; i < treeBushClusters && (treesPlaced < targetTrees || bushesPlaced < targetBushes); i++) {
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
    const clusterType: ObstacleType = treesPlaced < targetTrees && rng.next() < 0.6 ? "tree" : "bush";
    const clusterSize = rng.nextInt(5, 25);
    const targetCount = clusterType === "tree" ? targetTrees : targetBushes;
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
            if (rng.next() < 0.5) {
              visited.add(key);
              queue.push(neighbor);
            }
          }
        }
      }
    }
  }

  // Step 2: Place additional bushes in rough areas (sparse)
  while (bushesPlaced < targetBushes) {
    const x = rng.nextInt(1, width - 2);
    const y = rng.nextInt(1, height - 2);
    if (canPlaceObstacle(x, y, "bush")) {
      obstacles.push({ x, y, type: "bush" });
      obstacleSet.add(`${x},${y}`);
      bushesPlaced++;
    }
    // Prevent infinite loop
    if (bushesPlaced >= targetBushes || obstacles.length > targetObstacles * 1.2) break;
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
export function generateWildLandWithObstacles(
  width: number,
  height: number,
  seed: number,
  reservedZones: Point[] = []
): { tiles: Terrain[]; obstacles: Obstacle[]; heightMap: number[] } {
  const tiles = generateWildLand(width, height, seed);
  const obstacles = generateObstacles(width, height, tiles, seed, reservedZones);
  const heightMap = generateGolfCourseHeightMap(width, height, seed + 999999);
  return { tiles, obstacles, heightMap };
}


import type { Terrain } from "../game/models/types";
import type { ColorVisionMode } from "../game/onboarding/profile";

export const TERRAIN_PALETTES: Record<ColorVisionMode, Record<Terrain, number>> = {
  standard: { fairway: 0x4fa64f, rough: 0x2f7a36, deep_rough: 0x1f5f2c, sand: 0xd7c48a, waste_area: 0x9f8153, water: 0x2b7bbb, wetland: 0x477b68, green: 0x5dbb6a, tee: 0x8b6b4f, path: 0x8f8f8f },
  deuteranopia: { fairway: 0x56b4e9, rough: 0x0072b2, deep_rough: 0x332288, sand: 0xe6ab02, waste_area: 0xa6761d, water: 0x66c2a5, wetland: 0x117733, green: 0xf0e442, tee: 0xcc79a7, path: 0x8a8a8a },
  protanopia: { fairway: 0x6baed6, rough: 0x2171b5, deep_rough: 0x253494, sand: 0xfdbf6f, waste_area: 0xb07835, water: 0x41b6c4, wetland: 0x1b9e77, green: 0xffe34d, tee: 0xb159a2, path: 0x8f8f8f },
  tritanopia: { fairway: 0x009e73, rough: 0x00664b, deep_rough: 0x003b46, sand: 0xd55e00, waste_area: 0x9f5a22, water: 0x7b61a8, wetland: 0x4d6f95, green: 0xf0e442, tee: 0xcc79a7, path: 0x8f8f8f },
};

export function terrainColor(mode: ColorVisionMode, terrain: Terrain): number {
  return TERRAIN_PALETTES[mode][terrain];
}

export function terrainColorCss(mode: ColorVisionMode, terrain: Terrain): string {
  return `#${terrainColor(mode, terrain).toString(16).padStart(6, "0")}`;
}

export function terrainPattern(terrain: Terrain): "none" | "stripe" | "crosshatch" | "dots" {
  if (terrain === "fairway") return "stripe";
  if (terrain === "rough") return "crosshatch";
  if (terrain === "deep_rough") return "dots";
  if (terrain === "waste_area") return "stripe";
  if (terrain === "wetland") return "crosshatch";
  return "none";
}

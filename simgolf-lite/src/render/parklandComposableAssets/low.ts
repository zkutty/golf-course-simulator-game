import type { ParklandComposableSemantic } from "../../game/render/parklandComposable";

const semantics: Readonly<Record<ParklandComposableSemantic, string>> = {
  fairway: new URL("../../assets/terrain/parkland-composable-v1/low/semantic-fairway.png", import.meta.url).href,
  rough: new URL("../../assets/terrain/parkland-composable-v1/low/semantic-rough.png", import.meta.url).href,
  deep_rough: new URL("../../assets/terrain/parkland-composable-v1/low/semantic-deep_rough.png", import.meta.url).href,
  green: new URL("../../assets/terrain/parkland-composable-v1/low/semantic-green.png", import.meta.url).href,
  tee: new URL("../../assets/terrain/parkland-composable-v1/low/semantic-tee.png", import.meta.url).href,
};

export default {
  undercoat: new URL("../../assets/terrain/parkland-composable-v1/low/undercoat.png", import.meta.url).href,
  semantics,
  pairAtlas: new URL("../../assets/terrain/parkland-pair-atlas-v2/low-pair-atlas.png", import.meta.url).href,
  pairFrame: [64, 32] as const,
} as const;

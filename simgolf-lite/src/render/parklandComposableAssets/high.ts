import type { ParklandComposableSemantic } from "../../game/render/parklandComposable";

const semantics: Readonly<Record<ParklandComposableSemantic, string>> = {
  fairway: new URL("../../assets/terrain/parkland-composable-v1/high/semantic-fairway.png", import.meta.url).href,
  rough: new URL("../../assets/terrain/parkland-composable-v1/high/semantic-rough.png", import.meta.url).href,
  deep_rough: new URL("../../assets/terrain/parkland-composable-v1/high/semantic-deep_rough.png", import.meta.url).href,
  green: new URL("../../assets/terrain/parkland-composable-v1/high/semantic-green.png", import.meta.url).href,
  tee: new URL("../../assets/terrain/parkland-composable-v1/high/semantic-tee.png", import.meta.url).href,
};

export default {
  undercoat: new URL("../../assets/terrain/parkland-composable-v1/high/undercoat.png", import.meta.url).href,
  semantics,
} as const;

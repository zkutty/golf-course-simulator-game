import type { ParklandComposableSemantic } from "../../game/render/parklandComposable";

const semantics: Readonly<Record<ParklandComposableSemantic, string>> = {
  fairway: new URL("../../assets/terrain/parkland-composable-v1/medium/semantic-fairway.png", import.meta.url).href,
  rough: new URL("../../assets/terrain/parkland-composable-v1/medium/semantic-rough.png", import.meta.url).href,
  deep_rough: new URL("../../assets/terrain/parkland-composable-v1/medium/semantic-deep_rough.png", import.meta.url).href,
  green: new URL("../../assets/terrain/parkland-composable-v1/medium/semantic-green.png", import.meta.url).href,
  tee: new URL("../../assets/terrain/parkland-composable-v1/medium/semantic-tee.png", import.meta.url).href,
};

export default {
  undercoat: new URL("../../assets/terrain/parkland-composable-v1/medium/undercoat.png", import.meta.url).href,
  semantics,
} as const;

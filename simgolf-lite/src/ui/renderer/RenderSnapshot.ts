/**
 * Compatibility path for existing UI consumers. The game-layer module is the
 * single RenderSnapshot/revision authority for every hosted scene system.
 */
export {
  RenderRevisionTracker,
  type RenderRevisionDependencies,
  type RenderRevisions,
  type RenderSceneId,
  type RenderSnapshot,
} from "../../game/render/renderSnapshot";

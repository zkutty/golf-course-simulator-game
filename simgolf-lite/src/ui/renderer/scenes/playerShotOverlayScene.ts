import * as PIXI from "pixi.js";
import { TILE_H, TILE_W, worldToIso } from "../../../game/render/iso";
import type { RenderSceneSystem } from "../SceneSystemHost";

/** Retained player-shot decision overlay, independent of static world layers. */
export function createPlayerShotOverlaySceneSystem(layer: PIXI.Container): RenderSceneSystem {
  let overlay: PIXI.Container | null = null;
  const clear = () => {
    overlay?.parent?.removeChild(overlay);
    overlay?.destroy({ children: true });
    overlay = null;
  };

  return {
    id: "overlaysDiagnostics",
    render(snapshot) {
      clear();
      const round = snapshot.playerRound;
      if (!round) return;

      const next = new PIXI.Container();
      next.label = "player-pro-shot-overlay";
      const graphics = new PIXI.Graphics();
      const ballElevation = snapshot.surfaceHeightAt(round.ball.x + 0.5, round.ball.y + 0.5);
      const ball = worldToIso(round.ball.x + 0.5, round.ball.y + 0.5, ballElevation, snapshot.rotation);
      graphics.circle(ball.x, ball.y - 7, 7);
      graphics.fill({ color: 0xffd25b, alpha: 0.95 });
      graphics.stroke({ width: 2.5, color: 0x253c2b, alpha: 1 });
      graphics.circle(ball.x, ball.y - 7, 11);
      graphics.stroke({ width: 2, color: 0xfff0a0, alpha: 0.75 });

      if (snapshot.playerShotAim && round.phase === "awaiting_shot") {
        const aimElevation = snapshot.surfaceHeightAt(snapshot.playerShotAim.x + 0.5, snapshot.playerShotAim.y + 0.5);
        const aim = worldToIso(snapshot.playerShotAim.x + 0.5, snapshot.playerShotAim.y + 0.5, aimElevation, snapshot.rotation);
        graphics.moveTo(ball.x, ball.y - 7);
        graphics.lineTo(aim.x, aim.y - 5);
        graphics.stroke({ width: 2.2, color: 0xffe27a, alpha: 0.9 });
        graphics.ellipse(aim.x, aim.y - 5, TILE_W * 1.4, TILE_H * 1.1);
        graphics.fill({ color: 0xffd25b, alpha: 0.13 });
        graphics.stroke({ width: 2, color: 0x6f4e16, alpha: 0.9 });
        graphics.circle(aim.x, aim.y - 5, 3.5);
        graphics.fill({ color: 0xffffff, alpha: 0.95 });
      }

      const trace = round.pendingShot ?? round.shots[round.shots.length - 1];
      if (trace) {
        const from = worldToIso(trace.from.x + 0.5, trace.from.y + 0.5, snapshot.surfaceHeightAt(trace.from.x + 0.5, trace.from.y + 0.5), snapshot.rotation);
        const rest = worldToIso(trace.rest.x + 0.5, trace.rest.y + 0.5, snapshot.surfaceHeightAt(trace.rest.x + 0.5, trace.rest.y + 0.5), snapshot.rotation);
        graphics.moveTo(from.x, from.y - 5);
        if (trace.greenRollout?.path.length) {
          const landing = worldToIso(
            trace.greenRollout.landing.x + 0.5,
            trace.greenRollout.landing.y + 0.5,
            snapshot.surfaceHeightAt(
              trace.greenRollout.landing.x + 0.5,
              trace.greenRollout.landing.y + 0.5,
            ),
            snapshot.rotation,
          );
          graphics.lineTo(landing.x, landing.y - 5);
          for (const point of trace.greenRollout.path.slice(1)) {
            const projected = worldToIso(
              point.x + 0.5,
              point.y + 0.5,
              snapshot.surfaceHeightAt(point.x + 0.5, point.y + 0.5),
              snapshot.rotation,
            );
            graphics.lineTo(projected.x, projected.y - 5);
          }
        } else {
          graphics.lineTo(rest.x, rest.y - 5);
        }
        graphics.stroke({ width: 2.5, color: trace.penaltyStrokes > 0 ? 0xc84a37 : 0xf7f0c2, alpha: 0.78 });
        graphics.circle(rest.x, rest.y - 5, 5);
        graphics.fill({ color: trace.penaltyStrokes > 0 ? 0xd34b39 : 0xffffff, alpha: 0.95 });
      }
      next.addChild(graphics);
      layer.addChild(next);
      overlay = next;
    },
    dispose: clear,
  };
}

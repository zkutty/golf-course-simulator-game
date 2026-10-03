import { lazy, Suspense, useEffect, useState } from "react";
import type { Application, Texture } from "pixi.js";
import type { NativeRendererConfiguration, PixiStageProps } from "../PixiStage";
import { NativeRendererSession } from "./nativeRendererSession";
import { DeferredSurfaceErrorBoundary } from "../../app/DeferredSurface";
import { useI18n } from "../../i18n/useI18n";
import { captureBugError } from "../../bug-reporting/diagnostics";

// React requests the module only when the course pane actually mounts.
const Scene = lazy(() => import("../PixiStage").then((module) => ({ default: module.PixiStage })));

function createSession() {
  return new NativeRendererSession<Application, Texture, NativeRendererConfiguration>();
}

export function PixiStage(props: PixiStageProps) {
  const { t } = useI18n();
  const [session] = useState(() => props.nativeSession ?? createSession());
  useEffect(() => () => {
    if (!props.nativeSession) void session.close().catch((error: unknown) => captureBugError("react-crash", error));
  }, [props.nativeSession, session]);
  return (
    <div className={`cc-pixi-stage cc-tool-${props.playableShotMode ? "player-shot" : props.editorMode.toLowerCase()}`}
      style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
      <DeferredSurfaceErrorBoundary label={t("renderer.error.title")}>
        <Suspense fallback={<div role="status" aria-live="polite" style={{ width: "100%", height: "100%" }}>{t("loading.restoreCourse")}</div>}>
          <Scene {...props} nativeSession={session} />
        </Suspense>
      </DeferredSurfaceErrorBoundary>
    </div>
  );
}

PixiStage.createSession = createSession;

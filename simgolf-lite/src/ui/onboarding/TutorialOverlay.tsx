import { useEffect, useMemo, useState } from "react";
import type { TutorialStep } from "../../game/onboarding/tutorial";
import { AdvisorPresenter } from "./AdvisorPresenter";
import { presenterButtonStyle } from "./presenterStyles";
import { T } from "../../i18n/T";
import { translateCurrent } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";

type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

export function TutorialOverlay(props: {
  step: TutorialStep;
  canAdvance: boolean;
  onAdvance: () => void;
  onSkip: () => void;
  saveStatus?: "saving" | "saved";
}) {
  const { t } = useI18n();
  const [rects, setRects] = useState<Rect[]>([]);

  useEffect(() => {
    const update = () => {
      const targets = props.step.allowedTargets ?? [props.step.target];
      const elements = targets.flatMap((target) => Array.from(document.querySelectorAll(`[data-tutorial-target="${target}"]`)));
      setRects(elements.map((element) => {
        const next = element.getBoundingClientRect();
        return { top: next.top, left: next.left, right: next.right, bottom: next.bottom, width: next.width, height: next.height };
      }).filter((rect) => rect.width > 0 && rect.height > 0));
    };
    const id = window.setTimeout(update, 20);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer.disconnect();
    };
  }, [props.step]);

  const cardPosition = useMemo(() => {
    const rect = rects[0];
    if (!rect) return { left: 20, bottom: 20 };
    if (rect.left > window.innerWidth * 0.48) return { left: 20, bottom: 20 };
    return { right: 20, bottom: 20 };
  }, [rects]);

  const paddedRects = rects.map((rect) => ({
    top: Math.max(0, rect.top - 7),
    left: Math.max(0, rect.left - 7),
    right: Math.min(window.innerWidth, rect.right + 7),
    bottom: Math.min(window.innerHeight, rect.bottom + 7),
  }));
  const blockers = useMemo(() => {
    if (paddedRects.length === 0) return [{ inset: 0 }];
    const xs = [...new Set([0, window.innerWidth, ...paddedRects.flatMap((rect) => [rect.left, rect.right])])].sort((a, b) => a - b);
    const ys = [...new Set([0, window.innerHeight, ...paddedRects.flatMap((rect) => [rect.top, rect.bottom])])].sort((a, b) => a - b);
    const cells: Array<{ top: number; left: number; width: number; height: number }> = [];
    for (let yi = 0; yi < ys.length - 1; yi++) {
      for (let xi = 0; xi < xs.length - 1; xi++) {
        const left = xs[xi];
        const right = xs[xi + 1];
        const top = ys[yi];
        const bottom = ys[yi + 1];
        const middleX = (left + right) / 2;
        const middleY = (top + bottom) / 2;
        if (paddedRects.some((rect) => middleX >= rect.left && middleX <= rect.right && middleY >= rect.top && middleY <= rect.bottom)) continue;
        cells.push({ top, left, width: right - left, height: bottom - top });
      }
    }
    return cells;
  }, [paddedRects]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 99990, pointerEvents: "none" }} aria-label={translateCurrent("auto.ui.onboarding.tutorialoverlay.interactive.tutorial")} data-rich-tooltip data-testid="tutorial-overlay" data-step-id={props.step.id}>
      {blockers.map((style, index) => (
        <div key={index} style={{ position: "fixed", background: "rgba(18, 25, 18, .62)", pointerEvents: "auto", ...style }} />
      ))}
      {paddedRects.map((rect, index) => (
        <div
          key={index}
          aria-hidden
          style={{
            position: "fixed",
            top: rect.top,
            left: rect.left,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            border: "3px solid #f7cf62",
            borderRadius: 12,
            boxShadow: "0 0 0 4px rgba(247, 207, 98, .25), 0 0 26px rgba(247, 207, 98, .7)",
            pointerEvents: "none",
          }}
        />
      ))}
      <div style={{ position: "fixed", pointerEvents: "auto", ...cardPosition }}>
        <AdvisorPresenter
          eyebrow={t(props.step.eyebrowKey)}
          title={t(props.step.titleKey)}
          body={t(props.step.bodyKey)}
          expression={props.step.expression}
          actions={
            <>
              <span role="status" style={{ alignSelf: "center", marginRight: "auto", fontSize: 11, color: "#647067" }}>
                {props.saveStatus === "saved" ? "Progress saved" : "Saving progress…"}
              </span>
              <button
                onClick={() => {
                  if (window.confirm(t("tutorial.skipConfirm"))) props.onSkip();
                }}
                style={{ ...presenterButtonStyle, background: "transparent", color: "#465349", borderColor: "rgba(39,54,43,.35)" }}
              >
                <T id="auto.ui.onboarding.tutorialoverlay.skip.tutorial" /></button>
              <button onClick={props.onAdvance} disabled={!props.canAdvance} style={{ ...presenterButtonStyle, opacity: props.canAdvance ? 1 : .45 }}>
                {props.canAdvance ? t(props.step.actionLabelKey ?? "tutorial.continue") : t("tutorial.completeTask")}
              </button>
            </>
          }
        />
      </div>
    </div>
  );
}

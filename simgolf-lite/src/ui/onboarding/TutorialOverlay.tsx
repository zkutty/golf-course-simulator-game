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
}) {
  const { t } = useI18n();
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    const update = () => {
      const element = document.querySelector(`[data-tutorial-target="${props.step.target}"]`);
      const next = element?.getBoundingClientRect();
      setRect(next ? { top: next.top, left: next.left, right: next.right, bottom: next.bottom, width: next.width, height: next.height } : null);
    };
    const id = window.setTimeout(update, 20);
    window.addEventListener("resize", update);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", update);
    };
  }, [props.step.target]);

  const cardPosition = useMemo(() => {
    if (!rect) return { left: 20, bottom: 20 };
    if (rect.left > window.innerWidth * 0.48) return { left: 20, bottom: 20 };
    return { right: 20, bottom: 20 };
  }, [rect]);

  const blockers = rect
    ? [
        { top: 0, left: 0, right: 0, height: Math.max(0, rect.top - 7) },
        { top: Math.max(0, rect.top - 7), left: 0, width: Math.max(0, rect.left - 7), height: rect.height + 14 },
        { top: Math.max(0, rect.top - 7), left: rect.right + 7, right: 0, height: rect.height + 14 },
        { top: rect.bottom + 7, left: 0, right: 0, bottom: 0 },
      ]
    : [{ inset: 0 }];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 99990, pointerEvents: "none" }} aria-label={translateCurrent("auto.ui.onboarding.tutorialoverlay.interactive.tutorial")}>
      {blockers.map((style, index) => (
        <div key={index} style={{ position: "fixed", background: "rgba(18, 25, 18, .62)", pointerEvents: "auto", ...style }} />
      ))}
      {rect && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: rect.top - 7,
            left: rect.left - 7,
            width: rect.width + 14,
            height: rect.height + 14,
            border: "3px solid #f7cf62",
            borderRadius: 12,
            boxShadow: "0 0 0 4px rgba(247, 207, 98, .25), 0 0 26px rgba(247, 207, 98, .7)",
            pointerEvents: "none",
          }}
        />
      )}
      <div style={{ position: "fixed", pointerEvents: "auto", ...cardPosition }}>
        <AdvisorPresenter
          eyebrow={t(props.step.eyebrowKey)}
          title={t(props.step.titleKey)}
          body={t(props.step.bodyKey)}
          expression={props.step.expression}
          actions={
            <>
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

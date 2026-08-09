import { useEffect, useMemo, useRef, useState } from "react";
import type { TutorialProgress, TutorialStep } from "../../game/onboarding/tutorial";
import { AdvisorPresenter } from "./AdvisorPresenter";
import { presenterButtonStyle } from "./presenterStyles";
import { T } from "../../i18n/T";
import { useI18n } from "../../i18n/useI18n";

type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };
const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

function focusableItems(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.getClientRects().length > 0);
}

export function TutorialOverlay(props: {
  step: TutorialStep;
  progress: TutorialProgress;
  canAdvance: boolean;
  onAdvance: () => void;
  onSkip: () => void;
  onSkipModule: () => void;
  onRestart: () => void;
  saveStatus?: "saving" | "saved";
}) {
  const { t } = useI18n();
  const [rects, setRects] = useState<Rect[]>([]);
  const [launcherRect, setLauncherRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const evidence = props.progress.receipts.preview.evidence;
  const showEvidence = evidence && ["observe-play", "review-reaction", "creative-reward"].includes(props.step.id);

  useEffect(() => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocusRef.current = active && active !== document.body ? active : null;
    return () => {
      const previous = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        const fallback = document.querySelector<HTMLElement>('[data-testid="tutorial-launcher"]');
        const target = previous?.isConnected ? previous : fallback;
        target?.focus({ preventScroll: true });
      });
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const card = cardRef.current;
      if (!card) return;
      const primary = card.querySelector<HTMLButtonElement>('[data-testid="tutorial-primary-action"]');
      const target = primary && !primary.disabled ? primary : focusableItems(card)[0] ?? card;
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.step.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const card = cardRef.current;
      if (!card) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableItems(card);
      if (items.length === 0) {
        event.preventDefault();
        card.focus({ preventScroll: true });
        return;
      }
      const active = document.activeElement;
      const first = items[0];
      const last = items[items.length - 1];
      if (!card.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    const update = () => {
      const targets = props.step.allowedTargets ?? [props.step.target];
      const elements = targets.flatMap((target) => Array.from(document.querySelectorAll(`[data-tutorial-target="${target}"]`)));
      setRects(elements.map((element) => {
        const next = element.getBoundingClientRect();
        return { top: next.top, left: next.left, right: next.right, bottom: next.bottom, width: next.width, height: next.height };
      }).filter((rect) => rect.width > 0 && rect.height > 0));
      const launcher = document.querySelector('[data-testid="bug-report-launcher"]');
      const nextLauncher = launcher?.getBoundingClientRect();
      setLauncherRect(nextLauncher && nextLauncher.width > 0 && nextLauncher.height > 0
        ? { top: nextLauncher.top, left: nextLauncher.left, right: nextLauncher.right, bottom: nextLauncher.bottom, width: nextLauncher.width, height: nextLauncher.height }
        : null);
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
    const bottom = launcherRect ? Math.max(20, window.innerHeight - launcherRect.top + 12) : 20;
    const rect = rects[0];
    if (!rect) return { left: 20, bottom };
    if (rect.left > window.innerWidth * 0.48) return { left: 20, bottom };
    return { right: 20, bottom };
  }, [launcherRect, rects]);

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
    <div style={{ position: "fixed", inset: 0, zIndex: 99990, pointerEvents: "none" }} data-rich-tooltip data-testid="tutorial-overlay" data-step-id={props.step.id}>
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
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={t(props.step.titleKey)}
        tabIndex={-1}
        data-testid="tutorial-card"
        style={{
          position: "fixed",
          pointerEvents: "auto",
          maxHeight: `calc(100vh - ${cardPosition.bottom + 12}px)`,
          maxWidth: "calc(100vw - 40px)",
          overflowY: "auto",
          ...cardPosition,
        }}
      >
        <AdvisorPresenter
          eyebrow={t(props.step.eyebrowKey)}
          title={t(props.step.titleKey)}
          body={t(props.step.bodyKey)}
          expression={props.step.expression}
          details={showEvidence ? (
            <div data-testid="invited-preview-evidence" style={{ display: "grid", gap: 7, maxHeight: 190, overflowY: "auto", fontSize: 11, lineHeight: 1.35 }}>
              <b>{t("tutorial.preview.groupLabel")}</b>
              {evidence.group.map((golfer) => (
                <div key={golfer.id}>
                  <div>{t("tutorial.preview.golferLine", { name: golfer.name, strokes: golfer.strokes, par: golfer.par, satisfaction: Math.round(golfer.satisfaction), reaction: golfer.reaction })}</div>
                  {golfer.shots.slice(0, 2).map((shot) => <div key={shot.shotNumber} style={{ color: "#647067" }}>{t("tutorial.preview.shotLine", { shot: shot.shotNumber, intent: shot.intent, club: shot.club, lie: shot.lieAfter })}</div>)}
                  <div style={{ fontStyle: "italic" }}>“{golfer.thought}”</div>
                </div>
              ))}
              {props.progress.receipts.preview.rewardReceipt && <b data-testid="invited-preview-reward-receipt">{t("tutorial.preview.rewardReceipt")}</b>}
            </div>
          ) : undefined}
          actions={
            <>
              <span role="status" style={{ alignSelf: "center", marginRight: "auto", fontSize: 11, color: "#647067" }}>
                {t(props.saveStatus === "saved" ? "tutorial.preview.progressSaved" : "tutorial.preview.progressSaving")}
              </span>
              <button onClick={props.onRestart} style={{ ...presenterButtonStyle, background: "transparent", color: "#465349", borderColor: "rgba(39,54,43,.35)" }}>
                {t("tutorial.preview.restart")}
              </button>
              {props.progress.profile === "classic" && props.step.id === "public-three" && (
                <button onClick={props.onSkipModule} style={{ ...presenterButtonStyle, background: "transparent", color: "#465349", borderColor: "rgba(39,54,43,.35)" }}>
                  {t("tutorial.preview.skipModule")}
                </button>
              )}
              <button
                onClick={() => {
                  if (window.confirm(t("tutorial.skipConfirm"))) props.onSkip();
                }}
                style={{ ...presenterButtonStyle, background: "transparent", color: "#465349", borderColor: "rgba(39,54,43,.35)" }}
              >
                <T id="auto.ui.onboarding.tutorialoverlay.skip.tutorial" /></button>
              <button data-testid="tutorial-primary-action" onClick={props.onAdvance} disabled={!props.canAdvance} style={{ ...presenterButtonStyle, opacity: props.canAdvance ? 1 : .45 }}>
                {props.canAdvance ? t(props.step.actionLabelKey ?? "tutorial.continue") : t("tutorial.completeTask")}
              </button>
            </>
          }
        />
      </div>
    </div>
  );
}

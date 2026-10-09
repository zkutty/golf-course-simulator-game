import { useEffect, useId, useRef, useState } from "react";
import { formatCurrency, formatNumber, formatWeekLabel } from "../i18n/format";
import type { DefeatReason, ObjectiveState } from "../game/models/objectives";
import { T } from "../i18n/T";
import { useI18n } from "../i18n/useI18n";
import { IconUi } from "../assets/icons/IconUi";
import { useFocusTrap } from "./accessibility/useFocusTrap";
import "./OutcomeDialogs.css";

// All outcome actions remain explicit: Escape and the backdrop never end a run.
export function DefeatModal(props: {
  reason: DefeatReason;
  objectives?: ObjectiveState | null;
  weeksSurvived: number;
  peakCash: number;
  peakRep: number;
  courseRating: number;
  slope: number;
  seed: number;
  onRetrySeed: (seed: number) => void;
  onNewGame: () => void;
  onLoad: () => void;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const [seed, setSeed] = useState(props.seed);
  const overlayRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(true, () => {});
  useEffect(() => {
    const opener = openerRef.current;
    const overlay = overlayRef.current;
    const panel = trapRef.current;
    const main = overlay?.closest<HTMLElement>(".cc-main") ?? overlay?.parentElement;
    const modalSelector = '[role="dialog"][aria-modal="true"]';
    const focusableSelector = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";
    const originals = new Map<HTMLElement, boolean>();
    const footprint = new Set<HTMLElement>();
    const panelWasInert = panel?.inert ?? false;
    let authority: HTMLElement | null = null;
    const restoreFootprint = () => {
      for (const node of footprint) node.inert = originals.get(node)!;
      footprint.clear();
    };
    const isolate = (node: HTMLElement, top: HTMLElement | null) => {
      // SaveLoad mounts directly outside .cc-main and owns its existing trap.
      if (node === top || (!main?.contains(node) && node.matches(modalSelector))) return;
      // Only the visible higher dialog's path stays active. A lower modal
      // remains ordinary background even when it declares aria-modal.
      if (top && node.contains(top)) {
        for (const child of Array.from(node.children)) if (child instanceof HTMLElement) isolate(child, top);
        return;
      }
      if (!originals.has(node)) originals.set(node, node.inert);
      footprint.add(node);
      node.inert = true;
    };
    const focusables = (node: HTMLElement) => Array.from(node.querySelectorAll<HTMLElement>(focusableSelector))
      .filter(item => item.getClientRects().length > 0 && !item.closest("[inert]"));
    const onAuthorityKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Tab" || !authority?.isConnected) return;
      const items = focusables(authority);
      const first = items[0], last = items[items.length - 1];
      if (first && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    // Compare the stacking-context paths, rather than letting a high child
    // z-index escape a lower ancestor's stacking context.
    const stackingOrder = (element: HTMLElement) => {
      const order: number[] = [];
      for (let node: HTMLElement | null = element; node && node !== main; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.position === "fixed" || style.position === "sticky" || style.zIndex !== "auto" || style.transform !== "none" || style.filter !== "none" || style.opacity !== "1" || style.isolation === "isolate") order.unshift(Number.parseInt(style.zIndex) || 0);
      }
      return order;
    };
    const compareStacking = (left: number[], right: number[]) => {
      for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const difference = (left[i] ?? 0) - (right[i] ?? 0);
        if (difference) return difference;
      }
      return 0;
    };
    const reconcile = () => {
      restoreFootprint();
      const ownOrder = overlay ? stackingOrder(overlay) : [];
      const candidates = Array.from(main?.querySelectorAll<HTMLElement>(modalSelector) ?? [])
        .filter(node => node.isConnected && node !== panel && !panel?.contains(node) && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden" && !node.closest("[inert]") && compareStacking(stackingOrder(node), ownOrder) > 0)
        .sort((left, right) => compareStacking(stackingOrder(right), stackingOrder(left)));
      const top = candidates[0] ?? null;
      let branch: HTMLElement | null = overlay;
      while (branch && branch !== document.body) {
        for (const sibling of Array.from(branch.parentElement?.children ?? [])) if (sibling instanceof HTMLElement && sibling !== branch) isolate(sibling, top);
        branch = branch.parentElement;
      }
      if (top === authority) return;
      const previous = authority;
      previous?.removeEventListener("keydown", onAuthorityKeyDown);
      authority = top;
      if (panel) panel.inert = top ? true : panelWasInert;
      if (top) {
        top.addEventListener("keydown", onAuthorityKeyDown);
        if (!top.contains(document.activeElement)) focusables(top)[0]?.focus();
      } else if (previous && panel?.isConnected) retryRef.current?.focus();
    };
    retryRef.current?.focus();
    reconcile();
    const observer = new MutationObserver(reconcile);
    if (main) observer.observe(main, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      authority?.removeEventListener("keydown", onAuthorityKeyDown);
      restoreFootprint();
      if (panel) panel.inert = panelWasInert;
      opener?.focus();
    };
  }, [trapRef]);
  const missed =
    props.reason === "DEADLINE" && props.objectives
      ? props.objectives.goals.filter(
          (g, i) =>
            g.deadlineWeek != null &&
            !props.objectives!.progress[i]?.met
        )
      : [];

  return (
    <div ref={overlayRef} className="cc-outcome-overlay">
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} className="cc-outcome-panel cc-outcome-defeat">
        <div className="cc-outcome-body" data-testid="outcome-body" tabIndex={0}>
          <header className="cc-outcome-header">
            <IconUi name="close" className="cc-outcome-emblem" />
            <h2 id={`${id}-title`}>{t(props.reason === "BANKRUPT" ? "outcome.defeat.bankruptTitle" : "outcome.defeat.deadlineTitle")}</h2>
            <p id={`${id}-help`}>{t(props.reason === "BANKRUPT" ? "outcome.defeat.bankruptHelp" : "outcome.defeat.deadlineHelp")}</p>
          </header>
          {missed.length > 0 && <ul className="cc-outcome-goals cc-outcome-missed">
            {missed.map(g => <li key={g.id}>
              <IconUi name="close" />
              <div><span className="cc-outcome-goal-status">{t("outcome.goalMissed")}</span><strong>{g.labelKey ? t(g.labelKey) : g.label}</strong><span><T id="auto.ui.defeatmodal.needed.by" />{formatWeekLabel(g.deadlineWeek!, locale, "week")}</span></div>
            </li>)}
          </ul>}
          <dl className="cc-outcome-stats">
            <Row label={t("defeat.weeksSurvived")} value={formatNumber(props.weeksSurvived, locale)} />
            <Row label={t("defeat.peakReputation")} value={formatNumber(props.peakRep, locale)} />
            <Row label={t("defeat.peakCash")} value={formatCurrency(props.peakCash, locale)} />
            <Row label={t("defeat.ratingSlope")} value={`${formatNumber(props.courseRating, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / ${formatNumber(Math.round(props.slope), locale)}`} />
          </dl>
          <div className="cc-outcome-actions">
            <label className="cc-outcome-seed"><T id="auto.ui.defeatmodal.seed" /><input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} /></label>
            <button ref={retryRef} className="cc-outcome-primary" onClick={() => props.onRetrySeed(seed | 0)}><T id="auto.ui.defeatmodal.retry.this.run" /></button>
            <button onClick={props.onLoad}><T id="auto.ui.defeatmodal.load.a.save" /></button>
            <button onClick={props.onNewGame}><T id="auto.ui.defeatmodal.new.game" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

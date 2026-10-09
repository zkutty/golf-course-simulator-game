import { useEffect, useId, useMemo, useRef } from "react";
import { formatCurrency, formatNumber, formatWeekLabel } from "../i18n/format";
import type { ObjectiveState } from "../game/models/objectives";
import { T } from "../i18n/T";
import { useI18n } from "../i18n/useI18n";
import { IconUi } from "../assets/icons/IconUi";
import { useFocusTrap } from "./accessibility/useFocusTrap";
import "./OutcomeDialogs.css";

const CONFETTI_COLORS = ["#D84848", "#F2C14E", "#7AB86D", "#5BA4CF", "#B36BD4", "#F28C6B"];
function ConfettiField() {
  const pieces = useMemo(() => Array.from({ length: 60 }, (_, i) => {
    const h = (i * 2654435761) % 1000;
    return { left: `${h % 100}%`, delay: `${((h >> 3) % 24) / 10}s`, duration: `${2.6 + ((h >> 5) % 18) / 10}s`, size: 6 + ((h >> 7) % 7), color: CONFETTI_COLORS[i % CONFETTI_COLORS.length] };
  }), []);
  return <div className="cc-outcome-confetti" aria-hidden="true" data-testid="outcome-confetti">
    {pieces.map((p, i) => <span key={i} style={{ left: p.left, width: p.size, height: p.size * .5, background: p.color, animationDuration: p.duration, animationDelay: p.delay }} />)}
  </div>;
}

// Celebration never forces a session to end: Keep playing is the only action.
export function VictoryModal(props: {
  objectives: ObjectiveState;
  courseName: string;
  week: number;
  cash: number;
  reputation: number;
  courseRating: number;
  careerNote?: string;
  onContinue: () => void;
}) {
  const { t, locale } = useI18n();
  const { objectives } = props;
  const id = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const continueRef = useRef<HTMLButtonElement>(null);
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
      } else if (previous && panel?.isConnected) continueRef.current?.focus();
    };
    continueRef.current?.focus();
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
  return <div ref={overlayRef} className="cc-outcome-overlay">
    <ConfettiField />
    <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-summary`} className="cc-outcome-panel cc-outcome-victory">
      <div className="cc-outcome-body" data-testid="outcome-body" tabIndex={0}>
        <header className="cc-outcome-header">
          <IconUi name="tournaments" className="cc-outcome-emblem" />
          <h2 id={`${id}-title`}><T id="auto.ui.victorymodal.objectives.complete" /></h2>
          <p id={`${id}-summary`}>{objectives.wonWeek != null ? t("outcome.victory.summaryDeadline", { course: props.courseName, week: formatWeekLabel(objectives.wonWeek, locale, "week") }) : t("outcome.victory.summary", { course: props.courseName })}</p>
        </header>
        <dl className="cc-outcome-stats cc-outcome-summary">
          <SummaryStat label={t("common.weekLabel")} value={formatNumber(props.week, locale)} />
          <SummaryStat label={t("stat.cash")} value={formatCurrency(props.cash, locale)} />
          <SummaryStat label={t("stat.reputation")} value={`${formatNumber(props.reputation, locale)}/100`} />
          <SummaryStat label={t("stat.courseRating")} value={formatNumber(props.courseRating, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} />
        </dl>
        <ul className="cc-outcome-goals">
          {objectives.goals.map((g, i) => <li key={g.id}>
            <IconUi name="completed" /><div><span className="cc-outcome-goal-status">{t("outcome.goalCompleted")}</span><strong>{g.labelKey ? t(g.labelKey) : g.label}</strong>
              {objectives.progress[i]?.completedWeek != null && <span>{formatWeekLabel(objectives.progress[i].completedWeek!, locale, "week")}</span>}
            </div>
          </li>)}
        </ul>
        {props.careerNote && <p className="cc-outcome-career"><IconUi name="progression" />{props.careerNote}</p>}
        <button ref={continueRef} className="cc-outcome-primary cc-outcome-continue" onClick={props.onContinue}><T id="auto.ui.victorymodal.keep.playing" /></button>
      </div>
    </div>
  </div>;
}
function SummaryStat({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

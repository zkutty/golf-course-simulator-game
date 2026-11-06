import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Course, WeekResult, World } from "../game/models/types";
import { formatCurrency, formatNumber } from "../i18n/format";
import { translateCurrent } from "../i18n/core";
import { systemControlEnvelope, type AdvancedSystemId } from "../game/experience/systemControl";
import {
  biomeContextAttributes,
  biomeUiStyle,
  type BiomeUiTheme,
} from "./biomeUiTheme";
import "./WeekCloseReport.css";

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

function focusableItems(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.getClientRects().length > 0);
}

export function WeekCloseReport(props: { week: number; result: WeekResult; resumeSpeed: string; onContinue: () => void; course?: Course; world?: World; biomeContext?: BiomeUiTheme }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const { result } = props;
  const hasManagement = Boolean(props.course && props.world);
  const [managementModule, setManagementModule] = useState<typeof import("./WeekCloseManagement")>();
  const [managementLoadFailed, setManagementLoadFailed] = useState(false);
  useEffect(() => {
    if (!hasManagement) return;
    let current = true;
    void import("./WeekCloseManagement").then(
      (module) => { if (current) setManagementModule(module); },
      () => { if (current) setManagementLoadFailed(true); },
    );
    return () => { current = false; };
  }, [hasManagement]);
  // Cache the module only. Rebuild from current props and locale on each render.
  let management: ReturnType<typeof import("./WeekCloseManagement").buildWeekCloseManagement> | undefined;
  let managementFailed = managementLoadFailed;
  if (managementModule && props.course && props.world) {
    try {
      management = managementModule.buildWeekCloseManagement({
        course: props.course, world: props.world, result, week: props.week,
      });
    } catch {
      managementFailed = true;
    }
  }
  const control = props.world ? systemControlEnvelope(props.world) : undefined;
  const full = (id: AdvancedSystemId) => !control || control.systems.find((system) => system.id === id)?.visibility === "full";
  const biomeRows = result.biomeEconomy ? [
    ...(full("irrigation") ? [[translateCurrent("weekClose.biomeWater"), formatCurrency(result.biomeEconomy.waterCost)]] : []),
    ...(full("localized-turf") ? [[translateCurrent("weekClose.plantCare"), formatCurrency(result.biomeEconomy.plantCareCost)]] : []),
    ...(full("drainage") ? [[translateCurrent("weekClose.drainageCare"), formatCurrency(result.biomeEconomy.drainageCareCost)]] : []),
  ] : [];
  const rows = [
    [translateCurrent("weekClose.rounds"), formatNumber(result.visitors)],
    [translateCurrent("weekClose.revenue"), formatCurrency(result.revenue)],
    ...(result.revenueBreakdown?.property ? [[translateCurrent("property.report.revenue"), formatCurrency(result.revenueBreakdown.property)]] : []),
    ...(result.revenueBreakdown?.propertyVisitors ? [[translateCurrent("property.report.guests"), formatNumber(result.revenueBreakdown.propertyVisitors)]] : []),
    [translateCurrent("weekClose.costs"), formatCurrency(result.costs)],
    ...biomeRows,
    [translateCurrent("weekClose.satisfaction"), `${Math.round(result.avgSatisfaction)}%`],
    ...(result.weatherSummary ? [[
      translateCurrent("season.report.weather"),
      translateCurrent("season.report.weatherValue", {
        playable: result.weatherSummary.playableDays,
        rain: result.weatherSummary.rainDays,
        severe: result.weatherSummary.severeDays,
      }),
    ]] : []),
  ];

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    const main = document.querySelector<HTMLElement>(".cc-main");
    const previousInert = main?.inert;
    const hadAriaHidden = main?.hasAttribute("aria-hidden") ?? false;
    const previousAriaHidden = main?.getAttribute("aria-hidden");
    if (main) {
      main.inert = true;
      main.setAttribute("aria-hidden", "true");
    }

    const frame = window.requestAnimationFrame(() => continueRef.current?.focus({ preventScroll: true }));
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableItems(dialog);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      if (main) {
        main.inert = previousInert ?? false;
        if (hadAriaHidden) main.setAttribute("aria-hidden", previousAriaHidden ?? "");
        else main.removeAttribute("aria-hidden");
      }
      window.requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={dialogRef} className="cc-week-close-overlay" role="dialog" aria-modal="true" aria-labelledby="week-close-title" data-testid="week-close-report" data-resume-speed={props.resumeSpeed} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <section
        data-tutorial-target="weekly-report"
        className="cc-tycoon-panel cc-week-close-body"
        data-testid="week-close-body"
        role="region"
        aria-labelledby="week-close-title"
        tabIndex={0}
        style={props.biomeContext ? biomeUiStyle(props.biomeContext) as CSSProperties : undefined}
        {...(props.biomeContext
          ? biomeContextAttributes(
            props.biomeContext,
            "upkeep-report",
            result.profit < 0 ? "warning" : "neutral",
          )
          : {})}
      >
        <div className="cc-week-close-eyebrow">{translateCurrent("weekClose.eyebrow", { week: props.week })}</div>
        <h2 id="week-close-title">{translateCurrent("weekClose.title")}</h2>
        <div className="cc-week-close-facts">
          {rows.map(([label, value]) => <div key={label} className="cc-week-close-fact"><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        <div className="cc-week-close-footer">
          <strong className="cc-week-close-profit" style={{ color: result.profit >= 0 ? "#27643a" : "#9a332d" }}>{translateCurrent("weekClose.profit", { profit: formatCurrency(result.profit) })}</strong>
          <button ref={continueRef} data-testid="week-close-continue" onClick={props.onContinue}>{translateCurrent("weekClose.continue")}</button>
        </div>
        {props.course && props.world && <details data-testid="m49-management-report" className="cc-week-close-management">
          <summary id="week-close-management-title" tabIndex={0}>{translateCurrent("weekClose.managementEvidence")}</summary>
          <div className="cc-week-close-management-content">
            {management?.beforeAudience}
            <div className="cc-week-close-audiences" data-testid="week-close-audiences" role="region" aria-labelledby="week-close-management-title" tabIndex={0} aria-busy={!management && !managementFailed}>
              {management ? management.audience : managementFailed
                ? <div role="alert">{translateCurrent("deferredSurface.error.title", { surface: translateCurrent("weekClose.managementEvidence") })} {translateCurrent("deferredSurface.error.body")}</div>
                : <div role="status">{translateCurrent("deferredSurface.loading", { surface: translateCurrent("weekClose.managementEvidence") })}</div>}
            </div>
            {management?.afterAudience}
          </div>
        </details>}
      </section>
    </div>,
    document.body,
  );
}

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Course, WeekResult, World } from "../game/models/types";
import { buildM49CourseReport } from "../game/m49/report";
import { formatCurrency, formatNumber } from "../i18n/format";
import { translateCurrent } from "../i18n/core";
import { systemControlEnvelope, type AdvancedSystemId } from "../game/experience/systemControl";
import {
  biomeContextAttributes,
  type BiomeUiTheme,
} from "./biomeUiTheme";

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

function focusableItems(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.getClientRects().length > 0);
}

export function WeekCloseReport(props: { week: number; result: WeekResult; resumeSpeed: string; onContinue: () => void; course?: Course; world?: World; biomeContext?: BiomeUiTheme }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const { result } = props;
  const management = props.course && props.world
    ? buildM49CourseReport({ course: props.course, world: props.world, result, generatedAtWeek: props.week })
    : undefined;
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
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="week-close-title" data-testid="week-close-report" data-resume-speed={props.resumeSpeed} style={{ position: "fixed", inset: 0, zIndex: 100100, display: "grid", placeItems: "center", padding: 20, background: "rgba(16,24,18,.72)" }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <section
        data-tutorial-target="weekly-report"
        className="cc-tycoon-panel"
        {...(props.biomeContext
          ? biomeContextAttributes(
            props.biomeContext,
            "upkeep-report",
            result.profit < 0 ? "warning" : "neutral",
          )
          : {})}
        style={{ width: "min(440px, 94vw)", padding: 22, border: "3px solid #8b652e", boxShadow: "0 18px 55px rgba(0,0,0,.45)" }}
      >
        <div style={{ textTransform: "uppercase", letterSpacing: ".12em", fontSize: 11, color: "#75613e", fontWeight: 900 }}>{translateCurrent("weekClose.eyebrow", { week: props.week })}</div>
        <h2 id="week-close-title" style={{ margin: "4px 0 16px", color: "#344338" }}>{translateCurrent("weekClose.title")}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "9px 18px", marginBottom: 16 }}>
          {rows.map(([label, value]) => <div key={label} style={{ display: "contents" }}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        <div style={{ borderTop: "1px solid rgba(65,78,57,.25)", paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <strong style={{ color: result.profit >= 0 ? "#27643a" : "#9a332d", fontSize: 20 }}>{translateCurrent("weekClose.profit", { profit: formatCurrency(result.profit) })}</strong>
          <button ref={continueRef} data-testid="week-close-continue" onClick={props.onContinue} style={{ padding: "10px 18px", borderRadius: 10, border: "2px solid #315e37", background: "#3d6b3d", color: "white", fontWeight: 900, cursor: "pointer" }}>{translateCurrent("weekClose.continue")}</button>
        </div>
        {management && <details data-testid="m49-management-report" style={{ marginTop: 18, borderTop: "1px solid rgba(65,78,57,.25)", paddingTop: 12 }}>
          <summary style={{ cursor: "pointer", color: "#344338", fontWeight: 900 }}>{translateCurrent("weekClose.managementEvidence")}</summary>
          <div style={{ marginTop: 12, display: "grid", gap: 10, fontSize: 12 }}>
            <div style={{ color: "#4c5b4c" }}>{management.observedRounds ? translateCurrent(management.observedRounds === 1 ? "weekClose.managementIntroObservedOne" : "weekClose.managementIntroObserved", { headline: management.headline, rounds: management.observedRounds }) : translateCurrent("weekClose.managementIntroPredicted", { headline: management.headline })}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} aria-label={translateCurrent("weekClose.managementSupportedSegments")}>
              {management.demand.supportedSegments.map((segment) => <span key={segment} style={{ background: "#e7efe2", borderRadius: 999, padding: "4px 8px", color: "#315e37", fontWeight: 800 }}>{segment}</span>)}
              {!management.demand.supportedSegments.length && <span style={{ color: "#7a6a51" }}>{translateCurrent("weekClose.managementNoFit")}</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "5px 8px", alignItems: "center" }}>
              <strong>{translateCurrent("weekClose.managementAudience")}</strong><strong>{translateCurrent("weekClose.managementAppeal")}</strong><strong>{translateCurrent("weekClose.managementPay")}</strong><strong>{translateCurrent("weekClose.managementEvidenceLabel")}</strong>
              {Object.values(management.demand.segments).map((segment) => <div key={segment.segment} style={{ display: "contents" }}>
                <span>{segment.segment}</span><span>{Math.round(segment.bookingAppeal * 100)}%</span><span>{formatCurrency(segment.willingnessToPay)}</span><span>{segment.evidenceLabel}</span>
              </div>)}
            </div>
            <div style={{ borderTop: "1px solid rgba(65,78,57,.16)", paddingTop: 8 }}>
              {translateCurrent("weekClose.managementCondition", { condition: Math.round(management.condition.overall * 100), maintenance: management.condition.shortfall > 0 ? translateCurrent("weekClose.managementMaintenanceShort", { amount: formatCurrency(management.condition.shortfall) }) : translateCurrent("weekClose.managementMaintenanceOnPlan"), projected: Math.round(management.condition.projectedRecovery * 100) })}
            </div>
            {management.alerts.length > 0 && <div style={{ display: "grid", gap: 4 }}><strong>{translateCurrent("weekClose.managementWatchNext")}</strong>{management.alerts.slice(0, 3).map((alert) => <div key={alert.id} style={{ color: alert.severity === "urgent" ? "#9a332d" : alert.severity === "warning" ? "#8a641e" : "#4c5b4c" }}>{translateCurrent("weekClose.managementAlert", { title: alert.title, action: alert.action })}</div>)}</div>}
            {management.topCauses.length > 0 && <div style={{ display: "grid", gap: 4 }}><strong>{translateCurrent("weekClose.managementObservedCauses")}</strong>{management.topCauses.slice(0, 3).map((cause) => <div key={cause.cause}>{translateCurrent("weekClose.managementCause", { cause: cause.cause, count: cause.observations })}</div>)}</div>}
            <div style={{ color: management.reconciliation.ledgerBalanced ? "#27643a" : "#9a332d" }}>{translateCurrent(management.reconciliation.ledgerBalanced ? "weekClose.managementLedgerReconciled" : "weekClose.managementLedgerReview")}</div>
          </div>
        </details>}
      </section>
    </div>,
    document.body,
  );
}

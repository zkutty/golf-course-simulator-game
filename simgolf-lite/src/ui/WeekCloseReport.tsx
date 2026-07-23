import type { WeekResult } from "../game/models/types";
import { formatCurrency, formatNumber } from "../i18n/format";
import { translateCurrent } from "../i18n/core";

export function WeekCloseReport(props: { week: number; result: WeekResult; resumeSpeed: string; onContinue: () => void }) {
  const { result } = props;
  const rows = [
    [translateCurrent("weekClose.rounds"), formatNumber(result.visitors)],
    [translateCurrent("weekClose.revenue"), formatCurrency(result.revenue)],
    [translateCurrent("weekClose.costs"), formatCurrency(result.costs)],
    [translateCurrent("weekClose.satisfaction"), `${Math.round(result.avgSatisfaction)}%`],
  ];
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="week-close-title" data-testid="week-close-report" data-resume-speed={props.resumeSpeed} style={{ position: "fixed", inset: 0, zIndex: 99960, display: "grid", placeItems: "center", padding: 20, background: "rgba(16,24,18,.72)" }}>
      <section className="cc-tycoon-panel" style={{ width: "min(440px, 94vw)", padding: 22, border: "3px solid #8b652e", boxShadow: "0 18px 55px rgba(0,0,0,.45)" }}>
        <div style={{ textTransform: "uppercase", letterSpacing: ".12em", fontSize: 11, color: "#75613e", fontWeight: 900 }}>{translateCurrent("weekClose.eyebrow", { week: props.week })}</div>
        <h2 id="week-close-title" style={{ margin: "4px 0 16px", color: "#344338" }}>{translateCurrent("weekClose.title")}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "9px 18px", marginBottom: 16 }}>
          {rows.map(([label, value]) => <div key={label} style={{ display: "contents" }}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        <div style={{ borderTop: "1px solid rgba(65,78,57,.25)", paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <strong style={{ color: result.profit >= 0 ? "#27643a" : "#9a332d", fontSize: 20 }}>{translateCurrent("weekClose.profit", { profit: formatCurrency(result.profit) })}</strong>
          <button autoFocus data-testid="week-close-continue" onClick={props.onContinue} style={{ padding: "10px 18px", borderRadius: 10, border: "2px solid #315e37", background: "#3d6b3d", color: "white", fontWeight: 900, cursor: "pointer" }}>{translateCurrent("weekClose.continue")}</button>
        </div>
      </section>
    </div>
  );
}

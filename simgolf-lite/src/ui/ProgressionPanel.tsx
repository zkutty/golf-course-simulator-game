import { nextReputationTier, REPUTATION_TIERS, reputationProgress, reputationTier } from "../game/progression/progression";
import { translateCurrent } from "../i18n/core";

export function ProgressionPanel(props: { reputation: number; onClose: () => void }) {
  const current = reputationTier(props.reputation);
  const next = nextReputationTier(props.reputation);
  const progress = reputationProgress(props.reputation);
  return <aside className="cc-progression-panel" data-testid="progression-panel" style={{ position: "absolute", top: 54, left: 10, zIndex: 125, width: "min(390px,calc(100% - 20px))", maxHeight: "calc(100% - 130px)", overflow: "auto", padding: 16, borderRadius: 12, border: "2px solid #7a5527", background: "linear-gradient(150deg,#fff5cf,#e5c987)", boxShadow: "0 14px 32px rgba(0,0,0,.35)", color: "#352715" }}>
    <header style={{ display: "flex", alignItems: "start", gap: 10 }}>
      <div style={{ flex: 1 }}><small style={{ fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em" }}>{translateCurrent("progression.eyebrow")}</small><h2 style={{ margin: "2px 0 0" }}>{current.name}</h2><div style={{ fontSize: 13 }}>{translateCurrent("progression.current", { reputation: Math.round(props.reputation) })}</div></div>
      <button aria-label={translateCurrent("progression.close")} onClick={props.onClose}>✕</button>
    </header>
    <div style={{ margin: "14px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 800 }}><span>{current.name}</span><span>{next ? translateCurrent("progression.next", { name: next.name, reputation: next.minReputation }) : translateCurrent("progression.max")}</span></div>
      <div role="progressbar" aria-valuemin={current.minReputation} aria-valuemax={next?.minReputation ?? 100} aria-valuenow={Math.round(props.reputation)} style={{ height: 9, marginTop: 5, borderRadius: 999, overflow: "hidden", background: "rgba(59,45,23,.2)" }}><div style={{ width: `${Math.round(progress * 100)}%`, height: "100%", background: "linear-gradient(90deg,#52743a,#c08a25)" }} /></div>
    </div>
    <div style={{ display: "grid", gap: 8 }}>
      {REPUTATION_TIERS.map((tier) => {
        const unlocked = props.reputation >= tier.minReputation;
        return <section key={tier.id} style={{ padding: 10, borderRadius: 9, border: tier.id === current.id ? "2px solid #6d4b20" : "1px solid rgba(72,53,25,.24)", background: unlocked ? "rgba(255,255,255,.58)" : "rgba(86,70,44,.09)", opacity: unlocked ? 1 : .72 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>{unlocked ? "✓" : "🔒"} {tier.name}</strong><span style={{ fontSize: 12, fontWeight: 800 }}>{tier.minReputation} {translateCurrent("stat.reputationShort")}</span></div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{tier.headlineUnlocks.join(" • ")}</div>
          <div style={{ fontSize: 11, marginTop: 3, opacity: .75 }}>{translateCurrent("progression.staff", { role: tier.staffRole, level: tier.staffCap, building: tier.buildingTierCap })}</div>
        </section>;
      })}
    </div>
  </aside>;
}

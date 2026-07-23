import { useMemo, useState } from "react";
import { formatCurrency, formatNumber } from "../i18n/format";
import type { Course, World } from "../game/models/types";
import {
  FACILITY_MODULE_SPECS,
  PROPERTY_ASSET_SPECS,
  propertyOutingPreview,
  propertySummary,
  propertyUpgradePreview,
  type PropertyCommand,
  type PropertyCommandResult,
} from "../game/property/property";
import type { FacilityModuleKind, OutingBooking, PropertyAsset, PropertyAssetCategory, PropertyAssetKind } from "../game/property/types";
import { translateCurrent } from "../i18n/core";

type Tab = "campus" | "resort" | "community" | "ledger";

const TAB_COPY: Record<Tab, { icon: string; label: string; categories: PropertyAssetCategory[] }> = {
  campus: { icon: "🏌️", label: "Club campus", categories: ["access", "practice", "clubhouse"] },
  resort: { icon: "🏨", label: "Destination", categories: ["resort"] },
  community: { icon: "🏘️", label: "Community", categories: ["community", "safety"] },
  ledger: { icon: "📒", label: "Ledger", categories: [] },
};

const CATEGORY_COPY: Partial<Record<PropertyAssetCategory, { title: string; help: string }>> = {
  access: { title: "Arrival and access", help: "Road and parking capacity is shared by golfers, practice customers, diners, event guests, hotel guests, and residents. Surface and condition both affect throughput." },
  practice: { title: "Practice academy", help: "Buckets, bays, putting, short game, and practice holes create direct revenue while improving customer skill and loyalty." },
  clubhouse: { title: "Clubhouse rooms", help: "The clubhouse shell unlocks revenue modules. Dining and retail draw from every visitor stream; lockers support memberships and outings." },
  resort: { title: "Overnight resort", help: "Lodging creates stay-and-play guests who also spend on golf, practice, dining, retail, spa, and events." },
  community: { title: "Golf community", help: "Home sales provide capital and residents become recurring customers, but occupied homes introduce ball-strike exposure." },
  safety: { title: "Safety and neighbor relations", help: "Buffers and netting reduce claims and complaints from errant shots near houses and condominiums." },
};

export function PropertyManagementPanel(props: {
  course: Course;
  world: World;
  onCommand: (command: PropertyCommand) => PropertyCommandResult;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("campus");
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const summary = useMemo(() => propertySummary(props.course, props.world), [props.course, props.world]);
  const run = (command: PropertyCommand) => {
    const result = props.onCommand(command);
    setNotice({ ok: result.ok, message: result.message });
  };
  const tabInfo = TAB_COPY[tab];

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label={translateCurrent("property.aria")}
      data-testid="property-management-panel"
      className="cc-tycoon-panel"
      style={{ position: "absolute", zIndex: 1200, top: 58, left: 12, width: "min(720px, calc(100vw - 24px))", maxHeight: "calc(100vh - 70px)", overflow: "hidden", display: "flex", flexDirection: "column", border: "3px solid #7b5b2d", boxShadow: "0 18px 50px rgba(20,28,20,.38)" }}
    >
      <header style={{ padding: "14px 16px 10px", background: "linear-gradient(135deg,#f9edcc,#e4d09d)", borderBottom: "1px solid rgba(70,55,25,.28)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".12em", color: "#74623f", textTransform: "uppercase" }}>{translateCurrent("property.eyebrow")}</div>
            <h2 style={{ margin: "2px 0 3px", color: "#334438" }}>{translateCurrent("property.title")}</h2>
            <div style={{ fontSize: 12, color: "#5d685d" }}>{translateCurrent("property.subtitle")}</div>
          </div>
          <button aria-label={translateCurrent("property.close")} onClick={props.onClose} style={closeButton}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(70px,1fr))", gap: 7, marginTop: 12 }}>
          <Metric label={translateCurrent("property.metric.cash")} value={formatCurrency(props.world.cash)} />
          <Metric label={translateCurrent("property.metric.arrival")} value={formatNumber(summary.accessCapacity)} />
          <Metric label={translateCurrent("property.metric.assets")} value={formatNumber(summary.assets.length)} />
          <Metric label={translateCurrent("property.metric.customers")} value={formatNumber(summary.enterprise.customers.length)} />
          <Metric label={translateCurrent("property.metric.homes")} value={formatNumber(summary.occupiedHomes)} />
          <Metric label={translateCurrent("property.metric.complaints")} value={formatNumber(summary.openComplaints)} warning={summary.openComplaints > 0} />
        </div>
      </header>

      <nav aria-label={translateCurrent("property.sections")} style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 5, padding: 8, background: "#f7f3e8", borderBottom: "1px solid #d7cfbd" }}>
        {(Object.keys(TAB_COPY) as Tab[]).map((key) => <button key={key} data-testid={`property-tab-${key}`} aria-pressed={tab === key} onClick={() => setTab(key)} style={{ ...tabButton, ...(tab === key ? activeTabButton : {}) }}>{TAB_COPY[key].icon} {TAB_COPY[key].label}</button>)}
      </nav>

      {notice && <div role="status" data-testid="property-notice" style={{ padding: "8px 13px", fontSize: 12, fontWeight: 800, color: notice.ok ? "#245c34" : "#8a332b", background: notice.ok ? "#e7f3e7" : "#fbe9e5", borderBottom: "1px solid rgba(50,50,50,.12)" }}>{notice.message}</div>}

      <div style={{ overflowY: "auto", padding: 12, background: "rgba(255,252,243,.96)" }}>
        {tab !== "ledger" && <PropertyMap course={props.course} assets={summary.assets} />}
        {tab === "ledger" ? <LedgerView summary={summary} world={props.world} /> : tabInfo.categories.map((category) => {
          const copy = CATEGORY_COPY[category]!;
          const kinds = (Object.keys(PROPERTY_ASSET_SPECS) as PropertyAssetKind[]).filter((kind) => PROPERTY_ASSET_SPECS[kind].category === category);
          return <section key={category} style={{ marginTop: 14 }}>
            <div style={{ marginBottom: 7 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: "#3e4c40" }}>{copy.title}</h3>
              <div data-tooltip={copy.help} style={{ fontSize: 11, color: "#677267", cursor: "help" }}>{copy.help}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
              {kinds.map((kind) => <AssetCard key={kind} course={props.course} kind={kind} asset={summary.assets.find((candidate) => candidate.kind === kind)} onCommand={run} />)}
            </div>
          </section>;
        })}

        {tab === "campus" && <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <ActionCard icon="🧑‍🏫" title={translateCurrent("property.professionals")} detail={`${summary.enterprise.professionals.length} hired · lessons improve customer skill and generate academy income.`} button="Hire professional · $4,000" onClick={() => run({ type: "HIRE_PRO" })} />
          <ActionCard icon="🎟️" title={translateCurrent("property.memberships")} detail={summary.enterprise.membership.active ? `Tier ${summary.enterprise.membership.tier} · ${summary.enterprise.membership.memberCount} members · ${formatCurrency(summary.enterprise.membership.monthlyFee)}/month` : "Recurring dues, repeat play, practice access, and clubhouse demand."} button={summary.enterprise.membership.active ? "Upgrade program" : "Launch · $2,500"} onClick={() => run({ type: summary.enterprise.membership.active ? "UPGRADE_MEMBERSHIP" : "LAUNCH_MEMBERSHIP" })} />
        </section>}
        {tab === "campus" && <ShellModules assets={summary.assets} onCommand={run} />}
        {tab === "campus" && <OutingPlanner course={props.course} world={props.world} outings={summary.enterprise.outings} onCommand={run} />}
        {tab === "resort" && <section style={{ marginTop: 14 }}>
          <h3 style={{ marginBottom: 5 }}>{translateCurrent("property.resort.operations")}</h3>
          <div style={{ fontSize: 11, color: "#687168", marginBottom: 8 }}>{translateCurrent("property.resort.help")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
            <ActionCard icon="🛎️" title={translateCurrent("property.resort.frontDesk")} detail={`${summary.enterprise.resort.frontDesk} staffed`} button="Hire · $2,500" onClick={() => run({ type: "HIRE_SERVICE", role: "frontDesk" })} />
            <ActionCard icon="🧹" title={translateCurrent("property.resort.housekeeping")} detail={`${summary.enterprise.resort.housekeeping} staffed · ${summary.enterprise.resort.dirtyRooms} dirty · ${summary.enterprise.resort.outOfOrderRooms} out of order`} button="Hire · $2,500" onClick={() => run({ type: "HIRE_SERVICE", role: "housekeeping" })} />
            <ActionCard icon="🚌" title={translateCurrent("property.resort.shuttle")} detail={`${summary.enterprise.resort.shuttleDrivers} drivers · ${summary.enterprise.resort.transportWaitMinutes} min current wait`} button="Hire · $2,500" onClick={() => run({ type: "HIRE_SERVICE", role: "shuttleDrivers" })} />
            <ActionCard icon="🍽️" title={translateCurrent("property.resort.food")} detail={`${summary.enterprise.resort.foodService} staffed`} button="Hire · $2,500" onClick={() => run({ type: "HIRE_SERVICE", role: "foodService" })} />
            <ActionCard icon="🧰" title={translateCurrent("property.resort.recovery")} detail={`${summary.enterprise.resort.serviceQueue} guests waiting for recovery`} button="Clear rooms and queues" onClick={() => run({ type: "RECOVER_SERVICE" })} />
          </div>
          <h3 style={{ marginBottom: 5 }}>{translateCurrent("property.resort.packages")}</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{(["room_only", "stay_and_play", "academy", "event"] as const).map((kind) => <button key={kind} onClick={() => run({ type: "BOOK_PACKAGE", package: kind })} style={smallButton}>{translateCurrent("property.book", { name: kind.replaceAll("_", " ") })}</button>)}</div>
        </section>}
        {tab === "community" && <section style={{ marginTop: 14, border: "1px solid #d4c6ae", borderRadius: 8, padding: 10, background: "#fffaf0" }}>
          <h3 style={{ margin: "0 0 5px" }}>{translateCurrent("property.safety.title")}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}><Metric label={translateCurrent("property.safety.risk")} value={`${Math.round(summary.safety.score)}/100`} warning={summary.safety.eligibility !== "safe"} /><Metric label={translateCurrent("property.safety.eligibility")} value={summary.safety.eligibility} warning={summary.safety.eligibility === "blocked"} /><Metric label={translateCurrent("property.safety.expected")} value={summary.safety.expectedExposure.toFixed(1)} /><Metric label={translateCurrent("property.safety.mitigation")} value={summary.safety.mitigation.toFixed(1)} /></div>
          <div style={{ marginTop: 7, fontSize: 11 }}><strong>{translateCurrent("property.safety.value")}</strong> {formatCurrency(summary.residentialValue)} {translateCurrent("property.safety.valueHelp")}</div>
          {summary.safety.contributions.slice(0, 4).map((item) => <div key={item.holeId} style={{ fontSize: 10, marginTop: 4 }}>{item.holeName}: {translateCurrent("property.safety.hole", { distance: item.distanceTiles.toFixed(1), expected: item.expectedRisk.toFixed(1), outlier: item.outlierRisk.toFixed(1) })}</div>)}
        </section>}
      </div>
    </section>
  );
}

function AssetCard(props: { course: Course; kind: PropertyAssetKind; asset?: PropertyAsset; onCommand: (command: PropertyCommand) => void }) {
  const { asset } = props;
  const spec = PROPERTY_ASSET_SPECS[props.kind];
  const preview = asset ? propertyUpgradePreview(props.course, asset.id) : null;
  return <article data-testid={`property-asset-${props.kind}`} style={{ border: "1px solid #d3cab6", borderRadius: 9, padding: 9, background: asset ? "#f7fbf3" : "#fffdf8", minHeight: 112 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <div><span style={{ fontSize: 18 }}>{spec.icon}</span> <strong style={{ color: "#3c483d" }}>{spec.label}</strong></div>
      {asset && <span style={{ fontSize: 10, padding: "2px 6px", height: 18, borderRadius: 999, background: "#dce9d6", fontWeight: 900 }}>{translateCurrent("property.asset.tier", { tier: asset.tier })}{asset.surface ? ` · ${asset.surface}` : ""}</span>}
    </div>
    <p style={{ margin: "5px 0 8px", minHeight: 28, fontSize: 11, color: "#697269" }}>{spec.description}</p>
    {asset ? <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4, fontSize: 10, color: "#5a665b", marginBottom: 7 }}>
        <span>{translateCurrent("property.asset.cap", { value: asset.capacity })}</span><span>{translateCurrent("property.asset.condition", { value: Math.round(asset.condition * 100) })}</span><span>{translateCurrent("property.asset.price", { value: formatCurrency(asset.price) })}</span>
      </div>
      {(asset.constructionDaysRemaining ?? 0) > 0 && <div role="status" style={{ marginBottom: 6, padding: 5, borderRadius: 5, background: "#fff0c9", color: "#704f16", fontSize: 10, fontWeight: 800 }}>{translateCurrent("property.asset.construction", { days: asset.constructionDaysRemaining ?? 0 })}</div>}
      {asset.lastDay && <div style={{ marginBottom: 6, fontSize: 10, color: asset.lastDay.denied > 0 ? "#8a332b" : "#5a665b" }}>{translateCurrent("property.asset.lastDay", { served: asset.lastDay.served, demand: asset.lastDay.demand, denied: asset.lastDay.denied, revenue: formatCurrency(asset.lastDay.revenue) })}</div>}
      {preview && <div data-testid={`upgrade-preview-${props.kind}`} style={{ marginBottom: 6, fontSize: 9, color: preview.blocker ? "#8a332b" : "#6b6555" }}>{translateCurrent("property.asset.upgradePreview", { tier: preview.nextTier, capacity: preview.capacityDelta, upkeep: formatCurrency(preview.upkeepDelta), parking: preview.parkingDemandDelta, days: preview.downtimeDays, breakEven: preview.breakEvenVisitorsPerDay })}{preview.blocker ? translateCurrent("property.asset.blocked", { reason: preview.blocker }) : ""}</div>}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        <button data-testid={`upgrade-${props.kind}`} onClick={() => props.onCommand({ type: "UPGRADE", assetId: asset.id })} disabled={!preview || !!preview.blocker} style={smallButton}>{!preview ? "Max tier" : `Upgrade · ${formatCurrency(preview.cost)}`}</button>
        {asset.condition < 0.94 && <button onClick={() => props.onCommand({ type: "MAINTAIN", assetId: asset.id })} style={smallButton}>{translateCurrent("property.asset.work")}</button>}
        <button aria-label={translateCurrent(asset.enabled ? "property.asset.close" : "property.asset.reopen", { name: spec.label })} onClick={() => props.onCommand({ type: "TOGGLE", assetId: asset.id })} style={smallButton}>{translateCurrent(asset.enabled ? "common.close" : "common.on")}</button>
        <span aria-label={translateCurrent("property.asset.move", { name: spec.label })} style={{ display: "inline-flex", gap: 2 }}><button title={translateCurrent("property.asset.west")} onClick={() => props.onCommand({ type: "MOVE", assetId: asset.id, dx: -1, dy: 0 })} style={smallButton}>←</button><button title={translateCurrent("property.asset.north")} onClick={() => props.onCommand({ type: "MOVE", assetId: asset.id, dx: 0, dy: -1 })} style={smallButton}>↑</button><button title={translateCurrent("property.asset.south")} onClick={() => props.onCommand({ type: "MOVE", assetId: asset.id, dx: 0, dy: 1 })} style={smallButton}>↓</button><button title={translateCurrent("property.asset.east")} onClick={() => props.onCommand({ type: "MOVE", assetId: asset.id, dx: 1, dy: 0 })} style={smallButton}>→</button></span>
        <button aria-label={translateCurrent("property.asset.remove", { name: spec.label })} onClick={() => props.onCommand({ type: "REMOVE", assetId: asset.id })} style={smallButton}>{translateCurrent("property.asset.removeShort")}</button>
        {(asset.kind === "houses" || asset.kind === "condos") && <button aria-label={translateCurrent("property.asset.buyback", { name: spec.label })} onClick={() => props.onCommand({ type: "BUYBACK", assetId: asset.id })} style={smallButton}>{translateCurrent("property.asset.buybackShort")}</button>}
        {asset.category === "practice" && <button data-testid={`rotate-${props.kind}`} onClick={() => props.onCommand({ type: "ROTATE_PRACTICE", assetId: asset.id })} style={smallButton}>{translateCurrent("property.asset.rotatePractice")}</button>}
        <input aria-label={translateCurrent("property.asset.nameLabel", { name: spec.label })} defaultValue={asset.name} maxLength={40} onBlur={(event) => {
          if (event.target.value.trim() !== asset.name) props.onCommand({ type: "RENAME", assetId: asset.id, name: event.target.value });
        }} style={{ width: 92, padding: 3, fontSize: 10, borderRadius: 5, border: "1px solid #b8b09f" }} />
        {asset.price > 0 && <label style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 3 }}>{translateCurrent("property.asset.price", { value: "" })} <input aria-label={translateCurrent("property.asset.priceLabel", { name: spec.label })} type="number" min={0} value={asset.price} onChange={(event) => props.onCommand({ type: "SET_PRICE", assetId: asset.id, price: Number(event.target.value) })} style={{ width: 52, padding: 3, borderRadius: 5, border: "1px solid #b8b09f" }} /></label>}
        <label style={compactLabel}>{translateCurrent("property.asset.hours")} <select aria-label={translateCurrent("property.asset.hoursLabel", { name: spec.label })} value={`${asset.openHour ?? 7}-${asset.closeHour ?? 20}`} onChange={(event) => {
          const [openHour, closeHour] = event.target.value.split("-").map(Number);
          props.onCommand({ type: "SET_HOURS", assetId: asset.id, openHour, closeHour });
        }}><option value="7-16">7–16</option><option value="7-20">7–20</option><option value="8-20">8–20</option><option value="9-23">9–23</option></select></label>
        <label style={compactLabel}>{translateCurrent("property.asset.upkeep")} <select aria-label={translateCurrent("property.asset.upkeepLabel", { name: spec.label })} value={asset.upkeepPolicy ?? "standard"} onChange={(event) => props.onCommand({ type: "SET_UPKEEP", assetId: asset.id, policy: event.target.value as "lean" | "standard" | "premium" })}><option value="lean">{translateCurrent("property.asset.lean")}</option><option value="standard">{translateCurrent("property.asset.standard")}</option><option value="premium">{translateCurrent("property.asset.premium")}</option></select></label>
      </div>
    </> : <button data-testid={`build-${props.kind}`} onClick={() => props.onCommand({ type: "BUILD", kind: props.kind })} style={{ ...smallButton, background: "#3f6c43", color: "white", borderColor: "#315b35" }}>{translateCurrent("property.asset.build", { amount: formatCurrency(spec.buildCost) })}</button>}
  </article>;
}

function ShellModules(props: { assets: PropertyAsset[]; onCommand: (command: PropertyCommand) => void }) {
  const clubhouse = props.assets.find((asset) => asset.kind === "clubhouse");
  if (!clubhouse) return null;
  const installed = new Map((clubhouse.modules ?? []).map((module) => [module.kind, module]));
  return <section data-testid="property-shell-modules" style={{ marginTop: 14 }}>
    <h3 style={{ margin: "0 0 4px" }}>{translateCurrent("property.modules.title")}</h3>
    <div style={{ fontSize: 11, color: "#687168", marginBottom: 7 }}>{translateCurrent("property.modules.help", { tier: clubhouse.tier, slots: clubhouse.tier + 1 })}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
      {(Object.keys(FACILITY_MODULE_SPECS) as FacilityModuleKind[]).map((kind) => {
        const spec = FACILITY_MODULE_SPECS[kind];
        const module = installed.get(kind);
        return <article key={kind} data-testid={`property-module-${kind}`} style={{ border: "1px solid #d4cab4", borderRadius: 7, padding: 7, background: module ? "#f0f7ea" : "#fffdf8", fontSize: 10 }}>
          <strong>{spec.label}</strong> {translateCurrent("property.modules.meta", { tier: spec.requiredShellTier, capacity: spec.capacity })}
          <div style={{ margin: "3px 0 6px", color: "#6b7269" }}>{spec.description}</div>
          <button data-testid={`${module ? "toggle" : "install"}-module-${kind}`} disabled={!module && clubhouse.tier < spec.requiredShellTier} onClick={() => props.onCommand(module ? { type: "TOGGLE_MODULE", module: kind } : { type: "INSTALL_MODULE", module: kind })} style={smallButton}>{module ? translateCurrent(module.enabled ? "property.modules.close" : "property.modules.reopen") : translateCurrent("property.modules.install", { amount: formatCurrency(spec.buildCost) })}</button>
        </article>;
      })}
    </div>
  </section>;
}

function OutingPlanner(props: { course: Course; world: World; outings: OutingBooking[]; onCommand: (command: PropertyCommand) => void }) {
  const packages: OutingBooking["package"][] = ["golf_only", "golf_clinic", "golf_catering", "destination_event"];
  const scheduled = props.outings.filter((outing) => outing.status === "scheduled");
  return <section style={{ marginTop: 14 }}>
    <h3 style={{ margin: "0 0 4px" }}>🎉 {translateCurrent("property.outing")}</h3>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
      {packages.map((packageKind) => {
        const preview = propertyOutingPreview(props.course, props.world, packageKind);
        return <article key={packageKind} data-testid={`outing-preview-${packageKind}`} style={{ border: "1px solid #d4cab4", borderRadius: 7, padding: 8, background: preview.blockers.length ? "#fbf1e8" : "#f3f8ee", fontSize: 10 }}>
          <strong>{packageKind.replaceAll("_", " ")}</strong>
          <div>{translateCurrent("property.outing.preview", { guests: preview.guests, gross: formatCurrency(preview.gross), cost: formatCurrency(preview.variableCost), parking: preview.parkingDemand })}</div>
          {preview.blockers.length > 0 && <div style={{ marginTop: 4, color: "#8a332b" }}>{preview.blockers.join(" ")}</div>}
          <button disabled={preview.blockers.length > 0} onClick={() => props.onCommand({ type: "BOOK_OUTING", package: packageKind })} style={{ ...smallButton, marginTop: 6 }}>{translateCurrent("property.outing.book", { deposit: formatCurrency(preview.deposit) })}</button>
        </article>;
      })}
    </div>
    {scheduled.map((outing) => <div key={outing.id} style={{ marginTop: 6, padding: 7, border: "1px solid #d4cab4", borderRadius: 7, fontSize: 10 }}>{translateCurrent("property.outing.scheduled", { week: outing.week, day: outing.day + 1, package: outing.package.replaceAll("_", " "), guests: outing.guests })} <button onClick={() => props.onCommand({ type: "CANCEL_OUTING", outingId: outing.id })} style={{ ...smallButton, marginLeft: 8 }}>{translateCurrent("property.outing.cancel")}</button></div>)}
  </section>;
}

function ActionCard(props: { icon: string; title: string; detail: string; button: string; onClick: () => void }) {
  return <article style={{ border: "1px solid #d3cab6", borderRadius: 9, padding: 10, background: "#fffdf8" }}><strong>{props.icon} {props.title}</strong><p style={{ fontSize: 11, color: "#697269", minHeight: 28 }}>{props.detail}</p><button onClick={props.onClick} style={smallButton}>{props.button}</button></article>;
}

function PropertyMap(props: { course: Course; assets: PropertyAsset[] }) {
  if (props.assets.length === 0) return <div data-testid="property-map" style={{ padding: 10, border: "1px dashed #aaa58f", borderRadius: 8, color: "#77705f", fontSize: 11 }}>{translateCurrent("property.map.empty")}</div>;
  const colors: Record<PropertyAssetCategory, string> = { access: "#848b86", practice: "#74a85b", clubhouse: "#b88d52", resort: "#678fa8", community: "#c58f76", safety: "#497c49" };
  return <figure data-testid="property-map" style={{ margin: 0, border: "1px solid #cfc6b2", borderRadius: 8, overflow: "hidden", background: "#dce8c8" }}>
    <svg role="img" aria-label={translateCurrent("property.map.aria")} viewBox={`0 0 ${props.course.width} ${props.course.height}`} style={{ display: "block", width: "100%", height: 112 }} preserveAspectRatio="none">
      <rect width={props.course.width} height={props.course.height} fill="#dce8c8" />
      {props.assets.map((asset) => <g key={asset.id}><rect x={asset.x} y={asset.y} width={asset.width} height={asset.height} rx="1" fill={colors[asset.category]} stroke="#fff" strokeWidth=".5" opacity={0.92} /><title>{translateCurrent("property.map.asset", { name: asset.name, tier: asset.tier })}</title></g>)}
    </svg>
    <figcaption style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "5px 8px", fontSize: 9, background: "#f8f5ea" }}>{Object.entries(colors).map(([category, color]) => <span key={category}><i style={{ display: "inline-block", width: 7, height: 7, background: color, marginRight: 3 }} />{category}</span>)}</figcaption>
  </figure>;
}

function LedgerView(props: { summary: ReturnType<typeof propertySummary>; world: World }) {
  const entries = [...props.summary.enterprise.ledger].reverse().slice(0, 60);
  const net = props.summary.recentRevenue - props.summary.recentCosts;
  return <div data-testid="property-ledger">
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 12 }}>
      <Metric label={translateCurrent("property.ledger.revenue")} value={formatCurrency(props.summary.recentRevenue)} />
      <Metric label={translateCurrent("property.ledger.costs")} value={formatCurrency(props.summary.recentCosts)} warning={props.summary.recentCosts > props.summary.recentRevenue} />
      <Metric label={translateCurrent("property.ledger.net")} value={formatCurrency(net)} warning={net < 0} />
      <Metric label={translateCurrent("property.ledger.skill")} value={`${Math.round(props.summary.averageCustomerSkill)}/100`} />
    </div>
    <h3 style={{ margin: "0 0 7px" }}>{translateCurrent("property.ledger.title")}</h3>
    {entries.length === 0 ? <p style={{ fontSize: 12, color: "#6b746b" }}>{translateCurrent("property.ledger.empty")}</p> : <div style={{ display: "grid", gap: 4 }}>{entries.map((entry) => <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "62px 92px 1fr 75px", gap: 6, fontSize: 10, padding: 6, borderRadius: 5, background: entry.cost > entry.revenue ? "#faeee9" : "#f3f7ed" }}><span>{translateCurrent("property.ledger.when", { week: entry.week, day: entry.day + 1 })}</span><b>{entry.category.replaceAll("_", " ")}</b><span>{entry.description}{entry.visitors ? ` · ${entry.visitors} guests` : ""}</span><strong style={{ textAlign: "right", color: entry.revenue - entry.cost >= 0 ? "#28603a" : "#973e35" }}>{formatCurrency(entry.revenue - entry.cost)}</strong></div>)}</div>}
    {props.summary.enterprise.incidents.length > 0 && <><h3 style={{ marginBottom: 7 }}>{translateCurrent("property.ledger.incidents")}</h3>{[...props.summary.enterprise.incidents].reverse().slice(0, 8).map((incident) => <div key={incident.id} style={{ fontSize: 11, marginBottom: 4, color: "#7b332e" }}>{translateCurrent("property.ledger.incident", { week: incident.week, description: incident.description, cost: formatCurrency(incident.cost) })}</div>)}</>}
  </div>;
}

function Metric(props: { label: string; value: string; warning?: boolean }) {
  return <div style={{ padding: "6px 7px", background: props.warning ? "#f8e2dc" : "rgba(255,255,255,.68)", border: "1px solid rgba(76,67,45,.15)", borderRadius: 7, minWidth: 0 }}><div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".07em", color: "#766d59", whiteSpace: "nowrap" }}>{props.label}</div><strong style={{ color: props.warning ? "#8a332b" : "#344338", fontSize: 12 }}>{props.value}</strong></div>;
}

const closeButton = { border: "1px solid #88754d", borderRadius: 8, background: "#fffaf0", padding: "7px 10px", cursor: "pointer", fontWeight: 900 } as const;
const tabButton = { border: "1px solid #c9c0ae", borderRadius: 7, padding: "7px 5px", background: "#fffdf8", color: "#536054", fontWeight: 800, fontSize: 11, cursor: "pointer" } as const;
const activeTabButton = { background: "#466d49", color: "white" } as const;
const smallButton = { border: "1px solid #9c927e", borderRadius: 6, padding: "5px 7px", background: "#fffaf0", color: "#3c493d", fontWeight: 800, fontSize: 10, cursor: "pointer" } as const;
const compactLabel = { fontSize: 10, display: "flex", alignItems: "center", gap: 3 } as const;

import { useEffect, useMemo, useRef, useState } from "react";
import type { Course, Point, World } from "../game/models/types";
import { canPurchaseParcel } from "../game/estate/estate";
import { formatCurrency, formatNumber } from "../i18n/format";
import { useI18n } from "../i18n/useI18n";
import type { MessageKey } from "../i18n/catalog";

export function LandOfficePanel(props: {
  course: Course;
  world: World;
  selectedParcelId: string | null;
  onSelect: (parcelId: string) => void;
  onCenter: (point: Point) => void;
  onPurchase: (parcelId: string) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const estate = props.course.estate;
  const [confirming, setConfirming] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const selected = useMemo(() => estate?.parcels.find((parcel) => parcel.id === props.selectedParcelId) ?? estate?.parcels[0], [estate, props.selectedParcelId]);
  const purchase = selected ? canPurchaseParcel(props.course, props.world.cash, selected.id) : { ok: false as const, reason: "missing" as const };
  useEffect(() => { closeRef.current?.focus(); }, []);
  if (!estate || !selected) return null;
  const owned = estate.ownedParcelIds.includes(selected.id);
  const parcelName = (id: string, fallback: string) => t(`land.parcel.${id}` as MessageKey) || fallback;
  const reason = purchase.ok ? null : purchase.reason === "owned" ? t("land.owned") : purchase.reason === "non-adjacent" ? t("land.nonAdjacent") : purchase.reason === "unaffordable" ? t("land.unaffordable") : t("land.unavailable");
  const item = (label: string, value: number) => <li style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>{label}</span><strong>{value < 0 ? `−${formatCurrency(Math.abs(value), locale)}` : formatCurrency(value, locale)}</strong></li>;
  return (
    <section role="dialog" aria-modal="false" aria-labelledby="land-office-title" data-testid="land-office" style={{ position: "absolute", top: 54, left: 10, zIndex: 185, width: "min(470px, calc(100% - 20px))", maxHeight: "calc(100% - 126px)", overflow: "auto", borderRadius: 14, border: "2px solid #8a6826", background: "#fbf4df", color: "#253126", boxShadow: "0 14px 38px rgba(0,0,0,.36)" }}>
      <header style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#334f38", color: "#fff8dc", borderBottom: "2px solid #c39a43" }}>
        <div><small style={{ opacity: .75 }}>{t("land.eyebrow")}</small><h2 id="land-office-title" style={{ margin: 0, fontSize: 20 }}>{t("land.title")}</h2></div>
        <button ref={closeRef} aria-label={t("land.close")} onClick={props.onClose} style={{ border: "1px solid rgba(255,255,255,.35)", borderRadius: 7, background: "rgba(255,255,255,.1)", color: "white", padding: "6px 9px" }}>✕</button>
      </header>
      <div style={{ padding: 14, display: "grid", gridTemplateColumns: "minmax(140px,.8fr) minmax(0,1.2fr)", gap: 14 }}>
        <nav aria-label={t("land.parcels")} style={{ display: "grid", alignContent: "start", gap: 5 }}>
          {estate.parcels.map((parcel) => {
            const isOwned = estate.ownedParcelIds.includes(parcel.id);
            const adjacent = parcel.adjacentParcelIds.some((id) => estate.ownedParcelIds.includes(id));
            return <button key={parcel.id} data-testid={`parcel-${parcel.id}`} aria-pressed={parcel.id === selected.id} onClick={() => { setConfirming(false); props.onSelect(parcel.id); }} style={{ textAlign: "left", padding: "8px 9px", borderRadius: 7, border: parcel.id === selected.id ? "2px solid #8a6826" : "1px solid #b7a77f", background: parcel.id === selected.id ? "#fff8df" : "#f5ecd1" }}><strong>{parcelName(parcel.id, parcel.name)}</strong><br /><small>{isOwned ? t("land.owned") : adjacent ? formatCurrency(parcel.appraisal.total, locale) : t("land.locked")}</small></button>;
          })}
        </nav>
        <article aria-live="polite" style={{ minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}><div><h3 style={{ margin: 0 }}>{parcelName(selected.id, selected.name)}</h3><small>{t("land.acres", { acres: formatNumber(selected.acreage, locale) })}</small></div><button onClick={() => props.onCenter(selected.center)}>{t("land.center")}</button></div>
          <p>{selected.traits.map((trait) => t(`land.trait.${trait}` as MessageKey)).join(" · ")}</p>
          <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 10px", fontSize: 12 }}>
            <dt>{t("land.developable")}</dt><dd style={{ margin: 0 }}>{selected.developablePercent}%</dd>
            <dt>{t("land.water")}</dt><dd style={{ margin: 0 }}>{selected.waterPercent}%</dd>
            <dt>{t("land.elevation")}</dt><dd style={{ margin: 0 }}>{selected.elevationRange}</dd>
            <dt>{t("land.scenery")}</dt><dd style={{ margin: 0 }}>{selected.sceneryScore}/100</dd>
            <dt>{t("land.road")}</dt><dd style={{ margin: 0 }}>{selected.publicRoadAccess ? t("land.yes") : t("land.no")}</dd>
          </dl>
          <h4 style={{ marginBottom: 5 }}>{t("land.appraisal")}</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 3, fontSize: 12 }}>
            {item(t("land.value.land"), selected.appraisal.landValue)}
            {item(t("land.value.developable"), selected.appraisal.developableValue)}
            {item(t("land.value.road"), selected.appraisal.roadAccessValue)}
            {item(t("land.value.scenery"), selected.appraisal.sceneryValue)}
            {item(t("land.value.water"), selected.appraisal.waterValue)}
            {item(t("land.value.elevation"), selected.appraisal.elevationValue)}
            {item(t("land.value.pressure"), selected.appraisal.pressureValue)}
          </ul>
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #9e8a60", marginTop: 7, paddingTop: 7 }}><strong>{t("land.total")}</strong><strong>{formatCurrency(selected.appraisal.total, locale)}</strong></div>
          {reason && <p role="status" style={{ padding: 8, borderRadius: 6, background: owned ? "#e4efe1" : "#f3dfd5" }}>{reason}</p>}
          {!owned && <button data-testid="purchase-parcel" disabled={!purchase.ok} onClick={() => confirming ? props.onPurchase(selected.id) : setConfirming(true)} style={{ width: "100%", marginTop: 8, padding: 10, fontWeight: 800 }}>{confirming ? t("land.confirmPurchase", { amount: formatCurrency(selected.appraisal.total, locale) }) : t("land.purchase")}</button>}
        </article>
      </div>
    </section>
  );
}

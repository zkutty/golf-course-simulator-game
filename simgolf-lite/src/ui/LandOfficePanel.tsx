import { useEffect, useMemo, useRef, useState } from "react";
import { IconUi } from "../assets/icons";
import type { Course, Point, World } from "../game/models/types";
import { canPurchaseParcel } from "../game/estate/estate";
import { formatCurrency, formatNumber } from "../i18n/format";
import { useI18n } from "../i18n/useI18n";
import type { MessageKey } from "../i18n/catalog";
import "./landOfficePanel.css";

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
  const selected = useMemo(
    () => estate?.parcels.find((parcel) => parcel.id === props.selectedParcelId)
      ?? estate?.parcels[0],
    [estate, props.selectedParcelId],
  );
  const purchase = selected
    ? canPurchaseParcel(props.course, props.world.cash, selected.id)
    : { ok: false as const, reason: "missing" as const };

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  if (!estate || !selected) return null;
  const owned = estate.ownedParcelIds.includes(selected.id);
  const parcelName = (id: string, fallback: string) =>
    t(`land.parcel.${id}` as MessageKey) || fallback;
  const reason = purchase.ok
    ? null
    : purchase.reason === "owned"
      ? t("land.owned")
      : purchase.reason === "non-adjacent"
        ? t("land.nonAdjacent")
        : purchase.reason === "unaffordable"
          ? t("land.unaffordable")
          : t("land.unavailable");
  const item = (label: string, value: number) => (
    <li className="cc-land-office__value-row">
      <span>{label}</span>
      <strong>
        {value < 0
          ? `−${formatCurrency(Math.abs(value), locale)}`
          : formatCurrency(value, locale)}
      </strong>
    </li>
  );

  return (
    <section
      className="cc-land-office"
      role="dialog"
      aria-modal="false"
      aria-labelledby="land-office-title"
      data-testid="land-office"
    >
      <header className="cc-land-office__header">
        <div className="cc-land-office__identity">
          <small>{t("land.eyebrow")}</small>
          <h2 id="land-office-title">{t("land.title")}</h2>
        </div>
        <button
          ref={closeRef}
          className="cc-land-office__close"
          type="button"
          aria-label={t("land.close")}
          onClick={props.onClose}
        >
          <IconUi name="close" />
        </button>
      </header>

      <div className="cc-land-office__body">
        <nav className="cc-land-office__parcels" aria-label={t("land.parcels")}>
          {estate.parcels.map((parcel) => {
            const isOwned = estate.ownedParcelIds.includes(parcel.id);
            const adjacent = parcel.adjacentParcelIds.some((id) =>
              estate.ownedParcelIds.includes(id)
            );
            return (
              <button
                key={parcel.id}
                type="button"
                className="cc-land-office__parcel"
                data-testid={`parcel-${parcel.id}`}
                aria-pressed={parcel.id === selected.id}
                onClick={() => {
                  setConfirming(false);
                  props.onSelect(parcel.id);
                }}
              >
                <strong>{parcelName(parcel.id, parcel.name)}</strong>
                <span className="cc-land-office__parcel-status">
                  {isOwned ? (
                    <>
                      <IconUi name="completed" size={15} />
                      <span>{t("land.owned")}</span>
                    </>
                  ) : adjacent ? (
                    <span>{formatCurrency(parcel.appraisal.total, locale)}</span>
                  ) : (
                    <>
                      <IconUi name="locked" size={15} />
                      <span>{t("land.locked")}</span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </nav>

        <article className="cc-land-office__details" aria-live="polite">
          <div className="cc-land-office__parcel-heading">
            <div className="cc-land-office__parcel-identity">
              <h3>{parcelName(selected.id, selected.name)}</h3>
              <small>{t("land.acres", { acres: formatNumber(selected.acreage, locale) })}</small>
            </div>
            <button
              className="cc-land-office__center"
              type="button"
              onClick={() => props.onCenter(selected.center)}
            >
              {t("land.center")}
            </button>
          </div>

          <p className="cc-land-office__traits">
            {selected.traits.map((trait) => t(`land.trait.${trait}` as MessageKey)).join(" · ")}
          </p>
          <dl className="cc-land-office__metrics">
            <dt>{t("land.developable")}</dt><dd>{selected.developablePercent}%</dd>
            <dt>{t("land.water")}</dt><dd>{selected.waterPercent}%</dd>
            <dt>{t("land.elevation")}</dt><dd>{selected.elevationRange}</dd>
            <dt>{t("land.scenery")}</dt><dd>{selected.sceneryScore}/100</dd>
            <dt>{t("land.road")}</dt><dd>{selected.publicRoadAccess ? t("land.yes") : t("land.no")}</dd>
          </dl>

          <h4 className="cc-land-office__appraisal-title">{t("land.appraisal")}</h4>
          <ul className="cc-land-office__appraisal">
            {item(t("land.value.land"), selected.appraisal.landValue)}
            {item(t("land.value.developable"), selected.appraisal.developableValue)}
            {item(t("land.value.road"), selected.appraisal.roadAccessValue)}
            {item(t("land.value.scenery"), selected.appraisal.sceneryValue)}
            {item(t("land.value.water"), selected.appraisal.waterValue)}
            {item(t("land.value.elevation"), selected.appraisal.elevationValue)}
            {item(t("land.value.pressure"), selected.appraisal.pressureValue)}
          </ul>
          <div className="cc-land-office__total">
            <strong>{t("land.total")}</strong>
            <strong>{formatCurrency(selected.appraisal.total, locale)}</strong>
          </div>

          {reason && (
            <p
              className={`cc-land-office__status${owned ? " is-owned" : ""}`}
              role="status"
            >
              {reason}
            </p>
          )}
          {!owned && (
            <button
              className="cc-land-office__purchase"
              data-testid="purchase-parcel"
              type="button"
              disabled={!purchase.ok}
              onClick={() => confirming
                ? props.onPurchase(selected.id)
                : setConfirming(true)}
            >
              {confirming
                ? t("land.confirmPurchase", {
                  amount: formatCurrency(selected.appraisal.total, locale),
                })
                : t("land.purchase")}
            </button>
          )}
        </article>
      </div>
    </section>
  );
}

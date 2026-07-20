import { useEffect, useMemo, useState } from "react";
import { retentionFeed, subscribeRetentionEvents } from "../../game/retention/eventBus";
import type { RetentionEvent, RetentionEventCategory } from "../../game/retention/types";
import { useI18n } from "../../i18n/useI18n";

export function NewsTicker(props: { visible: boolean; onJump: (event: RetentionEvent) => void; onHide: () => void }) {
  const { t } = useI18n();
  const [feed, setFeed] = useState(() => retentionFeed());
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<RetentionEventCategory | "all">("all");
  useEffect(() => subscribeRetentionEvents(() => setFeed(retentionFeed())), []);
  const items = useMemo(() => feed.filter((event) => filter === "all" || event.category === filter), [feed, filter]);
  if (!props.visible) return null;
  const current = feed[0];
  return <div className="cc-news" style={{ position: "fixed", left: 18, right: 18, bottom: 14, zIndex: 1000, pointerEvents: "auto" }}>
    <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto auto", gap: 8, alignItems: "center", background: "rgba(35,48,39,.96)", color: "white", border: "2px solid #c0a060", borderRadius: 10, padding: "7px 10px", boxShadow: "0 8px 24px rgba(0,0,0,.25)" }}><strong>📰</strong><button onClick={() => current && props.onJump(current)} disabled={!current} style={{ color: "inherit", background: "transparent", border: 0, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current ? `${current.message}${current.count && current.count > 1 ? ` ×${current.count}` : ""}` : t("retention.noNews")}</button><button onClick={() => setOpen((value) => !value)} aria-expanded={open}>{t("retention.feed")}</button><button aria-label={t("retention.hideTicker")} onClick={props.onHide}>✕</button></div>
    {open && <section style={{ position: "absolute", right: 0, bottom: 48, width: "min(520px,100%)", maxHeight: "55vh", overflow: "auto", background: "#f7f0df", border: "2px solid #8d806c", borderRadius: 12, padding: 12, color: "#26362d" }}><div style={{ display: "flex", gap: 6, marginBottom: 10 }}>{(["all", "play", "economy", "milestone"] as const).map((item) => <button key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}>{t(`retention.filter.${item}`)}</button>)}</div>{items.map((event) => <button key={event.id} onClick={() => props.onJump(event)} style={{ width: "100%", textAlign: "left", display: "grid", gridTemplateColumns: "74px 1fr", gap: 8, border: 0, borderTop: "1px solid #c9bea9", padding: 9, background: event.severity === "major" ? "#fff3c4" : "transparent" }}><small>{t("retention.weekDay", { week: event.week, day: event.day + 1 })}</small><span>{event.message}</span></button>)}</section>}
  </div>;
}

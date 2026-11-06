import "./retentionControls.css";
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
  return <div className="cc-news">
    <div><strong>📰</strong><button onClick={() => current && props.onJump(current)} disabled={!current}>{current ? `${current.message}${current.count && current.count > 1 ? ` ×${current.count}` : ""}` : t("retention.noNews")}</button><button onClick={() => setOpen((value) => !value)} aria-expanded={open}>{t("retention.feed")}</button><button aria-label={t("retention.hideTicker")} onClick={props.onHide}>✕</button></div>
    {open && <section><div>{(["all", "play", "economy", "milestone"] as const).map((item) => <button key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}>{t(`retention.filter.${item}`)}</button>)}</div>{items.map((event) => <button key={event.id} onClick={() => props.onJump(event)} style={{ background: event.severity === "major" ? "#fff3c4" : "transparent" }}><small>{t("retention.weekDay", { week: event.week, day: event.day + 1 })}</small><span>{event.message}</span></button>)}</section>}
  </div>;
}

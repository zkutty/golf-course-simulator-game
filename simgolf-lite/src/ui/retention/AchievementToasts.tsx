import type { AchievementDefinition } from "../../game/retention/achievements";
import { useI18n } from "../../i18n/useI18n";

export function AchievementToasts(props: { queue: AchievementDefinition[]; onDismiss: () => void }) {
  const { t } = useI18n();
  const current = props.queue[0];
  if (!current) return null;
  return <aside role="status" aria-live="polite" data-testid="achievement-toast" onClick={props.onDismiss} style={{ position: "fixed", right: 18, top: 18, zIndex: 100030, width: "min(360px,calc(100vw - 36px))", display: "grid", gridTemplateColumns: "54px 1fr", gap: 12, padding: 14, borderRadius: 14, border: "2px solid #c99a32", background: "linear-gradient(145deg,#fff8d8,#e8cb72)", boxShadow: "0 14px 38px rgba(0,0,0,.32)", pointerEvents: "auto", cursor: "pointer" }}><div style={{ fontSize: 38 }}>{current.icon}</div><div><small style={{ fontWeight: 900, textTransform: "uppercase" }}>{t("retention.unlocked")}</small><div style={{ fontSize: 18, fontWeight: 900 }}>{current.title}</div><div style={{ fontSize: 12 }}>{props.queue.length > 1 ? t("retention.toastQueued", { count: props.queue.length - 1 }) : current.hint}</div></div></aside>;
}

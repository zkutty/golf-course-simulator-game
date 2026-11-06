import "./retentionControls.css";
import { useI18n } from "../../i18n/useI18n";

export function PhotoModeOverlay(props: { showGolfers: boolean; showMarkers: boolean; onToggleGolfers: () => void; onToggleMarkers: () => void; onCapture: () => void; onCard: () => void; onShare: () => void; onExit: () => void }) {
  const { t } = useI18n();
  return <div data-testid="photo-mode"><div><button onClick={props.onCapture}>📷 {t("photo.capture")}</button><button onClick={props.onCard}>🖼️ {t("photo.courseCard")}</button><button onClick={props.onShare}>↗ {t("photo.share")}</button><button aria-pressed={props.showGolfers} onClick={props.onToggleGolfers}>{t("photo.golfers")}</button><button aria-pressed={props.showMarkers} onClick={props.onToggleMarkers}>{t("photo.markers")}</button><button onClick={props.onExit}>✕ {t("photo.exit")}</button></div></div>;
}

import { useFocusTrap } from "../accessibility/useFocusTrap";
import { useI18n } from "../../i18n/useI18n";

interface PauseOverlayProps {
  career: boolean;
  dirty: boolean;
  onResume: () => void;
  onSave: () => void;
  onLoad: () => void;
  onOptions: () => void;
  onRestart: () => void;
  onQuit: () => void;
}
export function PauseOverlay(props: PauseOverlayProps) {
  const button: React.CSSProperties = { width: "100%", padding: "11px 14px", borderRadius: 9, border: "1px solid #687266", background: "#fffaf0", color: "#344338", font: "inherit", fontWeight: 800, cursor: "pointer", textAlign: "left" };
  const trapRef = useFocusTrap<HTMLElement>(true, props.onResume);
  const { t } = useI18n();
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="pause-title" data-testid="pause-overlay" style={{ position: "fixed", inset: 0, zIndex: 99950, display: "grid", placeItems: "center", padding: 20, background: "rgba(16,24,18,.68)" }}>
      <section ref={trapRef} style={{ width: "min(390px, 100%)", padding: 24, borderRadius: 18, border: "2px solid #a9987f", background: "#f7f0df", boxShadow: "0 24px 64px rgba(0,0,0,.42)" }}>
        <div id="pause-title" style={{ fontFamily: "var(--font-heading)", fontSize: 30, fontWeight: 900, color: "#344338" }}>{t("pause.title")}</div>
        <div style={{ margin: "3px 0 18px", color: "#6b755f", fontSize: 13 }}>{props.dirty ? t("pause.unsaved") : t("pause.saved")}</div>
        <div style={{ display: "grid", gap: 9 }}>
          <button autoFocus style={{ ...button, background: "#3d6b3d", color: "white" }} onClick={props.onResume}>{t("pause.resume")}</button>
          <button style={button} onClick={props.onSave}>{t("pause.save")}</button>
          <button style={button} onClick={props.onLoad}>{t("pause.load")}</button>
          <button style={button} onClick={props.onOptions}>{t("pause.options")}</button>
          {props.career && <button style={button} onClick={props.onRestart}>{t("pause.restart")}</button>}
          <button style={{ ...button, color: "#8a3131" }} onClick={props.onQuit}>{t("pause.quit")}</button>
        </div>
        <div style={{ marginTop: 14, color: "#72776b", fontSize: 11, textAlign: "center" }}>{t("pause.hint")}</div>
      </section>
    </div>
  );
}

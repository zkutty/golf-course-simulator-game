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
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="pause-title" data-testid="pause-overlay" style={{ position: "fixed", inset: 0, zIndex: 99950, display: "grid", placeItems: "center", padding: 20, background: "rgba(16,24,18,.68)" }}>
      <section style={{ width: "min(390px, 100%)", padding: 24, borderRadius: 18, border: "2px solid #a9987f", background: "#f7f0df", boxShadow: "0 24px 64px rgba(0,0,0,.42)" }}>
        <div id="pause-title" style={{ fontFamily: "var(--font-heading)", fontSize: 30, fontWeight: 900, color: "#344338" }}>Game paused</div>
        <div style={{ margin: "3px 0 18px", color: "#6b755f", fontSize: 13 }}>{props.dirty ? "Unsaved course changes" : "All progress saved"}</div>
        <div style={{ display: "grid", gap: 9 }}>
          <button autoFocus style={{ ...button, background: "#3d6b3d", color: "white" }} onClick={props.onResume}>▶ Resume</button>
          <button style={button} onClick={props.onSave}>💾 Save game</button>
          <button style={button} onClick={props.onLoad}>📁 Load game</button>
          <button style={button} onClick={props.onOptions}>⚙ Options</button>
          {props.career && <button style={button} onClick={props.onRestart}>↻ Restart scenario</button>}
          <button style={{ ...button, color: "#8a3131" }} onClick={props.onQuit}>⌂ Quit to title</button>
        </div>
        <div style={{ marginTop: 14, color: "#72776b", fontSize: 11, textAlign: "center" }}>Esc resumes • Space toggles the game clock</div>
      </section>
    </div>
  );
}

import { useState } from "react";
import {
  BINDING_ACTIONS,
  BINDING_LABEL_KEYS,
  DEFAULT_KEYBINDINGS,
  bindingFromEvent,
  displayBinding,
  findBindingConflict,
  type BindingAction,
  type Keybindings,
} from "../../accessibility/keybindings";
import { GameButton } from "../gameui";
import { useFocusTrap } from "./useFocusTrap";
import { T } from "../../i18n/T";
import { useI18n } from "../../i18n/useI18n";

export function KeybindingsPanel(props: { bindings: Keybindings; onChange: (bindings: Keybindings) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [listening, setListening] = useState<BindingAction | null>(null);
  const [error, setError] = useState("");
  const trapRef = useFocusTrap<HTMLDivElement>(true, () => {
    if (listening) {
      setListening(null);
      setError("");
    } else props.onClose();
  });

  const capture = (event: React.KeyboardEvent, action: BindingAction) => {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    if (event.code === "Escape") {
      setListening(null);
      return;
    }
    const binding = bindingFromEvent(event.nativeEvent);
    const conflict = findBindingConflict(props.bindings, action, binding);
    if (conflict) {
      setError(t("binding.conflict", { binding: displayBinding(binding), action: t(BINDING_LABEL_KEYS[conflict]) }));
      return;
    }
    props.onChange({ ...props.bindings, [action]: binding });
    setError("");
    setListening(null);
  };

  return (
    <div role="presentation" onClick={(event) => event.stopPropagation()} style={{ position: "fixed", inset: 0, zIndex: 100020, background: "rgba(15,24,18,.72)", display: "grid", placeItems: "center", padding: 16 }}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="keybindings-title" data-testid="keybindings-panel" style={{ width: "min(620px,100%)", maxHeight: "88vh", overflow: "auto", borderRadius: 18, border: "2px solid #8d806c", background: "#f7f0df", padding: 20 }}>
        <h2 id="keybindings-title" style={{ marginTop: 0 }}><T id="auto.ui.accessibility.keybindingspanel.keyboard.controls" /></h2>
        <p style={{ color: "#687266" }}><T id="auto.ui.accessibility.keybindingspanel.choose.an.action.then.press.the.replacement.key.or.cho" /></p>
        <div style={{ display: "grid", gap: 6 }}>
          {BINDING_ACTIONS.map((action) => (
            <div key={action} style={{ display: "grid", gridTemplateColumns: "1fr minmax(130px,auto)", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(61,74,62,.14)" }}>
              <span>{t(BINDING_LABEL_KEYS[action])}</span>
              <button
                type="button"
                aria-label={t("binding.rebind", { action: t(BINDING_LABEL_KEYS[action]) })}
                onClick={() => { setListening(action); setError(""); }}
                onKeyDown={(event) => listening === action && capture(event, action)}
                style={{ border: listening === action ? "2px solid #b7602a" : "1px solid #8d806c", borderRadius: 8, padding: "8px 12px", background: "#fffdf6", fontWeight: 800 }}
              >
                {listening === action ? t("binding.pressKey") : displayBinding(props.bindings[action])}
              </button>
            </div>
          ))}
        </div>
        <div role="alert" aria-live="assertive" style={{ minHeight: 24, color: "#9d2d20", marginTop: 10 }}>{error}</div>
        <footer style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
          <GameButton type="button" variant="secondary" onClick={() => {
            if (window.confirm(t("binding.resetConfirm"))) props.onChange({ ...DEFAULT_KEYBINDINGS });
          }}><T id="auto.ui.accessibility.keybindingspanel.reset.bindings" /></GameButton>
          <GameButton type="button" onClick={props.onClose}><T id="auto.ui.accessibility.keybindingspanel.done" /></GameButton>
        </footer>
      </div>
    </div>
  );
}

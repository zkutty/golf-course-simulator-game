import { useEffect } from "react";
import { AdvisorPresenter } from "./AdvisorPresenter";
import { presenterButtonStyle } from "./presenterStyles";
import { T } from "../../i18n/T";
import { translateCurrent } from "../../i18n/core";

export function TutorialOffer(props: { onAccept: () => void; onSkip: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      props.onSkip();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [props]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={translateCurrent("tutorial.offer.label")}
      data-rich-tooltip
      style={{ position: "fixed", inset: 0, zIndex: 100010, display: "grid", placeItems: "center", padding: 20, background: "rgba(18,25,18,.72)" }}
    >
      <AdvisorPresenter
        eyebrow={translateCurrent("tutorial.offer.eyebrow")}
        title={translateCurrent("tutorial.offer.title")}
        body={translateCurrent("tutorial.offer.body")}
        expression="pleased"
        actions={
          <>
            <button onClick={props.onSkip} style={{ ...presenterButtonStyle, background: "transparent", color: "#465349", borderColor: "rgba(39,54,43,.35)" }}>
              <T id="tutorial.offer.skip" /></button>
            <button autoFocus onClick={props.onAccept} style={presenterButtonStyle}>
              <T id="tutorial.offer.start" /></button>
          </>
        }
      />
    </div>
  );
}

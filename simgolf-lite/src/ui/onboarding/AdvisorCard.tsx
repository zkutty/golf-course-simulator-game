import type { AdvisorMessage } from "../../game/advisor/advisor";
import { AdvisorPresenter } from "./AdvisorPresenter";
import { presenterButtonStyle } from "./presenterStyles";
import { T } from "../../i18n/T";

export function AdvisorCard(props: { message: AdvisorMessage; onDismiss: () => void; onShowHole?: (holeIndex: number) => void }) {
  return (
    <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 9000, animation: "cc-advisor-in .28s ease-out" }}>
      <AdvisorPresenter
        compact
        eyebrow={props.message.priority === "warning" ? "Caddie warning" : props.message.priority === "celebration" ? "Caddie celebration" : "A word from your caddie"}
        title={props.message.title}
        body={props.message.body}
        expression={props.message.expression}
        actions={
          <>
            {props.message.holeIndex != null && props.onShowHole && (
              <button style={presenterButtonStyle} onClick={() => props.onShowHole?.(props.message.holeIndex!)}><T id="auto.ui.onboarding.advisorcard.show.me" /></button>
            )}
            <button style={{ ...presenterButtonStyle, background: "transparent", color: "#465349" }} onClick={props.onDismiss}><T id="auto.ui.onboarding.advisorcard.got.it" /></button>
          </>
        }
      />
    </div>
  );
}

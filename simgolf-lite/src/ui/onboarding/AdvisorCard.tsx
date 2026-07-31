import type { AdvisorMessage } from "../../game/advisor/advisor";
import { AdvisorPresenter } from "./AdvisorPresenter";
import { presenterButtonStyle } from "./presenterStyles";
import { T } from "../../i18n/T";
import {
  biomeContextAttributes,
  type BiomeUiTheme,
} from "../biomeUiTheme";

export function AdvisorCard(props: { message: AdvisorMessage; onDismiss: () => void; onShowHole?: (holeIndex: number) => void; biomeContext?: BiomeUiTheme }) {
  return (
    <div
      data-testid="advisor-card"
      data-priority={props.message.priority}
      {...(props.biomeContext
        ? biomeContextAttributes(
          props.biomeContext,
          "notification",
          props.message.priority === "warning"
            ? "warning"
            : props.message.priority === "celebration"
              ? "positive"
              : "advisory",
        )
        : {})}
      style={{ position: "fixed", right: 18, bottom: 68, zIndex: 9000, animation: "cc-advisor-in .28s ease-out" }}
    >
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

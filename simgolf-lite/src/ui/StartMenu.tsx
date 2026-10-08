import { useId, useMemo, type ReactNode } from "react";
import { StartMenuBackground } from "./StartMenuBackground";
import { useI18n } from "../i18n/useI18n";
import { T } from "../i18n/T";
import { IS_DEMO } from "../config/edition";
import "./StartMenu.css";

export interface StartMenuProps {
  canLoad: boolean;
  onNewGame: () => void;
  onQuickStart: () => void;
  onOpeningDemo?: () => void;
  onLoadGame: () => void;
  onContinue: () => void;
  onOptions: () => void;
  onAchievements: () => void;
  onVision: () => void;
  canInstall?: boolean;
  onInstall?: () => void;
  onButtonClick?: () => void;
}

function StartAction({ children, hint, onClick, disabled, emphasis = "standard" }: {
  children: ReactNode;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  emphasis?: "primary" | "standard" | "utility";
}) {
  const hintId = useId();
  return (
    <div className={`cc-start-action cc-start-action-${emphasis}`}>
      <button disabled={disabled} onClick={onClick} aria-describedby={hint ? hintId : undefined}>
        <span>{children}</span>
        <span className="cc-start-action-arrow" aria-hidden="true">↗</span>
      </button>
      {hint && <p id={hintId}>{hint}</p>}
    </div>
  );
}

export function StartMenu(props: StartMenuProps) {
  const { t } = useI18n();
  const loadSubtitle = useMemo(() => (props.canLoad ? undefined : t("title.noSave")), [props.canLoad, t]);

  return (
    <main className="cc-start-menu" data-testid="start-menu" data-has-save={props.canLoad}>
      <div className="cc-start-shell">
        <section className="cc-start-identity" aria-labelledby="cc-start-title">
          <div className="cc-start-landscape" aria-hidden="true"><StartMenuBackground /></div>
          <div className="cc-start-heading">
            <p className="cc-start-kicker">{t("title.footer")}</p>
            <h1 id="cc-start-title">{t("app.name")}</h1>
            <p className="cc-start-tagline">{t("title.tagline")}</p>
            {IS_DEMO && <span className="cc-start-demo">{t("demo.badge")}</span>}
          </div>
          <div className="cc-start-vision">
            <StartAction hint={t("title.visionHint")} onClick={() => {
              props.onButtonClick?.();
              props.onVision();
            }}>{t("title.vision")}</StartAction>
          </div>
        </section>

        <div className="cc-start-ledger">
          <div className="cc-start-play-actions">
            {props.canLoad && (
              <StartAction emphasis="primary" hint={t("title.continueHint")} onClick={() => {
                props.onButtonClick?.();
                props.onContinue();
              }}>{t("title.continue")}</StartAction>
            )}
            <StartAction emphasis={props.canLoad ? "standard" : "primary"} onClick={() => {
              props.onButtonClick?.();
              props.onNewGame();
            }}>{t("title.newGame")}</StartAction>
            <StartAction hint={t("title.quickStartHint")} onClick={() => {
              props.onButtonClick?.();
              props.onQuickStart();
            }}>{t("title.quickStart")}</StartAction>
          </div>

          <div className="cc-start-utilities">
            {props.onOpeningDemo && <StartAction emphasis="utility" hint={t("opening.entryHint")} onClick={props.onOpeningDemo}>{t("opening.entry")}</StartAction>}
            <StartAction emphasis="utility" hint={loadSubtitle} disabled={!props.canLoad} onClick={() => {
              if (props.canLoad) props.onButtonClick?.();
              props.onLoadGame();
            }}>{t("title.load")}</StartAction>
            <StartAction emphasis="utility" onClick={() => {
              props.onButtonClick?.();
              props.onOptions();
            }}>{t("title.options")}</StartAction>
            <StartAction emphasis="utility" onClick={props.onAchievements}>{t("title.achievements")}</StartAction>
            {props.canInstall && <StartAction emphasis="utility" onClick={props.onInstall}>{t("title.install")}</StartAction>}
          </div>
          <footer className="cc-start-version"><T id="auto.ui.startmenu.v" />{__APP_VERSION__}</footer>
        </div>
      </div>
    </main>
  );
}

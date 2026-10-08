import { createRoot } from "react-dom/client";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { StartMenu } from "../src/ui/StartMenu";
import "../src/index.css";

const root = createRoot(document.getElementById("start-menu-fixture")!);
export const calls: string[] = [];
export function mountStartMenu(canLoad: boolean, optionalActions: boolean) {
  calls.length = 0;
  const record = (name: string) => () => { calls.push(name); };
  root.render(<I18nProvider><StartMenu
    canLoad={canLoad}
    onNewGame={record("new")}
    onQuickStart={record("quick")}
    onOpeningDemo={optionalActions ? record("demo") : undefined}
    onLoadGame={record("load")}
    onContinue={record("continue")}
    onOptions={record("options")}
    onAchievements={record("achievements")}
    onVision={record("vision")}
    canInstall={optionalActions}
    onInstall={optionalActions ? record("install") : undefined}
    onButtonClick={record("audio")}
  /></I18nProvider>);
}

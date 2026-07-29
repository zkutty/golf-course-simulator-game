import { useState } from "react";
import { IconUi, type UiIconName } from "../assets/icons";
import { useI18n } from "../i18n/useI18n";

export type WorkspaceId = "design" | "operate" | "legacy";

export type WorkspaceActionId =
  | "architecture"
  | "courses"
  | "land"
  | "player"
  | "tournaments"
  | "property"
  | "people"
  | "seasons"
  | "campaign"
  | "progression"
  | "records"
  | "content"
  | "photo";

const ACTION_WORKSPACE: Record<WorkspaceActionId, WorkspaceId> = {
  architecture: "design",
  courses: "design",
  land: "design",
  player: "operate",
  tournaments: "operate",
  property: "operate",
  people: "legacy",
  seasons: "legacy",
  campaign: "legacy",
  progression: "legacy",
  records: "legacy",
  content: "legacy",
  photo: "legacy",
};

const ACTION_TEST_ID: Partial<Record<WorkspaceActionId, string>> = {
  architecture: "open-architecture-review",
  courses: "open-course-manager",
  land: "open-land-office",
  player: "open-player-pro",
  tournaments: "open-tournaments",
  property: "open-property-management",
  people: "open-living-club",
  seasons: "open-seasons-legacy",
  campaign: "open-campaign",
  progression: "open-progression",
};

export function WorkspaceNav(props: {
  workspace: WorkspaceId;
  onWorkspace: (workspace: WorkspaceId) => void;
  onInspect?: () => void;
  inspectorOpen?: boolean;
  active: Partial<Record<WorkspaceActionId, boolean>>;
  alerts?: Partial<Record<WorkspaceActionId, boolean>>;
  disabled?: Partial<Record<WorkspaceActionId, boolean>>;
  onAction: (action: WorkspaceActionId) => void;
}) {
  const { t } = useI18n();
  const [advanced, setAdvanced] = useState(false);
  const actions = (Object.keys(ACTION_WORKSPACE) as WorkspaceActionId[]).filter((id) => ACTION_WORKSPACE[id] === props.workspace);
  return (
    <nav className="cc-workspace-nav" aria-label={t("workspace.nav")}>
      <div className="cc-workspace-tabs">
        {(["design", "operate", "legacy"] as WorkspaceId[]).map((id) => (
          <button
            key={id}
            data-testid={`workspace-${id}`}
            aria-current={props.workspace === id ? "page" : undefined}
            onClick={() => props.onWorkspace(id)}
          >
            <IconUi name={id as UiIconName} />
            <span>{t(`workspace.${id}`)}</span>
          </button>
        ))}
      </div>
      {props.onInspect && (
        <button
          className="cc-workspace-inspect"
          data-testid="open-contextual-inspector"
          aria-pressed={props.inspectorOpen === true}
          onClick={props.onInspect}
        >
          <IconUi name="inspect" />
          <span>{t("workspace.action.inspect")}</span>
        </button>
      )}
      <div className="cc-workspace-actions" aria-label={t(`workspace.${props.workspace}.actions`)}>
        {actions.slice(0, 3).map((id) => (
          <button
            key={id}
            data-testid={ACTION_TEST_ID[id] ?? `workspace-action-${id}`}
            aria-pressed={props.active[id] === true}
            disabled={props.disabled?.[id] === true}
            onClick={() => props.onAction(id)}
          >
            <IconUi name={id as UiIconName} />
            <span>{t(`workspace.action.${id}`)}</span>
            {props.alerts?.[id] && <span aria-label={t("workspace.alert")} className="cc-workspace-alert" />}
          </button>
        ))}
        {actions.length > 3 && (
          <div className="cc-workspace-more">
            <button aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>
              <span>{t("workspace.more")}</span>
            </button>
            {advanced && (
              <div role="menu">
                {actions.slice(3).map((id) => (
                  <button key={id} role="menuitem" data-testid={ACTION_TEST_ID[id] ?? `workspace-action-${id}`} onClick={() => { props.onAction(id); setAdvanced(false); }}>
                    <IconUi name={id as UiIconName} />
                    <span>{t(`workspace.action.${id}`)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

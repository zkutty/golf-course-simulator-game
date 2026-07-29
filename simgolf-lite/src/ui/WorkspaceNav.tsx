import { useState, type ReactNode } from "react";
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

const GLYPHS: Record<WorkspaceId | WorkspaceActionId, ReactNode> = {
  design: <path d="M4 19 19 4m-2-1 4 4-3 3-4-4 3-3ZM4 14v6h6" />,
  operate: <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />,
  legacy: <path d="M12 3 5 6v5c0 4.8 2.8 8 7 10 4.2-2 7-5.2 7-10V6l-7-3Zm0 4v8m-3-4h6" />,
  architecture: <path d="M4 18 12 4l8 14H4Zm4-3h8M9.5 11h5" />,
  courses: <path d="M5 20V4m0 1h10l-2 4 2 4H5m8 7c3 0 5-1 5-2s-2-2-5-2-5 1-5 2 2 2 5 2Z" />,
  land: <path d="m3 7 6-3 6 3 6-3v13l-6 3-6-3-6 3V7Zm6-3v13m6-10v13" />,
  player: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9c.6-4.2 3-6 7-6s6.4 1.8 7 6" />,
  tournaments: <path d="M8 4h8v5a4 4 0 0 1-8 0V4Zm0 2H4v2c0 3 2 5 5 5m7-7h4v2c0 3-2 5-5 5m-3 0v5m-4 2h8" />,
  property: <path d="m3 11 9-7 9 7M5 10v10h14V10M9 20v-6h6v6" />,
  people: <path d="M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6-1a3 3 0 1 0 0-6M2 21c.5-4 2.8-6 7-6s6.5 2 7 6m0-7c3.5.2 5.3 2.5 5.7 7" />,
  seasons: <path d="M12 3v18M4.5 7.5 19.5 16.5M19.5 7.5 4.5 16.5M8 4l4 3 4-3M8 20l4-3 4 3" />,
  campaign: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm3 0v16m3-11h5m-5 4h5" />,
  progression: <path d="m12 3 2.6 5.3 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3Z" />,
  records: <path d="M6 3h12v18l-6-3-6 3V3Zm3 5h6m-6 4h6" />,
  content: <path d="M4 6.5 12 3l8 3.5v11L12 21l-8-3.5v-11ZM4 6.5l8 3.5 8-3.5M12 10v11m-5-7 2 1m6-2 2-1" />,
  photo: <path d="M4 7h4l1.5-2h5L16 7h4v12H4V7Zm8 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />,
};

function Icon(props: { id: WorkspaceId | WorkspaceActionId }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {GLYPHS[props.id]}
    </svg>
  );
}

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
            <Icon id={id} />
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
          <span aria-hidden="true">⌖</span>
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
            <Icon id={id} />
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
                    <Icon id={id} />
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

import { CAMPAIGN_CHARACTER_BY_ID, CAMPAIGN_CHAPTER_BY_ID } from "../game/campaign/content";
import { campaignFacts } from "../game/campaign/campaign";
import type { Course, World } from "../game/models/types";
import type { CampaignRunState, CampaignSceneDefinition } from "../game/campaign/types";
import { useI18n } from "../i18n/useI18n";
import { systemControlLabel } from "./systemControlPresentation";
import type { MessageKey } from "../i18n/catalog";

export function CampaignSceneModal(props: {
  campaign: CampaignRunState;
  scene: CampaignSceneDefinition;
  course: Course;
  world: World;
  onChoose: (sceneId: string, choiceId: string) => void;
}) {
  const { t } = useI18n();
  const character = CAMPAIGN_CHARACTER_BY_ID.get(props.scene.speaker);
  const chapter = CAMPAIGN_CHAPTER_BY_ID.get(props.campaign.chapterId);
  const owningPhaseIndex = chapter?.phases.findIndex((candidate) =>
    candidate.introSceneId === props.scene.id || candidate.completionSceneId === props.scene.id) ?? -1;
  const displayPhaseIndex = owningPhaseIndex >= 0 ? owningPhaseIndex : props.campaign.phaseIndex;
  const phase = chapter?.phases[displayPhaseIndex];
  const showCurriculum = phase?.introSceneId === props.scene.id;
  const facts = campaignFacts(props.course, props.world);
  const experienceProfile = props.world.experienceProfile ?? "classic";
  const economicPressure = props.world.economicPressure ?? "balanced";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="campaign-scene-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100100,
        display: "grid",
        placeItems: "center",
        padding: 18,
        background: "rgba(24, 30, 25, .68)",
      }}
    >
      <section
        data-testid="campaign-scene"
        style={{
          width: "min(650px, 100%)",
          maxHeight: "min(720px, calc(100vh - 36px))",
          overflowY: "auto",
          border: "3px solid #7c5c32",
          borderRadius: 18,
          background: "linear-gradient(150deg, #fffdf6, #eee2c8)",
          boxShadow: "0 30px 90px rgba(0,0,0,.42)",
          padding: 20,
          color: "#27352c",
        }}
      >
        <header style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            aria-hidden="true"
            style={{
              width: 72,
              height: 72,
              flex: "0 0 72px",
              display: "grid",
              placeItems: "center",
              borderRadius: 16,
              border: "2px solid #a88a5d",
              background: "#cfdbc6",
              color: "#324b38",
              fontSize: 24,
              fontWeight: 900,
            }}
          >
            {character?.name.split(/\s+/).map((part) => part[0]).join("")}
          </div>
          <div>
            <small style={{ display: "block", color: "#6e624f", fontWeight: 800 }}>
              {character ? `${character.name} · ${t(character.roleKey)}` : t("campaign.scene.narrator")}
            </small>
            <h2 id="campaign-scene-title" style={{ margin: "3px 0 0", fontSize: 24 }}>
              {t(props.scene.titleKey)}
            </h2>
            {phase && (
              <small style={{ color: "#6e624f" }}>
                {t("campaign.scene.phase", { current: displayPhaseIndex + 1, total: 3, phase: t(phase.titleKey) })}
              </small>
            )}
            <small data-testid="campaign-scene-axes" style={{ display: "block", color: "#6e624f" }}>
              {t("campaign.axes.active", {
                profile: t(`newGame.experience.profile.${experienceProfile}.label` as MessageKey),
                pressure: t(`newGame.pressure.${economicPressure}.label` as MessageKey),
              })}
            </small>
          </div>
        </header>
        <p style={{ fontSize: 15, lineHeight: 1.55, margin: "18px 0" }}>{t(props.scene.bodyKey)}</p>
        {phase && showCurriculum && phase.curriculumSystems.length > 0 && (
          <p data-testid="campaign-scene-curriculum" style={{ fontSize: 13, margin: "-8px 0 16px", fontWeight: 800 }}>
            {t("campaign.curriculum.scene", { systems: phase.curriculumSystems.map(systemControlLabel).join(", ") })}
          </p>
        )}
        <div data-testid="campaign-scene-facts" aria-label={t("campaign.scene.currentFacts")} style={{ display: "flex", flexWrap: "wrap", gap: 7, margin: "0 0 16px" }}>
          <span style={{ padding: "5px 8px", borderRadius: 8, background: "#dde5d7", fontSize: 12, fontWeight: 800 }}>
            {t("campaign.fact.charter")}: {props.world.seasonal?.charter ?? props.campaign.charter}
          </span>
          {props.scene.factKeys.map((key) => (
            <span key={key} style={{ padding: "5px 8px", borderRadius: 8, background: "#dde5d7", fontSize: 12, fontWeight: 800 }}>
              {t(`campaign.fact.${key}`)}: {(key === "cash" || key === "greenFee") ? `$${facts[key].toLocaleString()}` : facts[key]}
            </span>
          ))}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {props.scene.choices.map((choice) => (
            <button
              key={choice.id}
              onClick={() => props.onChoose(props.scene.id, choice.id)}
              style={{
                padding: "12px 14px",
                textAlign: "left",
                borderRadius: 12,
                border: "2px solid #8b744e",
                background: "#fffef9",
                color: "#27352c",
              }}
            >
              <strong style={{ display: "block" }}>{t(choice.labelKey)}</strong>
              <small style={{ display: "block", marginTop: 3, color: "#625a4d" }}>{t(choice.previewKey)}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

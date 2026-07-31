import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { formatCurrency } from "../i18n/format";
import type { Difficulty, LandTheme, PlayMode, Terrain } from "../game/models/types";
import type { GameSetup } from "../game/models/setup";
import type { PlayerProAppearance, PlayerProBackground, PlayerProHandedness } from "../game/models/playerProTypes";
import { SANDBOX_STARTING_CASH } from "../game/models/setup";
import { DEFAULT_WORLD } from "../game/models/defaults";
import { COURSE_WIDTH, COURSE_HEIGHT } from "../game/models/constants";
import { generateWildLandWithObstacles } from "../game/gen/generateWildLand";
import { BIOME_KEYS, getBiomeDefinition } from "../game/models/biomes";
import { generateCourseName } from "../utils/courseNames";
import { StartMenuBackground } from "./StartMenuBackground";
import { ScenarioSelect } from "./ScenarioSelect";
import type { ScenarioDefinition } from "../game/scenarios/types";
import { T } from "../i18n/T";
import { translateCurrent } from "../i18n/core";
import type { MessageKey } from "../i18n/catalog";
import { IS_DEMO } from "../config/edition";
import { biomeContextAttributes, biomeUiStyle, biomeUiTheme } from "./biomeUiTheme";

// New-game setup wizard (ZKU-162): Mode → Land → Difficulty → Details.
// Output is a typed GameSetup consumed by the single createNewGame path.

type Step = "MODE" | "SCENARIOS" | "LAND" | "DIFFICULTY" | "DETAILS";
const STEPS: Step[] = ["MODE", "LAND", "DIFFICULTY", "DETAILS"];
const STEP_TITLE: Record<Step, string> = {
  MODE: "Choose your game",
  SCENARIOS: "Pick a scenario",
  LAND: "Pick your land",
  DIFFICULTY: "How hard should it be?",
  DETAILS: "Name your course",
};
const BIOME_TITLE_KEYS: Record<LandTheme, MessageKey> = {
  parkland: "auto.ui.newgamewizard.parkland",
  links: "auto.ui.newgamewizard.links",
  desert: "auto.ui.newgamewizard.desert",
};

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

// Flat tile colors for the land preview thumbnails (plain rendering until
// the ZKU-158 minimap snapshot path exists). Theme tints override these.
const PREVIEW_COLORS: Record<Terrain, string> = {
  rough: "#8fbf6f",
  deep_rough: "#5c8a4e",
  fairway: "#9ed36a",
  sand: "#e8d9a0",
  waste_area: "#b69a68",
  water: "#6aaed6",
  wetland: "#62917a",
  green: "#7fd67f",
  tee: "#d0e8a8",
  path: "#c9bda4",
};

function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

function previewPalette(theme: LandTheme): Record<Terrain, string> {
  const tints = getBiomeDefinition(theme).presentation.tileTints;
  const out = { ...PREVIEW_COLORS };
  for (const [terrain, hex] of Object.entries(tints) as Array<[Terrain, number]>) {
    out[terrain] = cssColor(hex);
  }
  return out;
}

function LandPreview(props: {
  seed: number;
  theme: LandTheme;
  selected: boolean;
  onSelect: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const generated = useMemo(
    () => generateWildLandWithObstacles(COURSE_WIDTH, COURSE_HEIGHT, props.seed | 0, [], props.theme),
    [props.seed, props.theme]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const colors = previewPalette(props.theme);
    const px = 2;
    for (let y = 0; y < COURSE_HEIGHT; y++) {
      for (let x = 0; x < COURSE_WIDTH; x++) {
        ctx.fillStyle = colors[generated.tiles[y * COURSE_WIDTH + x]] ?? "#8fbf6f";
        ctx.fillRect(x * px, y * px, px, px);
      }
    }
    const propTints = getBiomeDefinition(props.theme).presentation.preview.propTints;
    const propColors = {
      tree: cssColor(propTints.tree),
      bush: cssColor(propTints.bush),
      rock: cssColor(propTints.rock),
    };
    for (const obstacle of generated.obstacles) {
      ctx.fillStyle = propColors[obstacle.type];
      const radius = obstacle.type === "tree" ? 2 : 1;
      ctx.fillRect(obstacle.x * px - radius, obstacle.y * px - radius, radius * 2 + 1, radius * 2 + 1);
    }
  }, [generated, props.theme]);

  return (
    <button
      onClick={props.onSelect}
      style={{
        padding: 4,
        borderRadius: 12,
        border: props.selected ? "3px solid #F2C14E" : "3px solid rgba(255,255,255,0.35)",
        background: "rgba(255,255,255,0.15)",
        cursor: "pointer",
        display: "grid",
        gap: 4,
      }}
      title={translateCurrent("newGame.seedTitle", { seed: props.seed })}
    >
      <canvas
        ref={canvasRef}
        width={COURSE_WIDTH * 2}
        height={COURSE_HEIGHT * 2}
        style={{ width: 220, height: 140, borderRadius: 8, display: "block" }}
      />
      <span style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}><T id="auto.ui.newgamewizard.seed" />{props.seed}</span>
    </button>
  );
}

function ChoiceCard(props: {
  title: string;
  icon: string;
  blurb: string;
  selected?: boolean;
  disabled?: boolean;
  badge?: string;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={props.onSelect}
      disabled={props.disabled}
      style={{
        textAlign: "left",
        padding: 16,
        borderRadius: 16,
        border: props.selected ? "3px solid var(--biome-accent, #F2C14E)" : "3px solid rgba(255,255,255,0.25)",
        background: props.selected ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.82)",
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.55 : 1,
        boxShadow: props.selected ? "0 10px 24px rgba(0,0,0,0.25)" : "0 4px 12px rgba(0,0,0,0.15)",
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 22 }}>{props.icon}</span>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 800, color: "#3d4a3e" }}>
          {props.title}
        </span>
        {props.badge && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
              padding: "2px 8px",
              borderRadius: 999,
              background: "rgba(0,0,0,0.08)",
              color: "#6b7280",
            }}
          >
            {props.badge}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: "#4b5563", lineHeight: 1.45 }}>{props.blurb}</div>
    </button>
  );
}

export function NewGameWizard(props: {
  onCancel: () => void;
  onStart: (setup: GameSetup) => void;
  onStartScenario: (scenario: ScenarioDefinition) => void;
}) {
  const [step, setStep] = useState<Step>(IS_DEMO ? "SCENARIOS" : "MODE");
  const [mode, setMode] = useState<PlayMode>("challenge");
  const [theme, setTheme] = useState<LandTheme>(BIOME_KEYS[0]);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [candidateSeeds, setCandidateSeeds] = useState<number[]>(() =>
    Array.from({ length: 4 }, randomSeed)
  );
  const [selectedSeedIdx, setSelectedSeedIdx] = useState(0);
  const [courseName, setCourseName] = useState(() => generateCourseName());
  const [founderName, setFounderName] = useState("");
  const [proName, setProName] = useState("");
  const [proAppearance, setProAppearance] = useState<PlayerProAppearance>("classic");
  const [proHandedness, setProHandedness] = useState<PlayerProHandedness>("right");
  const [proBackground, setProBackground] = useState<PlayerProBackground>("architect");
  const [startingCash, setStartingCash] = useState(DEFAULT_WORLD.cash);

  const seed = candidateSeeds[selectedSeedIdx] ?? candidateSeeds[0];
  const stepIdx = step === "SCENARIOS" ? 1 : STEPS.indexOf(step);
  const contextualUiTheme = biomeUiTheme(theme);

  const setup: GameSetup = {
    mode,
    courseName,
    founderName: founderName.trim() || undefined,
    seed,
    theme,
    difficulty,
    playerPro: {
      name: proName.trim() || founderName.trim() || translateCurrent("playerPro.defaultName"),
      appearance: proAppearance,
      handedness: proHandedness,
      background: proBackground,
    },
    sandboxOverrides:
      mode === "sandbox" && startingCash !== DEFAULT_WORLD.cash
        ? { startingCash }
        : undefined,
  };

  const next = () => {
    if (step === "MODE" && mode === "career") setStep("SCENARIOS");
    else setStep(STEPS[Math.min(STEPS.length - 1, stepIdx + 1)]);
  };
  const back = () => {
    if (step === "SCENARIOS") {
      if (IS_DEMO) props.onCancel();
      else setStep("MODE");
    }
    else if (stepIdx === 0) props.onCancel();
    else setStep(STEPS[stepIdx - 1]);
  };

  const navButton = (label: string, onClick: () => void, primary = false) => (
    <button
      onClick={onClick}
      style={{
        padding: "12px 26px",
        borderRadius: 14,
        border: primary ? "1px solid #2f3b30" : "1px solid rgba(255,255,255,0.5)",
        background: primary ? "#3d4a3e" : "rgba(255,255,255,0.85)",
        color: primary ? "#fff" : "#3d4a3e",
        fontWeight: 800,
        fontSize: 14,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="cc-biome-wizard"
      {...biomeContextAttributes(contextualUiTheme, "new-game-preview")}
      style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", ...biomeUiStyle(contextualUiTheme) } as CSSProperties}
    >
      <StartMenuBackground />
      <div
        style={{
          position: "relative",
          zIndex: 10,
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div style={{ width: "min(760px, 100%)" }}>
          {/* Step header */}
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 34,
                fontWeight: 800,
                color: "#fff",
                textShadow: "0 3px 10px rgba(61, 74, 62, 0.5)",
              }}
            >
              {STEP_TITLE[step]}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 10 }}>
              {STEPS.map((s, i) => (
                <div
                  key={s}
                  style={{
                    width: i === stepIdx ? 26 : 10,
                    height: 10,
                    borderRadius: 999,
                    background: i <= stepIdx ? "var(--biome-accent, #F2C14E)" : "rgba(255,255,255,0.4)",
                    transition: "width 200ms ease",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Step body */}
          {step === "MODE" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <ChoiceCard
                title={translateCurrent("auto.ui.newgamewizard.challenge")}
                icon="🎯"
                blurb="Fresh land with a set of objectives to beat — build, profit, and earn a name."
                selected={mode === "challenge"}
                onSelect={() => setMode("challenge")}
              />
              <ChoiceCard
                title={translateCurrent("auto.ui.newgamewizard.sandbox")}
                icon="🌿"
                blurb="Free play. No goals, no deadlines — shape the course of your dreams."
                selected={mode === "sandbox"}
                onSelect={() => setMode("sandbox")}
              />
              <ChoiceCard
                title={translateCurrent("auto.ui.newgamewizard.career")}
                icon="🏆"
                blurb="An authored ladder of scenarios with medals and unlocks."
                selected={mode === "career"}
                onSelect={() => setMode("career")}
              />
            </div>
          )}

          {step === "SCENARIOS" && <ScenarioSelect onStart={props.onStartScenario} />}

          {step === "LAND" && (
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                {BIOME_KEYS.map((key) => {
                  const biome = getBiomeDefinition(key);
                  return (
                    <ChoiceCard
                      key={key}
                      title={translateCurrent(BIOME_TITLE_KEYS[key])}
                      icon={biome.presentation.preview.icon}
                      blurb={biome.blurb}
                      selected={theme === key}
                      onSelect={() => setTheme(key)}
                    />
                  );
                })}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  justifyContent: "center",
                }}
              >
                {candidateSeeds.map((s, i) => (
                  <LandPreview
                    key={`${s}-${i}`}
                    seed={s}
                    theme={theme}
                    selected={i === selectedSeedIdx}
                    onSelect={() => setSelectedSeedIdx(i)}
                  />
                ))}
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center" }}>
                <button
                  onClick={() => {
                    setCandidateSeeds(Array.from({ length: 4 }, randomSeed));
                    setSelectedSeedIdx(0);
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.5)",
                    background: "rgba(255,255,255,0.85)",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <T id="auto.ui.newgamewizard.reroll.land" /></button>
                <label style={{ fontSize: 12, color: "#fff", fontWeight: 600 }}>
                  <T id="auto.ui.newgamewizard.seed.2" />{" "}
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => {
                      const v = Number(e.target.value) | 0;
                      setCandidateSeeds((seeds) => {
                        const nextSeeds = seeds.slice();
                        nextSeeds[selectedSeedIdx] = v;
                        return nextSeeds;
                      });
                    }}
                    style={{
                      width: 110,
                      marginLeft: 6,
                      padding: "7px 9px",
                      borderRadius: 8,
                      border: "1px solid rgba(0,0,0,0.2)",
                      fontSize: 13,
                    }}
                  />
                </label>
              </div>
            </div>
          )}

          {step === "DIFFICULTY" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <ChoiceCard
                title={translateCurrent("auto.ui.newgamewizard.easy")}
                icon="⛱️"
                blurb="A relaxed build: more starting room for error, forgiving golfers, friendlier terms."
                selected={difficulty === "easy"}
                onSelect={() => setDifficulty("easy")}
              />
              <ChoiceCard
                title={translateCurrent("auto.ui.newgamewizard.normal")}
                icon="⛳"
                blurb="The intended experience — the tuning the sim was balanced around."
                selected={difficulty === "normal"}
                onSelect={() => setDifficulty("normal")}
              />
              <ChoiceCard
                title={translateCurrent("auto.ui.newgamewizard.hard")}
                icon="🌪️"
                blurb="Tight margins, faster wear, stricter lenders. For seasoned architects."
                selected={difficulty === "hard"}
                onSelect={() => setDifficulty("hard")}
              />
            </div>
          )}

          {step === "DETAILS" && (
            <div
              style={{
                display: "grid",
                gap: 14,
                padding: 20,
                borderRadius: 16,
                background: "rgba(255,255,255,0.9)",
              }}
            >
              <label style={{ fontSize: 13, fontWeight: 700, color: "#3d4a3e" }}>
                <T id="auto.ui.newgamewizard.course.name" /><div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <input
                    value={courseName}
                    onChange={(e) => setCourseName(e.target.value)}
                    maxLength={40}
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(0,0,0,0.2)",
                      fontSize: 15,
                      fontWeight: 600,
                    }}
                  />
                  <button
                    onClick={() => setCourseName(generateCourseName())}
                    title={translateCurrent("auto.ui.newgamewizard.random.name")}
                    style={{
                      padding: "0 14px",
                      borderRadius: 10,
                      border: "1px solid rgba(0,0,0,0.15)",
                      background: "#fff",
                      fontSize: 18,
                      cursor: "pointer",
                    }}
                  >
                    🎲
                  </button>
                </div>
              </label>

              <label style={{ fontSize: 13, fontWeight: 700, color: "#3d4a3e" }}>
                <T id="auto.ui.newgamewizard.founder.name" /><span style={{ fontWeight: 400, color: "#6b7280" }}><T id="auto.ui.newgamewizard.optional" /></span>
                <input
                  value={founderName}
                  onChange={(e) => setFounderName(e.target.value)}
                  maxLength={30}
                  placeholder={translateCurrent("auto.ui.newgamewizard.your.name.on.the.clubhouse.plaque")}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 6,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.2)",
                    fontSize: 14,
                  }}
                />
              </label>

              <fieldset data-testid="player-pro-creation" style={{ border: "1px solid rgba(61,74,62,.22)", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
                <legend style={{ padding: "0 6px", fontWeight: 800, color: "#3d4a3e" }}>{translateCurrent("playerPro.creation.title")}</legend>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#3d4a3e" }}>
                  {translateCurrent("playerPro.creation.name")}
                  <input
                    data-testid="player-pro-name"
                    value={proName}
                    onChange={(event) => setProName(event.target.value)}
                    maxLength={30}
                    placeholder={founderName || translateCurrent("playerPro.defaultName")}
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,.2)" }}
                  />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
                  <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700 }}>
                    {translateCurrent("playerPro.creation.appearance")}
                    <select value={proAppearance} onChange={(event) => setProAppearance(event.target.value as PlayerProAppearance)} style={{ padding: 7, borderRadius: 7 }}>
                      <option value="classic">{translateCurrent("playerPro.appearance.classic")}</option>
                      <option value="sport">{translateCurrent("playerPro.appearance.sport")}</option>
                      <option value="heritage">{translateCurrent("playerPro.appearance.heritage")}</option>
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700 }}>
                    {translateCurrent("playerPro.creation.handedness")}
                    <select value={proHandedness} onChange={(event) => setProHandedness(event.target.value as PlayerProHandedness)} style={{ padding: 7, borderRadius: 7 }}>
                      <option value="right">{translateCurrent("playerPro.handedness.right")}</option>
                      <option value="left">{translateCurrent("playerPro.handedness.left")}</option>
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700 }}>
                    {translateCurrent("playerPro.creation.background")}
                    <select value={proBackground} onChange={(event) => setProBackground(event.target.value as PlayerProBackground)} style={{ padding: 7, borderRadius: 7 }}>
                      <option value="architect">{translateCurrent("playerPro.background.architect")}</option>
                      <option value="operator">{translateCurrent("playerPro.background.operator")}</option>
                      <option value="host">{translateCurrent("playerPro.background.host")}</option>
                    </select>
                  </label>
                </div>
                <small style={{ color: "#5d685e" }}>{translateCurrent(`playerPro.background.${proBackground}.benefit`)}</small>
              </fieldset>

              {mode === "sandbox" && (
                <label style={{ fontSize: 13, fontWeight: 700, color: "#3d4a3e" }}>
                  <T id="auto.ui.newgamewizard.starting.cash" />{formatCurrency(startingCash)}
                  <input
                    type="range"
                    min={SANDBOX_STARTING_CASH.min}
                    max={SANDBOX_STARTING_CASH.max}
                    step={SANDBOX_STARTING_CASH.step}
                    value={startingCash}
                    onChange={(e) => setStartingCash(Number(e.target.value))}
                    style={{ display: "block", width: "100%", marginTop: 8 }}
                  />
                  <span style={{ fontWeight: 400, fontSize: 11, color: "#6b7280" }}>
                    <T id="auto.ui.newgamewizard.sandbox.override.challenge.runs.use.the.balanced.defau" /></span>
                </label>
              )}

              <div
                style={{
                  fontSize: 12,
                  color: "#4b5563",
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "rgba(0,0,0,0.05)",
                }}
              >
                {mode === "challenge" ? "🎯 Challenge" : "🌿 Sandbox"} • {translateCurrent(BIOME_TITLE_KEYS[theme])} • {difficulty} <T id="auto.ui.newgamewizard.seed.3" />{" "}
                {seed}
              </div>
            </div>
          )}

          {/* Navigation */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
            {navButton(step === "MODE" ? "Cancel" : "← Back", back)}
            {step === "SCENARIOS" ? (
              <span />
            ) : step !== "DETAILS" ? (
              navButton("Next →", next, true)
            ) : (
              navButton("⛳ Start building", () => props.onStart(setup), true)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

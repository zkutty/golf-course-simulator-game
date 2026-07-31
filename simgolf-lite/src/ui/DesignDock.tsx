import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { Texture } from "pixi.js";
import type { ResolvedGraphicsQuality } from "../game/render/graphicsQuality";
import type {
  DecorationRotation,
  LandTheme,
  TerrainAuthoringTool,
} from "../game/models/types";
import {
  isObstacleUnlocked,
  isTerrainUnlocked,
  obstacleMinReputation,
  terrainMinReputation,
} from "../game/progression/progression";
import type { MessageKey } from "../i18n/catalog";
import { I18nContext, type Translator } from "../i18n/context";
import { translateCurrent } from "../i18n/core";
import { formatCurrency, formatNumber } from "../i18n/format";
import {
  getLandscapeMaterialField,
  getPropFrame,
  getTerrainFrame,
  type AtlasFrame,
} from "../render/atlas";
import {
  DESIGN_CATEGORIES,
  type DesignCatalogItem,
  type DesignCategory,
  type DesignRiskLevel,
  isTerrainAtlasFrame,
} from "./designCatalog";
import "./designDock.css";
import {
  biomeContextAttributes,
  type BiomeUiTheme,
} from "./biomeUiTheme";

interface DesignDockProps {
  theme: LandTheme;
  quality: ResolvedGraphicsQuality;
  catalog: Record<DesignCategory, readonly DesignCatalogItem[]>;
  selectedItemId: string;
  cash: number;
  reputation: number;
  terrainTool: TerrainAuthoringTool;
  onTerrainTool: (tool: TerrainAuthoringTool) => void;
  terrainBrushWidth: number;
  onTerrainBrushWidth: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelect: (item: DesignCatalogItem) => void;
  decorationAction: "place" | "rotate" | "remove";
  onDecorationAction: (action: "place" | "rotate" | "remove") => void;
  decorationRotation: DecorationRotation;
  onDecorationRotation: (rotation: DecorationRotation) => void;
  decorationSpan: number;
  onDecorationSpan: (span: number) => void;
  onOpenGolfopedia: (entry: string) => void;
  biomeContext?: BiomeUiTheme;
}

const CATEGORY_LABEL_KEYS: Record<DesignCategory, MessageKey> = {
  terrain: "designDock.category.terrain",
  nature: "designDock.category.nature",
  decor: "designDock.category.decor",
};

const DECOR_ACTION_LABEL_KEYS: Record<
  "place" | "rotate" | "remove",
  MessageKey
> = {
  place: "decor.place",
  rotate: "decor.rotate",
  remove: "decor.remove",
};

const RISK_SYMBOL = {
  low: "✓",
  watch: "△",
  high: "!",
} as const;

const RISK_LABEL_KEYS: Record<DesignRiskLevel, MessageKey> = {
  low: "designDock.risk.level.low",
  watch: "designDock.risk.level.watch",
  high: "designDock.risk.level.high",
};

const FIT_LABEL_KEYS: Record<
  NonNullable<DesignCatalogItem["ecologicalFit"]>,
  MessageKey
> = {
  native: "designDock.fit.native",
  adapted: "designDock.fit.adapted",
  imported: "designDock.fit.imported",
};

function textureFor(
  item: DesignCatalogItem,
  theme: LandTheme,
  quality: ResolvedGraphicsQuality,
): Texture | null {
  if (item.visualKind === "terrain" && item.terrain) {
    if (quality !== "low") {
      const field = getLandscapeMaterialField(theme, item.terrain, quality);
      if (field) return field;
    }
    return isTerrainAtlasFrame(item.atlasFrame)
      ? getTerrainFrame(item.atlasFrame)
      : null;
  }
  return getPropFrame(item.atlasFrame as AtlasFrame);
}

function drawTexture(
  canvas: HTMLCanvasElement,
  texture: Texture,
  visualKind: DesignCatalogItem["visualKind"],
): boolean {
  const context = canvas.getContext("2d");
  const resource = texture.source.resource as CanvasImageSource | undefined;
  if (!context || !resource) return false;
  const frame = texture.frame;
  const resolution = texture.source.resolution || 1;
  const sx = frame.x * resolution;
  const sy = frame.y * resolution;
  const sw = frame.width * resolution;
  const sh = frame.height * resolution;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  if (visualKind === "terrain") {
    context.beginPath();
    context.moveTo(canvas.width / 2, 2);
    context.lineTo(canvas.width - 2, canvas.height / 2);
    context.lineTo(canvas.width / 2, canvas.height - 2);
    context.lineTo(2, canvas.height / 2);
    context.closePath();
    context.clip();
  }
  const inset = visualKind === "prop" ? 3 : 0;
  context.drawImage(
    resource,
    sx,
    sy,
    sw,
    sh,
    inset,
    inset,
    canvas.width - inset * 2,
    canvas.height - inset * 2,
  );
  context.restore();
  return true;
}

function applyPreviewTreatment(
  canvas: HTMLCanvasElement,
  tint: number,
  alpha: number,
): boolean {
  try {
    const context = canvas.getContext("2d");
    if (!context) return false;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const red = (tint >>> 16) & 0xff;
    const green = (tint >>> 8) & 0xff;
    const blue = tint & 0xff;
    for (let index = 0; index < image.data.length; index += 4) {
      image.data[index] = Math.round(image.data[index] * red / 255);
      image.data[index + 1] = Math.round(image.data[index + 1] * green / 255);
      image.data[index + 2] = Math.round(image.data[index + 2] * blue / 255);
      image.data[index + 3] = Math.round(
        image.data[index + 3] * Math.max(0, Math.min(1, alpha)),
      );
    }
    context.putImageData(image, 0, 0);
    return true;
  } catch {
    return false;
  }
}

function AtlasSwatch(props: {
  item: DesignCatalogItem;
  theme: LandTheme;
  quality: ResolvedGraphicsQuality;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const texture = textureFor(props.item, props.theme, props.quality);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const atlasDrawn = Boolean(
      texture
      && drawTexture(canvas, texture, props.item.visualKind)
      && applyPreviewTreatment(
        canvas,
        props.item.previewTint,
        props.item.previewAlpha,
      )
    );
    canvas.hidden = !atlasDrawn;
    canvas.parentElement?.setAttribute(
      "data-preview-source",
      atlasDrawn ? "atlas" : "fallback",
    );
  }, [props.item, props.quality, props.theme, texture]);
  const color = `#${props.item.fallbackColor.toString(16).padStart(6, "0")}`;
  return (
    <span
      className={`cc-design-swatch cc-design-swatch--${props.item.visualKind}`}
      data-preview-source="fallback"
      data-seasonal-variant={props.item.previewSeasonalVariant}
      data-preview-tint={props.item.previewTint.toString(16).padStart(6, "0")}
      data-preview-alpha={props.item.previewAlpha.toFixed(3)}
      data-pattern={props.item.pattern}
      style={{
        "--cc-design-fallback": color,
        "--cc-design-preview-alpha": props.item.previewAlpha,
      } as CSSProperties}
      aria-hidden="true"
    >
      <span className="cc-design-swatch__fallback">{props.item.fallbackIcon}</span>
      <canvas ref={canvasRef} width={52} height={30} />
    </span>
  );
}

function itemAriaLabel(
  item: DesignCatalogItem,
  affordable: boolean,
  t: Translator,
): string {
  const care = item.weeklyCareUnit === "currency"
    ? t("designDock.item.careAria", {
      value: formatCurrency(item.weeklyCare),
    })
    : t("designDock.item.careWeightAria", {
      value: formatNumber(item.weeklyCare, "en", { maximumFractionDigits: 2 }),
    });
  return [
    item.label,
    t("designDock.item.buildAria", {
      value: formatCurrency(item.buildPrice),
    }),
    t("designDock.item.salvageAria", {
      value: formatCurrency(item.salvageValue),
    }),
    care,
    t("designDock.item.waterAria", {
      value: item.waterDemand.toFixed(2),
    }),
    item.ecologicalFit
      ? t("designDock.item.fitAria", {
        fit: t(FIT_LABEL_KEYS[item.ecologicalFit]),
      })
      : "",
    t("designDock.item.riskAria", {
      level: t(RISK_LABEL_KEYS[item.seasonalRisk.level]),
      risk: item.seasonalRisk.label,
    }),
    t(
      affordable
        ? "designDock.item.affordableAria"
        : "designDock.item.unaffordableAria",
    ),
  ].filter(Boolean).join(". ");
}

export function DesignDock(props: DesignDockProps) {
  const t = useContext(I18nContext)?.t ?? translateCurrent;
  const selectedCategory = DESIGN_CATEGORIES.find((category) =>
    props.catalog[category].some((item) => item.id === props.selectedItemId)
  ) ?? "terrain";
  const [category, setCategory] = useState<DesignCategory>(selectedCategory);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [focusedItemIds, setFocusedItemIds] = useState<
    Partial<Record<DesignCategory, string>>
  >(() => ({ [selectedCategory]: props.selectedItemId }));
  const longPressRef = useRef<number | null>(null);
  const items = props.catalog[category];
  const focusedItemId = items.some(
      (item) => item.id === focusedItemIds[category],
    )
    ? focusedItemIds[category]
    : items.find((item) => item.id === props.selectedItemId)?.id
      ?? items[0]?.id;
  const selected = useMemo(
    () => [...props.catalog.terrain, ...props.catalog.nature, ...props.catalog.decor]
      .find((item) => item.id === props.selectedItemId)
      ?? props.catalog.terrain[0],
    [props.catalog, props.selectedItemId],
  );
  const inspected = items.find((item) => item.id === inspectedId) ?? selected;

  useEffect(() => {
    if (selectedCategory !== category) setCategory(selectedCategory);
    setFocusedItemIds((current) =>
      current[selectedCategory] === props.selectedItemId
        ? current
        : { ...current, [selectedCategory]: props.selectedItemId });
    // Category intentionally follows selections made outside the dock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedItemId, selectedCategory]);

  const clearLongPress = () => {
    if (longPressRef.current != null) window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
  };
  const startLongPress = (
    event: PointerEvent<HTMLButtonElement>,
    item: DesignCatalogItem,
  ) => {
    clearLongPress();
    if (event.pointerType === "mouse") return;
    longPressRef.current = window.setTimeout(() => {
      setInspectedId(item.id);
      props.onSelect(item);
      longPressRef.current = null;
    }, 520);
  };

  const focusItem = (index: number) => {
    const normalized = (index + items.length) % items.length;
    const item = items[normalized];
    setFocusedItemIds((current) => ({
      ...current,
      [category]: item.id,
    }));
    document.getElementById(`design-card-${item.id}`)?.focus();
  };
  const activateCategory = (nextCategory: DesignCategory) => {
    setCategory(nextCategory);
    setInspectedId(null);
    setFocusedItemIds((current) => {
      const categoryItems = props.catalog[nextCategory];
      const retained = categoryItems.some(
        (item) => item.id === current[nextCategory],
      )
        ? current[nextCategory]
        : categoryItems.find((item) => item.id === props.selectedItemId)?.id
          ?? categoryItems[0]?.id;
      return retained
        ? { ...current, [nextCategory]: retained }
        : current;
    });
  };
  const onCategoryKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentCategory: DesignCategory,
  ) => {
    const currentIndex = DESIGN_CATEGORIES.indexOf(currentCategory);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % DESIGN_CATEGORIES.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (
        currentIndex - 1 + DESIGN_CATEGORIES.length
      ) % DESIGN_CATEGORIES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = DESIGN_CATEGORIES.length - 1;
    }
    if (nextIndex == null) return;
    event.preventDefault();
    const nextCategory = DESIGN_CATEGORIES[nextIndex];
    activateCategory(nextCategory);
    document.getElementById(`design-tab-${nextCategory}`)?.focus();
  };
  const lockRequirement = (item: DesignCatalogItem): number | null => {
    if (item.terrain && !isTerrainUnlocked(item.terrain, props.reputation)) {
      return terrainMinReputation(item.terrain);
    }
    if (
      item.obstacleType
      && !isObstacleUnlocked(item.obstacleType, props.reputation)
    ) return obstacleMinReputation(item.obstacleType);
    return null;
  };
  const onCardKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    item: DesignCatalogItem,
  ) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(items.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (lockRequirement(item) == null) props.onSelect(item);
    }
  };

  return (
    <section
      className="cc-design-dock"
      aria-label={t("designDock.aria")}
      data-testid="design-dock"
      data-category={category}
      data-tutorial-target="terrain-palette"
      {...(props.biomeContext
        ? biomeContextAttributes(props.biomeContext, "design-dock")
        : {})}
    >
      <div className="cc-design-dock__shell">
        <div className="cc-design-toolbar" aria-label={t("designDock.toolbarAria")}>
          <strong>{t("workspace.design")}</strong>
          <div className="cc-design-toolbar__tools" role="group" aria-label={t("designDock.toolsAria")}>
            {(["curve", "spline", "area", "edit"] as const).map((tool) => (
              <button
                key={tool}
                type="button"
                data-testid={`design-tool-${tool}`}
                aria-pressed={props.terrainTool === tool}
                onClick={() => props.onTerrainTool(tool)}
              >
                {tool === "curve"
                  ? t("terrainEdit.curve")
                  : tool === "spline"
                    ? t("terrainEdit.spline")
                    : tool === "area"
                      ? t("terrainEdit.area")
                      : t("terrainEdit.edit")}
              </button>
            ))}
          </div>
          <label className="cc-design-toolbar__width">
            <span>{t("designDock.width")}</span>
            <input
              aria-label={t("designDock.widthAria")}
              type="range"
              min={1}
              max={12}
              step={1}
              value={props.terrainBrushWidth}
              disabled={props.terrainTool === "area" || props.terrainTool === "edit"}
              onChange={(event) => props.onTerrainBrushWidth(Number(event.target.value))}
            />
            <output>{props.terrainBrushWidth}</output>
          </label>
          <div className="cc-design-toolbar__history" role="group" aria-label={t("designDock.historyAria")}>
            <button type="button" aria-label={t("terrainEdit.undo")} onClick={props.onUndo}>↶</button>
            <button type="button" aria-label={t("terrainEdit.redo")} onClick={props.onRedo}>↷</button>
          </div>
        </div>

        <div className="cc-design-dock__body">
          <div className="cc-design-categories" role="tablist" aria-label={t("designDock.categoriesAria")}>
            {DESIGN_CATEGORIES.map((nextCategory) => (
              <button
                key={nextCategory}
                id={`design-tab-${nextCategory}`}
                type="button"
                role="tab"
                aria-selected={category === nextCategory}
                aria-controls={`design-panel-${nextCategory}`}
                tabIndex={category === nextCategory ? 0 : -1}
                onClick={() => activateCategory(nextCategory)}
                onKeyDown={(event) => onCategoryKeyDown(event, nextCategory)}
              >
                {t(CATEGORY_LABEL_KEYS[nextCategory])}
              </button>
            ))}
          </div>
          {DESIGN_CATEGORIES.map((panelCategory) => (
            <div
              key={panelCategory}
              id={`design-panel-${panelCategory}`}
              className="cc-design-palette-panel"
              role="tabpanel"
              aria-labelledby={`design-tab-${panelCategory}`}
              hidden={panelCategory !== category}
            >
              {panelCategory === category && (
                <div
                  className="cc-design-palette"
                  role="listbox"
                  aria-label={t("designDock.paletteAria", {
                    category: t(CATEGORY_LABEL_KEYS[category]),
                  })}
                  data-testid={`design-palette-${category}`}
                >
                  {items.map((item, index) => {
              const active = item.id === props.selectedItemId;
              const affordable = item.buildPrice <= props.cash;
              const requiredReputation = lockRequirement(item);
              return (
                <button
                  id={`design-card-${item.id}`}
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  aria-label={`${itemAriaLabel(item, affordable, t)}${requiredReputation == null
                    ? ""
                    : t("designDock.item.lockedAria", {
                      reputation: requiredReputation,
                    })}`}
                  aria-disabled={requiredReputation != null}
                  data-testid={`design-card-${item.id.replaceAll(":", "-")}`}
                  data-affordable={affordable}
                  data-locked={requiredReputation != null}
                  data-risk={item.seasonalRisk.level}
                  tabIndex={item.id === focusedItemId ? 0 : -1}
                  className="cc-design-card"
                  onClick={() => {
                    if (requiredReputation == null) props.onSelect(item);
                  }}
                  onFocus={() => {
                    setFocusedItemIds((current) => ({
                      ...current,
                      [category]: item.id,
                    }));
                    setInspectedId(item.id);
                  }}
                  onBlur={() => setInspectedId(null)}
                  onMouseEnter={() => setInspectedId(item.id)}
                  onMouseLeave={() => setInspectedId(null)}
                  onPointerDown={(event) => {
                    if (requiredReputation == null) startLongPress(event, item);
                  }}
                  onPointerUp={clearLongPress}
                  onPointerCancel={clearLongPress}
                  onPointerMove={(event) => {
                    if (event.pointerType !== "mouse" && (Math.abs(event.movementX) > 3 || Math.abs(event.movementY) > 3)) clearLongPress();
                  }}
                  onKeyDown={(event) => onCardKeyDown(event, index, item)}
                >
                  <AtlasSwatch item={item} theme={props.theme} quality={props.quality} />
                  <span className="cc-design-card__label">{item.shortLabel}</span>
                  <span className="cc-design-card__state" aria-hidden="true">
                    {requiredReputation != null ? "🔒" : active ? "✓" : !affordable ? "$" : RISK_SYMBOL[item.seasonalRisk.level]}
                  </span>
                </button>
              );
                  })}
                </div>
              )}
            </div>
          ))}

          <aside
            className="cc-design-inspector"
            aria-label={t("designDock.inspectorAria")}
            data-testid="design-inspector"
            data-risk={inspected.seasonalRisk.level}
          >
            <div className="cc-design-inspector__title">
              <strong>{inspected.label}</strong>
              <span>{RISK_SYMBOL[inspected.seasonalRisk.level]} {t(RISK_LABEL_KEYS[inspected.seasonalRisk.level])}</span>
            </div>
            <div className="cc-design-inspector__metrics">
              {inspected.ecologicalFit && <span>{t("designDock.metric.fit")} <b>{t(FIT_LABEL_KEYS[inspected.ecologicalFit])}</b></span>}
              <span>{t("designDock.metric.build")} <b>{formatCurrency(inspected.buildPrice)}</b></span>
              <span>{t("designDock.metric.salvage")} <b>{formatCurrency(inspected.salvageValue)}</b></span>
              <span>
                {t("designDock.metric.weeklyCare")}{" "}
                <b>
                  {inspected.weeklyCareUnit === "currency"
                    ? formatCurrency(inspected.weeklyCare)
                    : formatNumber(inspected.weeklyCare, "en", { maximumFractionDigits: 2 })}
                </b>
                {inspected.weeklyCareUnit === "care weight"
                  ? t("designDock.metric.careWeightSuffix")
                  : ""}
              </span>
              <span>{t("designDock.metric.water")} <b>{inspected.waterDemand.toFixed(2)}</b></span>
            </div>
            <div className="cc-design-inspector__path">
              <b>{t("designDock.metric.degradation")}</b> {inspected.degradationPath}
            </div>
            <div className="cc-design-inspector__risk">
              <b>{t("designDock.metric.currentRisk")}</b> {inspected.seasonalRisk.label}
            </div>
            {inspected.fallbackReason && (
              <div className="cc-design-inspector__fallback">
                <b>{t("designDock.safeFallback")}</b> {inspected.fallbackReason}
              </div>
            )}
            {inspected.category === "terrain" && inspected.terrain && (
              <button
                type="button"
                className="cc-design-inspector__learn"
                onClick={() => props.onOpenGolfopedia(`terrain-${inspected.terrain}`)}
              >
                {t("designDock.golfopedia")}
              </button>
            )}
            {inspected.decorationKind && (
              <div className="cc-design-inspector__decor" aria-label={t("designDock.decor.controlsAria")}>
                <div role="group" aria-label={t("designDock.decor.actionAria")}>
                  {(["place", "rotate", "remove"] as const).map((action) => (
                    <button
                      key={action}
                      type="button"
                      aria-pressed={props.decorationAction === action}
                      onClick={() => props.onDecorationAction(action)}
                    >
                      {t(DECOR_ACTION_LABEL_KEYS[action])}
                    </button>
                  ))}
                </div>
                <div role="group" aria-label={t("designDock.decor.directionAria")}>
                  {([0, 1, 2, 3] as const).map((rotation) => (
                    <button
                      key={rotation}
                      type="button"
                      aria-label={t("designDock.decor.degrees", {
                        degrees: rotation * 90,
                      })}
                      aria-pressed={props.decorationRotation === rotation}
                      onClick={() => props.onDecorationRotation(rotation)}
                    >
                      {rotation * 90}°
                    </button>
                  ))}
                </div>
                {(inspected.decorationKind === "bridge" || inspected.decorationKind === "boardwalk") && (
                  <label>
                    {t("designDock.decor.span", {
                      span: props.decorationSpan,
                    })}
                    <input
                      aria-label={t("designDock.decor.spanAria")}
                      type="range"
                      min={1}
                      max={inspected.decorationKind === "bridge" ? 6 : 8}
                      value={props.decorationSpan}
                      onChange={(event) => props.onDecorationSpan(Number(event.target.value))}
                    />
                  </label>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

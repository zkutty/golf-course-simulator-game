import { createRoot } from "react-dom/client";
import { GameButton, IconButton } from "../../src/ui/gameui/GameButtons";
import { translateCurrent, setActiveLocale } from "../../src/i18n/core";
import "../../src/index.css";
import "../../src/ui/cozyLayout.css";

setActiveLocale(localStorage.getItem("coursecraft_locale") === "pseudo" ? "pseudo" : "en");
const calls: string[] = [];
const note = (value: string) => {
  calls.push(value);
  document.querySelector<HTMLOutputElement>("output")!.value = calls.join(",");
};
const label = translateCurrent("architecture.illustration.export.atlasSvg");
createRoot(document.getElementById("root")!).render(<main style={{ padding: 12, maxWidth: 460, boxSizing: "border-box", display: "grid", gap: 16 }}>
  <output data-testid="calls" />
  {(["sm", "md", "lg"] as const).map((size) => <GameButton key={size} data-testid={`size-${size}`} size={size} onClick={() => note(size)}>{label}</GameButton>)}
  <IconButton data-testid="icon" icon={<span aria-hidden="true">+</span>} label={label} onClick={() => note("icon")} />
  {(["primary", "secondary", "success", "danger"] as const).map((variant) => <GameButton key={variant} data-testid={`variant-${variant}`} variant={variant} onClick={() => note(variant)}>{label}</GameButton>)}
  <GameButton data-testid="long" size="sm" onClick={() => note("long")}>{label} {label} {label} coursecraftchampionshipcoursewithoutspaces</GameButton>
  <GameButton data-testid="disabled" disabled onClick={() => note("disabled")}>{label}</GameButton>
  <IconButton data-testid="disabled-icon" disabled icon={<span aria-hidden="true">+</span>} label={label} onClick={() => note("disabled-icon")} />
  <GameButton data-testid="custom" className="custom-class" aria-label="Custom control" title="Custom title" style={{ fontSize: "1.25rem" }} onClick={() => note("custom")}>{label}</GameButton>
</main>);

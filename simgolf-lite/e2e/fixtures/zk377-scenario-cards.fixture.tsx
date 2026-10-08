import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import { registerSetupCatalog } from "../../src/i18n/setupCatalog";
import { ScenarioSelect } from "../../src/ui/ScenarioSelect";

registerSetupCatalog();

export function Fixture() {
  const [started, setStarted] = useState("none");
  return (
    <I18nProvider>
      <main style={{ boxSizing: "border-box", width: "min(100%, 520px)", margin: "0 auto", padding: 8, background: "#dfe8dc", fontFamily: "Arial, sans-serif" }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 20 }}>Scenario card fixture</h1>
        <ScenarioSelect onStart={(scenario) => setStarted(scenario.id)} />
        <output data-testid="scenario-started" aria-live="polite">{started}</output>
      </main>
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);

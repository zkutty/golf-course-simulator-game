import { useState } from "react";
import { createRoot } from "react-dom/client";
import { GolfopediaModal } from "../../src/ui/help/GolfopediaModal";
import { I18nContext } from "../../src/i18n/context";
import { loadLocale, setActiveLocale, translate } from "../../src/i18n/core";
import "../../src/index.css";

const locale = loadLocale();
setActiveLocale(locale);
document.documentElement.dataset.locale = locale;

export function Fixture() {
  const [open, setOpen] = useState(false);
  const [closeCount, setCloseCount] = useState(0);
  return <I18nContext.Provider value={{ locale, setLocale: () => {}, t: (key, params) => translate(locale, key, params) }}>
    <button data-testid="open-golfopedia" onClick={() => setOpen(true)}>Open Golfopedia</button>
    <output data-testid="close-count">{closeCount}</output>
    <GolfopediaModal initialEntry={new URLSearchParams(location.search).get("initialEntry")} open={open} onClose={() => { setCloseCount((count) => count + 1); setOpen(false); }} />
  </I18nContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

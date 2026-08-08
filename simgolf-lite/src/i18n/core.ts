import { en, type MessageKey, type MessageParams } from "./catalog";

export type Locale = "en" | "pseudo";
export const LOCALE_STORAGE_KEY = "coursecraft_locale";
let activeLocale: Locale = "en";

const PLURAL = /\{(\w+),\s*plural,\s*one\s*\{([^{}]*)\}\s*other\s*\{([^{}]*)\}\}/g;
const PARAM = /\{(\w+)\}/g;
const ACCENTS: Record<string, string> = {
  a: "á", A: "Á", e: "ë", E: "Ë", i: "ï", I: "Ï", o: "ô", O: "Ô", u: "ü", U: "Ü",
  c: "ç", C: "Ç", n: "ñ", N: "Ñ", y: "ÿ", Y: "Ÿ",
};
const registeredEn: Partial<Record<MessageKey, string>> = {};

export function registerMessages(messages: Partial<Record<MessageKey, string>>): () => void {
  const previous = new Map<MessageKey, string | undefined>();
  for (const key of Object.keys(messages) as MessageKey[]) {
    previous.set(key, registeredEn[key]);
    registeredEn[key] = messages[key];
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete registeredEn[key];
      else registeredEn[key] = value;
    }
  };
}

export function pseudoLocalize(value: string): string {
  if (!value.trim() || value.startsWith("⟦")) return value;
  const expanded = value.replace(/[A-Za-z]/g, (character) => ACCENTS[character] ?? character);
  return `⟦${expanded} ···⟧`;
}

export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  let message: string | undefined = (en as Partial<Record<MessageKey, string>>)[key] ?? registeredEn[key];
  if (message === undefined) return key;
  message = message.replace(PLURAL, (_match, name: string, one: string, other: string) => {
    const count = Number(params[name] ?? 0);
    return (count === 1 ? one : other).replaceAll("#", String(count));
  });
  message = message.replace(PARAM, (_match, name: string) => String(params[name] ?? `{${name}}`));
  return locale === "pseudo" ? pseudoLocalize(message) : message;
}

export function setActiveLocale(locale: Locale): void { activeLocale = locale; }
export function translateCurrent(key: MessageKey, params?: MessageParams): string { return translate(activeLocale, key, params); }

export function loadLocale(storage: Pick<Storage, "getItem"> = window.localStorage): Locale {
  return storage.getItem(LOCALE_STORAGE_KEY) === "pseudo" ? "pseudo" : "en";
}

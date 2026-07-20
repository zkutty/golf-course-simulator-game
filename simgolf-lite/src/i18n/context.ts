import { createContext } from "react";
import type { MessageKey, MessageParams } from "./catalog";
import type { Locale } from "./core";

export interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: MessageParams) => string;
}

export type Translator = I18nValue["t"];

export const I18nContext = createContext<I18nValue | null>(null);

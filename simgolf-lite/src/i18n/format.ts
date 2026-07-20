import type { Locale } from "./core";

function intlLocale(_locale: Locale): string {
  return "en-US";
}

export function formatNumber(value: number, locale: Locale = "en", options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

export function formatCurrency(value: number, locale: Locale = "en", options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    ...options,
  }).format(options.maximumFractionDigits === 0 || options.maximumFractionDigits == null ? Math.round(value) : value);
}

export function formatWeekLabel(week: number, locale: Locale = "en", prefix = "Week"): string {
  const label = `${prefix} ${formatNumber(week, locale)}`;
  return locale === "pseudo" ? `⟦${prefix === "week" ? "wëëk" : "Wëëk"} ${formatNumber(week, locale)} ···⟧` : label;
}

export function formatDayLabel(day: number, days = 7, locale: Locale = "en"): string {
  const label = `Day ${formatNumber(day, locale)} / ${formatNumber(days, locale)}`;
  return locale === "pseudo" ? `⟦Dáÿ ${formatNumber(day, locale)} / ${formatNumber(days, locale)} ···⟧` : label;
}

export function formatDateTime(value: string | number | Date, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).format(new Date(value));
}

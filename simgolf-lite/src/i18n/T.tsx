import { useContext } from "react";
import type { MessageKey, MessageParams } from "./catalog";
import { I18nContext } from "./context";
import { translateCurrent } from "./core";

export function T({ id, params }: { id: MessageKey; params?: MessageParams }) {
  const context = useContext(I18nContext);
  return <>{context ? context.t(id, params) : translateCurrent(id, params)}</>;
}

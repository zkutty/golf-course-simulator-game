import { useState } from "react";
import { loadAppProfile } from "../game/onboarding/profile";

/** Keep the first seen-ID Set without repeating ignored profile IO on rerenders. */
export function useAdvisorSeen() {
  const [seen] = useState(() => ({ current: new Set(loadAppProfile().advisorSeen) }));
  return seen;
}

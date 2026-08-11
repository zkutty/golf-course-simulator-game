import { registerMessages } from "./core";

// Player Pro panel copy travels with the already-deferred panel. Keeping the
// object separate preserves MessageKey typing and pseudo-localization without
// adding these strings to the initial application graph.
export const playerProSocialEn = {
  "playerPro.close": "Close Player Pro",
  "playerPro.title": "Pro Career",
  "playerPro.tab.career": "Career",
  "playerPro.tab.play": "Play",
  "playerPro.tab.training": "Training",
  "playerPro.tab.matches": "Matches",
  "playerPro.tab.tournaments": "Tournaments",
  "playerPro.identity": "{background} · {handedness} · {appearance}",
  "playerPro.skills": "Six-skill profile",
  "playerPro.skill.power": "Power",
  "playerPro.skill.driving": "Driving",
  "playerPro.skill.irons": "Irons",
  "playerPro.skill.shortGame": "Short Game",
  "playerPro.skill.putting": "Putting",
  "playerPro.skill.recovery": "Recovery",
  "playerPro.skillXp": "{xp}/12 XP",
  "playerPro.careerPoints": "{points} career points",
  "playerPro.earnings": "{amount} career earnings",
  "playerPro.tab.people": "People",
  "playerPro.tab.challenges": "Challenges",
  "playerPro.tab.teamBuilder": "Team Builder",
  "playerPro.tab.equipment": "Equipment",
  "playerPro.tab.wardrobe": "Wardrobe",
  "playerPro.tab.collection": "Collection",
  "playerPro.tab.custody": "Rival Custody",
  "playerPro.social.nav": "Player Pro social",
  "playerPro.social.people.holdings": "Known holdings ({count})",
  "playerPro.social.people.rewards": "Granted reward connections ({count})",
  "playerPro.social.challenges.escrow": "{status} escrow · {cash} · {items} item(s)",
  "playerPro.social.locked": "First shot locked: {shot}",
  "playerPro.social.noContract": "No active contract; preview only.",
  "playerPro.social.items.empty": "No owned items; using defaults.",
  "playerPro.social.collection.trophyMeta": "{course} · W{week}",
  "playerPro.social.noCustody": "No rival-custody items.",
  "playerPro.social.prestige": "P{prestige}",
  "playerPro.social.escrowed": "Reserved in challenge escrow",
  "playerPro.social.equip": "Equip",
  "playerPro.social.unequip": "Use default",
  "playerPro.social.transfer.unique": "Second confirmation: unique/high-prestige.",
  "playerPro.social.transfer.default": "Transfer uses the default-loadout fallback.",
} as const;

export function registerPlayerProSocialCatalog(): () => void {
  return registerMessages(playerProSocialEn);
}

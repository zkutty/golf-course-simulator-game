import type { PlayerShotPreview } from "../../game/playerPro/playerPro";

/** Compare before enqueueing: equal previews must not schedule a passive update. */
export function createPlayerShotPreviewReceiver(publish: (preview: PlayerShotPreview) => void) {
  let expectedFlightKey = JSON.stringify(null);
  return (preview: PlayerShotPreview) => {
    const nextKey = JSON.stringify(preview.expectedFlight ?? null);
    if (nextKey === expectedFlightKey) return;
    expectedFlightKey = nextKey;
    publish(preview);
  };
}

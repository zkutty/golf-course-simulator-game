import type { LandTheme, ObstacleType } from "../game/models/types";
import type { PlantId } from "../game/models/plantTypes";
import { defaultObstaclePlantId, plantDefinition } from "../game/models/plantRegistry";

interface ObstacleEditingInputs {
  theme: LandTheme | undefined;
  obstacleType: ObstacleType;
  selectedPlantId: PlantId | null;
  setObstacleType: (value: ObstacleType) => void;
  setSelectedPlantId: (value: PlantId | null) => void;
  setSelectedDesignItemId: (value: string) => void;
  setEditorMode: (value: "OBSTACLE") => void;
  setPaintError: (value: null) => void;
}

// Keep the returned action's lexical environment separate from App's course data.
export function createObstacleEditingAction({
  theme,
  obstacleType,
  selectedPlantId,
  setObstacleType,
  setSelectedPlantId,
  setSelectedDesignItemId,
  setEditorMode,
  setPaintError,
}: ObstacleEditingInputs) {
  return (
    nextObstacleType: ObstacleType = obstacleType,
    requestedPlantId: PlantId | null = selectedPlantId,
    requestedItemId?: string,
  ) => {
    const requestedPlant = requestedPlantId
      ? plantDefinition(requestedPlantId)
      : null;
    const plantId = nextObstacleType === "rock"
      ? null
      : requestedPlant?.semantics.kind === "obstacle"
          && requestedPlant.semantics.obstacleType === nextObstacleType
        ? requestedPlantId
        : defaultObstaclePlantId(theme, nextObstacleType);
    setObstacleType(nextObstacleType);
    setSelectedPlantId(plantId);
    setSelectedDesignItemId(
      requestedItemId
        ?? (plantId ? `plant:${plantId}` : "nature:rock"),
    );
    setEditorMode("OBSTACLE");
    setPaintError(null);
  };
}

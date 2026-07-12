import { mockUser } from "@/data/mockUser";
import {
  getCurrentLevelByXp,
  getRankTitle,
  levelRequirements,
} from "@/utils/levelUtils";

export type LevelStatus = "пройден" | "текущий" | "заблокирован";

export type MockLevel = {
  id: number;
  title: string;
  requiredXp: number;
  status: LevelStatus;
};

const currentLevel = getCurrentLevelByXp(mockUser.xp.current);

export const mockLevels: MockLevel[] = levelRequirements.map(
  (requiredXp, index) => {
    const id = index + 1;

    return {
      id,
      title: getRankTitle(id),
      requiredXp,
      status:
        id < currentLevel
          ? "пройден"
          : id === currentLevel
            ? "текущий"
            : "заблокирован",
    };
  },
);

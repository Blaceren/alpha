export const levelRequirements = [
  0, 10, 25, 75, 100, 250, 500, 750, 1000, 1300, 1600, 2000, 2500, 2750,
  3000, 3500,
];

export function getRankTitle(level: number) {
  if (level <= 4) {
    return "Новичок";
  }

  if (level <= 8) {
    return "Практик";
  }

  if (level <= 12) {
    return "Трейдер";
  }

  if (level <= 16) {
    return "Профи";
  }

  return "Мастер";
}

export function getRankBadge(level: number) {
  return getRankTitle(level);
}

export function getCurrentLevelByXp(xp: number) {
  const levelIndex = levelRequirements.findLastIndex(
    (requiredXp) => xp >= requiredXp,
  );

  return Math.max(levelIndex + 1, 1);
}

export function getNextLevelXp(level: number) {
  return levelRequirements[level] ?? levelRequirements[levelRequirements.length - 1];
}

export function getXpToNextLevel(currentXp: number, nextLevelXp: number) {
  return Math.max(nextLevelXp - currentXp, 0);
}

export function getLevelProgressPercent(currentXp: number, nextLevelXp: number) {
  if (nextLevelXp <= 0) {
    return 100;
  }

  return Math.min(Math.round((currentXp / nextLevelXp) * 100), 100);
}

export const DAILY_REWARD_XP = 25;
export const DAILY_REWARD_STREAK_BONUS_XP = 150;
export const DAILY_REWARD_STREAK_LENGTH = 7;

export function previousDateKey(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

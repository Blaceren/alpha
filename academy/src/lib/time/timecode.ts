/**
 * A position in a lesson video, the way the lesson's author writes it:
 * «с 1:55», «с 12:07», and past an hour «с 1:02:30».
 *
 * Whole seconds only; anything that is not a non-negative finite number reads
 * as the start. Shared by the player's clock and the test's разбор so the two
 * can never print the same second two different ways.
 */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const ss = rest.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${minutes.toString().padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

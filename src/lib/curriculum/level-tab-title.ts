/**
 * The tab names the level (2026-10-04, launch audit): every level's tab read
 * «Урок — Alpha Trade Academy», so two open levels could not be told apart. The
 * number is read off the stable code (`v2.l004.…`), so the title costs no
 * Backend read; a code without one keeps the old title.
 */
export function levelTabTitle(levelCode: string): string {
  const match = /^v\d+\.l(\d{1,3})\./.exec(levelCode);
  const number = match ? Number.parseInt(match[1]!, 10) : Number.NaN;
  return Number.isFinite(number) && number > 0
    ? `Уровень ${number} — Alpha Trade Academy`
    : "Урок — Alpha Trade Academy";
}

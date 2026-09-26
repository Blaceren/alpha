/**
 * Calendar dates on the LEARNER's clock.
 *
 * A trade's date is the learner's own day, the one they would write in a paper
 * journal. It is worked out in the browser and sent as "YYYY-MM-DD"; the
 * Backend never guesses a time zone, it only checks that the date is plausible.
 */

/** The learner's calendar date of an instant: "YYYY-MM-DD". */
export function localDate(instant: Date): string {
  const month = String(instant.getMonth() + 1).padStart(2, "0");
  const day = String(instant.getDate()).padStart(2, "0");
  return `${instant.getFullYear()}-${month}-${day}`;
}

const MONTHS_FULL = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/**
 * «21 сентября, 18:40» on the learner's clock, with the year only when it is not
 * `now`'s. Call it in the browser only: the server's zone is not the learner's.
 */
export function localDateTime(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const year = at.getFullYear() === now.getFullYear() ? "" : ` ${at.getFullYear()}`;
  return `${at.getDate()} ${MONTHS_FULL[at.getMonth()]}${year}, ${time}`;
}

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/**
 * The day a planned entry time falls on: the occurrence of `entryTime` nearest
 * to `instant`, the moment the plan was fixed. A plan fixed at 23:58 for 00:02
 * is the next day's trade; one fixed at 00:03 for 23:59 is the previous day's.
 */
export function tradeDateNear(entryTime: string, instant: Date): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(entryTime);
  if (!match) return localDate(instant);
  const candidate = new Date(instant);
  candidate.setHours(Number(match[1]), Number(match[2]), 0, 0);
  const ahead = candidate.getTime() - instant.getTime();
  if (ahead > HALF_DAY_MS) candidate.setDate(candidate.getDate() - 1);
  else if (ahead < -HALF_DAY_MS) candidate.setDate(candidate.getDate() + 1);
  return localDate(candidate);
}

/**
 * A TIME OF DAY AS IT IS TYPED: «ЧЧ:ММ», twenty-four hours, digits only.
 *
 * The browser's own time field draws itself in the browser's locale — «02:32
 * PM» in a Russian interface — and opens a list that belongs to the operating
 * system, not to the product. The tools' time field is a text field that keeps
 * only what a time can contain and finishes what the learner started:
 *
 *   «1432»  → «14:32»      four digits are a time; the colon is ours
 *   «9»     → «09:»        no hour starts with 3…9, so the hour is complete
 *   «25»    → «02:5»       no hour is 25, so the 5 begins the minutes
 *   «147»   → «14:07»      no minute starts with 6…9
 *   «9:5»   → «09:5»       a typed mark closes the hour
 *
 * ONE PART CAN BE RETYPED IN PLACE. With «14» selected in «14:32» the learner
 * types «0», then «9». After the first key the text is «0:32» — not a time, but
 * the only way to «09:32» — so an hour of one digit that could still become
 * two is left standing in front of its minutes until the learner goes on, and
 * is settled when they leave the field.
 *
 * Nothing here knows the clock: «now» is the caller's.
 */

export type TimeOfDay = { readonly hours: number; readonly minutes: number };

const COMPLETE_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The time, when the text is a whole «ЧЧ:ММ»; null otherwise. */
export function parseTime(text: string): TimeOfDay | null {
  const match = COMPLETE_RE.exec(text);
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : null;
}

export function formatTime(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const isDigit = (ch: string) => ch >= "0" && ch <= "9";
const isMark = (ch: string) => ch === ":" || ch === "." || ch === "," || ch === " " || ch === "-";

function pushMinute(minute: string, digit: string): string {
  if (minute.length >= 2) return minute;
  if (minute === "" && digit >= "6") return `0${digit}`;
  return minute + digit;
}

/**
 * What the field shows after `raw` was typed or pasted into it. `previous` is
 * what it showed before: when the text got shorter the learner is deleting, and
 * the colon is not put back under their cursor.
 */
export function typeTime(raw: string, previous = ""): string {
  // An hour being retyped in place, its minutes already behind it (see above).
  if (/^[0-2][:.,][0-5]\d?$/.test(raw)) return `${raw[0]}:${raw.slice(2)}`;

  let hour = "";
  let hourDone = false;
  let minute = "";
  let markTyped = false;

  for (const ch of raw) {
    if (!hourDone) {
      if (isDigit(ch)) {
        if (hour === "") {
          if (ch >= "3") {
            hour = `0${ch}`;
            hourDone = true;
          } else {
            hour = ch;
          }
        } else if (hour === "2" && ch > "3") {
          hour = "02";
          hourDone = true;
          minute = pushMinute(minute, ch);
        } else {
          hour += ch;
          hourDone = true;
        }
      } else if (isMark(ch) && hour !== "") {
        hour = hour.padStart(2, "0");
        hourDone = true;
        markTyped = true;
      }
      continue;
    }
    if (isDigit(ch)) minute = pushMinute(minute, ch);
    else if (isMark(ch)) markTyped = true;
  }

  if (!hourDone) return hour;
  if (minute !== "") return `${hour}:${minute}`;
  const deleting = raw.length < previous.length;
  return markTyped || !deleting ? `${hour}:` : hour;
}

/**
 * What the field settles on when the learner leaves it: an hour alone is that
 * hour sharp. Half-typed minutes are left as they are — «14:3» could be 14:03
 * or 14:30, and guessing would write a time the learner did not mean.
 */
export function settleTime(text: string): string {
  const retyped = /^(\d):([0-5]\d)$/.exec(text);
  if (retyped) return formatTime(Number(retyped[1]), Number(retyped[2]));
  const match = /^(\d{1,2}):?$/.exec(text);
  if (!match) return text;
  const hours = Number(match[1]);
  return hours <= 23 ? formatTime(hours, 0) : text;
}

/**
 * One step up or down, in the hours or in the minutes. Each part turns over on
 * its own — 23 → 00, 59 → 00 — and does not carry into the other, the way a
 * clock's two wheels are set. From an unfinished text the count starts at 00:00.
 */
export function stepTime(text: string, part: "hours" | "minutes", delta: number): string {
  const time = parseTime(text) ?? { hours: 0, minutes: 0 };
  if (part === "hours") return formatTime((((time.hours + delta) % 24) + 24) % 24, time.minutes);
  return formatTime(time.hours, (((time.minutes + delta) % 60) + 60) % 60);
}

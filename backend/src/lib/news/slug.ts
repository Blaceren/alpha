/**
 * NEWS — the address of a news page.
 *
 * Built from the country, the title and the release date, in Latin letters:
 * «США · Базовый индекс потребительских цен, м/м» on 21 September 2026 is
 * `ssha-bazovyy-indeks-potrebitelskikh-tsen-m-m-2026-09-21`. The copywriter
 * never types it. It follows the text until the item is first published and
 * never changes after that, so a page search engines know keeps its address.
 */

const LETTERS: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  // Ukrainian and Polish letters, for the localisations that follow Russian.
  є: "ye", і: "i", ї: "yi", ґ: "g",
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
};

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 120;

/** Lower-case Latin words joined by hyphens; everything else becomes a break. */
export function transliterate(text: string): string {
  const latin = [...text.normalize("NFC").toLowerCase()].map((char) => LETTERS[char] ?? char).join("");
  return latin
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Cut at a hyphen so a word is never split, keeping at most `max` characters. */
function cutAtWord(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max + 1);
  const lastBreak = cut.lastIndexOf("-");
  return (lastBreak > 0 ? cut.slice(0, lastBreak) : slug.slice(0, max)).replace(/-+$/, "");
}

/** The base address; `uniqueSlug` adds «-2», «-3» when it is taken. */
export function newsSlugBase(countryLabel: string, title: string, releaseDate: string): string {
  const words = cutAtWord(transliterate(`${countryLabel} ${title}`), SLUG_MAX_LENGTH - 16) || "news";
  return `${words}-${releaseDate}`;
}

export async function uniqueSlug(base: string, isTaken: (slug: string) => Promise<boolean>): Promise<string> {
  if (!(await isTaken(base))) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error("news slug space exhausted");
}

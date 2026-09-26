/**
 * Russian pluralisation for Lessons — one owner, carried across from the frozen
 * module rather than rewritten.
 *
 * SOURCE: LessonsATA `hifi/ru-plural.js`. The rule, the three forms, the
 * fail-to-many fallback and both output phrases are the same; only the module
 * format changed, because the original was a UMD shim for a script tag and this
 * is an ES module.
 *
 * WHY IT IS A MODULE AND NOT TWO TEMPLATE LITERALS. The corpus count line and
 * the live-region result announcement both select through here, so the plural
 * rule cannot fork again — which is exactly what the frozen file exists to
 * prevent, and what a hand-written `n === 1 ? … : …` would undo on the first
 * count that ends in 2.
 */
const rules = new Intl.PluralRules("ru");

/**
 * Integer cardinals in Russian are one/few/many. `other` exists only for
 * fractions, which never count materials — so it fails to `many`.
 */
export function select(n: number, forms: { one: string; few: string; many: string }): string {
  const category = rules.select(n) as keyof typeof forms;
  return forms[category] ?? forms.many;
}

/** «1 материал» · «2 материала» · «5 материалов» */
export function countPhrase(n: number): string {
  return `${n} ${select(n, { one: "материал", few: "материала", many: "материалов" })}`;
}

/** «Найден 1 материал.» · «Найдено 2 материала.» · «Найдено 5 материалов.» */
export function foundPhrase(n: number): string {
  return select(n, {
    one: `Найден ${n} материал.`,
    few: `Найдено ${n} материала.`,
    many: `Найдено ${n} материалов.`,
  });
}

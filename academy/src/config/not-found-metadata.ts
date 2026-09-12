import type { Metadata } from "next";

/**
 * THE METADATA OF A PAGE THAT IS NOT THERE.
 *
 * WHY THIS EXISTS. `notFound()` changes what a route RENDERS. It does not change
 * what the route already SAID about itself: Next resolves a segment's metadata
 * from its `metadata` export or `generateMetadata` independently of whether the
 * component later refuses to render. So a withheld route with a static title
 * kept announcing itself in the tab, in the document title and to anything that
 * reads a page's head — a section hidden everywhere except the one place nobody
 * thinks to look.
 *
 * WHY IT IS SHARED. A route that answers "there is nothing here" should say the
 * same thing whichever route it is. One constant, so a second withheld section
 * cannot invent its own wording.
 *
 * The product's visible 404 copy ("Такой страницы нет") is unchanged and lives
 * in `not-found.tsx`. This is only the document's metadata, which the product
 * did not previously state at all — those pages fell back to the layout title.
 */
export const NOT_FOUND_METADATA: Metadata = {
  title: "Страница не найдена — Alfa Trade Academy",
  description: "Такой страницы нет.",
};

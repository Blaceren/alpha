import type { Metadata } from "next";
import { PublicHomeScreen } from "@/features/public-home/public-home-screen";
import { PUBLIC_HOME_FAQ } from "@/features/public-home/public-home-faq";
import { indexableRobots, searchIndexing, type SearchIndexing } from "@/config/search-indexing";
import { getServerViewer } from "@/server/auth/server-session";
import "@/features/public-home/public-home.css";

/**
 * Metadata carried across from the frozen HomeATA `<head>`: the same title, the
 * same description, the same theme colour.
 *
 * THE FAVICON IS NO LONGER DECLARED HERE. It used to be, and for a good reason
 * at the time: HomeATA's favicon was the authority for Public Home, and the
 * app-wide `src/app/icon.svg` could not be replaced without changing the icon
 * for every authenticated surface — outside what that phase was allowed to
 * touch. So the override was scoped to this one route.
 *
 * That scope is exactly what left the rest of the product on the old navy mark.
 * The app now declares one favicon in the root layout and this route inherits
 * it, so the override is gone rather than duplicated.
 */
const TITLE = "ATA — последовательный путь в трейдинге";
const DESCRIPTION =
  "Alpha Trade Academy — последовательный путь обучения трейдингу: знания, практика, обратная связь и видимый прогресс.";

/**
 * THE SOCIAL PREVIEW. A static 1200×630 render of the hero's own words in the
 * page's own faces, under `public/og/`. It is named only on the indexing host,
 * because a preview needs an absolute address and the pre-production host has
 * none to give: the same rule that keeps the canonical and Open Graph tags off
 * PREPROD keeps the image off it too.
 */
const OG_IMAGE = { path: "/og/home.png", width: 1200, height: 630 } as const;

/**
 * SEARCH INDEXING (owner, 2026-09-21): in production this page is indexed —
 * the Academy's story, with the way to login and registration — and it names
 * its canonical address. Everywhere else, PREPROD included, it is noindex like
 * every other page. Decided per request, so one build serves both hosts.
 */
export function generateMetadata(): Metadata {
  const indexing = searchIndexing();
  if (!indexing.enabled) {
    return { title: TITLE, description: DESCRIPTION, robots: indexableRobots(indexing) };
  }
  const image = {
    url: `${indexing.origin}${OG_IMAGE.path}`,
    width: OG_IMAGE.width,
    height: OG_IMAGE.height,
    alt: "Alpha Trade Academy — Возможности не приходят с готовыми ответами.",
  };
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: indexableRobots(indexing),
    alternates: { canonical: `${indexing.origin}/` },
    openGraph: {
      type: "website",
      url: `${indexing.origin}/`,
      title: TITLE,
      description: DESCRIPTION,
      siteName: "Alpha Trade Academy",
      locale: "ru_RU",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      images: [image.url],
    },
  };
}

export const viewport = { themeColor: "#0B0D0A" };

/**
 * STRUCTURED DATA, on the indexing host only — the same condition as the
 * canonical address, because both name an absolute origin.
 *
 * Two objects and no more. `Organization` says who publishes the page.
 * `FAQPage` repeats the visible FAQ from the one list the screen renders, so
 * the search snippet can never claim an answer the page does not show. Nothing
 * here describes a course, a rating, a price or an outcome: the page promises
 * none, and the markup must not either.
 */
function structuredData(indexing: SearchIndexing & { enabled: true }) {
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Alpha Trade Academy",
    url: `${indexing.origin}/`,
    logo: `${indexing.origin}/brand/ata-logo.svg`,
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: PUBLIC_HOME_FAQ.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
  // `<` is escaped so no text in the list could ever close the script element.
  return JSON.stringify([organization, faq]).replace(/</g, "\\u003c");
}

/**
 * PUBLIC HOME — `/`.
 *
 * Outside the `(app)` route group, which is the whole mechanism: the `(app)`
 * layout is what resolves a session and redirects to `/login`, and this page
 * never enters it.
 *
 * WHY IT RESOLVES A VIEWER AT ALL. So the primary call to action can be
 * truthful: «Начать путь» → /register for a visitor, «Перейти в Академию» →
 * /home for someone already signed in. There is deliberately NO redirect — an
 * authenticated visitor asked for this page and gets it.
 *
 * IT COSTS AN ANONYMOUS VISITOR NOTHING. `getServerViewer()` returns null before
 * issuing any request when there is no session cookie, so the common case for a
 * marketing page performs no Backend call at all. If the Backend is unreachable
 * the helper fails closed to null, which degrades this page to its ordinary
 * public form rather than breaking it.
 */
export const dynamic = "force-dynamic";

export default async function PublicHomePage() {
  const viewer = await getServerViewer();
  const indexing = searchIndexing();
  return (
    <>
      {indexing.enabled ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData(indexing) }} />
      ) : null}
      <PublicHomeScreen authenticated={viewer !== null} />
    </>
  );
}

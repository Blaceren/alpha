/**
 * PHASE-C — the canonical ATA PRODUCT VOCABULARY, owned by Backend.
 *
 * ============================ THE DECISION ============================
 * Tool, rank and community identity is BACKEND-OWNED from here on. Academy
 * consumes it (through the Phase-D DTO contract, see
 * `docs/CONTENT_BLOCKS_V2.md`), and no repository ever imports the other at
 * build or run time.
 *
 * WHY THIS DIRECTION AND NOT THE REVERSE
 * Today the visible catalog lives in Academy: `src/features/tools/model/
 * tool-catalog.ts` joins per-tool copy onto `TOOL_UNLOCKS`, which is derived
 * from `CHECKPOINT_ROWS` in `src/data/curriculum/fixture.ts`. So a tool's
 * IDENTITY and its UNLOCK LEVEL are, today, a side effect of a React fixture.
 * That cannot stand once Backend validates content that links to tools:
 *
 *  - Unlock level is progression truth. It decides what a learner may reach,
 *    and progression truth cannot live in the client that displays it.
 *  - A package validator must reject an unknown tool code BEFORE import, with
 *    no network and no other repository present. Reading Academy at validation
 *    time would make a Backend gate depend on a checkout of a different repo.
 *  - Curriculum structure moved to Backend in this phase (see
 *    `product-ata-100.ts`). Leaving tool identity behind would recreate exactly
 *    the split-source-of-truth this phase exists to end.
 *
 * The alternative — a generated shared vocabulary package copied between repos
 * through a build contract — was rejected as premature: it adds a publishing
 * step and a version skew failure mode to solve a problem one owner solves for
 * free. If a third consumer ever appears, this file is the thing that gets
 * published; nothing about the contract has to change.
 *
 * ACADEMY IS NOT MODIFIED IN THIS PHASE. Until Phase D consumes this vocabulary,
 * Academy's fixture stays where it is.
 *
 * ===================== HOW DRIFT IS ACTUALLY DETECTED =====================
 * An earlier revision of this header claimed «the regression suite pins the two
 * lists to be identical BY VALUE … so a divergence is a test failure». That was
 * FALSE and an independent audit caught it: the suite only ever checked this file
 * against `product-ata-100.ts`, and both are Backend-owned, so the two could
 * drift away from Academy together without a single test failing. Documenting a
 * guarantee that does not exist is worse than having no guarantee, because it
 * stops anyone from looking for one.
 *
 * What exists now is real and mechanical:
 *
 *   scripts/curriculum/verifyAcademyTransfer.ts --academy <path>
 *
 * It re-parses Academy's own `fixture.ts` and re-derives all 100 levels, 20
 * modules, 20 checkpoints, 19 tool unlocks, 5 community unlocks and 20 rank
 * transitions, then compares them to the values below. It takes an EXPLICIT
 * checkout path, is dev/audit only, and nothing in `src/` reaches it — a Backend
 * gate must never depend on someone else's checkout being present.
 *
 * PROVENANCE OF EVERY VALUE BELOW — full digests, so the transfer is re-provable
 *   repo   /srv/ata/repos/academy @ 4c4ced398d2b2a73cdf8d95652b9171b425fdf06
 *   files  docs/CURRICULUM_AND_UNLOCKS.md §3–§5
 *            sha256 51cf7d5b15891819a4af32aa8fb3c194693e278ce7cb1aaa307d89a79486c9f2
 *          src/data/curriculum/fixture.ts CHECKPOINT_ROWS
 *            sha256 52dfedf4755bd89019d6b7017d7d39a7d8f43c2c4e8ac8b15c1d1092c01a6232
 * Transferred by hand, once, and never read at build or run time. Nothing here
 * is invented.
 *
 * DIRECTION OF TRAVEL. This is a one-time transfer, not a synchronisation. The
 * target state is Backend authority with Academy consuming it through the Phase-D
 * DTO contract; the verifier exists to keep the two honest DURING the transfer,
 * and is expected to be retired once Academy stops holding its own copy.
 *
 * DOMAIN PROGRESSION vs DISPLAY METADATA (§12)
 * `unlockLevel` is DOMAIN: it is a fact about which checkpoint level releases
 * the tool, and the platform's access decisions may rely on it. `title` is
 * DISPLAY. There is deliberately no rendering hint, colour, icon or ordering
 * weight in this file — a learner's access must never depend on a decorative
 * value, and a decorative value must never be able to change access.
 *
 * A content block that links to a tool (`tool_link`, `cta action=open_tool`) is
 * DISPLAY ONLY. It does not unlock anything, it does not gate anything, and
 * removing it changes nothing about what a learner may reach.
 */

export type ProductToolCode = (typeof CURRICULUM_TOOLS)[number]["code"];

export type CurriculumTool = {
  /** Canonical, locale-independent identity. Also the Academy route segment. */
  readonly code: string;
  /** Product name. English is the domain language for tools, matching the course. */
  readonly title: string;
  /** DOMAIN: the checkpoint level that releases this tool. */
  readonly unlockLevel: number;
};

/**
 * The 19 curriculum tools, in unlock order (L10 → L100).
 *
 * L4 is the only checkpoint with no tool: it releases a community channel and
 * the first rank instead. That is the shipped product contract, not an omission.
 */
export const CURRICULUM_TOOLS = [
  { code: "tool.trading_journal", title: "Trading Journal", unlockLevel: 10 },
  { code: "tool.risk_calculator", title: "Risk Calculator", unlockLevel: 15 },
  { code: "tool.chart_markup", title: "Chart Markup Tool", unlockLevel: 20 },
  { code: "tool.indicator_checklist", title: "Indicator Checklist", unlockLevel: 25 },
  { code: "tool.news_calendar", title: "News Calendar", unlockLevel: 30 },
  { code: "tool.pause_mode", title: "Pause Mode", unlockLevel: 35 },
  { code: "tool.weekly_review", title: "Weekly Review", unlockLevel: 40 },
  { code: "tool.strategy_builder", title: "Strategy Builder", unlockLevel: 45 },
  { code: "tool.capital_plan", title: "Capital Plan", unlockLevel: 50 },
  { code: "tool.market_regime_board", title: "Market Regime Board", unlockLevel: 55 },
  { code: "tool.session_planner", title: "Session Planner", unlockLevel: 60 },
  { code: "tool.strategy_statistics", title: "Strategy Statistics", unlockLevel: 65 },
  { code: "tool.watchlist", title: "Watchlist", unlockLevel: 70 },
  { code: "tool.psychology_checkin", title: "Psychology Check-in", unlockLevel: 75 },
  { code: "tool.habit_calendar", title: "Habit Calendar", unlockLevel: 80 },
  { code: "tool.mentor_case_room", title: "Mentor Case Room", unlockLevel: 85 },
  { code: "tool.performance_dashboard", title: "Performance Dashboard", unlockLevel: 90 },
  { code: "tool.personal_playbook", title: "Personal Playbook", unlockLevel: 95 },
  { code: "tool.pro_workspace", title: "Pro Workspace", unlockLevel: 100 },
] as const satisfies readonly CurriculumTool[];

/**
 * The referral-gated 20th tool. It has NO unlock level, is not a curriculum
 * unlock, and no checkpoint releases it — its condition is the first qualified
 * referral. Listed so content may legitimately mention it and so the validator
 * can accept the code, kept out of `CURRICULUM_TOOLS` so it can never be
 * mistaken for progression.
 */
export const SECRET_TOOL = { code: "tool.secret", title: "Секретный инструмент" } as const;

/** Every tool code content may reference. */
export const PRODUCT_TOOL_CODES: ReadonlySet<string> = new Set<string>([
  ...CURRICULUM_TOOLS.map((tool) => tool.code),
  SECRET_TOOL.code,
]);

export function isProductToolCode(value: unknown): value is string {
  return typeof value === "string" && PRODUCT_TOOL_CODES.has(value);
}

export function curriculumToolByCode(code: string): CurriculumTool | null {
  return CURRICULUM_TOOLS.find((tool) => tool.code === code) ?? null;
}

/* ------------------------------------------------------------------ *
 * Community channels
 * ------------------------------------------------------------------ */

export type CommunityChannel = {
  readonly code: string;
  readonly title: string;
  readonly unlockLevel: number;
};

/** The 5 community unlocks: L4, L20, L35, L45, L85. */
export const COMMUNITY_CHANNELS = [
  { code: "channel.start_questions", title: "Старт и вопросы", unlockLevel: 4 },
  { code: "channel.chart_review", title: "Разбор графиков", unlockLevel: 20 },
  { code: "channel.discipline_journal", title: "Дисциплина и дневник", unlockLevel: 35 },
  { code: "channel.strategies", title: "Стратегии", unlockLevel: 45 },
  { code: "channel.advanced_circle", title: "Продвинутый круг", unlockLevel: 85 },
] as const satisfies readonly CommunityChannel[];

export const COMMUNITY_CHANNEL_CODES: ReadonlySet<string> = new Set(
  COMMUNITY_CHANNELS.map((channel) => channel.code),
);

/* ------------------------------------------------------------------ *
 * Ranks
 * ------------------------------------------------------------------ */

export const RANK_FAMILIES = ["observer", "analyst", "tactician", "strategist", "architect"] as const;
export type RankFamily = (typeof RANK_FAMILIES)[number];

export type RankTransition = {
  readonly code: string;
  readonly family: RankFamily;
  readonly tier: 1 | 2 | 3 | 4;
  readonly unlockLevel: number;
};

/** 20 ranks, one per checkpoint, four tiers per family. */
export const RANK_TRANSITIONS: readonly RankTransition[] = (
  [
    [4, "observer", 1],
    [10, "observer", 2],
    [15, "observer", 3],
    [20, "observer", 4],
    [25, "analyst", 1],
    [30, "analyst", 2],
    [35, "analyst", 3],
    [40, "analyst", 4],
    [45, "tactician", 1],
    [50, "tactician", 2],
    [55, "tactician", 3],
    [60, "tactician", 4],
    [65, "strategist", 1],
    [70, "strategist", 2],
    [75, "strategist", 3],
    [80, "strategist", 4],
    [85, "architect", 1],
    [90, "architect", 2],
    [95, "architect", 3],
    [100, "architect", 4],
  ] as const
).map(([unlockLevel, family, tier]) => ({
  code: `rank.${family}_${tier}`,
  family,
  tier,
  unlockLevel,
}));

export const RANK_CODES: ReadonlySet<string> = new Set(RANK_TRANSITIONS.map((rank) => rank.code));

/* ------------------------------------------------------------------ *
 * Obsolete product brands — §15
 * ------------------------------------------------------------------ */

/**
 * Product names that must never appear in generated or approved ATA content.
 *
 * «TradeQuest» is the pre-rename working title. It survives in the canonical
 * editorial brief (`les-prog.txt`) and in Academy's own legacy notes, which
 * document the rename; those are historical records and are NOT production
 * package inputs, so nothing here touches them. What this list does is refuse a
 * package that would SHIP the old name to a learner.
 *
 * Matching is deliberately narrow — a case-insensitive whole-word match on the
 * brand — so it cannot fire on ordinary lesson prose. The canonical replacement
 * is recorded so the converter's substitution is reviewable rather than magic.
 */
export const OBSOLETE_PRODUCT_BRANDS = [
  { marker: "TradeQuest", pattern: /\btradequest\b/i, replacement: "Alfa Trade Academy" },
] as const;

/** The obsolete brand this text carries, or null. Never echoes the text back. */
export function findObsoleteBrand(value: string): string | null {
  return OBSOLETE_PRODUCT_BRANDS.find((brand) => brand.pattern.test(value))?.marker ?? null;
}

/** Apply every canonical brand replacement. Deterministic and idempotent. */
export function replaceObsoleteBrands(value: string): string {
  return OBSOLETE_PRODUCT_BRANDS.reduce(
    (text, brand) => text.replace(new RegExp(brand.pattern.source, "gi"), brand.replacement),
    value,
  );
}

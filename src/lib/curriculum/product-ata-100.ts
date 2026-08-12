/**
 * PHASE-C — the canonical ATA 100-level STRUCTURAL SOURCE, owned by Backend.
 *
 * ============================ WHAT THIS IS ============================
 * The single source of truth for the shape of the ATA curriculum: which levels
 * exist, what they are called, which module they belong to, what kind of work
 * each one is, and which checkpoint releases which unlock. Everything a package
 * needs in order to exist, and nothing that belongs to a content author.
 *
 * Before this file the same facts lived in THREE places that could disagree:
 * Academy's React fixture (structure), `les-prog.txt` (editorial brief), and
 * Backend's 4-level approved slice (production truth). Backend is now
 * authoritative for structure; Academy's fixture becomes preview/test data, and
 * the editorial brief becomes an INPUT to authoring, not a source of truth.
 * Neither is deleted, and neither is read at build or run time.
 *
 * ========================== PROVENANCE (exact) ==========================
 *   repo   /srv/ata/repos/academy @ 4c4ced398d2b2a73cdf8d95652b9171b425fdf06
 *   files  src/data/curriculum/fixture.ts    sha256 52dfedf4755bd89019d6b7017d7d39a7d8f43c2c4e8ac8b15c1d1092c01a6232
 *          docs/CURRICULUM_AND_UNLOCKS.md    sha256 51cf7d5b15891819a4af32aa8fb3c194693e278ce7cb1aaa307d89a79486c9f2
 *   what   MODULE_ROWS, LEVEL_ROWS, CHECKPOINT_ROWS — transferred by value, once.
 *   L1–L4  titles, artifacts and codes additionally agree, character for
 *          character, with the APPROVED package
 *          `curriculum/packages/ata-v2-first-slice.rev3.approved.json`, which is
 *          the stronger authority where the two could ever differ.
 *
 * ======================== STABLE CODE IDENTITY ========================
 * Canonical identity is `v2.lNNN.<slug>` (V2_PRODUCT_DECISIONS.md §8), NOT
 * Academy's `level.NNN`. The slug is a deterministic transliteration of the
 * canonical title; `canonicalLevelCode` below is the only place that composes
 * one. The mapping from the old fixture id is exact and total:
 * `level.NNN` ⇄ `levelNumber` ⇄ `v2.lNNN.<slug>` (see `legacyAcademyLevelCode`).
 *
 * ============================ WHAT IS ABSENT ============================
 * No lesson prose, no assessment, no XP schedule and no environment knowledge.
 * Educational copy is authored against `docs/CONTENT_AUTHORING_TEMPLATE.md`;
 * staging attestation stays in the Phase-A domain and never enters curriculum
 * content.
 */
import {
  PRACTICAL_MANUAL_CONTRACT,
  PRACTICAL_MENTOR_REVIEW_CONTRACT,
  resolvePracticalLevelContract,
} from "@/lib/curriculum/practical-mapping";

/** What kind of work a level is, in the product's own words. */
export type AtaLevelKind =
  /** L1 only — the external Pocket registration gate. */
  | "registration"
  /** A taught lesson followed by its assessment. */
  | "video_test"
  /** A structured report the learner submits for approval. */
  | "report"
  /** A practical exercise producing an artifact. Labelled «Практика» to learners. */
  | "practical"
  /** A financial checkpoint. Never self-completable. */
  | "checkpoint";

export type AtaLevelSource = {
  readonly levelNumber: number;
  /** The slug half of the canonical stable code. */
  readonly slug: string;
  readonly title: string;
  readonly kind: AtaLevelKind;
  readonly moduleNumber: number;
  /** The artifact the learner produces, verbatim from the canonical source. */
  readonly artifact: string | null;
  /** True for the 7 practical levels that are mentor-reviewed. */
  readonly mentorReview: boolean;
};

export type AtaModuleSource = {
  readonly moduleNumber: number;
  readonly title: string;
  readonly description: string;
  readonly startLevel: number;
  readonly endLevel: number;
};

export type AtaCheckpointSource = {
  readonly levelNumber: number;
  /** Minimum REAL Pocket balance. Demo does not count. */
  readonly thresholdUsd: number;
  /**
   * The SAME threshold in the units the runtime requirement actually stores.
   *
   * `LevelCheckpointRequirement` has no dollars column: it has
   * `thresholdCurrency` + `thresholdMinorUnits`, both NOT NULL, and
   * `checkpoint-verification.ts` compares integers. `thresholdUsd` alone could
   * therefore never reach the database, which is why the 20 checkpoints have
   * had no requirement row and every verification returned
   * `CHECKPOINT_REQUIREMENT_UNCONFIGURED`.
   *
   * Written as an EXPLICIT LITERAL per row rather than computed from
   * `thresholdUsd`, because a threshold a learner's money is measured against
   * must be readable in the source it is approved in — not the output of an
   * expression. `assertCheckpointRowsConsistent` below then proves the two
   * columns still agree, so a typo is a build failure rather than a wrong gate.
   *
   * The convention is the platform's existing one and is not invented here:
   * `analytics/decimal.ts::AMOUNT_SCALE = 2` for Pocket amounts, the accepted
   * L4 requirement live on PREPROD (`USD`, `5000`), and
   * `curriculum/candidates/ata-v2-checkpoint-requirement.rev4-candidate.json`
   * ("5000 minor units = USD 50.00") all say the same thing.
   */
  readonly thresholdMinorUnits: number;
  /** ISO-4217. `LevelCheckpointRequirement` accepts USD and nothing else. */
  readonly thresholdCurrency: "USD";
  readonly rankCode: string;
  /** L4 is the one checkpoint that releases no tool. */
  readonly toolCode: string | null;
  readonly channelCode: string | null;
};

/* ------------------------------------------------------------------ *
 * Rows: [moduleNumber, title, description, startLevel, endLevel]
 * ------------------------------------------------------------------ */
const MODULE_ROWS: ReadonlyArray<readonly [number, string, string, number, number]> = [
  [ 1, "Первое знакомство", "Регистрация Pocket, устройство академии и первые demo-сделки.", 1, 4],
  [ 2, "Как работает сделка", "Жизненный цикл сделки, экспирация, активы и решение о входе.", 5, 10],
  [ 3, "Управление риском", "Торговый капитал, размер позиции, лимиты потерь и личный Risk Plan.", 11, 15],
  [ 4, "Чтение графика", "Свечи, тренд и диапазон, уровни поддержки и сопротивления, разметка.", 16, 20],
  [ 5, "Индикаторы", "Stochastic, Bollinger Bands, объединение сигналов и ложные сигналы.", 21, 25],
  [ 6, "Новости", "Экономический календарь, реакция цены и план работы вокруг новостей.", 26, 30],
  [ 7, "Психология новичка", "Страх потери, revenge trading, FOMO и Pause Protocol.", 31, 35],
  [ 8, "Торговый дневник", "Записи до и после сделки, недельный обзор.", 36, 40],
  [ 9, "Первая стратегия", "Setup, правила входа, таймфрейм и карточка стратегии.", 41, 45],
  [10, "Капитал и просадка", "Просадка, восстановление и Capital Protection Plan.", 46, 50],
  [11, "Рыночные режимы", "Таймфреймы, тренд и боковик, волатильность, выбор setup под режим.", 51, 55],
  [12, "Исполнение", "Подготовка к сессии, качество входа, overtrading и аудит сессии.", 56, 60],
  [13, "Статистика", "Win rate, математическое ожидание, размер выборки и анализ.", 61, 65],
  [14, "Активы", "Специализация, корреляция, ограничение внимания и watchlist.", 66, 70],
  [15, "Продвинутая психология", "Tilt, усталость, уверенность против данных и аудит.", 71, 75],
  [16, "Привычка", "Устойчивый режим, ритуалы и план дисциплины на 30 дней.", 76, 80],
  [17, "Кейсы", "Полный торговый кейс, неполная информация и защита решения.", 81, 85],
  [18, "Аналитика результатов", "Equity curve, серии и variance, устойчивость стратегии.", 86, 90],
  [19, "Личный Playbook", "Структура playbook, правила входа и отказа, личные red flags.", 91, 95],
  [20, "Самостоятельная система", "Teach-back, план на 90 дней и финальный экзамен.", 96, 100],
];

/* ------------------------------------------------------------------ *
 * Rows: [levelNumber, slug, title, kind, artifact, mentorReview]
 * ------------------------------------------------------------------ */
const LEVEL_ROWS: ReadonlyArray<
  readonly [number, string, string, AtaLevelKind, string | null, boolean]
> = [
  [  1, "registraciya-pocket"                 , "Регистрация Pocket"                        , "registration", "Регистрация и подтверждение аккаунта Pocket", false],
  [  2, "kak-ustroen-alfa-trade-academy"      , "Как устроен Alfa Trade Academy"            , "video_test" , null, false],
  [  3, "pervye-pyat-demo-sdelok"             , "Первые пять demo-сделок"                   , "report"     , "Отчёт по 5 demo-сделкам", false],
  [  4, "kontrolnaya-tochka-50"               , "Контрольная точка $50"                     , "checkpoint" , null, false],
  [  5, "zhiznennyy-cikl-sdelki"              , "Жизненный цикл сделки"                     , "video_test" , null, false],
  [  6, "ekspiraciya-i-payout"                , "Экспирация и payout"                       , "video_test" , null, false],
  [  7, "aktivy-vremya-i-otc"                 , "Активы, время и OTC"                       , "video_test" , null, false],
  [  8, "voyti-ili-otkazatsya"                , "Войти или отказаться"                      , "video_test" , "Сценарии «войти / ждать / отказаться»", false],
  [  9, "checklist-pered-vhodom"              , "Checklist перед входом"                    , "practical"  , "Собственный checklist", false],
  [ 10, "kontrolnaya-tochka-100"              , "Контрольная точка $100"                    , "checkpoint" , null, false],
  [ 11, "torgovyy-kapital"                    , "Торговый капитал"                          , "video_test" , null, false],
  [ 12, "razmer-pozicii-i-serii-ubytkov"      , "Размер позиции и серии убытков"            , "video_test" , null, false],
  [ 13, "dnevnoy-limit-poter"                 , "Дневной лимит потерь"                      , "video_test" , null, false],
  [ 14, "lichnyy-risk-plan"                   , "Личный Risk Plan"                          , "practical"  , "Risk Plan", true],
  [ 15, "kontrolnaya-tochka-150"              , "Контрольная точка $150"                    , "checkpoint" , null, false],
  [ 16, "svechi"                              , "Свечи"                                     , "video_test" , null, false],
  [ 17, "trend-i-diapazon"                    , "Тренд и диапазон"                          , "video_test" , null, false],
  [ 18, "podderzhka-i-soprotivlenie"          , "Поддержка и сопротивление"                 , "video_test" , null, false],
  [ 19, "razmetka-grafika"                    , "Разметка графика"                          , "practical"  , "Разметка 3 графиков", false],
  [ 20, "kontrolnaya-tochka-200"              , "Контрольная точка $200"                    , "checkpoint" , null, false],
  [ 21, "stochastic"                          , "Stochastic"                                , "video_test" , null, false],
  [ 22, "bollinger-bands"                     , "Bollinger Bands"                           , "video_test" , null, false],
  [ 23, "obedinenie-signalov"                 , "Объединение сигналов"                      , "video_test" , null, false],
  [ 24, "lozhnye-signaly"                     , "Ложные сигналы"                            , "practical"  , "Разбор сценариев и red flags", false],
  [ 25, "kontrolnaya-tochka-300"              , "Контрольная точка $300"                    , "checkpoint" , null, false],
  [ 26, "ekonomicheskiy-kalendar"             , "Экономический календарь"                   , "video_test" , null, false],
  [ 27, "reakciya-ceny-na-novosti"            , "Реакция цены на новости"                   , "video_test" , null, false],
  [ 28, "kogda-ne-stoit-torgovat"             , "Когда не стоит торговать"                  , "video_test" , null, false],
  [ 29, "plan-raboty-vokrug-novostey"         , "План работы вокруг новостей"               , "practical"  , "План вокруг новостей", true],
  [ 30, "kontrolnaya-tochka-400"              , "Контрольная точка $400"                    , "checkpoint" , null, false],
  [ 31, "strah-poteri"                        , "Страх потери"                              , "video_test" , null, false],
  [ 32, "revenge-trading"                     , "Revenge trading"                           , "video_test" , null, false],
  [ 33, "fomo"                                , "FOMO"                                      , "video_test" , null, false],
  [ 34, "pause-protocol"                      , "Pause Protocol"                            , "practical"  , "Триггеры, длительность, возврат", false],
  [ 35, "kontrolnaya-tochka-500"              , "Контрольная точка $500"                    , "checkpoint" , null, false],
  [ 36, "pochemu-pamyat-obmanyvaet"           , "Почему память обманывает"                  , "video_test" , null, false],
  [ 37, "zapis-do-sdelki"                     , "Запись до сделки"                          , "video_test" , null, false],
  [ 38, "zapis-posle-sdelki"                  , "Запись после сделки"                       , "video_test" , null, false],
  [ 39, "nedelnyy-obzor"                      , "Недельный обзор"                           , "practical"  , "Weekly review", false],
  [ 40, "kontrolnaya-tochka-750"              , "Контрольная точка $750"                    , "checkpoint" , null, false],
  [ 41, "chto-takoe-setup"                    , "Что такое setup"                           , "video_test" , null, false],
  [ 42, "chetkie-pravila-vhoda"               , "Чёткие правила входа"                      , "video_test" , null, false],
  [ 43, "taymfreym-i-ekspiraciya"             , "Таймфрейм и экспирация"                    , "video_test" , null, false],
  [ 44, "kartochka-strategii"                 , "Карточка стратегии"                        , "practical"  , "Strategy Card", true],
  [ 45, "kontrolnaya-tochka-1000"             , "Контрольная точка $1,000"                  , "checkpoint" , null, false],
  [ 46, "prosadka"                            , "Просадка"                                  , "video_test" , null, false],
  [ 47, "vosstanovlenie-posle-prosadki"       , "Восстановление после просадки"             , "video_test" , null, false],
  [ 48, "raspredelenie-kapitala"              , "Распределение капитала"                    , "video_test" , null, false],
  [ 49, "capital-protection-plan"             , "Capital Protection Plan"                   , "practical"  , "Уровни предупреждения, паузы и восстановления", false],
  [ 50, "kontrolnaya-tochka-1500"             , "Контрольная точка $1,500"                  , "checkpoint" , null, false],
  [ 51, "neskolko-taymfreymov"                , "Несколько таймфреймов"                     , "video_test" , null, false],
  [ 52, "trend-i-bokovik"                     , "Тренд и боковик"                           , "video_test" , null, false],
  [ 53, "volatilnost"                         , "Волатильность"                             , "video_test" , null, false],
  [ 54, "vybor-setup-pod-rezhim"              , "Выбор setup под режим"                     , "practical"  , "Сценарии выбора и отказа", false],
  [ 55, "kontrolnaya-tochka-2000"             , "Контрольная точка $2,000"                  , "checkpoint" , null, false],
  [ 56, "podgotovka-k-sessii"                 , "Подготовка к сессии"                       , "video_test" , null, false],
  [ 57, "kachestvo-vhoda"                     , "Качество входа"                            , "video_test" , null, false],
  [ 58, "overtrading"                         , "Overtrading"                               , "video_test" , null, false],
  [ 59, "audit-sessii"                        , "Аудит сессии"                              , "practical"  , "Сравнение плана и действий", true],
  [ 60, "kontrolnaya-tochka-2500"             , "Контрольная точка $2,500"                  , "checkpoint" , null, false],
  [ 61, "win-rate"                            , "Win rate"                                  , "video_test" , null, false],
  [ 62, "matematicheskoe-ozhidanie"           , "Математическое ожидание"                   , "video_test" , null, false],
  [ 63, "razmer-vyborki"                      , "Размер выборки"                            , "video_test" , null, false],
  [ 64, "analiz-statistiki"                   , "Анализ статистики"                         , "practical"  , "Разбивка по setup, времени, активу и режиму", false],
  [ 65, "kontrolnaya-tochka-3000"             , "Контрольная точка $3,000"                  , "checkpoint" , null, false],
  [ 66, "specializaciya"                      , "Специализация"                             , "video_test" , null, false],
  [ 67, "korrelyaciya"                        , "Корреляция"                                , "video_test" , null, false],
  [ 68, "ogranichenie-vnimaniya"              , "Ограничение внимания"                      , "video_test" , null, false],
  [ 69, "nedelnyy-watchlist"                  , "Недельный Watchlist"                       , "practical"  , "Watchlist с причинами", false],
  [ 70, "kontrolnaya-tochka-4000"             , "Контрольная точка $4,000"                  , "checkpoint" , null, false],
  [ 71, "tilt"                                , "Tilt"                                      , "video_test" , null, false],
  [ 72, "ustalost"                            , "Усталость"                                 , "video_test" , null, false],
  [ 73, "uverennost-protiv-dannyh"            , "Уверенность против данных"                 , "video_test" , null, false],
  [ 74, "psihologicheskiy-audit"              , "Психологический аудит"                     , "practical"  , "Триггеры и правила", true],
  [ 75, "kontrolnaya-tochka-5000"             , "Контрольная точка $5,000"                  , "checkpoint" , null, false],
  [ 76, "ustoychivyy-rezhim"                  , "Устойчивый режим"                          , "video_test" , null, false],
  [ 77, "dnevnoy-i-nedelnyy-ritual"           , "Дневной и недельный ритуал"                , "video_test" , null, false],
  [ 78, "vozvraschenie-posle-pereryva"        , "Возвращение после перерыва"                , "video_test" , null, false],
  [ 79, "plan-discipliny-na-30-dney"          , "План дисциплины на 30 дней"                , "practical"  , "Персональный график", false],
  [ 80, "kontrolnaya-tochka-6000"             , "Контрольная точка $6,000"                  , "checkpoint" , null, false],
  [ 81, "polnyy-torgovyy-keys"                , "Полный торговый кейс"                      , "video_test" , null, false],
  [ 82, "nepolnaya-informaciya"               , "Неполная информация"                       , "video_test" , null, false],
  [ 83, "biblioteka-oshibok"                  , "Библиотека ошибок"                         , "practical"  , "5 карточек ошибок", false],
  [ 84, "zaschita-resheniya"                  , "Защита решения"                            , "practical"  , "Защита кейса", true],
  [ 85, "kontrolnaya-tochka-7000"             , "Контрольная точка $7,000"                  , "checkpoint" , null, false],
  [ 86, "equity-curve"                        , "Equity curve"                              , "video_test" , null, false],
  [ 87, "serii-i-variance"                    , "Серии и variance"                          , "video_test" , null, false],
  [ 88, "ustoychivost-strategii"              , "Устойчивость стратегии"                    , "video_test" , null, false],
  [ 89, "plan-uluchsheniya"                   , "План улучшения"                            , "practical"  , "Одна проблема / одно изменение", false],
  [ 90, "kontrolnaya-tochka-8000"             , "Контрольная точка $8,000"                  , "checkpoint" , null, false],
  [ 91, "struktura-playbook"                  , "Структура Playbook"                        , "video_test" , null, false],
  [ 92, "pravila-vhoda-i-otkaza"              , "Правила входа и отказа"                    , "video_test" , null, false],
  [ 93, "lichnye-red-flags"                   , "Личные Red Flags"                          , "video_test" , null, false],
  [ 94, "mentor-review-playbook"              , "Mentor Review Playbook"                    , "practical"  , "Playbook на проверку", true],
  [ 95, "kontrolnaya-tochka-9000"             , "Контрольная точка $9,000"                  , "checkpoint" , null, false],
  [ 96, "teach-back"                          , "Teach-back"                                , "video_test" , null, false],
  [ 97, "plan-na-90-dney"                     , "План на 90 дней"                           , "video_test" , null, false],
  [ 98, "plan-deystviy-pri-prosadke"          , "План действий при просадке"                , "video_test" , null, false],
  [ 99, "finalnyy-ekzamen"                    , "Финальный экзамен"                         , "practical"  , "Финальный экзамен", false],
  [100, "kontrolnaya-tochka-10000"            , "Контрольная точка $10,000"                 , "checkpoint" , null, false],
];

/* ------------------------------------------------------------------ *
 * Rows: [levelNumber, thresholdUsd, thresholdMinorUnits, rankCode,
 *        toolCode, channelCode]
 *
 * The dollar column and the minor-unit column are the SAME approved threshold
 * written twice, deliberately. Every one of the 20 values agrees, character for
 * character, with four independent accepted sources:
 *
 *   src/lib/curriculum/product-ata-100.ts   this table (thresholdUsd)
 *   academy/src/data/curriculum/fixture.ts  LEVEL_ROWS «Контрольная точка $N»
 *   academy/les-prog.txt                    the canonical product document
 *   curriculum/packages/ata-v2-canonical-100*.json   the level titles
 *
 * so no value here is a new product decision. What IS new is that the threshold
 * can now reach `LevelCheckpointRequirement`, which stores integer minor units
 * and no dollars.
 * ------------------------------------------------------------------ */
const CHECKPOINT_ROWS: ReadonlyArray<
  readonly [number, number, number, string, string | null, string | null]
> = [
  [  4,    50,    5_000, "rank.observer_1"       , null                           , "channel.start_questions"],
  [ 10,   100,   10_000, "rank.observer_2"       , "tool.trading_journal"         , null],
  [ 15,   150,   15_000, "rank.observer_3"       , "tool.risk_calculator"         , null],
  [ 20,   200,   20_000, "rank.observer_4"       , "tool.chart_markup"            , "channel.chart_review"],
  [ 25,   300,   30_000, "rank.analyst_1"        , "tool.indicator_checklist"     , null],
  [ 30,   400,   40_000, "rank.analyst_2"        , "tool.news_calendar"           , null],
  [ 35,   500,   50_000, "rank.analyst_3"        , "tool.pause_mode"              , "channel.discipline_journal"],
  [ 40,   750,   75_000, "rank.analyst_4"        , "tool.weekly_review"           , null],
  [ 45,  1000,  100_000, "rank.tactician_1"      , "tool.strategy_builder"        , "channel.strategies"],
  [ 50,  1500,  150_000, "rank.tactician_2"      , "tool.capital_plan"            , null],
  [ 55,  2000,  200_000, "rank.tactician_3"      , "tool.market_regime_board"     , null],
  [ 60,  2500,  250_000, "rank.tactician_4"      , "tool.session_planner"         , null],
  [ 65,  3000,  300_000, "rank.strategist_1"     , "tool.strategy_statistics"     , null],
  [ 70,  4000,  400_000, "rank.strategist_2"     , "tool.watchlist"               , null],
  [ 75,  5000,  500_000, "rank.strategist_3"     , "tool.psychology_checkin"      , null],
  [ 80,  6000,  600_000, "rank.strategist_4"     , "tool.habit_calendar"          , null],
  [ 85,  7000,  700_000, "rank.architect_1"      , "tool.mentor_case_room"        , "channel.advanced_circle"],
  [ 90,  8000,  800_000, "rank.architect_2"      , "tool.performance_dashboard"   , null],
  [ 95,  9000,  900_000, "rank.architect_3"      , "tool.personal_playbook"       , null],
  [100, 10000, 1000_000, "rank.architect_4"      , "tool.pro_workspace"           , null],
];

/** The only currency `LevelCheckpointRequirement` accepts (schema CHECK). */
const CHECKPOINT_CURRENCY = "USD" as const;

/** Minor units per major unit for a two-decimal currency (`AMOUNT_SCALE`). */
const MINOR_UNITS_PER_USD = 100;

/**
 * The two threshold columns must agree, and this is checked at module load.
 *
 * Writing the minor units out by hand is what keeps the approved number
 * readable; this is what stops a hand-written number from being WRONG. A
 * mismatch is a build-time throw, not a gate that silently asks a learner for
 * ten times the money.
 */
function assertCheckpointRowsConsistent(): void {
  for (const [levelNumber, thresholdUsd, thresholdMinorUnits] of CHECKPOINT_ROWS) {
    if (thresholdMinorUnits !== thresholdUsd * MINOR_UNITS_PER_USD) {
      throw new Error(
        `checkpoint level ${levelNumber}: thresholdMinorUnits ${thresholdMinorUnits} does not express USD ${thresholdUsd}`,
      );
    }
    if (!Number.isSafeInteger(thresholdMinorUnits) || thresholdMinorUnits <= 0) {
      throw new Error(`checkpoint level ${levelNumber}: threshold must be a positive integer of minor units`);
    }
  }
}
assertCheckpointRowsConsistent();

export const ATA_MODULES: readonly AtaModuleSource[] = MODULE_ROWS.map(
  ([moduleNumber, title, description, startLevel, endLevel]) => ({
    moduleNumber,
    title,
    description,
    startLevel,
    endLevel,
  }),
);

export const ATA_LEVELS: readonly AtaLevelSource[] = LEVEL_ROWS.map(
  ([levelNumber, slug, title, kind, artifact, mentorReview]) => ({
    levelNumber,
    slug,
    title,
    kind,
    moduleNumber:
      MODULE_ROWS.find(([, , , start, end]) => levelNumber >= start && levelNumber <= end)?.[0] ?? 0,
    artifact,
    mentorReview,
  }),
);

export const ATA_CHECKPOINTS: readonly AtaCheckpointSource[] = CHECKPOINT_ROWS.map(
  ([levelNumber, thresholdUsd, thresholdMinorUnits, rankCode, toolCode, channelCode]) => ({
    levelNumber,
    thresholdUsd,
    thresholdMinorUnits,
    thresholdCurrency: CHECKPOINT_CURRENCY,
    rankCode,
    toolCode,
    channelCode,
  }),
);

/** The product contract: exactly this many, and nothing about it is derived. */
export const ATA_LEVEL_COUNT = 100 as const;
export const ATA_MODULE_COUNT = 20 as const;
export const ATA_CHECKPOINT_COUNT = 20 as const;
export const ATA_TOOL_UNLOCK_COUNT = 19 as const;
export const ATA_COMMUNITY_UNLOCK_COUNT = 5 as const;
export const ATA_PRACTICAL_COUNT = 20 as const;
export const ATA_MENTOR_REVIEW_COUNT = 7 as const;

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

export function pad3(levelNumber: number): string {
  return String(levelNumber).padStart(3, "0");
}

/** The ONE place a canonical level code is composed. */
export function canonicalLevelCode(level: AtaLevelSource): string {
  return `v2.l${pad3(level.levelNumber)}.${level.slug}`;
}

/** Canonical module code, matching the shipped approved package (`module.01`). */
export function canonicalModuleCode(moduleNumber: number): string {
  return `module.${String(moduleNumber).padStart(2, "0")}`;
}

/**
 * The deterministic mapping FROM the old Academy fixture id. Kept so a
 * historical reference (`level.018`) can always be resolved to canonical
 * identity without guessing, and so the two id spaces can be proven total
 * against each other in tests. Nothing in production consumes the old form.
 */
export function legacyAcademyLevelCode(levelNumber: number): string {
  return `level.${pad3(levelNumber)}`;
}

export function levelNumberFromLegacyAcademyCode(code: string): number | null {
  const match = /^level\.(\d{3})$/.exec(code);
  if (!match) return null;
  const levelNumber = Number(match[1]);
  return levelNumber >= 1 && levelNumber <= ATA_LEVEL_COUNT ? levelNumber : null;
}

/* ------------------------------------------------------------------ *
 * Kind → completion contract
 * ------------------------------------------------------------------ */

export type AtaCompletionContract = {
  readonly type: string;
  readonly completionMethod: string;
};

/**
 * The canonical mapping from an editorial level kind to a package
 * type/completionMethod pair. Total: every kind has exactly one answer.
 *
 * The practical answer is NOT decided here — it is delegated to
 * `resolvePracticalLevelContract` (product decision R1, accepted in Phase A):
 * mentor-reviewed practicals are `mentor_review:mentor_review`, the rest are
 * `lesson:manual`. Restating that rule locally is exactly how two sources of
 * truth start.
 */
export function completionContractFor(level: AtaLevelSource): AtaCompletionContract {
  switch (level.kind) {
    case "registration":
      return { type: "external_event", completionMethod: "pocket_postback" };
    case "checkpoint":
      return { type: "financial_checkpoint", completionMethod: "balance_check" };
    case "video_test":
      return { type: "lesson", completionMethod: "assessment_pass" };
    case "report":
      return { type: "report", completionMethod: "report_approval" };
    case "practical":
      return resolvePracticalLevelContract({ mentorReview: level.mentorReview });
  }
}

/** The two contracts a practical level may take, re-exported for readability. */
export { PRACTICAL_MANUAL_CONTRACT, PRACTICAL_MENTOR_REVIEW_CONTRACT };

/**
 * Gate integration codes, matching the shipped approved package exactly.
 *
 * The checkpoint form is `checkpoint.module-NN`, NOT
 * `checkpoint.${canonicalModuleCode(n)}` — the approved level 4 gate declares
 * `checkpoint.module-01`, with a hyphen, while a module CODE uses a dot
 * (`module.01`). They look like the same string and are not; composing one from
 * the other silently produces `checkpoint.module.01`, which routes nowhere.
 */
export function gateIntegrationCode(level: AtaLevelSource): string | null {
  if (level.kind === "registration") return "pocket.registration";
  if (level.kind === "checkpoint") {
    return `checkpoint.module-${String(level.moduleNumber).padStart(2, "0")}`;
  }
  return null;
}

/**
 * G3 — every checkpoint integration code the canonical product declares.
 *
 * WHY THIS LIVES HERE AND NOT IN THE RUNTIME
 * `checkpoint.ts` used to carry a hand-written allowlist containing a single
 * literal, `checkpoint.module-01` — correct when only level 4's gate had been
 * approved, and silently wrong from the moment the canonical 100-level product
 * introduced nineteen more. The runtime then refused nineteen gates it was
 * supposed to open, with `integration_unknown`, and no test noticed because the
 * allowlist and the curriculum had no shared source.
 *
 * Deriving the set from `gateIntegrationCode` — the ONE function that composes an
 * integration code anywhere in this repository — makes that divergence
 * unrepresentable: the string the package builder writes into
 * `LevelDefinition.featureUnlockCode` and the string the runtime recognises are
 * now produced by the same expression, so they cannot disagree by construction.
 *
 * This is a VOCABULARY, not an authorization. Recognising a code means only "this
 * is a gate the platform understands". Everything that decides whether a
 * particular learner may pass it — the capability flags, the provider, the
 * `LevelCheckpointRequirement` threshold, the cooldown, the attempt allowance —
 * is unchanged and still checked afterwards, in that order.
 */
export const ATA_CHECKPOINT_INTEGRATION_CODES: readonly string[] = Object.freeze(
  ATA_LEVELS.filter((level) => level.kind === "checkpoint")
    .map((level) => gateIntegrationCode(level))
    .filter((code): code is string => code !== null),
);

/**
 * The runtime requirement a `financial_checkpoint` gate must carry, or null for
 * every other level — including L1, whose gate is an `external_event` and has no
 * threshold at all.
 *
 * This is the ONE place a package-shaped checkpoint requirement is composed, for
 * the same reason `gateIntegrationCode` is the one place an integration code is:
 * a threshold assembled at two call sites is a threshold that can disagree with
 * itself.
 */
export function checkpointRequirementFor(
  level: AtaLevelSource,
): { readonly thresholdCurrency: "USD"; readonly thresholdMinorUnits: number } | null {
  if (level.kind !== "checkpoint") return null;
  const checkpoint = ataCheckpoint(level.levelNumber);
  if (!checkpoint) {
    // Unreachable while ATA_CHECKPOINTS covers every checkpoint level, and a
    // throw rather than a null because a checkpoint with no approved threshold
    // must never be emitted as a gate the runtime cannot verify.
    throw new Error(`checkpoint level ${level.levelNumber} has no approved threshold`);
  }
  return {
    thresholdCurrency: checkpoint.thresholdCurrency,
    thresholdMinorUnits: checkpoint.thresholdMinorUnits,
  };
}

/* ------------------------------------------------------------------ *
 * Lookups
 * ------------------------------------------------------------------ */

export function ataLevel(levelNumber: number): AtaLevelSource | null {
  return ATA_LEVELS.find((level) => level.levelNumber === levelNumber) ?? null;
}

export function ataModule(moduleNumber: number): AtaModuleSource | null {
  return ATA_MODULES.find((item) => item.moduleNumber === moduleNumber) ?? null;
}

export function ataLevelsOfModule(moduleNumber: number): readonly AtaLevelSource[] {
  return ATA_LEVELS.filter((level) => level.moduleNumber === moduleNumber);
}

export function ataCheckpoint(levelNumber: number): AtaCheckpointSource | null {
  return ATA_CHECKPOINTS.find((item) => item.levelNumber === levelNumber) ?? null;
}

/**
 * Lesson content fixture (Phase D2B) — the single source the lesson UI reads.
 *
 * SCOPE: level 18 «Поддержка и сопротивление» (module 4) is the one fully
 * authored lesson. The other 99 levels are deliberately NOT authored here —
 * D2B builds the lesson EXPERIENCE, not the курс.
 *
 * CONTENT STATUS: provisional development fixture. No approved editorial script
 * or recording exists yet, so the wording below is restrained placeholder-grade
 * educational copy written to be safe and neutral. The PRODUCT RULES and the UX
 * are canonical; the прозе will be replaced by editorial content (DD-243).
 *
 * Structure (level number, module, title, kind, sequence) is NOT redefined here —
 * it is read from the curriculum fixture, which stays the canon.
 *
 * Content constraints honoured: no profit promise, no guarantee, no call to open
 * a trade, no deposit pressure, no buy/sell signal, no fabricated market data,
 * no personal financial advice.
 */

import { getLevel } from "@/data/curriculum/fixture";
import {
  levelCodeFor,
  type LessonDefinition,
  type LessonEntry,
  type LessonStub,
} from "@/features/lesson/model/lesson";

/** Canonical unlock threshold for the assessment (DD-062). */
export const ASSESSMENT_UNLOCK_PERCENT = 50;

/** Deterministic media length: 8:00. Threshold therefore falls at 4:00. */
const L18_DURATION_SECONDS = 480;

const LEVEL_18: LessonDefinition = {
  code: levelCodeFor(18),
  level: getLevel(18),
  goal: "Научиться читать поддержку и сопротивление как области реакции рынка, а не как точные линии.",
  media: {
    kind: "simulated",
    title: "Видеоурок «Поддержка и сопротивление»",
    durationSeconds: L18_DURATION_SECONDS,
    captionsAvailable: true,
    provisionalNote: "Демонстрационная запись урока. Материал занятия готовится редакцией.",
  },
  contentProvisional: true,
  outcomes: [
    {
      id: "outcome.018.1",
      text: "Объяснить, чем область поддержки отличается от области сопротивления.",
    },
    {
      id: "outcome.018.2",
      text: "Показать, почему область размечается зоной, а не одной линией.",
    },
    {
      id: "outcome.018.3",
      text: "Оценить, что добавляет повторная реакция цены в одной и той же области.",
    },
    {
      id: "outcome.018.4",
      text: "Сформулировать, какого подтверждения не хватает, прежде чем считать вывод обоснованным.",
    },
  ],
  sections: [
    {
      id: "section.018.support",
      title: "Область поддержки",
      startSeconds: 0,
      body:
        "Поддержка — участок графика, на котором цена ранее снижалась, встречала устойчивый спрос и переставала падать. " +
        "Это описание прошлого поведения рынка, а не граница, которую кто-то обязан удерживать.",
    },
    {
      id: "section.018.resistance",
      title: "Область сопротивления",
      startSeconds: 95,
      body:
        "Сопротивление — зеркальный случай: цена росла, встречала предложение и переставала расти. " +
        "Обе области описываются одинаково — через то, как рынок реагировал, когда цена сюда приходила.",
    },
    {
      id: "section.018.zones",
      title: "Почему это зоны, а не линии",
      startSeconds: 190,
      body:
        "Реакции почти никогда не приходятся на одну и ту же цену: тени свечей, закрытия и развороты рассеяны по диапазону. " +
        "Зона отражает эту неточность честно, а одна линия создаёт иллюзию, будто рынок знает конкретное число.",
    },
    {
      id: "section.018.repeat",
      title: "Повторная реакция",
      startSeconds: 285,
      body:
        "Когда цена реагирует на одну область несколько раз, вывод опирается не на единичный случай. " +
        "Область заметна многим участникам, и читать график становится легче — но повторение не делает исход обязательным.",
    },
    {
      id: "section.018.confirmation",
      title: "Наблюдение и подтверждение",
      startSeconds: 380,
      body:
        "Подход цены к области — повод наблюдать, а не вывод о том, что произойдёт дальше. " +
        "Уровень не гарантирует разворот и не обязывает к действию: наблюдение и торговое обещание — разные вещи.",
    },
  ],
  requirements: [
    {
      id: "req.018.watch",
      kind: "watch",
      label: "Просмотр видео не менее 50%",
    },
    {
      id: "req.018.assessment",
      kind: "assessment",
      label: "Проверка понимания — 4 вопроса",
    },
  ],
  completionRule: {
    unlockWatchPercent: ASSESSMENT_UNLOCK_PERCENT,
    requiresFullWatch: false,
    requiresAllRequiredQuestionsCorrect: true,
    provisional: true,
  },
  assessment: {
    id: "assessment.018",
    title: "Проверка понимания",
    questions: [
      {
        id: "q.018.1",
        kind: "single-choice",
        required: true,
        prompt: "Что точнее описывает область поддержки?",
        options: [
          {
            id: "q.018.1.a",
            text: "Точная линия цены, ниже которой рынок не опускается.",
            correct: false,
          },
          {
            id: "q.018.1.b",
            text: "Область графика, где цена ранее неоднократно встречала спрос и переставала снижаться.",
            correct: true,
          },
          {
            id: "q.018.1.c",
            text: "Цена, начиная с которой покупка становится безопасной.",
            correct: false,
          },
          {
            id: "q.018.1.d",
            text: "Значение, которое площадка назначает на торговый день.",
            correct: false,
          },
        ],
        feedback: {
          correct:
            "Поддержка описывает прошлые реакции: цена снижалась, встречала спрос и переставала падать. " +
            "Это наблюдение о поведении рынка, а не защищённая граница и не оценка безопасности.",
          incorrect:
            "Поддержка — характеристика того, как цена вела себя раньше, а не гарантированная граница и не признак безопасности. " +
            "Вернись к формулировке: речь об области, где цена ранее переставала снижаться.",
        },
      },
      {
        id: "q.018.2",
        kind: "single-choice",
        required: true,
        prompt: "Почему поддержку и сопротивление размечают зоной, а не одной линией?",
        options: [
          {
            id: "q.018.2.a",
            text: "Зона аккуратнее выглядит на графике.",
            correct: false,
          },
          {
            id: "q.018.2.b",
            text: "Реакции происходят в диапазоне цен, а точные касания одного и того же значения встречаются редко.",
            correct: true,
          },
          {
            id: "q.018.2.c",
            text: "Линии запрещены правилами разметки.",
            correct: false,
          },
          {
            id: "q.018.2.d",
            text: "Зона делает прогноз точнее.",
            correct: false,
          },
        ],
        feedback: {
          correct:
            "Тени, закрытия и развороты рассеяны по диапазону, а не собраны на одном значении. " +
            "Зона показывает эту неточность честно — и не обещает более точный прогноз.",
          incorrect:
            "Дело не в оформлении и не в точности прогноза. Обрати внимание на то, как именно цена реагирует: " +
            "попадания в одно и то же значение почти не встречаются, реакции рассеяны по диапазону.",
        },
      },
      {
        id: "q.018.3",
        kind: "single-choice",
        required: true,
        prompt: "О чём говорит повторная реакция цены в одной и той же области?",
        options: [
          {
            id: "q.018.3.a",
            text: "О том, что разворот в этой области обязателен.",
            correct: false,
          },
          {
            id: "q.018.3.b",
            text: "О том, что область заметна многим участникам, поэтому вывод опирается не на один случай.",
            correct: true,
          },
          {
            id: "q.018.3.c",
            text: "О том, что область перестала работать.",
            correct: false,
          },
          {
            id: "q.018.3.d",
            text: "О том, что здесь стоит увеличить размер позиции.",
            correct: false,
          },
        ],
        feedback: {
          correct:
            "Повторные реакции показывают, что область замечена рынком: вывод опирается на несколько наблюдений, а не на единичный случай. " +
            "Читать график становится легче, но исход это не делает обязательным.",
          incorrect:
            "Повторение усиливает наблюдение, но не превращает его в обязательство и не является поводом менять размер позиции. " +
            "Подумай, что именно добавляют несколько реакций вместо одной — и чего они по-прежнему не обещают.",
        },
      },
      {
        id: "q.018.4",
        kind: "single-choice",
        required: true,
        prompt: "Цена подошла к области сопротивления. Какой вывод корректен?",
        options: [
          {
            id: "q.018.4.a",
            text: "Разворот вниз произойдёт с высокой вероятностью.",
            correct: false,
          },
          {
            id: "q.018.4.b",
            text: "Область будет пробита, раз цена до неё дошла.",
            correct: false,
          },
          {
            id: "q.018.4.c",
            text: "Это наблюдение, которому нужно подтверждение реакцией цены; сам подход к области ничего не решает.",
            correct: true,
          },
          {
            id: "q.018.4.d",
            text: "Настал момент действовать, иначе движение будет упущено.",
            correct: false,
          },
        ],
        feedback: {
          correct:
            "Подход к области — повод наблюдать. Вывод появляется из подтверждения реакцией, а не из самого факта касания. " +
            "Наблюдение и торговое обещание — разные вещи.",
          incorrect:
            "Ни один из этих выводов не следует из самого касания области: уровень не сообщает исход заранее и не обязывает действовать. " +
            "Вернись к разнице между наблюдением и обещанием.",
        },
      },
    ],
  },
};

/**
 * Level 19 «Разметка графика» — a PRACTICAL level (artifact «Разметка 3 графиков»).
 * It has no video lesson and its report/practical experience is out of D2B scope,
 * so only a stub exists: enough for the next-lesson gate to have a real, honest
 * destination. No body, media or assessment is invented for it.
 */
const LEVEL_19: LessonStub = {
  code: levelCodeFor(19),
  level: getLevel(19),
  note:
    "Уровень 19 — практическое задание: нужно разметить три графика и объяснить выделенные области. " +
    "Практические уровни появятся на следующем этапе разработки.",
};

const FULL_LESSONS: Record<number, LessonDefinition> = { 18: LEVEL_18 };
const STUBS: Record<number, LessonStub> = { 19: LEVEL_19 };

/** The level the mock user (Артём) is on — matches the Home and Путь canon. */
export const CURRENT_LESSON_LEVEL = 18;

/** Resolve what exists for a level number, or null when nothing is authored. */
export function getLessonEntry(levelNumber: number): LessonEntry | null {
  const lesson = FULL_LESSONS[levelNumber];
  if (lesson) return { kind: "full", lesson };
  const stub = STUBS[levelNumber];
  if (stub) return { kind: "stub", stub };
  return null;
}

/** The fully authored lesson for a level. Throws — callers use getLessonEntry. */
export function getLesson(levelNumber: number): LessonDefinition {
  const lesson = FULL_LESSONS[levelNumber];
  if (!lesson) throw new Error(`No authored lesson for level ${levelNumber}`);
  return lesson;
}

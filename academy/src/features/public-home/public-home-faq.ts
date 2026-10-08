/**
 * The public home's FAQ — one list, two readers.
 *
 * The screen renders it as the visible `<details>` list, and the page emits it
 * again as `FAQPage` structured data on the indexing host. Keeping both on one
 * array is what makes the second reading truthful: the search snippet can never
 * say something the page does not.
 *
 * Every answer is confirmed by the product as it runs — the program learners
 * have, `ata-v2` (2026-10-04, launch audit; until then the start and the first
 * practice were the 100-level plan's, L1 and L3): registration enrols at L1, the
 * trading environment is level 3, L4 is the first assessment, L9 the first
 * report, every published assessment passes at 100%, levels are sequential,
 * human review exists on the levels that have it. Tuition is free by the owner's word (2026-09-22). The
 * external trading environment is named as such and no further, also by the
 * owner's word: the public page does not talk about the broker, deposits or
 * checkpoints — the last question, «Что такое контрольная точка?», answered in
 * system words («через доступные авторитетные данные») a concept the page
 * never names, and left with the launch audit (2026-10-04).
 */
export type PublicHomeFaqItem = {
  readonly question: string;
  readonly answer: string;
};

export const PUBLIC_HOME_FAQ: ReadonlyArray<PublicHomeFaqItem> = [
  {
    question: "С чего начинается путь?",
    answer:
      "С бесплатной регистрации: сразу открывается первый уровень — вводный урок. Внешняя торговая среда для практики подготавливается на уровне 3.",
  },
  {
    question: "Сколько стоит обучение?",
    answer:
      "Обучение в ATA бесплатно. Уроки, проверки знаний, разбор работ и инструменты не требуют оплаты.",
  },
  {
    question: "Нужен ли опыт в трейдинге?",
    answer: "Нет. ATA рассчитана на непрофессиональных пользователей и строит путь последовательно.",
  },
  {
    question: "Когда начинается практика?",
    answer: "Первая практическая работа с отчётом — на уровне L9: пять demo-сделок по порядку, с записью до входа.",
  },
  {
    question: "Что происходит, если не пройти проверку знаний?",
    answer: "Проверку можно пройти повторно. Для её завершения требуется результат 100%.",
  },
  {
    question: "Кто проверяет практические работы?",
    answer:
      "На предусмотренных уровнях работу проверяет человек. При необходимости пользователь исправляет её и отправляет повторно.",
  },
  {
    question: "Можно ли пропустить уровень?",
    answer:
      "Нет. Путь последовательный: следующий уровень открывается после выполнения условий текущего.",
  },
];

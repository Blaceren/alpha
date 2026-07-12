export type OpenQuestionStatus = "не решено" | "в обсуждении" | "решено";

export type OpenQuestionPriority = "высокий" | "средний" | "низкий";

export type OpenQuestionOwner =
  | "продукт"
  | "разработка"
  | "дизайн"
  | "саппорт";

export type OpenQuestion = {
  id: number;
  title: string;
  description: string;
  status: OpenQuestionStatus;
  priority: OpenQuestionPriority;
  owner: OpenQuestionOwner;
  note: string;
};

export const openQuestionStatuses: OpenQuestionStatus[] = [
  "не решено",
  "в обсуждении",
  "решено",
];

export const mockOpenQuestions: OpenQuestion[] = [
  {
    id: 1,
    title: "Проверка отчётов по сделкам",
    description:
      "Как проверяются отчёты по сделкам: вручную наставником или по факту прикрепления файла?",
    status: "в обсуждении",
    priority: "высокий",
    owner: "продукт",
    note: "Нужно определить механику до backend-модулей заданий.",
  },
  {
    id: 2,
    title: "Веса XP за задания",
    description: "Точные веса XP за разные типы заданий.",
    status: "не решено",
    priority: "высокий",
    owner: "продукт",
    note: "Потребуется таблица начислений для заданий, рефералов и активности.",
  },
  {
    id: 3,
    title: "Полный список CRM-когорт",
    description: "Полный список CRM-когорт и правила попадания.",
    status: "в обсуждении",
    priority: "средний",
    owner: "саппорт",
    note: "Текущие когорты mock, правила нужно синхронизировать с postback-событиями.",
  },
  {
    id: 4,
    title: "Проверка баланса через Telegram-бот биржи",
    description:
      "Техническое решение проверки баланса через Telegram-бот биржи.",
    status: "не решено",
    priority: "высокий",
    owner: "разработка",
    note: "Нужно понять доступные API, формат подтверждения и риски безопасности.",
  },
  {
    id: 5,
    title: "Задания с 9 по 20 уровень",
    description: "Полный список заданий с 9 по 20 уровень.",
    status: "не решено",
    priority: "средний",
    owner: "продукт",
    note: "Пока реализована стартовая цепочка из 8 шагов.",
  },
  {
    id: 6,
    title: "Стиль иконок уровней и бейджей",
    description: "Финальный стиль иконок уровней и бейджей менторов.",
    status: "не решено",
    priority: "низкий",
    owner: "дизайн",
    note: "Дизайн оставлен на финальный этап после совместимости модулей.",
  },
  {
    id: 7,
    title: "Модерация общего чата",
    description: "Правила модерации общего чата.",
    status: "в обсуждении",
    priority: "средний",
    owner: "саппорт",
    note: "Нужно определить правила, жалобы, блокировки и роль админов.",
  },
];

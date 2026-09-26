export type ChatRole = "user" | "mentor" | "admin" | "moderator" | "support" | "news_editor";

export type MockChatMessage = {
  id: number;
  userId?: number | null;
  userName: string;
  userLevel: number;
  userRank: string;
  role: ChatRole;
  mentorBadge?: string;
  achievementTitle?: string;
  message: string;
  time: string;
};

export const chatRoleLabels: Record<ChatRole, string> = {
  user: "участник",
  mentor: "ментор",
  admin: "админ",
  moderator: "модератор",
  support: "поддержка",
  news_editor: "редактор",
};

export const mockChatMessages: MockChatMessage[] = [
  {
    id: 1,
    userName: "Алекс",
    userLevel: 2,
    userRank: "Новичок",
    role: "user",
    message: "Сегодня прохожу этап с демо-сделками. Пока сложно не торопиться со входом.",
    time: "10:05",
  },
  {
    id: 2,
    userName: "Марина",
    userLevel: 4,
    userRank: "Новичок",
    role: "user",
    achievementTitle: "7 дней в обучении",
    message: "Мне помогает чек-лист перед сделкой: тренд, уровень, риск, причина входа.",
    time: "10:08",
  },
  {
    id: 3,
    userName: "Дмитрий",
    userLevel: 9,
    userRank: "Трейдер",
    role: "mentor",
    mentorBadge: "Ментор",
    message: "Перед новостями лучше снижать риск. Волатильность может резко расшириться.",
    time: "10:12",
  },
  {
    id: 4,
    userName: "Игорь",
    userLevel: 1,
    userRank: "Новичок",
    role: "user",
    message: "Где лучше отмечать причины входа: в таблице или прямо в журнале платформы?",
    time: "10:15",
  },
  {
    id: 5,
    userName: "Ольга",
    userLevel: 6,
    userRank: "Практик",
    role: "user",
    message: "Я пока веду таблицу, но хочу потом переносить выводы в отчёты по заданиям.",
    time: "10:17",
  },
  {
    id: 6,
    userName: "Администратор",
    userLevel: 20,
    userRank: "Мастер",
    role: "admin",
    message: "Напоминаем: не публикуйте личные данные и API-ключи в общем чате.",
    time: "10:20",
  },
  {
    id: 7,
    userName: "Сергей",
    userLevel: 3,
    userRank: "Новичок",
    role: "user",
    message: "После трёх сделок подряд заметил, что начинаю нарушать риск. Поставил лимит на день.",
    time: "10:24",
  },
  {
    id: 8,
    userName: "Анна",
    userLevel: 8,
    userRank: "Практик",
    role: "mentor",
    mentorBadge: "Ментор",
    message: "Хорошее решение. Лимит на день защищает от эмоциональной торговли.",
    time: "10:27",
  },
  {
    id: 9,
    userName: "Роман",
    userLevel: 5,
    userRank: "Практик",
    role: "user",
    message: "Кто уже делал отчёт по стохастику? Сколько скриншотов лучше прикладывать?",
    time: "10:31",
  },
];

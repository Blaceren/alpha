export type SupportChatRole = "user" | "admin" | "support" | "mentor";

export type SupportChatMessage = {
  id: number;
  sender: string;
  role: SupportChatRole;
  message: string;
  time: string;
};

export const mockSupportChatMessages: SupportChatMessage[] = [
  {
    id: 1,
    sender: "Алекс",
    role: "user",
    message: "Здравствуйте, я застрял на задании с депозитом.",
    time: "12:10",
  },
  {
    id: 2,
    sender: "Ментор Ирина",
    role: "mentor",
    message: "Здравствуйте. Проверьте, что регистрация была по реферальной ссылке.",
    time: "12:12",
  },
  {
    id: 3,
    sender: "Саппорт",
    role: "support",
    message: "Если аккаунт уже был создан раньше, откройте инструкцию рядом с шагом 4.",
    time: "12:14",
  },
];

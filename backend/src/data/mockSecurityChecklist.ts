export type SecurityChecklistItem = {
  title: string;
  description: string;
};

export const securityChecklist: SecurityChecklistItem[] = [
  {
    title: "Авторизация и роли",
    description:
      "Разделить роли пользователя, ментора, администратора, модератора, редактора новостей и саппорта.",
  },
  {
    title: "Защита базы данных",
    description:
      "Ограничить доступ по ролям, хранить секреты отдельно и не отдавать приватные поля на клиент.",
  },
  {
    title: "Защита API",
    description:
      "Проверять права доступа, валидировать входные данные и использовать серверные проверки.",
  },
  {
    title: "Rate limit",
    description:
      "Ограничить частоту запросов на авторизацию, postback endpoints и чувствительные операции.",
  },
  {
    title: "Защита от brute-force",
    description:
      "Добавить блокировки, задержки и логирование повторяющихся неудачных попыток.",
  },
  {
    title: "Защита postback endpoint",
    description:
      "Проверять подписи, источник события, idempotency key и повторные события биржи.",
  },
  {
    title: "Логирование действий",
    description:
      "Фиксировать важные действия пользователя, админа и staff-ролей для аудита.",
  },
  {
    title: "Anti-DDoS через Cloudflare",
    description:
      "Использовать WAF, rate limiting и базовые правила защиты на уровне Cloudflare.",
  },
  {
    title: "Защита контента",
    description:
      "Ограничить доступ к урокам, проверять права и не отдавать закрытые материалы без доступа.",
  },
  {
    title: "Watermark на обучающих материалах",
    description:
      "Добавить видимые или скрытые метки: email, user ID и дату просмотра.",
  },
];

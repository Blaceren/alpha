import type { ExchangePostback } from "@/types/exchange";

export const mockPostbacks: ExchangePostback[] = [
  {
    id: 1,
    type: "Registration",
    date: "2026-06-27 12:00",
    amount: 0,
    status: "получено",
    rawPayload: "{\"event\":\"Registration\",\"account\":\"EX-DEMO-2048\"}",
  },
  {
    id: 2,
    type: "Email Confirmation",
    date: "2026-06-27 12:05",
    amount: 0,
    status: "получено",
    rawPayload:
      "{\"event\":\"Email Confirmation\",\"account\":\"EX-DEMO-2048\"}",
  },
  {
    id: 3,
    type: "Commission",
    date: "2026-06-27 12:30",
    amount: 12,
    status: "обработано",
    rawPayload: "{\"event\":\"Commission\",\"amount\":12}",
  },
  {
    id: 4,
    type: "New Withdrawal",
    date: "2026-06-27 12:45",
    amount: 100,
    status: "получено",
    rawPayload: "{\"event\":\"New Withdrawal\",\"amount\":100}",
  },
  {
    id: 5,
    type: "Canceled Withdrawal",
    date: "2026-06-27 12:50",
    amount: 100,
    status: "обработано",
    rawPayload: "{\"event\":\"Canceled Withdrawal\",\"amount\":100}",
  },
  {
    id: 6,
    type: "Successful Withdrawal",
    date: "2026-06-27 13:00",
    amount: 50,
    status: "обработано",
    rawPayload: "{\"event\":\"Successful Withdrawal\",\"amount\":50}",
  },
];

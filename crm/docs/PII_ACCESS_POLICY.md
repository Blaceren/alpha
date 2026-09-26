# PII_ACCESS_POLICY.md — Alfa Trade Academy CRM

> Phase 0.5 · Политика доступа к персональным данным (PII). Единый источник правды по маскированию и раскрытию.
> Статус: Утверждено (Decision Lock, DECISIONS D-11).

---

## 1. Принципы

1. **Минимизация по умолчанию:** показывать наименьший объём identity, достаточный для роли.
2. **Masked-first:** в списках PII всегда маскирован, независимо от роли.
3. **Reveal под контролем:** полное раскрытие — только явным действием, с reason и audit, с авто-скрытием.
4. **Никаких секретов:** postback secret, сырой playerId/clickid, полный незамаскированный email вне разрешённого reveal — `RESTRICTED`, недоступны в CRM.

---

## 2. Users list (всегда)

Email всегда masked: `a***@gmail.com`. Отображается display name + masked email + lifecycle/funding/engagement-бейджи. Никакая роль не видит полный email в списке.

---

## 3. User 360 — доступ к полному email по ролям

| Роль | Полный email | Как |
|---|---|---|
| `crm_admin` | ✓ | доступен (в production — через Reveal-flow) |
| `crm_manager` | ✓ | доступен (в production — через Reveal-flow) |
| `retention_manager` | ✓ | доступен (в production — через Reveal-flow) |
| `support` | ✓ **только с отдельным permission** | Reveal-flow + permission-грант |
| `mentor` | ✗ | masked email + имя |
| `moderator` | ✗ | display name + platform ID (без email) |
| `analyst` | ✗ | pseudonymous ID (обезличено) |
| `content_manager` | ✗ | без identity |
| `read_only` | по назначенной permission policy | обычно masked |

---

## 4. Reveal-flow (для полного PII, production-требование)

Раскрытие полного значения обязано проходить:

```ts
interface PiiRevealRequest {
  actorId: EmployeeId;
  userId: UserId;
  field: 'email' | 'other_pii';
  reasonCode: string;          // обязателен
  grantedByPermission: string; // напр. 'pii.reveal.email' или временный support-грант
}

interface PiiRevealResult {
  value: string;               // раскрытое значение
  revealedAt: ISODateString;
  autoHideAt: ISODateString;   // авто-скрытие через N (конфиг)
  auditRecordId: string;       // обязательная запись в Audit
}
```

Шаги: (1) явное действие **Reveal**; (2) ввод/выбор **reason code**; (3) запись в **Audit** (actor, field, reason, time); (4) **авто-скрытие** через заданное время. На Phase 0.5/mock — flow смоделирован, значения synthetic, запись `AuditRecord{mock:true}`.

---

## 5. Что видит каждая роль (сводно)

| Роль | Identity-доступ |
|---|---|
| crm_admin | display name, полный email (reveal), все refs |
| crm_manager | display name, полный email (reveal) |
| retention_manager | display name, полный email (reveal) |
| support | display name, masked email → полный только с permission (reveal) |
| mentor | display name, masked email |
| moderator | display name, platform ID (без email) |
| analyst | pseudonymous ID (без имени/email) |
| content_manager | без identity (обезличенный контекст обучения/контента) |
| read_only | по назначенной permission policy (обычно masked) |

---

## 6. Связь с финансовой видимостью

PII и финансовая видимость — **разные оси** (см. DECISIONS D-07). Роль может видеть точные финансы, но не полный email, и наоборот. Обе оси проверяются независимо в domain-слое (`assertPermission`) и маскируются до отдачи в UI.

---

## 7. Mock-реализация

- Все email в фикстурах synthetic (`a***@e***.com`), полное значение — тоже synthetic.
- Reveal-flow смоделирован в UI (действие → reason → mock-audit → авто-hide).
- Никаких реальных PII; заголовок фикстур `// SYNTHETIC — NOT PRODUCTION`.

---

_Связано: DECISIONS.md (D-11, D-07), ROLE_PERMISSION_MATRIX.md, CRM_DOMAIN_MODEL.md (UserIdentity), DATA_PROVIDER_CONTRACT.md (reveal-операция), UX_BLUEPRINT.md (Reveal-flow)._

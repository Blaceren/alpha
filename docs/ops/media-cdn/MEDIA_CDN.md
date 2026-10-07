# Видео уроков и фильм на Amazon CDN (CloudFront)

Решение владельца 07.10.2026: «подготовь продукт к работе с amazon cdn видео уроков и на главной
лежат на нем». Этот документ — как подключить CDN к Академии. Код готов (академия `server/media/delivery.ts`),
переключение — настройкой окружения, без сборки.

## Как это устроено

Адреса в продукте не меняются. Запись урока по-прежнему называет файл как
`/media/lessons/<код уровня>/<hash>.<ext>`, фильм главной — `/film/hero.mp4`. Меняется то, что
отвечает на эти адреса:

| Режим | `ATA_MEDIA_DELIVERY` | Уроки | Фильм главной |
|---|---|---|---|
| локальные файлы (PREPROD сегодня) | `local` или не задано | Академия отдаёт байты из `ATA_MEDIA_ROOT` после проверки доступа | Академия отдаёт байты |
| CDN | `cdn` | после той же проверки доступа — переадресация (302) на **подписанную** ссылку CloudFront, действующую 6 часов | страница ссылается на CDN напрямую (открытая ссылка), `/film/…` переадресует туда же |

Проверка доступа к уроку остаётся одна — бэкенда: ссылку получает только ученик, которому бэкенд
отдал бы этот урок. Подпись делается для папки урока (видео, постер и субтитры одного урока — одна
подпись), срок округляется до 5 минут, чтобы плеер при каждой перемотке получал тот же адрес.

Раскладка в бакете — та же, что в `ATA_MEDIA_ROOT`:

```
lessons/<код уровня>/<первые 16 hex sha256>.mp4|webm|jpg|png|webp|vtt   — закрыто, только по подписи
public/film/hero.mp4 (или hero.webm), hero.jpg|webp|png, hero.vtt        — открыто
```

## Что нужно в AWS

Шаблон `ata-media-cdn.yaml` (рядом) создаёт всё разом: приватный бакет, доступ к нему только через
CloudFront (OAC), публичный ключ подписи и key group, политику CORS для домена Академии, политику
кэша без query string (все ученики делят один кэш файла), раздачу с двумя правилами: `public/*`
открыто, `lessons/*` только по подписи. Если бакет и раздача уже есть, нужны те же четыре вещи:

1. **Ключ подписи.** На сервере Академии (как `ata`, права 0600):
   ```bash
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /srv/ata/config/media-cdn-signing.pem
   openssl pkey -in /srv/ata/config/media-cdn-signing.pem -pubout
   ```
   Публичную половину (вывод второй команды) — в CloudFront → Public keys → key group, и эту key group
   указать в правиле `lessons/*` («Restrict viewer access» → Trusted key groups). Приватная половина
   никуда с сервера не уходит.
2. **CORS.** Response headers policy с `Access-Control-Allow-Origin: https://preprod.alfatrade.media`
   (на PROD — боевой домен), методы GET/HEAD/OPTIONS, expose `Content-Length, Content-Range, Accept-Ranges,
   ETag`. Без этого видео играет, а субтитры не загрузятся (плеер запрашивает файлы с `crossorigin`).
3. **Кэш.** Cache policy без query string, cookie и заголовков в ключе (CachingOptimized подходит).
   Параметры подписи CloudFront убирает сам до обращения к бакету.
4. **Бакет закрыт** (Block Public Access), читать его может только раздача (OAC / bucket policy).

## Настройка Академии (`/srv/ata/config/academy.env`)

```
ATA_MEDIA_DELIVERY=cdn
ATA_MEDIA_CDN_ORIGIN=https://dxxxxxxxxxxxx.cloudfront.net        # или https://video.<домен>, без пути
ATA_MEDIA_CDN_KEY_PAIR_ID=K2XXXXXXXXXXXX                           # id публичного ключа в CloudFront
ATA_MEDIA_CDN_PRIVATE_KEY_FILE=/srv/ata/config/media-cdn-signing.pem
# необязательно:
ATA_MEDIA_CDN_URL_TTL_SECONDS=21600       # срок подписанной ссылки, по умолчанию 6 часов
ATA_MEDIA_CDN_SIGNATURE=sha1              # sha1 (по умолчанию, принимает любая раздача) или sha256
```

`ATA_MEDIA_ROOT` можно оставить: в режиме `cdn` он не используется, а при откате на `local` файлы
на месте. После правки — перезапуск службы академии (`systemctl restart ata-preprod-academy`).

**Режим без подписи** — `ATA_MEDIA_CDN_LESSONS_PUBLIC=true` — только пока в раздаче нет key group:
уроки тогда защищены лишь неугадываемыми именами. На PROD не включать. Если ключ не настроен и флага
нет, Академия в режиме `cdn` вообще не отдаёт уроки (404) — чтобы случайно не открыть их всем.

## Файлы

Выгрузка из `ATA_MEDIA_ROOT` в бакет теми же ключами (бэкенд, из каталога релиза как `ata`;
учётные данные AWS — из роли инстанса или переменных `AWS_PROFILE`/`AWS_ACCESS_KEY_ID`, в чат их не
вставлять):

```bash
cd /srv/ata/current/backend
node node_modules/tsx/dist/cli.mjs scripts/ops/syncMediaToS3.ts --media-root /srv/ata-data/media --bucket <бакет> --region eu-central-1
node node_modules/tsx/dist/cli.mjs scripts/ops/syncMediaToS3.ts --media-root /srv/ata-data/media --bucket <бакет> --region eu-central-1 --apply
```

Первый вызов — пробный (ничего не грузит). Файл урока в бакете никогда не перезаписывается (его имя —
его содержимое), фильм по фиксированному имени заменяется. Ничего не удаляется.

Новый урок по-прежнему регистрируется `registerLessonMedia.ts` (кладёт файл в `ATA_MEDIA_ROOT` и
пишет запись), затем `syncMediaToS3.ts --apply`. Если файлы уже лежат в бакете под другими именами,
их нужно скопировать на сервер в `ATA_MEDIA_ROOT` и зарегистрировать, либо переложить в бакете под
ключи из записей — иначе запись урока не знает, какой файл её.

## Проверка после переключения

- Урок (вход выполнен, уровень открыт): `curl -I -b '<cookie>' https://<академия>/media/lessons/<код>/<hash>.mp4` → `302`,
  `location` на CloudFront с `Policy`, `Signature`, `Key-Pair-Id`; по этой ссылке `curl -I` → `200`/`206`.
- Та же ссылка с испорченной подписью → `403` от CloudFront. Без входа → переадресация на `/login`.
- Главная: `curl -s https://<академия>/ | grep -o 'data-film="[a-z]*"'` → `ready`, в разметке адрес фильма на CDN.
- В браузере: видео урока играет, перемотка работает, субтитры (если есть) показываются; фильм на
  главной играет; в консоли нет ошибок CORS.

## Откат

`ATA_MEDIA_DELIVERY=local` (или убрать строку) и перезапуск службы: файлы на сервере никуда не
девались. Ни записи, ни адреса при переключении в обе стороны не меняются.

## Проверено 07.10.2026

На стенде с имитацией CloudFront (сервер, проверяющий подпись публичным ключом, CORS, диапазоны):
урок — `/media/…` → 302 → подписанная ссылка → 206 при перемотке, постер — так же, без ошибок; фильм —
напрямую с CDN, `crossorigin="anonymous"`; без входа — на `/login`; подделанная подпись — 403.
Тесты: подпись (проверяется `crypto.verify` публичным ключом), конфигурация, маршруты, фильм,
скрипт выгрузки. Настоящий CloudFront — проверить после подключения по списку выше.

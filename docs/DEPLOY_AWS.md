# Развёртывание Alfa Trade Academy на AWS — руководство инженера

Документ для инженера, который разворачивает первый PROD продукта на AWS **из этого
репозитория**. Он написан в расчёте на небольшой опыт с AWS: у каждого шага сказано,
**что** мы делаем, **зачем** и **как** именно. Эталон — PREPROD на VPS OVH
(`preprod.alfatrade.media`): PROD повторяет его раскладку один в один, а всё, что
специфично для AWS, объяснено отдельно.

Ожидаемое время: подготовка аккаунта — полдня; хост, DNS, TLS, конфигурация — день;
первый релиз и проверки — полдня. Видео (раздел 13) — отдельный этап после открытия.

---

## 0. Что мы разворачиваем и из чего это состоит

Четыре приложения на одной машине, за одним nginx, с одной базой SQLite:

| Часть | Что это | Порт (только loopback) | Хост |
|---|---|---|---|
| `backend/` | API: сессии, учебная программа, отчёты, инструменты, новости, CRM API, партнёрский трекинг, постбэки Pocket | 3100 | не имеет своего хоста — к нему обращаются другие три приложения и nginx (два маршрута) |
| `academy/` | приложение ученика и публичная главная | 3050 | `alfatrade.media` |
| `crm/` | CRM для сотрудников | 3010 | `crm.alfatrade.media` (за HTTP Basic Auth) |
| `partner/` | кабинет партнёра | 3110 | `partners.alfatrade.media` (за HTTP Basic Auth) |

Плюс `tooling/` — инструменты релиза (сборка с провенансом, публикация, переключение,
откат, гейт очистки) и `deploy/` — шаблоны для хоста: systemd-юниты, конфиг nginx, скрипт
бэкапа, образцы env-файлов. Оба каталога — часть этого репозитория.

**Почему одна машина и SQLite, а не «правильная» облачная архитектура.** Так работает
PREPROD, и так продукт проверен. Нагрузка на старте небольшая; SQLite с проверенными
бэкапами в S3 надёжнее, чем новая база, которую никто не эксплуатировал. Это фаза 1;
решение о переходе на RDS принимается позже, по фактической нагрузке.

**Принципы, которые нельзя нарушать:**

1. **Секреты никогда не попадают в репозиторий, чат, тикет, лог или скриншот.** Они
   живут только в `/srv/ata/config/*.env` (права 0600, владелец `ata`) и вводятся руками
   на сервере.
2. **PROD начинается с чистой базы.** Базу PREPROD копировать нельзя — там тестовые
   ученики и стендовые аттестации. Учебная программа импортируется пакетом (раздел 9).
3. **Аттестация чекпоинтов вручную (`STAGING_ATTESTATION_ENABLED`) на PROD запрещена.**
   Это стендовый инструмент; на PROD чекпоинты проверяются только через Pocket.
4. **Релиз — только через `tooling/`.** Ручное копирование сборок в `/srv/ata/current`
   ломает провенанс и откат.
5. **Четыре глаза на ключи и доступы.** Ключи Pocket, Turnstile, секреты сессий выдаёт
   владелец; инженер их вводит; ни одна сторона не пересылает их в открытом виде.

---

## 1. Аккаунт AWS: как подготовить, чтобы потом не переделывать

Всё в регионе **eu-central-1 (Франкфурт)** — ближе всего к аудитории и к Namecheap-DNS
ничего не привязано. Выберите его в правом верхнем углу консоли и больше не меняйте.

### 1.1 Organizations и отдельный аккаунт под PROD

**Что.** AWS Organizations — «папка» аккаунтов. Создаём организацию из корневого
(management) аккаунта и в ней отдельный аккаунт `ata-prod`.

**Зачем.** Ресурсы PROD должны жить в аккаунте, где нет ничего другого: тогда права,
счета и аварии не смешиваются с экспериментами. Корневой аккаунт для ресурсов не
используется — только для организации, биллинга и входа.

**Как.** Консоль → AWS Organizations → Create organization → Add an AWS account →
Create → имя `ata-prod`, email — отдельный ящик владельца (например, `aws-prod@…`).

### 1.2 IAM Identity Center и MFA

**Что.** Identity Center — единый вход для людей (вместо IAM-пользователей с постоянными
ключами). Пользователи получают временные права через SSO.

**Зачем.** Постоянные ключи доступа — главный источник взломов. С Identity Center у
инженера и владельца есть логин с MFA, а права выдаются группам (`ata-admins`,
`ata-operators`) и отзываются одной кнопкой.

**Как.** Консоль → IAM Identity Center → Enable → создать пользователей (владелец,
инженер) → группы → Permission sets: `AdministratorAccess` для владельца,
`PowerUserAccess` для инженера → назначить на аккаунт `ata-prod`. Включить MFA как
обязательное: Settings → Authentication → MFA → *Required at every sign-in*.

### 1.3 Бюджет и защита от сюрпризов в счёте

**Что.** Budgets — лимит с уведомлением; Cost Anomaly Detection — сигнал о необычных
тратах.

**Зачем.** Ошибка в настройке (забытый инстанс, трафик CloudFront) должна быть видна
через часы, а не в конце месяца.

**Как.** Billing → Budgets → Create → Cost budget → месячный лимит (например, 300 USD) →
уведомление на 80 % и 100 %. Cost Management → Cost Anomaly Detection → включить
монитор по аккаунту.

### 1.4 Базовая безопасность аккаунта (один раз, 15 минут)

| Что | Зачем | Как |
|---|---|---|
| CloudTrail (organization trail) | журнал всех действий в аккаунте — без него не разобрать инцидент | CloudTrail → Trails → Create → apply to organization, лог в отдельный S3-бакет |
| GuardDuty | автоматический детектор подозрительной активности | GuardDuty → Enable (регион eu-central-1) |
| S3 Block Public Access на уровне аккаунта | ни один бакет не станет публичным случайно | S3 → Block Public Access settings for this account → все четыре галочки |
| EBS encryption by default | диски шифруются без усилий | EC2 → Settings → EBS encryption → Enable |
| IMDSv2 only | защита метаданных инстанса от SSRF | EC2 → Settings → Data protection and security → IMDS defaults → V2 only |
| Квота vCPU | `m7i.xlarge` = 4 vCPU; новый аккаунт может иметь лимит меньше | Service Quotas → EC2 → Running On-Demand Standard instances → запросить 16 |

### 1.5 Доступ на сервер: SSM вместо SSH

**Что.** AWS Systems Manager Session Manager — доступ к консоли сервера через AWS без
открытого 22-го порта и без SSH-ключей.

**Зачем.** Открытый SSH — постоянный шум брутфорса и ещё один ключ, который нужно хранить.
Через SSM вход проходит по правам IAM, с MFA, и каждая сессия попадает в CloudTrail.

**Как.** Инстансу назначается IAM-роль с политикой `AmazonSSMManagedInstanceCore`
(раздел 2.3). На своём ноутбуке: установить AWS CLI и Session Manager plugin, настроить
профиль `ata-prod` через `aws configure sso`, затем `aws ssm start-session --target
<instance-id> --profile ata-prod`. Для `scp`-подобной передачи файлов — S3 или
`aws ssm start-session` с port forwarding.

---

## 2. Хост: EC2, диски, сеть

### 2.1 Инстанс

**Что.** Одна виртуальная машина EC2 `m7i.xlarge` (4 vCPU, 16 ГБ) на **Ubuntu 24.04 LTS
или 26.04 LTS, x86_64**. PREPROD работает на Ubuntu 26.04, nginx 1.28, Node 22.14.0 —
берите те же версии, чтобы не отлаживать различия.

**Зачем такой размер.** Четыре Next.js-процесса и сборки релизов (`next build`) хотят
памяти; на 8 ГБ сборка академии упирается в лимит. `m7i` — текущее поколение Intel, у
него нормальный однопоточный ход, который важен для SQLite.

**Как.** EC2 → Launch instance → Ubuntu Server LTS (x86_64) → `m7i.xlarge` → без
key pair (вход через SSM) → Network: default VPC, публичная подсеть, *Auto-assign public
IP: enable* → Security group (2.2) → Storage (2.4) → Advanced: IAM instance profile (2.3),
Metadata → IMDSv2 required.

### 2.2 Security group — что открыто наружу

| Порт | Откуда | Зачем |
|---|---|---|
| 443 | 0.0.0.0/0 | HTTPS для трёх хостов |
| 80 | 0.0.0.0/0 | только редирект на HTTPS и проверка Let's Encrypt |
| 22 | — | **не открывать**: вход через SSM |

Все приложения слушают только `127.0.0.1` (см. юниты в `deploy/systemd/`), наружу их
отдаёт nginx. Это не настройка «на всякий случай», а часть модели безопасности:
бэкенд недоступен снаружи ни на каком порту.

### 2.3 IAM-роль инстанса

**Что.** Роль, которую сервер использует вместо ключей доступа.

**Зачем.** Сервер должен (а) принимать SSM-сессии, (б) писать бэкапы в S3. Ни для
того, ни для другого не нужны ключи в файлах на диске.

**Как.** IAM → Roles → Create → Trusted entity: EC2 → политики `AmazonSSMManagedInstanceCore`
и своя политика `ata-prod-backups-write` (только `s3:PutObject`, `s3:ListBucket` на
бакет бэкапов — см. 11.2). Имя роли `ata-prod-ec2`.

### 2.4 Диски: три тома, не один

**Что.** Корневой том 30 ГБ + два отдельных тома gp3: `releases` 100 ГБ и `data` 50 ГБ,
все с шифрованием.

**Зачем.** На PREPROD корневой диск однажды заполнился релизами до 98 %, и публикация
отказалась работать. Отдельный том под релизы не даст сборкам вытеснить базу; отдельный
том под данные позволяет делать снапшоты именно базы и загрузок.

**Как.** При запуске инстанса добавить два тома. После первого входа:

```bash
lsblk                                   # найти новые устройства (nvme1n1, nvme2n1)
sudo mkfs.ext4 -L ata-releases /dev/nvme1n1
sudo mkfs.ext4 -L ata-data     /dev/nvme2n1
sudo mkdir -p /srv/ata /srv/ata-data
echo 'LABEL=ata-releases /srv/ata      ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
echo 'LABEL=ata-data     /srv/ata-data ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mount -a && df -h /srv/ata /srv/ata-data
```

`nofail` — чтобы сервер поднялся даже без тома; юниты требуют `/srv/ata-data`
(`RequiresMountsFor`) и без него просто не стартуют вместо того, чтобы писать в
корневой диск.

### 2.5 Elastic IP

**Что.** Постоянный публичный IPv4-адрес.

**Зачем.** Обычный публичный IP меняется при остановке инстанса, а DNS-записи должны
жить долго.

**Как.** EC2 → Elastic IPs → Allocate → Associate с инстансом. Этот адрес пойдёт в DNS.

---

## 3. DNS и TLS

### 3.1 DNS остаётся на Namecheap

**Что.** Три A-записи на Elastic IP: `alfatrade.media` (apex, `@`), `crm`, `partners`.
Route 53 не нужен.

**Зачем не трогать остальное.** На домене работает почта Google Workspace: записи MX,
SPF (TXT), DKIM, DMARC. Любое изменение этих записей ломает почту. Добавляем **только**
три A-записи, ничего не удаляем.

**Как.** Namecheap → Domain List → Manage → Advanced DNS → Add New Record: `A Record`,
Host `@`, Value `<Elastic IP>`, TTL Automatic; то же для `crm` и `partners`. Проверка через
5–30 минут: `dig +short alfatrade.media` должен вернуть Elastic IP.

### 3.2 Сертификаты Let's Encrypt

**Что.** Один сертификат на три имени, выпущенный certbot по HTTP-проверке; продление
автоматическое.

**Зачем не ACM.** ACM-сертификаты работают только с балансировщиками и CloudFront. У нас
nginx на инстансе — ему нужен файл сертификата, а это Let's Encrypt.

**Как** (после того, как nginx уже отвечает на 80-м порту, раздел 7):

```bash
sudo apt-get install -y certbot
sudo mkdir -p /var/lib/letsencrypt
sudo certbot certonly --webroot -w /var/lib/letsencrypt \
  --cert-name ata-prod \
  -d alfatrade.media -d crm.alfatrade.media -d partners.alfatrade.media \
  --email <ящик владельца> --agree-tos --no-eff-email
sudo systemctl list-timers | grep certbot     # таймер продления есть из пакета
```

Конфиг nginx ждёт файлы по путям `/etc/letsencrypt/live/ata-prod/fullchain.pem` и
`privkey.pem` — имя `--cert-name ata-prod` это обеспечивает. После продления nginx нужно
перечитать конфиг: `sudo tee /etc/letsencrypt/renewal-hooks/deploy/nginx.sh <<<'#!/bin/sh
systemctl reload nginx' && sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/nginx.sh`.

---

## 4. Подготовка операционной системы

Все команды — от `ubuntu` через `sudo`, в SSM-сессии.

### 4.1 Пакеты

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y nginx git sqlite3 build-essential python3 unzip curl jq
nginx -v          # ожидается 1.26+; на PREPROD 1.28
```

### 4.2 Node 22.14.0 — ровно та же версия

**Зачем ровно.** Манифест каждого релиза записывает версию Node и npm, сборка
проверяется на них. Другая версия — другая сборка, а `engines` в `package.json` (`22.14.x`)
не даст установить зависимости.

```bash
cd /tmp && curl -fsSLO https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz
sudo tar -xJf node-v22.14.0-linux-x64.tar.xz -C /opt
sudo ln -sfn /opt/node-v22.14.0-linux-x64/bin/node /usr/local/bin/node
sudo ln -sfn /opt/node-v22.14.0-linux-x64/bin/npm  /usr/local/bin/npm
sudo ln -sfn /opt/node-v22.14.0-linux-x64/bin/npx  /usr/local/bin/npx
node --version && npm --version      # v22.14.0 и 10.9.x
```

Юниты в `deploy/systemd/` ссылаются именно на `/usr/local/bin/npm` и
`/opt/node-v22.14.0-linux-x64/bin/node` — пути должны совпасть.

### 4.3 Пользователь `ata` и каталоги

**Что.** Системный пользователь без входа, от которого работают все четыре сервиса и
бэкап. Раскладка каталогов — та же, что на PREPROD, потому что на неё завязаны юниты,
tooling и скрипт бэкапа.

```bash
sudo useradd --system --home /srv/ata --shell /usr/sbin/nologin ata
sudo mkdir -p /srv/ata/{releases,current,config,bin,repos,systemd} \
             /srv/ata/releases/{academy,backend,crm,partner} \
             /srv/ata-data/{data,uploads,logs,backups/scheduled,backups/manual}
sudo chown -R ata:ata /srv/ata /srv/ata-data
sudo chmod 700 /srv/ata/config /srv/ata-data/data /srv/ata-data/backups
```

| Путь | Что там | Кто пишет |
|---|---|---|
| `/srv/ata/releases/<component>/<commit>` | неизменяемые опубликованные релизы | `publish-release.sh` |
| `/srv/ata/current/<component>` | симлинк на живой релиз | `cutover.sh` |
| `/srv/ata/config/*.env` | конфигурация и секреты (0600) | инженер, руками |
| `/srv/ata/bin/` | скрипт бэкапа | из `deploy/bin/` |
| `/srv/ata-data/data/ata-prod.sqlite` | база | backend |
| `/srv/ata-data/uploads/` | загрузки учеников (вложения к отчётам) | backend |
| `/srv/ata-data/backups/scheduled/` | ежедневные проверенные бэкапы | таймер |

### 4.4 Исходники: клон репозитория и рабочие копии по компонентам

**Что.** Клонируем этот репозиторий и делаем из него четыре отдельных git-репозитория по
компонентам — ровно так, как они лежат на PREPROD.

**Зачем не собирать прямо из монорепозитория.** `tooling/` проверяет, что каждый файл
релиза совпадает с деревом коммита **репозитория компонента** (`git ls-tree` от корня),
и пишет в манифест commit и tree. Монорепозиторий собран через `git subtree`, поэтому
`git subtree split` восстанавливает **те же самые коммиты** с теми же SHA — манифесты
PROD будут ссылаться на те же коммиты, что и PREPROD. Пути рабочих копий повторяют
PREPROD, чтобы не править tooling:

```bash
sudo -u ubuntu -i bash <<'EOF'
git clone https://github.com/Blaceren/alpha.git ~/alpha
cd ~/alpha
for c in academy backend crm partner tooling; do git subtree split --prefix="$c" -b "split/$c"; done
mkdir -p ~/learner-ops-v1 ~/affiliate-work
git clone -b split/academy ~/alpha ~/learner-ops-v1/academy
git clone -b split/backend ~/alpha ~/learner-ops-v1/backend
git clone -b split/crm     ~/alpha ~/learner-ops-v1/crm
git clone -b split/partner ~/alpha ~/affiliate-work/partner
git clone -b split/tooling ~/alpha ~/ata-release-tooling
cd ~/learner-ops-v1/academy && git log --oneline -1     # ожидается be1280d…
EOF
```

Проверьте, что SHA совпали с таблицей в `README.md` (academy `be1280d`, backend `e37d269` —
это живой `d82935a` PREPROD с переписанной историей без кэша сборки, дерево то же,
crm `3404dc2`). Если `git subtree split` дал другие SHA, значит в подпапке были правки
поверх исходной истории — это нормально для будущих изменений, но для первого релиза
их быть не должно.

Дальше обновления делаются так: `git -C ~/alpha pull`, снова `git subtree split`, затем
`git -C ~/learner-ops-v1/<c> pull ~/alpha split/<c>`.

### 4.5 Зависимости для сборки

`build-release.sh` ставит зависимости сам (`npm ci`) внутри рабочей копии; заранее
нужно только один раз прогреть кэш npm под `ubuntu`, чтобы первая сборка не упёрлась в
сеть:

```bash
cd ~/learner-ops-v1/backend && npm ci && cd ~/learner-ops-v1/academy && npm ci \
  && cd ~/learner-ops-v1/crm && npm ci && cd ~/affiliate-work/partner && npm ci
```

---

## 5. Установка tooling и его адаптация под PROD

**Что.** `tooling/` — версионируемый источник; активный путь — `~/learner-ops-v1/tools`.
Установщик копирует только перечисленные файлы, проверяя хэши, и отказывается работать
с грязным деревом.

**Зачем два пути.** Чтобы правки в инструменты релиза проходили через коммит, а не
через редактирование живых файлов (история этой ошибки описана в `tooling/README.md`).

**Что нужно поправить перед установкой (единственные правки):** имена systemd-юнитов.
На PREPROD они `ata-preprod-<component>.service`; на PROD — `ata-prod-<component>.service`.
Реестр в одном файле:

```bash
cd ~/ata-release-tooling
grep -n "ata-preprod-" tools/service-identity.sh       # четыре строки в ata_unit_for()
sed -i 's/ata-preprod-/ata-prod-/g' tools/service-identity.sh
for t in tools/tests/*.test.sh tests/install-contract.test.sh; do bash "$t" || { echo "FAILED: $t"; break; }; done
git commit -am "PROD: unit names ata-prod-*"
./install-release-tooling.sh                            # ставит в ~/learner-ops-v1/tools
./install-release-tooling.sh --check                    # должно ответить, что активный путь совпадает
```

Пути к рабочим копиям (`~/learner-ops-v1/<c>`, `~/affiliate-work/partner`) в
`build-release.sh` и `publish-release.sh` менять не нужно — мы воспроизвели их в 4.4.

`sudo` для `publish-release.sh` и `cutover.sh`: на PREPROD пользователь `ubuntu` имеет
`NOPASSWD: ALL`. На PROD достаточно разрешить именно эти два скрипта и `systemctl`:

```
# /etc/sudoers.d/ata-release  (проверить: sudo visudo -cf /etc/sudoers.d/ata-release)
ubuntu ALL=(root) NOPASSWD: /home/ubuntu/learner-ops-v1/tools/publish-release.sh, /home/ubuntu/learner-ops-v1/tools/cutover.sh, /home/ubuntu/learner-ops-v1/tools/prune-release.sh
```

---

## 6. Конфигурация: env-файлы

**Что.** Четыре файла в `/srv/ata/config/`: `backend.env`, `academy.env`, `crm.env`,
`partner.env`. Образцы с полным списком переменных — в `deploy/env/*.example`; в них уже
проставлены значения, которые не секретны и на PROD должны быть именно такими
(`ATA_ENVIRONMENT=production`, `STAGING_ATTESTATION_ENABLED=false`, индексация включена и т. д.).

**Зачем именно так.** systemd читает их через `EnvironmentFile=`, поэтому файл должен
быть в формате `KEY=value` без кавычек и без `export`. **Никогда не делайте
`source backend.env`** — в значениях есть `&`, shell воспримет его как оператор, и вы
получите пустую переменную и ложную ошибку «required in production». Прочитать одно
значение безопасно: `sudo sed -n 's/^KEY=//p' /srv/ata/config/backend.env`.

**Как.**

```bash
sudo install -m 600 -o ata -g ata ~/alpha/deploy/env/backend.env.example /srv/ata/config/backend.env
sudo install -m 600 -o ata -g ata ~/alpha/deploy/env/academy.env.example /srv/ata/config/academy.env
sudo install -m 600 -o ata -g ata ~/alpha/deploy/env/crm.env.example     /srv/ata/config/crm.env
sudo install -m 600 -o ata -g ata ~/alpha/deploy/env/partner.env.example /srv/ata/config/partner.env
sudo -e /srv/ata/config/backend.env      # редактор, а не echo: значения не попадут в историю shell
```

Что заполнить и откуда взять:

| Переменная | Где | Откуда значение |
|---|---|---|
| `SESSION_SECRET`, `PARTNER_SESSION_SECRET`, `ATTRIBUTION_TOKEN_SECRET` | backend | сгенерировать на сервере: `openssl rand -hex 32`, три разных |
| `POSTBACK_SECRET` | backend | новый для PROD, `openssl rand -hex 32`; это же значение владелец вписывает в URL постбэка в кабинете Pocket (раздел 12) |
| `TURNSTILE_SECRET_KEY` (backend), `TURNSTILE_SITE_KEY` (academy, crm) | backend / academy / crm | владелец создаёт виджет Cloudflare Turnstile для хостов `alfatrade.media` и `crm.alfatrade.media`; `TURNSTILE_EXPECTED_HOSTNAMES` перечисляет эти хосты |
| `POCKET_AFFILIATE_BASE_URL` | backend | партнёрская ссылка регистрации Pocket владельца (с UTM-параметрами); содержит `&` — поэтому и нельзя `source` |
| `ACADEMY_SEARCH_INDEXING=on` + `ACADEMY_PUBLIC_ORIGIN=https://alfatrade.media` | academy | включают индексацию **только публичной главной**; без любой из двух весь хост отвечает `noindex` — так устроено намеренно |

После заполнения: `sudo chmod 600 /srv/ata/config/*.env && sudo chown ata:ata /srv/ata/config/*.env`.

---

## 7. nginx

**Что.** Один файл сайта `deploy/nginx/ata-prod.conf` (три HTTPS-хоста, редирект с 80,
отбой чужих имён) + `deploy/nginx/ata-prod-rate-limit.conf` (лимиты на логин, API и
партнёрские ссылки) + `deploy/nginx/ata-postback-logging.conf` (формат лога постбэков без
query-строки — чтобы секрет из URL не попадал в логи).

**Зачем каждая деталь.**
- Хост академии открыт всем; CRM и кабинет партнёра — за HTTP Basic Auth **поверх**
  логина приложения: это второй замок на дверях сотрудников, он не заменяет права в CRM.
- `/api/health` и `/api/readiness` снаружи отвечают 404: они для оператора на
  loopback, не для интернета.
- `/go/` (партнёрские ссылки) и `/api/postbacks/pocket` идут напрямую в бэкенд с
  отдельными лимитами и логом без query.
- `return 444` для неизвестных имён и `ssl_reject_handshake` — сервер не отвечает на
  сканеры по IP.

**Как.**

```bash
sudo install -m 644 ~/alpha/deploy/nginx/ata-prod-rate-limit.conf  /etc/nginx/conf.d/
sudo install -m 644 ~/alpha/deploy/nginx/ata-postback-logging.conf /etc/nginx/conf.d/
sudo install -m 644 ~/alpha/deploy/nginx/ata-prod.conf /etc/nginx/sites-available/ata-prod.conf
sudo ln -sfn /etc/nginx/sites-available/ata-prod.conf /etc/nginx/sites-enabled/ata-prod.conf
sudo rm -f /etc/nginx/sites-enabled/default
# Basic Auth для CRM и кабинета партнёра: логины сотрудников, пароли вводятся интерактивно
sudo apt-get install -y apache2-utils
sudo htpasswd -c /etc/nginx/prod-access.htpasswd <логин-первого-сотрудника>
sudo chmod 640 /etc/nginx/prod-access.htpasswd && sudo chown root:www-data /etc/nginx/prod-access.htpasswd
sudo nginx -t
```

Первый запуск nginx делается **до** выпуска сертификата: временно закомментируйте три
`server { listen 443 ssl; … }` блока хостов (или укажите в них самоподписанный
сертификат), запустите `sudo systemctl reload nginx`, выпустите сертификат (3.2), верните
блоки, `sudo nginx -t && sudo systemctl reload nginx`.

---

## 8. systemd-юниты

**Что.** Пять юнитов и таймер из `deploy/systemd/`: четыре сервиса приложений и
`ata-prod-backup.service` + `.timer`.

**Зачем они такие «зажатые».** `ProtectSystem`, `ProtectHome`, `NoNewPrivileges`,
`UMask=0077` — сервис не может писать никуда, кроме своих каталогов, и не может
поднять права. Бэкап вдобавок отключён от сети (`PrivateNetwork=true`): он читает базу
и пишет файл, больше ничего.

```bash
sudo install -m 644 ~/alpha/deploy/systemd/ata-prod-*.service ~/alpha/deploy/systemd/ata-prod-backup.timer /etc/systemd/system/
sudo install -m 755 -o ata -g ata ~/alpha/deploy/bin/ata-backup-sqlite /srv/ata/bin/ata-backup-sqlite
sudo systemctl daemon-reload
sudo systemctl enable ata-prod-backend ata-prod-academy ata-prod-crm ata-prod-partner ata-prod-backup.timer
```

Сервисы **пока не запускаем** — `/srv/ata/current/<component>` появится после первой
публикации (раздел 10). Порядок старта при первом релизе: backend → crm → academy → partner.

---

## 9. База данных: миграции, учебная программа, первый сотрудник

### 9.1 Создать базу миграциями

**Что.** Схема создаётся прогоном всех миграций из релиза бэкенда (59 на момент
написания). Раннер применяет каждую миграцию в одной транзакции — прерванная миграция
не оставляет половинчатого состояния.

**Как** (после публикации релиза бэкенда, до его первого старта). Миграции запускаются
от пользователя `ata` с тем же env-файлом, который читает юнит, — через `systemd-run`,
чтобы не «сорсить» файл руками и не светить значения в истории shell:

```bash
sudo systemd-run --uid=ata --gid=ata -p EnvironmentFile=/srv/ata/config/backend.env \
  --wait --pipe --working-directory=/srv/ata/releases/backend/<commit> \
  /usr/local/bin/npm run prisma:migrate
```

Проверка:

```bash
sudo -u ata sqlite3 -readonly /srv/ata-data/data/ata-prod.sqlite \
  'PRAGMA integrity_check; SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;'
```

Ожидается `ok` и число миграций, равное количеству папок в `backend/prisma/migrations`.

### 9.2 Импортировать учебную программу

**Что.** 100 уровней и их содержимое живут в пакете `backend/curriculum/packages/*.json`
и импортируются транзакционным, идемпотентным импортёром. Повторный импорт того же
пакета — no-op. Импортёр никого не публикует, не активирует и не зачисляет.

**Какой пакет.** Тот, что помечен `approved` и используется на PREPROD; уточнить у владельца
(на 26.09.2026 — `ata-v2-first-slice.rev3.approved.json` для первого среза и канонический
`ata-v2-canonical-100.*` как черновик). Порядок: `--validate-only` → `--dry-run` → импорт.

```bash
cd /srv/ata/releases/backend/<commit>
npm run curriculum:package:import -- --package curriculum/packages/<file>.json --validate-only --json
sudo systemd-run --uid=ata --gid=ata -p EnvironmentFile=/srv/ata/config/backend.env --wait --pipe \
  --working-directory=/srv/ata/releases/backend/<commit> /usr/local/bin/npm run curriculum:package:import -- \
  --package curriculum/packages/<file>.json --dry-run
# то же без --dry-run
```

Подробности и гарантии — `backend/docs/CURRICULUM_PACKAGES.md`.

### 9.3 Первый сотрудник CRM (`crm_admin`)

**Что.** Роль сотрудника задаётся записью `StaffProfile.staffRole`; `crm_admin` держит
все права CRM. Готового скрипта «создать первого администратора PROD» в репозитории нет —
на PREPROD его создавала отдельная авторизованная процедура.

**Как правильно.** Написать одноразовый скрипт по образцу
`backend/scripts/ops/preprod-qa-operator/` (пароль читается из TTY с выключенным эхом —
`scripts/ops/learner-ops-fixture/tty-password.ts`), выполнить его один раз от `ata` с env
бэкенда, затем удалить. Пароль вводит владелец или инженер в своей сессии; никто никому его
не пересылает. Второго администратора не создавать; остальных сотрудников заводит
`crm_admin` через CRM.

---

## 10. Первый релиз

Порядок: **backend → crm → academy → partner**. Бэкенд первым, потому что остальные три
без него не готовы; CRM раньше академии — правило проекта на случай изменений контракта
прав.

Для каждого компонента `<c>` (от `ubuntu`, в `~`):

```bash
~/learner-ops-v1/tools/build-release.sh <c>                       # печатает BUILD_ID, commit, tree
sudo ~/learner-ops-v1/tools/publish-release.sh <c> <commit> <tree> # /srv/ata/releases/<c>/<commit>
# только для backend, только при первом релизе и при релизах с миграциями:
#   бэкап (11.1), затем миграции (9.1), затем импорт программы (9.2, один раз)
sudo ~/learner-ops-v1/tools/cutover.sh <c> <commit> <BUILD_ID>     # симлинк current + старт/рестарт юнита
```

`publish-release.sh` проверяет запас места на диске (3,8 ГБ) и совпадение каждого файла с
деревом коммита; `cutover.sh` проверяет, что юнит поднялся и слушает свой порт, и печатает
**точку отката** — предыдущий релиз.

Проверки после каждого переключения (на самом сервере, loopback):

```bash
curl -s http://127.0.0.1:3100/api/health     # {"ok":true,...}
curl -s http://127.0.0.1:3100/api/readiness  # ok:true — иначе назовёт непримененную миграцию
curl -sI http://127.0.0.1:3050/ | head -1     # 200
systemctl status ata-prod-backend ata-prod-crm ata-prod-academy ata-prod-partner --no-pager | grep -E "Active|Main PID"
journalctl -u ata-prod-backend -n 50 --no-pager
```

И снаружи, с ноутбука:

```bash
curl -sI https://alfatrade.media/ | grep -iE "HTTP|x-robots-tag"      # 200, БЕЗ x-robots-tag (индексация включена)
curl -sI https://alfatrade.media/login | grep -i x-robots-tag           # noindex, nofollow
curl -s  https://alfatrade.media/sitemap.xml                            # только https://alfatrade.media/
curl -sI https://crm.alfatrade.media/ | head -1                         # 401 — Basic Auth работает
curl -sI https://alfatrade.media/news | head -1                         # 307 на /login — новости под входом
```

---

## 11. Бэкапы и восстановление

### 11.1 Ручной бэкап перед миграцией

Всегда перед релизом бэкенда с миграцией:

```bash
sudo -u ata mkdir -p /srv/ata-data/backups/manual
sudo -u ata sqlite3 -readonly /srv/ata-data/data/ata-prod.sqlite \
  ".backup /srv/ata-data/backups/manual/ata-prod-pre-<что-меняем>-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
sudo -u ata sqlite3 -readonly /srv/ata-data/backups/manual/<файл> 'PRAGMA integrity_check;'
```

`-readonly … .backup` — это Online Backup API SQLite: живая база не блокируется и не
копируется как файл (копия файла работающей базы может быть битой).

### 11.2 Ежедневный бэкап и S3 с Object Lock

**Что.** Таймер `ata-prod-backup.timer` (03:15 UTC) запускает `/srv/ata/bin/ata-backup-sqlite`:
снимает бэкап через Online Backup API, проверяет целостность и число миграций (порог
берётся из живого релиза), публикует файл под окончательным именем только после проверки,
хранит 14 дневных / 8 недельных / 6 месячных.

**Зачем ещё и S3.** Локальные бэкапы погибнут вместе с диском. S3 с **Object Lock**
(режим Compliance, 30 дней) делает копию неудаляемой даже администратором — защита от
ошибки и от взлома.

**Как.** S3 → Create bucket `ata-prod-backups` (eu-central-1) → *Object Lock: Enable*
(включается только при создании) → Default retention: Compliance, 30 days → Block Public
Access: all. Политика роли инстанса (2.3): `s3:PutObject` и `s3:ListBucket` на этот бакет —
без `s3:DeleteObject`. Синхронизация — второй таймер:

```bash
sudo tee /etc/systemd/system/ata-prod-backup-s3.service <<'EOF'
[Unit]
Description=Copy verified SQLite backups to S3 (Object Lock)
After=ata-prod-backup.service
[Service]
Type=oneshot
User=ata
ExecStart=/usr/local/bin/aws s3 sync /srv/ata-data/backups/scheduled s3://ata-prod-backups/scheduled --no-progress
EOF
sudo tee /etc/systemd/system/ata-prod-backup-s3.timer <<'EOF'
[Unit]
Description=Daily copy of backups to S3
[Timer]
OnCalendar=*-*-* 03:45:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now ata-prod-backup-s3.timer
```

AWS CLI на сервере: `curl -fsSLo /tmp/awscli.zip https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip
&& unzip -q /tmp/awscli.zip -d /tmp && sudo /tmp/aws/install`. Ключи не нужны — CLI берёт
права из роли инстанса.

### 11.3 Восстановление (репетировать раз в месяц на отдельном инстансе)

1. Остановить бэкенд: `sudo systemctl stop ata-prod-backend`.
2. Проверить бэкап: `sqlite3 -readonly <файл> 'PRAGMA integrity_check;'`.
3. Положить его на место базы (`install -m 600 -o ata -g ata <файл> /srv/ata-data/data/ata-prod.sqlite`).
4. `sudo systemctl start ata-prod-backend` и `curl http://127.0.0.1:3100/api/readiness`.

Скрипты `npm run db:backup` / `db:restore` в бэкенде делают то же на уровне приложения;
для PROD источник правды — `ata-backup-sqlite` и эта процедура.

---

## 12. Интеграция с Pocket и капча

**Что нужно от владельца (без этого PROD не полноценен):**

| Элемент | Зачем | Куда |
|---|---|---|
| Token Pocket Partner API | проверка финансовых чекпоинтов (баланс от N) — без токена уровни с чекпоинтами не открываются, а стендовая аттестация на PROD запрещена | переменные бэкенда, которые появятся вместе с адаптером; сейчас в коде — интерфейс провайдера (`POCKET_BALANCE_PROVIDER_ENABLED`) |
| Новый `POSTBACK_SECRET` | Pocket присылает события регистрации/депозита на `https://alfatrade.media/api/postbacks/pocket?…&secret=…`; секрет подтверждает отправителя | `backend.env` и кабинет Pocket |
| Партнёрская ссылка `POCKET_AFFILIATE_BASE_URL` | по ней ученики регистрируются в Pocket, а `/go/` бэкенда добавляет атрибуцию | `backend.env` |
| Виджет Turnstile для PROD-хостов | капча на входе и регистрации (`CAPTCHA_LOGIN_ENFORCED=true`) — ключи PREPROD на других хостах не работают | `backend.env`, `academy.env`, `crm.env` |

Постбэки принимаются только `GET`, с лимитом частоты и логом без query (см. nginx).
Проверить связку после настройки: владелец делает тестовую регистрацию в Pocket по
партнёрской ссылке; в журнале бэкенда должна появиться запись о принятом постбэке, в CRM —
событие у ученика.

---

## 13. Видео уроков (следующий этап, после открытия)

Сегодня видео в продукте нет: ролики ещё не сняты, а слот под видео на главной пуст. Когда
видео появится, план такой (решение владельца от 21.09.2026):

1. **S3**: `ata-prod-video-src` (исходники) и `ata-prod-video-out` (готовые HLS-плейлисты и
   сегменты); оба закрыты от публичного доступа.
2. **MediaConvert**: шаблон `ata-lesson-hls-v1` — HLS 1080/720/480/360, QVBR, сегменты 6 с,
   кадр-постер. Запуск задания — из бэкенда, статус — по `GetJob` (EventBridge-вебхук лишь
   подсказка).
3. **CloudFront** перед `ata-prod-video-out` с **signed URLs**: бэкенд сам отдаёт `.m3u8` и
   вписывает подписанные query-строки в адреса сегментов (одна custom policy с wildcard на
   префикс кодировки). Выбрано вместо signed cookies, потому что работает на домене
   `dxxxx.cloudfront.net` без DNS, в нативном iOS Safari и AirPlay, и позволяет добавить
   второй CDN позже.
4. Ключевая пара CloudFront хранится в Secrets Manager; бэкенд читает её через роль.

Код этой части ещё не написан; когда он появится, у него будет своя документация в
`backend/docs/`. Готовить инфраструктуру заранее не нужно.

---

## 14. Эксплуатация: обновления, откат, место на диске

**Обновление** = разделы 4.4 (получить новые коммиты) → 10 (build → publish → cutover)
для изменённых компонентов. Перед релизом бэкенда с миграцией — бэкап (11.1). Перед
релизом CRM — `npm run verify:crm-session-permission-contract` в бэкенде (контракт прав
между бэкендом и CRM должен совпадать байт в байт).

**Откат** — тем же `cutover.sh` на точку отката, которую напечатало предыдущее
переключение; ничего не пересобирается. Откат бэкенда после миграции возможен только на
релиз, чья схема не старше базы — поэтому миграции и делаются после бэкапа.

**Место на диске.** Каждый релиз академии — 1,5–1,8 ГБ, бэкенда — до 0,4 ГБ. Публикация
отказывается работать без 3,8 ГБ запаса, чтобы никогда не оставить полурелиз. Старые
релизы удаляются только так: `sudo ~/learner-ops-v1/tools/prune-release.sh <c> <commit>`
печатает вердикт `PRUNABLE` и точный путь; удаляется ровно этот путь; запись об
удалении — в `tooling/prune-records/` (там же образцы). Живой релиз и точку отката гейт
не пропустит. Поставьте CloudWatch-алярм на заполнение томов выше 80 % (агент CloudWatch
или простая метрика через `aws cloudwatch put-metric-data` по cron).

**Журналы.** `journalctl -u ata-prod-<c>`; nginx — `/var/log/nginx/`. Ни в одном журнале не
должно быть паролей, токенов и сессий — если увидели, это инцидент, а не удобство.

---

## 15. Чек-лист перед открытием

- [ ] Аккаунт: Organizations, Identity Center + MFA, бюджет, CloudTrail, GuardDuty, Block Public Access, EBS-шифрование, IMDSv2.
- [ ] Хост: `m7i.xlarge`, три тома смонтированы, Elastic IP, SG только 80/443, вход через SSM.
- [ ] DNS: три A-записи; MX/SPF/DKIM/DMARC не тронуты; сертификат на три имени, продление работает.
- [ ] Node 22.14.0, npm 10.9; рабочие копии по компонентам на тех же SHA, что в README.
- [ ] tooling установлен, `--check` чистый, юниты переименованы в `ata-prod-*`.
- [ ] env-файлы: 0600, `ata:ata`; `ATA_ENVIRONMENT=production`; `STAGING_ATTESTATION_ENABLED=false`; секреты уникальные; индексация включена только для главной.
- [ ] База: миграции применены, `integrity_check` = ok, программа импортирована, `crm_admin` создан одноразовым TTY-скриптом, скрипт удалён.
- [ ] Все четыре сервиса active; health и readiness ok на loopback; снаружи: главная 200 без noindex, `/login` noindex, sitemap только главная, CRM и партнёр — 401 Basic Auth, `/news` → вход.
- [ ] Бэкапы: таймер отработал хотя бы раз, файл проверен, копия в S3 с Object Lock видна; восстановление отрепетировано.
- [ ] Pocket: постбэк принят на тестовой регистрации; партнёрская ссылка ведёт куда надо; Turnstile срабатывает на входе.
- [ ] Алярм на диск и на 5xx nginx; бюджет с уведомлением.
- [ ] Точки отката записаны; у владельца и инженера есть этот документ и `README.md`.

---

## Приложение А. Соответствие PREPROD → PROD

| | PREPROD (OVH) | PROD (AWS) |
|---|---|---|
| хосты | `preprod.`, `crm-preprod.`, `partners-preprod.alfatrade.media` | `alfatrade.media`, `crm.`, `partners.` |
| юниты | `ata-preprod-<c>.service` | `ata-prod-<c>.service` |
| база | `/srv/ata-data/data/ata-preprod.sqlite` | `/srv/ata-data/data/ata-prod.sqlite` |
| индексация | выключена везде | включена только для `/` |
| `ATA_ENVIRONMENT` | `staging` | `production` |
| аттестация чекпоинтов | разрешена (стенд) | запрещена |
| Basic Auth | CRM и партнёр | CRM и партнёр (академия открыта) |
| бэкапы | локально, таймер 03:15 UTC | локально + S3 Object Lock |
| доступ на сервер | SSH | SSM Session Manager |

## Приложение Б. Что где искать в репозитории

- `README.md` — карта репозитория, локальный запуск, проверки, релиз.
- `deploy/` — юниты, nginx, скрипт бэкапа, образцы env (этот документ ссылается на них).
- `tooling/README.md`, `backend/docs/RELEASE_ARTIFACT_CONTENTS.md`, `backend/docs/RELEASE_RETENTION.md` — как устроены релизы и хранение.
- `backend/docs/PREPROD_OPERATIONS_RUNBOOK.md` — эксплуатационные правила (Basic Auth, аккаунты операторов, конфигурация, health/readiness); для PROD они те же.
- `backend/docs/CURRICULUM_PACKAGES.md` — импорт учебной программы.
- `backend/docs/CRM_STAFF_IDENTITY.md` — роли и права сотрудников.
- `academy/docs/DESIGN_DECISIONS.md` — журнал решений продукта (DD-001…DD-326).

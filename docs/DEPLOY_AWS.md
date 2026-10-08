# Развёртывание Alpha Trade Academy на AWS — руководство инженера

Документ для инженера, который разворачивает первый PROD продукта на AWS **из этого
репозитория**. Он написан в расчёте на небольшой опыт с AWS: у каждого шага сказано,
**что** мы делаем, **зачем** и **как** именно. Эталон — PREPROD на VPS OVH
(`preprod.alfatrade.media`): PROD повторяет его раскладку один в один, а всё, что
специфично для AWS, объяснено отдельно.

Ожидаемое время: подготовка аккаунта — полдня; хост, DNS, TLS, конфигурация — день;
первый релиз и проверки — полдня. Почта (раздел 13) — ещё полдня и до суток ожидания ответа
AWS; открытию она не мешает. Видео уроков и фильм на главной — файлы на сервере (раздел 14);
переход на HLS через CloudFront — отдельный этап после открытия.

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

Позже к этой же роли добавится третья политика — право отправлять письма продукта через
Amazon SES (13.6). Принцип тот же: право получает роль, ключей на диске нет.

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
три A-записи, ничего не удаляем. (Для писем самого продукта позже добавятся ещё три записи
CNAME — раздел 13; они тоже ничего не заменяют.)

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
             /srv/ata-data/{data,uploads,logs,backups/scheduled,backups/manual} \
             /srv/ata-data/media/{lessons,public/film}
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
| `/srv/ata-data/media/` | видео уроков (`lessons/`) и фильм публичной главной (`public/film/`), раздел 14 | инженер по просьбе владельца |
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

### 4.5 Зависимости для сборки, и почему собирать только через tooling

`build-release.sh` ставит зависимости сам (`npm ci`) внутри рабочей копии и собирает
**в каноническом окружении**: `NODE_ENV=production`, `NODE_OPTIONS=--max-old-space-size=6144`
(бэкенд с кучей по умолчанию падает на сборке с OOM — проверено), плюс переменные, которые
Next.js впаивает в сборку и читает из `/srv/ata/config/<component>.env`: для академии
`ACADEMY_MODE` и `BACKEND_ORIGIN`, для CRM `CRM_MODE` и `CRM_BACKEND_ORIGIN`, для партнёра
`PARTNER_BACKEND_ORIGIN`; бэкенду на время сборки подставляется временная база. Без этих
переменных сборка CRM и партнёра **останавливается с ошибкой** («CRM_MODE must be exactly
mock or api», «PARTNER_BACKEND_ORIGIN is missing»). Отсюда порядок: env-файлы (раздел 6)
должны существовать **до** первой сборки. Заранее нужно только один раз прогреть кэш npm
под `ubuntu`, чтобы первая сборка не упёрлась в сеть:

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
| `CAPTCHA_PROVIDER=turnstile` + `CAPTCHA_LOGIN_ENFORCED=true` | backend | обязательны: без провайдера бэкенд отвечает 503 на вход и регистрацию; `CAPTCHA_DEV_BYPASS` из старого `.env.example` не действует |
| `ATA_MEDIA_ROOT=/srv/ata-data/media` | academy | уже вписано в образец; абсолютный путь к каталогу медиа (раздел 14). Без него у уроков нет видео, а фильм на главной навсегда «Скоро»; относительный путь академия не принимает |
| `ACADEMY_SEARCH_INDEXING=on` + `ACADEMY_PUBLIC_ORIGIN=https://alfatrade.media` | academy | включают индексацию **только публичной главной**; без любой из двух весь хост отвечает `noindex` — так устроено намеренно |
| `MAIL_TRANSPORT`, `MAIL_FROM`, `MAIL_SES_REGION` | backend | **не задавать**, пока не пройден раздел 13 и не выпущен релиз с отправкой через SES: с неизвестным транспортом бэкенд не проходит проверку окружения. Без них почта просто выключена |

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

**Что.** Уровни программы и их содержимое живут в пакете `backend/curriculum/packages/*.json`
и импортируются транзакционным, идемпотентным импортёром. Повторный импорт того же
пакета — no-op. Импортёр никого не публикует, не активирует и не зачисляет.

**Какой пакет.** Тот, что работает на PREPROD; перед первым релизом подтвердить у владельца.
На 04.10.2026 это `ata-v2-funnel-30.v6.draft.json` — программа `ata-v2`, версия 6: 30 уровней,
открыты 1–14, уровни 15–30 определены, но закрыты (как она устроена и обслуживается —
`backend/docs/PROGRAM_30_LEVELS.md`). Команда `scripts/ops/activateProgramVersion.ts` оттуда
заменяет **уже опубликованную** версию и на пустой базе откажет, поэтому на PROD первый раз путь
описанный ниже: импорт → редакционный цикл → публикация. Порядок: `--validate-only` →
`--dry-run` → импорт.

```bash
cd /srv/ata/releases/backend/<commit>
npm run curriculum:package:import -- --package curriculum/packages/<file>.json --validate-only --json
sudo systemd-run --uid=ata --gid=ata -p EnvironmentFile=/srv/ata/config/backend.env --wait --pipe \
  --working-directory=/srv/ata/releases/backend/<commit> /usr/local/bin/npm run curriculum:package:import -- \
  --package curriculum/packages/<file>.json --dry-run
# то же без --dry-run
```

Подробности и гарантии — `backend/docs/CURRICULUM_PACKAGES.md`.

**Импорт ≠ публикация.** После импорта версия программы и всё её содержимое (уроки,
проверки знаний, рубрики, задания отчётов) лежат в статусе `draft`, и ученики её не видят;
регистрация с автозачислением (`CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED=true`)
требует **ровно одну опубликованную** версию. Путь к публикации на PROD:

1. содержимое проходит редакционный цикл (черновик → на проверку → утверждено, «четыре
   глаза»: утверждает не автор и не отправитель) — это делают сотрудники с правами
   авторинга через CRM/API авторинга (`backend/docs/AUTHORING_FOUNDATION.md`);
2. администратор публикует версию: `POST /api/admin/curriculum/versions/<id>/publish`
   (реальная доменная команда `publishCurriculumVersion`; она же проверяет целостность
   графа и откажет, если что-то из привязанного ещё черновик).

Для **локальной проверки и стендов** есть помощник `backend/scripts/local/publishImportedCurriculum.ts`:
он переводит импортированные черновики в `published` напрямую и вызывает ту же доменную
команду публикации; на PROD он **не запускается** (отказывает при `NODE_ENV=production`)
и не заменяет редакционный цикл. Рядом `enrollLocalLearners.ts` — зачислить локальных
demo-учеников. Так был проверен клон с GitHub 27.09.2026: чистая база → 59 миграций → импорт
`ata-v2-canonical-100.v4.rev2.draft.json` → публикация помощником → регистрация ученика с
автозачислением.

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

## 13. Почта: письма о пароле и адресе (Amazon SES)

Продукт отправляет ученику шесть писем: подтверждение почты после регистрации, ссылку для
сброса пароля, «пароль изменён», подтверждение нового адреса и два уведомления прежнему
адресу — о запрошенной и о состоявшейся смене почты. Сценарии написаны, проверены и уже
выпущены (`backend/docs/ACCOUNT_RECOVERY_V1.md`). Не хватает одного — **канала, по которому
письмо уходит**. Его и готовит этот раздел.

**Кто что делает, по порядку.**

1. **Инженер** готовит отправку в AWS (13.1–13.7): подтверждает домен в Amazon SES,
   запрашивает рабочий режим, даёт серверу право отправлять, проверяет командой с сервера и
   присылает разработчику семь несекретных фактов (13.8).
2. **Разработчик** по этим фактам добавляет в бэкенд транспорт `ses` и выпускает релиз.
3. **Инженер** вписывает три строки в `backend.env` (13.9), перезапускает бэкенд и вместе с
   владельцем проверяет письма на настоящем ящике.

> **До шага 3 не задавайте в `backend.env` ни одной переменной `MAIL_*`.** Транспорта `ses`
> в нынешней сборке ещё нет, а бэкенд не работает с конфигурацией, которую не понимает: с
> `MAIL_TRANSPORT=ses` проверка окружения не пройдёт — `/api/readiness` ответит 503, вход и
> сессии перестанут работать. Пока этих строк нет, продукт ничего не обещает: на странице
> входа нет «Забыли пароль?», а почта в профиле меняется через поддержку. Так и задумано —
> открываться с выключенной почтой можно, раздел не блокирует первый релиз.

**Почему Amazon SES, а не SMTP рабочей почты и не сторонний сервис.**

- Сервер уже в AWS и ходит в сервисы по роли инстанса (2.3). Не появляется ни одного пароля
  или ключа, который нужно где-то хранить и менять.
- Письма продукта не должны идти через ящики сотрудников в Google Workspace: лимиты там
  рассчитаны на людей, а блокировка «за рассылку» остановит рабочую почту.
- Цена — около 0,10 $ за тысячу писем; для бюджета из 1.3 это незаметно.

**Что этот раздел НЕ трогает.** Рабочая почта на домене остаётся как есть. Сейчас в DNS
(проверено 01.10.2026): `MX 1 smtp.google.com`, SPF `v=spf1 include:_spf.google.com ~all`,
DMARC `v=DMARC1; p=none; rua=mailto:dmarc@alfatrade.media`, DKIM Google
(`google._domainkey`). Мы **добавляем три записи CNAME** и не меняем ни одной существующей.

**Время:** полдня работы и до суток ожидания ответа AWS на заявку из 13.4.

### 13.1 Регион и адрес отправителя

**Что.** SES настраивается в том же регионе, что и сервер, — `eu-central-1` (Франкфурт).
Отправитель: `Alpha Trade Academy <no-reply@alfatrade.media>`.

**Зачем.** SES — региональный сервис: домен, подтверждённый в одном регионе, в другом не
существует, и политика из 13.6 привязана к региону. Перед каждым шагом в консоли проверяйте
регион в правом верхнем углу. Адрес `no-reply@` — технический: для отправки ящик с таким
именем не нужен, и отдельно подтверждать его в SES **не надо** (13.6 объясняет почему).

**Решить с владельцем — куда попадают ответы на эти письма** (ответ впишите в 13.8):

| Вариант | Что будет | Что нужно |
|---|---|---|
| никуда | ответ ученика вернётся ему с ошибкой «такого адреса нет» | ничего |
| в поддержку | в письмах появится заголовок Reply-To, ответ уйдёт в ящик поддержки | назвать адрес поддержки — разработчик добавит заголовок |

### 13.2 Подтвердить домен и включить подпись DKIM

**Что.** SES должен убедиться, что домен принадлежит вам, и получить право подписывать письма
его именем.

**Зачем.** Почтовые сервисы (Gmail, Outlook, Яндекс) сверяют подпись письма с доменом в поле
«От». Письмо без подписи домена уходит в спам или отклоняется. У домена есть политика DMARC;
письмо её проходит, когда подпись DKIM сделана от имени `alfatrade.media`, — ровно это даёт
Easy DKIM.

**Как.**

1. Консоль AWS → регион **Europe (Frankfurt)** → Amazon SES → в меню слева Configuration →
   **Identities** → **Create identity**.
2. Identity details: **Domain**. В поле Domain: `alfatrade.media` (без `www`).
3. «Assign a default configuration set» — не отмечать.
4. «Use a custom MAIL FROM domain» — **не отмечать** (почему — 13.3).
5. Verifying your domain → раскрыть **Advanced DKIM settings**: Identity type **Easy DKIM**,
   DKIM signing key length **RSA_2048_BIT**. У «Publish DNS records to Route53» **снять**
   галочку Enabled: наш DNS на Namecheap (3.1). «DKIM signatures» — **Enabled**.
6. **Create identity.**
7. На странице домена: вкладка **Authentication** → раскрыть **Publish DNS records**. Там три
   записи CNAME (кнопка **Download .csv record set** сохранит их файлом). Имя каждой —
   `<токен>._domainkey.alfatrade.media`, значение оканчивается на `amazonses.com`.
8. Namecheap → Domain List → Manage → Advanced DNS → **Add New Record** → `CNAME Record`,
   три раза:

   | Поле | Что вписать |
   |---|---|
   | Host | только часть **до** домена: `<токен>._domainkey` |
   | Value | значение из консоли SES целиком, как есть |
   | TTL | Automatic |

   **Самая частая ошибка:** вставить в Host имя целиком. Namecheap сам дописывает
   `.alfatrade.media`, получится `…_domainkey.alfatrade.media.alfatrade.media`, и проверка не
   пройдёт никогда. Подчёркивание в `_domainkey` обязательно и стоит ровно одно.
9. Больше ничего не менять и не удалять: ни MX, ни TXT с `v=spf1`, ни `_dmarc`, ни
   `google._domainkey`.
10. Проверка: `dig +short CNAME <токен>._domainkey.alfatrade.media` возвращает значение из
    консоли. В SES Identity status станет **Verified**, DKIM configuration — **Successful**:
    обычно за 5–30 минут, по документации AWS — до 72 часов. Пока статус Pending — ждать,
    идентичность не пересоздавать (у новой будут другие токены).

### 13.3 Custom MAIL FROM — не сейчас

**Что это.** Технический адрес возврата (Return-Path). По умолчанию SES подставляет свой
(`…amazonses.com`), и письмо при этом выглядит как обычно: в поле «От» стоит наш адрес.

**Почему не включаем.** Для собственного MAIL FROM нужна MX-запись на поддомене. В Namecheap
MX-записи управляются общим блоком Mail Settings, и неосторожная правка там ломает рабочую
почту. Выигрыш при этом небольшой: политику DMARC письмо проходит и без него — за счёт
подписи DKIM из 13.2. Если отчёты DMARC (они приходят на `dmarc@alfatrade.media`) или жалобы
на доставку покажут, что это нужно, — отдельная аккуратная задача, не часть первого запуска.

### 13.4 Выйти из песочницы

**Что.** Новый аккаунт SES работает в «песочнице»: письма уходят только на адреса и домены,
подтверждённые в самом SES, не больше 200 в сутки и одного в секунду. Нужно запросить рабочий
режим (production access).

**Зачем.** В песочнице ученик письма не получит: его адрес в SES не подтверждён.

**Как.** SES → **Account dashboard** → в жёлтом блоке «Your Amazon SES account is in the
sandbox» → **View Get set up page** → **Request production access**. В форме:

| Поле | Что выбрать |
|---|---|
| Mail type | **Transactional** |
| Website URL | `https://alfatrade.media` |
| Additional contacts | ящик, на который придёт ответ AWS (до четырёх адресов через запятую) |
| Preferred contact language | English |
| Acknowledgement | отметить |

**Submit request.** Первый ответ поддержки AWS приходит в течение 24 часов; пока заявка на
рассмотрении, изменить её нельзя. Заявки одобряют быстрее, когда домен уже Verified —
поэтому сначала 13.2 — и когда по адресу из Website URL уже открывается главная страница:
поддержка AWS смотрит сайт. Если PROD ещё не открыт, подайте заявку сразу после раздела 10.

Часто AWS отвечает вопросом — что и кому вы отправляете. Готовый ответ (на английском,
переписку читает поддержка AWS):

> Alpha Trade Academy is an online learning platform. We send only transactional email
> triggered by the account owner's own action: confirmation of the email address after
> registration, password reset links, and notices about a changed password or email
> address. We send no marketing or bulk email and use no purchased lists. Recipients are our
> registered users, who enter their address themselves; every new address is sent a
> confirmation link. Expected volume: up to 1,000 messages per day at launch. Bounces and complaints: the
> account-level suppression list is enabled for both, and bounce and complaint notifications
> are delivered through Amazon SNS to our operations mailbox and reviewed. Messages are
> DKIM-signed with our domain, which publishes a DMARC policy.

Ждать ответа не обязательно: шаги 13.5–13.7 выполняются и в песочнице. В справке AWS
упоминается ещё снятие ограничения с порта 25 для EC2 — к нам это не относится: мы
отправляем через API по HTTPS, не по SMTP.

### 13.5 Защита репутации: список подавления и уведомления

**Что.** Две вещи. Список подавления: SES сам перестаёт отправлять на адрес, который вернул
«такого ящика нет» или пожаловался на спам. Уведомления: о каждом возврате и жалобе приходит
письмо на ящик, который читает человек.

**Зачем.** AWS приостанавливает отправку всему аккаунту при высокой доле возвратов и жалоб.
Продукт возвраты сам не разбирает — это делает список подавления, а уведомления нужны, чтобы
проблему увидел человек раньше, чем AWS.

**Как.**

1. **Список подавления.** SES → Configuration → **Suppression list** → блок Account-level
   settings. У новых аккаунтов он включён для обоих поводов; убедитесь: **Edit** →
   Suppression list **Enabled**, Suppression reasons — **Bounces and complaints** → Save
   changes.
2. **Топик уведомлений.** Amazon SNS (тот же регион) → Topics → **Create topic** → Type
   **Standard** (FIFO не подходит) → Name `ata-prod-ses-feedback` → Create topic.
3. **Разрешить SES писать в топик.** В топике → **Edit** → раскрыть **Access policy** → в
   JSON-редакторе внутри списка `"Statement": [ … ]` после существующего блока поставить
   запятую и добавить второй блок (подставьте 12-значный номер аккаунта в трёх местах):

   ```json
   {
     "Sid": "AllowSesToPublishFeedback",
     "Effect": "Allow",
     "Principal": { "Service": "ses.amazonaws.com" },
     "Action": "sns:Publish",
     "Resource": "arn:aws:sns:eu-central-1:<номер аккаунта>:ata-prod-ses-feedback",
     "Condition": {
       "StringEquals": {
         "AWS:SourceAccount": "<номер аккаунта>",
         "AWS:SourceArn": "arn:aws:ses:eu-central-1:<номер аккаунта>:identity/alfatrade.media"
       }
     }
   }
   ```

   Save changes. Существующий блок не удалять — он даёт права владельцу топика. Без этого
   шага SES молча не сможет доставить ни одного уведомления.
4. **Подписать ящик.** В топике → **Create subscription** → Protocol `Email` → Endpoint:
   рабочий ящик, который назовёт владелец → Create. На ящик придёт письмо AWS со ссылкой
   Confirm subscription — пока по ней не перешли, уведомления не приходят.
5. **Привязать к домену.** SES → Identities → `alfatrade.media` → вкладка **Notifications** →
   блок Feedback notifications → **Edit**: для **Bounce** и для **Complaint** выбрать
   `ata-prod-ses-feedback` и под каждым отметить **Include original email headers**;
   **Delivery** оставить «No SNS topic» (иначе письмо на каждую успешную доставку) → Save
   changes.
6. **Выключить дублирование по почте.** Там же, блок **Email Feedback Forwarding** → Edit →
   снять **Enabled** → Save changes. Иначе SES шлёт те же уведомления письмом на адрес
   отправителя, а ящика `no-reply@` не существует. Консоль позволит это только после шага 5
   — так и должно быть.
7. Желательно: CloudWatch → Alarms → метрики `AWS/SES` → `Reputation.BounceRate` ≥ 0.05 и
   `Reputation.ComplaintRate` ≥ 0.001 → действие: уведомление в `ata-prod-ses-feedback`.
   Это уровни, с которых AWS сам начинает разбирательство с аккаунтом; вдвое выше —
   приостановка отправки.

Два свойства, о которых полезно знать заранее. Адрес остаётся в списке подавления, пока его
не уберут руками (Suppression list → отметить адрес → Remove): если ученик уверяет, что ящик
рабочий, а письма не приходят, — первым делом смотреть сюда. И Gmail не сообщает SES о
нажатии кнопки «Спам», поэтому жалобы пользователей Gmail в уведомления не попадают.

### 13.6 Право сервера отправлять: политика на роль инстанса

**Что.** К роли `ata-prod-ec2` (2.3) добавляется политика с одним разрешением: отправить
письмо от имени `no-reply@alfatrade.media` с нашего домена.

**Зачем именно так.** Бэкенд обращается к SES с временными учётными данными роли: их выдаёт
и сам меняет AWS. **Не создавайте** IAM-пользователей, access keys и «SMTP credentials» —
это долгоживущие секреты: их придётся хранить в файле и менять руками, а утечка такого
ключа означает чужую рассылку от вашего имени. Условие на адрес отправителя сужает право
ещё раз: даже с доступом к серверу нельзя отправить письмо от `ceo@alfatrade.media`.

**Как.** IAM → Policies → **Create policy** → вкладка JSON (подставьте номер аккаунта PROD):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendAccountMailFromTheProductDomain",
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:eu-central-1:<номер аккаунта>:identity/alfatrade.media",
      "Condition": {
        "StringEquals": { "ses:FromAddress": "no-reply@alfatrade.media" }
      }
    }
  ]
}
```

Policy name `ata-prod-ses-send` → Create policy. Затем IAM → Roles → `ata-prod-ec2` → Add
permissions → Attach policies → `ata-prod-ses-send`. Перезапускать инстанс не нужно.

Политика ссылается на идентичность **домена**. Поэтому не создавайте в SES отдельную
идентичность для адреса `no-reply@alfatrade.media`: у адреса, подтверждённого отдельно, свои
настройки уведомлений и свой ARN — политика и шаг 13.5 перестанут к нему относиться.

Сетевых изменений нет: сервер обращается к `email.eu-central-1.amazonaws.com` по HTTPS, а
исходящие соединения в security group из 2.2 разрешены по умолчанию.

### 13.7 Проверка с сервера — без приложения

**Что.** Отправить письмо командой AWS CLI с самого сервера, под ролью инстанса.

**Зачем.** Одна команда проверяет всё, от чего будет зависеть бэкенд: роль даёт право,
сервер достаёт до SES, домен подписывает письма. Бэкенд будет отправлять письма тем же
вызовом (`SendEmail` API v2, обычное письмо из темы и текста) — если команда работает, ему
хватит тех же прав.

**Как.** На сервере (вход через SSM, 1.5; AWS CLI уже установлен — 11.2):

```bash
aws sesv2 send-email --region eu-central-1 \
  --from-email-address "Alfa Trade Academy <no-reply@alfatrade.media>" \
  --destination "ToAddresses=success@simulator.amazonses.com" \
  --content '{"Simple":{"Subject":{"Data":"ATA mail check","Charset":"UTF-8"},"Body":{"Text":{"Data":"Mail check from the server.","Charset":"UTF-8"}}}}'
```

Ожидаемый ответ — JSON с полем `MessageId`. `success@simulator.amazonses.com` — симулятор
AWS: принимает письмо, не влияет на репутацию и работает в песочнице.

Ещё три проверки той же командой, меняя по одному параметру:

| Что меняем | Ожидаем | Что это доказывает |
|---|---|---|
| получатель `bounce@simulator.amazonses.com` | `MessageId`, а через минуту-две на ящик из 13.5 приходит уведомление AWS о возврате | цепочка SES → SNS → ящик работает |
| получатель — ваш настоящий ящик (в песочнице его сначала подтвердить: Identities → Create identity → Email address → ссылка из письма AWS) | письмо во «Входящих»; в его исходнике («Показать оригинал» в Gmail) строки `DKIM: PASS` с доменом `alfatrade.media` и `DMARC: PASS` | домен подписывает письма, политика домена проходит |
| отправитель `test@alfatrade.media` | ошибка `AccessDeniedException` | политика пускает только `no-reply@` |

Если что-то не так:

| Ответ | Причина | Что сделать |
|---|---|---|
| `AccessDeniedException … ses:SendEmail` на правильном отправителе | политика не прикреплена к роли, в ARN другой регион или номер аккаунта | сверить 13.6 |
| `MessageRejected: Email address is not verified` | домен ещё не Verified, либо песочница и получатель не подтверждён | дождаться 13.2 / подтвердить адрес получателя |
| `Unable to locate credentials` | команда запущена не на инстансе или у инстанса нет роли | проверить роль (2.3) |
| уведомление о возврате не пришло | подписка не подтверждена или нет блока в Access policy топика | 13.5, шаги 3–4 |
| соединение зависает | исходящий 443 закрыт | правила исходящего трафика в security group |

### 13.8 Что прислать разработчику

Ни один пункт не секретен — можно обычным сообщением.

| # | Что | Пример ответа |
|---|---|---|
| 1 | Регион SES | `eu-central-1` |
| 2 | Домен и его статус | `alfatrade.media` — Verified, DKIM Successful |
| 3 | Режим | production access одобрен (дата) / пока песочница |
| 4 | Отправитель | `Alfa Trade Academy <no-reply@alfatrade.media>` |
| 5 | Куда идут ответы на письма (решение владельца, 13.1) | никуда / адрес поддержки |
| 6 | Право сервера | политика `ata-prod-ses-send` на роли `ata-prod-ec2`; четыре проверки из 13.7 прошли |
| 7 | Ящик для уведомлений о возвратах и жалобах | адрес из 13.5 |

Access keys, SMTP-пароли и любые другие секреты для почты **не создаются и не пересылаются**
— их в этой схеме нет.

### 13.9 Включение — после релиза с транспортом `ses`

Разработчик сообщит коммит релиза. После его публикации и переключения (раздел 10) добавьте
в `/srv/ata/config/backend.env` (редактором, `sudo -e`):

```
MAIL_TRANSPORT=ses
MAIL_FROM=Alfa Trade Academy <no-reply@alfatrade.media>
MAIL_SES_REGION=eu-central-1
```

`PUBLIC_APP_URL=https://alfatrade.media` там уже есть (раздел 6) — проверьте, что значение
именно такое: из него строятся ссылки в письмах. Если владелец выбрал ответы в поддержку,
разработчик назовёт ещё одну строку. Кавычки вокруг значения `MAIL_FROM` не ставить (раздел
6). Окончательные имена переменных будут в `deploy/env/backend.env.example` того же релиза —
сверьтесь с ним.

```bash
sudo systemctl restart ata-prod-backend
curl -s http://127.0.0.1:3100/api/auth/capabilities   # все три значения true
curl -s http://127.0.0.1:3100/api/readiness            # "ok":true
```

Если readiness отвечает 503 — причина названа в его же ответе, в поле `failures.env`
(значения переменных бэкенд не печатает). Самые вероятные: опечатка в `MAIL_TRANSPORT`,
кавычки вокруг `MAIL_FROM`, или релиз с транспортом `ses` ещё не переключён.

**Проверка с владельцем, на настоящем ящике:**

1. Регистрация нового ученика → приходит «Подтвердите почту» → ссылка → кнопка → «Почта
   подтверждена».
2. Страница входа → «Забыли пароль?» → письмо → новый пароль → старый пароль больше не
   подходит, а сеанс, открытый до сброса, закрыт.
3. Профиль → смена почты → письмо на новый адрес и уведомление на прежний → ссылка → вход
   по новому адресу.
4. В исходнике каждого письма: `DKIM: PASS` (`alfatrade.media`), `DMARC: PASS`; письмо во
   «Входящих», не в спаме.

**Откат** — убрать три строки `MAIL_*` и перезапустить бэкенд: «Забыли пароль?» и действия с
почтой исчезнут из интерфейса, всё остальное продолжит работать. Ссылки из уже отправленных
писем доживут свой срок (60 минут — сброс пароля, 24 часа — адрес).

---

## 14. Видео: уроки и фильм на главной

**Два режима (с 07.10.2026)** — файлы на сервере или Amazon S3 + CloudFront; выбирается
переменной академии `ATA_MEDIA_DELIVERY` (`local` по умолчанию, `cdn`). Адреса в записях уроков
и на страницах одинаковы в обоих режимах, переключение — без сборки. Подключение CDN, ключ
подписи, CORS, шаблон CloudFormation и скрипт выгрузки файлов в бакет — в
`academy/docs/ops/media-cdn/MEDIA_CDN.md` (это и есть «следующий этап» ниже, уже готовый в коде;
HLS/MediaConvert по-прежнему не написаны).

**Файлы на сервере (`local`, PREPROD с 02.10.2026)** — каталог `ATA_MEDIA_ROOT`
(`/srv/ata-data/media`), отдаёт их сама академия, без отдельной инфраструктуры:

- **Видео уроков** лежат в `lessons/<код уровня>/` и попадают туда только командой бэкенда
  `scripts/ops/registerLessonMedia.ts --level <N> --file /abs/<файл>.mp4 --media-root /srv/ata-data/media`
  (сначала с `--dry-run`): она копирует файл под именем из его sha256 и записывает строку
  урока; старые файлы не удаляет. Видео не входит в версию программы, новая версия для него не
  нужна. Академия отдаёт `/media/…` только ученику, которому бэкенд открыл этот урок.
  Подробности — `backend/docs/PROGRAM_30_LEVELS.md`, §4.2. Формат — MP4 (H.264). На PREPROD у
  уровней 1 и 4–14 пока чёрные заглушки.
- **Фильм на публичной главной** — файл `public/film/hero.mp4` (или `hero.webm`), по желанию
  постер `hero.jpg|webp|png` и русские субтитры `hero.vtt`. Академия смотрит в каталог при
  каждом заходе на главную: положили файл — появляется кнопка просмотра, релиз не нужен; пока
  файла нет, на месте плеера обложка с пометкой «Скоро». Файлы отдаются по `/film/<имя>` без
  входа и с поддержкой Range; любые другие имена — 404.
- Права: каталог и файлы принадлежат `ata` (`sudo install -o ata -g ata -m 644 <файл> <куда>`).
  В бэкап базы (раздел 11) медиа не входят: исходники роликов хранит владелец, при переезде
  сервера каталог копируется целиком (`rsync -a`).

**Следующий этап (после открытия)** — когда роликов станет много и понадобится адаптивное
качество, план такой (решение владельца от 21.09.2026):

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

Из этого плана с 07.10.2026 готово: CloudFront с signed URLs для готовых файлов (подписывает
академия, см. `academy/docs/ops/media-cdn/`). MediaConvert/HLS — не написаны; когда появятся,
у них будет своя документация в `backend/docs/`.

---

## 15. Эксплуатация: обновления, откат, место на диске

**Обновление** = разделы 4.4 (получить новые коммиты) → 10 (build → publish → cutover)
для изменённых компонентов. Перед релизом бэкенда с миграцией — бэкап (11.1). Перед
релизом CRM — `npm run verify:crm-session-permission-contract` в бэкенде (контракт прав
между бэкендом и CRM должен совпадать байт в байт).

**Откат** — тем же `cutover.sh` на точку отката, которую напечатало предыдущее
переключение; ничего не пересобирается. Откат бэкенда после миграции возможен только на
релиз, чья схема не старше базы — поэтому миграции и делаются после бэкапа.

**Миграции 63 и 64 (07.10.2026).** 63 — две живые сессии на аккаунт (`UserSession.slot`,
частичный уникальный индекс); 64 — пересборка таблицы `ToolEntryCheck` под список из семи
условий (версия 2). Обе совместимы с предыдущим бэкендом: он пишет сессию в место 0 и проверки
версии 1, и то и другое новая схема принимает. Всего миграций в этой сборке — 64.

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

## 16. Чек-лист перед открытием

- [ ] Аккаунт: Organizations, Identity Center + MFA, бюджет, CloudTrail, GuardDuty, Block Public Access, EBS-шифрование, IMDSv2.
- [ ] Хост: `m7i.xlarge`, три тома смонтированы, Elastic IP, SG только 80/443, вход через SSM.
- [ ] DNS: три A-записи; MX/SPF/DKIM/DMARC не тронуты; сертификат на три имени, продление работает.
- [ ] Node 22.14.0, npm 10.9; рабочие копии по компонентам на тех же SHA, что в README.
- [ ] tooling установлен, `--check` чистый, юниты переименованы в `ata-prod-*`.
- [ ] env-файлы: 0600, `ata:ata`; `ATA_ENVIRONMENT=production`; `STAGING_ATTESTATION_ENABLED=false`; секреты уникальные; индексация включена только для главной.
- [ ] База: миграции применены, `integrity_check` = ok, программа импортирована и опубликована (раздел 9.2), `crm_admin` создан одноразовым TTY-скриптом, скрипт удалён.
- [ ] Медиа: `ATA_MEDIA_ROOT` задан, `/srv/ata-data/media` принадлежит `ata`; видео уроков зарегистрированы или осознанно отложены; фильм главной лежит в `public/film/` — или главная честно показывает «Скоро».
- [ ] Все четыре сервиса active; health и readiness ok на loopback; снаружи: главная 200 без noindex, `/login` noindex, sitemap только главная, CRM и партнёр — 401 Basic Auth, `/news` → вход.
- [ ] Бэкапы: таймер отработал хотя бы раз, файл проверен, копия в S3 с Object Lock видна; восстановление отрепетировано.
- [ ] Pocket: постбэк принят на тестовой регистрации; партнёрская ссылка ведёт куда надо; Turnstile срабатывает на входе.
- [ ] Почта (раздел 13) — либо сделана: домен в SES Verified, DKIM Successful, рабочий режим одобрен, политика на роли, четыре проверки из 13.7 прошли, факты из 13.8 переданы разработчику; либо осознанно отложена. В обоих случаях в `backend.env` нет ни одной строки `MAIL_*` до релиза с транспортом `ses`.
- [ ] Алярм на диск и на 5xx nginx; бюджет с уведомлением.
- [ ] Точки отката записаны; у владельца и инженера есть этот документ и `README.md`.

---

## Приложение В. Проверка клона с GitHub на чистой машине (сделано 27.09.2026)

Ровно из того, что лежит в этом репозитории, продукт был поднят на отдельном порту и
проверен в браузере. Рецепт повторяем — им же можно проверять любой будущий коммит:

1. `git clone https://github.com/Blaceren/alpha.git` → `npm ci` в четырёх папках.
2. Сборка как в tooling: env-файл компонента + `NODE_OPTIONS=--max-old-space-size=6144`
   (без этого бэкенд падает по памяти, CRM и партнёр — без своих переменных).
3. Чистая база: `npm run prisma:migrate` → 59 миграций, `integrity_check` = ok.
4. Пакет `curriculum/packages/ata-v2-canonical-100.v4.rev2.draft.json`: `--validate-only` →
   `--dry-run` → импорт (версия `ata-v2` v4, статус `draft`).
5. Публикация для стенда: `NODE_ENV=development npm run prisma:seed` (demo-админ) и
   `npx tsx scripts/local/publishImportedCurriculum.ts` → версия `published`
   (77 уроков, 57 проверок). На PROD этот шаг заменяет редакционный цикл (раздел 9.2).
6. Четыре сервера `npm run start` на loopback; `/api/health` ok, `/api/readiness` ok.
7. Браузером: публичная главная → регистрация ученика → автозачисление в программу →
   вход → `/home` (первое действие «Пройдите регистрацию» во внешней торговой среде),
   `/path`, `/lessons`, `/tools`, `/news`, `/profile`; страницы входа CRM и партнёра.

Что показала проверка и что из этого важно для PROD:

- **Капча — явный контракт, без обходов.** `CAPTCHA_DEV_BYPASS` из старого
  `backend/.env.example` больше не действует; бэкенд требует `CAPTCHA_PROVIDER` и без него
  отвечает 503 `CAPTCHA_CONFIGURATION_ERROR` на регистрацию и вход. На PROD:
  `CAPTCHA_PROVIDER=turnstile`, настоящие `TURNSTILE_SECRET_KEY` / `TURNSTILE_SITE_KEY`,
  `TURNSTILE_EXPECTED_HOSTNAMES=alfatrade.media,crm.alfatrade.media`,
  `CAPTCHA_LOGIN_ENFORCED=true`. Для стенда есть тестовый провайдер:
  `ATA_ENVIRONMENT=dev`, `CAPTCHA_PROVIDER=turnstile_test`,
  `CAPTCHA_TEST_MODE=unsafe-official-turnstile-test-keys-isolated-only`, официальные
  тестовые ключи Cloudflare (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`)
  и **без** `TURNSTILE_EXPECTED_HOSTNAMES` (тестовые ответы Cloudflare всегда называют
  `example.com`). Это не обход: запрос всё равно ходит в Cloudflare.
- **Readiness строгий по адресу.** `PUBLIC_APP_URL` должен быть `https://` и не loopback —
  иначе `/api/readiness` отвечает `ok:false`, хотя `/api/health` в порядке. На PROD это
  `https://alfatrade.media`; readiness — это и есть гейт после переключения.
- **Импорт программы ≠ публикация** (раздел 9.2): ученик видит программу и автоматически
  зачисляется только после публикации версии.
- Публичные страницы и защита маршрутов ведут себя как на PREPROD: `/news` и `/home` без
  входа — 307 на `/login`; весь хост `noindex`, пока не включена индексация.

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
| медиа (раздел 14) | `/srv/ata-data/media` | `/srv/ata-data/media` |

## Приложение Б. Что где искать в репозитории

- `README.md` — карта репозитория, локальный запуск, проверки, релиз.
- `deploy/` — юниты, nginx, скрипт бэкапа, образцы env (этот документ ссылается на них).
- `tooling/README.md`, `backend/docs/RELEASE_ARTIFACT_CONTENTS.md`, `backend/docs/RELEASE_RETENTION.md` — как устроены релизы и хранение.
- `backend/docs/PREPROD_OPERATIONS_RUNBOOK.md` — эксплуатационные правила (Basic Auth, аккаунты операторов, конфигурация, health/readiness); для PROD они те же.
- `backend/docs/CURRICULUM_PACKAGES.md` — импорт учебной программы.
- `backend/docs/PROGRAM_30_LEVELS.md` — действующая программа из 30 уровней: источник, активация, видео уроков, перевод учеников на новую версию.
- `backend/docs/CRM_STAFF_IDENTITY.md` — роли и права сотрудников.
- `backend/docs/ACCOUNT_RECOVERY_V1.md` — сброс пароля, подтверждение и смена почты: маршруты, свойства, переменные почты (раздел 13 этого документа — про сторону AWS).
- `academy/docs/DESIGN_DECISIONS.md` — журнал решений продукта (DD-001…DD-345).

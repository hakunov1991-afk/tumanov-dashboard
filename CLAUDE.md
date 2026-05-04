# Проект: Tumanov CRM Dashboard

## TL;DR
Веб-дашборд CRM Tumanov на чистом HTML/JS, данные считаются Node.js-скриптами и сохраняются как JSON.
Хостится на немецком VPS (Hetzner), доступен из РФ без VPN через российский nginx-прокси.
Постепенно вытесняет старую систему на Google Apps Script (см. `D:\Claude Project\Tumanov google sheet\`).

## Связанные проекты
- **`D:\Claude Project\Tumanov google sheet\`** — оригинальные GAS-скрипты, до сих пор живут параллельно (триггеры пишут в Google Sheets, Telegram-уведомления). Изменения логики (правила подсчёта, цены кругов) — синхронизировать в обоих местах.
- **`D:\Claude Project\tumanov-rejection-fields\`** — отдельные утилиты по полям «Причина отказа N круг» и n8n-флоу (исходные файлы; рабочие копии скриптов лежат в `scripts/rejection-fields/` этого проекта).

## URL и доступы

| Что | Где |
|---|---|
| Прод (для пользователей) | http://141.105.67.20:8081 |
| GitHub | https://github.com/hakunov1991-afk/tumanov-dashboard |
| Основной сервер (Hetzner, DE) | `ssh deploy@49.13.85.110` (пароль у владельца) |
| Репо на сервере | `/var/www/tumanov-dashboard/` |
| Российский прокси (nginx) | `ssh n8n-server` (alias из ~/.ssh/config Claude Code, hostname=141.105.67.20) |

`AMO_TOKEN` хранится в env PM2-процесса `dashboard`. Достать:
```bash
pm2 env 0 | grep '^AMO_TOKEN:' | cut -d' ' -f2
```

## Архитектура

```
Пользователь (РФ)
      ↓
http://141.105.67.20:8081  ← Российский прокси (nginx, без обработки логики)
      ↓ proxy_pass
http://49.13.85.110:3000   ← Основной сервер
      ↓
Express (PM2 process: "dashboard") — отдаёт HTML/JSON, по кнопке запускает sync-скрипты
      ↓
Node.js sync-скрипты (scripts/*-sync.js)
      ↓ читают
AmoCRM API + Google Sheets API (таблица продаж)
      ↓ пишут
docs/data/sheets/*.json + docs/data/rating-db.json
```

Подробная инструкция как поднять прокси с нуля — `docs-internal/proxy-setup.txt`.

## Структура проекта

```
tumanov-dashboard/
  CLAUDE.md                              # этот файл
  docs-internal/                         # внутренняя документация
    proxy-setup.txt                      # как поднять прокси без VPN
  docs/                                  # отдаётся nginx как статика
    index.html                           # SPA с sidebar-навигацией
    css/dashboard.css
    js/
      bundle.js                          # собранный JS (concat из файлов ниже, генерится перед коммитом)
      app.js, config-loader.js, data-loader.js, formatting.js,
      amo-mapping.js, github-sync.js
      renderers/
        config-renderer.js, generic.js
        rating-period.js                 # клиентский расчёт «Рейтинг» с селектором периода
    data/
      rating-db.json                     # накопительная база: month → manager → {taken, mql, byCircle, mqlCost, margin, ...}
      managers.json                      # кеш брокеров из AMO группы 529606
      meta.json
      sheets/*.json                      # данные для каждой страницы дашборда
  scripts/                               # Node.js синки (запускаются на сервере)
    .secrets/service-account.json        # ключ Google API (НЕ в git)
    lib/
      config.js                          # AMO константы, поля, стоимости кругов, исключения
      amo-client.js                      # обёртка AMO API
      sales-sheet.js                     # чтение Google Sheets (валовая маржа)
      managers.js                        # загрузка брокеров из группы 529606 + EXCLUDED_BROKER_IDS
      utils.js
    tasks-sync.js                        # T1..T13 (задачи + brokers)
    rating-sync.js                       # маржа + рейтинг + причины закрытия
    stats-sync.js, cohort-sync.js, conversion-sync.js, interns-sync.js, leads-distribution.js
    rejection-fields/                    # см. ниже
      backfill-one.js                    # бэкфилл по одной сделке
      backfill-batch.js                  # бэкфилл массовый из lead-ids.txt
      lead-ids.txt
    package.json                         # deps: axios, googleapis
```

## Деплой

```bash
# Локально
cd D:/Claude\ Project/tumanov-dashboard
# … правки в коде …
# Если меняли что-то в docs/js/ — пересобрать bundle:
cd docs/js && cat config-loader.js data-loader.js formatting.js amo-mapping.js github-sync.js renderers/config-renderer.js renderers/generic.js renderers/rating-period.js app.js > bundle.js
cd ../..
git add . && git commit -m "..." && git push

# На сервере
ssh deploy@49.13.85.110
cd /var/www/tumanov-dashboard && git pull
# Если меняли скрипт синхронизации — пересобрать данные:
cd scripts && AMO_TOKEN=$(pm2 env 0 | grep '^AMO_TOKEN:' | cut -d' ' -f2) node rating-sync.js
# Только клиентский JS/HTML — git pull достаточно (с жёстким Ctrl+Shift+R в браузере)
```

## Ключевые AMO-константы

```js
PIPELINE_ID = 9696654
GROUP_BROKERS_PHUKET = 529606  // источник списка брокеров (вместо хардкода)
FREE_LEAD_USER_ID = 12956222
EXCLUDED_BROKER_IDS = ['13781986']  // исключаем из всех рейтингов

STAGES.TAKEN_TO_WORK = 77303674
STAGES.MQL = 77303798
STAGES.WON = 142  // успешно реализована
STAGES.LOST = 143 // закрыта и нереализована

FIELDS.REJECT_FIELD = 1617988          // «Причина отказа» (общее, исходник)
FIELDS.REJECT_ENUMS = [7450812, 7450816, 7450818, 7540559, 7555827, 7548773, 7579035]
FIELDS.CIRCLE_K2 = 1630857
FIELDS.CIRCLE_K3 = 1630859
FIELDS.CIRCLE_K4 = 1631871

CIRCLES.COSTS        = {1:100, 2:10, 3:10, 4:0}   // действует с 24.04.2026
CIRCLES.COSTS_LEGACY = {1:100, 2:30, 3:10, 4:0}   // до 24.04.2026
CIRCLES.COSTS_CUTOFF_TS = unix-ts от 2026-04-24 00:00 Phuket

SALES_SHEET = '1S5yUKgOpKGEOHxmYpV0UU7L0UoPE6rNr1BzI-1ekmhw' / 'Ответы на форму (1)'
  B = дата, C = брокер, CI(87) = маржа, AI(35) = ссылка на AMO,
  DM(117) = 2-й брокер, DO(119) = маржа 2-го

EXCLUDE_LEADS.GLOBAL    = ['28672345', '29534441', '29523291', '29416203']  // никогда не считаются
EXCLUDE_LEADS.BY_MANAGER = {'12174494': ['28926161', '27607485']}
EXCLUDE_LEADS.REASSIGN  = {leadId → brokerId, ...}  // принудительно засчитать другому
```

## Логика «Рейтинг» (за 3 полных месяца)

Полные правила в `docs-internal/rating-rules.txt`. Кратко:

- **Период по умолчанию** — последние 3 ПОЛНЫХ месяца (текущий исключается).
- **Колонки (9):** #, Брокер, Взято в работу, Прошёл MQL, % сжигания, Валовая маржа, Затраты на MQL, Личный вклад, Статус.
- **Сортировка** — по Личному вкладу (= Маржа − Затраты), DESC.
- **Список брокеров** — из AMO-группы 529606 (новый брокер автоматически появляется, удалённый — пропадает). EXCLUDED_BROKER_IDS фильтруются всегда.
- **Круг лида** определяется на момент `takenTs` (или `closedAt` если сделка закрыта). Поля кругов читаются через AMO event-history `custom_field_{N}_value_changed`.
- **Ответственный:**
  - К1 закрытый (142/143) → кто перенёс в финальный статус
  - К1 открытый → текущий `responsible_user_id`
  - К2/К3/К4 закрытый → кто перенёс в 142/143
  - К2/К3/К4 открытый → исторический ответственный в окне 15 минут после `takenTs`
- **К1-отказы** (К1 + поле 1617988 с одним из REJECT_ENUMS) — полностью исключаются.
- **Стоимость К2** — cutoff по `takenTs` относительно 24.04.2026 (см. CIRCLES выше).
- **Маржа** — из Google Sheets (валовая), фuzzy-match брокеров по имени, 2-й брокер из DM/DO.
- **Клик по любой цифре** → попап со списком AMO-ID. Для «Затраты на MQL» — попап разбит по кругам с разделением К2 legacy/current.

Расчёт идёт **на клиенте** через `docs/js/renderers/rating-period.js` из `rating-db.json` — пользователь может выбрать любой диапазон месяцев в селекторе. Серверный sync лишь обновляет `rating-db.json`.

## Параллельная страница «Валовая маржа брокеров»

`#/rating-brokers` (label «Валовая маржа брокеров»). Помесячная таблица с янв 2025 по текущий месяц. Берётся из `valovaya-marzha-brokerov.json`. Клик по ячейке → ID сделок из столбца AI таблицы продаж.

## Подпапка scripts/rejection-fields/

Заполнение полей «Причина отказа N круг» (1632879/1632881/1632883/1632885) на основе истории поля 1617988.

| Скрипт | Назначение |
|---|---|
| `backfill-one.js <leadId>` | Тестовый прогон для одной сделки. Поддерживает `--dry-run`, `--overwrite` |
| `backfill-batch.js <file> [...]` | Массовый прогон из файла со списком ID. Грузит события глобально (батчами), PATCH батчами по 50. ~250 запросов на 673 сделки = ~10 минут |
| `lead-ids.txt` | Текущий список ID для бэкфилла |

n8n флоу для **триггера на каждый webhook** AMO — `D:\Claude Project\tumanov-rejection-fields\n8n-flow-rejection-by-circle.json`.

## Лимиты AMO API

- 7 req/sec на аккаунт. Скрипты держат ~4 req/sec через `SLEEP_MS=200-250`.
- 20 000 запросов/сутки. Один полный rating-sync ≈ 1500-2500 запросов (зависит от месяцев).
- При 429 — экспоненциальный backoff внутри `amoFetch`/`amo` хелперов.
- Не запускать тяжёлые синки одновременно (rating-sync + tasks-sync одновременно может выдать 429).

## История правок (последние крупные)

- **Миграция логики из GAS в Node.js** — рейтинг, маржа, задачи, причины закрытия, круги, исключения.
- **Сервис-аккаунт Google** для чтения таблицы продаж — лежит в `scripts/.secrets/service-account.json`.
- **Логика ответственного** переписана под правила: «кто закрыл» для закрытых, «исторический» для К2/К3/К4 открытых.
- **Стоимость К2** = $30 до 24.04.2026 → $10 после (cutoff применяется по takenTs).
- **Брокер 13781986** исключён из всех расчётов (`EXCLUDED_BROKER_IDS`).
- **Дашборд** — «Рейтинг брокеров» переименован в «Валовая маржа брокеров»; задачи перенумерованы T1..T13.
- **Бэкфилл «Причина отказа N круг»** — 407 сделок успешно проставлены через `backfill-batch.js`.

## Версии rating-db.json

При апгрейде логики обязательно бампать `RATING_DB_VERSION` в `scripts/rating-sync.js` — иначе следующий запуск возьмёт устаревший кеш и не применит новую логику.

| Версия | Что добавлено |
|---|---|
| 1 | базовая taken/mql |
| 2 | byCircle, mqlCost, byCircle2Legacy |
| 3 | новая логика «ответственного» (закрытые → кто закрыл, K2-4 → исторический) |
| 4 | EXCLUDE_LEADS (global/reassign/by_manager) + EXCLUDED_BROKER_IDS |

## Что НЕ в этом проекте, но связано

- **GAS-скрипты** в `D:\Claude Project\Tumanov google sheet\` — пишут в Google Sheets, шлют в Telegram. Менять синхронно с Node.js там, где логика дублируется.
- **n8n** — отдельный сервис, флоу храним как JSON в `tumanov-rejection-fields/`.

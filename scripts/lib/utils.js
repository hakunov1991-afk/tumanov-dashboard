/**
 * Утилиты — даты, timezone, атрибуция
 * Аналог вспомогательных функций из GAS скриптов
 */

import { PHUKET_OFFSET_SEC } from './config.js';

/**
 * Текущее время в Phuket (UTC+7)
 */
export function nowPhuket() {
  const now = new Date();
  return new Date(now.getTime() + (7 * 3600000) - (now.getTimezoneOffset() * 60000));
}

/**
 * Начало дня по Пхукету для данного unix timestamp
 */
export function getStartOfDayPhuket(ts) {
  const d = new Date((ts + PHUKET_OFFSET_SEC) * 1000);
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000) - PHUKET_OFFSET_SEC;
}

/**
 * Конец дня по Пхукету для данного unix timestamp
 */
export function getEndOfDayPhuket(ts) {
  return getStartOfDayPhuket(ts) + 86400 - 1;
}

/**
 * Начало вчерашнего дня по Пхукету
 */
export function yesterdayStartPhuket() {
  const now = Math.floor(Date.now() / 1000);
  const todayStart = getStartOfDayPhuket(now);
  return todayStart - 86400;
}

/**
 * Начало текущего месяца по Пхукету
 */
export function monthStartPhuket() {
  const now = new Date();
  const phuket = new Date(now.getTime() + (7 * 3600000) - (now.getTimezoneOffset() * 60000));
  const start = new Date(Date.UTC(phuket.getUTCFullYear(), phuket.getUTCMonth(), 1));
  return Math.floor(start.getTime() / 1000) - PHUKET_OFFSET_SEC;
}

/**
 * Определяет ответственного на момент времени по массиву событий смены
 * @param {Array} events — [{created_at, value_after: [{responsible_user: {id}}]}]
 * @param {number} beforeTs — unix timestamp
 * @returns {string|null}
 */
export function findResponsibleAtTime(events, beforeTs) {
  let resp = null;
  let latestTs = 0;
  for (const ev of events) {
    if (ev.created_at <= beforeTs && ev.created_at > latestTs) {
      if (ev.value_after) {
        const after = Array.isArray(ev.value_after) ? ev.value_after : [ev.value_after];
        for (const v of after) {
          if (v.responsible_user?.id) {
            resp = String(v.responsible_user.id);
            latestTs = ev.created_at;
          }
        }
      }
    }
  }
  return resp;
}

/**
 * Форматирует число секунд в часы с одним знаком
 */
export function secsToHours(secs) {
  return Math.round(secs / 360) / 10;
}

/**
 * Unix timestamp → ISO строка в Phuket timezone
 */
export function tsToDatePhuket(ts) {
  const d = new Date((ts + PHUKET_OFFSET_SEC) * 1000);
  return d.toISOString().substring(0, 10);
}

/**
 * Создаёт ячейку с числом и привязанными ID сделок
 */
export function cell(value, leadIds) {
  if (!leadIds || leadIds.length === 0) return value;
  return { v: value, ids: leadIds };
}

/**
 * Создаёт ячейку с числом, ID и разбивкой по языку
 */
export function cellWithLang(value, ruIds, enIds) {
  const ids = [...ruIds, ...enIds];
  if (ids.length === 0) return value;
  const c = { v: value, ids };
  if (enIds.length > 0) {
    c.ru = ruIds.length;
    c.en = enIds.length;
  }
  return c;
}

/**
 * Сохраняет JSON файл атомарно (через tmp + rename)
 * Файл никогда не будет пустым — либо старый, либо новый
 */
export async function saveJson(filePath, data) {
  const { writeFile, rename } = await import('fs/promises');
  const json = JSON.stringify(data, null, 2);
  const tmpPath = filePath + '.tmp';
  await writeFile(tmpPath, json, 'utf-8');
  await rename(tmpPath, filePath);
  console.log(`Saved: ${filePath} (${json.length} bytes)`);
}

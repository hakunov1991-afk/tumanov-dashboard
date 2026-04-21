/**
 * Чтение таблицы продаж из Google Sheets.
 * Агрегация валовой маржи по брокерам и месяцам.
 *
 * Источник: Google Sheets (сервис-аккаунт через scripts/.secrets/service-account.json).
 * Лист: "Ответы на форму (1)".
 */

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SALES_SHEET } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH = join(__dirname, '../.secrets/service-account.json');

let _sheetsClient = null;

function _getClient() {
  if (_sheetsClient) return _sheetsClient;
  const creds = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

/**
 * Excel/Google Sheets serial date → JS Date (UTC)
 * Serial 0 = 30.12.1899 (Sheets использует тот же формат, что Excel)
 */
function serialToDate(serial) {
  if (typeof serial !== 'number' || !isFinite(serial)) return null;
  const ms = (serial - 25569) * 86400 * 1000;
  return new Date(ms);
}

function extractLeadIdFromLink(link) {
  if (!link || typeof link !== 'string') return null;
  const m = link.match(/\/leads\/detail\/(\d+)/);
  return m ? m[1] : null;
}

function parseAmount(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  const cleaned = v.replace(/[^0-9.\-]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

/**
 * Читает все строки продаж и возвращает сырой массив.
 * Фильтрует служебные строки (СРЫВ, Итого, ср.знач) по валидности даты.
 */
export async function readSalesRows() {
  const sheets = _getClient();
  const range = `'${SALES_SHEET.SHEET_NAME}'!A${SALES_SHEET.DATA_START_ROW}:DO`;
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SALES_SHEET.SPREADSHEET_ID,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = resp.data.values || [];
  const result = [];
  for (const r of rows) {
    // B=1, C=2, AI=34, CI=86, DM=116, DO=118 (0-based)
    const dateSerial = r[1];
    if (typeof dateSerial !== 'number' || dateSerial < SALES_SHEET.MIN_DATE_SERIAL) continue;
    const date = serialToDate(dateSerial);
    if (!date || isNaN(date.getTime())) continue;

    const broker = (r[2] || '').toString().trim();
    if (!broker) continue;

    const margin = parseAmount(r[SALES_SHEET.COL_MARGIN - 1]);
    const leadLink = r[SALES_SHEET.COL_AMO_LINK - 1];
    const leadId = extractLeadIdFromLink(leadLink);
    const broker2 = (r[SALES_SHEET.COL_BROKER2 - 1] || '').toString().trim();
    const margin2 = parseAmount(r[SALES_SHEET.COL_MARGIN2 - 1]);

    result.push({ date, broker, margin, leadId, broker2, margin2 });
  }
  return result;
}

/**
 * Поиск AMO ID брокера по имени (fuzzy-match по списку AMO-брокеров).
 * Стратегия: точное совпадение полного имени → по фамилии → по имени.
 * Возвращает ID или null.
 */
export function findManagerId(name, managers) {
  if (!name) return null;
  const normalized = name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.indexOf('нет второго') !== -1) return null;

  const entries = Object.entries(managers); // [id, fullName]
  // 1. Точное совпадение полного имени (в любом порядке слов)
  for (const [id, full] of entries) {
    const amoNorm = full.toLowerCase().replace(/\s+/g, ' ').trim();
    if (amoNorm === normalized) return id;
  }
  // По словам
  const parts = normalized.split(' ').filter(Boolean);
  // 2. Перестановка "Фамилия Имя" <-> "Имя Фамилия"
  for (const [id, full] of entries) {
    const amoParts = full.toLowerCase().split(/\s+/).filter(Boolean);
    if (amoParts.length === parts.length && amoParts.every(p => parts.includes(p))) return id;
  }
  // 3. Совпадение только по фамилии (последнее слово) или имени (первое слово)
  for (const [id, full] of entries) {
    const amoParts = full.toLowerCase().split(/\s+/).filter(Boolean);
    const amoFirst = amoParts[0];
    const amoLast = amoParts[amoParts.length - 1];
    for (const p of parts) {
      if (p === amoLast || p === amoFirst) return id;
    }
  }
  return null;
}

/**
 * Агрегирует маржу по брокеру/месяцу.
 * Возвращает:
 *   - byManagerMonth: { managerId: { 'YYYY-MM': { margin, leadIds } } }
 *   - months: [ 'YYYY-MM', ... ] — упорядоченный список месяцев с ненулевой активностью
 *   - unmatched: [ { broker, date, margin, role }, ... ] — имена, которые не удалось сопоставить
 */
export function aggregateMargin(rows, managers) {
  const byManagerMonth = {};  // { mId: { 'YYYY-MM': { margin, leadIds:Set } } }
  const unmatched = [];
  const monthSet = new Set();

  for (const mId of Object.keys(managers)) byManagerMonth[mId] = {};

  function add(mId, monthKey, amount, leadId) {
    if (!byManagerMonth[mId][monthKey]) {
      byManagerMonth[mId][monthKey] = { margin: 0, leadIds: new Set() };
    }
    byManagerMonth[mId][monthKey].margin += amount;
    if (leadId) byManagerMonth[mId][monthKey].leadIds.add(leadId);
  }

  for (const row of rows) {
    const y = row.date.getUTCFullYear();
    const m = row.date.getUTCMonth() + 1;
    const monthKey = y + '-' + String(m).padStart(2, '0');
    monthSet.add(monthKey);

    // Основной брокер
    if (row.margin !== 0) {
      const mId = findManagerId(row.broker, managers);
      if (mId) {
        add(mId, monthKey, row.margin, row.leadId);
      } else {
        unmatched.push({ broker: row.broker, date: monthKey, margin: row.margin, role: 'primary' });
      }
    }

    // Второй брокер
    if (row.broker2 && row.margin2 !== 0 && row.broker2.toLowerCase().indexOf('нет второго') === -1) {
      const mId2 = findManagerId(row.broker2, managers);
      if (mId2) {
        add(mId2, monthKey, row.margin2, row.leadId);
      } else {
        unmatched.push({ broker: row.broker2, date: monthKey, margin: row.margin2, role: 'secondary' });
      }
    }
  }

  // Конвертируем Set → Array
  const out = {};
  for (const [mId, byMonth] of Object.entries(byManagerMonth)) {
    out[mId] = {};
    for (const [mk, v] of Object.entries(byMonth)) {
      out[mId][mk] = { margin: Math.round(v.margin), leadIds: Array.from(v.leadIds) };
    }
  }

  return {
    byManagerMonth: out,
    months: Array.from(monthSet).sort(),
    unmatched,
  };
}

/**
 * Генерирует список помесячных ключей с янв 2025 по текущий месяц (Phuket).
 */
export function getMonthKeysUntilNow(startYear = 2025, startMonth = 1) {
  const now = new Date();
  // Phuket UTC+7
  const phuket = new Date(now.getTime() + 7 * 3600000);
  const endY = phuket.getUTCFullYear();
  const endM = phuket.getUTCMonth() + 1;

  const keys = [];
  let y = startYear, m = startMonth;
  while (y < endY || (y === endY && m <= endM)) {
    keys.push(y + '-' + String(m).padStart(2, '0'));
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return keys;
}

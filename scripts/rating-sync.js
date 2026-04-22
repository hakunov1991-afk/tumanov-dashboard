#!/usr/bin/env node
/**
 * Rating Sync — полный перенос GAS-логики рейтинга на Node.js.
 *
 * Что делает:
 * 1. Читает AMO-группу "Брокеры Пхукет" (529606) — список актуальных брокеров.
 * 2. Читает таблицу продаж (Google Sheets, сервис-аккаунт) → агрегирует
 *    валовую маржу по брокеру/месяцу, учитывая второго брокера из DM/DO.
 *    Пишет docs/data/sheets/valovaya-marzha-brokerov.json.
 * 3. Обновляет docs/data/rating-db.json: для каждого месяца — taken/mql,
 *    разбивка по кругам К1-К4 (по истории полей AMO 1630857/1630859/1631871),
 *    исключение К1 с причиной отказа.
 * 4. Строит 9-колоночные рейтинги:
 *    - rating.json — последние 3 полных месяца, сортировка по Личному вкладу
 *      (маржа − затраты на MQL).
 *    - rating-promezhutochny.json — 2 прошлых полных + текущий до последнего вс.
 *    Колонки: #, Брокер, Взято в работу, Прошёл MQL, % сжигания, Валовая маржа,
 *    Затраты на MQL ($), Личный вклад ($), Статус.
 * 5. Пишет prichiny-zakrytiya.json.
 *
 * Запуск: AMO_TOKEN=... node rating-sync.js
 */

import {
  amoFetch, amoFetchTransitions, amoFetchLeadsByIds,
  amoFetchCustomFieldHistory, wasCustomFieldSetBefore,
} from './lib/amo-client.js';
import { AMO, STAGES, FIELDS, CIRCLES } from './lib/config.js';
import { loadManagersFromAmo } from './lib/managers.js';
import { cell, saveJson, nowPhuket } from './lib/utils.js';
import { readSalesRows, aggregateMargin, getMonthKeysUntilNow } from './lib/sales-sheet.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../docs/data/sheets');
const RAW_DIR = join(__dirname, '../docs/data');

const RATING_DB_VERSION = 2; // v2 добавил byCircle + mqlCost

// Стартовая точка rating-db (для taken/mql по месяцам)
const RATING_DB_START_YEAR = 2025;
const RATING_DB_START_MONTH = 11; // Ноябрь 2025

// ==================== ВАЛОВАЯ МАРЖА БРОКЕРОВ ====================

async function syncMargin(managers) {
  console.log('--- Маржа: чтение таблицы продаж ---');
  const rows = await readSalesRows();
  console.log(`  Валидных строк: ${rows.length}`);

  const { byManagerMonth, unmatched } = aggregateMargin(rows, managers);

  if (unmatched.length > 0) {
    console.log(`  Не сопоставлено с брокером AMO: ${unmatched.length}`);
    const uniq = {};
    for (const u of unmatched) uniq[u.broker] = (uniq[u.broker] || 0) + 1;
    for (const [name, count] of Object.entries(uniq)) {
      console.log(`    "${name}" — ${count} раз`);
    }
  }

  const monthKeys = getMonthKeysUntilNow(2025, 1);
  console.log(`  Месяцев в таблице: ${monthKeys.length} (${monthKeys[0]} … ${monthKeys[monthKeys.length - 1]})`);

  const headers = ['Брокер', ...monthKeys];
  const outRows = [];
  const monthTotal = {}, monthIds = {};
  for (const mk of monthKeys) { monthTotal[mk] = 0; monthIds[mk] = new Set(); }

  for (const [mId, name] of Object.entries(managers)) {
    const rowCells = [name];
    for (const mk of monthKeys) {
      const data = byManagerMonth[mId] && byManagerMonth[mId][mk];
      if (data && data.margin !== 0) {
        rowCells.push(cell(data.margin, data.leadIds));
        monthTotal[mk] += data.margin;
        for (const id of data.leadIds) monthIds[mk].add(id);
      } else {
        rowCells.push(0);
      }
    }
    outRows.push(rowCells);
  }

  const totalRow = ['ИТОГО'];
  for (const mk of monthKeys) totalRow.push(cell(monthTotal[mk], Array.from(monthIds[mk])));

  await saveJson(join(DATA_DIR, 'valovaya-marzha-brokerov.json'), {
    _meta: { sheet: 'Валовая маржа брокеров', updated: new Date().toISOString() },
    tables: [{
      id: 'margin-brokers',
      title: 'Валовая маржа брокеров (помесячно, $)',
      headers: [headers],
      rows: outRows,
      totals: totalRow,
    }],
  });
  console.log('--- Маржа: записано ---');

  return byManagerMonth;
}

// ==================== RATING DB (taken, mql, circles) ====================

async function loadRatingDb() {
  const dbPath = join(RAW_DIR, 'rating-db.json');
  try {
    return JSON.parse(await readFile(dbPath, 'utf-8'));
  } catch {
    return { version: RATING_DB_VERSION, months: {} };
  }
}

function monthKeysFrom(startYear, startMonth, phuket) {
  const keys = [];
  let y = startYear, m = startMonth;
  const endY = phuket.getUTCFullYear();
  const endM = phuket.getUTCMonth() + 1;
  while (y < endY || (y === endY && m <= endM)) {
    keys.push({
      key: y + '-' + String(m).padStart(2, '0'),
      year: y, month: m,
    });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return keys;
}

function monthRangeSec(year, month0, phuket, nowTs) {
  // month0 — 0-based (0=Jan), year — полный
  const start = Math.floor(Date.UTC(year, month0, 1) / 1000) - 7 * 3600;
  const endDate = new Date(Date.UTC(year, month0 + 1, 0, 23, 59, 59));
  const endRaw = Math.floor(endDate.getTime() / 1000) - 7 * 3600;
  const isCurrent = year === phuket.getUTCFullYear() && month0 === phuket.getUTCMonth();
  return { start, end: isCurrent ? nowTs : endRaw, isCurrent };
}

async function updateRatingDb(managers) {
  console.log('--- Rating DB: обновление ---');
  let db = await loadRatingDb();
  if (db.version !== RATING_DB_VERSION) {
    console.log(`  Новая версия DB (${RATING_DB_VERSION}), полный пересчёт`);
    db = { version: RATING_DB_VERSION, months: {} };
  }

  const phuket = nowPhuket();
  const nowTs = Math.floor(Date.now() / 1000);
  const monthDefs = monthKeysFrom(RATING_DB_START_YEAR, RATING_DB_START_MONTH, phuket);

  // Определяем, какие месяцы нужно пересчитывать:
  //   - текущий месяц всегда
  //   - если нет данных или нет byCircle — тоже
  const monthsToSync = monthDefs.filter(({ key, year, month }) => {
    const rec = db.months[key];
    const rng = monthRangeSec(year, month - 1, phuket, nowTs);
    if (rng.isCurrent) return true;
    if (!rec || !rec.managers) return true;
    // Проверим что хотя бы у одного менеджера есть byCircle
    const anyMgr = Object.values(rec.managers)[0];
    if (!anyMgr || !anyMgr.byCircle) return true;
    return false;
  });

  if (monthsToSync.length === 0) {
    console.log('  Все месяцы актуальны');
    return db;
  }

  // Определяем общий диапазон истории полей кругов: от самого раннего месяца до now
  const earliestMonth = monthsToSync[0];
  const earliestRange = monthRangeSec(earliestMonth.year, earliestMonth.month - 1, phuket, nowTs);
  const historyFrom = earliestRange.start - 90 * 86400; // минус 90 дней как запас
  console.log(`  Загрузка истории кругов: ${new Date(historyFrom * 1000).toISOString().substring(0, 10)} — ${new Date(nowTs * 1000).toISOString().substring(0, 10)}`);

  const k2History = await amoFetchCustomFieldHistory(FIELDS.CIRCLE_K2, historyFrom, nowTs);
  const k3History = await amoFetchCustomFieldHistory(FIELDS.CIRCLE_K3, historyFrom, nowTs);
  const k4History = await amoFetchCustomFieldHistory(FIELDS.CIRCLE_K4, historyFrom, nowTs);
  console.log(`  События: K2=${countHistory(k2History)}, K3=${countHistory(k3History)}, K4=${countHistory(k4History)}`);

  for (const { key, year, month } of monthsToSync) {
    const rng = monthRangeSec(year, month - 1, phuket, nowTs);
    console.log(`  ${key}: загрузка из AMO (start=${rng.start}, end=${rng.end})`);

    const takenTransitions = await amoFetchTransitions(STAGES.TAKEN_TO_WORK, rng.start, rng.end);
    const mqlTransitions = await amoFetchTransitions(STAGES.MQL, rng.start, rng.end);

    // Уникальные takenLeadIds — запросим подробные данные (responsible_user_id, status, custom_fields, closed_at)
    const uniqueTakenIds = [...new Set(takenTransitions.map(t => t.leadId))];
    const leadInfoMap = {};
    if (uniqueTakenIds.length > 0) {
      const leads = await amoFetchLeadsByIds(uniqueTakenIds);
      for (const l of leads) {
        leadInfoMap[String(l.id)] = {
          respId: String(l.responsible_user_id),
          statusId: l.status_id,
          closedAt: l.closed_at,
          customFields: l.custom_fields_values || [],
        };
      }
    }

    // Проверка причины отказа (для исключения К1-отказов) — по current state custom_fields
    const REJECT_FIELD = FIELDS.REJECT_FIELD;
    const REJECT_ENUMS = new Set(FIELDS.REJECT_ENUMS);
    function hasReject(lid) {
      const info = leadInfoMap[lid];
      if (!info) return false;
      for (const cf of info.customFields) {
        if (cf.field_id === REJECT_FIELD && cf.values && cf.values.length > 0) {
          for (const v of cf.values) {
            if (REJECT_ENUMS.has(v.enum_id)) return true;
          }
        }
      }
      return false;
    }

    // Инициализация byManager
    const byManager = {};
    for (const mId of Object.keys(managers)) {
      byManager[mId] = {
        taken: 0, mql: 0, takenIds: [], mqlIds: [],
        byCircle: { 1: [], 2: [], 3: [], 4: [] },
        mqlCost: 0,
      };
    }

    // Для каждого taken-перехода: определяем круг и ответственного
    const takenLeadToManager = {}; // lid -> mId
    const k1RejectedIds = new Set();

    for (const t of takenTransitions) {
      const lid = t.leadId;
      const info = leadInfoMap[lid];
      const respId = info ? info.respId : t.managerId;
      if (!byManager[respId]) continue; // ответственный не брокер

      // circleTs = transition ts; если сделка закрыта — момент закрытия
      let circleTs = t.ts;
      if (info && (info.statusId === STAGES.WON || info.statusId === STAGES.LOST) && info.closedAt) {
        circleTs = info.closedAt;
      }

      const hasK4 = wasCustomFieldSetBefore(k4History, lid, circleTs);
      const hasK3 = wasCustomFieldSetBefore(k3History, lid, circleTs);
      const hasK2 = wasCustomFieldSetBefore(k2History, lid, circleTs);
      let circle = 1;
      if (hasK4) circle = 4;
      else if (hasK3) circle = 3;
      else if (hasK2) circle = 2;

      if (circle === 1 && hasReject(lid)) {
        k1RejectedIds.add(lid);
        continue; // К1-отказ — полностью исключаем
      }

      if (byManager[respId].takenIds.indexOf(lid) === -1) {
        byManager[respId].takenIds.push(lid);
        byManager[respId].byCircle[circle].push(lid);
        byManager[respId].taken++;
        takenLeadToManager[lid] = respId;
      }
    }

    // MQL = taken, прошедшие MQL-этап в тот же период (и не К1-отказ)
    const mqlSet = new Set(mqlTransitions.map(t => t.leadId));
    for (const lid of Object.keys(takenLeadToManager)) {
      const mId = takenLeadToManager[lid];
      if (mqlSet.has(lid)) {
        byManager[mId].mqlIds.push(lid);
        byManager[mId].mql++;
      }
    }

    // Затраты на MQL (по кругам)
    for (const mId of Object.keys(byManager)) {
      const d = byManager[mId];
      let cost = 0;
      for (const c of [1, 2, 3, 4]) {
        cost += d.byCircle[c].length * (CIRCLES.COSTS[c] || 0);
      }
      d.mqlCost = cost;
    }

    db.months[key] = {
      managers: byManager,
      updatedAt: new Date().toISOString(),
      isFinal: !rng.isCurrent,
      k1Rejected: k1RejectedIds.size,
    };
    console.log(`    ${key}: брокеров с активностью=${Object.values(byManager).filter(m => m.taken > 0).length}, K1-отказов=${k1RejectedIds.size}`);
  }

  db._meta = {
    updatedAt: new Date().toISOString(),
    monthCount: Object.keys(db.months).length,
    managerNames: managers,
  };

  await saveJson(join(RAW_DIR, 'rating-db.json'), db);
  console.log(`--- Rating DB: OK, ${Object.keys(db.months).length} месяцев ---`);
  return db;
}

function countHistory(h) {
  let c = 0;
  for (const k of Object.keys(h)) c += h[k].length;
  return c;
}

// ==================== РЕЙТИНГ (9 колонок) ====================

function buildRatingRows(db, monthKeys, managers, marginByManagerMonth) {
  const scores = [];

  for (const [mId, name] of Object.entries(managers)) {
    let totalTaken = 0, totalMql = 0, totalCost = 0, totalMargin = 0;
    const allTakenIds = [], allMqlIds = [];
    const mqlCostLeadIds = []; // все лиды, которые формируют затраты
    const circleCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const circleIds = { 1: [], 2: [], 3: [], 4: [] };

    for (const mk of monthKeys) {
      const data = db.months[mk] && db.months[mk].managers && db.months[mk].managers[mId];
      if (data) {
        totalTaken += data.taken || 0;
        totalMql += data.mql || 0;
        totalCost += data.mqlCost || 0;
        if (data.takenIds) allTakenIds.push(...data.takenIds);
        if (data.mqlIds) allMqlIds.push(...data.mqlIds);
        if (data.byCircle) {
          for (const c of [1, 2, 3, 4]) {
            const ids = data.byCircle[c] || [];
            circleCounts[c] += ids.length;
            circleIds[c].push(...ids);
            mqlCostLeadIds.push(...ids);
          }
        }
      }
      const margin = marginByManagerMonth[mId] && marginByManagerMonth[mId][mk];
      if (margin) totalMargin += margin.margin;
    }

    const burnPct = totalTaken > 0
      ? Math.round((totalTaken - totalMql) / totalTaken * 100)
      : 0;
    const contribution = Math.round(totalMargin - totalCost);

    // Тултип для «Затраты на MQL»
    const costParts = [];
    for (const c of [1, 2, 3, 4]) {
      if (circleCounts[c] > 0) {
        const sub = circleCounts[c] * (CIRCLES.COSTS[c] || 0);
        costParts.push(`К${c} ($${CIRCLES.COSTS[c]}) × ${circleCounts[c]} = $${sub}`);
      }
    }
    const costNote = costParts.join('\n');

    scores.push({
      id: mId, name,
      taken: totalTaken, takenIds: allTakenIds,
      mql: totalMql, mqlIds: allMqlIds,
      burnPct,
      margin: Math.round(totalMargin),
      cost: totalCost,
      contribution,
      costLeadIds: mqlCostLeadIds,
      costNote,
    });
  }

  scores.sort((a, b) => b.contribution - a.contribution);

  return scores.map((m, i) => {
    const place = i + 1;
    const isLoss = m.contribution <= 0;
    let status;
    if (place === 1) status = 'Лидер';
    else if (place === 2) status = 'ТОП 2';
    else if (place === 3) status = 'ТОП 3';
    else if (isLoss) status = 'убыточный';
    else status = 'рентабельный';

    const nameDisplay = place === 1 ? '🥇 ' + m.name : m.name;

    const costCell = m.cost > 0
      ? { v: m.cost, ids: m.costLeadIds, note: m.costNote }
      : 0;

    return [
      place,
      nameDisplay,
      cell(m.taken, m.takenIds),
      cell(m.mql, m.mqlIds),
      m.burnPct + '%',
      m.margin,
      costCell,
      m.contribution,
      status,
    ];
  });
}

function getLastSunday(phuket) {
  const d = new Date(phuket);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 0 : day));
  return d;
}

// ==================== ПРИЧИНЫ ЗАКРЫТИЯ ====================

async function syncClosureReasons(managers) {
  console.log('--- Причины закрытия: загрузка ---');
  const nowTs = Math.floor(Date.now() / 1000);
  const threeMonthsAgo = nowTs - 90 * 86400;

  const fieldData = await amoFetch(`${AMO.API_BASE}/leads/custom_fields/${FIELDS.REJECT_FIELD}`);
  const enums = {};
  if (fieldData && fieldData.enums) {
    for (const e of fieldData.enums) enums[e.id] = e.value;
  }
  console.log(`  Enum'ов причин: ${Object.keys(enums).length}`);

  const mqlTransitions = await amoFetchTransitions(STAGES.MQL, threeMonthsAgo, nowTs);
  const mqlLeadIds = [...new Set(mqlTransitions.map(t => t.leadId))];

  const lostTransitions = await amoFetchTransitions(STAGES.LOST, threeMonthsAgo, nowTs);
  const lostLeadSet = new Set(lostTransitions.map(t => t.leadId));
  const closedMqlLeads = mqlLeadIds.filter(id => lostLeadSet.has(id));
  console.log(`  Закрытых MQL: ${closedMqlLeads.length}`);

  const leads = await amoFetchLeadsByIds(closedMqlLeads);
  const reasonCounts = {};

  for (const lead of leads) {
    const resp = String(lead.responsible_user_id);
    if (!managers[resp]) continue;
    let reasonId = null;
    if (lead.custom_fields_values) {
      for (const cf of lead.custom_fields_values) {
        if (cf.field_id === FIELDS.REJECT_FIELD && cf.values && cf.values.length > 0) {
          reasonId = cf.values[0].enum_id;
          break;
        }
      }
    }
    if (!reasonId) continue;
    if (!reasonCounts[resp]) reasonCounts[resp] = {};
    if (!reasonCounts[resp][reasonId]) reasonCounts[resp][reasonId] = [];
    reasonCounts[resp][reasonId].push(String(lead.id));
  }

  const allReasonIds = Object.keys(enums).map(Number).sort((a, b) => a - b);
  const headers = ['Брокер', ...allReasonIds.map(id => enums[id] || `Причина ${id}`), 'ИТОГО'];
  const rows = [];
  const reasonTotals = {};
  allReasonIds.forEach(id => { reasonTotals[id] = { v: 0, ids: [] }; });
  let grandTotal = 0;

  for (const [managerId, name] of Object.entries(managers)) {
    const rowCells = [name];
    let rowTotal = 0;
    for (const reasonId of allReasonIds) {
      const ids = reasonCounts[managerId] && reasonCounts[managerId][reasonId] || [];
      rowCells.push(cell(ids.length, ids));
      rowTotal += ids.length;
      reasonTotals[reasonId].v += ids.length;
      reasonTotals[reasonId].ids.push(...ids);
    }
    rowCells.push(cell(rowTotal, []));
    grandTotal += rowTotal;
    rows.push(rowCells);
  }

  const totalRow = ['ИТОГО'];
  for (const reasonId of allReasonIds) totalRow.push(cell(reasonTotals[reasonId].v, reasonTotals[reasonId].ids));
  totalRow.push(cell(grandTotal, []));

  console.log(`--- Причины закрытия: OK, ${grandTotal} закрытий ---`);
  return { id: 'closure', title: 'Причины закрытия (последние 3 месяца)', headers: [headers], rows, totals: totalRow };
}

// ==================== MAIN ====================

async function main() {
  console.log('=== Rating Sync ===');
  if (!AMO.TOKEN) { console.error('AMO_TOKEN не задан!'); process.exit(1); }

  const managers = await loadManagersFromAmo();
  console.log(`Менеджеров: ${Object.keys(managers).length}`);
  const phuket = nowPhuket();

  // 1. Валовая маржа
  const marginByManagerMonth = await syncMargin(managers);

  // 2. Rating DB (taken, mql, circles)
  const db = await updateRatingDb(managers);

  // 2b. Дописываем маржу в каждый месяц/менеджер для клиента (rating-period.js)
  for (const mk of Object.keys(db.months)) {
    const mgrs = db.months[mk].managers || {};
    for (const mId of Object.keys(mgrs)) {
      const m = marginByManagerMonth[mId] && marginByManagerMonth[mId][mk];
      mgrs[mId].margin = m ? m.margin : 0;
      mgrs[mId].marginLeadIds = m ? m.leadIds : [];
    }
  }
  await saveJson(join(RAW_DIR, 'rating-db.json'), db);

  // 3. Определяем периоды
  const allKeys = Object.keys(db.months).sort();
  const fullMonthKeys = allKeys.filter(k => db.months[k].isFinal);
  const last3Full = fullMonthKeys.slice(-3);

  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU', { timeZone: 'Asia/Bangkok' }) + ' ' +
    now.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });

  const ratingHeaders = ['#', 'Брокер', 'Взято в работу (тэг MQL)', 'Прошёл шаг MQL', '% сжигания (не установлен контакт)', 'Валовая маржа', 'Затраты на MQL ($)', 'Личный вклад ($)', 'Статус'];

  // 4. Рейтинг — последние 3 полных месяца
  if (last3Full.length > 0) {
    const rows = buildRatingRows(db, last3Full, managers, marginByManagerMonth);
    const periodStr = last3Full[0] + ' — ' + last3Full[last3Full.length - 1];
    await saveJson(join(DATA_DIR, 'rating.json'), {
      _meta: { sheet: 'Рейтинг', updated: now.toISOString() },
      tables: [{
        id: 'rating',
        title: 'Период: ' + periodStr + '  |  Сформирован: ' + dateStr + '\n\uD83C\uDFC6 ВКЛАД ЗА ПРОШЕДШИЕ 3 МЕСЯЦА',
        headers: [ratingHeaders],
        rows,
      }],
    });
    console.log(`Рейтинг: последние 3 полных = ${last3Full.join(', ')}`);
  }

  // 5. Промежуточный — 2 прошлых полных + текущий до последнего воскресенья
  const lastSunday = getLastSunday(phuket);
  const currentMonthKey = phuket.getUTCFullYear() + '-' + String(phuket.getUTCMonth() + 1).padStart(2, '0');
  const prev2 = fullMonthKeys.slice(-2);
  const interimKeys = [...prev2, currentMonthKey].filter(k => db.months[k]);

  if (interimKeys.length > 0) {
    const rows = buildRatingRows(db, interimKeys, managers, marginByManagerMonth);
    const interimEnd = lastSunday.toLocaleDateString('ru-RU');
    const periodStr = interimKeys[0] + ' — ' + interimEnd;
    await saveJson(join(DATA_DIR, 'rating-promezhutochny.json'), {
      _meta: { sheet: 'Рейтинг промежуточный', updated: now.toISOString() },
      tables: [{
        id: 'rating-interim',
        title: 'Период: ' + periodStr + '  |  Сформирован: ' + dateStr + '\n\uD83C\uDFC6 Вклад за прошедшие 2 месяца + текущий до ' + interimEnd,
        headers: [ratingHeaders],
        rows,
      }],
    });
    console.log(`Промежуточный: ${interimKeys.join(', ')}`);
  }

  // 6. Причины закрытия
  const closureTable = await syncClosureReasons(managers);
  await saveJson(join(DATA_DIR, 'prichiny-zakrytiya.json'), {
    _meta: { sheet: 'Причины закрытия', updated: now.toISOString() },
    tables: [closureTable],
  });

  console.log('=== Rating Sync завершён ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

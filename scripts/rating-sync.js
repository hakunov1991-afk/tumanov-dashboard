#!/usr/bin/env node
/**
 * Rating Sync — накопительная база рейтинга по месяцам
 * Каждый день дописывает текущий месяц. Прошлые месяцы зафиксированы.
 * Дашборд на клиенте выбирает период и мгновенно считает рейтинг.
 *
 * Запуск: AMO_TOKEN=... node rating-sync.js
 */

import { amoFetch, amoFetchAll, amoFetchTransitions, amoFetchLeadsByIds } from './lib/amo-client.js';
import { AMO, STAGES, FIELDS } from './lib/config.js';
import { loadManagersFromAmo } from './lib/managers.js';
import { cell, saveJson, nowPhuket } from './lib/utils.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../docs/data/sheets');
const RAW_DIR = join(__dirname, '../docs/data');

// ==================== НАКОПИТЕЛЬНАЯ БАЗА ====================

async function loadRatingDb() {
  const dbPath = join(RAW_DIR, 'rating-db.json');
  try {
    return JSON.parse(await readFile(dbPath, 'utf-8'));
  } catch {
    return { months: {} };
  }
}

async function updateRatingDb(managers) {
  console.log('Rating DB: обновление...');
  const db = await loadRatingDb();
  const phuket = nowPhuket();
  const nowTs = Math.floor(Date.now() / 1000);

  // Определяем все месяцы с ноября 2025
  const allMonths = [];
  let d = new Date(Date.UTC(2025, 10, 1)); // ноябрь 2025
  while (d <= phuket) {
    const key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
    const start = Math.floor(d.getTime() / 1000) - 7 * 3600;
    const endDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59));
    const end = Math.floor(endDate.getTime() / 1000) - 7 * 3600;

    const isCurrentMonth = d.getUTCFullYear() === phuket.getUTCFullYear() && d.getUTCMonth() === phuket.getUTCMonth();

    allMonths.push({ key, start, end: isCurrentMonth ? nowTs : end, isCurrent: isCurrentMonth });
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }

  // Обновляем: текущий месяц всегда, прошлые — только если нет данных
  for (const month of allMonths) {
    if (!month.isCurrent && db.months[month.key]) {
      console.log(`  ${month.key}: уже в базе, пропускаю`);
      continue;
    }

    console.log(`  ${month.key}: загрузка из AMO...`);
    const takenTransitions = await amoFetchTransitions(STAGES.TAKEN_TO_WORK, month.start, month.end);
    const mqlTransitions = await amoFetchTransitions(STAGES.MQL, month.start, month.end);

    const byManager = {};
    for (const mId of Object.keys(managers)) {
      byManager[mId] = { taken: 0, mql: 0, takenIds: [], mqlIds: [] };
    }

    const uniqueIds = [...new Set(takenTransitions.map(t => t.leadId))];
    if (uniqueIds.length > 0) {
      const leadsData = await amoFetchLeadsByIds(uniqueIds);
      const leadResp = {};
      for (const l of leadsData) leadResp[String(l.id)] = String(l.responsible_user_id);

      for (const t of takenTransitions) {
        const resp = leadResp[t.leadId] || t.managerId;
        if (byManager[resp]) {
          byManager[resp].taken++;
          if (!byManager[resp].takenIds.includes(t.leadId)) byManager[resp].takenIds.push(t.leadId);
        }
      }
    }

    const mqlSet = new Set(mqlTransitions.map(t => t.leadId));
    for (const [mId, data] of Object.entries(byManager)) {
      data.mqlIds = data.takenIds.filter(id => mqlSet.has(id));
      data.mql = data.mqlIds.length;
    }

    db.months[month.key] = {
      managers: byManager,
      updatedAt: new Date().toISOString(),
      isFinal: !month.isCurrent,
    };
  }

  db._meta = {
    updatedAt: new Date().toISOString(),
    monthCount: Object.keys(db.months).length,
    managerNames: managers,
  };

  await saveJson(join(RAW_DIR, 'rating-db.json'), db);
  console.log(`Rating DB: OK, ${Object.keys(db.months).length} месяцев`);
  return db;
}

// ==================== РЕЙТИНГ ТАБЛИЦЫ ДЛЯ ДАШБОРДА ====================

function calcRating(db, monthKeys, managers) {
  const scores = [];

  for (const [managerId, name] of Object.entries(managers)) {
    let totalTaken = 0, totalMql = 0;
    const allTakenIds = [], allMqlIds = [];

    for (const mk of monthKeys) {
      const data = db.months[mk]?.managers?.[managerId];
      if (!data) continue;
      totalTaken += data.taken;
      totalMql += data.mql;
      allTakenIds.push(...data.takenIds);
      allMqlIds.push(...data.mqlIds);
    }

    const burnPct = totalTaken > 0 ? Math.round((totalTaken - totalMql) / totalTaken * 100) : 0;
    scores.push({ id: managerId, name, taken: totalTaken, takenIds: allTakenIds, mql: totalMql, mqlIds: allMqlIds, burnPct });
  }

  scores.sort((a, b) => b.mql - a.mql);

  const rows = scores.map((m, i) => {
    const place = i + 1;
    let status;
    if (place === 1) status = 'Лидер';
    else if (place <= 3) status = 'ТОП ' + place;
    else if (m.mql > 0) status = 'рентабельный';
    else status = 'убыточный';

    return [place, m.name, cell(m.taken, m.takenIds), cell(m.mql, m.mqlIds), m.burnPct + '%', status];
  });

  return rows;
}

function getLastSunday(phuket) {
  const d = new Date(phuket);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 0 : day));
  return d;
}

// ==================== ПРИЧИНЫ ЗАКРЫТИЯ ====================

async function syncClosureReasons(managers) {
  console.log('Причины закрытия: загрузка...');
  const nowTs = Math.floor(Date.now() / 1000);
  const threeMonthsAgo = nowTs - 90 * 86400;

  console.log('  Загрузка структуры поля 1617988...');
  const fieldData = await amoFetch(`${AMO.API_BASE}/leads/custom_fields/${FIELDS.REJECT_FIELD}`);
  const enums = {};
  if (fieldData?.enums) {
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
        if (cf.field_id === FIELDS.REJECT_FIELD && cf.values?.length > 0) {
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

  // Все enum'ы из структуры поля — динамически (новые причины появляются автоматически)
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
      const ids = reasonCounts[managerId]?.[reasonId] || [];
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

  console.log(`Причины закрытия: OK, ${grandTotal} закрытий`);
  return { id: 'closure', title: 'Причины закрытия (последние 3 месяца)', headers: [headers], rows, totals: totalRow };
}

// ==================== MAIN ====================

async function main() {
  console.log('=== Rating Sync ===');
  if (!AMO.TOKEN) { console.error('AMO_TOKEN не задан!'); process.exit(1); }

  const managers = await loadManagersFromAmo();
  console.log(`Менеджеров: ${Object.keys(managers).length}`);
  const phuket = nowPhuket();

  // 1. Обновляем накопительную базу
  const db = await updateRatingDb(managers);

  // 2. Рейтинг — последние 3 полных месяца (для дефолтного отображения)
  const allKeys = Object.keys(db.months).sort();
  const fullMonthKeys = allKeys.filter(k => db.months[k].isFinal);
  const last3Full = fullMonthKeys.slice(-3);

  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU', { timeZone: 'Asia/Bangkok' }) + ' ' +
    now.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });

  if (last3Full.length > 0) {
    const ratingRows = calcRating(db, last3Full, managers);
    const periodStr = last3Full[0] + ' — ' + last3Full[last3Full.length - 1];

    await saveJson(join(DATA_DIR, 'rating.json'), {
      _meta: { sheet: 'Рейтинг', updated: now.toISOString() },
      tables: [{
        id: 'rating',
        title: 'Период: ' + periodStr + '  |  Сформирован: ' + dateStr + '\n\uD83C\uDFC6 ВКЛАД ЗА ПРОШЕДШИЕ 3 МЕСЯЦА',
        headers: [['#', 'Брокер', 'Взято в работу (тег MQL)', 'Прошёл шаг MQL', '% сжигания', 'Статус']],
        rows: ratingRows,
      }],
    });
  }

  // 3. Промежуточный рейтинг — 2 прошлых месяца + текущий до последнего воскресенья
  const lastSunday = getLastSunday(phuket);
  const currentMonthKey = phuket.getUTCFullYear() + '-' + String(phuket.getUTCMonth() + 1).padStart(2, '0');
  const prev2 = fullMonthKeys.slice(-2);
  const interimKeys = [...prev2, currentMonthKey].filter(k => db.months[k]);

  if (interimKeys.length > 0) {
    const interimRows = calcRating(db, interimKeys, managers);
    const interimEnd = lastSunday.toLocaleDateString('ru-RU');
    const interimPeriod = interimKeys[0] + ' — ' + interimEnd;

    await saveJson(join(DATA_DIR, 'rating-promezhutochny.json'), {
      _meta: { sheet: 'Рейтинг промежуточный', updated: now.toISOString() },
      tables: [{
        id: 'rating-interim',
        title: 'Период: ' + interimPeriod + '  |  Сформирован: ' + dateStr + '\n\uD83C\uDFC6 Вклад за прошедшие 2 месяца + текущий месяц до ' + interimEnd,
        headers: [['#', 'Брокер', 'Взято в работу (тег MQL)', 'Прошёл шаг MQL', '% сжигания', 'Статус']],
        rows: interimRows,
      }],
    });
  }

  // 4. Рейтинг брокеров помесячно
  const monthHeaders = ['Метрика / Брокер', ...allKeys];
  const brokerRows = [];
  for (const [managerId, name] of Object.entries(managers)) {
    const takenRow = [name + ' — Взято в работу'];
    const mqlRow = [name + ' — MQL'];
    for (const mk of allKeys) {
      const data = db.months[mk]?.managers?.[managerId] || { taken: 0, mql: 0, takenIds: [], mqlIds: [] };
      takenRow.push(cell(data.taken, data.takenIds));
      mqlRow.push(cell(data.mql, data.mqlIds));
    }
    brokerRows.push(takenRow, mqlRow);
  }

  await saveJson(join(DATA_DIR, 'rating-brokerov.json'), {
    _meta: { sheet: 'Рейтинг брокеров', updated: now.toISOString() },
    tables: [{ id: 'rating-brokers', title: 'Рейтинг брокеров (помесячно)', headers: [monthHeaders], rows: brokerRows }],
  });

  // 5. Причины закрытия
  const closureTable = await syncClosureReasons(managers);
  await saveJson(join(DATA_DIR, 'prichiny-zakrytiya.json'), {
    _meta: { sheet: 'Причины закрытия', updated: now.toISOString() },
    tables: [closureTable],
  });

  console.log('=== Rating Sync завершён ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

#!/usr/bin/env node
/**
 * Rating Sync — рейтинг брокеров, промежуточный рейтинг, причины закрытия
 * Аналог broker_rating_sync.js.js из GAS
 *
 * Запуск: AMO_TOKEN=... node rating-sync.js
 */

import { amoFetch, amoFetchAll, amoFetchTransitions, amoFetchLeadsByIds, amoFetchResponsibleEvents } from './lib/amo-client.js';
import { AMO, STAGES, FIELDS, CIRCLES, EXCLUDE_LEADS } from './lib/config.js';
import { loadManagersFromAmo } from './lib/managers.js';
import { cell, saveJson, nowPhuket, getStartOfDayPhuket, getEndOfDayPhuket, findResponsibleAtTime } from './lib/utils.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../docs/data/sheets');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ==================== ПРИЧИНЫ ЗАКРЫТИЯ (пункт 7) ====================

async function syncClosureReasons(managers) {
  console.log('Причины закрытия: загрузка...');
  const nowTs = Math.floor(Date.now() / 1000);
  const threeMonthsAgo = nowTs - 90 * 86400;

  // 1. Загружаем enum'ы поля 1617988 из AMO
  console.log('  Загрузка структуры поля 1617988...');
  const fieldUrl = `${AMO.API_BASE}/leads/custom_fields/${FIELDS.REJECT_FIELD}`;
  const fieldData = await amoFetch(fieldUrl);
  const enums = {};
  if (fieldData?.enums) {
    for (const e of fieldData.enums) {
      enums[e.id] = e.value;
    }
  }
  console.log(`  Enum'ов причин: ${Object.keys(enums).length}`);

  // 2. Загружаем MQL-лиды за 3 месяца (переходы на MQL этап)
  const mqlTransitions = await amoFetchTransitions(STAGES.MQL, threeMonthsAgo, nowTs);
  const mqlLeadIds = [...new Set(mqlTransitions.map(t => t.leadId))];
  console.log(`  MQL лидов: ${mqlLeadIds.length}`);

  // 3. Загружаем переходы на этап 143 (закрыто нереализовано)
  const lostTransitions = await amoFetchTransitions(STAGES.LOST, threeMonthsAgo, nowTs);
  const lostLeadSet = new Set(lostTransitions.map(t => t.leadId));

  // 4. Из MQL лидов находим закрытые
  const closedMqlLeads = mqlLeadIds.filter(id => lostLeadSet.has(id));
  console.log(`  Закрытых MQL: ${closedMqlLeads.length}`);

  // 5. Загружаем данные лидов (поле 1617988 + responsible)
  const leads = await amoFetchLeadsByIds(closedMqlLeads);
  const reasonCounts = {}; // managerId → { enumId → [leadIds] }

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

  // 6. Формируем таблицу
  const allReasonIds = [...new Set(
    Object.values(reasonCounts).flatMap(m => Object.keys(m).map(Number))
  )].sort((a, b) => a - b);

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
  for (const reasonId of allReasonIds) {
    totalRow.push(cell(reasonTotals[reasonId].v, reasonTotals[reasonId].ids));
  }
  totalRow.push(cell(grandTotal, []));

  console.log(`Причины закрытия: OK, ${grandTotal} закрытий по ${allReasonIds.length} причинам`);
  return { id: 'closure', title: 'Причины закрытия', headers: [headers], rows, totals: totalRow };
}

// ==================== РЕЙТИНГ БРОКЕРОВ ====================

async function syncRatingBrokers(managers) {
  console.log('Рейтинг брокеров: загрузка...');
  const nowTs = Math.floor(Date.now() / 1000);

  // Определяем месяцы (последние 6)
  const phuket = nowPhuket();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(phuket.getUTCFullYear(), phuket.getUTCMonth() - i, 1));
    months.push({
      key: String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear(),
      start: Math.floor(d.getTime() / 1000) - 7 * 3600,
      end: Math.floor(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59)).getTime() / 1000) - 7 * 3600,
    });
  }

  // Загружаем MQL данные по кругам для каждого месяца
  const monthData = {};
  for (const month of months) {
    console.log(`  Рейтинг: ${month.key}...`);
    const takenTransitions = await amoFetchTransitions(STAGES.TAKEN_TO_WORK, month.start, month.end);
    const mqlTransitions = await amoFetchTransitions(STAGES.MQL, month.start, month.end);

    // Группируем по менеджерам
    const byManager = {};
    for (const [managerId] of Object.entries(managers)) {
      byManager[managerId] = { taken: 0, mql: 0, takenIds: [], mqlIds: [] };
    }

    // Загружаем responsible для лидов
    const uniqueIds = [...new Set(takenTransitions.map(t => t.leadId))];
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

    const mqlSet = new Set(mqlTransitions.map(t => t.leadId));
    for (const [mId, data] of Object.entries(byManager)) {
      data.mqlIds = data.takenIds.filter(id => mqlSet.has(id));
      data.mql = data.mqlIds.length;
    }

    monthData[month.key] = byManager;
  }

  // Формируем таблицу: месяцы → строки по метрикам
  const headers = ['Метрика / Брокер', ...months.map(m => m.key)];
  const tables = [];

  for (const [managerId, name] of Object.entries(managers)) {
    const takenRow = [name + ' — Взято в работу'];
    const mqlRow = [name + ' — MQL'];

    for (const month of months) {
      const data = monthData[month.key]?.[managerId] || { taken: 0, mql: 0, takenIds: [], mqlIds: [] };
      takenRow.push(cell(data.taken, data.takenIds));
      mqlRow.push(cell(data.mql, data.mqlIds));
    }

    tables.push(takenRow, mqlRow);
  }

  console.log('Рейтинг брокеров: OK');
  return {
    _meta: { sheet: 'Рейтинг брокеров', updated: new Date().toISOString() },
    tables: [{ id: 'rating-brokers', title: 'Рейтинг брокеров', headers: [headers], rows: tables }],
  };
}

// ==================== ИТОГОВЫЙ РЕЙТИНГ (с баллами и статусами) ====================

async function syncFinalRating(managers, monthData) {
  console.log('Итоговый рейтинг: расчёт...');

  // Берём последние 3 месяца
  const monthKeys = Object.keys(monthData).slice(-3);

  // Собираем суммарные данные по каждому менеджеру
  const managerScores = [];

  for (const [managerId, name] of Object.entries(managers)) {
    let totalTaken = 0, totalMql = 0;
    const allTakenIds = [], allMqlIds = [];

    for (const mk of monthKeys) {
      const data = monthData[mk]?.[managerId] || { taken: 0, mql: 0, takenIds: [], mqlIds: [] };
      totalTaken += data.taken;
      totalMql += data.mql;
      allTakenIds.push(...data.takenIds);
      allMqlIds.push(...data.mqlIds);
    }

    const burnPct = totalTaken > 0 ? Math.round((totalTaken - totalMql) / totalTaken * 100) : 0;

    managerScores.push({
      id: managerId,
      name,
      taken: totalTaken,
      takenIds: allTakenIds,
      mql: totalMql,
      mqlIds: allMqlIds,
      burnPct,
    });
  }

  // Сортируем по MQL (убывание)
  managerScores.sort((a, b) => b.mql - a.mql);

  // Присваиваем места и статусы
  const headers = ['#', 'Брокер', 'Взято в работу (тег MQL)', 'Прошёл шаг MQL', '% сжигания (не берём в рейтинг)', 'Статус'];
  const rows = [];

  for (let i = 0; i < managerScores.length; i++) {
    const m = managerScores[i];
    const place = i + 1;

    let status;
    if (place === 1) status = 'Лидер';
    else if (place <= 3) status = 'ТОП ' + place;
    else if (m.mql > 0) status = 'рентабельный';
    else status = 'убыточный';

    rows.push([
      place,
      m.name,
      cell(m.taken, m.takenIds),
      cell(m.mql, m.mqlIds),
      m.burnPct + '%',
      status,
    ]);
  }

  console.log('Итоговый рейтинг: OK');
  return rows;
}

// ==================== MAIN ====================

async function main() {
  console.log('=== Rating Sync ===');
  if (!AMO.TOKEN) { console.error('AMO_TOKEN не задан!'); process.exit(1); }

  const managers = await loadManagersFromAmo();
  console.log(`Менеджеров: ${Object.keys(managers).length}`);

  // Причины закрытия (пункт 7)
  const closureTable = await syncClosureReasons(managers);
  await saveJson(join(DATA_DIR, 'prichiny-zakrytiya.json'), {
    _meta: { sheet: 'Причины закрытия', updated: new Date().toISOString() },
    tables: [closureTable],
  });

  // Рейтинг брокеров (помесячно)
  const ratingBrokersData = await syncRatingBrokers(managers);
  await saveJson(join(DATA_DIR, 'rating-brokerov.json'), ratingBrokersData);

  // Итоговый рейтинг (последние 3 месяца)
  // Переиспользуем monthData из ratingBrokers
  const phuket = nowPhuket();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(phuket.getUTCFullYear(), phuket.getUTCMonth() - i, 1));
    months.push({
      key: String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear(),
      start: Math.floor(d.getTime() / 1000) - 7 * 3600,
      end: Math.floor(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59)).getTime() / 1000) - 7 * 3600,
    });
  }

  // Собираем monthData заново (для рейтинга нужны последние 3 месяца)
  const monthData = {};
  for (const month of months.slice(-3)) {
    const takenTransitions = await amoFetchTransitions(STAGES.TAKEN_TO_WORK, month.start, month.end);
    const mqlTransitions = await amoFetchTransitions(STAGES.MQL, month.start, month.end);

    const byManager = {};
    for (const mId of Object.keys(managers)) byManager[mId] = { taken: 0, mql: 0, takenIds: [], mqlIds: [] };

    const uniqueIds = [...new Set(takenTransitions.map(t => t.leadId))];
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

    const mqlSet = new Set(mqlTransitions.map(t => t.leadId));
    for (const [mId, data] of Object.entries(byManager)) {
      data.mqlIds = data.takenIds.filter(id => mqlSet.has(id));
      data.mql = data.mqlIds.length;
    }

    monthData[month.key] = byManager;
  }

  const ratingRows = await syncFinalRating(managers, monthData);
  const ratingHeaders = ['#', 'Брокер', 'Взято в работу (тег MQL)', 'Прошёл шаг MQL', '% сжигания', 'Статус'];

  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU', { timeZone: 'Asia/Bangkok' }) + ' ' +
    now.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });

  // Рейтинг — за последние 3 полных месяца
  const m3 = months.slice(-3);
  const ratingPeriod = '01.' + m3[0].key + '-' + new Date(Date.UTC(phuket.getUTCFullYear(), phuket.getUTCMonth(), 0)).getUTCDate() + '.' + m3[2].key;

  await saveJson(join(DATA_DIR, 'rating.json'), {
    _meta: { sheet: 'Рейтинг', updated: now.toISOString() },
    tables: [{
      id: 'rating',
      title: 'Период: ' + ratingPeriod + '  |  Сформирован: ' + dateStr + '\n\uD83C\uDFC6 ВКЛАД ЗА ПРОШЕДШИЕ 3 МЕСЯЦА',
      headers: [ratingHeaders],
      rows: ratingRows,
    }],
  });

  // Промежуточный рейтинг — 2 прошедших + текущий
  const interimEnd = now.toLocaleDateString('ru-RU', { timeZone: 'Asia/Bangkok' });
  const interimPeriod = '01.' + m3[0].key + ' - ' + interimEnd;

  await saveJson(join(DATA_DIR, 'rating-promezhutochny.json'), {
    _meta: { sheet: 'Рейтинг промежуточный', updated: now.toISOString() },
    tables: [{
      id: 'rating-interim',
      title: 'Период: ' + interimPeriod + '  |  Сформирован: ' + dateStr + '\n\uD83C\uDFC6 Вклад за прошедшие 2 месяца + последняя неделя текущего месяца',
      headers: [ratingHeaders],
      rows: ratingRows,
    }],
  });

  console.log('=== Rating Sync завершён ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

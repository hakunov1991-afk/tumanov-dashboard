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

  // Рейтинг брокеров
  const ratingBrokersData = await syncRatingBrokers(managers);
  await saveJson(join(DATA_DIR, 'rating-brokerov.json'), ratingBrokersData);

  console.log('=== Rating Sync завершён ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

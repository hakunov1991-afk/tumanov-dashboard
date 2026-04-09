#!/usr/bin/env node
/**
 * Stats Sync — статистика (аналог tumanov2_v3.js.js)
 * Burn rate, missed calls (Telphin), taken deals по менеджерам
 *
 * Запуск: AMO_TOKEN=... node stats-sync.js
 */

import { amoFetch, amoFetchAll, amoFetchTransitions, amoFetchLeadsByIds } from './lib/amo-client.js';
import { AMO, STAGES, FIELDS } from './lib/config.js';
import { loadManagersFromAmo } from './lib/managers.js';
import { cell, saveJson, nowPhuket } from './lib/utils.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../docs/data/sheets');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Периоды: последние 6 двухнедельных интервалов
function getPeriods() {
  const phuket = nowPhuket();
  const nowTs = Math.floor(Date.now() / 1000);
  const periods = [];

  for (let i = 5; i >= 0; i--) {
    const endDate = new Date(phuket.getTime() - i * 14 * 86400000);
    const startDate = new Date(endDate.getTime() - 14 * 86400000);
    periods.push({
      key: formatPeriod(startDate) + '-' + formatPeriod(endDate),
      start: Math.floor(startDate.getTime() / 1000) - 7 * 3600,
      end: Math.floor(endDate.getTime() / 1000) - 7 * 3600,
    });
  }
  return periods;
}

function formatPeriod(d) {
  return String(d.getUTCDate()).padStart(2, '0') + '.' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear();
}

// ==================== BURN RATE ====================

async function calcBurn(managers, period) {
  // Загружаем MQL переходы
  const mqlTransitions = await amoFetchTransitions(STAGES.MQL, period.start, period.end);
  const mqlLeadIds = [...new Set(mqlTransitions.map(t => t.leadId))];

  // Загружаем переходы на 143 (потеряно) за расширенный период (+ 6 мес)
  const sixMonthsLater = period.end + 180 * 86400;
  const nowTs = Math.floor(Date.now() / 1000);
  const lostEnd = Math.min(sixMonthsLater, nowTs);
  const lostTransitions = await amoFetchTransitions(STAGES.LOST, period.start, lostEnd);
  const lostSet = new Set(lostTransitions.map(t => t.leadId));

  // Загружаем responsible для MQL лидов
  const leads = await amoFetchLeadsByIds(mqlLeadIds);
  const leadResp = {};
  for (const l of leads) leadResp[String(l.id)] = String(l.responsible_user_id);

  const result = { total: { mql: 0, burned: 0, mqlIds: [], burnedIds: [] } };
  for (const mId of Object.keys(managers)) {
    result[mId] = { mql: 0, burned: 0, mqlIds: [], burnedIds: [] };
  }

  for (const lid of mqlLeadIds) {
    const resp = leadResp[lid];
    if (!resp || !result[resp]) continue;

    result[resp].mql++;
    result[resp].mqlIds.push(lid);
    result.total.mql++;
    result.total.mqlIds.push(lid);

    if (lostSet.has(lid)) {
      result[resp].burned++;
      result[resp].burnedIds.push(lid);
      result.total.burned++;
      result.total.burnedIds.push(lid);
    }
  }

  return result;
}

// ==================== TAKEN TO WORK ====================

async function calcTaken(managers, period) {
  const transitions = await amoFetchTransitions(STAGES.TAKEN_TO_WORK, period.start, period.end);

  const leads = await amoFetchLeadsByIds([...new Set(transitions.map(t => t.leadId))]);
  const leadResp = {};
  for (const l of leads) leadResp[String(l.id)] = String(l.responsible_user_id);

  const result = { total: { count: 0, ids: [] } };
  for (const mId of Object.keys(managers)) {
    result[mId] = { count: 0, ids: [] };
  }

  const seen = new Set();
  for (const t of transitions) {
    if (seen.has(t.leadId)) continue;
    seen.add(t.leadId);

    const resp = leadResp[t.leadId] || t.managerId;
    if (result[resp]) {
      result[resp].count++;
      result[resp].ids.push(t.leadId);
    }
    result.total.count++;
    result.total.ids.push(t.leadId);
  }

  return result;
}

// ==================== MAIN ====================

async function main() {
  console.log('=== Stats Sync ===');
  if (!AMO.TOKEN) { console.error('AMO_TOKEN не задан!'); process.exit(1); }

  const managers = await loadManagersFromAmo();
  console.log(`Менеджеров: ${Object.keys(managers).length}`);

  const periods = getPeriods();
  console.log(`Периодов: ${periods.length}`);

  // Считаем данные по периодам
  const tables = [];

  // Таблица 1: Burn Rate (MQL → Потеряно)
  {
    const headers = ['Брокер', ...periods.map(p => p.key)];
    const mqlRows = [];
    const burnRows = [];
    const burnPctRows = [];

    for (const [mId, name] of Object.entries(managers)) {
      const mqlRow = [name + ' — MQL'];
      const burnRow = [name + ' — Сожжено'];
      const pctRow = [name + ' — % сжигания'];

      for (const period of periods) {
        console.log(`  Burn: ${name} ${period.key}`);
        // Кешируем по периоду (не по менеджеру — загружаем все сразу)
      }
      mqlRows.push(mqlRow);
      burnRows.push(burnRow);
      burnPctRows.push(pctRow);
    }

    // Загружаем по периодам (эффективнее)
    for (let pi = 0; pi < periods.length; pi++) {
      const period = periods[pi];
      console.log(`  Период: ${period.key}...`);
      const burn = await calcBurn(managers, period);
      const taken = await calcTaken(managers, period);

      let mi = 0;
      for (const [mId, name] of Object.entries(managers)) {
        const b = burn[mId];
        mqlRows[mi].push(cell(b.mql, b.mqlIds));
        burnRows[mi].push(cell(b.burned, b.burnedIds));
        const pct = b.mql > 0 ? Math.round(b.burned / b.mql * 100) : 0;
        burnPctRows[mi].push(pct + '%');
        mi++;
      }
    }

    // Объединяем в одну таблицу
    const allRows = [];
    for (let i = 0; i < Object.keys(managers).length; i++) {
      allRows.push(mqlRows[i]);
      allRows.push(burnRows[i]);
      allRows.push(burnPctRows[i]);
    }

    tables.push({
      id: 'stats-burn',
      title: 'Статистика: Burn Rate (MQL → Сожжено)',
      headers: [headers],
      rows: allRows,
    });
  }

  // Таблица 2: Взято в работу
  {
    const headers = ['Брокер', ...periods.map(p => p.key)];
    const rows = [];

    for (const [mId, name] of Object.entries(managers)) {
      rows.push([name]); // Заполним позже
    }

    for (let pi = 0; pi < periods.length; pi++) {
      const period = periods[pi];
      const taken = await calcTaken(managers, period);

      let mi = 0;
      for (const mId of Object.keys(managers)) {
        const t = taken[mId];
        rows[mi].push(cell(t.count, t.ids));
        mi++;
      }
    }

    // Итого
    const totalRow = ['ИТОГО'];
    for (let pi = 0; pi < periods.length; pi++) {
      let sum = 0;
      for (let mi = 0; mi < rows.length; mi++) {
        const val = rows[mi][pi + 1];
        sum += (typeof val === 'object' ? val.v : (typeof val === 'number' ? val : 0));
      }
      totalRow.push(sum);
    }

    tables.push({
      id: 'stats-taken',
      title: 'Статистика: Взято в работу',
      headers: [headers],
      rows,
      totals: totalRow,
    });
  }

  await saveJson(join(DATA_DIR, 'statistika.json'), {
    _meta: { sheet: 'Статистика', updated: new Date().toISOString() },
    tables,
  });

  console.log('=== Stats Sync завершён ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

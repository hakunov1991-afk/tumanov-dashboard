#!/usr/bin/env node
/**
 * Cohort Sync — когортный анализ и конверсия по неделям
 * Аналог Conversion sync · JS.js и Conversion sync 2 · JS.js
 *
 * Запуск: AMO_TOKEN=... node cohort-sync.js
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

// Этапы воронки в порядке следования
const COHORT_STAGES = [
  { id: STAGES.TAKEN_TO_WORK, name: 'Взят в работу' },
  { id: STAGES.MQL, name: 'MQL' },
  { id: STAGES.SQL, name: 'SQL' },
  { id: STAGES.MEETING_SCHEDULED, name: 'Встреча назначена' },
  { id: STAGES.MEETING_DONE, name: 'Встреча проведена' },
  { id: STAGES.CONSENT, name: 'Согласие на бронь' },
  { id: STAGES.BOOKING_PAID, name: 'Бронь оплачена' },
  { id: STAGES.DEPOSIT_PAID, name: 'ПВ оплачен' },
];

// ==================== КОГОРТНЫЙ АНАЛИЗ ====================

async function syncCohort(managers) {
  console.log('Когортный анализ: загрузка...');
  const nowTs = Math.floor(Date.now() / 1000);
  const phuket = nowPhuket();

  // Определяем месяцы (последние 6)
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(phuket.getUTCFullYear(), phuket.getUTCMonth() - i, 1));
    months.push({
      key: String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear(),
      start: Math.floor(d.getTime() / 1000) - 7 * 3600,
      end: Math.floor(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59)).getTime() / 1000) - 7 * 3600,
    });
  }

  // Загружаем ВСЕ события переходов за 6 месяцев
  const firstMonth = months[0];
  console.log(`  Когорты: загрузка событий с ${firstMonth.key}...`);
  const allEvents = await amoFetchAll(
    `${AMO.API_BASE}/events?filter[type]=lead_status_changed&filter[created_at][from]=${firstMonth.start}&filter[created_at][to]=${nowTs}`,
    'events', { maxPages: 300, limit: 250, sleepMs: 100 }
  );
  console.log(`  Когорты: ${allEvents.length} событий`);

  // Группируем события по лидам
  const eventsByLead = {};
  for (const ev of allEvents) {
    if (ev.entity_type !== 'lead') continue;
    const lid = String(ev.entity_id);
    if (!eventsByLead[lid]) eventsByLead[lid] = [];
    eventsByLead[lid].push(ev);
  }

  // Для каждого месяца: какие лиды взяты в работу
  const cohortTables = [];

  // Таблица 1: "Созданные → текущий этап" (когорта по месяцу создания)
  {
    const headers = ['Этап', ...months.map(m => m.key)];
    const stageRows = COHORT_STAGES.map(s => {
      const row = [s.name];
      for (const month of months) {
        // Ищем лидов с переходом на "Взято в работу" в этом месяце
        const vzrLeads = new Set();
        for (const ev of allEvents) {
          if (ev.created_at < month.start || ev.created_at > month.end) continue;
          try {
            const afterStatus = ev.value_after?.[0]?.lead_status;
            if (afterStatus && Number(afterStatus.id) === STAGES.TAKEN_TO_WORK) {
              vzrLeads.add(String(ev.entity_id));
            }
          } catch {}
        }

        // Из них: сколько дошли до текущего этапа (на основе их истории событий)
        let count = 0;
        const ids = [];
        for (const lid of vzrLeads) {
          const evts = eventsByLead[lid] || [];
          const reachedStage = evts.some(e => {
            try {
              return Number(e.value_after?.[0]?.lead_status?.id) === s.id;
            } catch { return false; }
          });
          if (reachedStage) { count++; ids.push(lid); }
        }

        row.push(cell(count, ids));
      }
      return row;
    });

    cohortTables.push({
      id: 'cohort-vzr-current',
      title: 'Взяты в работу → прошли этап (текущий результат)',
      headers: [headers],
      rows: stageRows,
    });
  }

  // Таблица 2: "Взяты в работу → конверсия в рамках месяца"
  {
    const headers = ['Этап', ...months.map(m => m.key)];
    const stageRows = COHORT_STAGES.map(s => {
      const row = [s.name];
      for (const month of months) {
        const vzrLeads = new Set();
        for (const ev of allEvents) {
          if (ev.created_at < month.start || ev.created_at > month.end) continue;
          try {
            if (Number(ev.value_after?.[0]?.lead_status?.id) === STAGES.TAKEN_TO_WORK) {
              vzrLeads.add(String(ev.entity_id));
            }
          } catch {}
        }

        // Только переходы внутри этого же месяца
        let count = 0;
        const ids = [];
        for (const lid of vzrLeads) {
          const evts = (eventsByLead[lid] || []).filter(e => e.created_at >= month.start && e.created_at <= month.end);
          const reached = evts.some(e => {
            try { return Number(e.value_after?.[0]?.lead_status?.id) === s.id; } catch { return false; }
          });
          if (reached) { count++; ids.push(lid); }
        }

        row.push(cell(count, ids));
      }
      return row;
    });

    cohortTables.push({
      id: 'cohort-vzr-month',
      title: 'Взяты в работу → конверсия в рамках месяца',
      headers: [headers],
      rows: stageRows,
    });
  }

  console.log('Когортный анализ: OK');
  return cohortTables;
}

// ==================== КОНВЕРСИЯ ПО НЕДЕЛЯМ ====================

async function syncConversion(managers) {
  console.log('Конверсия по неделям: загрузка...');
  const nowTs = Math.floor(Date.now() / 1000);
  const threeMonthsAgo = nowTs - 90 * 86400;

  // Загружаем события
  const allEvents = await amoFetchAll(
    `${AMO.API_BASE}/events?filter[type]=lead_status_changed&filter[created_at][from]=${threeMonthsAgo}&filter[created_at][to]=${nowTs}`,
    'events', { maxPages: 300, limit: 250, sleepMs: 100 }
  );
  console.log(`  Конверсия: ${allEvents.length} событий`);

  // Определяем недели
  const phuket = nowPhuket();
  const weeks = [];
  let weekStart = getMonday(new Date(threeMonthsAgo * 1000));
  while (weekStart.getTime() / 1000 < nowTs) {
    const weekEnd = new Date(weekStart.getTime() + 7 * 86400000 - 1);
    weeks.push({
      key: formatDate(weekStart) + '-' + formatDate(weekEnd),
      start: Math.floor(weekStart.getTime() / 1000),
      end: Math.floor(weekEnd.getTime() / 1000),
    });
    weekStart = new Date(weekStart.getTime() + 7 * 86400000);
  }

  // Для каждой недели считаем переходы по этапам с учётом перепрыгиваний
  const stageIndex = {};
  COHORT_STAGES.forEach((s, i) => { stageIndex[s.id] = i; });

  const headers = ['Этап', ...weeks.map(w => w.key)];
  const stageRows = COHORT_STAGES.map((s, si) => {
    const row = [s.name];
    for (const week of weeks) {
      const leadSet = new Set();
      for (const ev of allEvents) {
        if (ev.created_at < week.start || ev.created_at > week.end) continue;
        try {
          const afterId = Number(ev.value_after?.[0]?.lead_status?.id);
          const beforeId = ev.value_before?.[0]?.lead_status?.id ? Number(ev.value_before[0].lead_status.id) : null;
          const afterIdx = stageIndex[afterId];
          const beforeIdx = beforeId != null ? stageIndex[beforeId] : null;

          if (afterIdx === undefined) continue;

          // Прямой переход или перепрыгивание
          if (afterIdx === si) {
            leadSet.add(String(ev.entity_id));
          } else if (beforeIdx !== null && beforeIdx < si && afterIdx > si) {
            // Перепрыгнул через этот этап
            leadSet.add(String(ev.entity_id));
          }
        } catch {}
      }
      row.push(cell(leadSet.size, [...leadSet]));
    }
    return row;
  });

  console.log('Конверсия по неделям: OK');
  return { id: 'conversion', title: 'Конверсия по неделям (с перепрыгиваниями)', headers: [headers], rows: stageRows };
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(d) {
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
}

// ==================== MAIN ====================

async function main() {
  console.log('=== Cohort & Conversion Sync ===');
  if (!AMO.TOKEN) { console.error('AMO_TOKEN не задан!'); process.exit(1); }

  const managers = await loadManagersFromAmo();
  console.log(`Менеджеров: ${Object.keys(managers).length}`);

  // Когортный анализ
  const cohortTables = await syncCohort(managers);
  await saveJson(join(DATA_DIR, 'kogortny-analiz.json'), {
    _meta: { sheet: 'Когортный анализ', updated: new Date().toISOString() },
    tables: cohortTables,
  });

  // Конверсия по неделям
  const conversionTable = await syncConversion(managers);
  await saveJson(join(DATA_DIR, 'konversiya-2.json'), {
    _meta: { sheet: 'Конверсия по неделям 2', updated: new Date().toISOString() },
    tables: [conversionTable],
  });

  console.log('=== Cohort & Conversion Sync завершён ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

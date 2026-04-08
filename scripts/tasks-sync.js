#!/usr/bin/env node
/**
 * Tasks Sync — перенос tasks_sync.js.js из GAS в Node.js
 * Генерирует JSON для листов "Задачи" и "Задачи брокеров"
 *
 * Запуск: AMO_TOKEN=... node tasks-sync.js
 */

import { amoFetch, amoFetchAll, amoFetchTransitions } from './lib/amo-client.js';
import { AMO, STAGES, FIELDS, PIPELINE_STAGES, BT_STAGES } from './lib/config.js';
import { getManagersFallback } from './lib/managers.js';
import {
  cell, saveJson, nowPhuket, getStartOfDayPhuket, getEndOfDayPhuket,
  yesterdayStartPhuket, monthStartPhuket, secsToHours,
} from './lib/utils.js';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../docs/data/sheets');
const STATE_DIR = join(__dirname, '../docs/data');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Имена этапов для заголовков таблиц
const STAGE_NAMES = {
  [STAGES.TAKEN_TO_WORK]: 'Взят в работу, дозвон 3 дня',
  [STAGES.MQL]: 'MQL: Контакт Установлен, 14 Дней',
  [STAGES.CUSTOM_1]: 'Прогрев ДО Квалификации',
  [STAGES.SQL]: 'Лид квалифицирован (SQL)',
  [STAGES.MEETING_SCHEDULED]: 'Встреча назначена',
  [STAGES.MEETING_DONE]: 'Онлайн/офлайн встреча проведена (КЭВ)',
  [STAGES.AFTER_MEETING]: 'Прогрев после встречи',
  [STAGES.CONSENT]: 'Согласие на бронь получено',
  [STAGES.BOOKING_PAID]: 'Бронь оплачена',
  [STAGES.DEPOSIT_PAID]: 'ПВ Оплачен',
};

// ==================== API ХЕЛПЕРЫ ====================

async function fetchLeadsForManager(managerId) {
  const url = `${AMO.API_BASE}/leads?filter[responsible_user_id]=${managerId}&filter[statuses][0][pipeline_id]=${AMO.PIPE_ID}`;
  return amoFetchAll(url, 'leads', { maxPages: 50 });
}

async function fetchTasksForManager(managerId) {
  const url = `${AMO.API_BASE}/tasks?filter[responsible_user_id]=${managerId}&filter[is_completed]=0&filter[entity_type]=leads`;
  return amoFetchAll(url, 'tasks', { maxPages: 50 });
}

async function loadFreshLeadsForStages(stageIds, days) {
  const nowTs = Math.floor(Date.now() / 1000);
  const fromTs = nowTs - days * 86400;
  const result = {};

  for (const stageId of stageIds) {
    const transitions = await amoFetchTransitions(stageId, fromTs, nowTs);
    for (const t of transitions) {
      result[t.leadId] = true;
    }
  }
  return result;
}

// ==================== T1: ПРОСРОЧЕННЫЕ ЗАДАЧИ ====================

async function syncT1(managers) {
  console.log('T1: Просроченные задачи...');
  const stageIds = PIPELINE_STAGES;
  const headers = ['Брокер', ...stageIds.map(s => STAGE_NAMES[s] || String(s)), 'ИТОГО', 'Δ', 'Δ2', 'Δ3'];
  const rows = [];
  const stageTotals = {};
  stageIds.forEach(s => { stageTotals[s] = { v: 0, ids: [] }; });
  let grandTotal = 0;

  // Загрузить историю для динамики
  const history = await loadOverdueHistory();
  const yesterday = getHistoryForDaysAgo(history, 1);
  const twoDaysAgo = getHistoryForDaysAgo(history, 2);
  const threeDaysAgo = getHistoryForDaysAgo(history, 3);
  const todayData = {};

  // T10 data (просрочки по дням)
  const t10Data = {};

  for (const [managerId, name] of Object.entries(managers)) {
    console.log(`  T1: ${name} (${managerId})`);
    const stats = await getTasksStatsForManager(managerId, stageIds);

    const rowCells = [name];
    let rowTotal = 0;
    const rowAllIds = [];

    for (const stageId of stageIds) {
      const data = stats[stageId] || { overdue: 0, overdueLeadIds: [] };
      rowCells.push(cell(data.overdue, data.overdueLeadIds));
      rowTotal += data.overdue;
      rowAllIds.push(...data.overdueLeadIds);
      stageTotals[stageId].v += data.overdue;
      stageTotals[stageId].ids.push(...data.overdueLeadIds);
    }

    // ИТОГО + динамика
    rowCells.push(cell(rowTotal, rowAllIds));
    todayData[managerId] = rowTotal;

    const d1 = yesterday[managerId] != null ? rowTotal - yesterday[managerId] : null;
    const d2 = yesterday[managerId] != null && twoDaysAgo[managerId] != null ? yesterday[managerId] - twoDaysAgo[managerId] : null;
    const d3 = twoDaysAgo[managerId] != null && threeDaysAgo[managerId] != null ? twoDaysAgo[managerId] - threeDaysAgo[managerId] : null;
    rowCells.push(formatDelta(d1), formatDelta(d2), formatDelta(d3));

    rows.push(rowCells);

    // T10 — общие просрочки менеджера за день
    t10Data[managerId] = { total: stats._totalOverdue, ids: stats._totalOverdueLeadIds };

    await sleep(100);
  }

  grandTotal = Object.values(stageTotals).reduce((s, st) => s + st.v, 0);

  // Строка ИТОГО
  const totalRow = ['ИТОГО'];
  for (const stageId of stageIds) {
    totalRow.push(cell(stageTotals[stageId].v, stageTotals[stageId].ids));
  }
  totalRow.push(cell(grandTotal, []));

  const yGrand = sumValues(yesterday);
  const tdGrand = sumValues(twoDaysAgo);
  const thGrand = sumValues(threeDaysAgo);
  totalRow.push(
    formatDelta(yGrand != null ? grandTotal - yGrand : null),
    formatDelta(yGrand != null && tdGrand != null ? yGrand - tdGrand : null),
    formatDelta(tdGrand != null && thGrand != null ? tdGrand - thGrand : null),
  );

  await saveOverdueHistory(history, todayData);

  console.log(`T1: OK, ${rows.length} менеджеров, ${grandTotal} просрочек`);

  return {
    table: { id: 't1', title: 'T1: Просроченные задачи', headers: [headers], rows, totals: totalRow },
    t10Data,
  };
}

// ==================== T2: ЗАГРУЗКА БРОКЕРА ====================

async function syncT2(managers) {
  console.log('T2: Загрузка брокера...');
  const stageIds = PIPELINE_STAGES;
  const headers = ['Брокер', ...stageIds.map(s => STAGE_NAMES[s] || String(s)), 'ИТОГО'];
  const rows = [];
  const stageTotals = {};
  stageIds.forEach(s => { stageTotals[s] = { v: 0, ids: [] }; });

  for (const [managerId, name] of Object.entries(managers)) {
    console.log(`  T2: ${name}`);
    const leads = await fetchLeadsForManager(managerId);

    const byStage = {};
    stageIds.forEach(s => { byStage[s] = []; });

    for (const lead of leads) {
      if (byStage[lead.status_id]) {
        byStage[lead.status_id].push(String(lead.id));
      }
    }

    const rowCells = [name];
    let rowTotal = 0;
    const rowAllIds = [];

    for (const stageId of stageIds) {
      const ids = byStage[stageId];
      rowCells.push(cell(ids.length, ids));
      rowTotal += ids.length;
      rowAllIds.push(...ids);
      stageTotals[stageId].v += ids.length;
      stageTotals[stageId].ids.push(...ids);
    }

    rowCells.push(cell(rowTotal, rowAllIds));
    rows.push(rowCells);
  }

  const grandTotal = Object.values(stageTotals).reduce((s, st) => s + st.v, 0);
  const totalRow = ['ИТОГО'];
  for (const stageId of stageIds) {
    totalRow.push(cell(stageTotals[stageId].v, stageTotals[stageId].ids));
  }
  totalRow.push(cell(grandTotal, []));

  console.log(`T2: OK, ${grandTotal} лидов`);
  return { id: 't2', title: 'T2: Активные карточки сделок (загрузка брокера)', headers: [headers], rows, totals: totalRow };
}

// ==================== T3: ПРОСРОЧКА >30 ДНЕЙ ====================

async function syncT3(managers) {
  console.log('T3: Просрочка >30 дней...');
  const stageIds = PIPELINE_STAGES;
  const headers = ['Брокер', ...stageIds.map(s => STAGE_NAMES[s] || String(s)), 'ИТОГО'];

  // Загружаем "свежие" лиды (вошли на этап за 30 дней)
  const freshLeads = await loadFreshLeadsForStages(stageIds, 30);
  console.log(`  T3: Свежих лидов: ${Object.keys(freshLeads).length}`);

  const rows = [];
  const stageTotals = {};
  stageIds.forEach(s => { stageTotals[s] = { v: 0, ids: [] }; });

  for (const [managerId, name] of Object.entries(managers)) {
    console.log(`  T3: ${name}`);
    const leads = await fetchLeadsForManager(managerId);

    const byStage = {};
    stageIds.forEach(s => { byStage[s] = []; });

    for (const lead of leads) {
      const lid = String(lead.id);
      if (byStage[lead.status_id] && !freshLeads[lid]) {
        byStage[lead.status_id].push(lid);
      }
    }

    const rowCells = [name];
    let rowTotal = 0;

    for (const stageId of stageIds) {
      const ids = byStage[stageId];
      rowCells.push(cell(ids.length, ids));
      rowTotal += ids.length;
      stageTotals[stageId].v += ids.length;
      stageTotals[stageId].ids.push(...ids);
    }

    rowCells.push(cell(rowTotal, []));
    rows.push(rowCells);
  }

  const grandTotal = Object.values(stageTotals).reduce((s, st) => s + st.v, 0);
  const totalRow = ['ИТОГО'];
  for (const stageId of stageIds) {
    totalRow.push(cell(stageTotals[stageId].v, stageTotals[stageId].ids));
  }
  totalRow.push(cell(grandTotal, []));

  console.log(`T3: OK, ${grandTotal} просрочек`);
  return { id: 't3', title: 'T3: Просрочки >30 дней', headers: [headers], rows, totals: totalRow };
}

// ==================== T4: СДЕЛКИ ЗА ВЧЕРА ====================

async function syncT4(managers) {
  console.log('T4: Сделки за вчера...');
  const yesterdayStart = yesterdayStartPhuket();
  const yesterdayEnd = yesterdayStart + 86400;
  return syncDealsForPeriod('t4', 'T4: Взято вчера', managers, yesterdayStart, yesterdayEnd);
}

// ==================== T5: СДЕЛКИ С НАЧАЛА МЕСЯЦА ====================

async function syncT5(managers) {
  console.log('T5: Сделки с начала месяца...');
  const monthStart = monthStartPhuket();
  const nowTs = Math.floor(Date.now() / 1000);
  return syncDealsForPeriod('t5', 'T5: Взято за месяц', managers, monthStart, nowTs);
}

// Общая функция для T4/T5
async function syncDealsForPeriod(tableId, title, managers, fromTs, toTs) {
  const stageIds = PIPELINE_STAGES;
  const headers = ['Брокер', ...stageIds.map(s => STAGE_NAMES[s] || String(s)), 'ИТОГО'];

  // Загружаем переходы на "Взято в работу"
  const transitions = await amoFetchTransitions(STAGES.TAKEN_TO_WORK, fromTs, toTs);
  console.log(`  ${tableId}: ${transitions.length} переходов`);

  // Загружаем текущие данные лидов для определения этапа и ответственного
  const uniqueLeadIds = [...new Set(transitions.map(t => t.leadId))];
  const leadInfoMap = {};

  if (uniqueLeadIds.length > 0) {
    const leads = await amoFetchAll(
      `${AMO.API_BASE}/leads?${uniqueLeadIds.slice(0, 100).map((id, i) => `filter[id][${i}]=${id}`).join('&')}`,
      'leads', { maxPages: 1 }
    );
    // Для больших объёмов — батчами
    const { amoFetchLeadsByIds } = await import('./lib/amo-client.js');
    const allLeads = await amoFetchLeadsByIds(uniqueLeadIds);
    for (const lead of allLeads) {
      leadInfoMap[String(lead.id)] = {
        statusId: lead.status_id,
        responsibleUserId: String(lead.responsible_user_id),
      };
    }
  }

  // Группируем по менеджерам
  const managerIds = new Set(Object.keys(managers));
  const byManager = {};

  for (const t of transitions) {
    const info = leadInfoMap[t.leadId];
    const resp = info?.responsibleUserId || t.managerId;
    if (!managerIds.has(resp)) continue;

    if (!byManager[resp]) byManager[resp] = {};
    const stageId = info?.statusId || STAGES.TAKEN_TO_WORK;
    const targetStage = stageIds.includes(stageId) ? stageId : STAGES.TAKEN_TO_WORK;

    if (!byManager[resp][targetStage]) byManager[resp][targetStage] = [];
    if (!byManager[resp][targetStage].includes(t.leadId)) {
      byManager[resp][targetStage].push(t.leadId);
    }
  }

  const rows = [];
  const stageTotals = {};
  stageIds.forEach(s => { stageTotals[s] = { v: 0, ids: [] }; });

  for (const [managerId, name] of Object.entries(managers)) {
    const mData = byManager[managerId] || {};
    const rowCells = [name];
    let rowTotal = 0;

    for (const stageId of stageIds) {
      const ids = mData[stageId] || [];
      rowCells.push(cell(ids.length, ids));
      rowTotal += ids.length;
      stageTotals[stageId].v += ids.length;
      stageTotals[stageId].ids.push(...ids);
    }

    rowCells.push(cell(rowTotal, []));
    rows.push(rowCells);
  }

  const grandTotal = Object.values(stageTotals).reduce((s, st) => s + st.v, 0);
  const totalRow = ['ИТОГО'];
  for (const stageId of stageIds) {
    totalRow.push(cell(stageTotals[stageId].v, stageTotals[stageId].ids));
  }
  totalRow.push(cell(grandTotal, []));

  console.log(`${tableId}: OK, ${grandTotal} сделок`);
  return { id: tableId, title, headers: [headers], rows, totals: totalRow };
}

// ==================== ХЕЛПЕРЫ ====================

async function getTasksStatsForManager(managerId, stageIds) {
  const leads = await fetchLeadsForManager(managerId);
  const leadToStage = {};
  for (const lead of leads) {
    if (stageIds.includes(lead.status_id)) {
      leadToStage[lead.id] = lead.status_id;
    }
  }

  const tasks = await fetchTasksForManager(managerId);
  const now = Math.floor(Date.now() / 1000);
  const stats = {};
  stageIds.forEach(s => { stats[s] = { overdue: 0, overdueLeadIds: [] }; });

  let totalOverdue = 0;
  const totalOverdueLeadIds = [];

  for (const task of tasks) {
    if (task.entity_type !== 'leads') continue;
    const leadId = task.entity_id;

    if (!task.is_completed && task.complete_till && task.complete_till < now) {
      totalOverdue++;
      if (!totalOverdueLeadIds.includes(leadId)) totalOverdueLeadIds.push(leadId);
    }

    const stageId = leadToStage[leadId];
    if (!stageId) continue;

    if (!task.is_completed && task.complete_till < now) {
      stats[stageId].overdue++;
      if (!stats[stageId].overdueLeadIds.includes(leadId)) {
        stats[stageId].overdueLeadIds.push(String(leadId));
      }
    }
  }

  stats._totalOverdue = totalOverdue;
  stats._totalOverdueLeadIds = totalOverdueLeadIds.map(String);
  return stats;
}

function formatDelta(d) {
  if (d == null) return '';
  if (d > 0) return `+${d}`;
  if (d < 0) return String(d);
  return '0';
}

function sumValues(obj) {
  if (!obj || Object.keys(obj).length === 0) return null;
  return Object.values(obj).reduce((s, v) => s + (v || 0), 0);
}

// ==================== ИСТОРИЯ ДИНАМИКИ (Δ) ====================

const HISTORY_PATH = join(STATE_DIR, 'overdue-history.json');

async function loadOverdueHistory() {
  try {
    const raw = await readFile(HISTORY_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { days: [] };
  }
}

function getHistoryForDaysAgo(history, daysAgo) {
  if (!history.days || history.days.length < daysAgo) return {};
  return history.days[history.days.length - daysAgo]?.data || {};
}

async function saveOverdueHistory(history, todayData) {
  const today = new Date().toISOString().substring(0, 10);
  if (!history.days) history.days = [];

  // Обновить или добавить сегодня
  const existing = history.days.findIndex(d => d.date === today);
  if (existing >= 0) {
    history.days[existing].data = todayData;
  } else {
    history.days.push({ date: today, data: todayData });
  }

  // Хранить максимум 7 дней
  if (history.days.length > 7) history.days = history.days.slice(-7);

  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
}

// ==================== T7: СКОРОСТЬ ПЕРЕХОДА ====================

async function syncT7(managers) {
  console.log('T7: Скорость перехода по этапам...');
  const stageIds = PIPELINE_STAGES;
  const headers = ['Брокер', ...stageIds.map(s => STAGE_NAMES[s] || String(s)), 'ИТОГО'];

  const nowTs = Math.floor(Date.now() / 1000);
  const fromTs = nowTs - 30 * 86400;

  // Загружаем ВСЕ события переходов за 30 дней (быстрый режим)
  console.log('  T7: Загружаю все события переходов...');
  const allEvents = await amoFetchAll(
    `${AMO.API_BASE}/events?filter[type]=lead_status_changed&filter[created_at][from]=${fromTs}&filter[created_at][to]=${nowTs}`,
    'events', { maxPages: 200, limit: 250, sleepMs: 100 }
  );
  console.log(`  T7: Загружено ${allEvents.length} событий`);

  // Группируем по лидам и находим лидов с переходом на "Взято в работу"
  const eventsByLead = {};
  const entryLeadIds = {};

  for (const ev of allEvents) {
    if (ev.entity_type !== 'lead') continue;
    const lid = String(ev.entity_id);
    if (!eventsByLead[lid]) eventsByLead[lid] = [];
    eventsByLead[lid].push(ev);

    try {
      const afterStatus = ev.value_after?.[0]?.lead_status;
      if (afterStatus && Number(afterStatus.pipeline_id) === AMO.PIPE_ID && Number(afterStatus.id) === STAGES.TAKEN_TO_WORK) {
        entryLeadIds[lid] = true;
      }
    } catch {}
  }

  const leadIds = Object.keys(entryLeadIds);
  console.log(`  T7: Лидов с "Взято в работу": ${leadIds.length}`);

  // Загружаем responsible для лидов
  const { amoFetchLeadsByIds } = await import('./lib/amo-client.js');
  const leadsData = await amoFetchLeadsByIds(leadIds);
  const leadInfo = {};
  for (const lead of leadsData) {
    leadInfo[String(lead.id)] = { responsible: String(lead.responsible_user_id), status_id: lead.status_id };
  }

  // Считаем часы на каждом этапе
  const data = {};
  const managerSet = new Set(Object.keys(managers));

  for (const leadId of leadIds) {
    const info = leadInfo[leadId];
    if (!info || !managerSet.has(info.responsible)) continue;

    const evts = (eventsByLead[leadId] || []).sort((a, b) => a.created_at - b.created_at);
    const transitions = [];

    for (const ev of evts) {
      try {
        const as = ev.value_after?.[0]?.lead_status;
        if (!as || Number(as.pipeline_id) !== AMO.PIPE_ID) continue;
        transitions.push({ stageId: Number(as.id), ts: ev.created_at });
      } catch {}
    }

    for (let i = 0; i < transitions.length; i++) {
      const stageId = transitions[i].stageId;
      const enterTs = transitions[i].ts;
      let leaveTs;

      if (i + 1 < transitions.length) {
        leaveTs = transitions[i + 1].ts;
      } else if (info.status_id === stageId) {
        leaveTs = nowTs;
      } else {
        continue;
      }

      const hours = (leaveTs - enterTs) / 3600;
      if (hours < 0) continue;

      if (!data[info.responsible]) data[info.responsible] = {};
      if (!data[info.responsible][stageId]) data[info.responsible][stageId] = [];
      data[info.responsible][stageId].push(hours);
    }
  }

  // Формируем таблицу
  const rows = [];
  for (const [managerId, name] of Object.entries(managers)) {
    const rowCells = [name];
    let brokerSum = 0, brokerCount = 0;

    for (const stageId of stageIds) {
      const arr = data[managerId]?.[stageId] || [];
      if (arr.length > 0) {
        const avg = Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
        rowCells.push({ v: avg, note: `Сделок: ${arr.length}, Мин: ${Math.round(Math.min(...arr))}ч, Макс: ${Math.round(Math.max(...arr))}ч` });
        brokerSum += avg;
        brokerCount++;
      } else {
        rowCells.push('');
      }
    }
    rowCells.push(brokerCount > 0 ? Math.round(brokerSum / brokerCount) : '');
    rows.push(rowCells);
  }

  // ИТОГО
  const totalRow = ['ИТОГО'];
  let grandSum = 0, grandCount = 0;
  for (const stageId of stageIds) {
    let stageSum = 0, stageN = 0;
    for (const managerId of Object.keys(managers)) {
      const arr = data[managerId]?.[stageId] || [];
      if (arr.length > 0) {
        stageSum += arr.reduce((s, v) => s + v, 0) / arr.length;
        stageN++;
      }
    }
    if (stageN > 0) {
      const avg = Math.round(stageSum / stageN);
      totalRow.push(avg);
      grandSum += avg;
      grandCount++;
    } else {
      totalRow.push('');
    }
  }
  totalRow.push(grandCount > 0 ? Math.round(grandSum / grandCount) : '');

  console.log(`T7: OK`);
  return { id: 't7', title: 'T7: Средняя скорость перехода (часы)', headers: [headers], rows, totals: totalRow };
}

// ==================== T11: ПРЕВЫШЕНИЕ ЛИМИТОВ ====================

async function syncT11(managers) {
  console.log('T11: Превышение лимитов удержания...');

  // Лимиты по этапам (ID → дней)
  const stageLimits = {
    [STAGES.TAKEN_TO_WORK]: 3,
    [STAGES.MQL]: 14,
    [STAGES.CUSTOM_1]: 5,
    [STAGES.SQL]: 5,
    [STAGES.MEETING_SCHEDULED]: 5,
    [STAGES.MEETING_DONE]: 5,
    [STAGES.AFTER_MEETING]: 5,
    [STAGES.CONSENT]: 5,
    [STAGES.BOOKING_PAID]: 5,
  };

  const stageIds = Object.keys(stageLimits).map(Number);
  const headers = ['Брокер', ...stageIds.map(s => `${STAGE_NAMES[s] || s} (${stageLimits[s]} дн.)`), 'ИТОГО'];

  // Для каждого этапа загружаем "свежие" лиды (в рамках лимита)
  const freshByStage = {};
  for (const [sid, days] of Object.entries(stageLimits)) {
    freshByStage[sid] = await loadFreshLeadsForStages([Number(sid)], days);
  }

  const rows = [];
  const stageTotals = {};
  stageIds.forEach(s => { stageTotals[s] = { v: 0, ids: [] }; });

  for (const [managerId, name] of Object.entries(managers)) {
    console.log(`  T11: ${name}`);
    const leads = await fetchLeadsForManager(managerId);

    const rowCells = [name];
    let rowTotal = 0;

    for (const stageId of stageIds) {
      const fresh = freshByStage[stageId];
      const exceeded = [];
      for (const lead of leads) {
        if (lead.status_id === stageId && !fresh[String(lead.id)]) {
          exceeded.push(String(lead.id));
        }
      }
      rowCells.push(cell(exceeded.length, exceeded));
      rowTotal += exceeded.length;
      stageTotals[stageId].v += exceeded.length;
      stageTotals[stageId].ids.push(...exceeded);
    }
    rowCells.push(cell(rowTotal, []));
    rows.push(rowCells);
  }

  const grandTotal = Object.values(stageTotals).reduce((s, st) => s + st.v, 0);
  const totalRow = ['ИТОГО'];
  for (const stageId of stageIds) {
    totalRow.push(cell(stageTotals[stageId].v, stageTotals[stageId].ids));
  }
  totalRow.push(cell(grandTotal, []));

  console.log(`T11: OK, ${grandTotal} превышений`);
  return { id: 't11', title: 'T11: Превышение лимитов удержания', headers: [headers], rows, totals: totalRow };
}

// ==================== КРУГИ ====================

async function syncCircles() {
  console.log('Круги: Взято в работу по кругам...');
  const nowTs = Math.floor(Date.now() / 1000);
  const yesterdayStart = yesterdayStartPhuket();
  const from7d = nowTs - 7 * 86400;
  const from30d = nowTs - 30 * 86400;

  // Загружаем переходы на "Взято в работу"
  const transitions = await amoFetchTransitions(STAGES.TAKEN_TO_WORK, from30d, nowTs);
  console.log(`  Круги: ${transitions.length} переходов за 30 дней`);

  // Загружаем историю полей кругов
  const yearAgo = nowTs - 365 * 86400;
  const k2Events = await loadFieldHistory(FIELDS.CIRCLE_K2, yearAgo, nowTs);
  const k3Events = await loadFieldHistory(FIELDS.CIRCLE_K3, yearAgo, nowTs);
  const k4Events = await loadFieldHistory(FIELDS.CIRCLE_K4, yearAgo, nowTs);

  function classifyCircle(leadId, beforeTs) {
    if (wasFieldSetBefore(k4Events, leadId, beforeTs)) return 4;
    if (wasFieldSetBefore(k3Events, leadId, beforeTs)) return 3;
    if (wasFieldSetBefore(k2Events, leadId, beforeTs)) return 2;
    return 1;
  }

  const periods = [
    { name: 'Взято в работу за вчера', from: yesterdayStart, to: yesterdayStart + 86400 },
    { name: 'Взято в работу за 7 дней', from: from7d, to: nowTs },
    { name: 'Взято в работу за 30 дней', from: from30d, to: nowTs },
  ];

  const headers = ['Круг', ...periods.map(p => p.name)];
  const circleRows = { 1: ['1'], 2: ['2'], 3: ['3'], 4: ['4'] };

  for (const period of periods) {
    const counts = { 1: [], 2: [], 3: [], 4: [] };
    for (const t of transitions) {
      if (t.ts >= period.from && t.ts < period.to) {
        const c = classifyCircle(t.leadId, t.ts);
        if (!counts[c].includes(t.leadId)) counts[c].push(t.leadId);
      }
    }
    for (let c = 1; c <= 4; c++) {
      circleRows[c].push(cell(counts[c].length, counts[c]));
    }
  }

  const rows = [circleRows[1], circleRows[2], circleRows[3], circleRows[4]];
  console.log('Круги: OK');
  return { id: 'circles', title: 'Круги (Взято в работу)', headers: [headers], rows };
}

// ==================== РАСПИСАНИЕ ЗАДАЧ ====================

async function syncTaskSchedule(managers) {
  console.log('Расписание задач...');
  const headers = ['Брокер', 'Сегодня', 'Завтра', 'Эта неделя', 'След. неделя', 'Будущее'];

  const phuket = nowPhuket();
  const todayEnd = getEndOfDayPhuket(Math.floor(Date.now() / 1000));
  const tomorrowEnd = todayEnd + 86400;

  // Конец текущей недели (воскресенье)
  const dayOfWeek = phuket.getUTCDay();
  const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const thisWeekEnd = todayEnd + daysToSunday * 86400;
  const nextWeekEnd = thisWeekEnd + 7 * 86400;

  const rows = [];
  for (const [managerId, name] of Object.entries(managers)) {
    const tasks = await fetchTasksForManager(managerId);
    const buckets = { today: [], tomorrow: [], thisWeek: [], nextWeek: [], future: [] };

    for (const task of tasks) {
      if (task.is_completed || !task.complete_till) continue;
      const ct = task.complete_till;
      const lid = String(task.entity_id || '');

      if (ct <= todayEnd) { if (!buckets.today.includes(lid)) buckets.today.push(lid); }
      else if (ct <= tomorrowEnd) { if (!buckets.tomorrow.includes(lid)) buckets.tomorrow.push(lid); }
      else if (ct <= thisWeekEnd) { if (!buckets.thisWeek.includes(lid)) buckets.thisWeek.push(lid); }
      else if (ct <= nextWeekEnd) { if (!buckets.nextWeek.includes(lid)) buckets.nextWeek.push(lid); }
      else { if (!buckets.future.includes(lid)) buckets.future.push(lid); }
    }

    rows.push([
      name,
      cell(buckets.today.length, buckets.today),
      cell(buckets.tomorrow.length, buckets.tomorrow),
      cell(buckets.thisWeek.length, buckets.thisWeek),
      cell(buckets.nextWeek.length, buckets.nextWeek),
      cell(buckets.future.length, buckets.future),
    ]);
  }

  console.log('Расписание задач: OK');
  return { id: 'schedule', title: 'Расписание задач', headers: [headers], rows };
}

// ==================== BT: КОНТРОЛЬ ПОСТАНОВКИ ЗАДАЧ БОТОМ ====================

async function syncBT(managers) {
  console.log('BT: Контроль постановки задач ботом...');
  const phuket = nowPhuket();
  const year = phuket.getUTCFullYear();
  const month = phuket.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const monthStartDate = new Date(Date.UTC(year, month, 1));
  const monthEndDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));
  const fromTs = Math.floor(monthStartDate.getTime() / 1000) - 7 * 3600;
  const toTs = Math.floor(monthEndDate.getTime() / 1000) - 7 * 3600;

  const stageSet = new Set(BT_STAGES);
  const dayHeaders = [];
  for (let d = 1; d <= daysInMonth; d++) dayHeaders.push(String(d));
  const headers = ['Брокер', ...dayHeaders, 'ИТОГО'];

  // Загружаем задачи и лиды
  const allLeadIds = new Set();
  const countsByManager = {};

  for (const [managerId, name] of Object.entries(managers)) {
    console.log(`  BT: ${name}`);
    const url = `${AMO.API_BASE}/tasks?filter[responsible_user_id]=${managerId}&filter[updated_at][from]=${fromTs}&filter[updated_at][to]=${toTs}&filter[entity_type]=leads`;
    const tasks = await amoFetchAll(url, 'tasks', { maxPages: 50 });

    const robotTasks = tasks.filter(t =>
      String(t.created_by) !== managerId && t.created_at >= fromTs && t.created_at <= toTs
    );

    countsByManager[managerId] = {};
    for (const t of robotTasks) {
      if (t.entity_id) allLeadIds.add(String(t.entity_id));
      const pDate = new Date((t.created_at + 7 * 3600) * 1000);
      if (pDate.getUTCMonth() !== month) continue;
      const day = pDate.getUTCDate();
      if (!countsByManager[managerId][day]) countsByManager[managerId][day] = [];
      countsByManager[managerId][day].push(String(t.entity_id || ''));
    }
  }

  // Загружаем этапы лидов для фильтрации
  const leadStages = {};
  const leadIdArr = [...allLeadIds];
  if (leadIdArr.length > 0) {
    const { amoFetchLeadsByIds } = await import('./lib/amo-client.js');
    const leads = await amoFetchLeadsByIds(leadIdArr);
    for (const lead of leads) leadStages[String(lead.id)] = lead.status_id;
  }

  const rows = [];
  const dayTotals = new Array(daysInMonth).fill(0);
  let grandTotal = 0;

  for (const [managerId, name] of Object.entries(managers)) {
    const rowCells = [name];
    let rowTotal = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const dayLeads = countsByManager[managerId]?.[d] || [];
      const valid = dayLeads.filter(lid => lid && stageSet.has(leadStages[lid]));
      rowCells.push(cell(valid.length, valid));
      rowTotal += valid.length;
      dayTotals[d - 1] += valid.length;
    }
    rowCells.push(cell(rowTotal, []));
    grandTotal += rowTotal;
    rows.push(rowCells);
  }

  const totalRow = ['ИТОГО', ...dayTotals.map(v => v), grandTotal];
  console.log(`BT: OK, ${grandTotal} задач`);
  return { id: 'bt', title: 'Контроль постановки задач ботом', headers: [headers], rows, totals: totalRow };
}

// ==================== T8: СКОРОСТЬ ВЗЯТИЯ В РАБОТУ ====================

async function syncT8(managers) {
  console.log('T8: Скорость взятия в работу...');
  const phuket = nowPhuket();
  const month = phuket.getUTCMonth();
  const year = phuket.getUTCFullYear();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const fromTs = Math.floor(new Date(Date.UTC(year, month, 1)).getTime() / 1000) - 7 * 3600;
  const nowTs = Math.floor(Date.now() / 1000);

  // Загружаем переходы на "Свободный лид" и "Взято в работу"
  const fromTransitions = await amoFetchTransitions(STAGES.FREE_LEAD, fromTs, nowTs);
  const toTransitions = await amoFetchTransitions(STAGES.TAKEN_TO_WORK, fromTs, nowTs);

  // Карта: leadId → последний переход на FREE_LEAD
  const fromMap = {};
  for (const t of fromTransitions) {
    if (!fromMap[t.leadId] || t.ts > fromMap[t.leadId].ts) fromMap[t.leadId] = t;
  }

  // Загружаем историю кругов для фильтрации
  const yearAgo = nowTs - 365 * 86400;
  const k2Events = await loadFieldHistory(FIELDS.CIRCLE_K2, yearAgo, nowTs);
  const k3Events = await loadFieldHistory(FIELDS.CIRCLE_K3, yearAgo, nowTs);
  const k4Events = await loadFieldHistory(FIELDS.CIRCLE_K4, yearAgo, nowTs);

  // Загружаем responsible для лидов
  const uniqueIds = [...new Set(toTransitions.map(t => t.leadId))];
  const { amoFetchLeadsByIds } = await import('./lib/amo-client.js');
  const leadsData = await amoFetchLeadsByIds(uniqueIds);
  const leadResp = {};
  for (const l of leadsData) leadResp[String(l.id)] = String(l.responsible_user_id);

  const managerSet = new Set(Object.keys(managers));
  const dayHeaders = [];
  for (let d = 1; d <= daysInMonth; d++) dayHeaders.push(String(d));
  const headers = ['Брокер', ...dayHeaders, 'ИТОГО'];

  const brokerDayData = {};

  for (const t of toTransitions) {
    // Пропускаем если есть круг
    if (wasFieldSetBefore(k2Events, t.leadId, t.ts) ||
        wasFieldSetBefore(k3Events, t.leadId, t.ts) ||
        wasFieldSetBefore(k4Events, t.leadId, t.ts)) continue;

    const resp = leadResp[t.leadId] || t.managerId;
    if (!managerSet.has(resp)) continue;

    const fromT = fromMap[t.leadId];
    if (!fromT || fromT.ts >= t.ts) continue;

    const seconds = t.ts - fromT.ts;
    const pDate = new Date((t.ts + 7 * 3600) * 1000);
    if (pDate.getUTCMonth() !== month) continue;
    const day = pDate.getUTCDate();

    if (!brokerDayData[resp]) brokerDayData[resp] = {};
    if (!brokerDayData[resp][day]) brokerDayData[resp][day] = [];
    brokerDayData[resp][day].push({ seconds, leadId: t.leadId });
  }

  const rows = [];
  for (const [managerId, name] of Object.entries(managers)) {
    const rowCells = [name];
    const allSecs = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const items = brokerDayData[managerId]?.[d] || [];
      if (items.length > 0) {
        const avg = Math.round(items.reduce((s, i) => s + i.seconds, 0) / items.length);
        const ids = items.map(i => i.leadId);
        rowCells.push(cell(avg, ids));
        allSecs.push(...items.map(i => i.seconds));
      } else {
        rowCells.push('');
      }
    }

    const totalAvg = allSecs.length > 0 ? Math.round(allSecs.reduce((s, v) => s + v, 0) / allSecs.length) : '';
    rowCells.push(totalAvg);
    rows.push(rowCells);
  }

  console.log('T8: OK');
  return { id: 't8', title: 'T8: Скорость взятия в работу (секунды)', headers: [headers], rows };
}

// ==================== T9: СНЯТЫЕ СДЕЛКИ ====================

async function syncT9(managers) {
  console.log('T9: Снятые сделки...');
  const phuket = nowPhuket();
  const month = phuket.getUTCMonth();
  const year = phuket.getUTCFullYear();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const fromTs = Math.floor(new Date(Date.UTC(year, month, 1)).getTime() / 1000) - 7 * 3600;
  const nowTs = Math.floor(Date.now() / 1000);

  const T9_STAGES = new Set([STAGES.TAKEN_TO_WORK, STAGES.MQL]);

  // Загружаем события смены ответственного
  const respEvents = await amoFetchAll(
    `${AMO.API_BASE}/events?filter[type]=entity_responsible_changed&filter[created_at][from]=${fromTs}&filter[created_at][to]=${nowTs}`,
    'events', { maxPages: 100, limit: 250 }
  );

  // Загружаем события переходов для определения этапа
  const statusEvents = await amoFetchAll(
    `${AMO.API_BASE}/events?filter[type]=lead_status_changed&filter[created_at][from]=${fromTs}&filter[created_at][to]=${nowTs}`,
    'events', { maxPages: 100, limit: 250 }
  );

  // Строим таймлайн этапов по лидам
  const stageTimeline = {};
  for (const ev of statusEvents) {
    const lid = String(ev.entity_id);
    if (!stageTimeline[lid]) stageTimeline[lid] = [];
    try {
      const afterStatus = ev.value_after?.[0]?.lead_status;
      if (afterStatus) {
        stageTimeline[lid].push({ ts: ev.created_at, stageId: Number(afterStatus.id) });
      }
    } catch {}
  }
  for (const lid of Object.keys(stageTimeline)) {
    stageTimeline[lid].sort((a, b) => a.ts - b.ts);
  }

  const managerSet = new Set(Object.keys(managers));
  const brokerDayData = {};
  const dayHeaders = [];
  for (let d = 1; d <= daysInMonth; d++) dayHeaders.push(String(d));
  const headers = ['Брокер', ...dayHeaders, 'ИТОГО'];

  for (const ev of respEvents) {
    if (ev.entity_type !== 'lead') continue;
    const lid = String(ev.entity_id);

    try {
      const beforeResp = String(ev.value_before?.[0]?.responsible_user?.id || '');
      const createdBy = String(ev.created_by || '');

      if (!managerSet.has(beforeResp)) continue;
      if (managerSet.has(createdBy)) continue; // менеджер сам передал — не считаем

      // Определяем этап на момент события
      const timeline = stageTimeline[lid] || [];
      let stageAtTime = null;
      for (const s of timeline) {
        if (s.ts <= ev.created_at) stageAtTime = s.stageId;
      }
      if (!stageAtTime || !T9_STAGES.has(stageAtTime)) continue;

      const pDate = new Date((ev.created_at + 7 * 3600) * 1000);
      if (pDate.getUTCMonth() !== month) continue;
      const day = pDate.getUTCDate();

      if (!brokerDayData[beforeResp]) brokerDayData[beforeResp] = {};
      if (!brokerDayData[beforeResp][day]) brokerDayData[beforeResp][day] = new Set();
      brokerDayData[beforeResp][day].add(lid);
    } catch {}
  }

  const rows = [];
  for (const [managerId, name] of Object.entries(managers)) {
    const rowCells = [name];
    let rowTotal = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const ids = [...(brokerDayData[managerId]?.[d] || [])];
      rowCells.push(cell(ids.length, ids));
      rowTotal += ids.length;
    }
    rowCells.push(cell(rowTotal, []));
    rows.push(rowCells);
  }

  console.log('T9: OK');
  return { id: 't9', title: 'T9: Снятые сделки', headers: [headers], rows };
}

// ==================== T10: ПРОСРОЧКИ ПО ДНЯМ ====================

function buildT10(managers, t10Data) {
  console.log('T10: Просрочки по дням...');
  const phuket = nowPhuket();
  const daysInMonth = new Date(Date.UTC(phuket.getUTCFullYear(), phuket.getUTCMonth() + 1, 0)).getUTCDate();
  const todayDay = phuket.getUTCDate();

  const dayHeaders = [];
  for (let d = 1; d <= daysInMonth; d++) dayHeaders.push(String(d));
  const headers = ['Брокер', ...dayHeaders, 'ИТОГО'];

  const rows = [];
  let dayTotal = 0;

  for (const [managerId, name] of Object.entries(managers)) {
    const rowCells = [name];
    const data = t10Data[managerId] || { total: 0, ids: [] };

    for (let d = 1; d <= daysInMonth; d++) {
      if (d === todayDay) {
        rowCells.push(cell(data.total, data.ids.map(String)));
        dayTotal += data.total;
      } else {
        rowCells.push(''); // Исторические дни заполняются при каждом запуске
      }
    }
    rowCells.push(data.total);
    rows.push(rowCells);
  }

  const totalRow = ['ИТОГО'];
  for (let d = 1; d <= daysInMonth; d++) {
    totalRow.push(d === todayDay ? dayTotal : '');
  }
  totalRow.push(dayTotal);

  console.log(`T10: OK, ${dayTotal} просрочек сегодня`);
  return { id: 't10', title: 'T10: Количество просрочек по дням', headers: [headers], rows, totals: totalRow };
}

// ==================== СТАКАН ====================

async function syncStakan(managers) {
  console.log('Стакан: Загрузка...');
  // Стакан — простая таблица: по кругам, сколько лидов на этапах
  const stageId = STAGES.MQL; // Основной этап для стакана
  const nowTs = Math.floor(Date.now() / 1000);
  const yearAgo = nowTs - 365 * 86400;

  // Загружаем все лиды на нужных этапах
  const url = `${AMO.API_BASE}/leads?filter[statuses][0][pipeline_id]=${AMO.PIPE_ID}&filter[statuses][0][status_id]=${STAGES.MQL}`;
  const mqlLeads = await amoFetchAll(url, 'leads', { maxPages: 10 });

  // Загружаем историю кругов
  const k2Events = await loadFieldHistory(FIELDS.CIRCLE_K2, yearAgo, nowTs);
  const k3Events = await loadFieldHistory(FIELDS.CIRCLE_K3, yearAgo, nowTs);
  const k4Events = await loadFieldHistory(FIELDS.CIRCLE_K4, yearAgo, nowTs);

  const circles = { 2: [], 3: [], 4: [] };
  for (const lead of mqlLeads) {
    const lid = String(lead.id);
    if (wasFieldSetBefore(k4Events, lid, nowTs)) circles[4].push(lid);
    else if (wasFieldSetBefore(k3Events, lid, nowTs)) circles[3].push(lid);
    else if (wasFieldSetBefore(k2Events, lid, nowTs)) circles[2].push(lid);
  }

  const headers = ['Круг', 'Количество'];
  const rows = [
    ['Круг 2', cell(circles[2].length, circles[2])],
    ['Круг 3', cell(circles[3].length, circles[3])],
    ['Круг 4', cell(circles[4].length, circles[4])],
  ];

  console.log(`Стакан: OK`);
  return { id: 'stakan', title: 'Стакан 2/3/4 круг', headers: [headers], rows };
}

// ==================== ХЕЛПЕРЫ ДЛЯ КРУГОВ ====================

async function loadFieldHistory(fieldId, fromTs, toTs) {
  const events = await amoFetchAll(
    `${AMO.API_BASE}/events?filter[type]=custom_field_value_changed&filter[created_at][from]=${fromTs}&filter[created_at][to]=${toTs}`,
    'events', { maxPages: 100, limit: 250 }
  );

  const byLead = {};
  for (const ev of events) {
    try {
      const fieldChanges = ev.value_after || [];
      for (const change of (Array.isArray(fieldChanges) ? fieldChanges : [fieldChanges])) {
        if (change?.custom_field_value?.field_id === fieldId) {
          const lid = String(ev.entity_id);
          if (!byLead[lid]) byLead[lid] = [];
          byLead[lid].push({ ts: ev.created_at, set: true });
        }
      }
    } catch {}
  }
  return byLead;
}

function wasFieldSetBefore(fieldHistory, leadId, beforeTs) {
  const events = fieldHistory[leadId];
  if (!events) return false;
  return events.some(e => e.ts < beforeTs && e.set);
}

// ==================== MAIN ====================

async function main() {
  console.log('=== Tasks Sync ===');
  console.log(`Время Пхукет: ${nowPhuket().toISOString()}`);

  if (!AMO.TOKEN) {
    console.error('AMO_TOKEN не задан! Укажи через переменную окружения.');
    process.exit(1);
  }

  const managers = getManagersFallback();
  // Убираем "Свободный лид" из списка менеджеров
  delete managers['12956222'];
  console.log(`Менеджеров: ${Object.keys(managers).length}`);

  const tables = [];

  // T1 + T10
  const { table: t1, t10Data } = await syncT1(managers);
  tables.push(t1);

  // T2
  tables.push(await syncT2(managers));

  // T3
  tables.push(await syncT3(managers));

  // T4
  tables.push(await syncT4(managers));

  // T5
  tables.push(await syncT5(managers));

  // T7
  tables.push(await syncT7(managers));

  // T11
  tables.push(await syncT11(managers));

  // Круги
  tables.push(await syncCircles());

  // Расписание задач
  tables.push(await syncTaskSchedule(managers));

  // Сохраняем JSON для листа "Задачи"
  const output = {
    _meta: {
      sheet: 'Задачи',
      updated: new Date().toISOString(),
      managers: Object.keys(managers),
    },
    tables,
  };
  await saveJson(join(DATA_DIR, 'zadachi.json'), output);

  // === Лист "Задачи брокеров" ===
  const btTables = [];

  // BT
  btTables.push(await syncBT(managers));

  // T8
  btTables.push(await syncT8(managers));

  // T9
  btTables.push(await syncT9(managers));

  // T10
  btTables.push(buildT10(managers, t10Data));

  const btOutput = {
    _meta: {
      sheet: 'Задачи брокеров',
      updated: new Date().toISOString(),
      managers: Object.keys(managers),
    },
    tables: btTables,
  };
  await saveJson(join(DATA_DIR, 'zadachi-brokerov.json'), btOutput);

  // Стакан
  const stakanTable = await syncStakan(managers);
  await saveJson(join(DATA_DIR, 'stakan.json'), {
    _meta: { sheet: 'Стакан 2/3/4 круг', updated: new Date().toISOString() },
    tables: [stakanTable],
  });

  console.log('=== Tasks Sync завершён ===');
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});

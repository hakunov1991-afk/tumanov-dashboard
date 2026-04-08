#!/usr/bin/env node
/**
 * Загрузчик сырых данных из AMO CRM
 * Вытягивает ВСЕ лиды, события, задачи за нужный период → сохраняет в JSON.
 * Потом tasks-sync.js (и другие) считают таблицы из кеша, без API.
 *
 * Запуск: AMO_TOKEN=... node fetch-raw.js
 */

import { amoFetch, amoFetchAll, amoFetchLeadsByIds } from './lib/amo-client.js';
import { AMO, STAGES, FIELDS } from './lib/config.js';
import { getManagersFallback } from './lib/managers.js';
import { saveJson, nowPhuket } from './lib/utils.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(__dirname, '../docs/data/raw');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ==================== ЛИДЫ ====================

async function fetchAllLeads(managers) {
  console.log('--- Загрузка лидов ---');
  const allLeads = [];

  for (const managerId of Object.keys(managers)) {
    console.log(`  Лиды: ${managers[managerId]} (${managerId})`);
    let page = 1;
    while (page <= 50) {
      const url = `${AMO.API_BASE}/leads?page=${page}&limit=${AMO.PER_PAGE}` +
        `&filter[responsible_user_id]=${managerId}` +
        `&filter[statuses][0][pipeline_id]=${AMO.PIPE_ID}` +
        `&with=contacts`;
      const data = await amoFetch(url);
      const items = data?._embedded?.leads || [];
      if (!items.length) break;

      for (const lead of items) {
        allLeads.push({
          id: lead.id,
          status_id: lead.status_id,
          pipeline_id: lead.pipeline_id,
          responsible_user_id: lead.responsible_user_id,
          created_at: lead.created_at,
          updated_at: lead.updated_at,
          price: lead.price || 0,
          custom_fields: extractFields(lead),
          tags: extractTags(lead),
        });
      }

      if (items.length < AMO.PER_PAGE) break;
      page++;
      await sleep(AMO.SLEEP_MS);
    }
  }

  console.log(`  Итого лидов: ${allLeads.length}`);
  return allLeads;
}

function extractFields(lead) {
  if (!lead.custom_fields_values) return {};
  const result = {};
  for (const cf of lead.custom_fields_values) {
    const vals = (cf.values || []).map(v => ({
      value: v.value,
      enum_id: v.enum_id,
    }));
    result[cf.field_id] = vals;
  }
  return result;
}

function extractTags(lead) {
  if (!lead._embedded?.tags) return [];
  return lead._embedded.tags.map(t => t.name);
}

// ==================== СОБЫТИЯ ====================

async function fetchAllEvents(daysBack) {
  console.log(`--- Загрузка событий за ${daysBack} дней ---`);
  const nowTs = Math.floor(Date.now() / 1000);
  const fromTs = nowTs - daysBack * 86400;

  // Статусные переходы
  console.log('  События: lead_status_changed...');
  const statusEvents = await amoFetchAll(
    `${AMO.API_BASE}/events?filter[type]=lead_status_changed&filter[created_at][from]=${fromTs}&filter[created_at][to]=${nowTs}`,
    'events', { maxPages: 300, limit: 250, sleepMs: 100 }
  );
  console.log(`  Статусных событий: ${statusEvents.length}`);

  // Смена ответственного
  console.log('  События: entity_responsible_changed...');
  const respEvents = await amoFetchAll(
    `${AMO.API_BASE}/events?filter[type]=entity_responsible_changed&filter[created_at][from]=${fromTs}&filter[created_at][to]=${nowTs}`,
    'events', { maxPages: 200, limit: 250, sleepMs: 100 }
  );
  console.log(`  Событий смены ответственного: ${respEvents.length}`);

  // Изменения полей (для кругов)
  console.log('  События: custom_field_value_changed...');
  const fieldEvents = await amoFetchAll(
    `${AMO.API_BASE}/events?filter[type]=custom_field_value_changed&filter[created_at][from]=${nowTs - 365 * 86400}&filter[created_at][to]=${nowTs}`,
    'events', { maxPages: 200, limit: 250, sleepMs: 100 }
  );
  console.log(`  Событий полей: ${fieldEvents.length}`);

  // Нормализуем
  const normalized = {
    status: statusEvents.map(ev => ({
      id: ev.id,
      entity_id: ev.entity_id,
      entity_type: ev.entity_type,
      created_at: ev.created_at,
      created_by: ev.created_by,
      value_before: ev.value_before,
      value_after: ev.value_after,
    })),
    responsible: respEvents.map(ev => ({
      id: ev.id,
      entity_id: ev.entity_id,
      entity_type: ev.entity_type,
      created_at: ev.created_at,
      created_by: ev.created_by,
      value_before: ev.value_before,
      value_after: ev.value_after,
    })),
    fields: fieldEvents.map(ev => ({
      id: ev.id,
      entity_id: ev.entity_id,
      created_at: ev.created_at,
      created_by: ev.created_by,
      value_before: ev.value_before,
      value_after: ev.value_after,
    })),
  };

  console.log(`  Итого событий: ${normalized.status.length + normalized.responsible.length + normalized.fields.length}`);
  return normalized;
}

// ==================== ЗАДАЧИ ====================

async function fetchAllTasks(managers) {
  console.log('--- Загрузка задач ---');
  const allTasks = [];

  for (const managerId of Object.keys(managers)) {
    console.log(`  Задачи: ${managers[managerId]}`);
    let page = 1;
    while (page <= 50) {
      const url = `${AMO.API_BASE}/tasks?page=${page}&limit=${AMO.PER_PAGE}` +
        `&filter[responsible_user_id]=${managerId}` +
        `&filter[entity_type]=leads`;
      const data = await amoFetch(url);
      const items = data?._embedded?.tasks || [];
      if (!items.length) break;

      for (const task of items) {
        allTasks.push({
          id: task.id,
          entity_id: task.entity_id,
          entity_type: task.entity_type,
          responsible_user_id: task.responsible_user_id,
          created_by: task.created_by,
          created_at: task.created_at,
          updated_at: task.updated_at,
          complete_till: task.complete_till,
          is_completed: task.is_completed,
          result: task.result,
        });
      }

      if (items.length < AMO.PER_PAGE) break;
      page++;
      await sleep(AMO.SLEEP_MS);
    }
  }

  console.log(`  Итого задач: ${allTasks.length}`);
  return allTasks;
}

// ==================== MAIN ====================

async function main() {
  console.log('=== Fetch Raw Data from AMO CRM ===');
  console.log(`Время Пхукет: ${nowPhuket().toISOString()}`);

  if (!AMO.TOKEN) {
    console.error('AMO_TOKEN не задан!');
    process.exit(1);
  }

  const managers = getManagersFallback();
  delete managers['12956222']; // Свободный лид
  console.log(`Менеджеров: ${Object.keys(managers).length}`);

  const startTime = Date.now();

  // 1. Лиды
  const leads = await fetchAllLeads(managers);
  await saveJson(join(RAW_DIR, 'leads.json'), {
    _meta: { fetched: new Date().toISOString(), count: leads.length },
    leads,
  });

  // 2. События (180 дней для статусных, 365 для полей)
  const events = await fetchAllEvents(180);
  await saveJson(join(RAW_DIR, 'events.json'), {
    _meta: { fetched: new Date().toISOString(), statusCount: events.status.length, respCount: events.responsible.length, fieldCount: events.fields.length },
    events,
  });

  // 3. Задачи
  const tasks = await fetchAllTasks(managers);
  await saveJson(join(RAW_DIR, 'tasks.json'), {
    _meta: { fetched: new Date().toISOString(), count: tasks.length },
    tasks,
  });

  // 4. Менеджеры
  await saveJson(join(RAW_DIR, 'managers.json'), {
    _meta: { fetched: new Date().toISOString() },
    managers,
  });

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n=== Готово за ${elapsed} сек ===`);
  console.log(`Лидов: ${leads.length}, Событий: ${events.status.length + events.responsible.length + events.fields.length}, Задач: ${tasks.length}`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Interns Sync — стажёры (аналог Stajeri.js)
 * Воронка по стажёрам + просроченные задачи
 *
 * Запуск: AMO_TOKEN=... node interns-sync.js
 */

import { amoFetch, amoFetchAll, amoFetchTransitions } from './lib/amo-client.js';
import { AMO, STAGES } from './lib/config.js';
import { cell, saveJson, nowPhuket, yesterdayStartPhuket, monthStartPhuket } from './lib/utils.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFile, writeFile } from 'fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../docs/data/sheets');
const STATE_DIR = join(__dirname, '../docs/data');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Стажёры определяются из AMO — группа "Стажёры" (нужен ID группы)
// Пока хардкод — обновится при наличии группы
const INTERN_GROUP_ID = null; // TODO: указать ID группы стажёров

async function loadInterns() {
  // Загружаем пользователей AMO и ищем стажёров
  const url = `${AMO.API_BASE}/users?page=1&limit=250&with=group`;
  const data = await amoFetch(url);
  if (!data?._embedded?.users) return {};

  const interns = {};
  for (const user of data._embedded.users) {
    // Если есть группа стажёров — фильтруем
    if (INTERN_GROUP_ID && user.rights?.group_id !== INTERN_GROUP_ID) continue;
    // Иначе — ищем по имени/группе (временное решение)
    if (!INTERN_GROUP_ID) continue; // Пропускаем если нет группы
    interns[String(user.id)] = user.name;
  }

  return interns;
}

// ==================== ВОРОНКА СТАЖЁРОВ ====================

async function syncInternFunnel(interns) {
  if (Object.keys(interns).length === 0) {
    console.log('Стажёры: нет стажёров, пропускаю');
    return [];
  }

  console.log('Стажёры: воронка...');
  const nowTs = Math.floor(Date.now() / 1000);
  const monthStart = monthStartPhuket();
  const yesterdayStart = yesterdayStartPhuket();
  const yesterdayEnd = yesterdayStart + 86400;

  const funnelStages = [
    { id: STAGES.TAKEN_TO_WORK, name: 'Взят в работу' },
    { id: STAGES.MQL, name: 'MQL' },
    { id: STAGES.SQL, name: 'SQL' },
    { id: STAGES.MEETING_SCHEDULED, name: 'Встреча назначена' },
  ];

  const tables = [];

  // Загружаем переходы
  const transitions = await amoFetchTransitions(STAGES.TAKEN_TO_WORK, monthStart, nowTs);

  for (const [period, title, fromTs, toTs] of [
    ['month', 'Стажёры: с начала месяца', monthStart, nowTs],
    ['day', 'Стажёры: за вчера', yesterdayStart, yesterdayEnd],
  ]) {
    const headers = ['Стажёр', ...funnelStages.map(s => s.name)];
    const rows = [];

    for (const [internId, name] of Object.entries(interns)) {
      const row = [name];
      const periodTransitions = transitions.filter(t => t.ts >= fromTs && t.ts < toTs && t.managerId === internId);
      const leadIds = [...new Set(periodTransitions.map(t => t.leadId))];

      // Для каждого этапа — сколько лидов дошли
      for (const stage of funnelStages) {
        if (stage.id === STAGES.TAKEN_TO_WORK) {
          row.push(cell(leadIds.length, leadIds));
        } else {
          // Проверяем переходы на следующие этапы
          const stageTransitions = await amoFetchTransitions(stage.id, fromTs, toTs);
          const reached = leadIds.filter(lid => stageTransitions.some(t => t.leadId === lid));
          row.push(cell(reached.length, reached));
        }
      }
      rows.push(row);
    }

    tables.push({ id: 'intern-' + period, title, headers: [headers], rows });
  }

  return tables;
}

// ==================== MAIN ====================

async function main() {
  console.log('=== Interns Sync ===');
  if (!AMO.TOKEN) { console.error('AMO_TOKEN не задан!'); process.exit(1); }

  const interns = await loadInterns();
  console.log(`Стажёров: ${Object.keys(interns).length}`);

  const tables = await syncInternFunnel(interns);

  await saveJson(join(DATA_DIR, 'stazhery.json'), {
    _meta: { sheet: 'Стажеры', updated: new Date().toISOString() },
    tables,
  });

  console.log('=== Interns Sync завершён ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

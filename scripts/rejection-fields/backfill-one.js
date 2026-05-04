#!/usr/bin/env node
/**
 * Заполняет поля «Причина отказа N круг» для одной сделки на основе истории
 * изменений поля «Причина отказа» (1617988).
 *
 * Запуск:
 *   AMO_TOKEN=... node backfill-one.js <leadId> [--dry-run] [--overwrite]
 *
 * --dry-run    — показать что будет записано, но не писать
 * --overwrite  — перезаписать поле круга, даже если оно уже заполнено
 */

import axios from 'axios';

const AMO_BASE = 'https://tumanovgroup.amocrm.ru/api/v4';
const TOKEN = process.env.AMO_TOKEN;

const FIELD_REASON   = 1617988; // «Причина отказа» — источник
const FIELD_K2       = 1630857;
const FIELD_K3       = 1630859;
const FIELD_K4       = 1631871;
const FIELD_REASON_BY_CIRCLE = {
  1: 1632879,
  2: 1632881,
  3: 1632883,
  4: 1632885,
};

const SLEEP_MS = 200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const args = process.argv.slice(2);
const leadId = args.find(a => /^\d+$/.test(a));
const dryRun = args.includes('--dry-run');
const overwrite = args.includes('--overwrite');

if (!TOKEN) { console.error('AMO_TOKEN не задан'); process.exit(1); }
if (!leadId) { console.error('Использование: node backfill-one.js <leadId> [--dry-run] [--overwrite]'); process.exit(1); }

async function amo(method, path, body) {
  const url = AMO_BASE + path;
  for (let i = 0; i < 5; i++) {
    try {
      const resp = await axios({
        method, url, data: body,
        headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });
      if (resp.status === 429) {
        console.warn(`429, retry in ${(i + 1) * 1000}ms`);
        await sleep((i + 1) * 1000);
        continue;
      }
      if (resp.status >= 400) {
        console.error(`HTTP ${resp.status}: ${JSON.stringify(resp.data).substring(0, 400)}`);
        return null;
      }
      return resp.data;
    } catch (e) {
      console.error('exception:', e.message);
      await sleep(1000);
    }
  }
  return null;
}

/**
 * Загружает события заданного типа с фильтром по entity_id.
 * AMO позволяет фильтровать по entity_id для events: filter[entity_id]=ID
 * (мы пробовали filter[entity_id] для transitions — не работало,
 * но для одного ID + одного типа кажется работает; попробуем).
 * Если фильтр не сработает — fallback на широкий поиск по типу за период.
 */
async function fetchEventsForLead(eventType, leadId) {
  const all = [];
  // Попытка с фильтром entity_id
  let page = 1;
  while (page <= 50) {
    const params = [
      `filter[type]=${eventType}`,
      `filter[entity_id]=${leadId}`,
      `filter[entity]=lead`,
      `page=${page}`,
      `limit=100`,
    ].join('&');
    const data = await amo('GET', `/events?${params}`);
    if (!data || !data._embedded || !data._embedded.events) break;
    const events = data._embedded.events;
    all.push(...events);
    if (events.length < 100) break;
    page++;
    await sleep(SLEEP_MS);
  }
  return all;
}

function parseEnumValue(ev) {
  // value_after = [{ custom_field_value: { enum_id, value } }]
  if (!ev.value_after || !ev.value_after[0]) return null;
  const v = ev.value_after[0].custom_field_value;
  if (!v) return null;
  return {
    enum_id: v.enum_id || null,
    value: v.value || null,
  };
}

function parseSetValue(ev) {
  // Для bool-like полей К2/К3/К4 — true если value_after.custom_field_value есть и не пустой
  const v = ev.value_after && ev.value_after[0] && ev.value_after[0].custom_field_value;
  if (!v) return false;
  if (v.text != null) {
    const t = String(v.text).toLowerCase();
    return t === '1' || t === 'true' || t === 'да';
  }
  if (v.enum_id != null) return true;
  if (v.value != null && v.value !== '') return true;
  return false;
}

function wasSetBefore(events, beforeTs) {
  // Все события для одного лида (мы их уже отфильтровали).
  // Возвращает последний state до beforeTs.
  let last = false;
  const sorted = events.slice().sort((a, b) => a.created_at - b.created_at);
  for (const e of sorted) {
    if (e.created_at < beforeTs) last = parseSetValue(e);
    else break;
  }
  return last;
}

async function main() {
  console.log(`=== Backfill rejection fields for lead ${leadId} ===`);
  console.log(`dry-run: ${dryRun}, overwrite: ${overwrite}`);

  // 1. Текущие значения custom-полей
  console.log('Загрузка лида...');
  const lead = await amo('GET', `/leads/${leadId}`);
  if (!lead) { console.error('Сделка не найдена'); process.exit(1); }

  const cfs = lead.custom_fields_values || [];
  const currentByField = {};
  for (const cf of cfs) currentByField[cf.field_id] = cf.values;

  console.log(`  status_id: ${lead.status_id}, responsible: ${lead.responsible_user_id}`);
  console.log(`  Текущая «Причина отказа» (1617988):`, currentByField[FIELD_REASON] || '— не заполнено');
  for (const c of [1, 2, 3, 4]) {
    const fid = FIELD_REASON_BY_CIRCLE[c];
    console.log(`  Текущая «Причина отказа ${c} круг» (${fid}):`, currentByField[fid] || '— пусто');
  }

  // 2. История изменений поля REASON
  console.log('\nЗагрузка истории поля 1617988 (Причина отказа)...');
  const reasonEvents = await fetchEventsForLead(`custom_field_${FIELD_REASON}_value_changed`, leadId);
  console.log(`  Событий: ${reasonEvents.length}`);

  if (reasonEvents.length === 0) {
    console.log('Нет событий по причине отказа — ничего не записываем.');
    process.exit(0);
  }

  // 3. История К2/К3/К4
  console.log('Загрузка истории К2/К3/К4...');
  const k2Events = await fetchEventsForLead(`custom_field_${FIELD_K2}_value_changed`, leadId);
  const k3Events = await fetchEventsForLead(`custom_field_${FIELD_K3}_value_changed`, leadId);
  const k4Events = await fetchEventsForLead(`custom_field_${FIELD_K4}_value_changed`, leadId);
  console.log(`  K2 событий: ${k2Events.length}, K3: ${k3Events.length}, K4: ${k4Events.length}`);

  // 4. Для каждого события 1617988 — определяем круг на момент и берём enum
  const reasonByCircle = {}; // circle -> { enum_id, value, ts }
  const sortedReasons = reasonEvents.slice().sort((a, b) => a.created_at - b.created_at);
  for (const ev of sortedReasons) {
    const ts = ev.created_at;
    const enumVal = parseEnumValue(ev);
    if (!enumVal || !enumVal.enum_id) continue;

    const hasK4 = wasSetBefore(k4Events, ts + 1); // +1 чтобы захватить событие в эту же секунду
    const hasK3 = wasSetBefore(k3Events, ts + 1);
    const hasK2 = wasSetBefore(k2Events, ts + 1);
    let circle = 1;
    if (hasK4) circle = 4;
    else if (hasK3) circle = 3;
    else if (hasK2) circle = 2;

    // Берём LATEST для каждого круга
    if (!reasonByCircle[circle] || ts > reasonByCircle[circle].ts) {
      reasonByCircle[circle] = { ...enumVal, ts };
    }
  }

  console.log('\nРазбивка причин по кругам:');
  for (const c of [1, 2, 3, 4]) {
    const r = reasonByCircle[c];
    if (r) {
      const date = new Date(r.ts * 1000).toISOString().substring(0, 19);
      console.log(`  Круг ${c}: enum_id=${r.enum_id}, "${r.value}" (от ${date})`);
    } else {
      console.log(`  Круг ${c}: — нет события`);
    }
  }

  // 5. Готовим payload
  const updates = [];
  for (const c of [1, 2, 3, 4]) {
    const r = reasonByCircle[c];
    if (!r) continue;
    const fid = FIELD_REASON_BY_CIRCLE[c];
    const existing = currentByField[fid];
    if (existing && existing.length > 0) {
      const existingEnumId = existing[0] && existing[0].enum_id;
      if (!overwrite) {
        console.log(`  SKIP круг ${c}: поле ${fid} уже заполнено (enum=${existingEnumId}). Используйте --overwrite.`);
        continue;
      }
    }
    updates.push({ field_id: fid, values: [{ enum_id: r.enum_id }] });
  }

  if (updates.length === 0) {
    console.log('\nНечего записывать.');
    process.exit(0);
  }

  console.log('\nЗапись:');
  for (const u of updates) console.log(' ', u);

  if (dryRun) {
    console.log('\n[DRY-RUN] Запись пропущена.');
    process.exit(0);
  }

  const patchBody = { custom_fields_values: updates };
  const result = await amo('PATCH', `/leads/${leadId}`, patchBody);
  if (!result) {
    console.error('Ошибка записи');
    process.exit(1);
  }
  console.log('\n✅ Готово. Лид обновлён.');
  console.log(`Проверить: https://tumanovgroup.amocrm.ru/leads/detail/${leadId}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

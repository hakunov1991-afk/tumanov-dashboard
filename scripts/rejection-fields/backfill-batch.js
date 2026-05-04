#!/usr/bin/env node
/**
 * Массовое заполнение полей «Причина отказа N круг» для списка сделок.
 *
 * Запуск:
 *   AMO_TOKEN=... node backfill-batch.js <file-with-lead-ids> [--dry-run] [--overwrite] [--from-days=N]
 *
 * file-with-lead-ids — путь к txt файлу, по одному ID на строку
 * --from-days=N      — диапазон загрузки событий (дней назад). По умолчанию 730.
 */

import axios from 'axios';
import { readFileSync } from 'fs';

const AMO_BASE = 'https://tumanovgroup.amocrm.ru/api/v4';
const TOKEN = process.env.AMO_TOKEN;

const FIELD_REASON   = 1617988;
const FIELD_K2       = 1630857;
const FIELD_K3       = 1630859;
const FIELD_K4       = 1631871;
const FIELD_REASON_BY_CIRCLE = { 1: 1632879, 2: 1632881, 3: 1632883, 4: 1632885 };

const SLEEP_MS = 250;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const args = process.argv.slice(2);
const filePath = args.find(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const overwrite = args.includes('--overwrite');
const fromDaysArg = args.find(a => a.startsWith('--from-days='));
const fromDays = fromDaysArg ? parseInt(fromDaysArg.split('=')[1], 10) : 730;

if (!TOKEN) { console.error('AMO_TOKEN не задан'); process.exit(1); }
if (!filePath) { console.error('Использование: node backfill-batch.js <file> [--dry-run] [--overwrite] [--from-days=N]'); process.exit(1); }

const leadIds = readFileSync(filePath, 'utf-8').split('\n').map(s => s.trim()).filter(s => /^\d+$/.test(s));
console.log(`Сделок к обработке: ${leadIds.length}`);
console.log(`dry-run=${dryRun}, overwrite=${overwrite}, from-days=${fromDays}`);

async function amo(method, path, body) {
  const url = AMO_BASE + path;
  for (let i = 0; i < 6; i++) {
    try {
      const resp = await axios({
        method, url, data: body,
        headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });
      if (resp.status === 429) {
        const wait = (i + 1) * 1500;
        console.warn(`  429, retry in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (resp.status === 204) return null;
      if (resp.status >= 400) {
        console.error(`  HTTP ${resp.status}: ${JSON.stringify(resp.data).substring(0, 300)}`);
        return null;
      }
      return resp.data;
    } catch (e) {
      console.error('  exception:', e.message);
      await sleep(1500);
    }
  }
  return null;
}

/** Грузит ВСЕ события указанного типа за период (без фильтра по лиду). Возвращает {leadId: [{ts, value, enum_id, set}]} */
async function loadAllEventsByLead(eventType, fromTs, toTs) {
  const byLead = {};
  let page = 1;
  let totalEvents = 0;
  while (page <= 500) {
    const params = [
      `filter[type]=${eventType}`,
      `filter[created_at][from]=${fromTs}`,
      `filter[created_at][to]=${toTs}`,
      `page=${page}`, `limit=100`,
    ].join('&');
    const data = await amo('GET', `/events?${params}`);
    if (!data || !data._embedded || !data._embedded.events) break;
    const events = data._embedded.events;
    for (const e of events) {
      const lid = String(e.entity_id);
      if (!byLead[lid]) byLead[lid] = [];
      const v = e.value_after && e.value_after[0] && e.value_after[0].custom_field_value;
      byLead[lid].push({
        ts: e.created_at,
        enum_id: v && v.enum_id ? v.enum_id : null,
        value: v && v.value ? v.value : null,
        text: v && v.text ? v.text : null,
        set: !!(v && (v.enum_id || (v.value !== null && v.value !== '') || (v.text != null && String(v.text).toLowerCase() !== '0' && String(v.text).toLowerCase() !== 'false' && String(v.text).toLowerCase() !== ''))),
      });
    }
    totalEvents += events.length;
    if (events.length < 100) break;
    page++;
    await sleep(SLEEP_MS);
    if (page % 10 === 0) console.log(`    ${eventType}: ${totalEvents} событий...`);
  }
  // Sort by ts
  for (const lid of Object.keys(byLead)) byLead[lid].sort((a, b) => a.ts - b.ts);
  return { byLead, total: totalEvents };
}

function wasSetBefore(events, beforeTs) {
  if (!events || !events.length) return false;
  let last = false;
  for (const ev of events) {
    if (ev.ts < beforeTs) last = ev.set;
    else break;
  }
  return last;
}

/** Загружает текущие данные лидов батчами по 50 */
async function loadLeadsBatch(ids) {
  const map = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const filterParts = batch.map((id, idx) => `filter[id][${idx}]=${id}`);
    const url = `/leads?${filterParts.join('&')}&limit=250`;
    const data = await amo('GET', url);
    if (data && data._embedded && data._embedded.leads) {
      for (const l of data._embedded.leads) map[String(l.id)] = l;
    }
    await sleep(SLEEP_MS);
    if ((i / 50) % 5 === 0) console.log(`    Лидов загружено: ${Object.keys(map).length}/${ids.length}`);
  }
  return map;
}

async function main() {
  const nowTs = Math.floor(Date.now() / 1000);
  const fromTs = nowTs - fromDays * 86400;
  console.log(`Период событий: ${new Date(fromTs * 1000).toISOString().substring(0, 10)} — ${new Date(nowTs * 1000).toISOString().substring(0, 10)}`);

  // 1. Структура полей
  console.log('\n[1/5] Загрузка структуры полей...');
  const reasonFieldData = await amo('GET', `/leads/custom_fields/${FIELD_REASON}`);
  const reasonEnumIdToText = {};
  if (reasonFieldData && reasonFieldData.enums) {
    for (const e of reasonFieldData.enums) reasonEnumIdToText[e.id] = e.value;
  }
  console.log(`  Поле 1617988: enums=${Object.keys(reasonEnumIdToText).length}`);

  const circleFieldMeta = {};
  for (const c of [1, 2, 3, 4]) {
    const fid = FIELD_REASON_BY_CIRCLE[c];
    const fd = await amo('GET', `/leads/custom_fields/${fid}`);
    circleFieldMeta[fid] = fd ? { type: fd.type, enums: fd.enums || [] } : { type: 'text', enums: [] };
    console.log(`  Поле ${fid} (К${c}): type=${circleFieldMeta[fid].type}, enums=${circleFieldMeta[fid].enums.length}`);
  }

  // 2. События REASON + K2/K3/K4 за период
  console.log('\n[2/5] Загрузка событий за период...');
  const reasonRes = await loadAllEventsByLead(`custom_field_${FIELD_REASON}_value_changed`, fromTs, nowTs);
  console.log(`  REASON: ${reasonRes.total} событий по ${Object.keys(reasonRes.byLead).length} лидам`);
  const k2Res = await loadAllEventsByLead(`custom_field_${FIELD_K2}_value_changed`, fromTs, nowTs);
  console.log(`  K2: ${k2Res.total} событий`);
  const k3Res = await loadAllEventsByLead(`custom_field_${FIELD_K3}_value_changed`, fromTs, nowTs);
  console.log(`  K3: ${k3Res.total} событий`);
  const k4Res = await loadAllEventsByLead(`custom_field_${FIELD_K4}_value_changed`, fromTs, nowTs);
  console.log(`  K4: ${k4Res.total} событий`);

  // 3. Текущие данные лидов
  console.log('\n[3/5] Загрузка текущих данных сделок...');
  const leadsMap = await loadLeadsBatch(leadIds);
  console.log(`  Загружено: ${Object.keys(leadsMap).length}/${leadIds.length}`);

  // 4. Расчёт распределения по кругам и подготовка PATCH
  console.log('\n[4/5] Расчёт...');
  const updatesPerLead = []; // [{id, custom_fields_values:[...]}]
  let withReason = 0, noReason = 0, alreadyFilled = 0, willWrite = 0;

  for (const lid of leadIds) {
    const lead = leadsMap[lid];
    if (!lead) { console.warn(`  ${lid}: не найден в AMO`); continue; }

    const reasonEvs = (reasonRes.byLead[lid] || []).filter(e => e.enum_id);
    if (!reasonEvs.length) { noReason++; continue; }
    withReason++;

    const cfs = {};
    for (const cf of lead.custom_fields_values || []) cfs[cf.field_id] = cf.values;

    const k2Evs = k2Res.byLead[lid] || [];
    const k3Evs = k3Res.byLead[lid] || [];
    const k4Evs = k4Res.byLead[lid] || [];

    const reasonByCircle = {};
    for (const ev of reasonEvs) {
      const ts = ev.ts;
      const hasK4 = wasSetBefore(k4Evs, ts + 1);
      const hasK3 = wasSetBefore(k3Evs, ts + 1);
      const hasK2 = wasSetBefore(k2Evs, ts + 1);
      let circle = 1;
      if (hasK4) circle = 4;
      else if (hasK3) circle = 3;
      else if (hasK2) circle = 2;
      if (!reasonByCircle[circle] || ts > reasonByCircle[circle].ts) {
        reasonByCircle[circle] = { enum_id: ev.enum_id, ts };
      }
    }

    const updates = [];
    for (const c of [1, 2, 3, 4]) {
      const r = reasonByCircle[c];
      if (!r) continue;
      const fid = FIELD_REASON_BY_CIRCLE[c];
      if (cfs[fid] && cfs[fid].length > 0 && !overwrite) { alreadyFilled++; continue; }
      const text = reasonEnumIdToText[r.enum_id] || '';
      if (!text) continue;
      const meta = circleFieldMeta[fid];
      let values;
      if (meta.enums && meta.enums.length > 0) {
        const m = meta.enums.find(e => String(e.value).trim() === text.trim());
        if (m) values = [{ enum_id: m.id }];
        else { console.warn(`  ${lid}: enum "${text}" не найден в поле ${fid}`); continue; }
      } else {
        values = [{ value: text }];
      }
      updates.push({ field_id: fid, values });
    }

    if (updates.length > 0) {
      updatesPerLead.push({ id: parseInt(lid, 10), custom_fields_values: updates });
      willWrite += updates.length;
    }
  }

  console.log(`  Лидов с событиями: ${withReason}, без: ${noReason}, поля скипнуты (уже заполнены): ${alreadyFilled}`);
  console.log(`  Лидов к записи: ${updatesPerLead.length}, всего полей: ${willWrite}`);

  if (updatesPerLead.length === 0) { console.log('Нечего писать.'); return; }

  // Превью первых 3
  console.log('\nПример:');
  for (const u of updatesPerLead.slice(0, 3)) console.log(' ', JSON.stringify(u).substring(0, 300));

  if (dryRun) { console.log('\n[DRY-RUN] Запись пропущена.'); return; }

  // 5. Batch PATCH (50 лидов на запрос)
  console.log('\n[5/5] Запись в AMO...');
  let written = 0, errors = 0;
  for (let i = 0; i < updatesPerLead.length; i += 50) {
    const batch = updatesPerLead.slice(i, i + 50);
    const result = await amo('PATCH', '/leads', batch);
    if (result) {
      written += batch.length;
    } else {
      errors += batch.length;
    }
    console.log(`  Записано: ${written}/${updatesPerLead.length} (ошибок: ${errors})`);
    await sleep(SLEEP_MS);
  }

  console.log(`\n✅ Готово. Обновлено: ${written}, ошибок: ${errors}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

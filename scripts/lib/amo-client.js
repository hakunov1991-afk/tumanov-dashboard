/**
 * AMO CRM API клиент — обёртка с ретраями, пагинацией, rate limiting
 * Аналог _amoFetch_ / _amoFetchRating_ из GAS
 */

import axios from 'axios';
import { AMO } from './config.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Единичный запрос к AMO API с ретраями
 */
export async function amoFetch(url, opts = {}) {
  const maxRetries = opts.retries ?? AMO.MAX_RETRIES;
  let retryDelay = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${AMO.TOKEN}`,
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
      });

      if (resp.status === 204) return null;

      if (resp.status === 429) {
        if (attempt < maxRetries) {
          console.warn(`AMO 429, retry ${attempt + 1}/${maxRetries}, wait ${retryDelay}ms`);
          await sleep(retryDelay);
          retryDelay = Math.min(retryDelay * 2, 10000);
          continue;
        }
        console.error(`AMO 429 after ${maxRetries} retries: ${url.substring(0, 200)}`);
        return null;
      }

      if (resp.status !== 200) {
        console.error(`AMO HTTP ${resp.status}: ${JSON.stringify(resp.data).substring(0, 200)}`);
        return null;
      }

      return resp.data;
    } catch (e) {
      if (attempt < maxRetries) {
        console.warn(`AMO exception retry ${attempt + 1}/${maxRetries}: ${e.message}`);
        await sleep(retryDelay);
        retryDelay = Math.min(retryDelay * 2, 10000);
        continue;
      }
      console.error(`AMO exception: ${e.message}`);
      return null;
    }
  }
  return null;
}

/**
 * Пагинированный запрос — загружает все страницы
 * @param {string} baseUrl — URL без page= параметра
 * @param {string} embeddedKey — ключ в _embedded (leads, events, tasks, etc.)
 * @param {object} opts — { maxPages, limit, sleepMs }
 */
export async function amoFetchAll(baseUrl, embeddedKey, opts = {}) {
  const maxPages = opts.maxPages ?? 40;
  const limit = opts.limit ?? AMO.PER_PAGE;
  const sleepMs = opts.sleepMs ?? AMO.SLEEP_MS;
  const all = [];

  for (let page = 1; page <= maxPages; page++) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${sep}page=${page}&limit=${limit}`;
    const data = await amoFetch(url);

    if (!data?._embedded?.[embeddedKey]) break;

    const items = data._embedded[embeddedKey];
    all.push(...items);

    if (items.length < limit) break;
    await sleep(sleepMs);
  }

  return all;
}

/**
 * Загрузка лидов батчами по ID
 * @param {string[]} leadIds
 * @param {object} opts — { batchSize, with: 'contacts' }
 */
export async function amoFetchLeadsByIds(leadIds, opts = {}) {
  const batchSize = opts.batchSize ?? 50;
  const withParam = opts.with ?? '';
  const all = [];

  for (let i = 0; i < leadIds.length; i += batchSize) {
    const batch = leadIds.slice(i, i + batchSize);
    const filterParts = batch.map((id, idx) => `filter[id][${idx}]=${id}`);
    let url = `${AMO.API_BASE}/leads?${filterParts.join('&')}&limit=250`;
    if (withParam) url += `&with=${withParam}`;

    const data = await amoFetch(url);
    if (data?._embedded?.leads) {
      all.push(...data._embedded.leads);
    }
    await sleep(AMO.SLEEP_MS);
  }

  return all;
}

/**
 * Загрузка событий смены статуса для конкретного этапа
 * @param {number} stageId
 * @param {number} fromTs — unix timestamp
 * @param {number} toTs — unix timestamp
 */
export async function amoFetchTransitions(stageId, fromTs, toTs, opts = {}) {
  const limit = opts.limit ?? 100;
  const transitions = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = `${AMO.API_BASE}/events?` + [
      'filter[type]=lead_status_changed',
      `filter[created_at][from]=${fromTs}`,
      `filter[created_at][to]=${toTs}`,
      `filter[value_after][leads_statuses][0][status_id]=${stageId}`,
      `filter[value_after][leads_statuses][0][pipeline_id]=${AMO.PIPE_ID}`,
      `page=${page}`,
      `limit=${limit}`,
    ].join('&');

    const data = await amoFetch(url);
    if (data?._embedded?.events) {
      const events = data._embedded.events;
      for (const e of events) {
        transitions.push({
          leadId: String(e.entity_id),
          managerId: String(e.created_by),
          ts: e.created_at,
        });
      }
      hasMore = events.length === limit;
      page++;
      await sleep(AMO.SLEEP_MS);
    } else {
      hasMore = false;
    }
  }

  return transitions;
}

/**
 * Загрузка событий смены ответственного
 */
export async function amoFetchResponsibleEvents(fromTs, toTs) {
  const all = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = `${AMO.API_BASE}/events?` + [
      'filter[type]=lead_responsible_changed',
      `filter[created_at][from]=${fromTs}`,
      `filter[created_at][to]=${toTs}`,
      `page=${page}`,
      'limit=100',
    ].join('&');

    const data = await amoFetch(url);
    if (data?._embedded?.events) {
      const events = data._embedded.events;
      all.push(...events);
      hasMore = events.length === 100;
      page++;
      await sleep(AMO.SLEEP_MS);
    } else {
      hasMore = false;
    }
  }

  return all;
}

/**
 * Загрузка истории событий изменения кастомного поля.
 * Возвращает { leadId: [{ts, set:bool}, ...] } (сортировано по ts ASC).
 * Аналог _loadCircleFieldHistory_ из GAS.
 */
export async function amoFetchCustomFieldHistory(fieldId, fromTs, toTs) {
  const history = {};
  let page = 1;
  let hasMore = true;
  const limit = 100;

  while (hasMore) {
    const url = `${AMO.API_BASE}/events?` + [
      `filter[type]=custom_field_${fieldId}_value_changed`,
      `filter[created_at][from]=${fromTs}`,
      `filter[created_at][to]=${toTs}`,
      `page=${page}`,
      `limit=${limit}`,
    ].join('&');

    const data = await amoFetch(url);
    if (!data?._embedded?.events) break;
    const events = data._embedded.events;
    for (const e of events) {
      const leadId = String(e.entity_id);
      if (!history[leadId]) history[leadId] = [];
      let isSet = false;
      if (e.value_after && e.value_after[0]) {
        const val = e.value_after[0].custom_field_value;
        if (val && val.text) {
          const t = String(val.text).toLowerCase();
          isSet = (t === '1' || t === 'true' || t === 'да');
        } else if (val && val.enum_id) {
          isSet = true;
        }
      }
      history[leadId].push({ ts: e.created_at, set: isSet });
    }
    hasMore = events.length === limit;
    page++;
    await sleep(AMO.SLEEP_MS);
  }

  // Сортируем события по ts
  for (const lid of Object.keys(history)) {
    history[lid].sort((a, b) => a.ts - b.ts);
  }
  return history;
}

/**
 * Был ли установлен кастомный (bool-like) field у лида до beforeTs.
 * Аналог _wasCircleFieldSetBefore_ из GAS.
 */
export function wasCustomFieldSetBefore(history, leadId, beforeTs) {
  const events = history[leadId];
  if (!events || events.length === 0) return false;
  let lastState = false;
  for (const ev of events) {
    if (ev.ts < beforeTs) lastState = ev.set;
    else break;
  }
  return lastState;
}

/**
 * Загрузка текущего responsible_user_id для списка лидов
 */
export async function amoFetchLeadResponsibles(leadIds) {
  const map = {};
  const leads = await amoFetchLeadsByIds(leadIds);
  for (const lead of leads) {
    map[String(lead.id)] = String(lead.responsible_user_id);
  }
  return map;
}

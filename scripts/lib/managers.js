/**
 * Загрузка списка менеджеров из AMO CRM по группе
 * Заменяет хардкод MANAGERS_DICT из GAS
 */

import { amoFetch } from './amo-client.js';
import { AMO, BROKER_GROUP_ID } from './config.js';
import { saveJson } from './utils.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANAGERS_JSON = join(__dirname, '../../docs/data/managers.json');

/**
 * Загружает список брокеров из AMO CRM — группа 529606 "Брокеры Пхукет"
 * @returns {Object} — { amoId: name, ... }
 */
export async function loadManagersFromAmo() {
  const groupId = BROKER_GROUP_ID;
  console.log(`Загрузка брокеров из AMO группы ${groupId}...`);

  try {
    // AMO API /users не фильтрует по группе — загружаем всех и фильтруем
    const allUsers = [];
    let page = 1;
    while (page <= 10) {
      const url = `${AMO.API_BASE}/users?page=${page}&limit=250&with=group`;
      const data = await amoFetch(url);
      if (!data?._embedded?.users) break;
      allUsers.push(...data._embedded.users);
      if (data._embedded.users.length < 250) break;
      page++;
    }

    if (!allUsers.length) {
      console.warn('Не удалось загрузить пользователей AMO');
      return loadManagersFromCache();
    }

    const managers = {};
    for (const user of allUsers) {
      // Проверяем принадлежность к группе
      if (user.rights?.group_id === groupId) {
        managers[String(user.id)] = user.name;
      }
    }

    if (Object.keys(managers).length === 0) {
      console.warn(`Группа ${groupId} пустая или не найдена`);
      return loadManagersFromCache();
    }

    // Сохраняем в JSON для дашборда
    await saveJson(MANAGERS_JSON, {
      _meta: { updated: new Date().toISOString(), groupId, count: Object.keys(managers).length },
      managers,
    });

    console.log(`Загружено ${Object.keys(managers).length} брокеров из группы ${groupId}`);
    return managers;
  } catch (e) {
    console.error(`Ошибка загрузки менеджеров: ${e.message}`);
    return loadManagersFromCache();
  }
}

/**
 * Загружает менеджеров из кешированного JSON (без API вызова)
 */
export async function loadManagersFromCache() {
  try {
    const raw = await readFile(MANAGERS_JSON, 'utf-8');
    const data = JSON.parse(raw);
    if (data.managers && Object.keys(data.managers).length > 0) {
      console.log(`Загружено ${Object.keys(data.managers).length} менеджеров из кеша`);
      return data.managers;
    }
  } catch {}
  console.warn('Кеш менеджеров пуст, невозможно продолжить');
  return {};
}

/**
 * Загрузка списка менеджеров из AMO CRM по группе
 * Заменяет хардкод MANAGERS_DICT из GAS
 */

import { amoFetch } from './amo-client.js';
import { AMO } from './config.js';
import { saveJson } from './utils.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANAGERS_JSON = join(__dirname, '../../docs/data/managers.json');

// Хардкод-фоллбэк (если API недоступен)
const FALLBACK_MANAGERS = {
  '10440430': 'Алина Федотова',
  '10715622': 'Басов Антон',
  '10987274': 'Ольга Сиразитдинова',
  '11778278': 'Альвина Санникова',
  '12174494': 'Надежда Платонова',
  '12376906': 'Оксана Козырева',
  '12956222': 'Свободный лид',
  '13081202': 'Мария Кудашева',
  '13114422': 'Алексей Носиков',
  '13251914': 'Вера Королёва',
  '10457386': 'Бухвалов Данил',
  '13323040': 'Тимур Мороз',
};

/**
 * Загружает список менеджеров из AMO CRM по ID группы
 * @param {number} groupId — ID группы в AMO
 * @returns {Object} — { amoId: name, ... }
 */
export async function loadManagersFromGroup(groupId) {
  try {
    const url = `${AMO.API_BASE}/users?page=1&limit=250`;
    const data = await amoFetch(url);

    if (!data?._embedded?.users) {
      console.warn('Не удалось загрузить пользователей AMO, используем фоллбэк');
      return FALLBACK_MANAGERS;
    }

    const managers = {};
    for (const user of data._embedded.users) {
      // Проверяем принадлежность к группе
      if (user.rights?.group_id === groupId || !groupId) {
        managers[String(user.id)] = user.name;
      }
    }

    if (Object.keys(managers).length === 0) {
      console.warn('Группа пустая или не найдена, используем фоллбэк');
      return FALLBACK_MANAGERS;
    }

    // Сохраняем в JSON для дашборда
    await saveJson(MANAGERS_JSON, {
      _meta: { updated: new Date().toISOString(), groupId, count: Object.keys(managers).length },
      managers,
    });

    console.log(`Загружено ${Object.keys(managers).length} менеджеров из группы ${groupId}`);
    return managers;
  } catch (e) {
    console.error(`Ошибка загрузки менеджеров: ${e.message}`);
    return FALLBACK_MANAGERS;
  }
}

/**
 * Загружает менеджеров из кешированного JSON (без API вызова)
 */
export async function loadManagersFromCache() {
  try {
    const raw = await readFile(MANAGERS_JSON, 'utf-8');
    const data = JSON.parse(raw);
    return data.managers || FALLBACK_MANAGERS;
  } catch {
    return FALLBACK_MANAGERS;
  }
}

/**
 * Возвращает хардкод (для совместимости)
 */
export function getManagersFallback() {
  return { ...FALLBACK_MANAGERS };
}

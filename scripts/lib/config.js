/**
 * Центральный конфиг — все константы AMO CRM, этапов, полей
 * Аналог TASKS_CFG + RATING_CFG из GAS скриптов
 */

export const AMO = {
  API_BASE: 'https://tumanovgroup.amocrm.ru/api/v4',
  TOKEN: process.env.AMO_TOKEN || '', // Set via environment variable or GitHub Secret
  PIPE_ID: 9696654,
  PER_PAGE: 250,
  SLEEP_MS: 100,
  MAX_RETRIES: 6,
};

export const STAGES = {
  FREE_LEAD: 77303670,        // Свободный лид
  TAKEN_TO_WORK: 77303674,    // Взят в работу
  MQL: 77303798,               // MQL
  SQL: 77303802,               // SQL / Потребности выявлены
  MEETING_SCHEDULED: 77303806, // Встреча назначена
  MEETING_DONE: 77303810,      // Встреча проведена
  AFTER_MEETING: 80517310,     // Прогрев после встречи / Подбор
  CONSENT: 77303814,           // Согласие на бронь
  BOOKING_PAID: 77303818,      // Бронь оплачена
  DEPOSIT_PAID: 77303822,      // ПВ оплачен
  CUSTOM_1: 80369762,          // Доп. этап 1
  CUSTOM_2: 80517310,          // Доп. этап 2
  MOVED_FROM_CLOSED: 80681250, // Перемещён с закрытого
  WON: 142,                    // Закрыто и реализовано
  LOST: 143,                   // Закрыто и нереализовано
};

// Этапы воронки в порядке следования (для T1, T2, T3 и т.д.)
export const PIPELINE_STAGES = [
  STAGES.TAKEN_TO_WORK,
  STAGES.MQL,
  STAGES.SQL,
  STAGES.MEETING_SCHEDULED,
  STAGES.MEETING_DONE,
  STAGES.AFTER_MEETING,
  STAGES.CONSENT,
  STAGES.BOOKING_PAID,
  STAGES.DEPOSIT_PAID,
];

// Этапы для BT (задачи брокеров)
export const BT_STAGES = [
  STAGES.MQL, STAGES.CUSTOM_1, STAGES.SQL, STAGES.MEETING_SCHEDULED,
  STAGES.MEETING_DONE, STAGES.CUSTOM_2, STAGES.CONSENT, STAGES.BOOKING_PAID,
  STAGES.DEPOSIT_PAID,
];

// Этапы для расчёта BURNPCT
export const BURNPCT_STAGES = [
  STAGES.MQL, STAGES.SQL, STAGES.MEETING_SCHEDULED, STAGES.MEETING_DONE,
  STAGES.CONSENT, STAGES.BOOKING_PAID, STAGES.DEPOSIT_PAID,
  STAGES.CUSTOM_1, STAGES.CUSTOM_2, STAGES.LOST,
];

export const FIELDS = {
  LANGUAGE: 1629824,           // Поле "Язык"
  LANGUAGE_RU: 7517882,        // Русский
  LANGUAGE_EN: 7517884,        // Английский
  ALL_LANGS_FROM: new Date('2026-04-07T00:00:00+07:00'),

  FILTER_FIELD: 1629824,
  FILTER_ENUM: 7517882,

  REJECT_FIELD: 1617988,       // Причина отказа 1 круг
  REJECT_ENUMS: [7450812, 7450816, 7450818, 7540559, 7555827, 7548773, 7579035],

  CIRCLE_K2: 1630857,
  CIRCLE_K3: 1630859,
  CIRCLE_K4: 1631871,
};

export const CIRCLES = {
  COSTS: { 1: 100, 2: 25, 3: 5, 4: 1 },
};

export const TELEGRAM = {
  BOT_TOKEN: process.env.TG_BOT_TOKEN || '',
  CHAT_ID: process.env.TG_CHAT_ID || '-1003621204659',
  CHAT_ID_2: process.env.TG_CHAT_ID_2 || '-1002213318350',
};

// Исключения и переназначения
export const EXCLUDE_LEADS = {
  GLOBAL: ['28672345', '29534441', '29523291', '29416203'],
  BY_MANAGER: { '12174494': ['28926161', '27607485'] },
  REASSIGN: {
    '29691429': '11778278',
    '29691873': '11778278',
    '29697241': '10715622',
    '29697247': '10715622',
  },
};

// Таблица продаж (Google Sheets)
export const SALES_SHEET = {
  SPREADSHEET_ID: '1S5yUKgOpKGEOHxmYpV0UU7L0UoPE6rNr1BzI-1ekmhw',
  SHEET_NAME: 'Ответы на форму (1)',
  DATA_START_ROW: 3,
  COL_DATE: 'B',
  COL_BROKER: 'C',
  COL_REVENUE: 'R',
  COL_MARGIN: 87,  // column index
};

// Phuket timezone offset
// Группа брокеров в AMO
export const BROKER_GROUP_ID = 529606;
// ID "Свободный лид" — исключать из списка менеджеров
export const FREE_LEAD_USER_ID = '12956222';

export const PHUKET_OFFSET_HOURS = 7;
export const PHUKET_OFFSET_SEC = 7 * 3600;

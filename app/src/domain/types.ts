/* Типы предметной области.

   Раньше они жили в data/nightscout.ts — в адаптере одного конкретного источника.
   Стрелка зависимостей смотрела не туда: расчёт доз брал типы у транспорта, и любая
   логика оказывалась привязана к Nightscout. Появится прямое чтение по BLE или другой
   сервис — типы останутся теми же, менять придётся только адаптер.

   Здесь только то, что описывает диабет: измерение, устройство, событие лечения,
   профиль. Всё про протокол Nightscout (NsConfig, CloudProbe, ReadAccess) осталось
   в адаптере — там ему и место. */

export interface Entry { t: number; mgdl: number; mmol: number; dir: string }

export interface Device {
  iob: number | null; cob: number | null; reservoir: number | null;
  pumpBattery: number | null; status: string | null; baseBasal: number | null;
  tempRate: number | null; tempRemaining: number | null; lastBolus: number | null;
  uploaderBattery: number | null; loop: boolean; pump: boolean; at: number | null;
  /* Когда цикл в последний раз считал. Это НЕ то же, что at: помпа отчитывается
     сама по себе и чаще, а активный инсулин и активные углеводы существуют только
     в расчёте цикла. Без этого времени нельзя отличить «инсулина нет» от «неизвестно,
     сколько инсулина» — а на медицинском экране это разные вещи. */
  loopAt: number | null;
  // AAPS extended (кастомные поля этого пользователя): заряд OrangeLink/RileyLink и
  // авторитетный флаг паузы помпы. Отсутствие ключа = неизвестно (не 0%/false).
  mountBattery: number | null; suspended: boolean | null;
}

export interface BasalStep { h: number; v: number }

export interface Profile {
  name: string; ic: number | null; isf: number | null; basal: number | null;
  targetLow: number | null; targetHigh: number | null; dia: number | null; units?: string;
  // всё расписание, а не только текущая скорость: редактору профиля нужны сутки целиком
  basalSchedule: BasalStep[];
  /* Часовой пояс, в котором ЗАПИСАН профиль, — это время помпы. Расписание базала
     размечено по нему, и значения человек вводит на самой помпе, глядя на её часы.
     Показывать эти интервалы по времени телефона нельзя: в поездке он правил бы
     не тот интервал. */
  timezone?: string;
}

export interface Treatment { t: number; type: string; carbs: number | null; insulin: number | null; rate: number | null; duration: number | null }

export interface DevPoint { t: number; reservoir: number | null; pumpBattery: number | null; uploaderBattery: number | null; }

export interface NsData { entries: Entry[]; device: Device | null; profile: Profile | null; treatments: Treatment[] }

/* Перевод ммоль/л ↔ мг/дл. Число одно и то же в трёх местах жило по-разному: 18.0
   в адаптере, 18.0 в расчёте GMI и 18 в единицах. Физическая константа не может
   иметь трёх источников: разойдутся — и GMI перестанет сходиться с показанным
   средним, а понять почему будет трудно. */
export const MGDL_PER_MMOL = 18.0;

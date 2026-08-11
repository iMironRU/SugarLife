import type { Param, SettingsSpec } from '@/sources/bridge';
import { pumpNeedsBridge, type Pump } from '@/domain/catalog';

/* Спеки параметров драйверов — временно у нас, пока их не отдаёт ядро.

   По контракту спека приезжает в снимке (`DeviceInfo.settings`, `DriverDescriptor.settings`)
   и рисуется универсальной формой (ui/ParamsForm.tsx). Но нативного моста в браузере нет,
   а настроить помпу человеку нужно уже сейчас — поэтому известные спеки держим здесь.

   Ровно так же мы держим у себя состояние реестра до его появления в контракте
   (settings/deviceConfig.ts). Правило одно: словарь совпадает с ядром заранее, чтобы при
   переходе ничего не переписывать. Данные ниже — не догадки, а ответ ядра (SugarLifeCore#4).

   Когда спеки поедут из снимка, уйдут ТОЛЬКО сами спеки ниже; missingParams останется —
   он про SettingsSpec вообще, а не про наш временный список.

   Отдельно стоит запомнить, чего здесь НЕТ и почему:
   • У мостов OrangeLink / RileyLink / EmaLink и у Libre-мостов (MiaoMiao, Bubble, Atom)
     пользовательских параметров нет вовсе — это транспорт. Серийник и частота 868/916
     принадлежат драйверу помпы за мостом, а не самому мосту.
   • Порог разрядки моста и вибрация — настройка приложения, а не железа: она наша,
     через контракт не ходит. */

/* Радио-Medtronic (Paradigm/Veo/5xx/7xx). Спека дословно из ответа ядра: серийник
   обязателен, регион — 868 или 916, по умолчанию 868. */
const MEDTRONIC_RF: SettingsSpec = {
  parameters: [
    { key: 'serial', title: 'Серийный номер помпы', type: 'Text', required: true, default: null, options: [] },
    { key: 'region', title: 'Регион / частота, МГц', type: 'Enum', required: true, default: '868', options: ['868', '916'] },
  ],
};

/* Ключ спеки — не id модели, а признак семейства: моделей радио-Medtronic в справочнике
   десяток (Paradigm 512/712, 515/715, 522/722, Revel, Veo, MiniMed 5xx), а драйвер и его
   параметры у них одни. Признак берём тот же, которым уже определяем нужду в мосте, —
   иначе появилось бы два независимых списка моделей, и они бы разошлись. */
export function pumpSpec(pump: Pump | null): SettingsSpec | null {
  return pumpNeedsBridge(pump) ? MEDTRONIC_RF : null;
}


/* --- Общее по спекам (остаётся и после перехода на снимок) --- */

const заполнено = (p: Param, v: string | undefined) =>
  p.type === 'Bool' ? true : (v ?? p.default ?? '') !== '';

/** Каких обязательных параметров ещё не хватает. Пусто — спека закрыта. */
export function missingParams(spec: SettingsSpec | null | undefined, values: Record<string, string>): Param[] {
  return (spec?.parameters ?? []).filter((p) => p.required && !заполнено(p, values[p.key]));
}

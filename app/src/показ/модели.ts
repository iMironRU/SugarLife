import { useSnapshot } from '@/sources/bridge';
import { useDeviceConfig } from '@/settings/deviceConfig';
import { выбраннаяМодель } from '@/domain/реестр';

/* Выбранные модели — одной строкой на каждом экране (#224, шаг 4).

   Правило «сначала движок, потом локальный выбор» живёт в домене (domain/реестр.ts), а
   здесь только удобство: экрану нужны две подписки — на снимок и на конфиг, — и
   повторять их шесть раз значит однажды забыть одну и получить экран, который не
   обновился после выбора модели.

   Возвращаем id, а не имена: имя модели каждый экран берёт из справочника по-своему
   (у помпы `model`, у сенсора `name`), и подменять его здесь значило бы решать за них. */
export interface Модели { pumpId: string | null; sensorId: string | null }

export function useМодели(): Модели {
  const cfg = useDeviceConfig();
  const snap = useSnapshot();
  return {
    pumpId: выбраннаяМодель('pump', cfg, snap),
    sensorId: выбраннаяМодель('sensor', cfg, snap),
  };
}

import CatalogPicker from '@/sheets/CatalogPicker';
import { modelItems, bridgeItems, insulinItems } from '@/sheets/modelItems';
import DeviceScanSheet from '@/sheets/DeviceScanSheet';
import SmbgSheet from '@/sheets/SmbgSheet';
import { setDeviceConfig } from '@/settings/deviceConfig';
import { BATTERY_KINDS, type BatteryKind } from '@/domain/battery';
import { имяВыбораМодели, своёЖелезо } from './поКатегории';
import type { DeviceCatKey } from '@/sections/DeviceSection';

/*
 * ЧТО НА ЭТОЙ КАРТОЧКЕ ВЫБИРАЮТ (#406).
 *
 * Все листы выбора одним местом: модель, инсулин, батарейка, мост, показания глюкометра, поиск в
 * эфире. Порознь они жили хвостом карточки на четыре прибора, и «какие выборы бывают у помпы»
 * приходилось собирать глазами по всему файлу.
 *
 * Своё по категориям видно прямо здесь: инсулин и батарейка — только у помпы, поиск — только у
 * того, что мы читаем сами, мост — где он вообще бывает.
 */
export default function Выборы({
  cat, title, что, закрыть,
  модельПрибора, выбратьМодель, естьМодель,
  мосты, мостId, выбратьМост,
  инсулинId, батарейка,
  глюкометрОткрыт, закрытьГлюкометр,
  поискОткрыт, закрытьПоиск,
}: {
  cat: DeviceCatKey;
  title: string;
  /** Какой лист открыт сейчас; `null` — ни одного. */
  что: null | 'model' | 'bridge' | 'insulin' | 'battery';
  закрыть: () => void;
  модельПрибора: string | null;
  выбратьМодель: (id: string) => void;
  естьМодель: boolean;
  мосты: boolean;
  мостId: string | null;
  выбратьМост: (id: string) => void;
  инсулинId: string | null;
  батарейка: BatteryKind | null;
  глюкометрОткрыт: boolean;
  закрытьГлюкометр: () => void;
  поискОткрыт: boolean;
  закрытьПоиск: () => void;
}) {
  return (
    <>
      {естьМодель && (
        <CatalogPicker
          isOpen={что === 'model'} onClose={закрыть}
          title={имяВыбораМодели(cat)} subtitle="Справочник моделей"
          items={своёЖелезо(cat) ? modelItems(cat) : []} selectedId={модельПрибора}
          onSelect={выбратьМодель} currentLabel="только актуальные"
        />
      )}
      {cat === 'pump' && (
        <CatalogPicker
          isOpen={что === 'insulin'} onClose={закрыть}
          title="Выбор инсулина" subtitle="Быстрый инсулин для помпы"
          items={insulinItems} selectedId={инсулинId}
          onSelect={(id) => setDeviceConfig({ fastInsulinId: id })}
          currentLabel="только актуальные быстрые"
        />
      )}
      {cat === 'pump' && (
        <CatalogPicker
          isOpen={что === 'battery'} onClose={закрыть}
          title="Батарейка помпы" subtitle="От химии зависит, что значит процент заряда"
          items={BATTERY_KINDS.map((b) => ({ id: b.id, title: b.name, subtitle: b.note, current: true }))}
          selectedId={батарейка}
          onSelect={(id) => setDeviceConfig({ pumpBatteryKind: id as BatteryKind })}
        />
      )}
      {мосты && (
        <CatalogPicker
          isOpen={что === 'bridge'} onClose={закрыть}
          title="Выбор моста" subtitle="Трансмиттер / радио-мост"
          items={bridgeItems} selectedId={мостId}
          onSelect={выбратьМост} currentLabel="только актуальные"
        />
      )}
      <SmbgSheet isOpen={глюкометрОткрыт} onClose={закрытьГлюкометр} />
      {своёЖелезо(cat) && (
        <DeviceScanSheet isOpen={поискОткрыт} onClose={закрытьПоиск} kind={cat} title={title} />
      )}
    </>
  );
}

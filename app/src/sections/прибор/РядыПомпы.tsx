import { water, batteryHalfOutline, pulseOutline } from 'ionicons/icons';
import Row from '@/ui/Row';

/* Строки, которые есть только у помпы (#406).

   Инсулин — потому что в помпе он один и идёт и на базал, и на болюс. Батарейка —
   потому что процент заряда без типа химии не отвечает на вопрос «успею ли до утра»
   (domain/battery.ts). Базальный профиль — потому что это единственное место, где он
   виден суммой за сутки.

   У сенсора и глюкометра ничего этого нет, и раньше каждая строка несла собственную
   проверку `cat === 'pump'`. Проверка осталась одна — на весь блок. */
export default function РядыПомпы({ insulin, батарейка, базалВСутки, onИнсулин, onБатарейка, onБазал }: {
  insulin: { name: string } | null | undefined;
  батарейка: string | null | undefined;
  базалВСутки: number | null | undefined;
  onИнсулин: () => void;
  onБатарейка: () => void;
  onБазал: () => void;
}) {
  return (
    <>
      <Row icon={water} title="Инсулин" value={insulin ? insulin.name : 'выбрать'}
        valueMuted={!insulin} onClick={onИнсулин} />
      <Row icon={batteryHalfOutline} title="Батарейка"
        value={батарейка ?? 'выбрать'} valueMuted={!батарейка} onClick={onБатарейка} />
      <Row icon={pulseOutline} title="Базальный профиль"
        value={базалВСутки != null ? базалВСутки.toFixed(2) + ' ЕД/сут' : 'нет данных'}
        valueMuted={базалВСутки == null} onClick={onБазал} />
    </>
  );
}

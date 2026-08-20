import type { Age } from '@/domain/treatmentStats';
import type { Consumable } from '@/settings/changes';
import ChangedButton from '@/ui/ChangedButton';
import { ageText } from './поКатегории';

/* «Сейчас на устройстве» и «Расходники» — два блока, которые есть у каждого прибора,
   но наполняются по-разному (#406).

   Вынесены из DeviceSection не ради длины файла, а ради границы: сюда приходит уже
   посчитанное, и никакого «а если помпа» здесь нет вовсе. Что показывать — решено до
   входа сюда, здесь только раскладка. */

export function СейчасНаУстройстве({ строки }: { строки: { k: string; v: string }[] }) {
  if (!строки.length) return null;
  return (
    <>
      <div className="section-label sec">Сейчас на устройстве</div>
      <div className="basal-rows">
        {строки.map((r) => (
          <div key={r.k} className="basal-row"><span>{r.k}</span><b>{r.v}</b></div>
        ))}
      </div>
    </>
  );
}

export function Расходники({ список }: { список: [string, Age, Consumable][] }) {
  if (!список.length) return null;
  return (
    <>
      <div className="section-label sec">Расходники</div>
      <div className="sensor-ages sensor-ages-solo">
        {список.map(([имя, возраст, ключ]) => (
          <div key={имя} className="age-pill">
            <span>{имя}</span>
            <b>{ageText(возраст)}</b>
            <ChangedButton what={ключ} />
          </div>
        ))}
      </div>
      {/* Возраст считается по чужим событиям, и их может не быть вовсе — говорим об этом
          сразу, иначе молчаливый ноль читается как «заменено только что». */}
      <div className="sheet-note">
        Возраст считается по событиям из Nightscout, а их может не быть: замена,
        не залогированная в AAPS, не оставляет следа вовсе. Поменял — отметь здесь,
        это никуда не отправляется и живёт только на этом устройстве.
      </div>
    </>
  );
}

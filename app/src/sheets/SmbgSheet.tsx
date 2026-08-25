
import Иконка from '@/ui/Иконка';
import Поле from '@/ui/Поле';
import {waterOutline} from 'ionicons/icons';
import { useState } from 'react';
import { addSmbg, SMBG_REASONS, type Smbg } from '@/settings/smbg';
import { getUnit, unitLabel } from '@/domain/units';
import { MGDL_PER_MMOL } from '@/domain/types';
import Sheet from '@/ui/Sheet';
import { sendIntent } from '@/sources/bridge';

/* Ввод показания глюкометра.

   Единицы — те же, в которых человек смотрит на всё остальное: заставлять его
   пересчитывать в голове ммоль в мг/дл ровно там, где он проверяет, не врёт ли
   сенсор, — верный способ получить ошибку в десять раз.

   Хранится это отдельно от истории сенсора и туда не подмешивается: показание с
   пальца отвечает на вопрос «сенсор не врёт?», а подмешанное в ленту сенсора оно
   этот вопрос уничтожает (см. settings/smbg.ts). */

const ПРЕДЕЛ_ММОЛЬ = { min: 1.1, max: 33.3 }; // за этими границами глюкометры не читают

export default function SmbgSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [текст, setТекст] = useState('');
  const [reason, setReason] = useState<Smbg['reason']>('calibration');
  const u = getUnit();

  const число = Number(текст.replace(',', '.'));
  const mmol = Number.isFinite(число) && число > 0
    ? (u === 'mgdl' ? число / MGDL_PER_MMOL : число)
    : null;
  const годно = mmol != null && mmol >= ПРЕДЕЛ_ММОЛЬ.min && mmol <= ПРЕДЕЛ_ММОЛЬ.max;
  // «слишком мало/много» показываем только когда что-то ввели: пустое поле не ошибка
  const ошибка = текст.trim() !== '' && !годно;

  const закрыть = () => { setТекст(''); onClose(); };

  /* ЗАМЕР УХОДИТ ДВИЖКУ, А НЕ ТОЛЬКО К НАМ В ХРАНИЛИЩЕ (#547, SugarLifeCore#127).

     Экран ввода был, движок интент принимал — а не соединял их никто: половина калибровочной
     истории не достраивалась, и заметно это стало бы ровно тогда, когда человек решит проверить
     сенсор глюкометром и не увидит поправки.

     `note` — зачем мерили: по этой пометке движок отделяет замеры с пальца от ленты сенсора.
     Считать их в статистике диапазона нельзя — они редки и делаются в особые моменты, а среднее по
     ним говорило бы о привычках человека мерить, а не о его сахаре.

     Локальную запись пока оставляем: на неё смотрят экраны сверки «сенсор не врёт». Уберём, когда
     они переедут на историю движка (там замеры лежат с `kind: Meter`). */
  const сохранить = () => {
    if (!годно || mmol == null) return;
    addSmbg(mmol, reason);
    const когда = Date.now();
    void sendIntent({
      type: 'logGlucose',
      id: 'smbg-' + когда,
      atMs: когда,
      mmol,
      note: reason ?? null,
    });
    закрыть();
  };

  return (
    <Sheet isOpen={isOpen} onClose={закрыть} title="Показание глюкометра" subtitle="С пальца, сейчас">

        <div className="field-label">Значение, {unitLabel(u)}</div>
        <div className="field">
          <Иконка icon={waterOutline} className="field-ico" />
          {/* Тип text, а не number, намеренно. Числовое поле молча съедает запятую —
              а мы весь сахар показываем именно с запятой («6,5»), и человек её и
              наберёт. Поле оказывалось пустым без единого объяснения. Клавиатуру
              всё равно получаем числовую, через inputmode. */}
          <Поле
            value={текст}
            type="text"
            inputmode="decimal"
            placeholder={u === 'mgdl' ? '120' : '6,5'}
            onInput={(v: string) => setТекст(v)}
          />
        </div>
        {ошибка && (
          <div className="field-hint">
            Глюкометры читают от {u === 'mgdl' ? '20' : '1,1'} до {u === 'mgdl' ? '600' : '33,3'} {unitLabel(u)} —
            проверь, не опечатка ли.
          </div>
        )}

        <div className="field-label" style={{ marginTop: 14 }}>Зачем мерили</div>
        <div className="list">
          {SMBG_REASONS.map((r) => (
            <button key={r.id} className="list-row"
              onClick={() => setReason(r.id)}>
              <span className="pick-main"><span className="list-title">{r.name}</span></span>
              {reason === r.id && <span className="meth-now">выбрано</span>}
            </button>
          ))}
        </div>

        <div className="sheet-note">
          Останется в приложении и не попадёт в ленту сенсора: показание с пальца точнее
          по крови, но реже по времени, и в расчётах диапазона его вес был бы неправильным.
        </div>

        <button className="food-save" disabled={!годно} onClick={сохранить}>Сохранить</button>
    </Sheet>
  );
}

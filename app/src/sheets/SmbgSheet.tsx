import { IonModal, IonContent, IonIcon, IonInput } from '@ionic/react';
import { closeOutline, waterOutline } from 'ionicons/icons';
import { useState } from 'react';
import { addSmbg, SMBG_REASONS, type Smbg } from '@/settings/smbg';
import { getUnit, unitLabel } from '@/domain/units';
import { MGDL_PER_MMOL } from '@/domain/types';

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
  const сохранить = () => { if (годно && mmol != null) { addSmbg(mmol, reason); закрыть(); } };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={закрыть} className="sheet-modal">
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Показание глюкометра</div>
            <div className="sheet-subtitle">С пальца, сейчас</div>
          </div>
          <button className="sheet-close" onClick={закрыть} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        <div className="field-label">Значение, {unitLabel(u)}</div>
        <div className="field">
          <IonIcon icon={waterOutline} className="field-ico" />
          {/* Тип text, а не number, намеренно. Числовое поле молча съедает запятую —
              а мы весь сахар показываем именно с запятой («6,5»), и человек её и
              наберёт. Поле оказывалось пустым без единого объяснения. Клавиатуру
              всё равно получаем числовую, через inputmode. */}
          <IonInput
            value={текст}
            type="text"
            inputmode="decimal"
            placeholder={u === 'mgdl' ? '120' : '6,5'}
            onIonInput={(e) => setТекст(e.detail.value ?? '')}
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
      </IonContent>
    </IonModal>
  );
}

import { useState } from 'react';
import Поле from '@/ui/Поле';

import Иконка from '@/ui/Иконка';
import { checkmarkCircle } from 'ionicons/icons';
import Sheet from '@/ui/Sheet';
import { sendIntent } from '@/sources/bridge';

/* Запись длинного инсулина (SugarLife#287).

   Путь для тех, кто на ручках и шприцах: у них базал — тоже инсулин, просто вводится раз
   в сутки, и никакая помпа о нём не расскажет. Не записав, человек не увидит его нигде.

   ПИШЕМ ЧЕРЕЗ ДВИЖОК, интентом `logInsulin` с признаком `long`. Своего хранения не
   заводим и никуда сами не отправляем: куда это уедет — Nightscout, файл, ничего —
   решает движок, и это его слой, а не наш.

   ВРЕМЯ ПО УМОЛЧАНИЮ — СЕЙЧАС, и менять его можно. Длинный колют по расписанию, но
   вспоминают о записи позже: «уколол в десять вечера, записал в одиннадцать» — обычный
   случай, и заставлять человека врать про время значит испортить единственные данные,
   ради которых экран и нужен. */
export default function LongInsulinSheet({ onClose }: { onClose: () => void }) {
  const [ед, setЕд] = useState('');
  const [время, setВремя] = useState(() => {
    const д = new Date();
    return `${String(д.getHours()).padStart(2, '0')}:${String(д.getMinutes()).padStart(2, '0')}`;
  });
  const [пишу, setПишу] = useState(false);

  const число = Number((ед || '').replace(',', '.'));
  const годно = Number.isFinite(число) && число > 0 && /^\d{1,2}:\d{2}$/.test(время);

  const записать = async () => {
    setПишу(true);
    const [ч, м] = время.split(':').map(Number);
    const когда = new Date();
    когда.setHours(ч, м, 0, 0);
    /* Ввели время из будущего — значит имели в виду вчера: в полночь человек записывает
       вечерний укол, и «22:10» у него о вчерашнем дне. */
    if (когда.getTime() > Date.now()) когда.setDate(когда.getDate() - 1);
    await sendIntent({
      type: 'logInsulin',
      id: `long-${когда.getTime()}`,
      atMs: когда.getTime(),
      units: число,
      long: true,
    });
    setПишу(false);
    onClose();
  };

  return (
    <Sheet isOpen onClose={onClose} title="Длинный инсулин" subtitle="базальный — тот, что колют раз в сутки">
      <div className="param">
        <div className="field-label">Сколько единиц<span className="param-req"> · обязательно</span></div>
        <div className="field">
          <Поле value={ед} onInput={(v: string) => setЕд(v)}
            inputmode="decimal" placeholder="например, 24" />
        </div>
      </div>

      <div className="param">
        <div className="field-label">Когда</div>
        <div className="field">
          <Поле value={время} onInput={(v: string) => setВремя(v)}
            inputmode="numeric" placeholder="22:10" />
        </div>
        <div className="field-hint param-hint">
          По умолчанию — сейчас. Записали позже, чем укололи, — поправьте время: считать
          будут по нему.
        </div>
      </div>

      <div className="sheet-note">
        Длинный не складывается с активным инсулином и никогда не встанет в круг: 24 ед
        базального рядом с 4 ед короткого — это не 28 «активных».
      </div>

      <button className="food-save" disabled={!годно || пишу} onClick={() => void записать()}
        style={{ marginTop: 14 }}>
        <Иконка icon={checkmarkCircle} style={{ marginRight: 6, verticalAlign: -2 }} />
        {пишу ? 'Записываю…' : 'Записать'}
      </button>
    </Sheet>
  );
}

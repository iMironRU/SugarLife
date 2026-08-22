import Иконка from './Иконка';
import { warningOutline, checkmarkCircle } from 'ionicons/icons';
import { sendIntent } from '@/sources/bridge';
import { спроситьМожно, кудаВНастройки, type Помеха } from '@/domain/scanReadiness';

/* «Что мешает найти приборы» — один блок на все три места (SugarLife#333).

   Мест ровно три, и это не прихоть: шагом мастера (до первого поиска), в списке приборов
   (вместо пустого эфира) и сводкой в диагностике (куда приходят разбираться позже). Три
   копии одного блока разошлись бы в первую же правку — мы это уже проходили с формой
   параметров и с поиском.

   Показываем ПРИЧИНУ и ДЕЙСТВИЕ, а не список красных крестиков: человеку нужно не знать,
   что у него не так, а починить это одним нажатием. */
export default function Готовность({ помеха, спокойно }: {
  помеха: Помеха;
  /* «Спокойно» — режим диагностики: там уместно сказать и что всё в порядке, потому что
     туда приходят именно за ответом. На рабочих экранах зелёная галочка — шум: она
     появляется в момент, когда человек ни о чём не спрашивал (#333). */
  спокойно?: boolean;
}) {
  if (!помеха) {
    if (!спокойно) return null;
    return (
      <div className="sheet-note">
        <Иконка icon={checkmarkCircle} style={{ marginRight: 6, verticalAlign: -2 }} />
        Поиск возможен: приложение видит эфир и жалоб на разрешения нет.
      </div>
    );
  }

  return (
    <div className="today-alert">
      <Иконка icon={warningOutline} className="alert-ico" />
      <div>
        <span className="alert-title">{помеха.reason ?? 'Поиск сейчас невозможен'}</span>
        {помеха.remediation && <span>{помеха.remediation}</span>}
        <span className="alert-ask alert-ask-row">
          {спроситьМожно(помеха) ? (
            <button className="changed-btn is-undo"
              onClick={() => void sendIntent({ type: 'requestScanPermissions' })}>Разрешить</button>
          ) : кудаВНастройки(помеха) ? (
            <button className="changed-btn is-undo"
              onClick={() => void sendIntent({ type: 'openSystemScreen', target: кудаВНастройки(помеха)! })}>
              Открыть настройки
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

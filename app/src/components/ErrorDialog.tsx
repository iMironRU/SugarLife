import { IonModal, IonContent, IonIcon } from '@ionic/react';
import { alertCircleOutline, refreshOutline, shareOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useSnapshot, sendIntent } from '../data/bridge';

/* Окно ошибки по RFC 9457 (контракт §2.8): показываем alert с полем problem — title + remediation
   («что делать»), «Повторить» при retryable, «Отправить» (sendReport средствами ОС). Код/стектрейс
   как основной текст не показываем — только человекочитаемое. */
export default function ErrorDialog() {
  const snap = useSnapshot();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const alert = (snap?.alerts ?? []).find((a) => a.problem);
  const problem = alert?.problem ?? null;
  const key = problem ? (problem.errorId ?? problem.code) : null;
  const isOpen = !!problem && key !== dismissedKey;

  const close = () => setDismissedKey(key);

  return (
    <IonModal isOpen={isOpen} onDidDismiss={close} initialBreakpoint={0.5} breakpoints={[0, 0.5, 0.75]} handle>
      <IonContent className="sheet">
        {problem && (
          <>
            <div className="sheet-head">
              <div className="err-head">
                <IonIcon icon={alertCircleOutline} className={'err-ico err-' + problem.severity.toLowerCase()} />
                <div>
                  <div className="sheet-title">{problem.title}</div>
                  {problem.detail && <div className="sheet-subtitle">{problem.detail}</div>}
                </div>
              </div>
            </div>

            <div className="err-remedy">{problem.remediation}</div>

            <div className="err-actions">
              {problem.retryable && (
                <button className="btn-secondary" onClick={close}>
                  <IonIcon icon={refreshOutline} /> Повторить
                </button>
              )}
              <button
                className="btn-primary"
                onClick={() => { void sendIntent({ type: 'sendReport', errorId: problem.errorId ?? '' }); close(); }}
              >
                <IonIcon icon={shareOutline} /> Отправить
              </button>
            </div>
            <button className="err-close" onClick={close}>Закрыть</button>
          </>
        )}
      </IonContent>
    </IonModal>
  );
}

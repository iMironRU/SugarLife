import { IonModal, IonContent, IonIcon, IonToggle } from '@ionic/react';
import { closeOutline, downloadOutline } from 'ionicons/icons';
import { useSnapshot, sendIntent } from '../data/bridge';

const LEVELS = ['Trace', 'Debug', 'Info', 'Warn', 'Error'] as const;

/* Настройки логирования (контракт §2.9): уровень, запись в файл / сырьё транспорта, экспорт средствами ОС.
   Лог в приложении не показываем — только выгрузка. Секреты уже скрыты ядром. */
export default function LoggingSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const snap = useSnapshot();
  const log = snap?.logging ?? null;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.7} breakpoints={[0, 0.7, 1]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Логирование</div>
            <div className="sheet-subtitle">Диагностический лог{log ? ` · хранится ${log.retentionHours} ч` : ''}</div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        {!log ? (
          <div className="scan-state"><span>Логирование доступно только в приложении (нативный мост).</span></div>
        ) : (
          <>
            <div className="field-label">Уровень</div>
            <div className="log-seg">
              {LEVELS.map((lv) => (
                <button
                  key={lv}
                  className={log.level === lv ? 'on' : ''}
                  onClick={() => void sendIntent({ type: 'setLogLevel', level: lv })}
                >{lv}</button>
              ))}
            </div>

            <div className="sync-toggle">
              <div>
                <div className="sync-toggle-title">Запись в файл</div>
                <div className="sync-toggle-sub">хранить лог для выгрузки</div>
              </div>
              <IonToggle
                checked={log.capturingFile}
                onIonChange={(e) => void sendIntent({ type: 'setLogCapture', file: e.detail.checked, raw: null })}
              />
            </div>
            <div className="sync-toggle">
              <div>
                <div className="sync-toggle-title">Сырьё транспорта</div>
                <div className="sync-toggle-sub">байты BLE для разбора протокола</div>
              </div>
              <IonToggle
                checked={log.capturingRaw}
                onIonChange={(e) => void sendIntent({ type: 'setLogCapture', file: null, raw: e.detail.checked })}
              />
            </div>

            <button className="btn-primary" style={{ width: '100%', marginTop: 18, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: 14, borderRadius: 12, border: 0, fontSize: 15, fontWeight: 600 }}
              onClick={() => void sendIntent({ type: 'exportLog' })}>
              <IonIcon icon={downloadOutline} /> Экспортировать лог
            </button>
          </>
        )}
      </IonContent>
    </IonModal>
  );
}

import { IonModal, IonContent, IonIcon } from '@ionic/react';
import { closeOutline, cloudUploadOutline, cloudDownloadOutline, saveOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { sendIntent } from '../data/bridge';

/* Бэкап конфига/истории в облако САМОГО пользователя (пережить переустановку). Провайдеры: S3-совместимые
   (Yandex Object Storage/Backblaze/R2/AWS/Selectel/MinIO — ключ+секрет) и WebDAV (Nightscout/ownCloud).
   Экран лишь шлёт интенты configureBackup/backup/restore; снимок собирает и кладёт движок. Секреты — на
   устройстве пользователя. */

type Provider = 's3' | 'webdav';
const CFG_KEY = 'sl-backup-cfg';

const FIELDS: Record<Provider, Array<{ k: string; label: string; secret?: boolean }>> = {
  s3: [
    { k: 'endpoint', label: 'Endpoint (напр. https://storage.yandexcloud.net)' },
    { k: 'region', label: 'Регион (напр. ru-central1)' },
    { k: 'bucket', label: 'Bucket' },
    { k: 'accessKey', label: 'Access Key' },
    { k: 'secretKey', label: 'Secret Key', secret: true },
  ],
  webdav: [
    { k: 'baseUrl', label: 'URL папки (напр. https://<host>/remote.php/dav/files/<user>/SugarLife)' },
    { k: 'username', label: 'Логин' },
    { k: 'password', label: 'Пароль приложения', secret: true },
  ],
};

export default function BackupSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [provider, setProvider] = useState<Provider>('s3');
  const [params, setParams] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) { const c = JSON.parse(raw); setProvider(c.provider ?? 's3'); setParams(c.params ?? {}); }
    } catch { /* пусто */ }
    setStatus('');
  }, [isOpen]);

  const set = (k: string, v: string) => setParams((p) => ({ ...p, [k]: v }));

  const saveCfg = () => {
    localStorage.setItem(CFG_KEY, JSON.stringify({ provider, params }));
    void sendIntent({ type: 'configureBackup', provider, params });
  };
  const doSave = () => { saveCfg(); setStatus('Настройки сохранены'); };
  const doBackup = () => { saveCfg(); void sendIntent({ type: 'backup' }); setStatus('Бэкап запущен — проверьте лог для результата'); };
  const doRestore = () => { saveCfg(); void sendIntent({ type: 'restore' }); setStatus('Восстановление запущено — проверьте лог'); };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.9} breakpoints={[0, 0.9, 1]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Бэкап в облако</div>
            <div className="sheet-subtitle">Данные переживут переустановку · облако ваше</div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        <div className="field-label">Провайдер</div>
        <div className="log-seg">
          <button className={provider === 's3' ? 'on' : ''} onClick={() => setProvider('s3')}>S3-совместимый</button>
          <button className={provider === 'webdav' ? 'on' : ''} onClick={() => setProvider('webdav')}>WebDAV</button>
        </div>
        <div className="sheet-subtitle" style={{ marginTop: 4 }}>
          {provider === 's3'
            ? 'Yandex Object Storage, Backblaze B2, Cloudflare R2, AWS, Selectel, MinIO'
            : 'Nextcloud / ownCloud (Яндекс.Диск через WebDAV не работает)'}
        </div>

        {FIELDS[provider].map((f) => (
          <div key={f.k} style={{ marginTop: 12 }}>
            <div className="field-label">{f.label}</div>
            <input
              className="text-input"
              style={{ width: '100%', padding: 12, borderRadius: 10, fontSize: 15 }}
              type={f.secret ? 'password' : 'text'}
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={params[f.k] ?? ''}
              onChange={(e) => set(f.k, e.target.value)}
            />
          </div>
        ))}

        <button className="btn-primary" style={btn} onClick={doSave}>
          <IonIcon icon={saveOutline} /> Сохранить настройки
        </button>
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button className="btn-primary" style={{ ...btn, marginTop: 0, flex: 1 }} onClick={doBackup}>
            <IonIcon icon={cloudUploadOutline} /> Создать бэкап
          </button>
          <button className="btn-primary" style={{ ...btn, marginTop: 0, flex: 1 }} onClick={doRestore}>
            <IonIcon icon={cloudDownloadOutline} /> Восстановить
          </button>
        </div>
        {status && <div className="sheet-subtitle" style={{ marginTop: 12, textAlign: 'center' }}>{status}</div>}
      </IonContent>
    </IonModal>
  );
}

const btn: React.CSSProperties = {
  width: '100%', marginTop: 18, justifyContent: 'center', display: 'flex', alignItems: 'center',
  gap: 8, padding: 14, borderRadius: 12, border: 0, fontSize: 15, fontWeight: 600,
};

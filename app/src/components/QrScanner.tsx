import { IonModal, IonContent, IonIcon } from '@ionic/react';
import { closeOutline, cameraOutline } from 'ionicons/icons';
import { useEffect, useRef, useState } from 'react';

/* Сканер QR кода сенсора (контракт §3): веб-камера (getUserMedia) + BarcodeDetector.
   Заполняет поле с scan:'qr'. Камера/QR — на стороне PWA; нативная оболочка даёт разрешение
   (NSCameraUsageDescription). Нет камеры/детектора/разрешения → понятный фоллбэк на ручной ввод. */
export default function QrScanner({ isOpen, onClose, onResult }: {
  isOpen: boolean; onClose: () => void; onResult: (text: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let stopped = false;
    let raf = 0;
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;

    const cleanup = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    const start = async () => {
      try {
        if (!Detector) { setError('Сканер QR не поддерживается на этом устройстве. Введите код с этикетки вручную.'); return; }
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        const detector = new Detector({ formats: ['qr_code'] });
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(v);
            if (codes && codes.length) { onResult(codes[0].rawValue.trim()); cleanup(); onClose(); return; }
          } catch { /* кадр без кода — продолжаем */ }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        const name = (e as { name?: string })?.name ?? 'ошибка';
        setError(`Камера недоступна (${name}). Введите код с этикетки вручную.`);
      }
    };

    setError(null);
    void start();
    return cleanup;
  }, [isOpen, onClose, onResult]);

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.9} breakpoints={[0, 0.9, 1]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Сканирование QR</div>
            <div className="sheet-subtitle">Наведите камеру на QR-код на упаковке сенсора</div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        {error ? (
          <div className="scan-state"><IonIcon icon={cameraOutline} /><span>{error}</span></div>
        ) : (
          <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: 16, overflow: 'hidden', background: '#000' }}>
            <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: '18%', border: '2px solid rgba(255,255,255,.85)', borderRadius: 12 }} />
          </div>
        )}
      </IonContent>
    </IonModal>
  );
}

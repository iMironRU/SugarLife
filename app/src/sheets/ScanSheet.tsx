import { useEffect, useRef, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { cameraOutline, imageOutline, copyOutline, checkmarkCircle, refreshOutline } from 'ionicons/icons';
import Sheet from '@/ui/Sheet';
import Row from '@/ui/Row';
import ScanOverlay from '@/ui/ScanOverlay';
import { сканировать, можноСканировать, ИМЯ_ТИПА, ОтказКамеры, type Прочитанное } from '@/platform/scanCode';
import { прочитатьИзображение } from '@/platform/scanFromImage';

/* Одна шторка на всё чтение кодов (SugarLife#350).

   Два способа и один результат. Способа два не для красоты: живой скан требует камеры,
   которой нет ни в PWA на компьютере, ни у того, кто проверяет за столом, — а фото
   работает везде и повторяемо. Снял коробку один раз и разбирай сколько нужно.

   РЕЗУЛЬТАТ ПОКАЗЫВАЕМ ВСЕГДА, даже когда есть куда его подставить. Прочитанное — это
   сырая строка носителя, и она бывает совсем не тем, что человек ожидал увидеть: на
   упаковке Sibionics код подключения лежит ВНУТРИ серийника. Подставить молча значит
   оставить его гадать, почему в поле не то, что напечатано на коробке.

   Кнопка «Скопировать» — не украшение: она нужна, когда результат пойдёт не в поле, а в
   переписку с нами, и это ровно то, ради чего чтение с фото и заводится. */
export default function ScanSheet({ isOpen, onClose, подпись, onВыбор }: {
  isOpen: boolean;
  onClose: () => void;
  /** Что ищем — словами, для человека. */
  подпись?: string;
  /** Есть куда подставить — покажем кнопку «Вставить». Нет — только показываем и копируем. */
  onВыбор?: (r: Прочитанное) => void;
}) {
  const [найдено, setНайдено] = useState<Прочитанное[] | null>(null);
  const [беда, setБеда] = useState<string | null>(null);
  const [занят, setЗанят] = useState(false);
  const [скопировано, setСкопировано] = useState<string | null>(null);
  const [камераЕсть, setКамераЕсть] = useState(false);
  const [сканИдёт, setСканИдёт] = useState<{ отменено: boolean } | null>(null);
  const файлВвод = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) { setНайдено(null); setБеда(null); setСкопировано(null); return; }
    void можноСканировать().then(setКамераЕсть);
  }, [isOpen]);

  const камерой = async () => {
    setБеда(null);
    const отмена = { отменено: false };
    setСканИдёт(отмена);
    try {
      const r = await сканировать(отмена);
      if (r) setНайдено([r]);
    } catch (e) {
      /* Отказ в доступе объясняем и сразу предлагаем обход: человек с коробкой в руках
         не должен упереться в тупик из-за разрешения, которое система больше не спросит. */
      setБеда(e instanceof ОтказКамеры
        ? e.message + (e.причина === 'нет-разрешения' ? ' Либо снимите код на фото — это работает без доступа к камере.' : '')
        : 'Не получилось открыть камеру.');
    } finally {
      setСканИдёт(null);
    }
  };

  const изФайла = async (файл: File) => {
    setБеда(null); setЗанят(true); setНайдено(null);
    try {
      const коды = await прочитатьИзображение(файл);
      if (!коды.length) {
        setБеда('На этом снимке кода не видно. Снимите ближе и ровнее — чтобы код занимал большую часть кадра и не бликовал.');
      } else {
        setНайдено(коды);
      }
    } catch (e) {
      setБеда('Не получилось разобрать снимок: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setЗанят(false);
    }
  };

  /* Копируем двумя способами, и это не перестраховка.

     Современный `navigator.clipboard` отказывает чаще, чем кажется: без https, при
     потерянном фокусе окна, по политике браузера — и отказ приходит исключением уже
     после нажатия. Старый `execCommand` этих условий не знает и работает там, где новый
     сдался. А ради чего кнопка и заводилась — переслать нам прочитанное, — важнее
     чистоты приёма.

     Не вышло ни так, ни так — говорим прямо: текст на экране выделяется, и честное «не
     смог» лучше кнопки, которая делает вид. */
  const скопировать = async (текст: string) => {
    try {
      await navigator.clipboard.writeText(текст);
      setСкопировано(текст); setБеда(null); return;
    } catch { /* пробуем по-старому */ }
    try {
      const поле = document.createElement('textarea');
      поле.value = текст;
      поле.style.position = 'fixed'; поле.style.opacity = '0';
      document.body.appendChild(поле);
      поле.select();
      const вышло = document.execCommand('copy');
      document.body.removeChild(поле);
      if (вышло) { setСкопировано(текст); setБеда(null); return; }
    } catch { /* ниже скажем честно */ }
    setСкопировано(null);
    setБеда('Скопировать не вышло — браузер не дал. Выделите строку выше и скопируйте вручную.');
  };

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title="Код с упаковки" subtitle={подпись ?? 'QR, DataMatrix или штрихкод'}>
      {сканИдёт && (
        <ScanOverlay подпись={подпись ?? 'Наведите на код с коробки'}
          onОтмена={() => { сканИдёт.отменено = true; }} />
      )}

      {!найдено && (
        <div className="list">
          {камераЕсть && (
            <Row icon={cameraOutline} title="Снять камерой" sub="наведите на код — прочитается сам"
              onClick={камерой} />
          )}
          {/* Фото — всегда: это единственный способ, который работает и в браузере. */}
          <Row icon={imageOutline} title="Выбрать фото"
            sub={занят ? 'разбираю снимок…' : 'снимок коробки — можно из галереи'}
            onClick={() => файлВвод.current?.click()} />
        </div>
      )}

      <input ref={файлВвод} type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void изФайла(f); }} />

      {найдено && (
        <>
          <div className="section-label sec">
            {найдено.length === 1 ? 'Прочитано' : `Прочитано кодов: ${найдено.length}`}
          </div>
          {/* Кодов на упаковке бывает несколько — на коробке Sibionics их два, — и какой
              из них нужен, знает не человек, а разборщик. Показываем все, не выбирая за
              него. */}
          {найдено.map((к, i) => (
            <div key={i} className="param">
              <div className="field-label">{ИМЯ_ТИПА[к.тип]}</div>
              <div className="скан-текст">{к.текст || '(пусто)'}</div>
              <div className="скан-кнопки">
                <button className="changed-btn is-undo" onClick={() => void скопировать(к.текст)}>
                  <IonIcon icon={скопировано === к.текст ? checkmarkCircle : copyOutline}
                    style={{ marginRight: 5, verticalAlign: -2 }} />
                  {скопировано === к.текст ? 'Скопировано' : 'Скопировать'}
                </button>
                {onВыбор && (
                  <button className="changed-btn is-undo" onClick={() => { onВыбор(к); onClose(); }}>
                    Вставить в поле
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="list" style={{ marginTop: 8 }}>
            <Row icon={refreshOutline} title="Прочитать ещё раз" onClick={() => { setНайдено(null); setБеда(null); }} />
          </div>
        </>
      )}

      {беда && <div className="metric-note" style={{ marginTop: 10 }}>{беда}</div>}
    </Sheet>
  );
}

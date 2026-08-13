import { IonIcon, IonInput } from '@ionic/react';
import {
  bodyOutline, heartOutline, flaskOutline, calendarOutline, checkmarkOutline, trashOutline,
} from 'ionicons/icons';
import { useRef, useState } from 'react';
import Section from '@/ui/Section';
import Row from '@/ui/Row';
import Sheet from '@/ui/Sheet';
import {
  useHealth, записатьЗдоровье, отметитьПроверку, забытьПроверку, type Здоровье,
} from '@/settings/health';
import { поВажности, месяцевНазад, type СостояниеПроверки } from '@/domain/screenings';

/* «Здоровье» — то, что знает человек, а не приложение (SugarLife#156).

   Вес, давление, HbA1c и даты плановых проверок нам взять неоткуда, а врач на приёме
   записывает именно их. Раздел существует ради записки к приёму, но полезен и сам по
   себе: по датам видно, что офтальмолог был четырнадцать месяцев назад при сроке в год.

   ГРАНИЦА, КОТОРУЮ ЗДЕСЬ НЕЛЬЗЯ ПЕРЕХОДИТЬ. Мы показываем календарь и цифры как есть.
   Ни «повышено», ни «пора к врачу» — единственный вывод, который мы себе позволяем,
   это срок из рекомендаций против даты. Всё остальное — работа врача, и подменять её
   приложением нельзя, даже когда очень хочется помочь. */

const СЛОВО: Record<СостояниеПроверки, string> = {
  'просрочено': 'пора', 'скоро': 'скоро', 'нет данных': 'нет даты',
  'в сроке': 'в сроке', 'ещё рано': 'ещё рано',
};

const дата = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
/** Дата — сегодняшняя? Сравниваем по календарному дню, а не по миллисекундам. */
const сегодняЛи = (t: number | null | undefined) =>
  t != null && new Date(t).toDateString() === new Date().toDateString();
const вводДаты = (t: number) => new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

export default function HealthSection({ onClose }: { onClose: () => void }) {
  const h = useHealth();
  const [что, setЧто] = useState<'вес' | 'hba1c' | 'давление' | null>(null);
  const [проверка, setПроверка] = useState<string | null>(null);
  /* Что показывать, пока шторка закрывается. Без этого при закрытии заголовок пустел
     на время анимации: выбор снят, а шторка ещё на экране — и человек видел пустую
     карточку вместо того, что только что отметил. */
  const последняя = useRef<string | null>(null);
  const сейчас = Date.now();
  const список = поВажности(h.проверки, сейчас, h.дебют);
  if (проверка) последняя.current = проверка;
  const выбранная = список.find((с) => с.проверка.id === (проверка ?? последняя.current)) ?? null;

  return (
    <Section title="Здоровье" subtitle="Профиль · Здоровье" onBack={onClose}>
      <div className="sheet-note">
        Это то, что приложение не видит само: вес, давление, анализы и даты обследований.
        Отсюда они попадут в записку к приёму — и здесь же видно, чему вышел срок.
      </div>

      <div className="section-label sec">Мои показатели</div>
      <div className="list">
        <Row icon={bodyOutline} title="Вес"
          sub={h.вес ? дата(h.вес.когда) : undefined}
          value={h.вес ? `${h.вес.значение} кг` : 'не указан'} valueMuted={!h.вес}
          onClick={() => setЧто('вес')} />
        <Row icon={heartOutline} title="Давление"
          sub={h.давление ? дата(h.давление.когда) : undefined}
          value={h.давление ? `${h.давление.верх}/${h.давление.низ}` : 'не указано'} valueMuted={!h.давление}
          onClick={() => setЧто('давление')} />
        <Row icon={flaskOutline} title="Гликированный гемоглобин"
          sub={h.hba1c ? дата(h.hba1c.когда) : undefined}
          value={h.hba1c ? `${h.hba1c.значение} %` : 'не указан'} valueMuted={!h.hba1c}
          onClick={() => setЧто('hba1c')} />
      </div>

      <div className="section-label sec">Плановые проверки</div>
      <div className="list">
        {список.map(({ проверка: п, когда, состояние: с }) => (
          <Row key={п.id} icon={calendarOutline} title={п.что}
            sub={когда
              /* «0 мес назад» читается как сбой счётчика. Для свежей отметки время не
                 нужно вовсе — важна дата. */
              ? [дата(когда), месяцевНазад(когда, сейчас) ? `${месяцевНазад(когда, сейчас)} мес назад` : null]
                  .filter(Boolean).join(' · ')
              : `по рекомендациям — раз в ${п.каждыеМес === 3 ? '3 месяца' : п.каждыеМес === 6 ? '6 месяцев' : 'год'}`}
            /* Красным — только то, чему действительно вышел срок. «Нет даты» и «ещё
               рано» тревоги не заслуживают: первое — пустота нашей базы, второе —
               прямое указание рекомендаций подождать. */
            value={СЛОВО[с]} className={с === 'просрочено' ? 'row-warn' : undefined}
            onClick={() => setПроверка(п.id)} />
        ))}
      </div>

      {/* Откуда сроки. Без ссылки на документ это выглядело бы как наше мнение о том,
          когда человеку сдавать анализы, — а это не наше дело и не наша компетенция. */}
      <div className="sheet-note">
        Сроки — из клинических рекомендаций «Сахарный диабет 1 типа у взрослых»
        (Российская ассоциация эндокринологов, одобрены Минздравом, редакция 2025).
        Приложение только сравнивает срок с датой; что делать — решает врач.
      </div>

      <ЗамерШторка что={что} onClose={() => setЧто(null)} h={h} />

      <Sheet isOpen={!!проверка} onClose={() => setПроверка(null)}
        title={выбранная?.проверка.что ?? ''} subtitle="Когда делали последний раз"
        footer={выбранная ? (
          <div className="page-foot">
            <div className="bas-act-col">
              {/* Кнопка, которая ничего не меняет, читается как сломанная. Если дата
                  уже сегодняшняя, «Сделал сегодня» именно такая — поэтому она
                  превращается в подтверждение и гаснет. */}
              <button className="page-btn bas-go" disabled={сегодняЛи(выбранная.когда)}
                onClick={() => { отметитьПроверку(выбранная.проверка.id, Date.now()); setПроверка(null); }}>
                <IonIcon icon={checkmarkOutline} />
                {сегодняЛи(выбранная.когда) ? ' Отмечено сегодня' : ' Сделал сегодня'}
              </button>
              {выбранная.когда && (
                <button className="page-btn"
                  onClick={() => { забытьПроверку(выбранная.проверка.id); setПроверка(null); }}>
                  <IonIcon icon={trashOutline} /> Убрать дату
                </button>
              )}
            </div>
          </div>
        ) : undefined}>
        {выбранная && (
          <>
            <div className="field-label" style={{ marginTop: 4 }}>Дата</div>
            <div className="field">
              <IonInput type="date" value={выбранная.когда ? вводДаты(выбранная.когда) : ''}
                onIonChange={(e) => {
                  const v = e.detail.value;
                  if (v) { отметитьПроверку(выбранная.проверка.id, new Date(v + 'T12:00:00').getTime()); }
                }} />
            </div>
            {/* Цитата — мелким и без выделения: это сноска про то, откуда взялся срок,
                а не главное на экране. Крупным жирным она перебивала и заголовок, и
                поле даты, ради которого шторку открыли. */}
            <div className="sheet-note">По рекомендациям: {выбранная.проверка.цитата}.</div>
          </>
        )}
      </Sheet>

    </Section>
  );
}

/* Ввод показателя. Одна шторка на три случая, потому что различаются они только
   подписью и числом полей: три почти одинаковых экрана разъехались бы, как разъезжались
   шторки до #161. */
function ЗамерШторка({ что, onClose, h }: {
  что: 'вес' | 'hba1c' | 'давление' | null; onClose: () => void; h: Здоровье;
}) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');

  /* Поле открывается с прошлым значением, а не пустым.

     Пустое поле стоило одного молчаливого «не работает»: человек открывал вес, ничего
     не менял, жал «Сохранить» — и мы закрывали шторку, не записав ничего. Прошлое
     значение и правится быстрее: вес меняется на килограмм, а не с нуля. */
  const прошлое = что === 'вес' ? h.вес : что === 'hba1c' ? h.hba1c : null;
  const ключ = что ?? 'нет';
  const [открыто, setОткрыто] = useState(ключ);
  if (открыто !== ключ) {
    setОткрыто(ключ);
    setA(что === 'давление' ? String(h.давление?.верх ?? '') : прошлое ? String(прошлое.значение) : '');
    setB(что === 'давление' ? String(h.давление?.низ ?? '') : '');
  }

  const закрыть = () => { setA(''); setB(''); onClose(); };
  const число = (s: string) => { const n = Number(s.replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };

  const сохранить = () => {
    const когда = Date.now();
    if (что === 'вес') { const v = число(a); if (v) записатьЗдоровье({ вес: { значение: v, когда } }); }
    if (что === 'hba1c') { const v = число(a); if (v) записатьЗдоровье({ hba1c: { значение: v, когда } }); }
    if (что === 'давление') {
      const верх = число(a); const низ = число(b);
      if (верх && низ) записатьЗдоровье({ давление: { верх, низ, когда } });
    }
    закрыть();
  };

  const заголовок = что === 'вес' ? 'Вес' : что === 'hba1c' ? 'Гликированный гемоглобин' : 'Давление';
  /* Сохранять нечего — кнопка гаснет. Молча закрыться в ответ на нажатие хуже, чем
     не дать нажать: в первом случае человек уверен, что записал. */
  const годно = что === 'давление' ? !!(число(a) && число(b)) : !!число(a);

  return (
    <Sheet isOpen={!!что} onClose={закрыть} title={заголовок} subtitle="Записываем с сегодняшней датой"
      footer={(
        <div className="page-foot">
          <button className="page-btn bas-go" disabled={!годно} onClick={сохранить}>Сохранить</button>
        </div>
      )}>
      {что === 'давление' ? (
        <>
          <div className="field-label">Верхнее и нижнее, мм рт. ст.</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <IonInput type="text" inputmode="numeric" placeholder="120" value={a}
                onIonInput={(e) => setA(e.detail.value ?? '')} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <IonInput type="text" inputmode="numeric" placeholder="80" value={b}
                onIonInput={(e) => setB(e.detail.value ?? '')} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="field-label">{что === 'вес' ? 'Килограммы' : 'Проценты'}</div>
          <div className="field">
            {/* Тип text и inputmode, а не number: числовое поле молча съедает запятую,
                а «7,2» человек наберёт именно так (та же причина, что в SmbgSheet). */}
            <IonInput type="text" inputmode="decimal" placeholder={что === 'вес' ? '72' : '7,2'}
              value={a} onIonInput={(e) => setA(e.detail.value ?? '')} />
          </div>
          {прошлое && <div className="field-hint">Записано {дата(прошлое.когда)}</div>}
        </>
      )}
    </Sheet>
  );
}

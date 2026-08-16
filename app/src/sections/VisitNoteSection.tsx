import { IonIcon, IonInput, IonToggle } from '@ionic/react';
import { checkmarkCircle, ellipseOutline, addOutline, helpCircleOutline } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import Section from '@/ui/Section';
import { useHistory, useTreatments } from '@/sources/db';
import { stats } from '@/domain/agp';
import { fmt, toUnits, unitLabel, useUnit } from '@/domain/units';
import { insulinDaily } from '@/domain/treatmentStats';
import { useAnalysis } from '@/domain/useAnalysis';
import { useHealth, записатьЗдоровье } from '@/settings/health';
import { поВажности, месяцевНазад } from '@/domain/screenings';
import { ЦЕЛИ, строкиНМГ, полнота, вопросыДляВрача, МИН_ДНЕЙ, МИН_ДОЛЯ, type НаборЦелей } from '@/domain/visitNote';
import Dynamics from '@/ui/Dynamics';
import { useVisitQuestions, переключитьВопрос, добавитьВопрос, убратьСвой, нужныЛиВопросы } from '@/settings/visitQuestions';
import Row from '@/ui/Row';

/* Отчёт к приёму (SugarLife#156).

   Третья вещь после метрик и разбора: метрики отвечают на «как у меня дела», разбор —
   на «что происходит», отчёт — на «что показать и о чём спросить через час в
   кабинете». Приём длится пятнадцать минут, и половина уходит на «покажите за две
   недели» и на вспоминание вопросов, которые вылетели у двери.

   ПОЧЕМУ ЭКРАН, А НЕ СРАЗУ PDF. Содержание важнее носителя, и проверяется оно только
   на живом приёме: что врач читает первым, что пропускает, чего не хватило. Файл
   добавим, когда станет понятно, что в нём должно быть, — иначе получится красиво
   свёрстанный не тот документ.

   ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ. Трактовок уровня «требуется коррекция базала»: у нас
   наблюдения, а не назначения. Оформления медицинского документа: отчёт готовит
   пациент, и выглядеть она должна именно так, иначе её однажды принесут вместо
   выписки. */

const ДЕНЬ = 86_400_000;
const пц = (v: number) => `${Math.round(v)} %`;

/* Раздел живёт и вкладкой внутри «Метрик» (SugarLife#255): своя шапка там не нужна —
   она стала бы второй под настоящей. */
export default function VisitNoteSection({ onClose, встроенный }: {
  onClose?: () => void; встроенный?: boolean;
}) {
  const h = useHealth();
  useUnit(); // перерисовка при смене единиц: сахар в отчёте — в тех же, что везде
  const вопросы = useVisitQuestions();
  const [своё, setСвоё] = useState('');
  const сейчас = Date.now();

  /* Две недели — основной блок: так устроен консенсус и так читает врач. Девяносто
     дней рядом отвечают на другой вопрос — «что изменилось с прошлого приёма»; их
     нельзя смешивать в одну колонку, иначе непонятно, к чему относится число. */
  const { entries: две } = useHistory(14 * ДЕНЬ, { minRefreshMs: 3600e3 });
  /* Девяносто дней несут двойную службу: сводку «с прошлого приёма» и предыдущие две
     недели для сравнения. Отдельное окно на 28 дней было бы третьим чтением базы за
     тем же самым. */
  const { entries: три } = useHistory(90 * ДЕНЬ, { minRefreshMs: 3600e3 });
  const лечение = useTreatments(14 * ДЕНЬ, { minRefreshMs: 3600e3 });
  const { analysis } = useAnalysis(14);

  const s14 = useMemo(() => stats(две), [две]);
  const s90 = useMemo(() => stats(три), [три]);
  const п = useMemo(() => полнота(две, сейчас - 14 * ДЕНЬ, сейчас), [две, сейчас]);
  const инсулин = useMemo(() => {
    const tb = лечение.filter((e) => e.type === 'Temp Basal');
    const bo = лечение.filter((e) => e.type !== 'Temp Basal' && (e.insulin ?? 0) > 0);
    return insulinDaily(tb, bo);
  }, [лечение]);

  const набор: НаборЦелей = h.цели ?? 'обычные';
  const цели = ЦЕЛИ[набор];
  const предложенные = вопросыДляВрача(analysis.insights);
  const просрочены = поВажности(h.проверки, сейчас, h.дебют)
    .filter((с) => с.состояние === 'просрочено' || с.состояние === 'скоро');

  const дата = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

  const тело = (
    <>
      <div className="sheet-note">
        Это подготовил пациент, а не медицинская организация: наблюдения приложения и
        вопросы человека. Не заключение и не выписка.
      </div>

      {/* Полнота — первым блоком, а не мелким шрифтом внизу. Отчёт по двум неделям с
          40 % пропусков и отчёт без пропусков — разные документы, и разницу врач должен
          видеть до того, как начнёт читать проценты (это же требует и стандарт). */}
      <div className="section-label sec">Период и полнота данных</div>
      <div className="basal-rows">
        <div className="basal-row">
          <span>Период</span><b>{дата(сейчас - 14 * ДЕНЬ)} — {дата(сейчас)}</b>
        </div>
        {/* «15 из 14» — не опечатка, а честная арифметика: окно в две недели задевает
            пятнадцать календарных дат. Поэтому сравниваем с порогом, а не делаем вид,
            что дней ровно четырнадцать. */}
        <div className="basal-row">
          <span>Дней с данными</span>
          <b className={п.дней >= МИН_ДНЕЙ ? undefined : 'val-warn'}>
            {п.дней} <small style={{ opacity: 0.6 }}>· нужно ≥ {МИН_ДНЕЙ}</small>
          </b>
        </div>
        <div className="basal-row">
          <span>Время с активным сенсором</span>
          <b className={п.доля >= МИН_ДОЛЯ ? undefined : 'val-warn'}>{пц(п.доля)}</b>
        </div>
      </div>
      {!п.хватает && (
        <div className="sheet-note warn">
          По стандарту для оценки нужно не меньше {МИН_ДНЕЙ} дней и {МИН_ДОЛЯ} % времени с
          активным сенсором. Здесь этого нет — цифры ниже стоит читать с поправкой на пропуски.
        </div>
      )}

      {/* Цели — рядом с числами, а не в настройках: без указания набора «TIR 62 %»
          значит противоположное в зависимости от того, чьи цели применяются. */}
      <div className="section-label sec">Сенсор за 14 дней</div>
      {s14 ? (
        <>
          <div className="basal-rows">
            {строкиНМГ(s14, цели).map((r) => (
              <div key={r.что} className="basal-row">
                <span>{r.что}</span>
                <b className={r.итог === 'мимо' ? 'val-warn' : undefined}>
                  {пц(r.значение)} <small style={{ opacity: 0.6 }}>· цель {r.цель}</small>
                </b>
              </div>
            ))}
            <div className="basal-row"><span>Средняя глюкоза</span>
              <b>{toUnits(s14.mean)} {unitLabel()}</b></div>
            <div className="basal-row"><span>GMI (расчётный HbA1c)</span><b>{fmt(s14.gmi)} %</b></div>
          </div>
          <button className="pick-toggle on" style={{ marginTop: 10 }}
            onClick={() => записатьЗдоровье({ цели: набор === 'обычные' ? 'мягкие' : 'обычные' })}>
            Цели: {цели.подпись}
          </button>
          <div className="sheet-note">
            В рекомендациях два набора целей, и какой ваш — знает врач. Нажмите, чтобы
            переключить; на сами цифры это не влияет, только на пометки «мимо».
          </div>
        </>
      ) : (
        <div className="sheet-note">За две недели показаний нет — показывать нечего.</div>
      )}

      {/* Динамика — то, чего нет ни в метриках, ни в разборе: ответ на вопрос «мои
          усилия что-то изменили?». Стоит сразу после цифр, потому что читается вместе
          с ними, и до вопросов врачу: половина вопросов рождается именно здесь.

          Тот же блок живёт в разборе (#195), поэтому он общий: разъезжаются не
          формулы, разъезжаются пороги и формулировки. */}
      <div className="section-label sec">Что изменилось за две недели</div>
      <Dynamics entries={три} дней={14} кому="врачу" сейчас={сейчас} />

      <div className="section-label sec">Инсулин за 14 дней</div>
      <div className="basal-rows">
        <div className="basal-row"><span>Суточная доза</span>
          <b>{инсулин.tddPerDay ? `${fmt(инсулин.tddPerDay)} ед/сут` : 'нет данных'}</b></div>
        <div className="basal-row"><span>Базал / болюс</span>
          <b>{инсулин.tddPerDay
            ? `${fmt(инсулин.basalPerDay)} / ${fmt(инсулин.bolusPerDay)} ед`
            : 'нет данных'}</b></div>
        {/* Сколько дней базал вообще был виден. Суточная доза считается ТОЛЬКО по
            дням с полным покрытием (domain/treatmentStats.ts), и «по одному дню из
            семи» — это не придирка, а предупреждение: одна цифра здесь может быть
            случайной. Врач должен видеть, из чего она сложена. */}
        {инсулин.totalDays > 0 && инсулин.coveredDays < инсулин.totalDays && (
          <div className="basal-row"><span>Базал посчитан по</span>
            <b className="val-warn">{инсулин.coveredDays} из {инсулин.totalDays} дней</b></div>
        )}
      </div>

      {/* Девяносто дней — не «то же самое подробнее», а ответ на другой вопрос: что
          изменилось с прошлого приёма. Приём раз в три месяца, окно ровно об этом. */}
      <div className="section-label sec">С прошлого приёма (90 дней)</div>
      <div className="basal-rows">
        <div className="basal-row"><span>Время в диапазоне</span>
          <b>{s90 ? пц(s90.target) : 'нет данных'}</b></div>
        <div className="basal-row"><span>Средняя глюкоза</span>
          <b>{s90 ? `${toUnits(s90.mean)} ${unitLabel()}` : 'нет данных'}</b></div>
        <div className="basal-row"><span>Последний HbA1c</span>
          <b>{h.hba1c ? `${h.hba1c.значение} % · ${месяцевНазад(h.hba1c.когда, сейчас)} мес назад` : 'не записан'}</b></div>
      </div>

      {(h.вес || h.давление || просрочены.length > 0) && (
        <>
          <div className="section-label sec">Из раздела «Здоровье»</div>
          <div className="basal-rows">
            {h.вес && <div className="basal-row"><span>Вес</span><b>{h.вес.значение} кг</b></div>}
            {h.давление && (
              <div className="basal-row"><span>Давление</span>
                <b>{h.давление.верх}/{h.давление.низ}</b></div>
            )}
            {просрочены.map(({ проверка, когда }) => (
              <div key={проверка.id} className="basal-row">
                <span>{проверка.что}</span>
                <b className="val-warn">
                  {когда ? `${месяцевНазад(когда, сейчас)} мес назад` : 'нет даты'}
                </b>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Вопросы — вторая половина ценности приёма. Предлагаем черновик, но в отчёт
          идёт только отмеченное: список, который человек не правил, — это наш список,
          а в кабинет он идёт со своим.

          Раздел включается переключателем и по умолчанию свёрнут (#267). Он нужен не
          всем и не всегда: у одного приём через месяц, другой идёт к врачу с готовым
          списком в голове. Четыре предложенных вопроса — это половина экрана отчёта,
          которую иначе листают каждый раз.

          Переключатель остаётся на виду и выключенным: спрятать его совсем значило бы
          спрятать саму возможность, а о ней узнают, только увидев. */}
      <div className="section-label sec">Вопросы врачу</div>
      <div className="list">
        <Row icon={helpCircleOutline} title="Готовить вопросы к приёму"
          sub={вопросы.нужны ? 'список копится между приёмами' : 'предложим по вашим данным и дадим дописать своё'}
          right={<IonToggle checked={!!вопросы.нужны} onIonChange={(e) => нужныЛиВопросы(e.detail.checked)} />} />
      </div>
      {вопросы.нужны && (<>
      <div className="list" style={{ marginTop: 10 }}>
        {предложенные.map((в) => {
          const выбран = вопросы.выбранные.includes(в.id);
          return (
            <button key={в.id} className={'list-row pick-row' + (выбран ? ' on' : '')}
              onClick={() => переключитьВопрос(в.id)}>
              <IonIcon icon={выбран ? checkmarkCircle : ellipseOutline} className="list-ico" />
              <span className="pick-main">
                <span className="list-title">{в.текст}</span>
                <span className="pick-sub">повод: {в.повод}</span>
              </span>
            </button>
          );
        })}
        {вопросы.свои.map((т, i) => (
          <button key={'своё' + i} className="list-row pick-row on" onClick={() => убратьСвой(i)}>
            <IonIcon icon={checkmarkCircle} className="list-ico" />
            <span className="pick-main">
              <span className="list-title">{т}</span>
              <span className="pick-sub">свой вопрос · нажмите, чтобы убрать</span>
            </span>
          </button>
        ))}
        {!предложенные.length && !вопросы.свои.length && (
          <div className="metric-note">Пока нечего предложить — впишите своё.</div>
        )}
      </div>

      <div className="field" style={{ marginTop: 10 }}>
        <IonIcon icon={addOutline} className="field-ico" />
        <IonInput value={своё} placeholder="Свой вопрос врачу"
          onIonInput={(e) => setСвоё(e.detail.value ?? '')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && своё.trim()) { добавитьВопрос(своё.trim()); setСвоё(''); }
          }} />
      </div>
      {своё.trim() && (
        <button className="changed-btn" style={{ marginTop: 8 }}
          onClick={() => { добавитьВопрос(своё.trim()); setСвоё(''); }}>
          Добавить вопрос
        </button>
      )}
      </>)}

      <div className="sheet-note">
        Данные с телефона никуда не уходят сами. Показать отчёт врачу можно с экрана;
        файл для отправки появится позже — сначала посмотрим, что из этого пригодится
        на приёме.
      </div>
    </>
  );

  if (встроенный) return тело;
  return (
    <Section title="Отчёт к приёму" описание="Сводка к приёму врача: за какой период данные, насколько они полные и что стоит спросить. Готовится из того, что уже записано." onBack={onClose ?? (() => {})}>
      {тело}
    </Section>
  );
}

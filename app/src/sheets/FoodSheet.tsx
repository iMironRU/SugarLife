import { IonIcon, IonInput } from '@ionic/react';
import {timeOutline, searchOutline, sparklesOutline, warningOutline} from 'ionicons/icons';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/sources/store';
import { fmt, useCarbUnit, toCarbs, carbUnitLabel, XE_GRAMS, plural } from '@/domain/units';
import { addMeal, useMeals } from '@/sources/mealStore';
import { необъяснённыеПодъёмы, времяМомента, СМЕЩЕНИЯ } from '@/domain/mealMoment';
import { searchFoods, personalFoods, CAT_LABEL, CAT_ORDER, type Food } from '@/domain/foods';
import { когоНазвать, вопрос, type Спросить } from '@/domain/mealNaming';
import { useMealNames, nameGroup, skipGroup } from '@/settings/mealNames';
import { подсказка, приёмПоЧасу } from '@/domain/foodNow';
import Sheet from '@/ui/Sheet';
import { падает } from '@/domain/trend';
import { useEntries } from '@/sources/db';

const ПОКАЗЫВАЕМ = 6; // сколько плиток в группе до «ещё N»
const подтянуть = (el: HTMLElement) =>
  window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350);

/** 0 — сейчас, >0 — момент, <0 — смещение назад. */
const времяЕды = (когда: number) => (когда > 0 ? когда : Date.now() + когда);

/* Внести приём пищи.

   Кнопка «Сохранить» больше не заблокирована отсутствием токена. Раньше она ждала
   права записи в Nightscout — то есть ввод еды зависел от чужого сервера, и без него
   человек не мог записать даже себе. Теперь приём ложится в свою базу сразу и живёт
   там; куда он поедет дальше — вопрос доставки, а не ввода (domain/meals.ts).

   Время спрашиваем. Активные углеводы считаются от момента ЕДЫ, и «съел полчаса назад»,
   записанное как «сейчас», сдвигает всю кривую вместе с расчётом дозы. Поэтому рядом
   быстрые смещения: это один тап, а не выбор даты в календаре.

   Дозу не подставляем в поле. Прикидку болюса показываем — она полезна, — но вписать
   её за человека значит принять решение о дозе за него. */
export default function FoodSheet({ isOpen, onClose, времяПодъёма }: {
  isOpen: boolean; onClose: () => void;
  /* Открыли из «Без записи» (#381): время еды уже известно — это начало подъёма. Человек
     как раз его и не помнит точно, а данные помнят. */
  времяПодъёма?: number;
}) {
  const { data } = useStore();
  const ic = data?.profile?.ic ?? 8;

  const cu = useCarbUnit();
  const [carbs, setCarbs] = useState(30);
  /* Одно поле вместо двух: 0 — сейчас, положительное — конкретный момент из данных,
     отрицательное — смещение назад. Так не приходится держать «режим» отдельно от
     значения и гадать, какое из двух сейчас главное. */
  const [когда, setКогда] = useState(времяПодъёма ?? 0);
  const [показатьСмещения, setПоказатьСмещения] = useState(false);
  /* Тип приёма по часу, а не «Обед» всегда. Мелочь на вид, но она перебивала весь
     разбор: подставленный по умолчанию «Обед» выглядел как явный выбор человека и в
     десять вечера вытеснял ужин. Умный список, поверх которого стоит глупое умолчание,
     умным быть перестаёт. */

  const [сохранено, setСохранено] = useState(false);
  /* Пока человек печатает, показываем ровно то, что он набрал: иначе «2,» превратится
     в «2» под пальцем и запятую негде будет поставить. Ушёл из поля — снова считаем. */
  const [carbsТекст, setCarbsТекст] = useState<string | null>(null);
  const [запрос, setЗапрос] = useState('');
  const [выбрано, setВыбрано] = useState<string | null>(null);
  const [справочник, setСправочник] = useState<'нет' | 'коротко' | 'всё'>('нет');
  const [развёрнуто, setРазвёрнуто] = useState<Record<string, boolean>>({});

  const meals = useMeals();
  const имена = useMealNames();
  const своё = personalFoods(meals, имена.names);
  /* О чём спросить после записи. null — не о чем, и тогда шторка закрывается как прежде. */
  const [спросить, setСпросить] = useState<Спросить | null>(null);
  const [имя, setИмя] = useState('');
  const найдено = searchFoods(запрос);
  /* Коротко — только приёмы и купирование гипо: первое закрывает обычный день, второе
     нужно в моменте, когда листать некогда. Остальное по запросу. */
  const видимые = справочник === 'всё' ? CAT_ORDER : CAT_ORDER.filter((c) => c === 'meal' || c === 'hypo');
  const группы = видимые.map((c) => найдено.filter((f) => f.cat === c));

  /* Что показать первым — по сахару, намерению, своей истории в этот час и времени
     суток (domain/foodNow.ts). Считаем при открытии, а не на каждый рендер: список,
     который переставляется под пальцем, хуже неудобного. */
  /* Моменты, когда человек мог поесть: подъёмы сахара, не объяснённые углеводами.

     Углеводы берём ИЗ ОБОИХ мест — из своих записей и из Nightscout. Сначала я
     передавал только свои, и это была прямая дорога к дублю: человек залогировал еду
     в AAPS, оттуда она пришла как Meal Bolus с углеводами, а мы всё равно предлагали
     «в 21:04 сахар пошёл вверх, впиши» — и он вписывал второй раз. Задвоенные углеводы
     это задвоенная доза, тут ошибаться нельзя. */
  const моменты = useMemo(
    () => (isOpen
      ? необъяснённыеПодъёмы(data?.entries ?? [], [
        ...meals.map((m) => m.t),
        ...(data?.treatments ?? []).filter((t) => (t.carbs ?? 0) > 0).map((t) => t.t),
      ])
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, meals.length, data?.treatments?.length],
  );

  /* «Падает ли сейчас» — по нашей истории, а не по строке направления от источника:
     решение про быстрые углеводы не должно зависеть от того, чей загрузчик сегодня
     пишет в базу (#215). */
  const историяЧаса = useEntries(3600e3, { minRefreshMs: 20e3 });
  const падаетСейчас = падает(историяЧаса);

  const сейчас = useMemo(
    () => (isOpen ? подсказка({
      hour: new Date().getHours(),
      mmol: data?.latest?.mmol ?? null,
      падает: падаетСейчас,

      своё,
      историяЧасов: meals,
    }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, когда, meals.length],
  );

  // открыли заново — начинаем с чистого листа, а не с прошлых цифр
  useEffect(() => {
    if (isOpen) { setCarbs(30); setCarbsТекст(null); setКогда(0); setПоказатьСмещения(false); setСохранено(false); setЗапрос(''); setВыбрано(null); setСправочник('нет'); setРазвёрнуто({}); }
  }, [isOpen]);

  /* Выбор пресета не «применяет» его, а подставляет опорную точку: углеводы попадают в
     тот же степпер, который человек тут же правит. Иначе получилось бы, что справочник
     решает за него, а справочник у нас — оценка, а не измерение. */
  const выбрать = (id: string, carbs: number) => {
    setВыбрано(id);
    setCarbs(carbs);
  };

  const mealBolus = carbs > 0 ? fmt(carbs / ic) : '0';
  const clabel = carbUnitLabel(cu);
  const ШАГИ = cu === 'xe' ? [2, 1, 0.5] : [10, 5, 1];
  const вГраммах = (ш: number) => (cu === 'xe' ? ш * XE_GRAMS : ш);
  const ввестиУглеводы = (v: string) => {
    setCarbsТекст(v);
    const n = Number(v.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0) setCarbs(Math.min(300, cu === 'xe' ? n * XE_GRAMS : n));
  };
  const ratio = cu === 'xe' ? `1 Х.Е. ≈ ${fmt(XE_GRAMS / ic)} ед` : `КУ 1 ед / ${fmt(ic)} г`;

  /* Болюса здесь нет намеренно. Шторка отвечает на один вопрос — сколько углеводов и
     когда, — и ровно этим полезна. Доза вводится в помпе, а не у нас; спрашивать её
     «если уже вводили» значило просить человека переписать к нам то, что и так есть в
     потоке лечения. Одно поле убрали — шторка стала короче на экран. */
  const годно = carbs > 0;

  const сохранить = async () => {
    if (!годно) return;
    const kind = приёмПоЧасу(new Date(времяЕды(когда)).getHours());
    await addMeal({ t: времяЕды(когда), carbs, kind });
    setСохранено(true);

    /* Имя спрашиваем ЗДЕСЬ, сразу после записи, и только если приём повторился (#122).

       Момент выбран не случайно: человек ещё думает о том, что съел, и вопрос про это же
       не выглядит анкетой. Через час на главном экране он был бы прерыванием.

       Правило «кого спросить» — в domain/mealNaming под тестами: три повтора, не старше
       месяца, ещё не названо и не отказывались. Не подошло — молча закрываемся, как
       раньше. */
    const кого = когоНазвать(
      personalFoods([...meals, { id: 'новый', t: времяЕды(когда), carbs, kind, createdAt: Date.now(), sync: 'local' }]),
      { имена: имена.names, отказы: имена.skipped },
    );
    if (кого) { setСпросить(кого); return; }
    window.setTimeout(onClose, 700); // дать увидеть подтверждение, а не захлопнуть
  };

  /* Вопрос про имя показываем ВМЕСТО формы, а не под ней: приём уже записан, форма
     сделала своё дело, и оставлять её на экране значит намекать, что запись не завершена.
     Выход из вопроса — всегда, и он ничего не отменяет: еда сохранена в любом случае. */
  if (спросить) {
    const закрыть = () => { setСпросить(null); setИмя(''); onClose(); };
    return (
      <Sheet isOpen={isOpen} onClose={закрыть} title="Записано" subtitle="приём сохранён">
        <div className="sheet-note" style={{ marginTop: 0 }}>{вопрос(спросить)}</div>
        <div className="param">
          <div className="field-label">Название — необязательно</div>
          <div className="field">
            <IonInput value={имя} onIonInput={(e) => setИмя(e.detail.value ?? '')}
              placeholder="например, гречка с курицей" autocapitalize="sentences" />
          </div>
          <div className="field-hint param-hint">
            Пригодится, чтобы отличать два разных обеда по 55 г. Не назовёте — ничего не
            сломается, приём уже записан.
          </div>
        </div>
        <button className="food-save" disabled={!имя.trim()}
          onClick={() => { nameGroup(спросить.id, имя); закрыть(); }}>
          Назвать
        </button>
        {/* «Не называть» — отказ навсегда для этой группы, и об этом сказано прямо:
            иначе человек нажмёт его как «потом» и удивится, что вопроса больше нет. */}
        <button className="ob-skip" style={{ marginTop: 10 }}
          onClick={() => { skipGroup(спросить.id); закрыть(); }}>
          Не называть — и больше не спрашивать
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title="Еда" subtitle="Запись приёма пищи"
      footer={(
        /* В подвале только действие. «Закрыть» отсюда убрано: выход у шторки один
           и всегда на одном месте — крестик вверху справа, который теперь не
           уезжает с прокруткой (шапка липкая). Два выхода на одном экране мы уже
           убирали в разделах — здесь та же причина. */
        <div className="sheet-foot">
          <button className="food-save" disabled={!годно || сохранено} onClick={сохранить}>
            {сохранено ? 'Записано' : 'Сохранить приём'}
          </button>
        </div>
      )}
    >

        {/* Правка прямо на плитке, значение по центру, шаги по краям.

            Значение — поле ввода, а не текст с кнопками рядом: «двадцать восемь»
            степпером набирается шестью нажатиями, а руками одним. Кнопки остаются для
            подгонки, ввод — для попадания сразу.

            Шаги зависят от единиц. В граммах 1 / 5 / 10, в хлебных единицах 0,5 / 1 / 2:
            шаг «10 Х.Е.» это полтораста граммов углеводов, такого приёма не бывает. */}
        <div className="food-summary">
          <div className="fs-steps">
            {ШАГИ.map((ш) => (
              <button key={'m' + ш} onClick={() => setCarbs((c) => Math.max(0, c - вГраммах(ш)))}>
                −{ш}
              </button>
            ))}
          </div>
          <div className="fs-value">
            <div className="fs-cap">Углеводы</div>
            <div className="fs-input">
              <IonInput value={carbsТекст ?? toCarbs(carbs, cu)} type="text" inputmode="decimal"
                onIonFocus={(e) => подтянуть(e.target as unknown as HTMLElement)}
                onIonInput={(e) => ввестиУглеводы(e.detail.value ?? '')}
                onIonBlur={() => setCarbsТекст(null)} />
              <span>{clabel}</span>
            </div>
          </div>
          <div className="fs-steps">
            {/* Наружу по возрастанию — зеркально минусам: мелкий шаг всегда ближе
                к значению, крупный дальше. Иначе рука тянется не туда. */}
            {[...ШАГИ].reverse().map((ш) => (
              <button key={'p' + ш} onClick={() => setCarbs((c) => Math.min(300, c + вГраммах(ш)))}>
                +{ш}
              </button>
            ))}
          </div>
        </div>

        {/* Прикидка, а не подставленное значение: вписать дозу за человека значит
            принять решение о дозе за него. */}
        <div className="food-bolus">Болюс на еду: {mealBolus} ед · {ratio}</div>

        {/* «Сейчас» — подъём наверх, а не отсечение: люди едят кашу вечером, и остальное
            никуда не девается. Группа подписана, чтобы было видно, почему именно эти:
            молча переставленный список — это когда приложение решает за тебя и не
            объясняет. */}
        {сейчас && (
          <>
            <div className={'food-label' + (сейчас.гипо ? ' is-hypo' : '')}>
              <IonIcon icon={сейчас.гипо ? warningOutline : timeOutline} /> {сейчас.причина}
            </div>
            <div className="food-picks">
              {сейчас.свои.map((p) => (
                <button key={'n' + p.id} className={'food-pick' + (выбрано === p.id ? ' on' : '')}
                  onClick={() => выбрать(p.id, p.carbs)}>
                  <b>{p.name ?? p.kind}</b>
                  <span>{toCarbs(p.carbs, cu)} {clabel} · {p.count} {plural(p.count, 'раз', 'раза', 'раз')}</span>
                </button>
              ))}
              {сейчас.из_справочника.map((f) => (
                <button key={'n' + f.id} className={'food-pick' + (сейчас.гипо ? ' is-hypo' : '') + (выбрано === f.id ? ' on' : '')}
                  onClick={() => выбрать(f.id, f.carbs)}>
                  <b>{f.name}</b>
                  <span>≈ {toCarbs(f.carbs, cu)} {clabel}{f.portion ? ' · ' + f.portion : ''}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Порядок здесь важнее содержимого.

            Первым — «ваше обычное»: люди едят одно и то же, и в большинстве случаев
            дальше листать не надо вовсе. Сразу за ним степпер — то, чем поправляют.
            Справочник ниже и по умолчанию свёрнут: 68 плиток над степпером означали,
            что до ручной правки надо пролистать весь каталог.

            Справочник свёрнут всегда. Раньше он раскрывался, когда своей истории нет —
            новому человеку нужен был ориентир. С появлением группы «Сейчас» ориентир
            есть, и он лучше: подобран под время и сахар. */}
        {своё.length > 0 && (
          <>
            <div className="food-label"><IonIcon icon={sparklesOutline} /> Ваше обычное</div>
            <div className="food-picks">
              {своё.slice(0, 6).map((p) => (
                <button key={p.id} className={'food-pick' + (выбрано === p.id ? ' on' : '')}
                  onClick={() => выбрать(p.id, p.carbs)}>
                  {/* Имя, если человек его дал (#122): ради него всё и затевалось —
                      отличить два разных обеда по 55 г. Нет имени — прежняя метка
                      приёма: она хотя бы узнаётся. */}
                  <b>{p.name ?? p.kind}</b>
                  <span>
                    {p.name ? `${p.kind.toLowerCase()} · ` : ''}
                    {toCarbs(p.carbs, cu)} {clabel} · {p.count} {plural(p.count, 'раз', 'раза', 'раз')}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Когда ели.

            Не «15 / 30 мин назад» — это счёт в уме: сейчас 22:33, поел в девять, это
            сколько? Человек либо считает, либо жмёт наугад, и время еды уезжает вместе
            со всей кривой активных углеводов.

            Вместо этого называем моменты. Открыл ввод — скорее всего про сейчас. Вносит
            задним числом — значит есть повод, и повод виден в данных: сахар пошёл вверх,
            а еды в этот момент не внесено (domain/mealMoment.ts). Смещения остаются
            запасным вариантом: поел ровно столько, сколько уколол, — и сахар не дрогнул. */}
        <div className="food-label"><IonIcon icon={timeOutline} /> Когда ели</div>
        <div className="food-meals">
          <button className={'food-meal' + (когда === 0 ? ' on' : '')} onClick={() => setКогда(0)}>сейчас</button>
          {/* Коротко: время — это то, что выбирают, а «+5,2» говорит, насколько
              поднялось, то есть какого размера был приём. Стрелка, а не капля: капля
              у нас уже значит инсулин (иконка вкладки), и путать их нельзя. */}
          {моменты.map((м) => (
            <button key={м.at} className={'food-meal' + (когда === м.at ? ' on' : '')}
              onClick={() => setКогда(м.at)}>
              {времяМомента(м.at)} <i className="fm-rise">↑{fmt(м.rise)}</i>
            </button>
          ))}
          {(показатьСмещения || !моменты.length) && СМЕЩЕНИЯ.map((с) => (
            <button key={с.label} className={'food-meal' + (когда === -с.ms ? ' on' : '')}
              onClick={() => setКогда(-с.ms)}>{с.label}</button>
          ))}
          {!показатьСмещения && моменты.length > 0 && (
            <button className="food-meal food-meal-more" onClick={() => setПоказатьСмещения(true)}>другое время</button>
          )}
        </div>
        {/* Отступ обычный, а не отрицательный: под рядом фишек он затягивал подпись
            под кнопку «другое время», и строки налезали друг на друга. */}
        {моменты.length > 0 && !показатьСмещения && (
          <div className="food-save-note" style={{ textAlign: 'left', margin: '8px 2px 14px' }}>
            Время — когда сахар пошёл вверх, а рядом на сколько. Похоже на момент, когда
            ты поел, но записи об этом нет.
          </div>
        )}

        {/* Справочник. Свёрнут, когда у человека уже есть своя история: тогда он
            подсказка на редкий случай, а не главный путь. Пока истории нет — раскрыт
            коротким видом (приёмы и купирование гипо), потому что новому человеку он
            единственный ориентир. Полный список — по явному запросу. */}
        <button className="food-toggle" onClick={() => setСправочник(справочник === 'нет' ? 'коротко' : 'нет')}>
          <IonIcon icon={searchOutline} />
          <span>{справочник === 'нет' ? 'Найти в справочнике' : 'Свернуть справочник'}</span>
        </button>

        {справочник !== 'нет' && (
          <>
            <div className="field" style={{ marginTop: 10 }}>
              <IonIcon icon={searchOutline} className="field-ico" />
              <IonInput value={запрос} placeholder="Приём, блюдо, напиток"
                onIonInput={(e) => setЗапрос(e.detail.value ?? '')} />
            </div>
            <div className="food-cats">
              {(запрос ? [найдено] : группы).map((группа, i) => (
                группа.length === 0 ? null : (
                  <div key={i} className="food-cat">
                    {!запрос && <div className="food-cat-cap">{CAT_LABEL[видимые[i]]}</div>}
                    {/* Группу подрезаем: 27 блюд подряд — это лента, в которой ничего
                        не найти глазами. Развернуть можно, но по своему решению. */}
                    <div className="food-picks">
                      {(развёрнуто[видимые[i]] ? группа : группа.slice(0, ПОКАЗЫВАЕМ)).map((f: Food) => (
                        <button key={f.id} className={'food-pick' + (выбрано === f.id ? ' on' : '')}
                          onClick={() => выбрать(f.id, f.carbs)}>
                          <b>{f.name}</b>
                          <span>≈ {toCarbs(f.carbs, cu)} {clabel}{f.portion ? ' · ' + f.portion : ''}</span>
                          {f.slow && <i className="food-slow">жирное · усвоится позже</i>}
                        </button>
                      ))}
                    </div>
                    {!запрос && группа.length > ПОКАЗЫВАЕМ && !развёрнуто[видимые[i]] && (
                      <button className="food-more"
                        onClick={() => setРазвёрнуто((r) => ({ ...r, [видимые[i]]: true }))}>
                        ещё {группа.length - ПОКАЗЫВАЕМ}
                      </button>
                    )}
                  </div>
                )
              ))}
            </div>
            {справочник === 'коротко' && !запрос && (
              <button className="food-toggle" onClick={() => setСправочник('всё')}>
                <span>Показать всё — блюда, перекусы, напитки</span>
              </button>
            )}
            <div className="food-save-note" style={{ textAlign: 'left', margin: '2px 2px 14px' }}>
              Значения типовые, не измеренные: это опорная точка, чтобы не начинать с пустого
              поля. Поправь под свою тарелку степпером выше.
            </div>
          </>
        )}

        {/* Что произойдёт при сохранении — последней строкой, рядом с кнопкой:
            это примечание к действию, а не к полю. */}
        <div className="food-save-note" style={{ textAlign: 'left', margin: '4px 2px 0' }}>
          Записывается в приложение и учитывается сразу. В Nightscout пока не уходит —
          выгрузку сделаем отдельно, запись от этого не потеряется.
        </div>

    </Sheet>
  );
}

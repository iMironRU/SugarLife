import { IonModal, IonContent, IonIcon, IonInput } from '@ionic/react';
import { closeOutline, removeOutline, addOutline, timeOutline, waterOutline, searchOutline, sparklesOutline, warningOutline } from 'ionicons/icons';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/sources/store';
import { fmt, useCarbUnit, toCarbs, carbUnitLabel, XE_GRAMS, plural } from '@/domain/units';
import { addMeal, useMeals } from '@/sources/mealStore';
import { необъяснённыеПодъёмы, СМЕЩЕНИЯ } from '@/domain/mealMoment';
import { searchFoods, personalFoods, CAT_LABEL, CAT_ORDER, type Food } from '@/domain/foods';
import { подсказка, приёмПоЧасу } from '@/domain/foodNow';

const ПОКАЗЫВАЕМ = 6; // сколько плиток в группе до «ещё N»
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
export default function FoodSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { data } = useStore();
  const ic = data?.profile?.ic ?? 8;

  const cu = useCarbUnit();
  const [carbs, setCarbs] = useState(30);
  /* Одно поле вместо двух: 0 — сейчас, положительное — конкретный момент из данных,
     отрицательное — смещение назад. Так не приходится держать «режим» отдельно от
     значения и гадать, какое из двух сейчас главное. */
  const [когда, setКогда] = useState(0);
  const [показатьСмещения, setПоказатьСмещения] = useState(false);
  /* Тип приёма по часу, а не «Обед» всегда. Мелочь на вид, но она перебивала весь
     разбор: подставленный по умолчанию «Обед» выглядел как явный выбор человека и в
     десять вечера вытеснял ужин. Умный список, поверх которого стоит глупое умолчание,
     умным быть перестаёт. */

  const [insulin, setInsulin] = useState('');
  const [сохранено, setСохранено] = useState(false);
  const [запрос, setЗапрос] = useState('');
  const [выбрано, setВыбрано] = useState<string | null>(null);
  const [справочник, setСправочник] = useState<'нет' | 'коротко' | 'всё'>('нет');
  const [развёрнуто, setРазвёрнуто] = useState<Record<string, boolean>>({});

  const meals = useMeals();
  const своё = personalFoods(meals);
  const найдено = searchFoods(запрос);
  /* Коротко — только приёмы и купирование гипо: первое закрывает обычный день, второе
     нужно в моменте, когда листать некогда. Остальное по запросу. */
  const видимые = справочник === 'всё' ? CAT_ORDER : CAT_ORDER.filter((c) => c === 'meal' || c === 'hypo');
  const группы = видимые.map((c) => найдено.filter((f) => f.cat === c));

  /* Что показать первым — по сахару, намерению, своей истории в этот час и времени
     суток (domain/foodNow.ts). Считаем при открытии, а не на каждый рендер: список,
     который переставляется под пальцем, хуже неудобного. */
  /* Моменты, когда человек мог поесть: подъёмы сахара, не объяснённые внесённой едой. */
  const моменты = useMemo(
    () => (isOpen ? необъяснённыеПодъёмы(data?.entries ?? [], meals.map((m) => m.t)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, meals.length],
  );

  const сейчас = useMemo(
    () => (isOpen ? подсказка({
      hour: new Date().getHours(),
      mmol: data?.latest?.mmol ?? null,
      dir: data?.latest?.dir,

      своё,
      историяЧасов: meals,
    }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, когда, meals.length],
  );

  // открыли заново — начинаем с чистого листа, а не с прошлых цифр
  useEffect(() => {
    if (isOpen) { setCarbs(30); setКогда(0); setПоказатьСмещения(false); setInsulin(''); setСохранено(false); setЗапрос(''); setВыбрано(null); setСправочник('нет'); setРазвёрнуто({}); }
  }, [isOpen]);

  /* Выбор пресета не «применяет» его, а подставляет опорную точку: углеводы попадают в
     тот же степпер, который человек тут же правит. Иначе получилось бы, что справочник
     решает за него, а справочник у нас — оценка, а не измерение. */
  const выбрать = (id: string, carbs: number) => {
    setВыбрано(id);
    setCarbs(carbs);
  };

  const mealBolus = carbs > 0 ? fmt(carbs / ic) : '0';
  const step = cu === 'xe' ? XE_GRAMS : 5;
  const clabel = carbUnitLabel(cu);
  const ratio = cu === 'xe' ? `1 Х.Е. ≈ ${fmt(XE_GRAMS / ic)} ед` : `КУ 1 ед / ${fmt(ic)} г`;

  const дозаЧисло = Number(insulin.replace(',', '.'));
  const доза = insulin.trim() !== '' && Number.isFinite(дозаЧисло) && дозаЧисло > 0 ? дозаЧисло : undefined;
  const годно = carbs > 0 || доза != null;

  const сохранить = async () => {
    if (!годно) return;
    await addMeal({
      t: времяЕды(когда),
      carbs,
      insulin: доза,
      kind: приёмПоЧасу(new Date(времяЕды(когда)).getHours()),
    });
    setСохранено(true);
    window.setTimeout(onClose, 700); // дать увидеть подтверждение, а не захлопнуть
  };

  /* Шторка без breakpoints и handle намеренно. С ними вертикальный жест уходит в
     перетаскивание вместо прокрутки содержимого: тянешь список — закрывается вся
     шторка, и нижние кнопки недостижимы. В других шторках от них уже отказались;
     здесь они дожили только потому, что содержимого было мало. */
  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} className="sheet-modal sheet-tall">
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Еда</div>
            <div className="sheet-subtitle">Запись приёма пищи</div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        {/* Правка прямо на плитке. Раньше −/+ жили отдельным блоком ниже, а на самом
            заметном месте экрана стояли три прочерка Б/Ж/ккал — и это были не «пока не
            заполнили», а «мы это и не собираемся показывать»: цель шторки — быстро
            внести углеводы, а не вести дневник питания. */}
        <div className="food-summary">
          <div className="fs-left">
            <div className="fs-cap">Углеводы</div>
            <div className="fs-carbs">{toCarbs(carbs, cu)}<span>{clabel}</span></div>
          </div>
          <div className="fs-step">
            <button onClick={() => setCarbs((c) => Math.max(0, c - step))} aria-label="Меньше">
              <IonIcon icon={removeOutline} />
            </button>
            <button onClick={() => setCarbs((c) => Math.min(300, c + step))} aria-label="Больше">
              <IonIcon icon={addOutline} />
            </button>
          </div>
        </div>
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
                  <b>{p.kind}</b>
                  <span>{toCarbs(p.carbs, cu)} {clabel} · {p.count} {plural(p.count, 'раз', 'раза', 'раз')}</span>
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
          {моменты.map((м) => (
            <button key={м.at} className={'food-meal food-meal-wide' + (когда === м.at ? ' on' : '')}
              onClick={() => setКогда(м.at)}>{м.label}</button>
          ))}
          {(показатьСмещения || !моменты.length) && СМЕЩЕНИЯ.map((с) => (
            <button key={с.label} className={'food-meal' + (когда === -с.ms ? ' on' : '')}
              onClick={() => setКогда(-с.ms)}>{с.label}</button>
          ))}
          {!показатьСмещения && моменты.length > 0 && (
            <button className="food-meal food-meal-more" onClick={() => setПоказатьСмещения(true)}>другое время</button>
          )}
        </div>

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

        <div className="food-label"><IonIcon icon={waterOutline} /> Болюс, ед — если уже вводили</div>
        <div className="field">
          <IonInput value={insulin} type="text" inputmode="decimal" placeholder="не вводили"
            onIonInput={(e) => setInsulin(e.detail.value ?? '')} />
        </div>

        <button className="food-save" disabled={!годно || сохранено} onClick={сохранить}>
          {сохранено ? 'Записано' : 'Сохранить приём'}
        </button>
        <div className="food-save-note">
          Записывается в приложение и учитывается сразу. В Nightscout пока не уходит —
          выгрузку сделаем отдельно, запись от этого не потеряется.
        </div>
      </IonContent>
    </IonModal>
  );
}

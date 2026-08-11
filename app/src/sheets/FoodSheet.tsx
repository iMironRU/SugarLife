import { IonModal, IonContent, IonIcon, IonInput } from '@ionic/react';
import { closeOutline, nutritionOutline, removeOutline, addOutline, timeOutline, waterOutline, searchOutline, sparklesOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useStore } from '@/sources/store';
import { fmt, useCarbUnit, toCarbs, carbUnitLabel, XE_GRAMS, plural } from '@/domain/units';
import { addMeal, useMeals } from '@/sources/mealStore';
import { СМЕЩЕНИЯ } from '@/domain/meals';
import { searchFoods, personalFoods, CAT_LABEL, CAT_ORDER, type Food } from '@/domain/foods';

const MEALS = ['Завтрак', 'Обед', 'Ужин', 'Перекус'];

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
  const [назад, setНазад] = useState(0); // сколько минут назад ели
  const [meal, setMeal] = useState(1);
  const [insulin, setInsulin] = useState('');
  const [сохранено, setСохранено] = useState(false);
  const [запрос, setЗапрос] = useState('');
  const [выбрано, setВыбрано] = useState<string | null>(null);
  const [справочник, setСправочник] = useState<'нет' | 'коротко' | 'всё'>('нет');

  const meals = useMeals();
  const своё = personalFoods(meals);
  const найдено = searchFoods(запрос);
  /* Коротко — только приёмы и купирование гипо: первое закрывает обычный день, второе
     нужно в моменте, когда листать некогда. Остальное по запросу. */
  const видимые = справочник === 'всё' ? CAT_ORDER : CAT_ORDER.filter((c) => c === 'meal' || c === 'hypo');
  const группы = видимые.map((c) => найдено.filter((f) => f.cat === c));

  // открыли заново — начинаем с чистого листа, а не с прошлых цифр
  useEffect(() => {
    if (isOpen) { setCarbs(30); setНазад(0); setInsulin(''); setСохранено(false); setЗапрос(''); setВыбрано(null); setСправочник(своё.length ? 'нет' : 'коротко'); }
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
      t: Date.now() - назад * 60e3,
      carbs,
      insulin: доза,
      kind: MEALS[meal],
    });
    setСохранено(true);
    window.setTimeout(onClose, 700); // дать увидеть подтверждение, а не захлопнуть
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.9} breakpoints={[0, 0.9]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Еда</div>
            <div className="sheet-subtitle">Запись приёма пищи</div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        <div className="food-summary">
          <div className="fs-left">
            <div className="fs-cap">Углеводы</div>
            <div className="fs-carbs">{toCarbs(carbs, cu)}<span>{clabel}</span></div>
          </div>
          <div className="fs-macros">
            <div><span className="fs-mk">Б</span><span className="fs-mv">—</span></div>
            <div><span className="fs-mk">Ж</span><span className="fs-mv">—</span></div>
            <div><span className="fs-mk">ккал</span><span className="fs-mv">—</span></div>
          </div>
        </div>
        <div className="food-bolus">Болюс на еду: {mealBolus} ед · {ratio}</div>

        {/* Порядок здесь важнее содержимого.

            Первым — «ваше обычное»: люди едят одно и то же, и в большинстве случаев
            дальше листать не надо вовсе. Сразу за ним степпер — то, чем поправляют.
            Справочник ниже и по умолчанию свёрнут: 68 плиток над степпером означали,
            что до ручной правки надо пролистать весь каталог.

            Если истории ещё нет, справочник наоборот раскрыт: новому человеку он
            единственный ориентир, и прятать его за кнопкой значит вернуть пустое поле. */}
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

        <div className="food-stepper">
          <span><IonIcon icon={nutritionOutline} /> Углеводы</span>
          <div className="stepper">
            <button onClick={() => setCarbs((c) => Math.max(0, c - step))} aria-label="Меньше"><IonIcon icon={removeOutline} /></button>
            <b>{toCarbs(carbs, cu)}<i>{clabel}</i></b>
            <button onClick={() => setCarbs((c) => Math.min(300, c + step))} aria-label="Больше"><IonIcon icon={addOutline} /></button>
          </div>
        </div>

        <div className="food-label">Приём пищи</div>
        <div className="food-meals">
          {MEALS.map((m, i) => (
            <button key={m} className={'food-meal' + (meal === i ? ' on' : '')} onClick={() => setMeal(i)}>{m}</button>
          ))}
        </div>

        {/* Когда ели. Спрашиваем всегда: от этого времени считаются активные углеводы,
            и запись задним числом — обычное дело, а не исключение. */}
        <div className="food-label"><IonIcon icon={timeOutline} /> Когда ели</div>
        <div className="food-meals">
          {СМЕЩЕНИЯ.map((с) => (
            <button key={с.label} className={'food-meal' + (назад === с.ms / 60e3 ? ' on' : '')}
              onClick={() => setНазад(с.ms / 60e3)}>
              {с.ms === 0 ? с.label : с.label + ' назад'}
            </button>
          ))}
        </div>

        {/* Дозу вводит человек. Прикидка выше — подсказка, а не подставленное значение:
            вписать её за него значит принять решение о дозе за него. */}
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
                    <div className="food-picks">
                      {группа.map((f: Food) => (
                        <button key={f.id} className={'food-pick' + (выбрано === f.id ? ' on' : '')}
                          onClick={() => выбрать(f.id, f.carbs)}>
                          <b>{f.name}</b>
                          <span>≈ {toCarbs(f.carbs, cu)} {clabel}{f.portion ? ' · ' + f.portion : ''}</span>
                          {f.slow && <i className="food-slow">жирное · усвоится позже</i>}
                        </button>
                      ))}
                    </div>
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

import { DiagnosticsSection, HealthSection, LoopSection, DataDevicesSection, AboutSection, AppearanceSection } from '@/sections/lazy';
import {
  optionsOutline, nutritionOutline,
  hardwareChipOutline, repeat, documentTextOutline, heartOutline, informationCircleOutline,
  colorPaletteOutline,
} from 'ionicons/icons';
import { useState } from 'react';
import { resetLocalData } from '@/settings/reset';
import { unitLabel, useUnit, carbUnitLabel, useCarbUnit } from '@/domain/units';
import { useTheme } from '../theme/useTheme';
import { APP_EDITION, APP_VERSION, APP_BUILD, isNative } from '@/platform/appUpdate';
import { useStack } from '@/app/stackCtx';
import { useSnapshot } from '@/sources/bridge';
import { useHealth } from '@/settings/health';
import { поВажности } from '@/domain/screenings';
import { useLoopProfile, LOOP_MODES } from '@/settings/loopProfile';
import { useDeviceConfig, deviceStatus } from '@/settings/deviceConfig';
import { pumpById, sensorById } from '@/domain/catalog';
import Row from '@/ui/Row';
import UnitsModal from '@/sheets/UnitsModal';
import CarbUnitsModal from '@/sheets/CarbUnitsModal';
import Screen from '@/ui/Screen';

export default function Profile() {
  const { theme } = useTheme();
  const unit = useUnit();
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [carbUnitsOpen, setCarbUnitsOpen] = useState(false);
  const carbUnit = useCarbUnit();
  const { push, pop } = useStack();
  /* Издание берём у движка, а не у константы сборки (#298, #294). Константа говорит, чем
     нас собрали, движок — что внутри на самом деле. Для обновления важно второе: релиз
     выпускает Lite, и предлагать его сборке Pro значит поставить рядом второе приложение
     вместо обновления. */
  const снимок = useSnapshot();
  const издание = снимок?.edition ?? 'lite';


  const reset = () => {
    if (!window.confirm('Сбросить настройки? С этого устройства будут удалены облака, записанные устройства и локальная история глюкозы.')) return;
    resetLocalData();
    location.reload();
  };


  /* Что записано в устройствах — коротко, для строки-входа. Названия моделей, а не
     «настроено»: человек проверяет глазами свою помпу и свой сенсор, а слово
     «настроено» одинаково выглядит и когда всё верно, и когда записана не та модель. */
  const devCfg = useDeviceConfig();
  const устройства = [pumpById(devCfg.pumpId)?.model, sensorById(devCfg.sensorId)?.name]
    .filter(Boolean).join(' · ') || 'ничего не записано';
  /* Справа — только то, что требует действия. Строка молчит, пока всё в порядке:
     постоянная надпись «настроено» перестаёт читаться, и «нужен мост» рядом с ней
     пропадёт вместе со всеми остальными. */
  const нуженМост = deviceStatus('pump', devCfg) === 'needsBridge'
    || deviceStatus('sensor', devCfg) === 'needsBridge';

  const loop = useLoopProfile();
  const loopMode = LOOP_MODES.find((m) => m.id === loop.mode);
  /* Подпись у «Здоровья» — то, что требует действия, и ничего больше. Список
     обследований со сроками длинный, а на строке помещается одно слово: пусть это
     будет число просроченного, а не бодрое «всё в порядке» (#156). */
  const здоровье = useHealth();
  const просрочено = поВажности(здоровье.проверки, Date.now(), здоровье.дебют)
    .filter((с) => с.состояние === 'просрочено').length;
  const здоровьеПодпись = просрочено
    ? `вышел срок: ${просрочено} ${просрочено === 1 ? 'проверка' : просрочено < 5 ? 'проверки' : 'проверок'}`
    : 'вес, давление, анализы, обследования';

  const loopSub = loop.savedAt
    ? `${loopMode?.code} · ${loopMode?.name.toLowerCase()}`
    : 'не настроен';

  return (
    <Screen tab={4}>
          {/* Шапки с именем и тройки показателей здесь больше нет — по трём разным
              причинам, и ни одна не про экономию места.

              GMI и средний сахар живут в «Метриках», где у них есть период. Здесь они
              считались по тому, что держит стор для главного экрана, — по последним
              288 точкам, то есть примерно за сутки, и подпись об этом молчала. GMI за
              сутки — не оценка HbA1c ничем, кроме названия; человек же сравнивает эту
              цифру с анализом из лаборатории. Дубль был не только лишним, но и хуже
              оригинала.

              СУИ приезжает из профиля Nightscout: с нативным ядром или без облака его
              просто нет, и на его месте стоял бы прочерк. А там, где он действительно
              нужен, он и так виден — в строке болюса при вводе еды.

              Имя и «Замкнутый цикл · Nightscout» — то же самое: имя берётся из профиля
              Nightscout, без него в аватаре стояло бы слово «Профиль». Тип терапии
              виден в устройствах, источник — в облаках.

              Когда появятся мульти-профили, переключатель вернётся сюда настоящим
              элементом управления, а не подписью под аватаром. */}

          {/* Порядок разделов — по тому, зачем сюда заходят, а не по тому, что важнее
              звучит. Приходят посмотреть: на связи ли облако, что вообще подключено,
              какая петля настроена. Единицы глюкозы меняют один раз в жизни, но они
              стояли первыми и отодвигали вниз всё, ради чего экран открывают.

              Поэтому сверху то, что работает, ниже — настройки. Диагностика, версия и
              оформление в конце: туда идут по конкретному поводу и заранее знают, что
              ищут.

              Заголовков над КАЖДОЙ строкой было три — «Устройства», «Сервисы»,
              «Алгоритм», — и каждый повторял название единственной строки под собой.
              Их убрали правильно: заголовок нужен, когда собирает разнородное под общим
              смыслом, а над одной строкой он только отнимает высоту и разбивает на три
              куска то, что глазом читается как один список входов.

              А вот общего заголовка не хватало, и это было видно раньше, чем понятно:
              у всех остальных блоков он есть, и глаз читает ритм «заголовок — блок».
              Первый блок из ритма выпадал, и экран казался слегка сломанным (#212).

              «Что настроено» вместо «Моё хозяйство»: второе звучало по-домашнему там,
              где речь о приборах, подающих инсулин. Заголовок собирает разное —
              устройства, облака, правила счёта, здоровье — и отвечает на общий для них
              вопрос: что здесь уже настроено и требует присмотра.

              Границу ЧТО (устройства) и КАК (сервисы) из docs/CONNECT-UX.md §10 это не
              трогает: разделы разные, входы разные, рядом стоят только строки. */}
          <div className="section-label sec">Что настроено</div>
          <div className="list">
            {/* Подпись — то, что записано на самом деле. Заголовок перечисляет, что
                внутри раздела, и на вопрос «а что у меня подключено» не отвечал: за
                ответом надо было открывать. Самый быстрый взгляд — тот, ради которого
                никуда не переходят. */}
            {/* Одна дверь в хозяйство вместо трёх (#279): источники, приборы и облака
                лежали порознь, и человеку приходилось выбирать дверь до того, как он
                понял, что ищет. Внутри — две вкладки, потому что вопросы разные. */}
            <Row icon={hardwareChipOutline} title="Устройства и данные"
              sub={устройства} value={нуженМост ? 'нужен мост' : undefined}
              onClick={() => push(<DataDevicesSection onClose={pop} />)} />
            {/* профиль петли: только настройка — подача не включается (решение 0004) */}
            <Row icon={repeat} title="Петля" sub={loopSub}
              onClick={() => push(<LoopSection onClose={pop} />)} />
            {/* Здоровье — рядом с железом и петлёй по той же причине: это «моё,
                работающее», просто не про приборы, а про то, что знает сам человек
                и записывает врач (#156). */}
            <Row icon={heartOutline} title="Здоровье" sub={здоровьеПодпись}
              onClick={() => push(<HealthSection onClose={pop} />)} />
          </div>

          {/* настройки */}
          <div className="section-label sec">Настройки</div>
          <div className="list">
            <Row icon={optionsOutline} title="Единицы глюкозы" value={unitLabel(unit)} onClick={() => setUnitsOpen(true)} />
            <Row icon={nutritionOutline} title="Единицы еды" value={carbUnitLabel(carbUnit)} onClick={() => setCarbUnitsOpen(true)} />
          </div>
          {/* Про хранение. Стояло рядом с выгрузкой в CSV и объясняло, почему она
              вообще есть; выгрузка ушла (данные выносит бэкап движка), а строка
              осталась — вопрос «где лежат мои данные» от этого не исчез. */}
          <div className="metric-note" style={{ marginTop: 14 }}>
            Данные хранятся только на этом устройстве, без облака и аккаунта.
          </div>

          {/* Диагностика — в глубине, а не на виду: человеку с диабетом она нужна раз в
              полгода, когда что-то не работает, и место на главном занимать не должна.
              Но найти её надо уметь быстро, поэтому рядом с «о приложении», где и так
              ищут версию и обновление (SugarLifeCore#17). */}
          <div className="section-label sec">Диагностика</div>
          <div className="list">
            <Row icon={documentTextOutline} title="Логи работы"
              sub="уровень подробности, запись в файл, выгрузка"
              onClick={() => push(<DiagnosticsSection onClose={pop} />)} />
          </div>

          {/* о приложении: версия + сборка + обновление */}
          {/* «О приложении» — отдельный раздел (замечание с телефона).

              Плашка внизу Профиля показывала одну сборку из двух и звала «Обновиться»
              кнопку, которая сначала спрашивает сервер. Обе неправды исправлены внутри
              раздела; здесь остаётся вход и то, что человек проверяет чаще всего —
              какая версия стоит. */}
          {/* Оформление — над «О приложении»: это настройка, а «О приложении» —
              справка. Настройки человек меняет, справку читает. */}
          <div className="section-label sec">Оформление</div>
          <div className="list">
            {/* Строка называется «Тема», а не «Оформление»: заголовок над ней уже сказал
                это слово, и повторять его значит потратить строку на эхо. Ровно от этого
                здесь уходили, убирая заголовки над каждой одиночной строкой. */}
            <Row icon={colorPaletteOutline} title="Тема"
              sub={theme === 'system' ? 'как в настройках телефона' : theme === 'light' ? 'светлая' : 'тёмная'}
              value={theme === 'system' ? 'системная' : undefined}
              onClick={() => push(<AppearanceSection onClose={pop} />)} />
          </div>

          <div className="section-label sec">О приложении</div>
          <div className="list">
            <Row icon={informationCircleOutline}
              title={`${издание === 'pro' ? 'SugarLife.Pro' : APP_EDITION} ${APP_VERSION}`}
              sub={`сборка ${APP_BUILD}${isNative ? ' · нативное' : ' · PWA'}`}
              onClick={() => push(<AboutSection onClose={pop} />)} />
          </div>

          {/* оформление */}
          <button className="logout" onClick={reset}>Сбросить настройки</button>

        <UnitsModal isOpen={unitsOpen} onClose={() => setUnitsOpen(false)} />
        <CarbUnitsModal isOpen={carbUnitsOpen} onClose={() => setCarbUnitsOpen(false)} />
    </Screen>
  );
}

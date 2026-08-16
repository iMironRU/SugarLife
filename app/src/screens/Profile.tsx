import { IonIcon } from '@ionic/react';
import { DiagnosticsSection, HealthSection, LoopSection, DataDevicesSection } from '@/sections/lazy';
import {
  downloadOutline,
  optionsOutline, nutritionOutline, ellipse, sunny, moon, refreshOutline,
  hardwareChipOutline, repeat, documentTextOutline, heartOutline,
} from 'ionicons/icons';
import { useState, useEffect } from 'react';
import { resetLocalData } from '@/settings/reset';
import { unitLabel, useUnit, carbUnitLabel, useCarbUnit } from '@/domain/units';
import { useTheme } from '../theme/useTheme';
import { APP_EDITION, APP_VERSION, APP_BUILD, isNative, platform, checkOtaUpdate, checkNativeUpdate, openApkDownload, installApk, ВЫПУСКАЕТСЯ_APK, ИЗДАНИЕ_РЕЛИЗА } from '@/platform/appUpdate';
import { useStack } from '@/app/stackCtx';
import { useSnapshot } from '@/sources/bridge';
import { useHealth } from '@/settings/health';
import { поВажности } from '@/domain/screenings';
import { useUpdateState, checkNow, applyUpdate, consumeJustUpdated } from '@/platform/swUpdate';
import { useLoopProfile, LOOP_MODES } from '@/settings/loopProfile';
import { useDeviceConfig, deviceStatus } from '@/settings/deviceConfig';
import { pumpById, sensorById } from '@/domain/catalog';
import Row from '@/ui/Row';
import UnitsModal from '@/sheets/UnitsModal';
import CarbUnitsModal from '@/sheets/CarbUnitsModal';
import Screen from '@/ui/Screen';

export default function Profile() {
  const { theme, setTheme } = useTheme();
  const unit = useUnit();
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [carbUnitsOpen, setCarbUnitsOpen] = useState(false);
  const carbUnit = useCarbUnit();
  const { push, pop } = useStack();
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [apkUrl, setApkUrl] = useState<string | null>(null);
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

  // Нативное обновление (OTA + APK). Веб живёт отдельно — в data/swUpdate.ts.
  const doUpdate = async () => {
    if (updating) return;
    setUpdating(true);
    setUpdateMsg(null);
    setApkUrl(null);

    // Нативка: сначала OTA (JS-бандл, лёгкий путь), потом APK (нативный код).
    if (isNative) {
      const ota = await checkOtaUpdate();
      if (ota === 'updated') return; // применилось → webview перезагрузится сам

      // Android: если по JS всё свежее (или OTA недоступен) — проверяем новый APK.
      if (platform === 'android') {
        const r = await checkNativeUpdate(издание);
        setUpdating(false);
        if (r === 'error') {
          setUpdateMsg(ota === 'current' ? 'У вас последняя версия.' : 'Не удалось проверить обновление.');
          return;
        }
        if (r.hasUpdate && r.apkUrl) {
          setApkUrl(r.apkUrl);
          setUpdateMsg('Нужна новая сборка приложения' + (r.build ? ` (${r.build})` : '') + '.');
        } else if (издание !== ИЗДАНИЕ_РЕЛИЗА) {
          /* «У вас последняя версия» здесь было бы неправдой: про сборки Pro мы не знаем
             ничего — их никто не выпускает. Молчать тоже нельзя, человек нажал кнопку. */
          setUpdateMsg('Обновлено по воздуху. SugarLife.Pro сборками не раздаётся — нативную часть обновляют пересборкой.');
        } else if (!ВЫПУСКАЕТСЯ_APK) {
          /* Не «у вас последняя версия»: про нативную часть мы этого не знаем — новых
             сборок просто нет. Разница важна тому, кто ждёт исправления именно в
             нативном слое и иначе решил бы, что оно уже у него. */
          setUpdateMsg('Обновлено по воздуху. Сборка приложения сейчас не выпускается — нативная часть остаётся прежней.');
        } else {
          setUpdateMsg('У вас последняя версия.');
          window.setTimeout(() => setUpdateMsg(null), 4000);
        }
        return;
      }

      // iOS: APK-пути нет (только App Store), но OTA уже отработал выше.
      setUpdating(false);
      setUpdateMsg(ota === 'current' ? 'У вас последняя версия.' : 'Не удалось проверить обновление.');
      if (ota === 'current') window.setTimeout(() => setUpdateMsg(null), 4000);
      return;
    }
  };

  /* Состояние обновления веб-версии. Четыре ответа на три вопроса, которые раньше
     оставались без ответа: есть ли обновление, применилось ли, нужна ли перезагрузка. */
  const upd = useUpdateState();
  const [justUpdated, setJustUpdated] = useState(() => consumeJustUpdated()); // разово после перезагрузки
  // «Обновлено до X» держится, пока человек не начал новую проверку — иначе оно
  // висело бы всю сессию и перекрывало «Проверяю…» и ошибки
  useEffect(() => {
    if (upd.status === 'checking' || upd.status === 'available') setJustUpdated(false);
  }, [upd.status]);
  const agoMin = upd.checkedAt ? Math.round((Date.now() - upd.checkedAt) / 60000) : null;
  const webUpdateNote = justUpdated ? `Обновлено до сборки ${APP_BUILD}.`
    : upd.status === 'available' ? 'Новая версия скачана. Применится после перезагрузки.'
    : upd.status === 'checking' ? 'Проверяю…'
    : upd.status === 'error' ? 'Не удалось проверить — похоже, нет сети.'
    : upd.status === 'unsupported' ? 'Автообновление недоступно — обновите страницу вручную.'
    : upd.status === 'current' ? `Актуально · проверено ${agoMin != null && agoMin > 0 ? agoMin + ' мин назад' : 'только что'}`
    : 'Проверяю…';

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

  const themes: { key: 'system' | 'light' | 'dark'; label: string; icon: string }[] = [
    { key: 'system', label: 'Системная', icon: ellipse },
    { key: 'light', label: 'Светлая', icon: sunny },
    { key: 'dark', label: 'Тёмная', icon: moon },
  ];

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

              «Моё хозяйство» — не сочинённое имя, а то самое общее, которое и раньше
              было записано здесь словами: устройства — железо, облака — транспорт,
              профиль петли — правила счёта, здоровье — то, что человек знает о себе
              сам. Всё вместе — его, работающее, и требующее присмотра.

              Границу ЧТО (устройства) и КАК (сервисы) из docs/CONNECT-UX.md §10 это не
              трогает: разделы разные, входы разные, рядом стоят только строки. */}
          <div className="section-label sec первый">Моё хозяйство</div>
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
          <div className="section-label sec">О приложении</div>
          <div className="about">
            <div className="about-info">
              {/* Имя издания — из движка, если он его назвал (#298). APP_EDITION говорит,
                  чем нас собрали, и в сборке Pro осталась бы надпись «SugarLife.Lite»:
                  строка ниже попадает в сообщения о проблемах, и врать в ней дороже всего. */}
              <div className="about-ver">{издание === 'pro' ? 'SugarLife.Pro' : APP_EDITION} {APP_VERSION}</div>
              <div className="about-build">сборка {APP_BUILD}{isNative ? ' · нативное' : ' · PWA'}</div>
            </div>
            {apkUrl ? (
              <button className="about-update accent" onClick={async () => {
                /* Сначала пробуем поставить сами (#269), и только если плагина нет —
                   открываем браузер. Порядок именно такой: браузерный путь работает
                   всегда, но требует от человека найти файл в «Загрузках». */
                const итог = await installApk(apkUrl);
                if (итог !== 'начали') openApkDownload(apkUrl);
              }}>
                <IonIcon icon={downloadOutline} />
                Скачать APK
              </button>
            ) : isNative ? (
              <button className="about-update" onClick={doUpdate} disabled={updating}>
                <IonIcon icon={refreshOutline} className={updating ? 'spin' : ''} />
                {updating ? 'Проверяю…' : 'Обновиться'}
              </button>
            ) : upd.status === 'available' ? (
              /* кнопка честно предупреждает, что будет перезагрузка */
              <button className="about-update accent" onClick={applyUpdate} disabled={upd.applying}>
                <IonIcon icon={refreshOutline} className={upd.applying ? 'spin' : ''} />
                {upd.applying ? 'Обновляю…' : 'Обновить и перезагрузить'}
              </button>
            ) : (
              <button className="about-update" onClick={checkNow} disabled={upd.status === 'checking'}>
                <IonIcon icon={refreshOutline} className={upd.status === 'checking' ? 'spin' : ''} />
                {upd.status === 'checking' ? 'Проверяю…' : 'Проверить'}
              </button>
            )}
          </div>
          {/* состояние обновления — текстом, а не догадками после нажатия */}
          {!isNative && <div className="metric-note" style={{ marginTop: 8 }}>{webUpdateNote}</div>}
          {isNative && updateMsg && <div className="metric-note" style={{ marginTop: 8 }}>{updateMsg}</div>}

          {/* оформление */}
          <div className="section-label sec">Оформление</div>
          <div className="theme-chips">
            {themes.map((t) => {
              const on = theme === t.key;
              return (
                <button key={t.key} className={'theme-chip' + (on ? ' on' : '')} onClick={() => setTheme(t.key)}>
                  <IonIcon icon={t.icon} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          <button className="logout" onClick={reset}>Сбросить настройки</button>

        <UnitsModal isOpen={unitsOpen} onClose={() => setUnitsOpen(false)} />
        <CarbUnitsModal isOpen={carbUnitsOpen} onClose={() => setCarbUnitsOpen(false)} />
    </Screen>
  );
}

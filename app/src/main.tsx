import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setupIonicReact } from '@ionic/react'

// Рано регистрируем нативный мост: в оболочке ставит window.SugarLifeBridge,
// в браузере — no-op (getBridge подхватит Nightscout-шим).
import './native/sugarLifeBridge'

/* БИБЛИОТЕКА ВЕРНУЛАСЬ (#564, решение владельца).

   Убирали её ради веса первого экрана: 415 → 190 КБ (#405). Экономия оказалась дороже себя —
   смахивание шторок перестало работать вовсе, «Сегодня» стал тормозить на резине, поломки чинились
   по кругу. Владелец: «вводили её как раз для того, чтобы всё начало работать».

   Берём ровно те стили, что были: нормализацию, раскладку, типографику. Своих правил, которые их
   переспоривали бы, мы за это время не завели — свои компоненты (переключатель, поле, крутилка)
   остаются, они ничего не ломали. */
import '@ionic/react/css/core.css'
import '@ionic/react/css/normalize.css'
import '@ionic/react/css/structure.css'
import '@ionic/react/css/typography.css'
import '@ionic/react/css/padding.css'
import '@ionic/react/css/flex-utils.css'
import '@ionic/react/css/palettes/dark.class.css'

/* Наша тема — после стилей библиотеки: токены и правила поверх, а не под. */
import './theme/variables.css'
import './theme/app.css'

import App from '@/app/App'
import { notifyAppReady, запомнитьНативнуюСборку, APP_BUILD, isNative } from '@/platform/appUpdate'
import { отметитьСборку } from '@/sources/дневникStore'
import { следитьЗаРазмером } from '@/platform/размерТекста'
import { завестиСторожа } from '@/platform/rescue'

/* Признак нативной сборки — на корне документа. Раньше его ставил Ionic (`plt-hybrid`), и на нём
   держится настольная рамка: в приложении на телефоне её быть не должно ни при каких признаках. */
if (isNative) document.documentElement.classList.add('натив')

/* Режим iOS на обеих платформах — как было до #405: вид приложения один, и он не должен зависеть
   от того, чей телефон в руках. */
setupIonicReact({ mode: 'ios' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Сообщаем Capgo, что бандл успешно загрузился — иначе он откатит OTA-обновление.
notifyAppReady()

// И себе — из какой сборки собран установленный APK: после OTA это уже не узнать (#238).
запомнитьНативнуюСборку()

/* В дневник — если сборка сменилась с прошлого запуска (#396). «Запрос на обновление»
   человек видел на «Сегодня», и в истории он ищет ответ на «когда же оно приехало». */
отметитьСборку(APP_BUILD)

/* Системный размер текста (#325). На Android rem масштабирует сам браузер, на iOS —
   никто: там про Dynamic Type надо спрашивать и ставить корню руками. */
следитьЗаРазмером()

/* И сторожу запуска — что приложение ожило (public/boot-guard.js, #131). Отсюда, а не
   из App: пока эта строка выполнилась, первый кадр уже нарисован, а любое место внутри
   дерева зависело бы от того, что дерево вообще собралось. */
завестиСторожа()

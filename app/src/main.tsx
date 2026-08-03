import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setupIonicReact } from '@ionic/react'

// Рано регистрируем нативный мост: в оболочке ставит window.SugarLifeBridge,
// в браузере — no-op (getBridge подхватит Nightscout-шим).
import './native/sugarLifeBridge'

/* Базовые стили Ionic */
import '@ionic/react/css/core.css'
import '@ionic/react/css/normalize.css'
import '@ionic/react/css/structure.css'
import '@ionic/react/css/typography.css'
import '@ionic/react/css/padding.css'
import '@ionic/react/css/flex-utils.css'
import '@ionic/react/css/palettes/dark.class.css'

/* Наша тема (токены Nocturne + проброс в Ionic) */
import './theme/variables.css'
import './theme/app.css'

import App from './App.tsx'
import { notifyAppReady } from './data/appUpdate'

setupIonicReact({ mode: 'ios' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Сообщаем Capgo, что бандл успешно загрузился — иначе он откатит OTA-обновление.
notifyAppReady()

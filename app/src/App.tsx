import { Redirect, Route } from 'react-router-dom';
import {
  IonApp, IonIcon, IonLabel, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs,
} from '@ionic/react';
import { IonReactHashRouter } from '@ionic/react-router';
import { barChart, pulse, home, water, personCircle, medkit } from 'ionicons/icons';

import Today from './pages/Today';
import Profile from './pages/Profile';
import Metrics from './pages/Metrics';
import Mon from './pages/Mon';
import Ins from './pages/Ins';
import Connect from './pages/Connect';
import Loader from './pages/Loader';
import InstallPrompt from './components/InstallPrompt';
import HeroPanel from './components/HeroPanel';
import { useStore } from './data/store';
import { detectTherapy } from './data/therapy';

export default function App() {
  const { data, status } = useStore();
  const insIcon = detectTherapy(data) === 'pen' ? medkit : water;

  // Гейт: не подключён → только форма; подключён, но данных ещё нет → лоадер.
  if (status === 'off') return <IonApp><Connect /></IonApp>;
  if (!data && (status === 'idle' || status === 'loading')) return <IonApp><Loader /></IonApp>;

  return (
    <IonApp>
      <IonReactHashRouter>
        <div className="app-shell">
          <HeroPanel />
          <IonTabs>
          <IonRouterOutlet>
            <Route exact path="/today" component={Today} />
            <Route exact path="/metrics" component={Metrics} />
            <Route exact path="/mon" component={Mon} />
            <Route exact path="/ins" component={Ins} />
            <Route exact path="/profile" component={Profile} />
            <Route exact path="/"><Redirect to="/today" /></Route>
          </IonRouterOutlet>

          <IonTabBar slot="bottom">
            <IonTabButton tab="metrics" href="/metrics">
              <IonIcon icon={barChart} />
              <IonLabel>Метрики</IonLabel>
            </IonTabButton>
            <IonTabButton tab="mon" href="/mon">
              <IonIcon icon={pulse} />
              <IonLabel>НМГ</IonLabel>
            </IonTabButton>
            <IonTabButton tab="today" href="/today">
              <IonIcon icon={home} />
              <IonLabel>Сегодня</IonLabel>
            </IonTabButton>
            <IonTabButton tab="ins" href="/ins">
              <IonIcon icon={insIcon} />
              <IonLabel>Инсулин</IonLabel>
            </IonTabButton>
            <IonTabButton tab="profile" href="/profile">
              <IonIcon icon={personCircle} />
              <IonLabel>Профиль</IonLabel>
            </IonTabButton>
          </IonTabBar>
          </IonTabs>
        </div>
      </IonReactHashRouter>
      <InstallPrompt />
    </IonApp>
  );
}

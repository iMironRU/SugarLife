import { Redirect, Route } from 'react-router-dom';
import {
  IonApp, IonIcon, IonLabel, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs,
} from '@ionic/react';
import { IonReactHashRouter } from '@ionic/react-router';
import { barChart, pulse, home, water, personCircle } from 'ionicons/icons';

import Today from './pages/Today';
import Profile from './pages/Profile';
import Metrics from './pages/Metrics';
import Mon from './pages/Mon';
import Placeholder from './pages/Placeholder';

export default function App() {
  return (
    <IonApp>
      <IonReactHashRouter>
        <IonTabs>
          <IonRouterOutlet>
            <Route exact path="/today" component={Today} />
            <Route exact path="/metrics" component={Metrics} />
            <Route exact path="/mon" component={Mon} />
            <Route exact path="/ins" render={() => <Placeholder title="Инсулин" icon="💉" />} />
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
              <IonIcon icon={water} />
              <IonLabel>Инсулин</IonLabel>
            </IonTabButton>
            <IonTabButton tab="profile" href="/profile">
              <IonIcon icon={personCircle} />
              <IonLabel>Профиль</IonLabel>
            </IonTabButton>
          </IonTabBar>
        </IonTabs>
      </IonReactHashRouter>
    </IonApp>
  );
}

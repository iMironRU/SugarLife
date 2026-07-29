import { IonPage, IonContent } from '@ionic/react';

export default function Placeholder({ title, icon }: { title: string; icon: string }) {
  return (
    <IonPage>
      <IonContent fullscreen>
        <div className="placeholder">
          <div className="placeholder-ico">{icon}</div>
          <h2>{title}</h2>
          <p>Экран переносится на Ionic. Скоро будет здесь.</p>
        </div>
      </IonContent>
    </IonPage>
  );
}

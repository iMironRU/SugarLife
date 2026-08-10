import { IonSpinner } from '@ionic/react';

/* Заглушка страницы, пока её код едет.

   Пустой экран во время загрузки читается как «зависло»: человек нажал, что-то
   поехало — и ничего. Поэтому показываем каркас той же формы (заголовок на месте,
   ниже блоки) плюс явный индикатор. Каркас важнее спиннера: он говорит не только
   «идёт», но и «сюда придёт вот это», и не даёт вёрстке прыгнуть, когда придёт.

   Задержка перед показом намеренная. На быстром соединении чанк приезжает за
   десятки миллисекунд, и мелькнувший на мгновение спиннер раздражает сильнее, чем
   его отсутствие. Если успели — человек не увидит ничего лишнего. */
export default function PageLoading({ title }: { title?: string }) {
  return (
    <div className="sheet stack-body">
      <div className="sheet-head">
        <div className="pl-back" />
        <div style={{ flex: 1, minWidth: 0 }}>
          {title ? <div className="sheet-title">{title}</div> : <div className="pl-bar pl-bar-title" />}
          <div className="pl-bar pl-bar-sub" />
        </div>
      </div>

      <div className="pl-body">
        <div className="pl-card" />
        <div className="pl-card pl-card-sm" />
        <div className="pl-card pl-card-sm" />
      </div>

      <div className="pl-spin">
        <IonSpinner name="crescent" />
        <span>Загружаю…</span>
      </div>
    </div>
  );
}

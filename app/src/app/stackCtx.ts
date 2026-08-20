import { createContext, useContext, type ReactNode } from 'react';
import type { Метка } from './разделы';

/* Контекст стека вынесен из stack.tsx намеренно: в файле с компонентом не должно быть
   других экспортов, иначе ломается горячая перезагрузка — правишь хук, а React
   пересоздаёт всё дерево и теряет открытые страницы. */
export interface StackApi {
  /* Метка — что это за раздел, чтобы собрать его заново после перезапуска (#400).
     Необязательна: раздел без метки открывается как раньше, просто не переживёт
     перезагрузку, и восстановление остановится на нём. */
  push: (node: ReactNode, метка?: Метка) => void;
  pop: () => void;
  depth: number;
}

export const StackCtx = createContext<StackApi>({ push: () => {}, pop: () => {}, depth: 0 });

export const useStack = (): StackApi => useContext(StackCtx);


import { createContext, useContext, type ReactNode } from 'react';

/* Контекст стека вынесен из stack.tsx намеренно: в файле с компонентом не должно быть
   других экспортов, иначе ломается горячая перезагрузка — правишь хук, а React
   пересоздаёт всё дерево и теряет открытые страницы. */
export interface StackApi {
  push: (node: ReactNode) => void;
  pop: () => void;
  depth: number;
}

export const StackCtx = createContext<StackApi>({ push: () => {}, pop: () => {}, depth: 0 });

export const useStack = (): StackApi => useContext(StackCtx);


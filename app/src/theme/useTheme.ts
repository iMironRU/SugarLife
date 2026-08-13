import { useEffect, useState, useCallback } from 'react';
import { прочитать, записать } from '@/settings/storage';

type Theme = 'system' | 'light' | 'dark';
const KEY = 'sl.theme';

function apply(theme: Theme) {
  const sysLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const effective = theme === 'system' ? (sysLight ? 'light' : 'dark') : theme;
  const html = document.documentElement;
  html.classList.toggle('ion-palette-dark', effective === 'dark');
  html.classList.toggle('light', effective === 'light');
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (прочитать(KEY) as Theme) || 'dark');

  useEffect(() => { apply(theme); записать(KEY, theme); }, [theme]);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    const onChange = () => { if (theme === 'system') apply('system'); };
    mq?.addEventListener('change', onChange);
    return () => mq?.removeEventListener('change', onChange);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const sysLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
      const eff = t === 'system' ? (sysLight ? 'light' : 'dark') : t;
      return eff === 'light' ? 'dark' : 'light';
    });
  }, []);

  return { theme, setTheme, toggle };
}

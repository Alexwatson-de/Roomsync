// Explicit light/dark choice persists locally; first visit follows OS theme.
// Presentation only: household records are stored in Firebase, not this key.
import { createContext, useContext, useEffect, useState } from 'react';
const ThemeContext = createContext(null);
const KEY = 'roomsync.theme';
function initialTheme() {
  try { const stored = localStorage.getItem(KEY); if (stored === 'light' || stored === 'dark') return stored; } catch { /* blocked browser storage */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  useEffect(() => {
    const onStorage = (event) => { if (event.key === KEY && ['light', 'dark'].includes(event.newValue)) setTheme(event.newValue); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const toggleTheme = () => setTheme((current) => {
    const next = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* theme still works in memory */ }
    return next;
  });
  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return <button type="button" className="btn btn-secondary theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
    <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span><span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
  </button>;
}

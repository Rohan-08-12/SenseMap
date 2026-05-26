import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const THEME_STORAGE_KEY = 'sensorysafe_theme';
const DEFAULT_THEME = 'nature';

const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  resetTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(DEFAULT_THEME);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'calm' || stored === 'nature') {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setThemeState(stored);
        document.documentElement.setAttribute('data-theme', stored);
        return;
      }
      if (stored === 'night') {
        window.localStorage.setItem(THEME_STORAGE_KEY, DEFAULT_THEME);
      }
    } catch {
      // ignore storage errors and fall back to default
    }
    document.documentElement.setAttribute('data-theme', DEFAULT_THEME);
  }, []);

  const applyTheme = useCallback((nextTheme) => {
    setThemeState(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // ignore storage errors
    }
    document.documentElement.setAttribute('data-theme', nextTheme);
  }, []);

  const setTheme = useCallback(
    (nextTheme) => {
      if (nextTheme !== 'calm' && nextTheme !== 'nature') return;
      applyTheme(nextTheme);
    },
    [applyTheme],
  );

  const resetTheme = useCallback(() => {
    applyTheme(DEFAULT_THEME);
  }, [applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resetTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  return useContext(ThemeContext);
}

export const DEFAULT_THEME_ID = DEFAULT_THEME;


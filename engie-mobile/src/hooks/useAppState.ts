import { useState, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export function useAppState() {
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const prevState = useRef(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      prevState.current = appState;
      setAppState(next);
    });
    return () => sub.remove();
  }, [appState]);

  return {
    appState,
    isActive: appState === 'active',
    justBecameActive: appState === 'active' && prevState.current !== 'active',
  };
}

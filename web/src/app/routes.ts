import { useSyncExternalStore } from 'react';
import type { Panel } from './types';

export type AppPath = '/' | '/sync' | '/settings' | '/manage';
export type AppRoute = { pathname: AppPath };

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

export function routeForPath(pathname: string): AppPath {
  if (pathname === '/sync' || pathname === '/settings' || pathname === '/manage') return pathname;
  return '/';
}

function getSnapshot(): AppPath {
  return routeForPath(window.location.pathname);
}

export function useAppRoute() {
  const pathname = useSyncExternalStore(subscribe, getSnapshot, (): AppPath => '/');
  return { pathname } satisfies AppRoute;
}

export function navigate(pathname: AppPath) {
  if (routeForPath(window.location.pathname) === pathname && window.location.pathname === pathname) return;
  window.history.pushState({}, '', pathname);
  notify();
}

export function panelForRoute(pathname: AppPath): Panel {
  if (pathname === '/sync') return 'sync';
  if (pathname === '/settings') return 'settings';
  if (pathname === '/manage') return 'manage';
  return 'vault';
}

export function pathForPanel(panel: Panel): AppPath {
  if (panel === 'sync') return '/sync';
  if (panel === 'settings') return '/settings';
  if (panel === 'manage') return '/manage';
  return '/';
}

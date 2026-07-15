import { useEffect, useRef, type ReactNode } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import Explorer, { type ExplorerProps } from './Explorer';

type WorkspaceShellProps = {
  explorer: ExplorerProps;
  drawerOpen: boolean;
  onDrawerOpen: () => void;
  onDrawerClose: () => void;
  showMobileMenu?: boolean;
  toolbar?: ReactNode;
  feedback?: ReactNode;
  children: ReactNode;
};

type DrawerSwipe = {
  mode: 'open' | 'close';
  startX: number;
  startY: number;
  lastX: number;
  lastTime: number;
  progress: number;
  intent: 'pending' | 'horizontal' | 'vertical';
};

const INTENT_THRESHOLD = 8;
const SETTLE_DURATION = 220;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function WorkspaceShell({ explorer, drawerOpen, onDrawerOpen, onDrawerClose, showMobileMenu = true, toolbar, feedback, children }: WorkspaceShellProps) {
  const appRef = useRef<HTMLElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const swipeRef = useRef<DrawerSwipe | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingProgressRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!drawerOpen || !showMobileMenu) return;

    const mobileViewport = window.matchMedia('(max-width: 720px)');
    const root = document.documentElement;
    const body = document.body;
    let scrollY = 0;
    let locked = false;

    const lockPageScroll = () => {
      if (locked || !mobileViewport.matches) return;
      scrollY = window.scrollY;
      root.classList.add('mobile-drawer-open');
      body.classList.add('mobile-drawer-open');
      body.style.setProperty('--mobile-drawer-scroll-offset', `-${scrollY}px`);
      locked = true;
    };
    const unlockPageScroll = () => {
      if (!locked) return;
      root.classList.remove('mobile-drawer-open');
      body.classList.remove('mobile-drawer-open');
      body.style.removeProperty('--mobile-drawer-scroll-offset');
      window.scrollTo(0, scrollY);
      locked = false;
    };
    const syncPageScrollLock = () => {
      if (mobileViewport.matches) lockPageScroll();
      else unlockPageScroll();
    };

    syncPageScrollLock();
    mobileViewport.addEventListener('change', syncPageScrollLock);
    return () => {
      mobileViewport.removeEventListener('change', syncPageScrollLock);
      unlockPageScroll();
    };
  }, [drawerOpen, showMobileMenu]);

  useEffect(() => {
    const app = appRef.current;
    if (!app) return;

    const isMobileDrawer = () => window.matchMedia('(max-width: 720px)').matches;
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const resetDrawerStyles = () => {
      const drawer = drawerRef.current;
      const scrim = scrimRef.current;
      drawer?.classList.remove('is-dragging', 'is-settling');
      drawer?.style.removeProperty('--drawer-drag-offset');
      scrim?.classList.remove('is-dragging');
      scrim?.style.removeProperty('--drawer-scrim-opacity');
    };
    const renderDrawerPosition = (progress: number) => {
      const drawer = drawerRef.current;
      const scrim = scrimRef.current;
      if (!drawer || !scrim) return;

      const closedOffset = drawer.getBoundingClientRect().width + 16;
      drawer.classList.add('is-dragging');
      drawer.style.setProperty('--drawer-drag-offset', `${-closedOffset * (1 - progress)}px`);
      scrim.classList.add('is-dragging');
      scrim.style.setProperty('--drawer-scrim-opacity', String(progress));
    };
    const scheduleDrawerPosition = (progress: number) => {
      pendingProgressRef.current = progress;
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const nextProgress = pendingProgressRef.current;
        pendingProgressRef.current = null;
        if (nextProgress !== null) renderDrawerPosition(nextProgress);
      });
    };
    const flushDrawerPosition = (progress: number) => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      pendingProgressRef.current = null;
      renderDrawerPosition(progress);
    };
    const settleDrawer = (currentProgress: number, targetProgress: number, shouldOpen: boolean) => {
      const drawer = drawerRef.current;
      if (!drawer) return;

      flushDrawerPosition(currentProgress);
      drawer.classList.add('is-settling');
      const finish = () => {
        if (shouldOpen !== drawerOpen) {
          if (shouldOpen) onDrawerOpen();
          else onDrawerClose();
        }
        window.requestAnimationFrame(resetDrawerStyles);
      };

      if (reducedMotion()) {
        renderDrawerPosition(targetProgress);
        finish();
        return;
      }
      // Establish the current transform first, then animate only the remaining distance.
      void drawer.offsetWidth;
      window.requestAnimationFrame(() => {
        renderDrawerPosition(targetProgress);
        settleTimerRef.current = window.setTimeout(finish, SETTLE_DURATION);
      });
    };
    const isFormControl = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
    const onTouchStart = (event: TouchEvent) => {
      if (!showMobileMenu || !isMobileDrawer() || event.touches.length !== 1 || isFormControl(event.target)) return;
      const touch = event.touches[0];
      const startsInDrawer = event.target instanceof Element && Boolean(event.target.closest('.mobile-explorer'));
      // The reading surface owns the entire horizontal swipe; opening is not edge-only.
      const mode = drawerOpen ? (startsInDrawer ? 'close' : null) : 'open';
      if (!mode) return;

      const now = performance.now();
      swipeRef.current = {
        mode,
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastTime: now,
        progress: drawerOpen ? 1 : 0,
        intent: 'pending',
      };
    };
    const onTouchMove = (event: TouchEvent) => {
      const swipe = swipeRef.current;
      if (!swipe || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const distanceX = touch.clientX - swipe.startX;
      const distanceY = touch.clientY - swipe.startY;

      if (swipe.intent === 'pending') {
        if (Math.abs(distanceY) >= INTENT_THRESHOLD && Math.abs(distanceY) > Math.abs(distanceX)) {
          swipe.intent = 'vertical';
          return;
        }
        const movingTowardDrawer = swipe.mode === 'open' ? distanceX > 0 : distanceX < 0;
        if (Math.abs(distanceX) >= INTENT_THRESHOLD && Math.abs(distanceX) > Math.abs(distanceY) * 1.2 && movingTowardDrawer) {
          swipe.intent = 'horizontal';
        } else {
          return;
        }
      }
      if (swipe.intent !== 'horizontal') return;

      if (event.cancelable) event.preventDefault();
      const drawerWidth = drawerRef.current?.getBoundingClientRect().width || window.innerWidth;
      const progress = swipe.mode === 'open'
        ? clamp(distanceX / drawerWidth, 0, 1)
        : clamp(1 + distanceX / drawerWidth, 0, 1);
      const now = performance.now();
      swipe.progress = progress;
      swipe.lastX = touch.clientX;
      swipe.lastTime = now;
      scheduleDrawerPosition(progress);
    };
    const onTouchEnd = (event: TouchEvent) => {
      const swipe = swipeRef.current;
      swipeRef.current = null;
      if (!swipe || swipe.intent !== 'horizontal' || event.changedTouches.length !== 1) return;

      const touch = event.changedTouches[0];
      const elapsed = Math.max(performance.now() - swipe.lastTime, 1);
      const velocity = (touch.clientX - swipe.lastX) / elapsed;
      const flingTowardOpen = swipe.mode === 'open' ? velocity > 0.35 : velocity < -0.35;
      const shouldOpen = swipe.mode === 'open'
        ? flingTowardOpen || swipe.progress >= 0.24
        : !(flingTowardOpen || swipe.progress <= 0.76);
      settleDrawer(swipe.progress, shouldOpen ? 1 : 0, shouldOpen);
    };
    const onTouchCancel = () => {
      const swipe = swipeRef.current;
      swipeRef.current = null;
      if (swipe?.intent === 'horizontal') settleDrawer(swipe.progress, drawerOpen ? 1 : 0, drawerOpen);
    };

    app.addEventListener('touchstart', onTouchStart, { passive: true });
    app.addEventListener('touchmove', onTouchMove, { passive: false });
    app.addEventListener('touchend', onTouchEnd, { passive: true });
    app.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      app.removeEventListener('touchstart', onTouchStart);
      app.removeEventListener('touchmove', onTouchMove);
      app.removeEventListener('touchend', onTouchEnd);
      app.removeEventListener('touchcancel', onTouchCancel);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
      resetDrawerStyles();
    };
  }, [drawerOpen, onDrawerClose, onDrawerOpen, showMobileMenu]);

  return <main ref={appRef} className="vault-app">
    <aside className="desktop-explorer"><Explorer {...explorer} /></aside>
    <section className="vault-workspace">
      {feedback}
      <header className="minimal-topbar">
        {showMobileMenu && <button type="button" className="floating-button" onClick={onDrawerOpen} aria-label="打开文件列表"><PanelLeftOpen size={25} /></button>}
        <div className="topbar-spacer" />
        {toolbar}
      </header>
    {children}
    </section>
    {showMobileMenu && <><div ref={scrimRef} className={`mobile-scrim ${drawerOpen ? 'is-visible' : ''}`} onClick={onDrawerClose} aria-hidden="true" />
      <aside ref={drawerRef} className={`mobile-explorer ${drawerOpen ? 'is-open' : ''}`} aria-hidden={!drawerOpen}>
        <Explorer {...explorer} />
      </aside></>}
  </main>;
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { swipeDirection } from './catalogue';

type SwipeOptions = {
  enabled: boolean;
  onSwipe: (step: number) => void;
  onStart?: () => void;
  onMove?: () => void;
  onDrag?: (distance: number) => void;
};

// Finger gestures use Touch Events, independently of mouse/pen pointer capture.
// A browser can cancel the pointer stream when it starts scrolling while the
// touch stream still contains the release needed to finish a horizontal swipe.
export function useProductSwipe<T extends HTMLElement>(options: SwipeOptions) {
  const [element, setElement] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setElement(node), []);
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    if (!element) return;
    let gesture: { id: number; x: number; y: number; start: number; locked: boolean } | null = null;
    const reset = () => {
      gesture = null;
      latest.current.onDrag?.(0);
    };
    const start = (event: TouchEvent) => {
      reset();
      if (event.touches.length !== 1) {
        latest.current.onMove?.();
        return;
      }
      if (!latest.current.enabled) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('a,input,select,textarea,[contenteditable="true"]')) return;
      const button = target.closest('button');
      if (button && !button.classList.contains('photo-open')) return;
      const touch = event.touches[0];
      // Leave the browser's back/forward edge gestures available.
      if (touch.clientX < 16 || touch.clientX > innerWidth - 16) return;
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        start: performance.now(),
        locked: false,
      };
      latest.current.onStart?.();
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (!latest.current.enabled || event.touches.length !== 1) {
        latest.current.onMove?.();
        reset();
        return;
      }
      const touch = Array.from(event.touches).find((item) => item.identifier === gesture?.id);
      if (!touch) return;
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (Math.abs(dx) > 12 || Math.abs(dy) > 12) latest.current.onMove?.();
      if (!gesture.locked && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
        reset();
        return; // Vertical motion belongs to the scrolling page.
      }
      if (!gesture.locked && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.6)
        gesture.locked = true;
      if (gesture.locked) {
        if (event.cancelable) event.preventDefault();
        latest.current.onDrag?.(dx);
      }
    };
    const end = (event: TouchEvent) => {
      const finished = gesture;
      reset();
      if (!finished || !finished.locked || !latest.current.enabled || event.touches.length) return;
      const touch = Array.from(event.changedTouches).find(
        (item) => item.identifier === finished.id,
      );
      if (!touch) return;
      // Suppress the delayed compatibility click that otherwise opens the photo.
      if (event.cancelable) event.preventDefault();
      const step = swipeDirection(
        touch.clientX - finished.x,
        touch.clientY - finished.y,
        performance.now() - finished.start,
      );
      if (step) latest.current.onSwipe(step);
    };
    const cancel = () => {
      latest.current.onMove?.();
      reset();
    };
    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end, { passive: false });
    element.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', cancel);
    };
  }, [element]);
  return ref;
}

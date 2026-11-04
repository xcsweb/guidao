import { useEffect, useRef, useState } from 'react';
import { store, useAppState } from '@/state/store';

let toastTimer = 0;

export function showToast(message: string): void {
  store.patch({ toast: message });
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => store.patch({ toast: null }), 3600);
}

export function Toast() {
  const state = useAppState();
  const [text, setText] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const hideTimer = useRef(0);

  useEffect(() => {
    if (state.toast) {
      setText(state.toast);
      setLeaving(false);
      return;
    }
    if (!text) return;
    setLeaving(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setText(null);
      setLeaving(false);
    }, 260);
    return () => window.clearTimeout(hideTimer.current);
  }, [state.toast, text]);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  if (!text) return null;

  return (
    <div className={`toast${leaving ? ' is-leaving' : ' is-visible'}`} role="status" aria-live="polite">
      <span className="toast-dot" aria-hidden="true" />
      {text}
    </div>
  );
}

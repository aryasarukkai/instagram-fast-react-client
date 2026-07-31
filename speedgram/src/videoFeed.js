import { useSyncExternalStore } from 'react';

// Feed video sound is sticky for the whole app session: muted-by-default, and once
// the user unmutes, every autoplaying feed/reel video stays unmuted until the app
// is reloaded — matching Instagram's and TikTok's web behavior. State lives in this
// module (not React context) so it survives route changes but resets on reload.
let muted = true;
const listeners = new Set();

const emit = () => listeners.forEach((listener) => listener());

export const getFeedMuted = () => muted;

export const setFeedMuted = (next) => {
  const value = Boolean(next);
  if (value === muted) return;
  muted = value;
  emit();
};

export const toggleFeedMuted = () => setFeedMuted(!muted);

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** React binding for the shared feed-mute state. */
export const useFeedMuted = () => useSyncExternalStore(subscribe, getFeedMuted);

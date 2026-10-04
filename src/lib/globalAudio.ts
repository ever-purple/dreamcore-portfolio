const STORAGE_KEY = 'dreamcore.sound-muted';
const EVENT = 'dreamcore:sound-muted';
const previousMuted = new WeakMap<HTMLMediaElement, boolean>();

export function isGlobalMuted(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY) === '1';
}

function mediaElements(): HTMLMediaElement[] {
  return Array.from(document.querySelectorAll<HTMLMediaElement>('audio,video'));
}

function applyToMedia(muted: boolean) {
  for (const media of mediaElements()) {
    if (muted) {
      if (!previousMuted.has(media)) previousMuted.set(media, media.muted);
      media.muted = true;
    } else {
      media.muted = previousMuted.get(media) ?? media.muted;
      previousMuted.delete(media);
    }
  }
}

export function setGlobalMuted(muted: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  applyToMedia(muted);
  window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: muted }));
}

export function subscribeGlobalMuted(listener: (muted: boolean) => void): () => void {
  const onChange = (event: Event) => listener((event as CustomEvent<boolean>).detail);
  window.addEventListener(EVENT, onChange);
  listener(isGlobalMuted());
  return () => window.removeEventListener(EVENT, onChange);
}

/** 新媒体元素开始播放时也服从当前的全局静音状态。 */
export function installGlobalMediaGuard(): () => void {
  const onPlay = (event: Event) => {
    if (!isGlobalMuted() || !(event.target instanceof HTMLMediaElement)) return;
    const media = event.target;
    if (!previousMuted.has(media)) previousMuted.set(media, media.muted);
    media.muted = true;
  };
  document.addEventListener('play', onPlay, true);
  applyToMedia(isGlobalMuted());
  return () => document.removeEventListener('play', onPlay, true);
}

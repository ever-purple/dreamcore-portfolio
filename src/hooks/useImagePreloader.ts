import { useEffect, useRef, useState } from 'react';

interface PreloaderState {
  loaded: number;
  total: number;
  progress: number;
  complete: boolean;
  images: HTMLImageElement[];
}

export function useImagePreloader(frameUrls: string[], enabled: boolean = true): PreloaderState {
  const [state, setState] = useState<PreloaderState>({
    loaded: 0,
    total: frameUrls.length,
    progress: 0,
    complete: false,
    images: [],
  });
  const imagesRef = useRef<HTMLImageElement[]>([]);

  useEffect(() => {
    if (!enabled) return;

    setState((s) => ({ ...s, total: frameUrls.length, complete: false, loaded: 0, progress: 0 }));
    imagesRef.current = [];

    const images: HTMLImageElement[] = [];
    let loadedCount = 0;

    const updateProgress = () => {
      loadedCount += 1;
      const progress = frameUrls.length > 0 ? loadedCount / frameUrls.length : 1;
      setState({
        loaded: loadedCount,
        total: frameUrls.length,
        progress,
        complete: loadedCount === frameUrls.length,
        images,
      });
    };

    const onError = () => {
      // Count errors as loaded so we don't block forever
      loadedCount += 1;
      const progress = frameUrls.length > 0 ? loadedCount / frameUrls.length : 1;
      setState({
        loaded: loadedCount,
        total: frameUrls.length,
        progress,
        complete: loadedCount === frameUrls.length,
        images,
      });
    };

    frameUrls.forEach((src, i) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
      images[i] = img;

      if (img.complete && img.naturalWidth !== 0) {
        updateProgress();
      } else {
        img.onload = updateProgress;
        img.onerror = onError;
      }
    });

    imagesRef.current = images;

    return () => {
      images.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });
    };
  }, [frameUrls, enabled]);

  return state;
}

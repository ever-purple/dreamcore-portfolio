import { useRef, useState } from 'react';
import { PlaybackBar } from './PlaybackBar';
import './first-mix-video.css';

export function FirstMixVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(60.743);
  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => setPlaying(false));
    else video.pause();
  };
  const format = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  return (
    <figure className="first-mix-video">
      <video
        ref={ref}
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setTime(ref.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(ref.current?.duration || 60.743)}
        playsInline
        preload="none"
        poster="/product/first-mix-promo-cover.jpg"
        aria-label="FIRST MIX 产品演示视频"
      >
        <source src="/product/first-mix-promo-clean.mp4" type="video/mp4" />
        <a href="/product/first-mix-promo-clean.mp4">观看 FIRST MIX 产品演示</a>
      </video>
      <PlaybackBar playing={playing} live={time > 0 || playing} progress={time / duration} timeText={format(time)} length={format(duration)} onToggle={toggle} onSeek={(ratio) => { if (ref.current) ref.current.currentTime = Math.max(0, Math.min(1, ratio)) * duration; }} />
    </figure>
  );
}

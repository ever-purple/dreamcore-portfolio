import { useEffect, useRef, useState } from 'react';
import { FirstMixVideo } from './FirstMixVideo';
import { useEscape } from '@/lib/escape-stack';

export function FirstMixVideoDrawer() {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const close = () => {
    dialog.current?.querySelector('video')?.pause();
    setOpen(false);
    timer.current = setTimeout(() => { dialog.current?.close(); trigger.current?.focus(); }, 280);
  };
  useEscape(close, open);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <div className="first-mix-drawer-anchor">
    <button ref={trigger} className="first-mix-drawer-trigger" type="button" aria-label={open ? "收起视频" : "展开视频"} title={open ? "收起视频" : "展开视频"} aria-haspopup="dialog" aria-expanded={open} onClick={() => {
      if (open) { close(); return; }
      if (timer.current) clearTimeout(timer.current);
      dialog.current?.show();
      requestAnimationFrame(() => setOpen(true));
    }}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={open ? "M15 5 8 12l7 7" : "m9 5 7 7-7 7"} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>
    <dialog ref={dialog} className={`first-mix-drawer${open ? ' is-open' : ''}`} aria-label="FIRST MIX 视频预览" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (event.clientX < r.left) close(); } }}>
      <header><span>FIRST MIX / FILM</span><button type="button" onClick={close} autoFocus>← 收起</button></header>
      <FirstMixVideo />
    </dialog>
  </div>;
}

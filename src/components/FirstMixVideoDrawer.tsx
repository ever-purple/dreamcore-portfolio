import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  return <>
    <button ref={trigger} className="first-mix-drawer-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => {
      if (timer.current) clearTimeout(timer.current);
      dialog.current?.show();
      requestAnimationFrame(() => setOpen(true));
    }}><span>观看视频</span><small>01:01</small><span aria-hidden="true">←</span></button>
    {createPortal(<dialog ref={dialog} className={`first-mix-drawer${open ? ' is-open' : ''}`} aria-label="FIRST MIX 视频预览" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (event.clientX < r.left) close(); } }}>
      <header><span>FIRST MIX / FILM</span><button type="button" onClick={close} autoFocus>收起 →</button></header>
      <FirstMixVideo />
    </dialog>, document.body)}
  </>;
}

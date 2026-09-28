import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { IS_ADMIN, urlAdminOverride } from '@/config';
import { GATE_ENABLED, checkKey, isUnlocked } from '@/lib/authorAuth';

/**
 * 作者 / 访客 模式的唯一来源（Single Source of Truth）。
 *
 * 背景：以前各面板各写各的，导致「3D 木马是作者模式、Green OS 是访客模式」这种
 * 不一致。现在全站只认这里的 isAdmin —— 木马「＋提交项目」、「编辑项目」、
 * About「灵感收藏」的上传/删除，全都走 useAdmin()，切一次模式整站同步。
 *
 * 初始值优先级：URL ?admin=1/0  >  localStorage 记忆  >  config 兜底(IS_ADMIN)
 * 切换时写回 URL + localStorage，刷新后保持。
 */
const STORAGE_KEY = 'dreamcore:mode';

export type AdminMode = 'author' | 'guest';

export type AdminState = {
  /** true = 作者（可编辑）；false = 访客（纯只读） */
  isAdmin: boolean;
  mode: AdminMode;
  setMode: (next: boolean) => void;
  toggle: () => void;
  /** 输口令开作者模式。口令不对返回 false */
  unlock: (key: string) => boolean;
};

function readInitialMode(): boolean {
  if (typeof window === 'undefined') return IS_ADMIN;
  // 开了口令门：只认 cookie，别的都不认（生产里 ?admin=1 也被 config 挡掉了）
  if (GATE_ENABLED) return isUnlocked();
  const override = urlAdminOverride();
  if (override !== null) return override;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch {
    /* 隐私模式 / 禁用存储时忽略 */
  }
  return IS_ADMIN;
}

function persistMode(isAdmin: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, isAdmin ? '1' : '0');
  } catch {
    /* 忽略 */
  }
  const url = new URL(window.location.href);
  url.searchParams.set('admin', isAdmin ? '1' : '0');
  window.history.replaceState(null, '', url.toString());
}

const AdminCtx = createContext<AdminState>({
  isAdmin: IS_ADMIN,
  mode: IS_ADMIN ? 'author' : 'guest',
  setMode: () => {},
  toggle: () => {},
  unlock: () => false,
});

export function AdminProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState<boolean>(readInitialMode);

  const setMode = useCallback((next: boolean) => {
    // 开了口令门、又还没解锁：不许绕过口令直接切过去
    if (next && GATE_ENABLED && !isUnlocked()) return;
    setIsAdmin(next);
    persistMode(next);
  }, []);

  const toggle = useCallback(() => {
    setIsAdmin((prev) => {
      const next = !prev;
      persistMode(next);
      return next;
    });
  }, []);

  /** 口令校验 + 进入。口令不对就保持访客模式 */
  const unlock = useCallback((key: string) => {
    if (!checkKey(key)) return false;
    setIsAdmin(true);
    persistMode(true);
    return true;
  }, []);

  const value = useMemo<AdminState>(
    () => ({
      isAdmin,
      mode: isAdmin ? 'author' : 'guest',
      setMode,
      toggle,
      unlock,
    }),
    [isAdmin, setMode, toggle, unlock],
  );

  return <AdminCtx.Provider value={value}>{children}</AdminCtx.Provider>;
}

/** true = 作者（可编辑）；false = 访客（纯只读） */
export function useAdmin(): boolean {
  return useContext(AdminCtx).isAdmin;
}

/** 需要「切换按钮」时用它拿 setMode / toggle / mode */
export function useAdminMode(): AdminState {
  return useContext(AdminCtx);
}

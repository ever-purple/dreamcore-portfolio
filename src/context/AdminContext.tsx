import { createContext, useContext, type ReactNode } from 'react';
import { IS_ADMIN } from '@/config';

/**
 * 权限上下文：把「当前是不是作者」往下传。
 * 灵感收藏面板用它决定显不显示上传框 / 删除按钮；
 * 以后其它面板（留言板管理、角色卡编辑……）也能直接 useAdmin() 复用，不用各写一遍。
 */
const AdminCtx = createContext<boolean>(IS_ADMIN);

export function AdminProvider({ children }: { children: ReactNode }) {
  return <AdminCtx.Provider value={IS_ADMIN}>{children}</AdminCtx.Provider>;
}

/** true = 作者（可编辑）；false = 访客（纯只读） */
export function useAdmin(): boolean {
  return useContext(AdminCtx);
}

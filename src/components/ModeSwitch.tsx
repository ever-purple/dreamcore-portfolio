import { useAdminMode } from '@/context/AdminContext';

/**
 * 作者 / 访客模式切换徽标。
 *
 * 固定在视口顶部中央，压在所有浮层之上（工作室 / 3D 木马 / Green OS / 案例面板），
 * 所以在任何页面都能一眼看清"现在是哪种模式"，点一下即可切换。
 *
 * 这不只是个开关，也是"模式明确化"的可视证据：
 *   作者模式 → 薄荷绿 + 可编辑（木马「＋提交项目」、案例「编辑项目」、灵感收藏上传/删除）
 *   访客模式 → 灰色 + 只读（上述编辑入口全部不渲染）
 */
export function ModeSwitch() {
  const { isAdmin, toggle } = useAdminMode();

  return (
    <button
      type="button"
      className={`mode-switch ${isAdmin ? 'is-author' : 'is-guest'}`}
      onClick={toggle}
      aria-pressed={isAdmin}
      title={
        isAdmin
          ? '当前：作者模式（可编辑）。点击切换为访客模式'
          : '当前：访客模式（只读）。点击切换为作者模式'
      }
    >
      <span className="mode-switch-dot" aria-hidden="true" />
      <span className="mode-switch-label">{isAdmin ? '作者模式' : '访客模式'}</span>
      <span className="mode-switch-hint">{isAdmin ? '可编辑' : '只读'}</span>
      <span className="mode-switch-flip" aria-hidden="true">
        ⇄
      </span>
    </button>
  );
}

import type { StudioObject } from '@/data/studio';

type Props = {
  object: StudioObject;
  onSelect?: (object: StudioObject) => void;
  onHoverChange?: (id: StudioObject['id'], hovering: boolean) => void;
};

/**
 * 物件触发点：一个小圆形隐形感应区（比脉冲点略大），
 * 圆心常显示脉冲点；鼠标进入后点原地淡出，弹出
 * uiverse 风格 tooltip 按钮（按钮 = 物体名，tooltip = 作品集板块）。
 * 弹出的按钮是感应区的子元素，移到按钮上不会中断 hover。
 */
export function ObjectZone({ object, onSelect, onHoverChange }: Props) {
  const { point } = object;
  return (
    <div
      className="studio-zone absolute"
      style={{ left: `${point.x}%`, top: `${point.y}%` }}
      onMouseEnter={() => onHoverChange?.(object.id, true)}
      onMouseLeave={() => onHoverChange?.(object.id, false)}
    >
      {/* 薄荷绿脉冲提醒点：常驻感应区中心，悬停时原地淡出 */}
      <span className="pulse-dot" aria-hidden="true" />

      <div className="studio-zone-pop">
        <button
          type="button"
          className="studio-btn"
          onClick={() => onSelect?.(object)}
        >
          <span className="studio-tooltip">{object.target}</span>
          {object.name}
        </button>
      </div>
    </div>
  );
}

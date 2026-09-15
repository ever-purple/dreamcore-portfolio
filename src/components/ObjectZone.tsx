import type { StudioObject } from '@/data/studio';
import { HandFrame } from '@/components/HandFrame';

type Props = {
  object: StudioObject;
  onSelect?: (object: StudioObject) => void;
  onHoverChange?: (id: StudioObject['id'], hovering: boolean) => void;
};

/**
 * 物件触发点：一个小圆形隐形感应区（比脉冲点略大），
 * 圆心常显示脉冲点；鼠标进入后点原地淡出，弹出标签按钮
 * （按钮 = 物体名，上方 = 作品集板块）。
 *
 * 2026-09-15 改版：原来是 uiverse 那种**实色** tooltip（奶白块 + 深色圆角按钮）。
 * 用户指着工作室截图说「把这种硬色块，改成跟光标一样的手写圆圈和方框」——
 * 于是两处都换成手绘描边（`HandFrame`）：
 *   · 物体名（About Me / Works / Creative Lab…）→ 手写**方框**
 *   · 板块名（个人信息 / 策划项目 …）→ 手绘**圆圈**
 * 笔画与跟随光标的那两笔同一个 path，风格完全一致；无填充、无阴影、无箭头。
 *
 * 2026-09-15 再改：用户看了截图说「把英文的圈去掉，中文的留着」——
 * 于是物体名那层的方框取消，只留手写体（Caveat）文本（`.studio-btn__name`，无描边）；
 * 板块名的手绘圆圈（`.studio-tooltip`）原样保留。
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
          {/* 板块名 → 手绘圆圈（浮在按钮上方） */}
          <HandFrame shape="ring" className="studio-tooltip">
            {object.target}
          </HandFrame>
          {/* 物体名 → 只留手写字，不加框（2026-09-15：用户要求英文的圈去掉） */}
          <span className="studio-btn__name">{object.name}</span>
        </button>
      </div>
    </div>
  );
}

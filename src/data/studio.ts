export type StudioObject = {
  id: 'computer' | 'notebook' | 'carousel' | 'newsstand';
  /** 按钮上显示的物体名称 */
  name: string;
  /** 弹出 tooltip 显示的作品集板块 */
  target: string;
  /** 触发点（相对场景容器的百分比中心）：脉冲点与弹出按钮的共同位置 */
  point: { x: number; y: number };
};

/**
 * 四个工作室物件 —— 单一数据源。
 * 每个物件在 point 处有一个小圆形感应区（直径见 CSS .studio-zone）：
 * 平时中心显示薄荷绿脉冲点，鼠标进入小圆后点原地淡出、
 * 点击按钮在同一位置弹出（按钮 = 物体名，tooltip = 板块）。
 */
export const studioObjects: StudioObject[] = [
  {
    id: 'computer',
    name: 'About Me',
    target: '个人信息',
    // 14.5 / 46.5 不是估的：把 studio-loop 的画帧画到 canvas 上逐点读亮度扫出来的
    // （屏幕是画面里最暗的那条竖带，x 13.4~15.9%、y 37~56%）。
    // 这个点同时是感应区圆心、脉冲点、以及"镜头扎进屏幕"的 transform-origin ——
    // 错 1%，放大 12 倍之后终点就偏 12% 的视口宽，所以必须压在屏幕正中。
    point: { x: 14.5, y: 46.5 },
  },
  {
    id: 'notebook',
    name: 'Thinking / Process',
    target: '实习与思考',
    point: { x: 61.5, y: 86 },
  },
  {
    id: 'carousel',
    name: 'Works',
    target: '策划项目',
    point: { x: 53.5, y: 40.5 },
  },
  {
    id: 'newsstand',
    name: 'Creative Lab',
    target: '视频与 AI 作品',
    point: { x: 86.5, y: 40 },
  },
];

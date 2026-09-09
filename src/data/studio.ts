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
    name: 'Computer',
    target: 'About Me · 个人信息',
    point: { x: 12, y: 47.5 },
  },
  {
    id: 'notebook',
    name: 'Notebook',
    target: 'Thinking / Process · 实习与思考',
    point: { x: 61.5, y: 86 },
  },
  {
    id: 'carousel',
    name: 'Carousel',
    target: 'Works · 策划项目',
    point: { x: 53.5, y: 40.5 },
  },
  {
    id: 'newsstand',
    name: 'Newsstand',
    target: 'Creative Lab · 视频与 AI 作品',
    point: { x: 86.5, y: 40 },
  },
];

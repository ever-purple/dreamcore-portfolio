/**
 * Win95 风格像素鼠标指针（由 _park/make_cursor.py 生成，勿手改）。
 *
 * 用 PNG 而不是 SVG 的原因：SVG 光标在缩放/HiDPI 下容易被插值糊掉，
 * 而这里要的就是硬边像素感；PNG 每个逻辑像素放大 2 倍写死，永远 crisp。
 * 内联成 data URI 是为了不额外发一个请求 —— 光标必须首帧就到位。
 */
export const PIXEL_CURSOR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAkCAYAAACXOioTAAAAbElEQVR42u3XOQ4AIAgEQP7/aa3sFK9dFxJJKM00XJqZlUHC4y3UgglqICaohRhgDAgJxoIQYEzoBowNnYA5oB0wF7QC5oQ8MDfUAT8kgpwDFFsM19DsIaxh6dDCcNwFRdDBanZBKcT6yGmgCtV68WM8CL+BAAAAAElFTkSuQmCC';

/** 指针热点（左上角） */
export const PIXEL_CURSOR_HOTSPOT = '0 0';

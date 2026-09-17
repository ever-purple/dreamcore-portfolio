/**
 * 「牵牛花」字符画（牵牛花 / Ipomoea）—— 2026-09-17
 *
 * 来源：用户给的参考图（批注"转字符""加颜色"）。那不是方块像素，
 * 是**用字符密度拼出轮廓** —— 所以这里不走 mask，直接排真字符。
 *
 * 牵牛花的辨识点（照这两条画的）：
 *   ① **正面喇叭口**：一圈外缘实边 + 5 道从边缘指向花心的花瓣褶（最好认的特征），
 *      花心（喉部）最亮；
 *   ② **卷须**：牵牛花是藤本，那根螺旋是它的第二张脸 —— 配一根短茎把花和卷须连起来。
 *
 * 怎么生成（脚本已删，参数留档，要重做就照这个来）：
 *   视觉坐标 42 × 28 个字符格（每格 1:2 瘦高，所以视觉画布是 42 × 56）。
 *   1. 花冠：圆心 (21, 13.25)、半径 9.75；亮度 = 0.30 + 0.70·(1-t)^1.25，
 *      外缘一环（t>0.90）压到 1.0，5 道褶（角差 < 0.070 rad）压到 0.10 —— **褶是暗线**，
 *      比周围稀才读得出"沟"；
 *   2. 花茎：二次贝塞尔 (14.5,21) → (15,26) → (20,27)，半宽 0.6，亮度 0.85；
 *   3. 卷须：对数螺旋，中心 (23,27)、半径 1.0→3.7、1.7 圈，半宽 0.525，亮度 0.90；
 *   4. 每个采样点按亮度取 67 级字符梯度 —— 密度自然堆出立体感。
 *
 * ⚠️ 字符里有 \\ 和 ` 和 ${，改动时别把模板字符串的转义弄坏。
 */
export const ASCII_FLOWER = `              ;??u]\`\`]u??;
          ?up$$aaOX::XOaa$$pu?
       ?C$&pUj(||//:://||(jUp&$C?
     |#$pv(|/tfjjrr::rrjjft/|(vp$#|
   ;C$pj|/tjrxnuvvc::cvvunxrjt/|jp$C;
  ;#$U(/tjxnvczXYUJ))JUYXzcvnxjt/(U$#;
 .QMv|/frnvcXUJLQ0O//O0QLJUXcvnrf/|vMQ.
 "::I!?(nvzYJL0ZwqpffpqwZ0LJYzvn(?!I::"
;$&[{?]~+l])vOwpbhaooahbpwOv)]l+~]?{[&$;
u$0(/frncXJuctvCa*W&&W*aCvtcuJXcnrf/(0$u
u$0(/frucXJLOwpko#&%%&#okpwOLJXcurf/(0$u
|$p(/frnvXUC0Zqdho*MM*ohdqZ0CUXvnrf/(p$|
 $$j|tjxucXJL0ZQfZbkkbZfQZ0LJXcuxjt|j$$
 |$a(|tjxucXUCj!JZmwwmZJ!jCUXcuxjt|(a$|
  u$a(|tjrnv|!]JCCLLLLCCJ]!|vnrjt|(a$u
   u$&j|/t/-:[vczXXXXXXzcv[:-/t/|j&$u
    ;#$pj-:I)jrxnnnuunnnxrj)I:-jp$#;
      |L+:+t||/ttfffffftt/||t+:+L|
        .\`p$&pOvc((((((cvOp&$p\`.
            ?uCpp$$$$$$ppCu?
                  {oo:
                   Loq:        :XbMMMbX1
                    fooc{+    XMO1:1r1XMO
                     :{LoooM1 MM   rbM_XMX
                          _Mb bM1   XMrrMb
                           XMO_XMMOMMX:bM1
                            1bMXrrrrrXMb_
                              _rOOOOOr_`;

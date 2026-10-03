# Quick View Version 2 最小参考截图清单

> 只需要四张图：一张 Explore 全景，三张物件区域图。新版室外世界完全依靠文字资产规范和 Pinterest 风格参考重新生成，不上传、不依赖上一版草地或建筑图片。

## 0. 当前截图已经准备完成

实际目录：

```text
C:\Users\sunchenxi\WorkBuddy\2026-09-08-21-15-22\dreamcore-loader-home\visual-reference-captures
```

已整理出的上传文件：

```text
01-explore-room-full.png   1720×967
02-desk-crt-region.png      334×292
03-carousel-region.png      415×610
04-newsstand-region.png    1728×2304
```

检查结论：

- 全景完整，能同时看清 Desk / CRT、Carousel 和 Newsstand，足够说明世界关系。
- Desk / CRT 区域图尺寸较小，但 CRT、桌子和键盘轮廓清楚；需要更多上下文时直接结合全景左侧观察，第一轮无需重截。
- Carousel 图完整包含顶棚、灯带、马匹、立柱和底座，足够使用。
- Newsstand 图完整清楚，能识别展架层级、书刊排列、旧化浅绿色金属和底部结构。
- 四张截图只作为 Explore 物件造型参考，其中自带的颗粒、灰雾、色差和暗部不属于新版外部资产要求。

原始中文文件名仍保留。规范英文文件是副本，可以直接上传。

## 1. 启动 Explore

项目位置：

```text
C:\Users\sunchenxi\WorkBuddy\2026-09-08-21-15-22\dreamcore-loader-home
```

启动：

```powershell
cd C:\Users\sunchenxi\WorkBuddy\2026-09-08-21-15-22\dreamcore-loader-home
npm run dev -- --host 127.0.0.1 --port 4173
```

打开：

```text
http://127.0.0.1:4173/?studio=1
```

如果终端使用了其他端口，把地址中的 `4173` 换成实际端口。

截图要求：

- 浏览器宽度建议 1440px 或 1920px。
- 浏览器缩放 100%。
- PNG 格式。
- 不用手机拍屏。
- 避开鼠标提示、弹窗和菜单。
- 不需要多个光线、角度或细节版本。

## 2. 截图一：Explore 室内全景

文件名：

```text
01-explore-room-full.png
```

要求：

- 截取完整 Explore 室内工作室。
- 同时看见左侧 Desk / CRT、中部 Carousel、右侧 Newsstand。
- 不打开任何内容浮层。
- 不裁掉室内画面的左右边缘。

用途：说明三个物件属于同一个 Explore 世界，并提供大致比例和色彩关系。新版室外世界不复制这张图的室内背景和光线。

## 3. 截图二：Desk / CRT 区域

文件名：

```text
02-desk-crt-region.png
```

位置：Explore 画面左侧，热点中心约 `x 14.5%，y 46.5%`。

要求：

- 包含完整桌子、CRT 外壳和桌面主要物品。
- 尽量包含桌腿或物件下边缘。
- 四周保留少量室内环境以说明比例。
- 不需要再截屏幕、桌脚和光线细节。

用途：新版室外 Desk / CRT 保持该区域的主要造型识别。

## 4. 截图三：Carousel 区域

文件名：

```text
03-carousel-region.png
```

位置：Explore 画面中部，热点中心约 `x 53.5%，y 40.5%`。

取得方式二选一：

1. 直接从 Explore 全景中裁出完整 Carousel。
2. 打开 `http://127.0.0.1:4173/?studio=1&works=1`，截取完整木马。

要求：

- 能看见顶棚、中心立柱、马匹和底座。
- 不裁掉主要结构。
- 不需要多角度和灯带细节图。

用途：保持室外 Carousel 的顶棚轮廓、中心结构、马匹分布和主要配色。

## 5. 截图四：Newsstand 区域

文件名：

```text
04-newsstand-region.png
```

位置：Explore 画面右侧，热点中心约 `x 86.5%，y 40%`。

取得方式二选一：

1. 直接从 Explore 全景中裁出 Newsstand 区域。
2. 打开 `http://127.0.0.1:4173/?studio=1&newsstand=1`，等待加载后截取完整展架。

要求：

- 能看见展架整体轮廓和主要搁板。
- 保留书刊与旧媒介设备混合陈列的特征。
- 不需要设备局部、底座和不同角度。

用途：避免把 Newsstand 误生成便利店、小卖部或普通街边报刊亭。

## 6. 最终文件夹

```text
_visual-reference-captures/
├─ 01-explore-room-full.png
├─ 02-desk-crt-region.png
├─ 03-carousel-region.png
└─ 04-newsstand-region.png
```

本项目实际使用的文件夹名是：

```text
visual-reference-captures/
```

## 7. 交给 ChatGPT

新建生图对话后提供：

1. 《Quick View Version 2 全视觉资产重制规范》。
2. Pinterest 绿色画板链接。
3. 上述四张 Explore 截图。

同时说明：

```text
四张截图只用于保持 Explore 三个物件的造型识别。
外部草地世界、建筑、光线、构图和颜色全部根据资产规范从零设计。
不要参考或索取上一版 Quick View 的草地、建筑、树和前景草图片。
不要从截图复制室内背景，也不要把三个物件直接画进 World Master。
```

## 8. 这四张是否足够

足够完成第一轮资产设计：

- 全景提供三个物件之间的世界关系与比例。
- 三张区域图提供必要造型识别。
- 外部世界有独立的文字规范和 Pinterest 风格参考。
- 光线、焦段、光圈和色调由资产规范统一控制，不需要依靠多张截图猜测。

如果某个生成结果结构明显错误，再只针对该物件补一张局部图，不在开始阶段准备大量截图。

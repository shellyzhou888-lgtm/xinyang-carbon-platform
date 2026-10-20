# 产业园区页面背景图库

这组图片是为“信阳经开区能碳管理平台”后续页面准备的**AI 生成概念视觉**，不代表信阳经开区的真实园区、厂房、规划范围或现场照片。图片中不含文字、标识和真实企业信息。

| 场景 | 前端文件 | 建议用途 |
| --- | --- | --- |
| 晨光鸟瞰 | `/backgrounds/industrial-park-dawn.webp` | 平台首页、总览封面 |
| 夕照步道 | `/backgrounds/industrial-park-golden-hour.webp` | 能源管理、专题页横幅 |
| 蓝调夜景 | `/backgrounds/industrial-park-blue-hour.webp` | 深色仪表盘、登录背景 |
| 林荫主轴 | `/backgrounds/industrial-park-green-boulevard.webp` | 绿色发展、碳管理页面 |

WebP 位于 `apps/web/public/backgrounds/`，宽约 1672 px，原比例接近 16:9，可直接以 `background-size: cover` 使用。高清 PNG 原图位于 `assets/backgrounds/source/`；`contact-sheet.webp` 是四图对照预览，顺序为左上、右上、左下、右下。文字覆盖时建议加深色渐变遮罩并检查移动端裁切；不要把这些概念图标注为园区实景。

## 生成方式与提示词

使用 Codex 内置 `image_gen`，分类为 `photorealistic-natural`，每张单独生成。以下是最终提示词；所有图片均要求横向网页背景、写实建筑摄影、无文字、无 Logo、无水印，且不对应可识别的真实园区。

### 1. 晨光鸟瞰

> A sweeping drone panorama of a contemporary Chinese industrial park at clear early morning. Neat low-rise advanced manufacturing buildings with realistic rooflines, a few rooftop solar arrays, tree-lined internal roads, distant green hills and soft mist. Broad layered view, horizon in the upper third, strong visual depth, generous relatively quiet sky and landscape at the upper left for later interface text, main architecture toward center and right. Warm first sunlight, subtle atmospheric haze, premium architectural photography with natural color and restrained contrast. No readable signage, logos, text, watermark, charts, UI, people, invented landmark or identifiable actual campus.

### 2. 夕照步道

> A ground-level architectural panorama along a landscaped pedestrian greenway in a contemporary industrial campus. On the right, refined low-rise research and light-manufacturing buildings with glass, pale stone and metal facades; on the left, a shallow reflecting pool, reeds, shade trees and distant hills. Calm spacious left third for possible UI text, buildings receding through center and right, dramatic wide lens but believable geometry. Late golden hour, warm sun grazing facades, soft shadows, realistic vegetation, premium editorial architectural photography. No readable signage, logos, text, watermark, people, foreground cars, unrealistic sci-fi structures or identifiable actual campus.

### 3. 蓝调夜景

> Blue-hour panoramic view of a modern low-carbon industrial park just after sunset, seen from a modest elevated viewpoint. Realistic low-rise production facilities and office buildings with a few subtle rooftop solar arrays, tree-lined streets, restrained warm interior lights and a softly glowing horizon. Coherent built environment across the right and lower half; darker quiet blue sky and shaded landscaping in the left third suitable for overlay text. Elegant navy-teal twilight with restrained amber highlights, believable high-end architectural photography, not neon cyberpunk. No readable signage, logos, text, watermark, people, science-fiction or identifiable actual campus.

### 4. 林荫主轴

> Elevated oblique view down a long tree-lined boulevard through a contemporary green industrial park. On both sides are realistic modern light-industry buildings, roof-mounted solar panels, landscaped stormwater gardens and a few distant mountains; clean infrastructure integrated with generous greenery. Strong boulevard leading lines from foreground into the distance, calm space in the upper-left sky and greenery for optional interface text. Bright but softly overcast spring daylight, rich natural greens and cool architectural grays, polished large-format architectural photography. No readable signage, logos, text, watermark, people, implausible giant towers, sci-fi machinery or identifiable actual campus.

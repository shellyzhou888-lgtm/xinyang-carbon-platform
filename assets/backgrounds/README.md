# Frontend background references

The five English-named WebP files in [`reference/`](reference/) are visual references for future front-end backgrounds, each approximately 1672 × 941 px. They are not active page backgrounds.

| File | Origin | Intended reference |
| --- | --- | --- |
| [`user-supplied-sunrise-campus.webp`](reference/user-supplied-sunrise-campus.webp) | First image supplied by the user in this task; converted to WebP without redrawing. Its depicted location is unverified. | Warm sunrise, broad aerial view. |
| [`user-supplied-green-campus.webp`](reference/user-supplied-green-campus.webp) | Second image supplied by the user in this task; converted to WebP without redrawing. Its depicted location is unverified. | Bright green campus with central road. |
| [`wanhua-panorama-redraw.webp`](reference/wanhua-panorama-redraw.webp) | AI reconstruction based on a [737 × 353 real photo](https://q9.itc.cn/q_70/images03/20240914/3f701e9a31984fd9930e52a9bc75d991.png) captioned “信阳万华无醛生态产业园” in this [2024 report](https://www.sohu.com/a/808924403_121375869). | Long industrial hall across a wide frame. |
| [`wanhua-aerial-redraw.webp`](reference/wanhua-aerial-redraw.webp) | AI reconstruction based on a [400 × 332 real photo](https://dzb.henandaily.cn/resfile/2025-10-27/T5/p50_b.jpg) captioned “航拍绿色家居产业龙头万华禾香集团” in [河南日报](https://dzb.henandaily.cn/html5/2025-10/27/content_329_1763563.htm). | Aerial view of plant roofs and surrounding roads. |
| [`yangshan-industrial-park-redraw.webp`](reference/yangshan-industrial-park-redraw.webp) | AI reconstruction based on a [400 × 299 real photo](https://dzb.henandaily.cn/resfile/2025-10-27/T5/p48_b.jpg) captioned “航拍羊山新区产业园” in the [same report](https://dzb.henandaily.cn/html5/2025-10/27/content_329_1763563.htm). The exact site within Yangshan has not been independently confirmed. | Industrial blocks, slender tower and diagonal roads. |

The three redraws preserve each source photo's main building placement and camera direction, while reconstructing missing detail and extending the frame. They are **AI-derived references, not site photographs or reliable records of individual buildings**. The cited report says its images were supplied by the 羊山新区党委宣传统战部; no reuse permission is stated. Keep the images as internal design references until the rights holder supplies approved high-resolution originals or permission for publication. Do not label unrelated 信阳国家高新区 or 豫东南高新区 images as 信阳经开区.

## Redraw prompts

All three images used the built-in Codex image generation tool in edit mode, one source image per output, with a photorealistic-natural reference style and no text or logos.

### Wanhua panorama

> Faithfully redraw and enlarge the supplied low-resolution aerial photo of the Xinyang Wanhua formaldehyde-free ecological industrial park. Preserve the long white industrial hall, repeating grey sawtooth roof strips, processing equipment at far left, multi-story white building at upper right, perpendicular tree-lined roads, flat tree line, and undeveloped green ground. Keep the same aerial view and relative building positions. Recompose only enough for a wide landscape frame, restore plausible photographic detail and natural cool daylight. Do not add mountains, lake, solar panels, skyscrapers, new buildings, signage, text, UI or logos.

### Wanhua aerial

> Redraw the low-resolution authentic aerial photo of the Wanhua Hexiang industrial plant in Xinyang as a high-resolution photographic landscape reference. Preserve the central white and grey sawtooth-roofed production halls, processing equipment at the back, small pale administrative block near the bottom center, divided road on the right, diagonal lower-left road, flat green surroundings and hazy horizon. Extend only plausible adjacent surroundings for a wide frame. Do not add mountains, lake, solar panels, new towers, signage, text or logos.

### Yangshan industrial park

> Redraw the low-resolution aerial photo captioned Yangshan New District industrial park. Preserve the tall slender tower left of center, warm brown mid-rise buildings at its base, long low halls with orange-blue striped roofs, diagonal tree-lined roads, flat green surroundings and lightly hazy skyline. Extend the composition to a wide panorama while keeping relative positions. Restore plausible fine detail and restrained daylight. Do not add mountains, lake, solar roofs, new high-rises, extra towers, text, logos or UI.

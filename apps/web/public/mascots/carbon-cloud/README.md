# 小云语音助手形象

更新日期：2026-10-22（仓库 v0.44.1）。按用户要求移除手持碳捕集瓶，双手空手，保留绿色云朵与笑脸。

- `source.png`：使用内置 `image_gen`，以原透明 PNG 为编辑目标生成的无道具透明原图。
- `animation.gif`：网站默认形象，512 × 512、36 帧、2.52 秒透明循环，轻微浮动与语音波纹；不再生成吸入瓶子的颗粒。
- `poster.png`：相同形象的静态首帧，用于系统减少动态效果偏好。

在仓库根目录运行 `python scripts/render-mascot-gifs.py carbon-cloud` 重新渲染 GIF 和静态首帧，需要 Pillow。

## 完整编辑提示词

```text
Use case: precise-object-edit. Edit target: the provided transparent PNG of the glossy green cloud voice-assistant mascot. Remove ONLY the bottle/canister the mascot is carrying on the viewer's right, including its green handle, leaf symbol and all dark carbon pellets. Leave that rounded green hand naturally empty, with a clean complete silhouette. Preserve the same character identity, cloud outline, smiling closed eyes and open mouth, glossy translucent emerald/jade material, lighting, colors, cute rounded limbs and walking pose. Do not redesign the mascot. Center the full character with transparent padding, no clipping. Real transparent background, no background color, no text, no accessories, no floating particles or replacement object. Deliver a single clean full-body transparent mascot image suitable as the source of a looping website animation.
```

"""Render looping voice-assistant mascot GIFs from the approved PNG cutouts.

Requires Pillow: py -m pip install Pillow
Run from anywhere: py scripts/render-mascot-gifs.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw


ASSETS = Path(__file__).resolve().parents[1] / "apps" / "web" / "public" / "mascots"
SIZE = 512
FRAMES = 36
FRAME_MS = 70
DARK_BG = (11, 29, 26, 255)


def load_character(path: Path, max_width: int, max_height: int) -> Image.Image:
    original = Image.open(path).convert("RGBA")
    bounds = original.getchannel("A").point(lambda value: 255 if value > 8 else 0).getbbox()
    if bounds is None:
        raise ValueError(f"No visible mascot in {path}")
    character = original.crop(bounds)
    ratio = min(max_width / character.width, max_height / character.height)
    return character.resize(
        (round(character.width * ratio), round(character.height * ratio)),
        Image.Resampling.LANCZOS,
    )


def voice_marks(canvas: Image.Image, phase: float, kind: str) -> None:
    draw = ImageDraw.Draw(canvas, "RGBA")

    def arc(cx: int, cy: int, radius: int, start: int, end: int, alpha: int) -> None:
        points = [
            (
                round(cx + radius * math.cos(math.radians(degrees))),
                round(cy + radius * math.sin(math.radians(degrees))),
            )
            for degrees in range(start, end + 1, 5)
        ]
        draw.line(points, fill=(137, 250, 199, alpha), width=3, joint="curve")

    if kind == "thumbs":
        locations = [(48, 193), (464, 193)]
        for center_x, center_y in locations:
            side = 1 if center_x > SIZE / 2 else -1
            for radius in (16, 28):
                pulse = max(0.0, math.sin(phase - radius / 25))
                alpha = round(115 * pulse)
                if alpha < 5:
                    continue
                angles = (-65, 65) if side > 0 else (115, 245)
                arc(center_x, center_y, radius, *angles, alpha)
    else:
        # Three dark particles drift into the bottle in a seamless cycle.
        for offset in (0.0, 0.33, 0.66):
            progress = (phase / (2 * math.pi) + offset) % 1.0
            x = round(507 - 35 * progress)
            y = round(392 - 17 * progress + 3 * math.sin(phase + offset * 6))
            alpha = round(160 * math.sin(math.pi * progress))
            radius = round(4 - 2 * progress)
            for dx in range(-radius, radius + 1):
                for dy in range(-radius, radius + 1):
                    if dx * dx + dy * dy <= radius * radius:
                        canvas.putpixel((x + dx, y + dy), (37, 67, 60, alpha))
        for radius in (17, 28):
            pulse = max(0.0, math.sin(phase - radius / 24))
            alpha = round(105 * pulse)
            if alpha > 5:
                arc(416, 155, radius, -75, 55, alpha)


def make_frames(source: Path, kind: str) -> list[Image.Image]:
    character = load_character(source, 405 if kind == "thumbs" else 450, 408)
    rendered = []
    for index in range(FRAMES):
        phase = 2 * math.pi * index / FRAMES
        bounce = 7 * (1 - math.cos(phase)) / 2
        sway = 1.4 * math.sin(phase)
        stretch = 1 + 0.012 * math.cos(phase * 2)
        moving = character.resize(
            (character.width, round(character.height * stretch)),
            Image.Resampling.LANCZOS,
        ).rotate(sway, Image.Resampling.BICUBIC, expand=True)
        canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        x = round((SIZE - moving.width) / 2 + (2 * math.sin(phase) if kind == "cloud" else 0))
        y = round((SIZE - moving.height) / 2 - bounce)
        canvas.alpha_composite(moving, (x, y))
        voice_marks(canvas, phase, kind)
        rendered.append(canvas)
    return rendered


def save_gif(frames: list[Image.Image], output: Path) -> None:
    # Matte semi-transparent edge pixels to the dashboard background before
    # GIF's one-bit transparency. Animated WebP below retains full alpha.
    flattened = []
    for frame in frames:
        matte = Image.new("RGBA", frame.size, DARK_BG)
        matte.alpha_composite(frame)
        flattened.append(matte.convert("RGB"))
    palette = flattened[0].quantize(colors=254, method=Image.Quantize.FASTOCTREE)
    indexed = []
    for rgb, rgba in zip(flattened, frames):
        image = rgb.quantize(palette=palette)
        transparent = rgba.getchannel("A").point(lambda value: 255 if value < 96 else 0)
        image.paste(255, mask=transparent)
        indexed.append(image)
    indexed[0].save(
        output,
        save_all=True,
        append_images=indexed[1:],
        duration=FRAME_MS,
        loop=0,
        transparency=255,
        disposal=2,
        optimize=False,
    )


def render(name: str, kind: str) -> None:
    frames = make_frames(ASSETS / f"{name}-source.png", kind)
    save_gif(frames, ASSETS / f"{name}.gif")
    frames[0].save(ASSETS / f"{name}-poster.png", optimize=True)
    print(f"Rendered {name}: {FRAMES} frames, {FRAMES * FRAME_MS / 1000:.2f}s loop")


if __name__ == "__main__":
    selected = set(sys.argv[1:] or ["green-thumbs", "carbon-cloud"])
    for name, kind in (("green-thumbs", "thumbs"), ("carbon-cloud", "cloud")):
        if name in selected:
            render(name, kind)

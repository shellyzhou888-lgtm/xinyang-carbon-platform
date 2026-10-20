"""Export the Xinyang energy/carbon platform logo as portable SVG files.

Requires fontTools and Microsoft YaHei Bold on Windows. The font is only used
at build time; the exported wordmark consists of vector paths.
"""

from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont


HERE = Path(__file__).resolve().parent
FONT = Path(r"C:\Windows\Fonts\msyhbd.ttc")
NAME = "信阳经开区能碳管理平台"
VIEW_BOX = "0 0 900 196"


def wordmark_paths(color: str) -> str:
    font = TTFont(FONT, fontNumber=0)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    metrics = font["hmtx"].metrics
    scale = 64 / font["head"].unitsPerEm
    x = 145.0
    paths = []
    for char in NAME:
        glyph_name = cmap[ord(char)]
        pen = SVGPathPen(glyphs)
        glyphs[glyph_name].draw(pen)
        paths.append(
            f'<path d="{pen.getCommands()}" fill="{color}" '
            f'transform="translate({x:.3f} 128) scale({scale:.8f} -{scale:.8f})"/>'
        )
        x += metrics[glyph_name][0] * scale + 1.2
    font.close()
    return "\n  ".join(paths)


def symbol(ring: str, leaf: str, vein: str = "#FFFFFF") -> str:
    return f'''<g fill="none">
    <path d="M147.5 48.5 A70 70 0 1 0 147.5 147.5" stroke="{ring}" stroke-width="19" stroke-linecap="round"/>
    <path d="M90 129 C94 101 114 76 151 68 C153 104 131 129 90 129Z" fill="{leaf}"/>
    <path d="M101 118 C115 102 128 91 143 82" stroke="{vein}" stroke-width="5" stroke-linecap="round"/>
  </g>'''


def svg(content: str, title: str, view_box: str = VIEW_BOX) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}" role="img" '
        f'aria-label="{title}">\n'
        f'  <title>{title}</title>\n  {content}\n</svg>\n'
    )


def main() -> None:
    HERE.mkdir(parents=True, exist_ok=True)
    icon = symbol("#0E9F6C", "#45BD7D")
    small_icon = f'<g transform="translate(20 47) scale(0.52)">{icon}</g>'
    (HERE / "logo-horizontal.svg").write_text(
        svg(small_icon + "\n  " + wordmark_paths("#1C2928"), NAME), encoding="utf-8"
    )
    (HERE / "logo-horizontal-on-dark.svg").write_text(
        svg(
            '<g transform="translate(20 47) scale(0.52)">'
            + symbol("#36D499", "#80E4AD")
            + "</g>\n  "
            + wordmark_paths("#F4F8F6"),
            NAME,
        ),
        encoding="utf-8",
    )
    (HERE / "logo-symbol.svg").write_text(
        svg(icon, "信阳经开区能碳管理平台图形标识", "0 0 196 196"), encoding="utf-8"
    )


if __name__ == "__main__":
    main()

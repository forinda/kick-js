#!/usr/bin/env python3
"""
Generate catchy, on-brand thumbnails for the KickJS tutorials.

Reads the YAML-ish frontmatter from each ``tutorials/*.md`` (title, subtitle,
number, tag, accent) and renders a 1280x720 PNG into ``out/``.

Brand: lightning-bolt logo (amber) on deep indigo, blue->purple gradient.

Usage:
    pip install -r requirements.txt
    python generate_thumbnails.py            # all tutorials
    python generate_thumbnails.py 05-database.md   # one file
"""
from __future__ import annotations

import os
import sys
import glob

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
HERE = os.path.dirname(os.path.abspath(__file__))
TUT_DIR = os.path.dirname(HERE)
OUT_DIR = os.path.join(HERE, "out")

# Brand palette
INDIGO = (30, 27, 75)      # #1E1B4B  logo background
BLUE = (37, 99, 235)       # #2563eb  brand-2
AMBER = (250, 204, 21)     # #FACC15  bolt
WHITE = (245, 247, 255)
MUTED = (175, 185, 215)


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.strip().lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def parse_frontmatter(path: str) -> dict[str, str]:
    """Minimal frontmatter parser — `key: value`, strips quotes. No pyyaml."""
    meta: dict[str, str] = {}
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    if not text.startswith("---"):
        return meta
    block = text.split("---", 2)[1]
    for line in block.splitlines():
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        meta[key.strip()] = val.strip().strip("'").strip('"')
    return meta


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold
        else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf" if bold else "C:\\Windows\\Fonts\\arial.ttf",
    ]
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def lerp(a: tuple, b: tuple, t: float) -> tuple[int, int, int]:
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(accent: tuple[int, int, int]) -> Image.Image:
    """Diagonal indigo -> blue -> accent-tinted gradient."""
    base = Image.new("RGB", (W, H))
    px = base.load()
    far = lerp(BLUE, accent, 0.45)  # bottom-right leans into the accent
    for y in range(H):
        for x in range(0, W, 2):  # step 2 for speed; fill the pair
            t = (x / W + y / H) / 2
            if t < 0.5:
                c = lerp(INDIGO, BLUE, t * 2)
            else:
                c = lerp(BLUE, far, (t - 0.5) * 2)
            px[x, y] = c
            if x + 1 < W:
                px[x + 1, y] = c
    return base


def draw_bolt(d: ImageDraw.ImageDraw, ox: int, oy: int, s: float, color) -> None:
    """A simple lightning bolt polygon, scaled by s, origin top-left (ox, oy)."""
    pts = [(0.55, 0), (0.18, 0.55), (0.45, 0.55), (0.3, 1.0),
           (0.85, 0.4), (0.55, 0.4), (0.78, 0)]
    d.polygon([(ox + x * s, oy + y * s) for x, y in pts], fill=color)


def wrap(d: ImageDraw.ImageDraw, text: str, font, max_w: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if d.textlength(trial, font=font) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def render(meta: dict[str, str], slug: str) -> str:
    accent = hex_to_rgb(meta.get("accent", "#3b82f6"))
    img = gradient(accent)
    d = ImageDraw.Draw(img, "RGBA")

    # Left accent bar
    d.rectangle([0, 0, 14, H], fill=accent)

    # Giant faint number watermark, bottom-right
    num = meta.get("number", "")
    if num:
        nf = load_font(440, bold=True)
        nw = d.textlength(num, font=nf)
        d.text((W - nw - 40, H - 470), num, font=nf, fill=(255, 255, 255, 28))

    # Wordmark: bolt + KICKJS
    draw_bolt(d, 70, 64, 56, AMBER)
    d.text((140, 72), "KICKJS", font=load_font(40, bold=True), fill=WHITE)
    d.text((142, 124), "TUTORIAL", font=load_font(22, bold=True), fill=accent)

    # Tag chip
    tag = meta.get("tag", "")
    if tag:
        tf = load_font(26, bold=True)
        tw = d.textlength(tag.upper(), font=tf)
        d.rounded_rectangle([70, 230, 70 + tw + 44, 230 + 48], radius=24, fill=accent)
        d.text((92, 240), tag.upper(), font=tf, fill=INDIGO)

    # Title (wrapped, bold)
    title = meta.get("title", slug)
    tfont = load_font(96, bold=True)
    lines = wrap(d, title, tfont, max_w=W - 160)
    y = 320
    for line in lines:
        d.text((70, y), line, font=tfont, fill=WHITE)
        y += 104

    # Subtitle
    sub = meta.get("subtitle", "")
    if sub:
        y = min(y + 8, H - 130)
        for line in wrap(d, sub, load_font(40), max_w=W - 220):
            d.text((72, y), line, font=load_font(40), fill=MUTED)
            y += 52

    # Footer URL
    d.text((72, H - 70), "forinda.github.io/kick-js", font=load_font(28, bold=True), fill=accent)

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f"{slug}.png")
    img.save(out, "PNG")
    return out


def main(argv: list[str]) -> int:
    if argv:
        files = [os.path.join(TUT_DIR, a) for a in argv]
    else:
        files = sorted(glob.glob(os.path.join(TUT_DIR, "[0-9]*.md")))
    if not files:
        print("No tutorial markdown files found.")
        return 1
    for path in files:
        meta = parse_frontmatter(path)
        if not meta.get("title"):
            print(f"skip (no frontmatter): {os.path.basename(path)}")
            continue
        slug = os.path.splitext(os.path.basename(path))[0]
        out = render(meta, slug)
        print(f"✓ {os.path.basename(path)} -> {os.path.relpath(out, TUT_DIR)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

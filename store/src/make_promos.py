#!/usr/bin/env python3
"""Generate the Chrome Web Store promo tiles from the icon master.

store/promo-small-440x280.png   (required)
store/promo-marquee-1400x560.png (optional)
Font: Noto Sans (SIL Open Font License).
"""
import pathlib

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
STORE = HERE.parent
FONT_DIR = pathlib.Path('/usr/share/fonts/noto')
ICON = Image.open(HERE / 'icon-master-512.png').convert('RGBA')


def font(weight, size):
    return ImageFont.truetype(str(FONT_DIR / f'NotoSans-{weight}.ttf'), size)


def ambient(w, h):
    """Night-blue base with the icon's three light sources."""
    base = Image.new('RGBA', (w, h), (12, 16, 34, 255))
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    s = min(w, h)
    for fx, fy, fr, col in [
        (0.18, 0.25, 0.55, (255, 160, 60, 255)),
        (0.62, 0.10, 0.50, (140, 90, 255, 255)),
        (0.85, 0.85, 0.60, (40, 200, 220, 255)),
    ]:
        cx, cy, r = fx * w, fy * h, fr * s
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.22))
    return Image.alpha_composite(base, glow)


def glass_pane(img, box, radius):
    """Frost what is behind `box`, lighten it, add a rim and a top highlight."""
    w, h = img.size
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
    frost = img.filter(ImageFilter.GaussianBlur(radius * 0.6))
    frost = Image.alpha_composite(frost, Image.new('RGBA', (w, h), (255, 255, 255, 46)))
    img.paste(frost, (0, 0), mask)
    rim = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(rim).rounded_rectangle(box, radius=radius, outline=(255, 255, 255, 170), width=max(2, h // 180))
    fade = Image.linear_gradient('L').resize((w, h))  # bright top → dim bottom
    rim.putalpha(ImageChops.multiply(rim.split()[3], ImageChops.invert(fade).point(lambda v: 60 + v * 0.75)))
    return Image.alpha_composite(img, rim)


def tile(w, h, icon_size, title_size, sub_size, pane_pad):
    img = ambient(w, h)
    img = glass_pane(img, [pane_pad, pane_pad, w - pane_pad, h - pane_pad], radius=int(h * 0.12))
    icon = ICON.resize((icon_size, icon_size), Image.LANCZOS)
    title_font = font('Bold', title_size)
    sub_font = font('Medium', sub_size)
    title, sub = 'Glasslight', 'Glass & ambient light for YouTube™'
    d = ImageDraw.Draw(img)
    tw = d.textlength(title, font=title_font)
    sw = d.textlength(sub, font=sub_font)
    gap = int(icon_size * 0.28)
    block_w = icon_size + gap + max(tw, sw)
    x0 = int((w - block_w) / 2)
    y_icon = int((h - icon_size) / 2)
    shadow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [x0, y_icon + icon_size * 0.08, x0 + icon_size, y_icon + icon_size * 1.08],
        radius=icon_size * 0.22, fill=(0, 0, 0, 110))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(icon_size * 0.12)))
    img.paste(icon, (x0, y_icon), icon)
    d = ImageDraw.Draw(img)
    tx = x0 + icon_size + gap
    # Measure real ink boxes so the title's descenders never touch the subtitle.
    t_box = d.textbbox((0, 0), title, font=title_font)
    s_box = d.textbbox((0, 0), sub, font=sub_font)
    spacing = int(sub_size * 0.7)
    text_h = (t_box[3] - t_box[1]) + spacing + (s_box[3] - s_box[1])
    ty = int((h - text_h) / 2) - t_box[1]
    d.text((tx, ty), title, font=title_font, fill=(255, 255, 255, 255))
    sy = ty + t_box[3] + spacing - s_box[1]
    d.text((tx, sy), sub, font=sub_font, fill=(236, 238, 245, 235))
    return img.convert('RGB')


tile(440, 280, 104, 44, 15, 18).save(STORE / 'promo-small-440x280.png')
tile(1400, 560, 220, 116, 38, 40).save(STORE / 'promo-marquee-1400x560.png')
print('ok')

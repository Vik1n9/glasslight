#!/usr/bin/env python3
"""Finish a raw 1280×800 capture for the store: verify size, blur the
signed-in account avatar (top-right), save as PNG.

usage: finish_screenshot.py <raw.jpg> <store/screenshots/NN-name.png> [x0 y0 x1 y1 ...]
Extra boxes are blurred too (e.g. other personal details).
"""
import sys

from PIL import Image, ImageDraw, ImageFilter

src, dst, *extra = sys.argv[1:]
im = Image.open(src).convert('RGB')
if im.size != (1280, 800):
    sys.exit(f'expected 1280x800, got {im.size}')
boxes = [(1196, 6, 1246, 54)]  # masthead avatar at a 1280-wide viewport
boxes += [tuple(map(int, extra[i:i + 4])) for i in range(0, len(extra), 4)]
for box in boxes:
    # Blur only an oval inside the box, feathered, so neighbouring UI (the
    # masthead's rounded rim) is untouched.
    blurred = im.crop(box).filter(ImageFilter.GaussianBlur(9))
    w, h = blurred.size
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).ellipse([2, 2, w - 3, h - 3], fill=255)
    im.paste(blurred, box, mask.filter(ImageFilter.GaussianBlur(2)))
im.save(dst, optimize=True)
print(dst, im.size)

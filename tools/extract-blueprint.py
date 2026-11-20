# Pull the white linework out of a blueprint scan: white where the drawing is, transparent elsewhere.
import sys, numpy as np
from PIL import Image, ImageFilter
src, out = sys.argv[1:3]
im = Image.open(src).convert('RGB')
im = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)      # smoother edges when shown large
a = np.asarray(im).astype(float)
mn = a.min(2)                                                       # blue paper has a low red channel; white ink is high in all three
# local background level, so the paper's lighter grungy patches don't count as lines
bg = np.asarray(Image.fromarray(mn.astype(np.uint8)).filter(ImageFilter.MedianFilter(15))).astype(float)
v = np.clip((mn - np.maximum(bg, 60) - 22) / 70, 0, 1)
v = v ** 0.8
# soften the outer border where the scan is worn
h, w = v.shape; yy, xx = np.mgrid[0:h, 0:w]
edge = np.minimum.reduce([xx, yy, w - 1 - xx, h - 1 - yy]) / (0.04 * w)
v *= np.clip(edge, 0, 1)
rgba = np.dstack([np.full((h, w), 255), np.full((h, w), 255), np.full((h, w), 255), (v * 255)]).astype(np.uint8)
Image.fromarray(rgba, 'RGBA').save(out, optimize=True)
prev = Image.new('RGB', (w, h), (0, 0, 0)); prev.paste(Image.fromarray(rgba, 'RGBA'), (0, 0), Image.fromarray(rgba, 'RGBA'))
prev.save(out.replace('.png', '-preview.jpg'), quality=85)
print(w, h)

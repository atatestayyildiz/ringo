"""MoonWorks logosundan uygulama imzasi PNG'lerini uretir (proje bagimliligi degil, uretim araci).

Kullanim: py -3 scripts/build-moonworks-logo.py "<kaynak.png>" [cikti_klasoru] [yukseklik_px]
Sloganli kaynaktan yalniz logo satirini kirpar, beyaz zemini alfaya cevirir.
Cikti: moonworks-logo.png (acik tema) ve moonworks-logo-dark.png (koyu tema).
"""
import sys
import numpy as np
from PIL import Image

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else "public"
H = int(sys.argv[3]) if len(sys.argv) > 3 else 64

NAVY = np.array([11, 20, 38], float)
LIGHT = np.array([232, 236, 244], float)

rgb = np.array(Image.open(src).convert("RGB")).astype(float)

# Ilk satir grubu = logo; bosluktan sonraki grup (slogan) atilir.
ink = (255 * 3 - rgb.sum(2)) > 60
rows = np.where(ink.any(1))[0]
end = rows[0]
for r in rows[1:]:
    if r - end > 8 * 3:  # logo ile slogan arasi bosluk
        break
    end = r
y0, y1 = rows[0], end
cols = np.where(ink[y0 : y1 + 1].any(0))[0]
pad = 6
box = rgb[max(y0 - pad, 0) : y1 + pad + 1, max(cols.min() - pad, 0) : cols.max() + pad + 1]

# Beyaz zemin -> alfa (yumusak kenar korunur), rengi alfadan arindir.
alpha = np.clip((255 - box.min(2)) / (255 - NAVY.min()), 0, 1)
alpha = np.clip((alpha - 0.12) / 0.88, 0, 1)  # kaynaktaki sikistirma gurultusunu temizle
a = np.maximum(alpha, 1e-3)[..., None]
col = np.clip((box - (1 - a) * 255) / a, 0, 255)

# Koyu surum: lacivert benzeri pikseller aciga, mavi aksan aynen.
dist = np.linalg.norm(col - NAVY, axis=2)
w = np.clip(1 - dist / 70, 0, 1)[..., None]
col_dark = col * (1 - w) + LIGHT * w


def save(color, name):
    im = Image.fromarray(np.dstack([color, alpha * 255]).round().astype(np.uint8), "RGBA")
    w_px = round(im.width * H / im.height)
    im = im.resize((w_px, H), Image.LANCZOS)
    im = im.quantize(colors=64, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)  # kucuk dosya
    im.save(f"{out}/{name}", optimize=True)
    print(name, im.size)


save(col, "moonworks-logo.png")
save(col_dark, "moonworks-logo-dark.png")

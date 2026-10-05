"""Operator logolarini logos/ klasorunden public/operators/ altina 64x64 seffaf PNG olarak uretir.
Kullanim: py -3 scripts/build-operator-logos.py  (Pillow gerekir; proje bagimliligi degil)"""
from pathlib import Path
from collections import deque
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "logos"
OUT = ROOT / "public" / "operators"
SIZE = 64
PAD = 2
JOBS = {"turkcell": "turkcell.webp", "vodafone": "vodafone.png", "turk-telekom": "telekom.png"}

def is_bg(p, thr=235):
    r, g, b, a = p
    return a < 20 or (r >= thr and g >= thr and b >= thr)

def remove_outer_bg(im):
    """Koselerden/kenarlardan flood-fill: yalniz dis zemin seffaflasir, kapali beyaz ic parcalar korunur."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y * w + x]:
            continue
        if not is_bg(px[x, y]):
            continue
        seen[y * w + x] = 1
        px[x, y] = (255, 255, 255, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return im

for name, fn in JOBS.items():
    im = ImageOps.exif_transpose(Image.open(SRC / fn)).convert("RGBA")
    im = remove_outer_bg(im)
    im = im.crop(im.getchannel("A").getbbox())
    inner = SIZE - 2 * PAD
    scale = inner / max(im.size)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2), im)
    OUT.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT / f"{name}.png", optimize=True)
    print(name, canvas.size, (OUT / f"{name}.png").stat().st_size)

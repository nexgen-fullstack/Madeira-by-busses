#!/usr/bin/env python3
"""Builds every icon and store image of Madeira by busses from the logo.

The logo (branding/logo.jpg) is a picture on a blue gradient tile. The script
models the gradient as a smooth surface, lifts the bus, mountains, sun, road
and lettering off it with transparency, and lays them out again for each
place an icon appears: the website and its home-screen icons, the Android
launcher (adaptive and older), the Android splash screen, the app's header
and the Google Play listing.

Needs Python 3 with Pillow and NumPy (pip install pillow numpy).
Run from anywhere: python3 scripts/brand-assets.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BRANDING = ROOT / 'branding'
WEB = ROOT / 'apps' / 'web' / 'public'
RES = ROOT / 'apps' / 'mobile' / 'android' / 'app' / 'src' / 'main' / 'res'
PLAY = BRANDING / 'play'

# The tile in branding/logo.jpg: a rounded square from pixel 51 to 1201.
TILE = (51, 1202)
# The lettering starts below this row of the tile (the bus and road are above).
TEXT_TOP = 0.165  # in tile units, -1 (top) .. 1 (bottom)

DENSITIES = {'mdpi': 1.0, 'hdpi': 1.5, 'xhdpi': 2.0, 'xxhdpi': 3.0, 'xxxhdpi': 4.0}


# ---------- Reading the logo ----------


def load_tile() -> tuple[np.ndarray, np.ndarray]:
    """The tile as float RGB (0..255) and its shape as alpha (rounded corners)."""
    img = np.asarray(Image.open(BRANDING / 'logo.jpg').convert('RGB'), dtype=np.float64)
    a, b = TILE
    rgb = img[a:b, a:b]
    # Outside the tile the picture is white: the red channel says how much
    # (the blue tile has almost no red). Only near the edge, so the white bus
    # and lettering inside stay opaque.
    n = rgb.shape[0]
    yy, xx = np.mgrid[0:n, 0:n]
    u, v = norm(xx, n), norm(yy, n)
    edge = np.maximum(np.abs(u), np.abs(v)) > 0.80
    corner = (np.abs(u) > 0.3) & (np.abs(v) > 0.3)
    near = edge & (corner | (np.maximum(np.abs(u), np.abs(v)) > 0.985))
    shape = np.where(near, np.clip((250 - rgb[..., 0]) / (250 - 14), 0, 1), 1.0)
    return rgb, shape


def norm(i: np.ndarray, n: int) -> np.ndarray:
    """Pixel index → -1..1 across n pixels (pixel centres)."""
    return (i + 0.5) / n * 2 - 1


def poly_terms(u: np.ndarray, v: np.ndarray, deg: int = 4) -> np.ndarray:
    return np.stack([u**i * v**j for i in range(deg + 1) for j in range(deg + 1 - i)], axis=-1)


def fit_background(rgb: np.ndarray, shape: np.ndarray) -> np.ndarray:
    """Polynomial coefficients of the tile's gradient, fitted on its plain areas."""
    n = rgb.shape[0]
    yy, xx = np.mgrid[0:n, 0:n]
    terms = poly_terms(norm(xx, n), norm(yy, n))
    inside = shape > 0.999
    # Start from the saturated blue pixels, then keep those the fit explains.
    mask = inside & (rgb[..., 0] < 30) & (rgb[..., 2] > 60)
    for _ in range(10):
        coef, *_ = np.linalg.lstsq(terms[mask], rgb[mask], rcond=None)
        res = np.linalg.norm(rgb - terms @ coef, axis=2)
        mask = inside & (res < 16)
    return coef


def background(coef: np.ndarray, n: int, scale: float = 1.0) -> np.ndarray:
    """The gradient on an n×n canvas whose middle `scale` part is the tile.

    Past the tile's square (only in the hidden margin of adaptive icons) the
    colour of its edge carries on.
    """
    i = np.clip(norm(np.arange(n), n) / scale, -1, 1)
    u, v = np.meshgrid(i, i)
    return np.clip(poly_terms(u, v) @ coef, 0, 255)


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def rounded_rect(u: np.ndarray, v: np.ndarray, half: float, radius: float) -> np.ndarray:
    """Signed distance to a rounded square (negative inside), in tile units."""
    qx, qy = np.abs(u) - (half - radius), np.abs(v) - (half - radius)
    outside = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2)
    return outside + np.minimum(np.maximum(qx, qy), 0) - radius


def lift(rgb: np.ndarray, shape: np.ndarray, coef: np.ndarray) -> np.ndarray:
    """The picture without its gradient: premultiplied RGBA on transparency."""
    n = rgb.shape[0]
    bg = background(coef, n)
    d = rgb - bg
    alpha = smoothstep(9.0, 70.0, np.linalg.norm(d, axis=2))
    # The tile's shaded rim is part of the tile, not of the picture.
    i = norm(np.arange(n), n)
    u, v = np.meshgrid(i, i)
    alpha *= 1 - smoothstep(-0.1, -0.06, rounded_rect(u, v, 1.0, 0.54))
    # Colour that, laid over the gradient with this alpha, gives the original
    # pixel back: premultiplied, that is just alpha·bg + d.
    premul = np.clip(alpha[..., None] * bg + d, 0, 255 * alpha[..., None])
    return np.dstack([premul, alpha * 255])


# ---------- Drawing ----------


def resize(rgba: np.ndarray, w: int, h: int | None = None) -> np.ndarray:
    """Resizes premultiplied float RGBA (each channel separately, Lanczos)."""
    h = h or w
    out = [np.asarray(Image.fromarray(rgba[..., c].astype(np.float32), 'F').resize((w, h), Image.LANCZOS)) for c in range(4)]
    res = np.dstack(out).astype(np.float64)
    res[..., 3] = np.clip(res[..., 3], 0, 255)
    res[..., :3] = np.clip(res[..., :3], 0, res[..., 3:4])
    return res


def over(top: np.ndarray, under: np.ndarray) -> np.ndarray:
    """Premultiplied `top` over premultiplied `under`."""
    a = top[..., 3:4] / 255
    return top + under * (1 - a)


def opaque(rgb: np.ndarray) -> np.ndarray:
    return np.dstack([rgb, np.full(rgb.shape[:2], 255.0)])


def place(canvas: int, art: np.ndarray, size: float, cx: float = 0.5, cy: float = 0.5) -> np.ndarray:
    """`art` scaled to `size` px wide, centred at (cx, cy) of an empty canvas."""
    h, w = art.shape[:2]
    sw, sh = max(1, round(size)), max(1, round(size * h / w))
    small = resize(art, sw, sh)
    out = np.zeros((canvas, canvas, 4))
    x0, y0 = round(cx * canvas - sw / 2), round(cy * canvas - sh / 2)
    xs, ys = slice(max(0, x0), min(canvas, x0 + sw)), slice(max(0, y0), min(canvas, y0 + sh))
    out[ys, xs] = small[ys.start - y0 : ys.stop - y0, xs.start - x0 : xs.stop - x0]
    return out


def masked(rgba: np.ndarray, mask: np.ndarray) -> np.ndarray:
    return rgba * mask[..., None]


def circle_mask(n: int, radius: float = 1.0) -> np.ndarray:
    i = norm(np.arange(n), n)
    u, v = np.meshgrid(i, i)
    r = np.sqrt(u * u + v * v)
    return np.clip((radius - r) * n / 2 + 0.5, 0, 1)


def save(rgba: np.ndarray, path: Path, size: int | None = None, keep_alpha: bool = True) -> None:
    """Writes premultiplied float RGBA as an ordinary PNG/WebP, resized to `size`."""
    if size is not None and size != rgba.shape[0]:
        rgba = resize(rgba, size, round(size * rgba.shape[0] / rgba.shape[1]))
    a = rgba[..., 3:4]
    rgb = np.where(a > 0, rgba[..., :3] * 255 / np.maximum(a, 1e-6), 0)
    out = np.dstack([rgb, a[..., 0]]).round().clip(0, 255).astype(np.uint8)
    img = Image.fromarray(out, 'RGBA')
    if not keep_alpha:
        img = img.convert('RGB')
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == '.webp':
        img.save(path, 'WEBP', quality=90, method=6)
    else:
        img.save(path, optimize=True)
    print(f'  {path.relative_to(ROOT)}  {img.width}×{img.height}')


def crop_to_content(rgba: np.ndarray, pad: int = 4, threshold: float = 8) -> np.ndarray:
    ys, xs = np.where(rgba[..., 3] > threshold)
    y0, y1 = max(0, ys.min() - pad), min(rgba.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(rgba.shape[1], xs.max() + pad + 1)
    return rgba[y0:y1, x0:x1]


def crisp(rgba: np.ndarray) -> np.ndarray:
    """Drops the faint glows around the shapes (for small sizes and flat backgrounds)."""
    a = rgba[..., 3] / 255
    keep = smoothstep(0.12, 0.45, a)
    return rgba * keep[..., None]


def window(rgba: np.ndarray, v0: float, v1: float, feather: float = 0.02) -> np.ndarray:
    """Keeps the rows of the tile between v0 and v1 (tile units), with soft edges."""
    n = rgba.shape[0]
    v = norm(np.arange(n), n)
    w = smoothstep(v0 - feather, v0, v) * (1 - smoothstep(v1, v1 + feather, v))
    return rgba * w[:, None, None]


# ---------- The assets ----------


def main() -> None:
    rgb, shape = load_tile()
    coef = fit_background(rgb, shape)
    art = lift(rgb, shape, coef)
    n = rgb.shape[0]
    W = 1536  # working canvas; every asset is drawn here and scaled down

    # How far the picture reaches from the middle (1 = edge of the tile).
    ys, xs = np.where(art[..., 3] > 128)
    reach = float(np.sqrt(norm(xs, n) ** 2 + norm(ys, n) ** 2).max())
    print(f'Picture reaches {reach:.3f} of the tile radius')

    def tile_shape(canvas: int) -> np.ndarray:
        return np.asarray(Image.fromarray((shape * 255).astype(np.uint8)).resize((canvas, canvas), Image.LANCZOS), dtype=np.float64) / 255

    def icon(scale: float = 1.0, mask: str = 'tile') -> np.ndarray:
        """The logo on its gradient; `scale` shrinks the picture, the gradient fills the icon."""
        bg = opaque(background(coef, W))
        img = over(place(W, art, W * scale), bg)
        if mask == 'tile':
            return masked(img, tile_shape(W))
        if mask == 'circle':
            return masked(img, circle_mask(W))
        return img

    mark = window(art, -1.0, TEXT_TOP)  # bus, mountains, sun and road
    words = window(art, TEXT_TOP, 1.0)  # "Madeira by busses"

    print('Website')
    any_icon = icon()
    for size in (192, 512):
        save(any_icon, WEB / f'icon-{size}.png', size)
    # Maskable: the picture inside the 80% safe circle, the gradient to the edges.
    save(icon(0.8 / reach * 0.98, 'square'), WEB / 'icon-maskable-512.png', 512)
    save(icon(1.0, 'square'), WEB / 'apple-touch-icon.png', 180, keep_alpha=False)
    save(any_icon, WEB / 'logo.png', 256)
    # Favicon: the bus and mountains alone, bigger, on the tile.
    bus = crop_to_content(crisp(mark), pad=0, threshold=40)
    fav = over(place(W, bus, W * 0.84, 0.5, 0.52), opaque(background(coef, W)))
    save(masked(fav, tile_shape(W)), WEB / 'favicon-64.png', 64)
    save(masked(fav, tile_shape(W)), WEB / 'favicon-32.png', 32)
    # Header of the app: white bus, mountains and sun beside the lettering.
    lockup_mark = crop_to_content(crisp(mark), pad=2, threshold=10)
    lockup_words = crop_to_content(crisp(words), pad=2, threshold=10)
    save(lockup_mark, WEB / 'brand-mark.png', 200)
    save(lockup_words, WEB / 'brand-words.png', 320)
    # Silhouette of the bus and mountains: notification badge, themed icon.
    sil = crisp(mark)
    sil = crop_to_content(np.dstack([np.repeat(sil[..., 3:4], 3, axis=2), sil[..., 3]]), pad=0, threshold=40)
    save(place(W, sil, W * 0.9), WEB / 'badge-96.png', 96)

    print('Android launcher')
    round_icon = icon(0.94 / reach, 'circle')
    # Adaptive icon: 108dp layers, 72dp visible, the picture inside the 66dp circle.
    fg = place(W, art, W * 72 / 108 * (66 / 72 / reach * 0.96))
    bg = opaque(background(coef, W, 72 / 108))
    mono = place(W, sil, W * 0.5)
    # Splash screen: Android 12+ draws the icon inside a circle 2/3 its size.
    splash = place(W, any_icon, W * 0.54)
    for dens, k in DENSITIES.items():
        base = RES / f'mipmap-{dens}'
        save(any_icon, base / 'ic_launcher.png', round(48 * k))
        save(round_icon, base / 'ic_launcher_round.png', round(48 * k))
        save(fg, base / 'ic_launcher_foreground.png', round(108 * k))
        save(bg, base / 'ic_launcher_background.png', round(108 * k), keep_alpha=False)
        save(mono, base / 'ic_launcher_monochrome.png', round(108 * k))
        save(splash, RES / f'drawable-{dens}' / 'splash_logo.png', round(288 * k))

    print('Google Play')
    save(icon(1.0, 'square'), PLAY / 'icon-512.png', 512, keep_alpha=False)
    feature_graphic(any_icon, lockup_mark, lockup_words)


def feature_graphic(any_icon: np.ndarray, lockup_mark: np.ndarray, lockup_words: np.ndarray) -> None:
    """1024×500 banner for Google Play: the logo and the slogan on the brand's blue."""
    w, h = 1024, 500
    y, x = np.mgrid[0:h, 0:w] / np.array([h, w])[:, None, None]
    top, bottom = np.array([8, 112, 214.0]), np.array([3, 28, 84.0])
    t = smoothstep(0.0, 1.0, y * 0.85 + (1 - x) * 0.25)[..., None]
    glow = np.exp(-(((x - 0.82) / 0.35) ** 2 + ((y - 0.1) / 0.45) ** 2))[..., None]
    out = opaque(np.clip(top * (1 - t) + bottom * t + glow * np.array([10, 60, 70.0]), 0, 255))
    # The bus, mountains and sun, large and faint, behind the slogan.
    ghost = resize(lockup_mark, 620, round(620 * lockup_mark.shape[0] / lockup_mark.shape[1]))
    out = over(paste(ghost * 0.10, w, h, 560, h - ghost.shape[0] + 40), out)
    # The logo with a soft shadow.
    size = 300
    logo = resize(any_icon, size)
    shadow = np.zeros((h, w))
    shadow[(h - size) // 2 + 14 : (h + size) // 2 + 14, 70 : 70 + size] = logo[..., 3]
    shadow = np.asarray(Image.fromarray(shadow.round().astype(np.uint8)).filter(ImageFilter.GaussianBlur(18)), dtype=np.float64)
    out = over(np.dstack([np.zeros((h, w, 3)), shadow * 0.55]), out)
    out = over(paste(logo, w, h, 70, (h - size) // 2), out)
    img = Image.fromarray(np.clip(out[..., :3], 0, 255).astype(np.uint8))
    draw = ImageDraw.Draw(img)
    fonts = ROOT / 'apps' / 'web' / 'src' / 'assets' / 'fonts'
    bold = ImageFont.truetype(str(fonts / 'Inter-ExtraBold.subset.ttf'), 50)
    regular = ImageFont.truetype(str(fonts / 'Inter-Regular.subset.ttf'), 27)
    draw.text((420, 150), 'Explore Madeira', font=bold, fill=(255, 255, 255))
    draw.text((420, 208), 'with ease', font=bold, fill=(255, 199, 46))
    draw.text((420, 292), 'Bus routes, timetables and fares', font=regular, fill=(214, 228, 255))
    draw.text((420, 330), 'on your phone, even offline', font=regular, fill=(214, 228, 255))
    PLAY.mkdir(parents=True, exist_ok=True)
    img.save(PLAY / 'feature-graphic.png', optimize=True)
    print(f'  {(PLAY / "feature-graphic.png").relative_to(ROOT)}  {w}×{h}')
    # The same picture for link previews of the website (Telegram, WhatsApp…).
    img.convert('RGB').save(WEB / 'og-image.jpg', quality=88, optimize=True)
    print(f'  {(WEB / "og-image.jpg").relative_to(ROOT)}  {w}×{h}')


def paste(rgba: np.ndarray, w: int, h: int, x: int, y: int) -> np.ndarray:
    """`rgba` at (x, y) on an empty w×h canvas, cut off at its edges."""
    out = np.zeros((h, w, 4))
    ys, xs = slice(max(0, y), min(h, y + rgba.shape[0])), slice(max(0, x), min(w, x + rgba.shape[1]))
    out[ys, xs] = rgba[ys.start - y : ys.stop - y, xs.start - x : xs.stop - x]
    return out


if __name__ == '__main__':
    main()

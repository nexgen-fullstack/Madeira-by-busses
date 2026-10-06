#!/usr/bin/env python3
"""Builds every icon and store image of Madeira by busses from the logo.

The logo (branding/logo.webp) is a picture on a rounded tile with a glowing
rim, on a blue glow. The script finds the rim, cuts the tile out of the glow,
models the glow as a smooth surface (to carry it past the picture's edges and
behind the tile), lifts the lettering — "Madeira" with its pin, "by busses" —
off the picture, and lays them out again for each place an icon appears: the
website and its home-screen icons, the Android launcher (adaptive and older),
the Android splash screen, the app's header and the Google Play listing.

Needs Python 3 with Pillow and NumPy (pip install pillow numpy).
Run from anywhere: python scripts/brand-assets.py
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

# The middle of the tile in the logo, in pixels (the tile sits a little above the middle).
CENTRE = (627.0, 610.0)
ANGLES = 1440
# The logo's colours, also in apps/web/src/styles.css and the Android colors.xml.
NAVY = (0, 47, 133)
SPLASH = (0, 86, 199)  # the glow below the tile: the splash screen and the status bar
YELLOW = (255, 212, 0)
CYAN = (2, 195, 253)

DENSITIES = {'mdpi': 1.0, 'hdpi': 1.5, 'xhdpi': 2.0, 'xxhdpi': 3.0, 'xxxhdpi': 4.0}


# ---------- Reading the logo ----------


def load() -> np.ndarray:
    return np.asarray(Image.open(BRANDING / 'logo.webp').convert('RGB'), dtype=np.float64)


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def bilinear(img: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    n = img.shape[0]
    x0 = np.clip(np.floor(x).astype(int), 0, n - 2)
    y0 = np.clip(np.floor(y).astype(int), 0, n - 2)
    fx, fy = x - x0, y - y0
    return (
        img[y0, x0] * (1 - fx) * (1 - fy)
        + img[y0, x0 + 1] * fx * (1 - fy)
        + img[y0 + 1, x0] * (1 - fx) * fy
        + img[y0 + 1, x0 + 1] * fx * fy
    )


def circular(a: np.ndarray, w: int, f) -> np.ndarray:
    pad = np.concatenate([a[-w:], a, a[:w]])
    return np.array([f(pad[i : i + 2 * w + 1]) for i in range(len(a))])


def trace_rim(rgb: np.ndarray) -> np.ndarray:
    """Distance from CENTRE to the tile's rim at ANGLES directions round the tile.

    The rim is a thin cyan-white line: walking in from the glow, the first
    place where green peaks well above the picture just inside it.
    """
    n = rgb.shape[0]
    green = rgb[..., 1]
    cx, cy = CENTRE
    rim = np.full(ANGLES, np.nan)
    for k, t in enumerate(np.arange(ANGLES) / ANGLES * 2 * np.pi):
        r = np.arange(880.0, 380.0, -1.0)
        x, y = cx + r * np.cos(t), cy + r * np.sin(t)
        ok = (x >= 0) & (x <= n - 2) & (y >= 0) & (y <= n - 2)
        r, g = r[ok], bilinear(green, x[ok], y[ok])
        mid = g[6:-8]
        hit = (mid >= 150) & (mid - g[14:] >= 40) & (mid >= g[:-14] + 4)
        if hit.any():
            i = 6 + int(np.argmax(hit))
            rim[k] = r[i + int(np.argmax(g[i : i + 5]))]
    rim = np.where(np.isnan(rim), np.nanmedian(rim), rim)
    # Sparkles on the rim and letters touching it: the median keeps the outline.
    return circular(circular(rim, 24, np.median), 8, np.mean)


def polar(n: int) -> tuple[np.ndarray, np.ndarray]:
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    dx, dy = xx - CENTRE[0], yy - CENTRE[1]
    return np.mod(np.arctan2(dy, dx), 2 * np.pi), np.hypot(dx, dy)


def rim_at(rim: np.ndarray, theta: np.ndarray) -> np.ndarray:
    th = np.arange(ANGLES + 1) / ANGLES * 2 * np.pi
    return np.interp(theta, th, np.append(rim, rim[0]))


def tile_alpha(n: int, rim: np.ndarray, grow: float = 4.0, feather: float = 1.5) -> np.ndarray:
    """The tile with its rim, as alpha over the logo's pixels (soft edge)."""
    theta, r = polar(n)
    return np.clip((rim_at(rim, theta) + grow - r) / feather + 0.5, 0, 1)


def poly_terms(u: np.ndarray, v: np.ndarray, deg: int = 5) -> np.ndarray:
    return np.stack([u**i * v**j for i in range(deg + 1) for j in range(deg + 1 - i)], axis=-1)


def norm(x: np.ndarray, n: int) -> np.ndarray:
    """Logo pixel → -1..1, clamped: past the picture the glow keeps the colour of its edge."""
    return np.clip((x + 0.5) / n * 2 - 1, -1, 1)


def fit_glow(rgb: np.ndarray, rim: np.ndarray) -> np.ndarray:
    """Polynomial coefficients of the glow around the tile (outside the rim's halo)."""
    n = rgb.shape[0]
    theta, r = polar(n)
    outside = r > rim_at(rim, theta) + 30
    yy, xx = np.mgrid[0:n, 0:n]
    terms = poly_terms(norm(xx, n), norm(yy, n))
    coef, *_ = np.linalg.lstsq(terms[outside], rgb[outside], rcond=None)
    res = np.linalg.norm(rgb - terms @ coef, axis=2)[outside]
    print(f'Glow: fitted within {np.median(res):.1f} (median), {np.percentile(res, 95):.1f} (95%)')
    return coef


def glow_at(coef: np.ndarray, x: np.ndarray, y: np.ndarray, n: int) -> np.ndarray:
    return np.clip(poly_terms(norm(x, n), norm(y, n)) @ coef, 0, 255)


# ---------- Drawing (premultiplied float RGBA, 0..255) ----------


def opaque(rgb: np.ndarray) -> np.ndarray:
    return np.dstack([rgb, np.full(rgb.shape[:2], 255.0)])


def resize(rgba: np.ndarray, w: int, h: int | None = None) -> np.ndarray:
    """Resizes premultiplied float RGBA (each channel separately, Lanczos)."""
    h = h or w
    out = [np.asarray(Image.fromarray(rgba[..., c].astype(np.float32), 'F').resize((w, h), Image.LANCZOS)) for c in range(rgba.shape[2])]
    res = np.dstack(out).astype(np.float64)
    if res.shape[2] == 4:
        res[..., 3] = np.clip(res[..., 3], 0, 255)
        res[..., :3] = np.clip(res[..., :3], 0, res[..., 3:4])
    return res


def over(top: np.ndarray, under: np.ndarray) -> np.ndarray:
    """Premultiplied `top` over premultiplied `under`."""
    return top + under * (1 - top[..., 3:4] / 255)


def paste(rgba: np.ndarray, w: int, h: int, x: int, y: int) -> np.ndarray:
    """`rgba` at (x, y) on an empty w×h canvas, cut off at its edges."""
    out = np.zeros((h, w, rgba.shape[2]))
    ys, xs = slice(max(0, y), min(h, y + rgba.shape[0])), slice(max(0, x), min(w, x + rgba.shape[1]))
    if ys.start < ys.stop and xs.start < xs.stop:
        out[ys, xs] = rgba[ys.start - y : ys.stop - y, xs.start - x : xs.stop - x]
    return out


def circle_mask(n: int, radius: float = 1.0) -> np.ndarray:
    i = (np.arange(n) + 0.5) / n * 2 - 1
    u, v = np.meshgrid(i, i)
    return np.clip((radius - np.sqrt(u * u + v * v)) * n / 2 + 0.5, 0, 1)


def crop_to_content(rgba: np.ndarray, pad: int = 4, threshold: float = 8) -> np.ndarray:
    ys, xs = np.where(rgba[..., 3] > threshold)
    y0, y1 = max(0, ys.min() - pad), min(rgba.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(rgba.shape[1], xs.max() + pad + 1)
    return rgba[y0:y1, x0:x1]


def blur(a: np.ndarray, radius: float) -> np.ndarray:
    """Gaussian blur of a non-negative mask (Pillow blurs 8-bit images only)."""
    top = max(float(a.max()), 1e-6)
    img = Image.fromarray(np.clip(a / top * 255, 0, 255).round().astype(np.uint8))
    return np.asarray(img.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float64) / 255 * top


def save(rgba: np.ndarray, path: Path, size: int | None = None, keep_alpha: bool = True) -> None:
    """Writes premultiplied float RGBA as an ordinary PNG, resized to `size` wide."""
    if size is not None and size != rgba.shape[1]:
        rgba = resize(rgba, size, round(size * rgba.shape[0] / rgba.shape[1]))
    a = rgba[..., 3:4]
    rgb = np.where(a > 0, rgba[..., :3] * 255 / np.maximum(a, 1e-6), 0)
    out = np.dstack([rgb, a[..., 0]]).round().clip(0, 255).astype(np.uint8)
    img = Image.fromarray(out, 'RGBA')
    if not keep_alpha:
        img = img.convert('RGB')
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == '.webp':
        img.save(path, quality=86, method=6)
    else:
        img.save(path, optimize=True)
    print(f'  {path.relative_to(ROOT)}  {img.width}×{img.height}')


class Logo:
    """The logo taken apart: the picture, its tile, and the glow around it."""

    def __init__(self) -> None:
        self.rgb = load()
        self.n = self.rgb.shape[0]
        self.rim = trace_rim(self.rgb)
        self.reach = float(self.rim.max())  # farthest point of the rim from CENTRE
        self.alpha = tile_alpha(self.n, self.rim)
        self.coef = fit_glow(self.rgb, self.rim)
        yy, xx = np.mgrid[0:self.n, 0:self.n].astype(np.float64)
        self.model = glow_at(self.coef, xx, yy, self.n)
        print(f'Tile: rim from {self.rim.min():.0f} to {self.reach:.0f} px from its middle')

    def placed(self, canvas: int, reach: float, layer: np.ndarray) -> tuple[np.ndarray, float, int, int]:
        """`layer` (logo-sized) scaled so the rim reaches `reach` px, its middle at the canvas's."""
        k = reach / self.reach
        size = max(1, round(self.n * k))
        x0, y0 = round(canvas / 2 - CENTRE[0] * k), round(canvas / 2 - CENTRE[1] * k)
        return paste(resize(layer, size), canvas, canvas, x0, y0), k, x0, y0

    def scene(self, canvas: int, reach: float, tile: bool = True) -> np.ndarray:
        """The logo as drawn, opaque: its glow carried on to the canvas's edges.

        Without `tile` the tile is left out (the glow goes on behind it): the
        background layer of the adaptive icon.
        """
        picture = self.rgb if tile else self.rgb * (1 - self.grown()[..., None]) + self.model * self.grown()[..., None]
        yy, xx = np.mgrid[0:self.n, 0:self.n]
        edge = smoothstep(0, 24, np.minimum(np.minimum(xx, yy), np.minimum(self.n - 1 - xx, self.n - 1 - yy)))
        layer = np.dstack([picture * edge[..., None], edge * 255])
        img, k, x0, y0 = self.placed(canvas, reach, layer)
        cy, cx = np.mgrid[0:canvas, 0:canvas].astype(np.float64)
        glow = glow_at(self.coef, (cx - x0) / k, (cy - y0) / k, self.n)
        return over(img, opaque(glow))

    def grown(self) -> np.ndarray:
        return tile_alpha(self.n, self.rim, grow=10, feather=6)

    def tile(self) -> np.ndarray:
        """The tile with its rim, cut out of the glow."""
        return np.dstack([self.rgb * self.alpha[..., None], self.alpha * 255])

    def cutout(self, canvas: int, reach: float, halo: float = 0.0) -> np.ndarray:
        """The tile alone on transparency; `halo` adds the rim's soft cyan glow around it."""
        img, k, _, _ = self.placed(canvas, reach, self.tile())
        if halo:
            a = blur(img[..., 3], canvas * 0.012) * halo
            glow = np.dstack([np.ones((canvas, canvas, 3)) * np.array(CYAN) * a[..., None] / 255, a])
            img = over(img, glow)
        return img


def lettering(rgb: np.ndarray) -> np.ndarray:
    """"Madeira" with its pin, and "by busses", lifted off the picture (RGBA, cropped)."""
    top, left = 640, 60
    rgb = rgb[top:1150, left:1200]
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    yy, xx = np.mgrid[0 : rgb.shape[0], 0 : rgb.shape[1]]
    yy, xx = yy + top, xx + left  # in the logo's pixels
    # "Madeira": warm colours (yellow faces, orange sides), red well above blue
    # and not below green (the bushes beside the road are yellow-green).
    warm = smoothstep(70, 150, R - B) * smoothstep(-35, -5, R - G)
    warm *= (yy > 660) & (yy < 940) & (xx > 70) & (xx < 1185) & ~((xx > 1000) & (yy < 690))
    # The white glints on the letters are holes in that: fill the light ones
    # that the letters close in (the dark ones are the letters' own counters).
    solid = warm > 0.5
    holes = enclosed(~solid) & (rgb.min(axis=2) > 150)
    warm = np.maximum(warm, blur(holes.astype(np.float64), 1.0) * (rgb.min(axis=2) > 120))
    # Specks of road and flare: gone after an opening, the letters stay.
    keep = np.asarray(
        Image.fromarray(((warm > 0.5) * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(11)),
        dtype=np.float64,
    ) / 255
    warm *= keep
    # "by busses": light letters with plenty of red (the wave and the glow round
    # the letters are cyan, with almost none).
    light = smoothstep(30, 90, R) * smoothstep(110, 180, (R + G + B) / 3)
    light *= (yy > 935) & (yy < 1140) & (xx > 200) & (xx < 1080)
    alpha = np.maximum(warm, light)
    return crop_to_content(np.dstack([rgb * alpha[..., None], alpha * 255]), pad=2, threshold=10)


def enclosed(free: np.ndarray) -> np.ndarray:
    """Pixels of `free` that cannot be reached from the image's border through `free`."""
    reached = np.zeros_like(free)
    reached[0, :], reached[-1, :], reached[:, 0], reached[:, -1] = free[0, :], free[-1, :], free[:, 0], free[:, -1]
    while True:
        grown = np.asarray(Image.fromarray(reached.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(3))) > 0
        grown &= free
        if (grown == reached).all():
            return free & ~reached
        reached = grown


def bus_tile(rgb: np.ndarray, canvas: int) -> np.ndarray:
    """The bus on its road from the logo, on a small rounded tile with the logo's rim.

    For the app's header (beside the lettering) and the browser tab, where the
    whole logo's lettering would be too small to read.
    """
    x0, y0, s = 175, 100, 560  # above the lettering, the bus in the middle
    ss = 2
    big = canvas * ss
    photo = Image.fromarray(rgb[y0 : y0 + s, x0 : x0 + s].round().astype(np.uint8)).resize((big, big), Image.LANCZOS)
    tile = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    shape = Image.new('L', (big, big), 0)
    radius = big * 0.23
    ImageDraw.Draw(shape).rounded_rectangle([0, 0, big - 1, big - 1], radius=radius, fill=255)
    tile.paste(photo, (0, 0), shape)
    d = ImageDraw.Draw(tile)
    rim = big * 0.045
    d.rounded_rectangle([rim / 2, rim / 2, big - rim / 2, big - rim / 2], radius=radius - rim / 2, outline=(78, 188, 255), width=round(rim))
    d.rounded_rectangle([rim / 2, rim / 2, big - rim / 2, big - rim / 2], radius=radius - rim / 2, outline=(214, 248, 255), width=max(1, round(rim * 0.3)))
    out = np.asarray(tile.resize((canvas, canvas), Image.LANCZOS), dtype=np.float64)
    return np.dstack([out[..., :3] * out[..., 3:4] / 255, out[..., 3]])


def bus_glyph(canvas: int, width: float) -> np.ndarray:
    """The bus of the notification icon (res/drawable/ic_stat_bus.xml) in white, centred."""
    ss = 4  # drawn 4× larger, then scaled down: smooth edges
    k = width * ss / 220
    img = Image.new('L', (canvas * ss, canvas * ss), 0)
    d = ImageDraw.Draw(img)
    ox, oy = (canvas * ss - 220 * k) / 2 - 20 * k, (canvas * ss - 230 * k) / 2 - 15 * k

    def rr(x0: float, y0: float, x1: float, y1: float, r: float, fill: int) -> None:
        d.rounded_rectangle([ox + x0 * k, oy + y0 * k, ox + x1 * k, oy + y1 * k], radius=r * k, fill=fill)

    rr(20, 15, 240, 211, 40, 255)  # body
    rr(46, 43, 214, 125, 14, 0)  # windscreen
    rr(46, 201, 80, 245, 10, 255)  # wheels
    rr(180, 201, 214, 245, 10, 255)
    a = np.asarray(img.resize((canvas, canvas), Image.LANCZOS), dtype=np.float64)
    return np.dstack([a, a, a, a])


# ---------- The assets ----------


def main() -> None:
    logo = Logo()
    W = 1536  # working canvas; every asset is drawn here and scaled down
    half = W / 2

    print('Website')
    # The tile alone, filling the icon.
    any_icon = logo.cutout(W, half * 0.985 * logo.reach / rim_extent(logo))
    for size in (192, 512):
        save(any_icon, WEB / f'icon-{size}.png', size)
    save(any_icon, WEB / 'logo.png', 256)
    # Maskable: the tile inside the 80% safe circle, the glow to the edges.
    save(logo.scene(W, half * 0.8 * 0.98), WEB / 'icon-maskable-512.png', 512)
    # iOS rounds the corners itself: the logo as drawn.
    as_drawn = logo.scene(W, half * logo.reach / (logo.n / 2))
    save(as_drawn, WEB / 'apple-touch-icon.png', 180, keep_alpha=False)
    # Browser tab and the app's header (beside the lettering): the bus.
    mark = bus_tile(logo.rgb, 512)
    save(mark, WEB / 'favicon-64.png', 64)
    save(mark, WEB / 'favicon-32.png', 32)
    save(mark, WEB / 'brand-mark.png', 120)
    words = lettering(logo.rgb)
    save(words, WEB / 'brand-words.png', round(108 * words.shape[1] / words.shape[0]))
    # Notification badge (Android draws it in one colour): the bus.
    save(bus_glyph(W, W * 0.82), WEB / 'badge-96.png', 96)
    # The phone app's launch screen (index.html), after Android's own: the tile in its glow, large.
    save(launch_logo(logo, W), WEB / 'launch-logo.webp', 720)

    print('Android launcher')
    # Adaptive icon: 108dp layers, 72dp of them visible, the tile within the 66dp circle.
    fg = logo.cutout(W, W * 33 / 108 * 0.97)
    bg = logo.scene(W, W * 33 / 108 * 0.97, tile=False)
    mono = bus_glyph(W, W * 40 / 108)
    # Older launchers: the tile as it is; round ones: the tile in a circle of glow.
    legacy = logo.cutout(W, half * 0.94 * logo.reach / rim_extent(logo))
    round_icon = logo.scene(W, half * 0.96) * circle_mask(W)[..., None]
    # Splash screen: Android 12+ draws the icon inside a circle 2/3 its size.
    splash = logo.cutout(W, W / 3 * 0.88, halo=0.55)
    for dens, k in DENSITIES.items():
        base = RES / f'mipmap-{dens}'
        save(legacy, base / 'ic_launcher.png', round(48 * k))
        save(round_icon, base / 'ic_launcher_round.png', round(48 * k))
        save(fg, base / 'ic_launcher_foreground.png', round(108 * k))
        save(bg, base / 'ic_launcher_background.png', round(108 * k), keep_alpha=False)
        save(mono, base / 'ic_launcher_monochrome.png', round(108 * k))
        save(splash, RES / f'drawable-{dens}' / 'splash_logo.png', round(288 * k))

    print('Google Play')
    save(as_drawn, PLAY / 'icon-512.png', 512, keep_alpha=False)
    feature_graphic(logo)


def launch_logo(logo: Logo, canvas: int) -> np.ndarray:
    """The tile with a little of its glow, filling the picture, for the launch screen."""
    return logo.cutout(canvas, canvas / 2 * 0.8, halo=0.55)


def rim_extent(logo: Logo) -> float:
    """Half the width of the tile's bounding box, measured from CENTRE (the tile is not round)."""
    th = np.arange(ANGLES) / ANGLES * 2 * np.pi
    xs, ys = logo.rim * np.cos(th), logo.rim * np.sin(th)
    return float(max(np.abs(xs).max(), np.abs(ys).max()))


def feature_graphic(logo: Logo) -> None:
    """1024×500 banner for Google Play: the logo and the slogan on the logo's blues."""
    w, h = 1024, 500
    y, x = np.mgrid[0:h, 0:w] / np.array([h, w])[:, None, None]
    deep, bright = np.array(NAVY, float), np.array([10, 116, 224.0])
    t = smoothstep(0.0, 1.0, (1 - y) * 0.55 + x * 0.6)[..., None]
    out = deep * (1 - t) + bright * t
    # The logo's glow round the tile, and a little sun at the top right.
    glow = np.exp(-(((x - 0.21) / 0.26) ** 2 + ((y - 0.5) / 0.55) ** 2))[..., None]
    out = np.clip(out + glow * np.array([0, 90, 120.0]), 0, 255)
    sun = 0.75 * np.exp(-(((x - 0.98) / 0.09) ** 2 + ((y - 0.0) / 0.18) ** 2))[..., None]
    out = opaque(out * (1 - sun) + np.array([255, 214, 110.0]) * sun)
    size = 330
    tile = resize(logo.cutout(1536, 768 * 0.985 * logo.reach / rim_extent(logo), halo=0.6), size)
    shadow = blur(paste(tile, w, h, 60, (h - size) // 2 + 16)[..., 3], 18) * 0.5
    out = over(np.dstack([np.zeros((h, w, 3)), shadow]), out)
    out = over(paste(tile, w, h, 60, (h - size) // 2), out)
    img = Image.fromarray(np.clip(out[..., :3], 0, 255).astype(np.uint8))
    draw = ImageDraw.Draw(img)
    fonts = ROOT / 'apps' / 'web' / 'src' / 'assets' / 'fonts'
    bold = ImageFont.truetype(str(fonts / 'Inter-ExtraBold.subset.ttf'), 50)
    regular = ImageFont.truetype(str(fonts / 'Inter-Regular.subset.ttf'), 27)
    draw.text((432, 150), 'Explore Madeira', font=bold, fill=(255, 255, 255))
    draw.text((432, 208), 'with ease', font=bold, fill=YELLOW)
    # The logo's wave under the slogan.
    wave = [(432 + i * 4, 290 + 7 * np.sin(i / 12 * np.pi) - i * 0.05) for i in range(96)]
    draw.line(wave, fill=CYAN, width=5, joint='curve')
    draw.text((432, 318), 'Bus routes, timetables and fares', font=regular, fill=(214, 236, 255))
    draw.text((432, 356), 'on your phone, even offline', font=regular, fill=(214, 236, 255))
    PLAY.mkdir(parents=True, exist_ok=True)
    img.save(PLAY / 'feature-graphic.png', optimize=True)
    print(f'  {(PLAY / "feature-graphic.png").relative_to(ROOT)}  {w}×{h}')
    # The same picture for link previews of the website (Telegram, WhatsApp…).
    img.convert('RGB').save(WEB / 'og-image.jpg', quality=88, optimize=True)
    print(f'  {(WEB / "og-image.jpg").relative_to(ROOT)}  {w}×{h}')


if __name__ == '__main__':
    main()

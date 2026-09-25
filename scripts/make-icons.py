"""Derives every browser-facing image from the master artwork logo.png.

logo.png is the source of truth. This script generates the icon set the manifest
declares plus the picture the popup header shows, so they can never disagree
with it. Run it again after replacing logo.png.

    python scripts/make-icons.py

Two things happen to the master before it is scaled down:

* the transparent margin is trimmed away - the artwork is cut to its own pixels
  with an alpha threshold, so the single-digit alpha noise along the edges does
  not count as content - and the result is centred on a square canvas without
  ever changing its aspect ratio. The icon fills its whole slot instead of
  floating inside a border;
* it is composited over its own tile colour first and its alpha channel is put
  back afterwards: downsampling straight RGBA would otherwise blend the
  transparent corners' black into the edges and leave a dark fringe.

Outputs: icons/icon{128,48,32,16}.png
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(ROOT, 'logo.png')
SIZES = (128, 48, 32, 16)
FALLBACK_FILL = (17, 24, 39)
# Below this the master carries shadow noise only. Treating it as content would keep the empty border
# this script exists to remove.
ALPHA_FLOOR = 24


def content_box(image):
    """The artwork's own rectangle, ignoring near-transparent pixels."""
    mask = image.split()[3].point(lambda alpha: 255 if alpha > ALPHA_FLOOR else 0)
    return mask.getbbox()


def tile_colour(image):
    """The colour just inside the artwork's rounded corner, for the fringe fix."""
    limit = min(image.size) // 4
    for i in range(limit):
        pixel = image.getpixel((i, i))
        if pixel[3] > 250:
            return pixel[:3]
    return FALLBACK_FILL


def main():
    master = Image.open(MASTER).convert('RGBA')
    box = content_box(master)
    if not box:
        raise SystemExit('logo.png has no visible pixels')
    artwork = master.crop(box)

    # Square canvas, same centre, no distortion: the shorter side gains transparent padding rather than
    # being stretched.
    side = max(artwork.size)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.paste(artwork, ((side - artwork.width) // 2, (side - artwork.height) // 2))

    fill = tile_colour(square)
    backed = Image.new('RGBA', square.size, fill + (255,))
    backed.alpha_composite(square)

    straight = backed.convert('RGB').convert('RGBA')
    straight.putalpha(square.split()[3])

    out_dir = os.path.join(ROOT, 'icons')
    os.makedirs(out_dir, exist_ok=True)

    print('master  logo.png %dx%d  content %s %dx%d  square %d  tile colour %s' % (
        master.width, master.height, box, artwork.width, artwork.height, side, fill))
    for size in SIZES:
        path = os.path.join(out_dir, 'icon%d.png' % size)
        straight.resize((size, size), Image.LANCZOS).save(path, optimize=True)
        print('  %-22s %7d bytes' % ('icons/icon%d.png' % size, os.path.getsize(path)))


if __name__ == '__main__':
    main()

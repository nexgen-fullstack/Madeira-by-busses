"""Puts the photos chosen from Wikimedia Commons into the app: each one cropped to 3:2,
960 and 480 px wide as WebP in apps/web/public/photos/ (a viewpoint's 480 only), its author and licence in
apps/web/src/lib/photos.json (the walks with a view by where they go, the trails by their
id, and the viewpoints on each trail).

    python -I scripts/commons-photos.py <choices.json> [<repo>]

choices.json: {"walks": {"<to>": "File:…jpg"}, "trails": {"<id>": "File:…"},
"views": {"<trail id>": [{"name", "lat", "lon", "photo": "File:…" | null}]}}
"""
import io
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

from PIL import Image

CHOICES = sys.argv[1]
REPO = sys.argv[2] if len(sys.argv) > 2 else '.'
API = 'https://commons.wikimedia.org/w/api.php'
UA = 'MadeiraByBusses/1.0 (https://github.com/nexgen-fullstack/Madeira-by-busses; photos for a free bus app)'
OUT = f'{REPO}/apps/web/public/photos'
DATA = f'{REPO}/apps/web/src/lib/photos.json'
CC0 = 'https://creativecommons.org/publicdomain/zero/1.0'


def fetch(url, tries=6):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception:  # noqa: BLE001
            time.sleep(3 + 5 * i)
    raise RuntimeError(url)


def slug(text):
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def info(title):
    q = urllib.parse.urlencode({'action': 'query', 'titles': title, 'prop': 'imageinfo',
                                'iiprop': 'url|extmetadata', 'iiurlwidth': 1600,
                                'format': 'json', 'formatversion': '2'})
    page = json.loads(fetch(f'{API}?{q}'))['query']['pages'][0]
    ii = page['imageinfo'][0]
    md = ii['extmetadata']
    author = re.sub(r'<[^>]+>', '', md.get('Artist', {}).get('value', '')).strip()
    author = re.sub(r'\s+', ' ', author)
    license = md.get('LicenseShortName', {}).get('value', '')
    url = md.get('LicenseUrl', {}).get('value', '') or (CC0 if 'CC0' in license else ii['descriptionurl'])
    return {'thumb': ii['thumburl'], 'author': author[:80], 'license': license,
            'licenseUrl': url, 'source': ii['descriptionurl']}


def save(title, file, label):
    meta = info(title)
    im = Image.open(io.BytesIO(fetch(meta['thumb']))).convert('RGB')
    w, h = im.size
    if w / h > 1.5:
        nw = round(h * 1.5)
        im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = round(w / 1.5)
        im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    # A viewpoint's photo is only shown small.
    if not file.startswith('view-'):
        im.resize((960, 640), Image.LANCZOS).save(f'{OUT}/{file}.webp', quality=68, method=6)
    im.resize((480, 320), Image.LANCZOS).save(f'{OUT}/{file}-sm.webp', quality=68, method=6)
    time.sleep(0.3)
    return {'file': file, 'title': label, 'author': meta['author'], 'license': meta['license'],
            'licenseUrl': meta['licenseUrl'], 'source': meta['source']}


def write(data):
    with open(DATA, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def main():
    choices = json.load(open(CHOICES, encoding='utf-8'))
    data = json.load(open(DATA, encoding='utf-8'))
    trails = json.load(open(f'{REPO}/data/sources/osm/trails.json', encoding='utf-8'))['trails']
    names = {t['id']: t['name'] for t in trails}
    for to, title in choices.get('walks', {}).items():
        if to not in data['walks']:
            data['walks'][to] = save(title, f'walk-{slug(to)}', to)
            print('walk', to, flush=True)
    for tid, title in choices.get('trails', {}).items():
        if tid not in data['trails']:
            data['trails'][tid] = save(title, f'trail-{slug(tid)}', names.get(tid, tid))
            print('trail', tid, flush=True)
        write(data)
    saved = {}
    for tid, views in choices.get('views', {}).items():
        out = []
        for v in views:
            entry = {'name': v['name'], 'lat': v['lat'], 'lon': v['lon']}
            if v.get('photo'):
                # One file for each photo, whichever viewpoints and trails it is shown for.
                file = f"view-{slug(v['photo'].removeprefix('File:').rsplit('.', 1)[0])[:60]}"
                entry['photo'] = saved.get(file) or save(v['photo'], file, v['name'])
                saved[file] = entry['photo']
            out.append(entry)
        data['views'][tid] = out
        print('views', tid, len(out), flush=True)
    write(data)


main()

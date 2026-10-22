"""Download source-page image candidates; selection requires visual/source review.

Original bytes are preserved. No files are deleted. Cached pages/candidates stay
under ignored storage/, while only reviewed images are copied to the final pack.
"""
import concurrent.futures
import hashlib
import io
import json
import re
import sys
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from lxml import html
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'storage/research/site-photos-v1'
CACHE.mkdir(parents=True, exist_ok=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36'


def fetch(url, referer=None):
    headers = {'User-Agent': UA}
    if referer:
        headers['Referer'] = referer
    with urlopen(Request(url, headers=headers), timeout=18) as response:
        return response.read(24 * 1024 * 1024), response.headers.get('Content-Type', '')


def source_images(source):
    sid, url = source['id'], source['url']
    try:
        page = CACHE / f'{sid}.html'
        if not page.exists():
            page.write_bytes(fetch(url)[0])
        raw = page.read_bytes()
        try:
            decoded = raw.decode('utf-8')
        except UnicodeDecodeError:
            decoded = raw.decode('gb18030', errors='replace')
        tree = html.fromstring(decoded)
        candidates = []
        seen = set()
        for node in tree.xpath('//img'):
            value = next((node.get(a) for a in ('data-src', 'data-original', 'src') if node.get(a) and not node.get(a).startswith('data:')), None)
            if not value:
                continue
            image_url = urljoin(url, value)
            if image_url in seen or any(x in image_url.lower() for x in ['logo', 'qrcode', 'weixin', 'icon', 'loading', 'blank.gif', 'avatar']):
                continue
            seen.add(image_url)
            parent = node.getparent()
            context = ' '.join(parent.itertext()).strip() if parent is not None else ''
            if parent is not None:
                for sibling in list(parent.itersiblings())[:2]:
                    if isinstance(sibling.tag, str):
                        context += ' ' + ' '.join(sibling.itertext()).strip()
            context = re.sub(r'\s+', ' ', context)[:400]
            candidates.append({'url': image_url, 'alt': node.get('alt', ''), 'context': context})
        result = []
        for index, item in enumerate(candidates[:60], 1):
            iid = f'{sid}-{index:02d}'
            existing = list(CACHE.glob(iid + '.*'))
            try:
                payload = existing[0].read_bytes() if existing else fetch(item['url'], url)[0]
                with Image.open(io.BytesIO(payload)) as image:
                    w, h = image.size
                    extension = {'JPEG': '.jpg', 'PNG': '.png', 'WEBP': '.webp', 'GIF': '.gif'}.get(image.format)
                    image.verify()
                if not extension or w < 360 or h < 220:
                    continue
                dest = CACHE / (iid + extension)
                if not dest.exists():
                    dest.write_bytes(payload)
                result.append({**item, 'id': iid, 'source_id': sid, 'file': dest.relative_to(ROOT).as_posix(), 'width': w, 'height': h, 'sha256': hashlib.sha256(payload).hexdigest()})
            except Exception as error:
                result.append({'id': iid, 'url': item['url'], 'error': str(error)[:160]})
        return {'source': source, 'images': result, 'candidate_count': len(candidates)}
    except Exception as error:
        return {'source': source, 'error': str(error)[:200], 'images': []}


if __name__ == '__main__':
    sources = json.loads((ROOT / 'data/geography/site-photo-sources-v1.json').read_text(encoding='utf-8'))
    if len(sys.argv) > 1:
        sources = [s for s in sources if s['id'] in sys.argv[1:]]
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for result in pool.map(source_images, sources):
            results.append(result)
            print(result['source']['id'], 'images=', len([i for i in result['images'] if 'file' in i]), result.get('error', ''), flush=True)
            (CACHE / (result['source']['id'] + '-manifest.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Completed', len(results), 'source pages', flush=True)

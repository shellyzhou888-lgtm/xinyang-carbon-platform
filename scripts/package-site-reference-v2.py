"""Combine reviewed photographs and user-requested website map screenshots.

Original image bytes stay unchanged. All output is written to v2; v1 is preserved.
Run after taking the explicit UI screenshots listed in 06_高德卫星截图/captures.json.
"""
import csv
import hashlib
import html
import json
import shutil
import zipfile
from collections import Counter
from pathlib import Path
from urllib.parse import quote

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'assets/site-photo-references/v1'
OUT = ROOT / 'assets/site-photo-references/v2'
CAPTURES = OUT / '06_高德卫星截图/captures.json'
DATE = '2026-10-22'


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def contact_sheet(items, target, title):
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 16)
    sheet = Image.new('RGB', (1440, 264 * ((len(items) + 3) // 4) + 62), '#f3f2ed')
    draw = ImageDraw.Draw(sheet)
    draw.text((16, 18), title, font=font, fill='#23372e')
    for n, row in enumerate(items):
        with Image.open(OUT / row['file']) as original:
            image = original.convert('RGB')
        image.thumbnail((344, 216))
        x, y = 12 + n % 4 * 360, 62 + n // 4 * 264
        sheet.paste(image, (x, y))
        draw.text((x, y + 219), row['id'] + ' ' + row['title'][:16], font=font, fill='#23372e')
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target, quality=92)


photos = json.loads((BASE / 'manifest.json').read_text(encoding='utf-8'))
captures = json.loads(CAPTURES.read_text(encoding='utf-8'))
assert len({row['id'] for row in captures}) == len(captures)
rows = []
for photo in photos:
    target = OUT / photo['file']
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(BASE / photo['file'], target)
    zone = photo['group'][3:].split('_')[0]
    rows.append({**photo, 'kind': '新闻与企业实拍', 'zone': zone, 'view': '透视摄影；具体相机参数未核实', 'evidence_status': '来源报道/企业官网；地点限制见note'})

planning = json.loads((ROOT / 'apps/web/data/planning-overlay.json').read_text(encoding='utf-8'))
zone_ids = {'绿色家居': 'green-home', '电子信息': 'electronics', '科创研发': 'research', '科创部落': 'innovation-community'}
planning_evidence = []
for feature in planning['features']:
    points = [point for polygon in feature['geometry']['coordinates'] for point in polygon[0]]
    planning_evidence.append({'id': feature['properties']['id'], 'name': feature['properties']['name'], 'bbox_gcj02_display_only': [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)], 'status': '既有两点相似变换初配准示意，非测绘红线；不是截图相机范围'})
write_json(OUT / '既有规划定位说明.json', planning_evidence)

for capture in captures:
    path = OUT / capture['file']
    with Image.open(path) as image:
        w, h = image.size
        image.verify()
    rows.append({**capture, 'kind': '网站高德卫星截图', 'group': '06_高德卫星截图', 'stage': '01_整体体量' if 'poi_code' not in capture else '02_建筑结构', 'source_id': 'MAP-' + zone_ids[capture['zone']], 'source_title': '园区网站现有高德卫星图层', 'image_url': '', 'published_date_as_reported': '影像拍摄时间未知', 'retrieved_date': DATE, 'capture_date': DATE + '（浏览器截图日期，非影像拍摄日期）', 'width': w, 'height': h, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'rights': '卫星影像及地图内容权利属于高德/相关提供方；页面截图只作本项目设计参考', 'evidence_status': '网站UI直接截图；未测量相机参数，不能当作正交资产图', 'camera_parameters': 'view为按钮操作与界面状态描述；未读取实时相机数值', 'planning_status': '画面红线为项目初配准示意，存在位置偏差；不据此确认企业用地归属'})

for row in rows:
    assert hashlib.sha256((OUT / row['file']).read_bytes()).hexdigest() == row['sha256']
assert len({row['sha256'] for row in rows}) == len(rows), 'Duplicate original image bytes'
write_json(OUT / 'manifest.json', rows)
fields = list(dict.fromkeys(key for row in rows for key in row))
with (OUT / '图片目录.csv').open('w', encoding='utf-8-sig', newline='') as file:
    writer = csv.DictWriter(file, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
for name in ['来源清单.json', '检索与筛选记录.json']:
    shutil.copyfile(BASE / name, OUT / name)
shutil.copyfile(ROOT / 'docs/site-reference-field-review.md', OUT / '实景核对与灰模依据.md')
groups = Counter(row['group'] for row in rows)
for group in groups:
    members = [row for row in rows if row['group'] == group]
    if group == '06_高德卫星截图':
        for zone in zone_ids:
            subset = [row for row in members if row['zone'] == zone]
            if subset:
                contact_sheet(subset, OUT / group / zone / '00_截图总览.jpg', zone + ' / 网站高德截图 / 原图见同目录')
    else:
        contact_sheet(members, OUT / group / '00_缩略总览.jpg', group + ' / 新闻与企业实拍')

e = html.escape
cards = []
for row in rows:
    href = quote(row['file'])
    cards.append(f'''<article data-kind="{e(row['kind'])}" data-zone="{e(row['zone'])}" data-stage="{e(row['stage'])}"><a href="{href}" target="_blank"><img src="{href}" loading="lazy" alt="{e(row['title'])}"></a><div><small>{row['id']} · {e(row['kind'])} · {row['width']}×{row['height']}</small><h2>{e(row['title'])}</h2><p>{e(row['note'])}</p><p class="view">{e(row['view'])}</p><footer><a href="{href}" target="_blank">打开原图</a> · <a href="{e(row['source_url'])}" target="_blank">来源页面</a></footer></div></article>''')
zone_options = ''.join(f'<option>{e(zone)}</option>' for zone in dict.fromkeys(row['zone'] for row in rows))
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>园区实景参考库 v2 · 实拍与高德现场</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f2ed;color:#26382e;font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif}header,main{max-width:1640px;margin:auto;padding:26px}header{padding-top:42px}h1{font-size:36px;margin:4px 0 12px}header p{max-width:1080px}.stats{display:flex;gap:26px;flex-wrap:wrap;margin:18px 0}.stats strong{font-size:28px;margin-right:8px}a{color:#246044}.rule{padding:12px 18px;border-left:4px solid #41785b;background:#e4eadf}nav{display:flex;gap:12px;align-items:center;flex-wrap:wrap;position:sticky;top:0;z-index:3;background:#f3f2edf5;border-block:1px solid #ced7c9;padding:14px 26px}input,select{font:inherit;padding:9px;border:1px solid #bcc9ba;background:white;border-radius:4px}input{min-width:220px;flex:1}#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:20px}article{background:white;border:1px solid #d7dfd1}article img{width:100%;height:238px;object-fit:contain;background:#e3e8de}article>div{padding:16px}h2{font-size:18px;margin:6px 0}p{margin:8px 0}small,footer,.view{font-size:12px;color:#607061}article[hidden]{display:none}details{margin-top:14px}summary{cursor:pointer}
</style><header><small>信阳园区 / 实景资料库 / v2 · 2026-10-22</small><h1>把场地看清楚，再开始建模</h1><div class="stats"><span><strong>TOTAL</strong>张参考</span><span><strong>60</strong>张新闻与企业实拍</span><span><strong>MAPCOUNT</strong>张网站高德截图</span></div><p>高德截图补充四个分区的道路、湖岸、屋顶和体块关系。新闻照片补充地面立面、车间结构和设备细节。原图全部保留；点击图片查看原尺寸。</p><div class="rule">确认后的概念图 = SCENE TRUTH；确认后的正交图 = ASSET TRUTH。<br>Macro → Micro：全场景体块、道路、前中远景灰模 → 整体检查 → Structural refinement → 单体正交与细节。</div><details><summary>已核对的线索与待解决的问题</summary><p>科创部落的地图画面可读湖岸、植被和乡村道路，部分既有红线跨水面，须先复核配准。研发区保留较多空地，不能直接填满研发楼。企业POI只证明定位参考点，画面内楼栋归属和高度仍需核实。</p><p>截图日期不等于卫星影像拍摄日期。俯视地图不是测绘正射图，倾斜地图不等于摄影测量三维场景。旧版概念图未通过评审，仍需重画并确认。</p></details><p><a href="实景核对与灰模依据.md">实景核对与灰模依据</a> · <a href="图片目录.csv">图片目录 CSV</a> · <a href="manifest.json">完整来源与校验 JSON</a> · <a href="README.md">资料包说明</a></p></header><nav><select id="kind" aria-label="资料类型"><option value="">全部类型</option><option>新闻与企业实拍</option><option>网站高德卫星截图</option></select><select id="zone" aria-label="分区"><option value="">全部分区</option>ZONEOPTIONS</select><select id="stage" aria-label="尺度"><option value="">全部尺度</option><option>01_整体体量</option><option>02_建筑结构</option><option>03_设备与细节</option></select><input id="search" aria-label="搜索参考" placeholder="搜索：亚丹、今上、湖岸、道路、附楼……"><span id="count"></span></nav><main id="grid">CARDS</main><script>
const selectors=['kind','zone','stage'].map(id=>document.getElementById(id)),search=document.getElementById('search'),count=document.getElementById('count'),cards=[...document.querySelectorAll('article')];function filter(){let n=0;for(const c of cards){c.hidden=selectors.some(s=>s.value&&c.dataset[s.id]!==s.value)||!c.textContent.toLowerCase().includes(search.value.trim().toLowerCase());if(!c.hidden)n++;}count.textContent=n+' / '+cards.length+' 张';}for(const el of[...selectors,search])el.addEventListener('input',filter);filter();
</script></html>'''
(OUT / 'index.html').write_text(page.replace('TOTAL', str(len(rows))).replace('MAPCOUNT', str(len(captures))).replace('ZONEOPTIONS', zone_options).replace('CARDS', ''.join(cards)), encoding='utf-8')
(OUT / 'README.md').write_text(f'''# 园区实景参考资料包 v2

整理日期：{DATE}。共{len(rows)}张参考，包含原v1的60张新闻/企业实拍，以及本轮直接操作园区网站截取的{len(captures)}张高德卫星页面截图。缩略总览另计，不计入原图数。

打开index.html，可按类型、分区、尺度筛选和搜索；点击原图保留完整页面。图片目录.csv和manifest.json逐图记录文件、来源、分辨率、SHA-256、可用线索与局限。新截图的UI操作记录在06_高德卫星截图/captures.json。旧实拍来源和筛选记录随包保留。

新版为独立资料包，离线可浏览全部图片；本机网站来源链接需网站运行，外部报道链接需联网。所有原图字节保持不变，未增亮、补画或去除标识。截图保留页面原状，画面可能包含网页卡片、既有遮罩和业务演示数值；它们不是几何证据。

高德截图覆盖科创部落4张、研发3张、家居7张、电子6张。企业POI关联来自项目既有park-geography.json，坐标系GCJ-02；POI不等于红线、厂房归属或相机中心的测量值。view中角度来自UI操作推定，未读取实时相机数值。既有规划定位说明.json列的是示意分区包络，不是截图相机范围。

关键发现、证据编号和灰模使用方法见实景核对与灰模依据.md。仍未获得逐栋高度、完整侧后立面、测绘尺寸和真实正交资产图。科创部落不能根据规划功能填成已经建成的总部群；亚丹3张待定位集团外景仍保持待核，没有用POI截图强行确认。

严格顺序：实景核对 → 重画概念图并确认SCENE TRUTH → 全场景灰模 → 整体检查 → structural refinement pass → 确认单体正交图ASSET TRUTH → 单体、材质与灯光。此轮只补资料，没有开始Blender建模。

新闻图片、企业图片、地图影像的权利归各自权利人；资料留在本项目私有参考库，不代表取得公开再分发许可。
''', encoding='utf-8')
exports = ROOT / 'storage/exports'
exports.mkdir(parents=True, exist_ok=True)
archive = exports / '园区实景参考资料_v2_含高德截图.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zipped:
    for file in sorted(OUT.rglob('*')):
        if file.is_file():
            zipped.write(file, Path('园区实景参考资料_v2') / file.relative_to(OUT))
with zipfile.ZipFile(archive) as zipped:
    assert zipped.testzip() is None
print(json.dumps({'total': len(rows), 'photos': len(photos), 'maps': len(captures), 'map_zones': Counter(row['zone'] for row in captures), 'zip_MB': round(archive.stat().st_size / 1024**2, 2)}, ensure_ascii=False))

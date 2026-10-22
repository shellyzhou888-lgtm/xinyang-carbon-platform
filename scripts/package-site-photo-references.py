"""Package manually reviewed originals with provenance and an offline gallery.

Requires Pillow. Run collect-site-photo-references.py first. Never deletes files.
Selection is explicit in data/geography/site-photo-selection-v1.tsv.
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
CACHE = ROOT / 'storage/research/site-photos-v1'
OUT = ROOT / 'assets/site-photo-references/v1'
OUT.mkdir(parents=True, exist_ok=True)
sources = json.loads((ROOT / 'data/geography/site-photo-sources-v1.json').read_text(encoding='utf-8'))
source_map = {s['id']: s for s in sources}
images = {}
audits = []
for file in sorted(CACHE.glob('S*-manifest.json')):
    record = json.loads(file.read_text(encoding='utf-8'))
    images.update({i['id']: i for i in record['images'] if 'file' in i})
    audits.append({'source_id': record['source']['id'], 'downloaded_candidates': sum('file' in i for i in record['images']), 'error': record.get('error', '')})
with (ROOT / 'data/geography/site-photo-selection-v1.tsv').open(encoding='utf-8', newline='') as f:
    selected = list(csv.DictReader(f, delimiter='\t'))
rows, hashes = [], set()
for choice in selected:
    item = images[choice['id']]
    source = source_map[item['source_id']]
    original = ROOT / item['file']
    digest = hashlib.sha256(original.read_bytes()).hexdigest()
    assert digest == item['sha256'] and digest not in hashes, choice['id']
    hashes.add(digest)
    with Image.open(original) as image:
        image.verify()
    rel = Path(choice['group']) / choice['stage'] / (choice['id'] + '_' + choice['title'] + original.suffix)
    target = OUT / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(original, target)
    rows.append({**choice, 'file': rel.as_posix(), 'source_id': source['id'], 'source_title': source['title'], 'source_url': source['url'], 'image_url': item['url'], 'published_date_as_reported': source['date'], 'retrieved_date': '2026-10-21', 'capture_date': '未单独核实；发稿日期不等于拍摄日期', 'width': item['width'], 'height': item['height'], 'sha256': digest, 'rights': '原发布者/摄影者保留权利；项目参考存档，未取得通用再分发许可', 'geometry_status': '透视实拍，非正交测绘；尺寸与坐标未验证'})
(OUT / 'manifest.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
with (OUT / '照片目录.csv').open('w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
for a in audits:
    a['selected'] = sum(r['source_id']==a['source_id'] for r in rows)
(OUT / '检索与筛选记录.json').write_text(json.dumps(audits, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
used = {r['source_id'] for r in rows}
(OUT / '来源清单.json').write_text(json.dumps([s for s in sources if s['id'] in used], ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
counts = Counter(r['group'] for r in rows)
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 17)
for group in counts:
    members = [r for r in rows if r['group']==group]
    sheet = Image.new('RGB', (1440, 252*((len(members)+3)//4)+60), '#f0f0eb')
    draw = ImageDraw.Draw(sheet); draw.text((18,16), f'{group} / {len(members)} 张 / 仅缩略总览，原图见子文件夹', font=font, fill='#222222')
    for n,r in enumerate(members):
        im=Image.open(OUT/r['file']).convert('RGB'); im.thumbnail((348,205))
        x=12+n%4*360; y=60+n//4*252; sheet.paste(im,(x,y))
        draw.text((x,y+208),r['id']+' '+r['title'][:15],font=font,fill='#222222')
    sheet.save(OUT/group/'00_缩略总览.jpg',quality=90)
cards=[]
e=html.escape
for r in rows:
    path=quote(r['file'])
    cards.append(f'''<article data-group="{e(r['group'])}" data-stage="{e(r['stage'])}"><a href="{path}" target="_blank"><img loading="lazy" src="{path}" alt="{e(r['title'])}"></a><div class="body"><small>{r['id']} · {e(r['stage'][3:])} · {r['width']} × {r['height']}</small><h2>{e(r['title'])}</h2><p>{e(r['note'])}</p><footer>{e(r['published_date_as_reported'])} · <a href="{e(r['source_url'])}" target="_blank" rel="noopener">来源报道</a> · <a href="{path}" target="_blank">原图</a></footer></div></article>''')
options=''.join(f'<option value="{e(g)}">{e(g[3:])}（{n}）</option>' for g,n in counts.items())
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>园区实景参考库 · v1</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f2ed;color:#242d28;font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif}header,main{max-width:1600px;margin:auto;padding:24px}header{padding-top:45px}h1{font-size:36px;margin:0}header p{max-width:1000px}nav{display:flex;gap:12px;flex-wrap:wrap;position:sticky;top:0;background:#f3f2edf5;padding:15px 24px;z-index:2;border-block:1px solid #d4d8cf}select,input{font:inherit;padding:9px;border:1px solid #bac4ba;background:white;border-radius:4px}input{flex:1;min-width:230px}#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}article{background:white;border:1px solid #dde2d9}article img{width:100%;height:235px;object-fit:contain;background:#e8ebe5}h2{font-size:19px;margin:6px 0}p{margin:8px 0}.body{padding:16px}small,footer{color:#5a695e}a{color:#236245}article[hidden]{display:none}.rule{border-left:4px solid #466953;padding-left:16px}#count{padding:10px 0}
</style><header><small>信阳园区 / 现场参考资料 / v1 · 2026-10-21</small><h1>从真实场地开始</h1><p>COUNT 张筛选照片，保留下载原图与来源。点击照片查看原尺寸；发稿时间不等于拍摄时间。周边环境、待定位照片已分栏，不能当成园区内已核实建筑。</p><p class="rule">概念图 = SCENE TRUTH（须先确认）；正交图 = ASSET TRUTH。<br>Macro → Micro：大体块、道路、前中远景全部灰模 → Structural refinement → 单体与材质细节。</p><p>本库没有测绘正交图。旧版概念图未通过评审。科创部落目前只有北湖环境参考；研发区补到羊山智慧岛主立面与室内，仍需坐标和其他方向照片。</p><a href="README.md">使用说明与缺口</a> · <a href="照片目录.csv">下载目录 CSV</a> · <a href="manifest.json">逐图来源 JSON</a></header><nav><select id="group" aria-label="分区"><option value="">全部分区</option>OPTIONS</select><select id="stage" aria-label="尺度"><option value="">全部尺度</option><option>01_整体体量</option><option>02_建筑结构</option><option>03_设备与细节</option></select><input id="search" aria-label="搜索" placeholder="搜索：屋架、道路、万华、窗带……"><span id="count"></span></nav><main id="grid">CARDS</main><script>
const group=document.getElementById('group'),stage=document.getElementById('stage'),search=document.getElementById('search'),count=document.getElementById('count');const cards=[...document.querySelectorAll('article')];function filter(){let n=0;for(const c of cards){c.hidden=!!((group.value&&c.dataset.group!==group.value)||(stage.value&&c.dataset.stage!==stage.value)||!c.textContent.toLowerCase().includes(search.value.trim().toLowerCase()));if(!c.hidden)n++;}count.textContent=n+' / '+cards.length+' 张';}for(const el of[group,stage,search])el.addEventListener('input',filter);filter();
</script></html>'''
page=page.replace('COUNT',str(len(rows))).replace('OPTIONS',options).replace('CARDS',''.join(cards))
(OUT/'index.html').write_text(page,encoding='utf-8')
readme=f'''# 园区实景参考资料包 v1

整理日期：2026-10-21。共 {len(rows)} 张原始照片，来自 {len(used)} 个已使用来源页；检索候选来源共 {len(sources)} 个。照片原始字节保留，未生成、补画、去水印或放大。各组 `00_缩略总览.jpg` 是额外生成的索引，不计入照片数。

直接打开 `index.html` 可离线筛选浏览；点击图片查看原图。`照片目录.csv` 和 `manifest.json` 逐图记录原始链接、报道链接、分辨率、SHA-256、归属说明和限制。英文编号与来源清单对应。

## 分组

'''+'\n'.join(f'- {g}：{n} 张。' for g,n in counts.items())+'''

## 使用层级

1. 01_整体体量：优先读厂房长宽关系、体块高低、道路、湖岸和前中远景；照片透视不能用于直接测量。
2. 02_建筑结构：提取主楼/裙房、退台、附楼、入口、屋架、柱网、窗带等结构线索。
3. 03_设备与细节：整体灰模和结构调整完成后，才使用机器、管线、灯带、材料和景观细节。

概念图是 SCENE TRUTH，正交图是 ASSET TRUTH；前提是相应图稿已获确认。照片用于取证与交叉核对，本包没有测绘正交图。仰拍立面不是正交图，单张航拍不是总平面。多个年份的照片不表示同一时刻的现状。

## 缺口与筛选

- 科创部落：北湖环境、低层庭院可用，未获得福睿健康科创中心及七个组团逐栋可核实的建成实拍；不以住宅或其他城市园区冒充。建设线索：[信阳日报2024-02-02](https://ribao.xyxww.com.cn/html/2024-02/02/content_138050.htm)。
- 科创研发：已找到羊山智慧岛主楼/裙房和启迪之星室内。与项目规划多边形的具体坐标归属、侧后立面、屋顶设备仍待核；不混用南湾智慧岛。
- 亚丹外景3张来自信阳投产报道，但文章同时介绍多个集团基地，单图没有独立地点说明，单放90_待定位实拍；不可用于信阳厂区排布。车间参观图位于信阳投产活动段落，也需后续现场复核。
- 周边道路与远景是明确分离的类型/环境参照，不等于园区资产清单。
- 未收录效果图、集团东莞基地、中部半导体异地片区图、广告、二维码、通知截图、重复文件与大量仪式人物照。少量会议/参观照片因建筑结构可辨而保留。
- 部分报纸图仅400px宽，已在目录说明；没有用AI补细节制造“高清”。没有获得真实尺寸、完整屋顶俯视、可靠正交立面或摄影测量组照。
- Metaso检索期间额度不足，后续改用网页搜索和原文页。部分页面404/403或SSL连接失败，下载失败不计为已收集；详见检索与筛选记录。

## 下一轮制作顺序

实景参考与边界核对 → 重画并确认概念场景 → 全场景灰模（全部大体块、道路、前景/中景/远景）→ 整体检查 → structural refinement pass（退台、高低跨、附楼、凹口、连廊、屋顶层次等有依据的不规则结构）→ 正交资产图确认 → 单体细化 → 材质和灯光。任何缺失的结构推测都标为待核，不随机扭曲真实建筑。

本轮仅整理资料，不开始Blender建模。旧v1概念图保留供对照但未获通过，不能作为已经批准的SCENE TRUTH。

版权属于原发布者/摄影者，图片仅在本项目私有资料库留作设计参考，保留原水印与来源；本次整理未取得通用公开再分发许可。
'''
(OUT/'README.md').write_text(readme,encoding='utf-8')
exports=ROOT/'storage/exports';exports.mkdir(parents=True,exist_ok=True)
archive=exports/'园区实景参考资料_v1.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for f in sorted(OUT.rglob('*')):
        if f.is_file(): z.write(f,Path('园区实景参考资料_v1')/f.relative_to(OUT))
with zipfile.ZipFile(archive) as z: assert z.testzip() is None
print(json.dumps({'photos':len(rows),'groups':counts,'used_sources':len(used),'zip_MB':round(archive.stat().st_size/1024**2,2)},ensure_ascii=False))

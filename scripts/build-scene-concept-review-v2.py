"""Build a local review page and contact sheet without altering original images."""
import hashlib
import html
import json
import shutil
import zipfile
from pathlib import Path
from urllib.parse import quote

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/modeling-concepts/v2'
record = json.loads((OUT / 'generation-prompts.json').read_text(encoding='utf-8'))
e = html.escape
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 24)
small = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 18)
sheet = Image.new('RGB', (1920, 1180), '#f1f0ea')
draw = ImageDraw.Draw(sheet)
draw.text((26, 14), '园区四区场景概念 v2 / AI概念图，待确认 / 非测绘成果', font=font, fill='#293c31')
cards = []
source_records = {row['id']: row for row in json.loads((ROOT / 'assets/site-photo-references/v2/manifest.json').read_text(encoding='utf-8'))}
reference_records = {}
for n, asset in enumerate(record['assets']):
    path = OUT / asset['file']
    with Image.open(path) as image:
        width, height = image.size
        preview = image.convert('RGB')
        preview.thumbnail((928, 522))
    asset['width'], asset['height'] = width, height
    asset['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    x, y = 16 + n % 2 * 960, 62 + n // 2 * 558
    sheet.paste(preview, (x, y))
    draw.text((x + 8, y + 525), asset['name'] + ' · 待用户确认', font=small, fill='#293c31')
    refs=[]
    for ref in asset['references']:
        original = ROOT / ref['file']
        rel = 'references/' + ref['id'] + original.suffix
        target = OUT / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
        reference_records[ref['id']] = {**source_records[ref['id']], 'original_project_file': ref['file'], 'review_file': rel}
        refs.append(f'<a href="{quote(rel)}" target="_blank"><img loading="lazy" src="{quote(rel)}" alt="参考{ref["id"]}"><span>{e(ref["id"])}</span></a>')
    cards.append(f'''<section id="{asset['key']}"><h2>{e(asset['name'])}<small>场景方向待确认</small></h2><a href="{quote(asset['file'])}" target="_blank"><img class="scene" src="{quote(asset['file'])}" alt="{e(asset['name'])}第二轮场景概念"></a><p>参考：{e('、'.join(ref['id'] for ref in asset['references']))}。图中建筑数量、层高、立面与邻接仍含推定。</p><details><summary>展开原始参考图，对照空间和建筑类型</summary><div class="refs">{''.join(refs)}</div></details></section>''')
sheet.save(OUT / '00-four-zone-review.jpg', quality=94)
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>园区场景概念 v2 · 待确认</title><style>*{box-sizing:border-box}body{margin:0;background:#f1f0ea;color:#26382c;font:16px/1.65 system-ui,"Microsoft YaHei",sans-serif}header,main{max-width:1560px;margin:auto;padding:28px}h1{font-size:36px;margin:8px 0}header p{max-width:1100px}.rule{border-left:4px solid #496f54;padding:12px 20px;background:#e1e8da}nav{display:flex;flex-wrap:wrap;gap:18px;padding:14px 28px;border-block:1px solid #c8d1c0;position:sticky;top:0;background:#f1f0eaf5;z-index:3}a{color:#2d6545}section{padding:12px 0 38px;margin-bottom:18px;border-bottom:1px solid #c8d1c0}h2{font-size:26px}h2 small{font-weight:400;font-size:13px;margin-left:18px;color:#6f7c64}.scene{width:100%;height:auto;display:block}.refs{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-top:16px}.refs img{width:100%;height:220px;object-fit:contain;background:#e0e5d9}.refs span{display:block}summary{cursor:pointer}details{padding:14px;background:#e6eadf}footer{padding:30px;color:#687761}</style><header><small>信阳园区 / 第二轮场景评审 / 2026-10-22</small><h1>先确认场景，再开始灰模</h1><p>四张AI场景概念参考原始照片和高德截图重画，重点确认整体体块、道路、留白与前中远景。建筑高度、数量与细部仍有推定，图片不是实拍或测绘结果。</p><div class="rule">确认后的概念图 = SCENE TRUTH；确认后的正交图 = ASSET TRUTH。<br>后续仅使用Blender MCP：全场景灰模 → 整体检查 → structural refinement → 正交资产与单体细化。</div><p>当前没有已确认的正交资产图；Blender MCP尚未连接。这轮只提交场景图供评审。<a href="../../../docs/park-scene-concepts-v2-review.md">完整核对与执行说明</a> · <a href="../../site-photo-references/v2/index.html">80张实景参考资料库</a> · <a href="generation-prompts.json">完整生成提示词</a></p></header><nav>NAV</nav><main>CARDS</main><footer>科创部落保留湖岸与空地；研发片区未强插尚未定位的智慧岛塔楼。旧v1图稿未获通过，继续保留供对照。</footer></html>'''
nav=''.join(f'<a href="#{a["key"]}">{e(a["name"])}</a>' for a in record['assets'])
page = page.replace('../../../docs/park-scene-concepts-v2-review.md', 'review-notes.md').replace('../../site-photo-references/v2/index.html', 'references/index.html').replace('80张实景参考资料库', '本轮12张原始参考与来源')
(OUT / 'index.html').write_text(page.replace('NAV', nav).replace('CARDS', ''.join(cards)), encoding='utf-8')
shutil.copyfile(ROOT / 'docs/park-scene-concepts-v2-review.md', OUT / 'review-notes.md')
(OUT / 'reference-manifest.json').write_text(json.dumps(list(reference_records.values()), ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
ref_cards=[]
for ref in reference_records.values():
    file = Path(ref['review_file']).name
    ref_cards.append(f'<article><h2>{e(ref["id"])} {e(ref["title"])}</h2><a href="{quote(file)}"><img style="max-width:100%;height:250px;object-fit:contain" src="{quote(file)}" alt="{e(ref["title"])}"></a><p>{e(ref["note"])}</p><a href="{e(ref["source_url"])}">原始来源页面（需联网或运行本机网站）</a></article>')
(OUT/'references/index.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本轮原始参考</title><body style="font:16px/1.6 system-ui;background:#f1f0ea;padding:24px"><a href="../index.html">返回场景评审</a><h1>原始参考与地点限制</h1><p>照片与网站截图是核对证据，保留原图字节；AI场景不是实拍。完整来源见<a href="../reference-manifest.json">来源清单</a>。</p>'+''.join(ref_cards)+'</body></html>',encoding='utf-8')
(OUT / 'generation-prompts.json').write_text(json.dumps(record, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')
(OUT / 'README.md').write_text('# 场景概念图第二轮 v2\n\n2026-10-22。四张原始PNG由内置image_gen生成，参考关系、完整提示词、原生尺寸与SHA-256见generation-prompts.json。\n\n打开index.html可逐区查看大图并展开实拍/卫星参考对照。references/保留本轮12张原始参考，reference-manifest.json逐图记录来源与限制。00-four-zone-review.jpg仅为四图缩略总览，不替代原图。图稿尚待用户确认；当前不是批准的SCENE TRUTH，也不是正交ASSET TRUTH。\n\n后续建模只通过Blender MCP，当前尚未连接，未执行建模。先全场景灰模，再structural refinement，再正交资产与单体细化。细节见review-notes.md（其中项目文档相对链接用于仓库内阅读）。\n',encoding='utf-8')
exports=ROOT/'storage/exports';exports.mkdir(parents=True,exist_ok=True)
archive=exports/'园区四区场景概念_v2.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as zipped:
    for path in sorted(OUT.rglob('*')):
        if path.is_file(): zipped.write(path,Path('园区四区场景概念_v2')/path.relative_to(OUT))
with zipfile.ZipFile(archive) as zipped: assert zipped.testzip() is None
print(json.dumps({'images':[{k:a[k] for k in ['key','width','height']} for a in record['assets']],'zip_MB':round(archive.stat().st_size/1024**2,2)},ensure_ascii=False))

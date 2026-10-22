"""Package eight original architectural boards and their reference provenance."""
import hashlib
import html
import json
import shutil
import zipfile
from pathlib import Path
from urllib.parse import quote

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/building-concepts/v1'
views = json.loads((OUT / 'generation-prompts.json').read_text(encoding='utf-8'))
details = json.loads((OUT / 'detail-generation-prompts.json').read_text(encoding='utf-8'))
source_rows = {row['id']: row for row in json.loads((ROOT / 'assets/site-photo-references/v2/manifest.json').read_text(encoding='utf-8'))}
boards = []
for board in views['boards'] + details['boards']:
    path = OUT / board['file']
    with Image.open(path) as image:
        width, height = image.size
        image.verify()
    boards.append({**board, 'width': width, 'height': height, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'approval': '待用户评审；投影一致性、现场事实和尺寸尚未核验', 'panel_count': 6 if board['type']=='多视图板' else 4})
assert len(boards)==8
assert sum(board['panel_count'] for board in boards)==40
assert len({board['sha256'] for board in boards})==8
(OUT / 'manifest.json').write_text(json.dumps(boards, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')
reference_ids = list(dict.fromkeys(ref for board in boards for ref in board['refs']))
references=[]
for ref_id in reference_ids:
    row = source_rows[ref_id]
    original = ROOT/'assets/site-photo-references/v2'/row['file']
    relative = Path('references')/(ref_id+original.suffix)
    target = OUT/relative
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(original,target)
    assert hashlib.sha256(target.read_bytes()).hexdigest()==row['sha256']
    references.append({**row, 'original_project_file': 'assets/site-photo-references/v2/'+row['file'], 'package_file': relative.as_posix()})
(OUT/'reference-manifest.json').write_text(json.dumps(references,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
shutil.copyfile(ROOT/'docs/park-building-concepts-review.md',OUT/'review-notes.md')
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',24)
small=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',19)
for kind, filename in [('多视图板','00-multiview-overview.jpg'),('细节板','00-details-overview.jpg')]:
    members=[b for b in boards if b['type']==kind]
    sheet=Image.new('RGB',(2200,1630),'#f4f1e9');draw=ImageDraw.Draw(sheet)
    draw.text((20,16),'四园区代表建筑 / '+kind+' / AI概念草案 · 待确认',font=font,fill='#293d32')
    for n,board in enumerate(members):
        with Image.open(OUT/board['file']) as image: thumb=image.convert('RGB')
        thumb.thumbnail((1070,730))
        x=16+n%2*1100;y=60+n//2*780
        sheet.paste(thumb,(x,y))
        draw.text((x+4,y+736),board['zone']+' · '+board['asset'],font=small,fill='#293d32')
    sheet.save(OUT/filename,quality=94)
e=html.escape
sections=[]
nav=[]
for n,view in enumerate(views['boards'],1):
    detail=next(b for b in details['boards'] if b['zone']==view['zone'])
    anchor='zone-'+str(n);nav.append(f'<a href="#{anchor}">{e(view["zone"])}</a>')
    refs=[]
    for rid in view['refs']:
        row=next(r for r in references if r['id']==rid)
        refs.append(f'<a href="{quote(row["package_file"])}" target="_blank"><img loading="lazy" src="{quote(row["package_file"])}" alt="参考{rid}"><span>{rid} · {e(row["title"])}</span></a>')
    panels=' / '.join(detail['panels'])
    sections.append(f'''<section id="{anchor}"><div class="title"><small>0{n}</small><h2>{e(view['zone'])}</h2><span>{e(view['asset'])}</span></div><p class="status">{e(view['status'])}</p><h3>正面 · 背面 · 左右侧面 · 屋顶俯视 · 轴测</h3><p>FRONT正面 / BACK背面 / LEFT左侧 / RIGHT右侧 / TOP屋顶俯视 / AXONOMETRIC轴测。点击原图放大查看。</p><a href="{quote(view['file'])}" target="_blank"><img class="board" loading="lazy" src="{quote(view['file'])}" alt="{e(view['zone'])}建筑六视图概念"></a><h3>四个建筑局部放大</h3><p>{e(panels)}</p><a href="{quote(detail['file'])}" target="_blank"><img class="board" loading="lazy" src="{quote(detail['file'])}" alt="{e(view['zone'])}四个建筑细节概念"></a><details><summary>展开原始实拍或卫星参考</summary><div class="refs">{''.join(refs)}</div></details></section>''')
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>建筑多视图与细节概念 · 四园区</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f0e8;color:#293a31;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}header,main{max-width:1580px;margin:auto;padding:28px}header{padding-top:42px}h1{font-size:38px;margin:5px 0 18px}header p{max-width:1120px}a{color:#326346}nav{position:sticky;top:0;z-index:2;background:#f3f0e8f5;padding:14px 28px;display:flex;gap:26px;flex-wrap:wrap;border-block:1px solid #cbd2c2}.rule{border-left:4px solid #4c7054;padding:10px 18px;background:#e3e7db}.stats{display:flex;gap:30px;margin:18px 0}.stats b{font-size:30px;margin-right:7px}section{margin-top:22px;padding-bottom:44px;border-bottom:1px solid #cbd2c2}.title{display:flex;align-items:baseline;gap:18px;flex-wrap:wrap}.title small{font-size:24px;color:#77836b}h2{font-size:29px;margin:5px 0}.status{color:#76634c;background:#ece5d6;padding:12px 16px}h3{margin-top:28px;font-size:21px}.board{width:100%;height:auto;display:block;border:1px solid #d8d5c9}.refs{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:14px}.refs img{width:100%;height:230px;object-fit:contain;background:#e2e5da}.refs span{display:block;font-size:13px}details{padding:14px 16px;background:#e6e9de;margin-top:20px}summary{cursor:pointer}footer{max-width:1580px;margin:auto;padding:28px;color:#6e7967}</style><header><small>信阳园区 / 单体资产概念 / v1 · 2026-10-22</small><h1>把建筑转过来，把细节放大看</h1><div class="stats"><span><b>4</b>代表性建筑</span><span><b>8</b>概念图板</span><span><b>40</b>方向与局部画面</span></div><p>每个园区先做一套代表单体：六向多视图用于看体块、开口与附楼关系，四个局部用于看入口、屋面、外墙接缝和服务设施。这轮不是航拍大全景，也不是所有园区建筑的完整清单。</p><div class="rule">SCENE TRUTH：整场景图另行确认。ASSET TRUTH：完成一致性核对并确认的正交资产图才可用于定稿。<br>本轮全为待评审AI概念草案，未测绘、未给出真实尺寸；未知背侧面和新设计提案已标注。</div><p>三维建模仍只通过Blender MCP，先整体灰模，再结构细化与单体细化。当前没有执行建模。</p><p><a href="review-notes.md">事实范围、投影限制与建模顺序</a> · <a href="manifest.json">8张图板与完整提示词</a> · <a href="reference-manifest.json">参考照片来源</a> · <a href="00-multiview-overview.jpg">多视图总览</a> · <a href="00-details-overview.jpg">细节总览</a></p></header><nav>NAV</nav><main>SECTIONS</main><footer>图板中的背侧面、设备数量、节点与尺寸仍须核实；轴测和局部透视不作为正交尺寸依据。确认概念外观不等于确认现场事实。</footer></html>'''
(OUT/'index.html').write_text(page.replace('NAV',''.join(nav)).replace('SECTIONS',''.join(sections)),encoding='utf-8')
(OUT/'README.md').write_text('# 四园区代表建筑概念资料 v1\n\n2026-10-22。四套代表建筑，各一张六向多视图板和一张四局部细节板，共8张原始PNG、40个子画面。此轮不是园区全部楼栋建模清单。\n\n打开index.html查看每套大图，点击图板打开原尺寸。00-multiview-overview.jpg与00-details-overview.jpg是缩略索引，原始PNG未裁剪或放大。references/保留原始照片与卫星截图，来源和限制见reference-manifest.json。\n\n所有图由内置image_gen生成，记录见generation-prompts.json、projection-revision-prompts.json、detail-generation-prompts.json、generation-outputs.json；选定图板原生尺寸与SHA-256见manifest.json。\n\n当前尚未通过资产评审。缺失背侧面、屋顶与尺寸为推定；科创部落院落为新设计提案，研发资产未核实其在规划片区的位置。图面可能仍有跨视图差异或透视残留，需核对后才能定为ASSET TRUTH；详见review-notes.md。\n\n所有后续建模、工程保存、渲染和导出均通过Blender MCP。先全场景灰模，整体检查后做structural refinement，再细化单体。本轮没有输出模型。\n',encoding='utf-8')
exports=ROOT/'storage/exports';exports.mkdir(parents=True,exist_ok=True)
archive=exports/'园区建筑多视图与细节概念_v1.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as zipped:
    for path in sorted(OUT.rglob('*')):
        if path.is_file():zipped.write(path,Path('园区建筑多视图与细节概念_v1')/path.relative_to(OUT))
with zipfile.ZipFile(archive) as zipped:assert zipped.testzip() is None
print(json.dumps({'boards':len(boards),'panels':sum(b['panel_count'] for b in boards),'references':len(references),'zip_MB':round(archive.stat().st_size/1024**2,2)},ensure_ascii=False))

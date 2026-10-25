"""Package existing MCP evidence and comparison pages; never opens or edits Blender."""
import copy
import hashlib
import html
import json
import re
import struct
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/blender-models/v3'
REVIEW=OUT/'review'
REVIEW.mkdir(parents=True,exist_ok=True)

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def dump(name,data):
    (REVIEW/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

records=[]
for path in sorted((ROOT/'storage/tooling/blender-mcp/audit').glob('v3-*.json')):
    data=json.loads(path.read_text(encoding='utf-8'))
    message='\n'.join(c['text'] for c in data['result'].get('content',[]) if c.get('type')=='text')
    failed=data['result'].get('isError',False) or message.startswith(('Error','Rejected'))
    records.append(dict(label=path.stem,at=data['at'],transport=data['transport'],package=data['package'],
                        tool=data['tool'],status='failed' if failed else 'returned_success',
                        code_sha256=hashlib.sha256(data['arguments'].get('code','').encode()).hexdigest(),
                        raw_record_sha256=digest(path),result_text=message[:3500]))
dump('mcp-evidence.json',records)
audit_label='v3-delivery-audit'
raw=json.loads((ROOT/'storage/tooling/blender-mcp/audit'/f'{audit_label}.json').read_text())
joined='\n'.join(c['text'] for c in raw['result']['content'] if c.get('type')=='text')
start=joined.index('{"stage": "form_review_pending"')
qa=json.JSONDecoder().raw_decode(joined[start:])[0]
qa['generated_morphology_counts_note']='Counts describe generated placements before local crown/branch pruning, not a surveyed or recounted tree inventory.'
qa['visual_review_status']='human_form_approval_pending; still simplified/sandbox-like compared with the approved photographic concepts'
dump('qa.json',qa)

initial=json.loads((OUT/'scene-contract.json').read_text())
final=copy.deepcopy(initial)
for s in final['zones']['GH']['buildings']:
    if s['id'] in ('GH_H03','GH_H04','GH_H05'):
        idx=final['zones']['GH']['buildings'].index(s)
        s['y']={'GH_H03':-82,'GH_H04':54,'GH_H05':210}[s['id']]
        final['zones']['GH']['yards'][idx][1]=s['y']
poses={'GH':([40,140,0],[780,-1180,650]),'EI':([0,190,0],[850,-1500,1100]),
       'IN':([-20,180,0],[750,-1250,850]),'RD':([0,260,0],[1000,-1700,1260])}
def soften(points):
    for _ in range(2):
        result=[points[0]]
        for a,b in zip(points,points[1:]):
            result.extend([[a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25],
                           [a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]])
        points=result+[points[-1]]
    return points
for z,(target,eye) in poses.items():final['zones'][z]['target']=target;final['zones'][z]['eye']=eye
for zone,changes in {'GH':[(-710,420,0,-30),(710,510,0,60)],'RD':[(-650,350,0,-110),(-520,-700,-70,0)]}.items():
    for x,y,dx,dy in changes:
        pond=next(p for p in final['zones'][zone]['ponds'] if p[0]==x and p[1]==y)
        pond[0]+=dx;pond[1]+=dy
final['zones']['IN']['shoreline']=soften(final['zones']['IN']['shoreline'])
for road in final['zones']['IN']['roads']:
    if road['role'] in ('pedestrian','rural'):road['points']=soften(road['points'])
final['structural_detail_recipe']='scripts/blender/revision-v3-03-architecture.py plus revision-v3-05-review-refine.py secondary wings; this JSON records envelopes, not every subcomponent'
final['final_passes']=['tightened GH spacing','varied commercial secondary wings','photo-ground/water refinements',
                       '0.58 canopy tessellation ratio','natural crown component coverage 1.55 / narrow 1.15 outside protected corridors',
                       'GH left factory aprons merged to x=-315 y=-15 width=440 depth=602; EI apron depths separated by 0.006m per index',
                       'plan cameras fitted to the full composition at 1.6 aspect ratio',
                       'four unmeasured GH/RD context ponds moved clear of roads; vegetation intrusion pruned']
dump('final-layout.json',final)

reference_manifest=json.loads((ROOT/'assets/modeling-concepts/v2/reference-manifest.json').read_text())
used={r.split(':')[0] for d in initial['zones'].values() for r in d['references']}
sources=[r for r in reference_manifest if r['id'] in used]
archive=json.loads((ROOT/'assets/site-photo-references/v2/manifest.json').read_text())
for r in archive:
    if r['id'] in used and r['id'] not in {x['id'] for x in sources}:
        item=dict(r);item['original_project_file']='assets/site-photo-references/v2/'+r['file'];sources.append(item)
dump('references.json',dict(primary_manifest='assets/modeling-concepts/v2/reference-manifest.json',
                           supplemental_manifest='assets/site-photo-references/v2/manifest.json',
                           entries=sources,missing_reference_records=sorted(used-{r['id'] for r in sources}),
                           caution='Map screenshots are not orthographic asset drawings. S32-08 is unlocated/material-only. Archive dates are not present-day site verification.'))

titles={'GH':'绿色家居','EI':'电子信息','IN':'科创部落 / 北湖','RD':'研发组团'}
concepts={'GH':'01-green-home.png','EI':'02-electronics.png','IN':'03-innovation-community.png','RD':'04-research.png'}
descriptions={
 'GH':'平行长跨厂房、分离工艺组团、红色装卸口、银灰屋面；主体间距重新收紧。',
 'EI':'前排双厂房—预留地—院落—北部蓝顶；东侧铁路单独组织。',
 'IN':'平滑湖岸、稀疏低层庭院与不同树冠；没有把空地补成研发总部。',
 'RD':'前景保留地与池塘，中景退台楼群、坡顶商业侧翼和北部院区。',
}
sections=[]
for z,title in titles.items():
    q=qa['zones'][z]
    sections.append(f'''<section id="{z}"><h2>{html.escape(title)}</h2>
<p>{html.escape(descriptions[z])} <small>{q['composition_units']} 个构图单元 · {q['triangles']:,} 三角面 · 待用户确认</small></p>
<div class="compare"><figure><figcaption>已确认概念图 · SCENE TRUTH</figcaption><a href="../../modeling-concepts/v2/{concepts[z]}"><img src="../../modeling-concepts/v2/{concepts[z]}" alt="{title}已确认概念图"></a></figure>
<figure><figcaption>v3 实际 Blender 渲染 · 审阅稿</figcaption><a href="renders/{z}-overview.png"><img src="renders/{z}-overview.png" alt="{title}修订全景"></a></figure></div>
<details><summary>局部 / 顶视 / 阶段灰模</summary><div class="more">'''+''.join(
    f'<figure><figcaption>{label}</figcaption><a href="{folder}/{z}-{view}.png"><img loading="lazy" src="{folder}/{z}-{view}.png" alt="{title}{label}"></a></figure>'
    for folder,view,label in [('renders','detail','局部结构与材质'),('renders','plan','最终顶视'),('greybox','overview','细化前整区灰模')])+'''</div></details></section>''')
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>四园区 v3 · 概念与模型对照</title><style>
body{margin:0;background:#f3f2ee;color:#28342d;font:16px/1.7 system-ui,sans-serif}main{max-width:1600px;margin:auto;padding:32px}h1{font-size:30px;margin:0}h2{font-size:24px;margin:0}p{max-width:1120px}a{color:#285940}nav{display:flex;gap:22px;flex-wrap:wrap}.notice{background:#fff3d9;border-left:4px solid #ad8a36;padding:16px 22px}.compare,.more{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;background:white}figcaption{padding:10px 14px;font-size:14px;font-weight:600}img{width:100%;display:block}section{padding:36px 0;border-bottom:1px solid #d4d8d0}small{display:block;color:#647166}details{margin-top:20px}summary{cursor:pointer;margin:12px 0}.more{grid-template-columns:repeat(3,1fr)}footer{margin-top:30px;color:#647166;font-size:14px}@media(max-width:800px){main{padding:18px}.compare,.more{grid-template-columns:1fr}}
</style><main><h1>四园区 v3 · 概念与模型对照</h1><p>针对“间距过大、建筑和绿植同质化、配色未参照实拍”的修订 · 2026-10-25 · v0.54.0</p>
<div class="notice">这是待审阅的建模修订稿，仍有沙盘感，<strong>不是照片级复原、测绘成果或已通过外观确认的交付</strong>。林地密度、地形、远景及部分立面尚需继续细化。旧版保留，新 GLB 和网站均未替换。</div>
<p><a href="park-reference-v3.blend">打开 / 下载 v3 总工程</a> · <a href="README.md">使用与限制</a> · <a href="review/qa.json">几何清单核对</a> · <a href="review/references.json">参考来源</a></p><nav>'''+''.join(f'<a href="#{z}">{html.escape(t)}</a>' for z,t in titles.items())+'</nav>'+''.join(sections)+'''<footer>所有画面来自 Blender MCP 实际渲染，不是以概念图冒充模型结果。78 个构图单元不等于实测建筑数量；材质为已归档照片的程序化解释，未标定。三维源文件保留原四场景与新四场景。</footer></main></html>'''
(OUT/'index.html').write_text(page,encoding='utf-8')
for link in re.findall(r'(?:href|src)="([^"]+)"',page):
    if not link.startswith('#'):assert (OUT/link).is_file(),f'Broken comparison-page link: {link}'

files=[]
for p in sorted(OUT.rglob('*')):
    if not p.is_file() or p.suffix in ('.blend1','.blend2') or p.name=='files.json':continue
    assert p.stat().st_size<100*1024*1024,f'GitHub file limit exceeded: {p}'
    files.append(dict(path=p.relative_to(OUT).as_posix(),bytes=p.stat().st_size,sha256=digest(p)))
dump('files.json',dict(version='0.54.0',files=files,
                       preserved_v2_sha256=digest(ROOT/'assets/blender-models/v2/park-assemblies-v2.blend')))
expected=[OUT/'renders'/f'{z}-{view}.png' for z in titles for view in ('overview','detail','plan')]
assert all(p.is_file() for p in expected),'Final renders incomplete'
for p in expected:
    with p.open('rb') as stream:header=stream.read(24)
    assert header[:8]==b'\x89PNG\r\n\x1a\n' and struct.unpack('>II',header[16:24])==(1600,1000),f'Unexpected render dimensions: {p}'
assert all(not q['missing_units'] and not q['wrong_zone_objects'] and q['triangles']<=1500000 for q in qa['zones'].values())
assert digest(ROOT/'assets/blender-models/v2/park-assemblies-v2.blend')=='9191de5a0f90cf2709a957910372f0674637e54ac834e6c69582d2ec278e8c78'
print(json.dumps({'files':len(files),'render_count':len(expected),'zones':{z:q['triangles'] for z,q in qa['zones'].items()},
                  'bytes':sum(f['bytes'] for f in files),'old_v2_unchanged':True},ensure_ascii=False))

"""Verify and package artifacts produced by Blender MCP; no model operations."""
import hashlib
import itertools
import json
import math
import struct
import zipfile
from pathlib import Path

from lxml import html
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/blender-models/v2'
layout=json.loads((OUT/'assembly-layout.json').read_text(encoding='utf-8'))

def validate_glb(path,z):
    data=path.read_bytes()
    assert struct.unpack_from('<4sII',data)==(b'glTF',2,len(data))
    length,kind=struct.unpack_from('<II',data,12)
    assert kind==0x4E4F534A
    doc=json.loads(data[20:20+length])
    blen,bkind=struct.unpack_from('<II',data,20+length)
    assert bkind==0x004E4942 and 28+length+blen==len(data)
    assert doc['asset']['version']=='2.0'
    assert not any('uri' in x for x in doc.get('buffers',[])+doc.get('images',[]))
    for v in doc.get('bufferViews',[]):
        assert v.get('byteOffset',0)+v['byteLength']<=blen
    for a in doc['accessors']:
        assert all(math.isfinite(v) for key in ('min','max') for v in a.get(key,[]))
    nodes=doc['nodes']
    assert {n['extras']['zone_id'] for n in nodes if n.get('extras',{}).get('zone_id')}=={z}
    assert not any('PLANNING_REFERENCE' in n.get('name','') for n in nodes)
    names={n.get('name') for n in nodes}
    assert all(spec['id'] in names for spec in layout['zones'][z]['buildings'])
    pts=[]
    for n in nodes:
        if 'mesh' not in n:
            continue
        assert not n.get('children')
        for primitive in doc['meshes'][n['mesh']]['primitives']:
            a=doc['accessors'][primitive['attributes']['POSITION']]
            for p in itertools.product(*zip(a['min'],a['max'])):
                if 'matrix' in n:
                    m=n['matrix'];point=[sum(m[j*4+i]*p[j] for j in range(3))+m[12+i] for i in range(3)]
                else:
                    p=[p[i]*n.get('scale',[1,1,1])[i] for i in range(3)]
                    q=n.get('rotation',[0,0,0,1]);u=q[:3]
                    c=[u[1]*p[2]-u[2]*p[1],u[2]*p[0]-u[0]*p[2],u[0]*p[1]-u[1]*p[0]]
                    c2=[u[1]*c[2]-u[2]*c[1],u[2]*c[0]-u[0]*c[2],u[0]*c[1]-u[1]*c[0]]
                    point=[p[i]+2*(q[3]*c[i]+c2[i])+n.get('translation',[0,0,0])[i] for i in range(3)]
                pts.append(point)
    bounds={'min':[min(p[i] for p in pts) for i in range(3)],'max':[max(p[i] for p in pts) for i in range(3)]}
    w,d=layout['zones'][z]['extent']
    assert bounds['min'][0]>=-w/2-45 and bounds['max'][0]<=w/2+45,(z,bounds)
    assert bounds['min'][2]>=-d/2-150 and bounds['max'][2]<=d/2+150,(z,bounds)
    assert -15<bounds['min'][1] and bounds['max'][1]<150,(z,bounds)
    return {'nodes':len(nodes),'meshes':len(doc['meshes']),'materials':len(doc['materials']),
            'bounds_y_up_local_m':bounds,'all_layout_instances_present':True,
            'zone_isolated':True,'planning_reference_absent':True,'external_resources':False,
            'finite_accessors_and_buffer_ranges':True}


audit=[]
for p in sorted((ROOT/'storage/tooling/blender-mcp/audit-v2').glob('*.json')):
    r=json.loads(p.read_text(encoding='utf-8'))
    result=[c['text'] for c in r['result'].get('content',[]) if c['type']=='text']
    failed=bool(r['result'].get('isError') or r['result'].get('is_error') or any(t.startswith(('Error','Rejected')) for t in result))
    audit.append({'at':r['at'],'label':p.stem,'transport':r['transport'],'server':r['server'],
                  'tool':r['tool'],'package':r['package'],'status':'failed' if failed else 'success',
                  'user_prompt':r['arguments'].get('user_prompt'),
                  'code_sha256':hashlib.sha256(r['arguments'].get('code','').encode()).hexdigest(),
                  'result_text':result})
audit.sort(key=lambda r:r['at'])
assert any(a['label']=='v2-06-export-final' and a['status']=='success' for a in audit)
for z in layout['zones']:
    assert any(a['label']==f'v2-07-{z}-standalone' and a['status']=='success' for a in audit)
(OUT/'mcp-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

validation={z:validate_glb(OUT/f'models/{z}-complete-v2.glb',z) for z in layout['zones']}
validation['scope']={'building_groups':sum(len(z['buildings']) for z in layout['zones'].values()),'not_surveyed':True}
(OUT/'validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
assert len(list((OUT/'renders').glob('*.png')))==12
assert len(list((OUT/'greybox').glob('*.png')))==4
assert len(list((OUT/'models').glob('*.blend')))==4
manifest=[]
for p in sorted(OUT.rglob('*')):
    if not p.is_file() or p.suffix not in ('.blend','.glb','.png'):
        continue
    e={'file':p.relative_to(OUT).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    if p.suffix=='.png':
        with Image.open(p) as im:
            e['width'],e['height']=im.size;im.verify()
    elif p.suffix=='.blend':
        assert p.read_bytes().startswith(b'BLENDER'),p
    manifest.append(e)
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',27)
small=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',20)
for view,title in [('overview','四园区完整概念组装 v2 / Blender MCP / 统一暖灰白与蓝灰'),('detail','院区与场景局部 / 实际三维网格渲染')]:
    sheet=Image.new('RGB',(2000,1510),'#eeeee7');draw=ImageDraw.Draw(sheet)
    draw.text((24,14),title,font=font,fill='#344840')
    for i,z in enumerate(('GH','EI','IN','RD')):
        with Image.open(OUT/f'renders/{z}-{view}.png') as im:
            im=im.convert('RGB');im.thumbnail((960,650))
            x=25+(i%2)*990+(960-im.width)//2;y=70+(i//2)*710
            sheet.paste(im,(x,y))
        draw.text((25+(i%2)*990,y+655),layout['zones'][z]['name'],font=small,fill='#344840')
    sheet.save(OUT/f'00-{view}.jpg',quality=92)

sections=[]
for z,zone in layout['zones'].items():
    pictures=''.join(f'<figure><a href="renders/{z}-{view}.png"><img loading="lazy" src="renders/{z}-{view}.png" alt="{caption}"></a><figcaption>{caption}</figcaption></figure>'
                     for view,caption in [('overview','完整园区全景'),('detail','院区与建筑局部'),('plan','顶视总平面')])
    sections.append(f'''<section id="{z}"><h2>{zone['name']}</h2><p>{len(zone['buildings'])}组建筑单元 · {len(zone['roads'])}条道路路线 · 所有尺寸与摆放为概念推定</p>
    <p><a href="models/{z}-complete-v2.blend">独立Blender工程</a> · <a href="models/{z}-complete-v2.glb">完整GLB模型</a></p>
    <div class="pictures">{pictures}</div><details><summary>查看整园灰模</summary><img src="greybox/{z}-overview.png"></details></section>''')
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>四园区完整组装 v2</title>
<style>body{margin:0;background:#efeee8;color:#34443e;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1560px;margin:auto;padding:32px}h1{font-size:32px}nav{display:flex;gap:26px;flex-wrap:wrap}a{color:#315c6b}section,.intro{background:#faf9f3;padding:24px;margin:25px 0;border:1px solid #d0d6cb;border-radius:8px}img{display:block;max-width:100%;height:auto}figure{margin:12px 0}figcaption{color:#607064}.pictures{display:grid;grid-template-columns:1fr 1fr;gap:20px}.pictures figure:first-child{grid-column:1/-1}summary{cursor:pointer;padding:12px 0}details img{max-width:1000px}@media(max-width:800px){main{padding:16px}.pictures{grid-template-columns:1fr}}</style>
<main><h1>四园区完整概念组装 v2</h1><p>2026-10-22 · 实际Blender MCP组装、保存、渲染与导出</p>
<nav><a href="#GH">绿色家居</a><a href="#EI">电子信息</a><a href="#IN">科创部落</a><a href="#RD">科创研发</a></nav>
<div class="intro"><p>从代表单体扩展为四个整园场景：148组建筑单元、24个院区（含预留地）、主次道路、消防与院内通道、入口门卫、停车、林带、湖岸及周边环境。统一暖灰白、蓝灰玻璃、深灰基座。</p>
<p><a href="park-assemblies-v2.blend">四园区总工程</a> · <a href="assembly-greybox-v2.blend">完整灰模工程</a> · <a href="../../../docs/park-full-assembly-v2.md">制作说明与事实边界</a> · <a href="validation.json">模型验证</a> · <a href="manifest.json">文件校验</a> · <a href="mcp-audit.json">MCP记录</a></p>
<p>完整指场景与配套组织完整，仍为参考驱动的概念组装；不是全园区逐栋实测复原。科创院落为设计提案，七组规划线单独隐藏；未定位的智慧岛塔楼保留在上一轮独立资产中。</p></div>'''+''.join(sections)+'''<p>点击渲染查看原尺寸。每个独立工程只有自身Scene，可在Blender中自由旋转与放大；总工程通过Scene下拉切换四园区。</p></main></html>'''
(OUT/'index.html').write_text(page,encoding='utf-8')
(OUT/'README.md').write_text('''# 四园区完整概念组装 v2

打开index.html逐园查看全景、局部、顶视与灰模。park-assemblies-v2.blend包含四个园区Scene；models/包含四个各自只有一个Scene的独立.blend与四个完整.glb。所有模型均由真实Blender MCP完成。

148组建筑单元按已批准场景与资产方向组装，含院内交通、入口、停车、绿化与水岸。数量、尺度和位置为概念推定，未完成逐栋测绘及地理配准；科创院落为设计提案，不能把规划红线或实例摆放当作现状事实。

色调统一暖灰白主体、蓝灰玻璃、深灰基座，工业建筑少量灰红点缀。模型为米制，GLB使用Y向上。规划示意环线单独隐藏，不进入GLB。

assembly-layout.json保留全部实例和道路参数；manifest.json为原生模型与PNG校验；validation.json检查GLB结构、范围、独立分区和实例完整性；mcp-audit.json如实保留成功与失败调用。详情见项目docs/park-full-assembly-v2.md。
''',encoding='utf-8')
tree=html.fromstring(page)
links=[s.split('#')[0] for s in tree.xpath('//@href | //@src') if s and not s.startswith('#')]
assert all((OUT/s).exists() for s in links)

archive=ROOT/'storage/exports/四园区完整组装模型_v2.zip'
archive.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(OUT.rglob('*')):
        if p.is_file() and p.suffix not in ('.blend1','.blend2'):
            z.write(p,'四园区完整组装_v2/'+p.relative_to(ROOT).as_posix())
    source=[ROOT/'docs/park-full-assembly-v2.md',ROOT/'scripts/blender-mcp-client.py',
            ROOT/'scripts/prepare-park-assembly-v2.py',ROOT/'scripts/package-park-assembly-v2.py',
            *sorted((ROOT/'scripts/blender').glob('assembly-v2-*.py'))]
    for p in source:
        z.write(p,'四园区完整组装_v2/'+p.relative_to(ROOT).as_posix())
    z.writestr('四园区完整组装_v2/README.md','打开 assets/blender-models/v2/index.html 查看四园区完整模型；models/内的四个Blender工程可单独打开。')
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
print(json.dumps({'native_artifacts':len(manifest),'building_groups':148,'standalone_blends':4,'glbs':4,
                  'renders':16,'gallery_links':len(links),'archive_mb':round(archive.stat().st_size/1024/1024,2),
                  'audit_success':sum(a['status']=='success' for a in audit),'audit_failed':sum(a['status']=='failed' for a in audit)},ensure_ascii=False))

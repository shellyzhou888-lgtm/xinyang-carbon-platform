"""Package/verify Blender MCP outputs; never creates or modifies model geometry."""
import hashlib
import html
import json
import math
import itertools
import struct
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/blender-models/v1'
NAMES={'GH':'绿色家居','EI':'电子信息','IN':'科创部落','RD':'科创研发','RA':'智慧岛独立资产'}
ASSETS={'GH':'家居四跨厂房','EI':'电子制造车间','IN':'北湖院落设计提案','RA':'智慧岛主楼与裙房'}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_glb(path):
    raw=path.read_bytes()
    magic,version,length=struct.unpack_from('<4sII',raw,0)
    assert (magic,version,length)==(b'glTF',2,len(raw)),path
    json_length,kind=struct.unpack_from('<II',raw,12)
    assert kind==0x4E4F534A
    doc=json.loads(raw[20:20+json_length])
    assert doc['asset']['version']=='2.0'
    binary_offset=20+json_length
    binary_length,binary_kind=struct.unpack_from('<II',raw,binary_offset)
    assert binary_kind==0x004E4942
    assert binary_offset+8+binary_length==len(raw)
    for view in doc.get('bufferViews',[]):
        assert view.get('byteOffset',0)+view['byteLength']<=binary_length
    for accessor in doc.get('accessors',[]):
        assert all(math.isfinite(v) for key in ('min','max') for v in accessor.get(key,[]))
    assert doc.get('meshes') and doc.get('materials')
    expected_zone=path.name.split('-')[0]
    assert {n.get('extras',{}).get('zone_id') for n in doc['nodes'] if n.get('extras',{}).get('zone_id')}=={expected_zone}
    # Mesh objects have no parents. Verify the ACTUAL transformed bounds after
    # per-tile rebasing, not just the positions stored in the accessor.
    bounds=[]
    for node in doc['nodes']:
        if 'mesh' not in node:
            continue
        assert not node.get('children')
        for primitive in doc['meshes'][node['mesh']]['primitives']:
            accessor=doc['accessors'][primitive['attributes']['POSITION']]
            for point in itertools.product(*zip(accessor['min'],accessor['max'])):
                if 'matrix' in node:
                    matrix=node['matrix']
                    p=[sum(matrix[j*4+i]*point[j] for j in range(3))+matrix[12+i] for i in range(3)]
                else:
                    p=[point[i]*node.get('scale',[1,1,1])[i] for i in range(3)]
                    q=node.get('rotation',[0,0,0,1])
                    u=q[:3]
                    cross=[u[1]*p[2]-u[2]*p[1],u[2]*p[0]-u[0]*p[2],u[0]*p[1]-u[1]*p[0]]
                    cross2=[u[1]*cross[2]-u[2]*cross[1],u[2]*cross[0]-u[0]*cross[2],u[0]*cross[1]-u[1]*cross[0]]
                    p=[p[i]+2*(q[3]*cross[i]+cross2[i])+node.get('translation',[0,0,0])[i] for i in range(3)]
                bounds.append(p)
    extrema={'min':[min(p[i] for p in bounds) for i in range(3)],'max':[max(p[i] for p in bounds) for i in range(3)]}
    assert all(abs(v)<450 for values in extrema.values() for v in values), (path,extrema)
    colors=[m.get('pbrMetallicRoughness',{}).get('baseColorFactor') for m in doc['materials']]
    return {'meshes':len(doc['meshes']),'nodes':len(doc['nodes']),
            'materials':len(doc['materials']),'color_factors':colors,
            'header_buffer_bounds_finite_accessors_zone_isolation':'passed', 'local_y_up_bounds':extrema}


def contact(items,filename,title):
    font_path=Path('C:/Windows/Fonts/msyh.ttc')
    font=ImageFont.truetype(str(font_path),26)
    small=ImageFont.truetype(str(font_path),20)
    canvas=Image.new('RGB',(2000,1510),'#efeee8')
    draw=ImageDraw.Draw(canvas)
    draw.text((24,15),title,font=font,fill='#344840')
    for i,(path,label) in enumerate(items):
        with Image.open(path) as im:
            im=im.convert('RGB')
            im.thumbnail((960,650))
            x=25+(i%2)*990+(960-im.width)//2
            y=70+(i//2)*710
            canvas.paste(im,(x,y))
        draw.text((25+(i%2)*990,y+655),label,font=small,fill='#344840')
    canvas.save(OUT/filename,quality=92)


audit=[]
for path in sorted((ROOT/'storage/tooling/blender-mcp/audit').glob('*.json')):
    record=json.loads(path.read_text(encoding='utf-8'))
    if not record.get('arguments',{}).get('user_prompt'):
        continue
    texts=[c['text'] for c in record['result'].get('content',[]) if c['type']=='text']
    assert not any(t.startswith(('Error','Rejected')) for t in texts),path
    audit.append({k:record[k] for k in ('at','transport','server','package','tool')} | {
        'label':path.stem,'user_prompt':record['arguments']['user_prompt'],
        'code_sha256':hashlib.sha256(record['arguments']['code'].encode()).hexdigest(),
        'result_text':texts})
audit.sort(key=lambda record:record['at'])
(OUT/'mcp-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

manifest=[]
for path in sorted(OUT.rglob('*')):
    if not path.is_file() or path.suffix not in ('.blend','.glb','.png'):
        continue
    entry={'file':path.relative_to(OUT).as_posix(),'bytes':path.stat().st_size,'sha256':sha(path)}
    if path.suffix=='.png':
        with Image.open(path) as im:
            entry['width'],entry['height']=im.size
            im.verify()
    elif path.suffix=='.glb':
        entry['validation']=validate_glb(path)
    else:
        assert path.read_bytes().startswith(b'BLENDER'),path
    manifest.append(entry)
assert len([x for x in manifest if x['file'].endswith('.glb')])==5
assert len(list((OUT/'renders').glob('*.png')))==8
assert len(list((OUT/'greybox').glob('*.png')))==4
assert len(list((OUT/'orthographic').glob('*.png')))==20
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
contact([(OUT/f'renders/{z}-scene.png',NAMES[z]+' / 场景研究样区') for z in ('GH','EI','IN','RD')],
        '00-scenes-overview.jpg','四区首轮模型 v1 / Blender MCP / 统一暖灰白与蓝灰色调')
contact([(OUT/f'renders/{z}-asset.png',ASSETS[z]) for z in ('GH','EI','IN','RA')],
        '00-assets-overview.jpg','四类代表建筑 / 实际模型近景 / 尺寸待核')

def picture(file,label):
    return f'<a href="{file}"><img loading="lazy" src="{file}" alt="{html.escape(label)}"></a><p>{html.escape(label)}</p>'

sections=[]
for zone in ('GH','EI','IN','RD'):
    asset='RA' if zone=='RD' else zone
    orthos=''.join(picture(f'orthographic/{asset}-{side}.png',label) for side,label in
                   [('front','正面'),('back','背面'),('left','左侧'),('right','右侧'),('top','顶部')])
    sections.append(f'''<section id="{zone}"><h2>{NAMES[zone]}</h2>
    <div class="grid">{picture(f'renders/{zone}-scene.png','场景样区')}{picture(f'renders/{asset}-asset.png',ASSETS[asset])}</div>
    <p><a href="{zone}-v1.glb">下载{NAMES[zone]} GLB</a>{' · <a href="RA-v1.glb">下载智慧岛独立资产 GLB</a>（位置待核，未放入研发地块）' if zone=='RD' else ''}</p>
    <details><summary>查看同一模型的真实正交图：正／背／左／右／顶</summary><div class="grid">{orthos}</div></details>
    <details><summary>查看最初整体灰模</summary>{picture(f'greybox/{zone}-greybox.png','先全场景灰模，后结构细化')}</details></section>''')
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>四区 Blender 首轮模型 v1</title><style>
body{margin:0;background:#efeee8;color:#33423e;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1500px;margin:auto;padding:32px}h1{font-size:32px;line-height:1.3}h2{font-size:25px}a{color:#315d6b}nav{display:flex;flex-wrap:wrap;gap:25px;margin:20px 0}.note,section{background:#f9f8f3;padding:24px;border:1px solid #d2d6cc;margin:22px 0;border-radius:8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.grid>a{display:block}.grid>p{display:none}img{display:block;width:100%;height:auto}summary{cursor:pointer;padding:12px 0}details{margin:16px 0}code{background:#e0e3db;padding:3px 7px}@media(max-width:800px){.grid{grid-template-columns:1fr}main{padding:16px}}
</style><main><h1>四区 Blender 首轮模型 v1</h1><p>2026-10-22 · 用户已批准建模 · 实际 Blender MCP 制作与渲染</p>
<nav><a href="#GH">绿色家居</a><a href="#EI">电子信息</a><a href="#IN">科创部落</a><a href="#RD">科创研发</a></nav>
<div class="note">统一材质：暖灰白主体 <code>#DAD9D0</code>、蓝灰玻璃 <code>#58737C</code>、深灰基座 <code>#535D60</code>，少量灰红工业识别色。<br>
四区先完成整体灰模，检查后进行结构细化与材质处理。这里是场景研究样区及代表资产的首轮模型；尺度、背面及定位仍待核，植被为代理模型。<br>
<a href="park-unified-v1.blend">下载完整可编辑 Blender 工程</a> · <a href="park-greybox-v1.blend">整体灰模工程</a> · <a href="park-structural-v1.blend">结构细化工程</a> · <a href="../../../docs/park-blender-model-v1.md">制作说明与限制</a> · <a href="mcp-audit.json">MCP 返回记录</a> · <a href="manifest.json">文件校验清单</a>
</div>'''+''.join(sections)+'''<p>点击图像查看原尺寸。正交图均由同一套三维网格渲染，几何一致性不代表测绘真实性。</p></main></html>'''
(OUT/'index.html').write_text(page,encoding='utf-8')
(OUT/'README.md').write_text('''# 园区 Blender 首轮模型 v1

用户于2026-10-22批准开始建模并要求统一色调。打开index.html查看四区场景、代表建筑近景、20张真实正交视图及4张整体灰模。

park-unified-v1.blend为完整可编辑工程，ZONE_GH/EI/IN/RD为四个场景研究样区，ZONE_RA为未核实地块位置的智慧岛独立资产。工程默认显示GH，可在Blender顶部Scene下拉中切换五个命名分区场景；它们共享网格数据。park-greybox-v1.blend、park-structural-v1.blend为阶段检查点。

GH/EI/IN/RD-v1.glb为各区样区模型，RA-v1.glb为独立资产。每个GLB已移回自身局部原点、米制、glTF Y向上；未完成地理配准。全部场景操作、保存、渲染、导出经真实MCP服务工具execute_blender_code，证据见mcp-audit.json。

统一暖灰白主体、低饱和蓝灰玻璃、深灰基座，工业建筑少量灰红点缀。四类代表资产为参考驱动的首次建模；建筑/道路数量与尺度为推定，科创院落为设计提案，不是实测或全部园区逐栋复原。玻璃及植被等使用简化材质/代理几何，没有照片级纹理。详情见../../../docs/park-blender-model-v1.md。
''',encoding='utf-8')

archive=ROOT/'storage/exports/园区Blender首轮模型_v1_统一色调.zip'
archive.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for path in sorted(OUT.rglob('*')):
        if path.is_file() and path.suffix not in ('.blend1','.blend2'):
            z.write(path,'园区Blender首轮模型_v1/'+path.relative_to(ROOT).as_posix())
    z.write(ROOT/'docs/park-blender-model-v1.md','园区Blender首轮模型_v1/docs/park-blender-model-v1.md')
    for path in [ROOT/'scripts/blender-mcp-client.py',ROOT/'scripts/package-blender-model-v1.py',*sorted((ROOT/'scripts/blender').glob('*.py'))]:
        z.write(path,'园区Blender首轮模型_v1/'+path.relative_to(ROOT).as_posix())
    z.writestr('园区Blender首轮模型_v1/README.md','打开 assets/blender-models/v1/index.html 查看模型与渲染。制作说明见 docs/park-blender-model-v1.md。模型由真实 Blender MCP 制作，三阶段工程及五个GLB均在资料目录内。')
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
print(json.dumps({'files':len(manifest),'audit_calls':len(audit),'archive_mb':round(archive.stat().st_size/1024/1024,2),
                  'models':5,'rendered_pngs':32},ensure_ascii=False))

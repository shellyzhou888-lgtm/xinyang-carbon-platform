# Geometry/material library: supplied ONLY to Blender MCP execute_blender_code.
import bpy
import math
import json
import random
from mathutils import Vector

COLORS = {
    'plaster':'#D5DCD8','concrete':'#B6B8B3','zinc':'#9DA9AE','blue':'#3D719A',
    'glass':'#304E59','window':'#283A3D','red':'#B63930','steel':'#AAB3B6',
    'darksteel':'#50595B','tile':'#4D5150','terracotta':'#975844','wood':'#866342',
    'asphalt':'#40464A','concrete_yard':'#B3B0A4','line':'#E7E2CB','yellow':'#D4B454',
    'soil':'#A78656','grass':'#718346','drygrass':'#8B8953','bank':'#AE9A70',
    'water':'#355F6B','trunk':'#645448','leaf0':'#304B28','leaf1':'#45602B',
    'leaf2':'#5B7635','leaf3':'#788847','leaf4':'#3C6041','leaf5':'#6A7040',
    'whitecar':'#C8CECC','bluecar':'#345B78','redcar':'#823B32','grey':'#AEB3B2',
}

def linear(hexcode):
    c=[int(hexcode[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(x/12.92 if x<.04045 else ((x+.055)/1.055)**2.4 for x in c)

def material(key):
    name='V3 / '+key
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m=bpy.data.materials.new(name);m.use_nodes=True
    rgb=linear(COLORS[key]);m.diffuse_color=(*rgb,1)
    nodes=m.node_tree.nodes;links=m.node_tree.links;p=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value=(*rgb,1)
    p.inputs['Roughness'].default_value=.72
    if key in ('zinc','steel','blue','darksteel'):
        p.inputs['Metallic'].default_value=.45 if key!='blue' else .22
        p.inputs['Roughness'].default_value=.38
    if key in ('glass','window'):
        p.inputs['Metallic'].default_value=.30
        p.inputs['Roughness'].default_value=.20
    if key=='water':
        p.inputs['Metallic'].default_value=.24;p.inputs['Roughness'].default_value=.22
        p.inputs['IOR'].default_value=1.333
    if key in ('grass','soil','drygrass','bank','asphalt','concrete_yard','plaster','concrete','zinc','water'):
        coords=nodes.new('ShaderNodeTexCoord');noise=nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value=.035 if key in ('grass','soil','drygrass') else 1.7
        noise.inputs['Detail'].default_value=4
        links.new(coords.outputs['Object'],noise.inputs['Vector'])
        ramp=nodes.new('ShaderNodeValToRGB')
        lo=.60 if key in ('grass','soil','drygrass') else .84
        hi=1.36 if key in ('grass','soil','drygrass') else 1.12
        ramp.color_ramp.elements[0].color=(*(x*lo for x in rgb),1)
        ramp.color_ramp.elements[1].color=(*(min(1,x*hi) for x in rgb),1)
        links.new(noise.outputs['Fac'],ramp.inputs[0]);links.new(ramp.outputs['Color'],p.inputs['Base Color'])
        bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.24
        bump.inputs['Distance'].default_value=.07 if key!='water' else .19
        links.new(noise.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],p.inputs['Normal'])
    m['photo_palette_hex']=COLORS[key];m['color_status']='visual interpretation of archived photographs; not calibrated measurement'
    return m

def collection(zone,role):
    name='V3_'+zone+' / '+role
    c=bpy.data.collections.get(name)
    if c is None:
        c=bpy.data.collections.new(name);bpy.data.scenes['V3_'+zone].collection.children.link(c)
    return c

def activate(zone):
    s=bpy.data.scenes['V3_'+zone]
    (bpy.context.window or bpy.context.window_manager.windows[0]).scene=s
    return s

def Batch(name,zone,role):
    return dict(name=name,zone=zone,role=role,v=[],f=[],mi=[],keys=[],smooth=[])

def batch_add(batch,verts,faces,key,smooth=False):
    if key not in batch['keys']:batch['keys'].append(key)
    start=len(batch['v']);batch['v'].extend(verts)
    batch['f'].extend([tuple(start+i for i in f) for f in faces])
    batch['mi'].extend([batch['keys'].index(key)]*len(faces));batch['smooth'].extend([smooth]*len(faces))

def box(batch,x,y,z,w,d,h,key):
    batch_add(batch,[(x+sx*w/2,y+sy*d/2,z+sz*h/2) for sx,sy,sz in
              [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]],
             [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],key)

def tube(batch,a,b,r,key,n=8):
    a=Vector(a);b=Vector(b);delta=b-a
    if delta.length<.001:return
    axis=delta.normalized();u=axis.cross(Vector((0,0,1)))
    if u.length<.01:u=axis.cross(Vector((1,0,0)))
    u.normalize();v=axis.cross(u)
    vs=[tuple(p+r*(u*math.cos(i*math.tau/n)+v*math.sin(i*math.tau/n))) for p in (a,b) for i in range(n)]
    fs=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]+[tuple(reversed(range(n))),tuple(range(n,2*n))]
    batch_add(batch,vs,fs,key,True)

def ellipsoid(batch,x,y,z,rx,ry,rz,key,rng):
    n=8;rings=4;vs=[]
    phase=rng.random()*math.tau
    for j in range(rings):
        lat=-math.pi/2+(j+1)*math.pi/(rings+1)
        for i in range(n):
            a=i*math.tau/n+phase;f=rng.uniform(.82,1.18)
            vs.append((x+rx*math.cos(lat)*math.cos(a)*f,y+ry*math.cos(lat)*math.sin(a)*f,z+rz*math.sin(lat)*rng.uniform(.92,1.08)))
    vs.extend([(x,y,z-rz),(x,y,z+rz)])
    fs=[]
    for j in range(rings-1):
        for i in range(n):
            a=j*n+i;b=j*n+(i+1)%n
            fs.extend([(a,b,b+n),(a,b+n,a+n)])
    for i in range(n):fs.extend([(rings*n,(i+1)%n,i),(rings*n+1,(rings-1)*n+i,(rings-1)*n+(i+1)%n)])
    batch_add(batch,vs,fs,key,True)

def finish(batch):
    if not batch['v']:return None
    mesh=bpy.data.meshes.new(batch['name']);mesh.from_pydata(batch['v'],[],batch['f']);mesh.update()
    for k in batch['keys']:mesh.materials.append(material(k))
    for p,idx,sm in zip(mesh.polygons,batch['mi'],batch['smooth']):p.material_index=idx;p.use_smooth=sm
    obj=bpy.data.objects.new(batch['name'],mesh);collection(batch['zone'],batch['role']).objects.link(obj)
    obj['zone_id']=batch['zone'];obj['dimension_status']='unmeasured_reference_interpretation'
    return obj

def ribbon(batch,points,width,z,key):
    vs=[]
    for i,p in enumerate(points):
        a=Vector(points[max(0,i-1)]);b=Vector(points[min(len(points)-1,i+1)])
        t=(b-a).normalized();n=Vector((-t.y,t.x))*width/2
        vs.extend([(p[0]-n.x,p[1]-n.y,z),(p[0]+n.x,p[1]+n.y,z)])
    batch_add(batch,vs,[(i-2,i-1,i+1,i) for i in range(2,len(vs),2)],key)

def roof(batch,x,y,w,d,eave,bays,key,rise=2.2,axis='X'):
    # Roofs have different structural bay counts/lengths, not warped instances.
    if axis=='Y':w,d=d,w
    def point(xx,yy,zz):return (x+xx,y+yy,zz) if axis=='X' else (x+yy,y+xx,zz)
    for j in range(bays):
        a=-d/2+j*d/bays;b=a+d/bays;mid=(a+b)/2
        batch_add(batch,[point(-w/2,a,eave),point(w/2,a,eave),point(w/2,mid,eave+rise),
                   point(-w/2,mid,eave+rise),point(-w/2,b,eave),point(w/2,b,eave)],
                  [(0,1,2,3),(3,2,5,4),(0,3,4),(1,5,2)],key)
        for xx in range(int(-w/2),int(w/2),4):
            tube(batch,point(xx,a,eave+.07),point(xx,mid,eave+rise+.07),.07,'steel',4)
            tube(batch,point(xx,mid,eave+rise+.07),point(xx,b,eave+.07),.07,'steel',4)
        # Roof ridge ventilators and daylight strips provide a readable long-span rhythm.
        if key in ('zinc','blue'):
            for xx in range(int(-w/2+12),int(w/2-8),32):
                px,py,pz=point(xx,mid,eave+rise+.28)
                box(batch,px,py,pz,18 if axis=='X' else .9,.9 if axis=='X' else 18,.5,'steel')

def dist_segment(x,y,a,b):
    dx=b[0]-a[0];dy=b[1]-a[1];den=dx*dx+dy*dy
    if not den:return math.hypot(x-a[0],y-a[1])
    u=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/den))
    return math.hypot(x-a[0]-u*dx,y-a[1]-u*dy)

def shore_x(layout,y):
    p=layout.get('shoreline')
    if not p:return 1e9
    if y<=p[0][1]:return p[0][0]
    if y>=p[-1][1]:return p[-1][0]
    for a,b in zip(p,p[1:]):
        if a[1]<=y<=b[1]:return a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1])

def clear_land(x,y,layout,margin=4):
    for s in layout['buildings']:
        if abs(x-s['x'])<s['w']/2+margin and abs(y-s['y'])<s['d']/2+margin:return False
    for xx,yy,w,d in layout['yards']:
        if abs(x-xx)<w/2+margin and abs(y-yy)<d/2+margin:return False
    for r in layout['roads']:
        if any(dist_segment(x,y,a,b)<r['width']/2+margin for a,b in zip(r['points'],r['points'][1:])):return False
    for xx,yy,rx,ry in layout['ponds']:
        if ((x-xx)/(rx+margin))**2+((y-yy)/(ry+margin))**2<1:return False
    if layout['id']=='IN' and x>shore_x(layout,y)-margin:return False
    if layout.get('rail') and abs(x-layout['rail'][0][0])<18+margin:return False
    return True

def camera(zone,view,target,eye,lens=42,ortho=None):
    data=bpy.data.cameras.new('V3_'+zone+'_'+view);obj=bpy.data.objects.new(data.name,data)
    collection(zone,'90_CAMERA_LIGHT').objects.link(obj)
    obj.location=eye;obj.rotation_euler=(Vector(target)-Vector(eye)).to_track_quat('-Z','Y').to_euler()
    data.lens=lens;data.clip_start=10;data.clip_end=18000
    if ortho:data.type='ORTHO';data.ortho_scale=ortho
    return obj

def parts(s):
    x,y,w,d,h=[s[k] for k in ('x','y','w','d','h')];kind=s['kind']
    if kind=='campus':
        return [(x,y+d*.35,w,d*.30,h),(x-w*.38,y-d*.12,w*.24,d*.65,h*.78),
                (x+w*.38,y-d*.18,w*.24,d*.55,h*.60)]
    if kind=='courtyard':
        result=[(x,y+d*.33,w,d*.28,h),(x-w*.38,y-d*.1,w*.24,d*.6,h*.88)]
        if s['variant']=='U':result.append((x+w*.4,y-d*.05,w*.2,d*.55,h*1.15))
        if s['variant']=='paired':result.append((x+w*.2,y-d*.35,w*.55,d*.24,h*.7))
        return result
    if kind=='process':
        return [(x-w*.3,y-d*.24,w*.36,d*.4,h*.65),(x+w*.30,y+d*.1,w*.38,d*.75,h*1.2),
                (x-w*.27,y+d*.33,w*.4,d*.24,h*.8)]
    return [(x,y,w,d,h)]

def facade(batch,x,y,w,d,h,floors,skin='plaster',ground=.2):
    box(batch,x,y,ground+h/2,w,d,h,skin)
    box(batch,x,y,ground+.4,w+.12,d+.12,.8,'concrete')
    box(batch,x,y,ground+h+.15,w+.5,d+.5,.30,'concrete')
    for level in range(max(1,floors)):
        z=ground+(level+.55)*h/max(1,floors);wh=min(2.3,h/max(1,floors)*.54)
        for side in (-1,1):
            for i in range(max(1,int(w/5.6))):
                xx=x-w/2+2.8+i*5.6
                if xx<x+w/2-1.4:box(batch,xx,y+side*(d/2+.05),z,3.5,.12,wh,'window')
            for i in range(max(1,int(d/6))):
                yy=y-d/2+3+i*6
                if yy<y+d/2-1.4:box(batch,x+side*(w/2+.05),yy,z,.12,3.4,wh,'window')
    for sy in (-1,1):box(batch,x,y+sy*(d/2-.25),ground+h+.6,w,.5,1,'plaster')
    for sx in (-1,1):box(batch,x+sx*(w/2-.25),y,ground+h+.6,.5,d,1,'plaster')
    box(batch,x-w*.24,y+d*.22,ground+h+1.5,min(w*.22,12),min(d*.25,9),3,'concrete')
    for i in range(max(1,int(w/45))):box(batch,x+i*9,y,ground+h+.8,5,3,1.4,'steel')

def render(zone,view,gray=False,width=1600,height=1000):
    s=activate(zone);s.camera=bpy.data.objects['V3_'+zone+'_'+view]
    engine=s.render.engine
    restore_colors=[]
    if gray:
        s.render.engine='BLENDER_WORKBENCH'
        s.display.shading.light='STUDIO';s.display.shading.color_type='MATERIAL'
        for m in bpy.data.materials:
            if m.name.startswith('V3 / '):
                restore_colors.append((m,tuple(m.diffuse_color)))
                value={'grass':.32,'soil':.45,'drygrass':.40,'asphalt':.12,'concrete_yard':.55,'water':.21,'bank':.47}.get(m.name[5:],.75)
                m.diffuse_color=(value,value,value,1)
        s.display.shading.show_shadows=True;s.display.shading.show_cavity=True
        s.display.shading.cavity_type='BOTH'
    s.render.resolution_x=width;s.render.resolution_y=height;s.render.resolution_percentage=100
    s.render.filepath=OUT+('greybox/' if gray else 'renders/')+zone+'-'+view+'.png'
    bpy.ops.render.render(write_still=True,scene=s.name)
    s.view_layers[0].material_override=None
    for m,color in restore_colors:m.diffuse_color=color
    s.render.engine=engine
    return s.render.filepath

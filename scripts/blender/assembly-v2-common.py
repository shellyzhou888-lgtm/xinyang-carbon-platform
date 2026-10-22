# All mesh construction, instance assembly, cameras, save and export run in MCP.
import bpy
import math
import json
from mathutils import Matrix, Vector

NAMES={'GH':'GREEN HOME','EI':'ELECTRONICS','IN':'BEIHU COMMUNITY','RD':'RESEARCH DISTRICT'}
BOUNDS={}

def mat(key):
    material=bpy.data.materials.get('PARK / '+key)
    if material is None:
        colours={'line':'#DFDFD3','leaf2':'#71866D','wood':'#8E7860','trunk':'#736A5B'}
        h=colours[key].lstrip('#')
        rgb=[int(h[i:i+2],16)/255 for i in (0,2,4)]
        linear=[v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
        material=bpy.data.materials.new('PARK / '+key)
        material.diffuse_color=(*linear,1)
        material.use_nodes=True
        material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*linear,1)
        material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.72
        material['palette_hex']='#'+h
    material.use_fake_user=True
    return material

def activate(zone):
    scene=bpy.data.scenes['ASSEMBLY_'+zone]
    window=bpy.context.window or bpy.context.window_manager.windows[0]
    window.scene=scene
    return scene

def coll(zone,role):
    name=zone+' / '+role
    c=bpy.data.collections.get(name)
    if c is None:
        c=bpy.data.collections.new(name)
        bpy.data.scenes['ASSEMBLY_'+zone].collection.children.link(c)
    return c

def mesh(name,verts,faces,key,z,role):
    data=bpy.data.meshes.new(name)
    data.from_pydata(verts,[],faces)
    data.update()
    obj=bpy.data.objects.new(name,data)
    coll(z,role).objects.link(obj)
    data.materials.append(mat(key))
    obj['zone_id']=z
    obj['role']=role
    obj['placement_status']='concept_assembly_unmeasured'
    return obj

def boxes(name,specs,key,z,role):
    verts,faces=[],[]
    for x,y,cz,w,d,h in specs:
        k=len(verts)
        verts += [(x+sx*w/2,y+sy*d/2,cz+sz*h/2) for sx,sy,sz in
                  [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
        faces += [tuple(k+i for i in f) for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]]
    return mesh(name,verts,faces,key,z,role)

def box(name,x,y,cz,w,d,h,key,z,role):
    return boxes(name,[(x,y,cz,w,d,h)],key,z,role)

def polygon(name,points,height,key,z,role):
    return mesh(name,[(x,y,height) for x,y in points],[tuple(range(len(points)))],key,z,role)

def ribbon(name,points,width,height,key,z,role):
    vertices,faces=[],[]
    for i,p in enumerate(points):
        a=Vector(points[max(0,i-1)])
        b=Vector(points[min(len(points)-1,i+1)])
        direction=(b-a).normalized()
        normal=Vector((-direction.y,direction.x))*width/2
        vertices += [(p[0]+side*normal.x,p[1]+side*normal.y,height) for side in (1,-1)]
        if i:
            k=i*2
            faces.append((k-2,k-1,k+1,k))
    return mesh(name,vertices,faces,key,z,role)

def cam(name,zone,point,offset,scale=2000,perspective=False):
    data=bpy.data.cameras.new(name)
    obj=bpy.data.objects.new(name,data)
    coll(zone,'90_CAMERAS_LIGHTS').objects.link(obj)
    target=Vector(point)
    obj.location=target+Vector(offset)
    obj.rotation_euler=(target-obj.location).to_track_quat('-Z','Y').to_euler()
    data.type='PERSP' if perspective else 'ORTHO'
    data.lens=48
    data.ortho_scale=scale
    data.clip_end=50000
    return obj

def render(zone,view,gray=False,width=1600,height=1100):
    scene=activate(zone)
    scene.camera=bpy.data.objects[zone+'_CAM_'+view]
    scene.view_layers[0].material_override=mat('grey') if gray else None
    scene.render.resolution_x=width
    scene.render.resolution_y=height
    scene.render.resolution_percentage=100
    scene.cycles.samples=8 if gray else 12
    folder='greybox/' if gray else 'renders/'
    scene.render.filepath=OUT+folder+zone+'-'+view+'.png'
    bpy.ops.render.render(write_still=True,scene=scene.name)

def prototype(key):
    return bpy.data.meshes['ASM_ASSET_'+key]

def instance(spec,zone):
    data=prototype(spec['asset'])
    obj=bpy.data.objects.new(spec['id'],data)
    coll(zone,'30_BUILDING_ASSEMBLY').objects.link(obj)
    s=spec['scale']
    obj.matrix_world=(Matrix.Translation((spec['x'],spec['y'],.04))
                      @ Matrix.Rotation(math.radians(spec['rotation_deg']),4,'Z')
                      @ Matrix.Diagonal((s,s,s,1)))
    for key in ('asset','role','status'):
        obj[key]=spec[key]
    obj['zone_id']=zone
    obj['source_asset_truth']='building-concepts/v1; same-mesh orthographic checks in blender-models/v1'
    return obj

def label(name,body,x,y,size,z):
    data=bpy.data.curves.new(name,'FONT')
    data.body=body
    data.size=size
    data.extrude=.02
    data.materials.append(mat('base'))
    ob=bpy.data.objects.new(name,data)
    coll(z,'80_LABELS').objects.link(ob)
    ob.location=(x,y,.5)
    ob['zone_id']=z
    return ob

def green_batch(name,positions,zone):
    # Batch rounded proxy crowns in one mesh rather than thousands of objects.
    verts,faces=[],[]
    trunks=[]
    for index,(x,y,height) in enumerate(positions):
        start=len(verts)
        radius=height*.33
        for ring in range(4):
            latitude=-math.pi/2+(ring+1)*math.pi/5
            for k in range(8):
                angle=k*math.tau/8
                r=radius*math.cos(latitude)*(1+.08*math.sin(index+k*3))
                verts.append((x+r*math.cos(angle),y+r*math.sin(angle),height*.62+height*.39*math.sin(latitude)))
        verts += [(x,y,height*.23),(x,y,height*1.01)]
        for ring in range(3):
            for k in range(8):
                a=start+ring*8+k;b=start+ring*8+(k+1)%8
                faces.append((a,b,b+8,a+8))
        for k in range(8):
            faces.append((start+32,start+(k+1)%8,start+k))
            faces.append((start+33,start+24+k,start+24+(k+1)%8))
        trunks.append((x,y,height*.2,.8,.8,height*.4))
    obj=mesh(name,verts,faces,'leaf',zone,'50_LANDSCAPE')
    obj['tree_count']=len(positions)
    for face in obj.data.polygons:
        face.use_smooth=True
    boxes(name+'_trunks',trunks,'trunk',zone,'50_LANDSCAPE')
    return obj

def asset_bounds(key):
    data=prototype(key)
    return [[min(v.co[i] for v in data.vertices),max(v.co[i] for v in data.vertices)] for i in range(3)]

def clear_land(x,y,layout):
    w,d=layout['extent']
    if abs(x)>w/2-12 or abs(y)>d/2-12:
        return False
    for road in layout['roads']:
        for a,b in zip(road['points'],road['points'][1:]):
            dx=b[0]-a[0];dy=b[1]-a[1]
            u=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)))
            if (x-a[0]-u*dx)**2+(y-a[1]-u*dy)**2<(road['width']/2+3)**2:
                return False
    for spec in layout['buildings']:
        t=math.radians(-spec['rotation_deg']);s=spec['scale']
        dx=(x-spec['x'])/s;dy=(y-spec['y'])/s
        px=dx*math.cos(t)-dy*math.sin(t);py=dx*math.sin(t)+dy*math.cos(t)
        bounds=BOUNDS[spec['asset']]
        if bounds[0][0]-5<px<bounds[0][1]+5 and bounds[1][0]-5<py<bounds[1][1]+5:
            return False
    if layout['id']=='IN':
        for a,b in zip(layout['shoreline'],layout['shoreline'][1:]):
            if a[1]<=y<=b[1]:
                edge=a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1])
                if x>edge-10:
                    return False
    for pond in layout.get('ponds',[]):
        if ((x-pond['x'])/pond['rx'])**2+((y-pond['y'])/pond['ry'])**2<1.15:
            return False
    return True

def prune_macro_trees(zone,layout):
    name=zone+'_MACRO_WOODLAND'
    obj=bpy.data.objects[name]
    vertices=obj.data.vertices
    points=[(vertices[i+33].co.x,vertices[i+33].co.y,vertices[i+33].co.z/1.01) for i in range(0,len(vertices),34)]
    points=[p for p in points if clear_land(p[0],p[1],layout)]
    bpy.data.objects.remove(obj,do_unlink=True)
    bpy.data.objects.remove(bpy.data.objects[name+'_trunks'],do_unlink=True)
    green_batch(name,points,zone)

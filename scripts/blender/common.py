# Shared geometry helpers. This file is supplied as source to Blender MCP only.
import bpy
import math
import json
from mathutils import Vector

# The MCP client overrides OUT with this checkout's absolute delivery directory.
OUT = 'assets/blender-models/v1/'
ZONES = {'GH': (-480, -360), 'EI': (480, -360), 'IN': (-480, 360), 'RD': (480, 360), 'RA': (1600, 360)}
LABELS = {'GH': '01 / GREEN HOME', 'EI': '02 / ELECTRONICS', 'IN': '03 / BEIHU COURTYARD', 'RD': '04 / RESEARCH DISTRICT', 'RA': 'RESEARCH / ASSET STUDY'}
PALETTE = {
    'body': '#DAD9D0', 'roof': '#AEB7B7', 'glass': '#58737C', 'base': '#535D60',
    'accent': '#914F48', 'wood': '#8E7860', 'road': '#747C7C', 'paving': '#BDBCB2',
    'grass': '#87947C', 'leaf': '#5F755F', 'leaf2': '#71866D', 'trunk': '#736A5B',
    'water': '#6F9090', 'sand': '#B5AA90', 'line': '#DFDFD3', 'grey': '#B8BCBA',
    'backdrop': '#D4D4CB', 'dark': '#323F44',
}

def material(key):
    name = 'PARK / ' + key
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        h = PALETTE[key].lstrip('#')
        rgb = [int(h[i:i+2], 16)/255 for i in (0, 2, 4)]
        linear = [v/12.92 if v < 0.04045 else ((v+0.055)/1.055)**2.4 for v in rgb]
        m.diffuse_color = (*linear, 1)
        m.use_nodes = True
        p = m.node_tree.nodes.get('Principled BSDF')
        p.inputs['Base Color'].default_value = (*linear, 1)
        p.inputs['Roughness'].default_value = .32 if key == 'glass' else .72
        p.inputs['Metallic'].default_value = .28 if key in ('glass', 'roof') else 0
        m['palette_hex'] = PALETTE[key]
    return m

def collection(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c

def root(zone):
    return collection('ZONE_' + zone)

def mesh_object(name, verts, faces, key, zone, coll=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    (coll or root(zone)).objects.link(obj)
    obj.data.materials.append(material(key))
    obj['zone_id'] = zone
    obj['dimension_status'] = 'inferred_unmeasured'
    return obj

def cubes(name, boxes, key, zone, coll=None):
    vertices, faces = [], []
    ox, oy = ZONES[zone]
    for x, y, z, w, d, h in boxes:
        b = len(vertices)
        vertices += [(ox+x+sx*w/2, oy+y+sy*d/2, z+sz*h/2)
                     for sx, sy, sz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
        faces += [tuple(b+i for i in f) for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]]
    return mesh_object(name, vertices, faces, key, zone, coll)

def box(name, x, y, z, w, d, h, key, zone, coll=None):
    return cubes(name, [(x,y,z,w,d,h)], key, zone, coll)

def polygon(name, points, z, key, zone):
    ox, oy = ZONES[zone]
    return mesh_object(name, [(ox+x, oy+y, z) for x,y in points], [tuple(range(len(points)))], key, zone)

def path(name, points, width, z, key, zone):
    verts, faces = [], []
    ox, oy = ZONES[zone]
    for i,point in enumerate(points):
        a=Vector(points[max(0,i-1)])
        b=Vector(points[min(len(points)-1,i+1)])
        delta=b-a
        normal=Vector((-delta.y,delta.x)).normalized()*width/2
        p=Vector(point)
        verts += [(ox+q.x,oy+q.y,z) for q in (p+normal,p-normal)]
        if i:
            k=2*i
            faces.append((k-2,k-1,k+1,k))
    return mesh_object(name, verts, faces, key, zone)

def roof(name, x, y, w, d, eave, rise, bays, zone, coll=None):
    ox, oy = ZONES[zone]
    verts, faces = [], []
    # Parallel ridges run along X. One coherent span count in every camera.
    for j in range(bays):
        ya = y-d/2+j*d/bays
        yb = ya+d/bays
        k = len(verts)
        verts += [(ox+x-w/2,oy+ya,eave),(ox+x+w/2,oy+ya,eave),
                  (ox+x+w/2,oy+(ya+yb)/2,eave+rise),(ox+x-w/2,oy+(ya+yb)/2,eave+rise),
                  (ox+x-w/2,oy+yb,eave),(ox+x+w/2,oy+yb,eave)]
        faces += [(k,k+1,k+2,k+3),(k+3,k+2,k+5,k+4),(k,k+3,k+4),(k+1,k+5,k+2)]
    return mesh_object(name,verts,faces,'roof',zone,coll)

def camera(name, zone, target=(0,0,0), offset=(470,-650,510), scale=740, ortho=True):
    ox, oy = ZONES[zone]
    c = bpy.data.cameras.new(name)
    ob = bpy.data.objects.new(name,c)
    collection('PRESENTATION').objects.link(ob)
    look_at = Vector((ox+target[0],oy+target[1],target[2]))
    ob.location = look_at+Vector(offset)
    ob.rotation_euler = (look_at-ob.location).to_track_quat('-Z','Y').to_euler()
    c.type = 'ORTHO' if ortho else 'PERSP'
    c.ortho_scale = scale
    c.lens = 45
    c.clip_end = 10000
    return ob

def show_zone(zone):
    for key in ZONES:
        c = bpy.data.collections.get('ZONE_'+key)
        if c:
            c.hide_render = key != zone
            c.hide_viewport = key != zone

def render_view(cam, path_name, width=1600, height=1200):
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.filepath = OUT + path_name
    bpy.ops.render.render(write_still=True)

def plaque(zone, subtitle):
    ox, oy = ZONES[zone]
    for i, text in enumerate((LABELS[zone], subtitle)):
        data = bpy.data.curves.new('Label_'+zone+str(i),'FONT')
        data.body = text
        data.size = 8 if i == 0 else 3.6
        data.extrude = .01
        ob = bpy.data.objects.new(data.name,data)
        root(zone).objects.link(ob)
        ob.location = (ox-290,oy-257+i*(-12),1)
        data.materials.append(material('base'))
        ob['zone_id'] = zone

def trees(name, points, zone):
    # Shared low-poly proxy vegetation, deliberately separate from buildings.
    trunkboxes = []
    for i,(x,y,h) in enumerate(points):
        trunkboxes.append((x,y,h*.26,.7,.7,h*.52))
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1)
        ob = bpy.context.object
        ob.name = name+'_crown_'+str(i)
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        root(zone).objects.link(ob)
        ox,oy = ZONES[zone]
        ob.location = (ox+x,oy+y,h*.68)
        ob.scale = (h*.38,h*.34,h*.44)
        ob.data.materials.append(material('leaf' if i%3 else 'leaf2'))
        ob['zone_id'] = zone
        ob['representation'] = 'vegetation_proxy'
    cubes(name+'_trunks',trunkboxes,'trunk',zone)

def building_proxy(name,x,y,w,d,h,zone,kind):
    ob=box(name,x,y,h/2,w,d,h,'body',zone)
    ob['kind']=kind
    ob['local_x']=x
    ob['local_y']=y
    ob['width']=w
    ob['depth']=d
    ob['height']=h
    ob['source_ids']={'GH':'S04-04,M12,S36-10','EI':'S21-01,S21-05,M17,M19',
                     'IN':'S39-04,S34-05,M01-M04','RD':'M05-M07','RA':'S32-08'}[zone]
    ob['truth_status']='approved_concept_interpretation_not_survey'
    return ob

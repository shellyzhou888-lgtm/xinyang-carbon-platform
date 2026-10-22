# Source scenes can have stale matrix_world caches when their view layers are
# inactive. Rebuild prototypes from explicit object TRS, never that cached matrix.
sources={
 'GH_A':('GH_hero',(-633,-472,0)), 'GH_B':('GH_front_east',(-325,-475,0)),
 'GH_S':('GH_bg_01',(-710,-161,0)), 'GH_P':('GH_process',(-370,-324,0)),
 'EI_A':('EI_hero',(350,-468,0)), 'EI_M':('EI_m01',(309,-292,0)),
 'IN_A':('IN_hero',(-555,329,0)), 'IN_S':('IN_context_0',(-714,494,0)),
 'RD_A':('RD_m01',(429,410,0)), 'RD_B':('RD_bg01',(442,544,0)),
}
prior={key:asset_bounds(key) for key in sources}
bpy.ops.wm.open_mainfile(filepath=SOURCE)
snapshots={}
for key,(prefix,anchor) in sources.items():
    vertices,faces,indices,materials=[],[],[],[]
    for obj in [o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith(prefix)]:
        assert obj.parent is None
        transform=Matrix.Translation(obj.location)@obj.rotation_euler.to_matrix().to_4x4()@Matrix.Diagonal((*obj.scale,1))
        first=len(vertices)
        vertices += [tuple(transform@v.co-Vector(anchor)) for v in obj.data.vertices]
        for face in obj.data.polygons:
            faces.append(tuple(first+i for i in face.vertices))
            name=obj.data.materials[face.material_index].name
            if name not in materials:
                materials.append(name)
            indices.append(materials.index(name))
    snapshots[key]={'vertices':vertices,'faces':faces,'indices':indices,'materials':materials}
bpy.ops.wm.open_mainfile(filepath=OUT+'assembly-greybox-v2.blend')
for key,data in snapshots.items():
    old=bpy.data.meshes['ASM_ASSET_'+key]
    bpy.data.meshes.remove(old)
    m=bpy.data.meshes.new('ASM_ASSET_'+key)
    m.from_pydata(data['vertices'],[],data['faces'])
    for name in data['materials']:
        m.materials.append(bpy.data.materials[name])
    for f,index in zip(m.polygons,data['indices']):
        f.material_index=index
    m.update()
    m.use_fake_user=True
    m['normalization']='explicit source object TRS; normalized to local asset anchor'
for zone,layout in LAYOUT['zones'].items():
    activate(zone)
    for spec in layout['buildings']:
        old=bpy.data.objects['PROXY_'+spec['id']]
        bpy.data.objects.remove(old,do_unlink=True)
        bounds=asset_bounds(spec['asset']);s=spec['scale'];theta=math.radians(spec['rotation_deg'])
        cx=(bounds[0][0]+bounds[0][1])/2*s;cy=(bounds[1][0]+bounds[1][1])/2*s
        h=(bounds[2][1]-bounds[2][0])*s
        ob=box('PROXY_'+spec['id'],0,0,h/2,(bounds[0][1]-bounds[0][0])*s,
               (bounds[1][1]-bounds[1][0])*s,h,'body',zone,'25_MACRO_PROXIES')
        ob.location=(spec['x']+cx*math.cos(theta)-cy*math.sin(theta),spec['y']+cx*math.sin(theta)+cy*math.cos(theta),0)
        ob.rotation_euler.z=theta
    render(zone,'overview',gray=True,width=1000,height=750)
activate('GH')
bpy.ops.wm.save_as_mainfile(filepath=OUT+'assembly-greybox-v2.blend')
print(json.dumps({'before':prior,'corrected':{key:asset_bounds(key) for key in sources},'review':'source TRS normalization and all four macro layouts rerendered'}))

# Create the four COMPLETE park organisations first, before replacing proxies.
assert bpy.data.objects.get('GH_hero'), 'Open the v1 source in a separate MCP call before assembly.'
sources={
 'GH_A':('GH_hero',(-633,-472,0)), 'GH_B':('GH_front_east',(-325,-475,0)),
 'GH_S':('GH_bg_01',(-710,-161,0)), 'GH_P':('GH_process',(-370,-324,0)),
 'EI_A':('EI_hero',(350,-468,0)), 'EI_M':('EI_m01',(309,-292,0)),
 'IN_A':('IN_hero',(-555,329,0)), 'IN_S':('IN_context_0',(-714,494,0)),
 'RD_A':('RD_m01',(429,410,0)), 'RD_B':('RD_bg01',(442,544,0)),
}
for key,(prefix,anchor) in sources.items():
    parts=[o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith(prefix)]
    assert parts,key
    vertices,faces,indices,materials=[],[],[],[]
    for obj in parts:
        first=len(vertices)
        transform=Matrix.Translation(obj.location)@obj.rotation_euler.to_matrix().to_4x4()@Matrix.Diagonal((*obj.scale,1))
        vertices += [tuple(transform@v.co-Vector(anchor)) for v in obj.data.vertices]
        for face in obj.data.polygons:
            faces.append(tuple(first+i for i in face.vertices))
            material=obj.data.materials[face.material_index]
            if material not in materials:
                materials.append(material)
            indices.append(materials.index(material))
    data=bpy.data.meshes.new('ASM_ASSET_'+key)
    data.from_pydata(vertices,[],faces)
    for material in materials:
        data.materials.append(material)
    for face,index in zip(data.polygons,indices):
        face.material_index=index
    data.update()
    data.use_fake_user=True
    data['source_parts']=len(parts)
    data['source_prefix']=prefix
    data['normalization']='v1 world vertices transformed to source asset anchor; proportions retained'

for zone,layout in LAYOUT['zones'].items():
    scene=bpy.data.scenes.new('ASSEMBLY_'+zone)
    (bpy.context.window or bpy.context.window_manager.windows[0]).scene=scene
    scene.unit_settings.system='METRIC'
    scene.unit_settings.scale_length=1
    scene.render.engine='CYCLES'
    scene.cycles.samples=12
    scene.cycles.max_bounces=3
    scene.cycles.diffuse_bounces=2
    scene.cycles.glossy_bounces=2
    scene.cycles.use_denoising=True
    scene.render.image_settings.file_format='PNG'
    world=bpy.data.worlds.new(zone+'_WORLD')
    world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.65,.69,.72,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.7
    scene.world=world
    scene.view_settings.view_transform='AgX'
    scene.view_settings.look='AgX - Medium High Contrast'
    sun=bpy.data.lights.new(zone+'_DAYLIGHT','SUN')
    sun.energy=3
    sun.angle=math.radians(16)
    light=bpy.data.objects.new(sun.name,sun)
    coll(zone,'90_CAMERAS_LIGHTS').objects.link(light)
    light.rotation_euler=(math.radians(26),math.radians(-28),math.radians(-28))
    scene['scene_truth']=LAYOUT['scene_truth']
    scene['workflow_stage']='01_complete_park_greybox'
    scene['geography_status']=layout['placement_status']
    scene['planning_reference_origin_gcj02']=layout['display_origin_gcj02']
    scene['assembly_scope']='entire concept park organisation / not surveyed full building inventory'
    w,d=layout['extent']
    base=box(zone+'_BASE',0,-35,-5.8,w+80,d+220,10,'paving',zone,'00_TERRAIN')
    bevel=base.modifiers.new('Soft platform edge','BEVEL');bevel.width=12;bevel.segments=3
    box(zone+'_TERRAIN',0,0,-.25,w,d,.5,'grass',zone,'00_TERRAIN')
    for i,r in enumerate(layout['roads']):
        ribbon(r['id']+'_verge',r['points'],r['width']+9,.025+i*.00015,'paving',zone,'10_ROADS')
        ribbon(r['id'],r['points'],r['width'],.06+i*.00015,'paving' if r['role']=='pedestrian' else 'road',zone,'10_ROADS')
    if zone=='IN':
        shore=layout['shoreline']
        polygon('IN_LAKE',shore+[[w/2,d/2],[w/2,-d/2]],.09,'water',zone,'00_TERRAIN')
        ribbon('IN_BANK',shore,11,.10,'sand',zone,'00_TERRAIN')
    if zone=='RD':
        for i,p in enumerate(layout['ponds']):
            points=[(p['x']+p['rx']*math.cos(j*math.tau/28)*(1+.08*math.sin(j*3)),
                     p['y']+p['ry']*math.sin(j*math.tau/28)) for j in range(28)]
            polygon('RD_POND_'+str(i),points,.08,'water',zone,'00_TERRAIN')
    for parcel in layout['compounds']:
        role=parcel['role']
        box(parcel['id']+'_YARD',parcel['x'],parcel['y'],.12,parcel['w'],parcel['d'],.14,
            'sand' if role=='reserve' else 'paving',zone,'20_COMPOUNDS')
    for spec in layout['buildings']:
        bounds=asset_bounds(spec['asset'])
        s=spec['scale'];theta=math.radians(spec['rotation_deg'])
        cx=(bounds[0][0]+bounds[0][1])/2*s
        cy=(bounds[1][0]+bounds[1][1])/2*s
        px=spec['x']+cx*math.cos(theta)-cy*math.sin(theta)
        py=spec['y']+cx*math.sin(theta)+cy*math.cos(theta)
        h=(bounds[2][1]-bounds[2][0])*s
        ob=box('PROXY_'+spec['id'],0,0,h/2,(bounds[0][1]-bounds[0][0])*s,
               (bounds[1][1]-bounds[1][0])*s,h,'body',zone,'25_MACRO_PROXIES')
        ob.location=(px,py,0)
        ob.rotation_euler.z=theta
        ob['asset_key']=spec['asset']
        ob['assembly_unit']=spec['id']
    # Planning overlay is separate, hidden by default and excluded from delivery GLB.
    for i,ring in enumerate(layout['planning_rings_local_m']):
        obj=ribbon(zone+'_PLANNING_REFERENCE_'+str(i+1),ring,5,.4,'accent',zone,'95_PLANNING_REFERENCE_OFF')
        obj['status']='approximate planning overlay only; potential hundreds-of-metres shift'
        obj['planning_area_km2']=layout['planning_area_km2']
    ref=coll(zone,'95_PLANNING_REFERENCE_OFF');ref.hide_render=True;ref.hide_viewport=True
    scale=(.80*w+.60*(d+220))*1.12
    cam(zone+'_CAM_overview',zone,(0,0,25),(w*.8,-d, max(w,d)*.85),scale)
    cam(zone+'_CAM_plan',zone,(0,0,0),(0,0,8000),max(w,d*1.5)*1.1)
    focus={'GH':(-800,-1040,15),'EI':(-400,-1650,15),'IN':(-210,-300,6),'RD':(30,450,20)}[zone]
    close_scale={'GH':1750,'EI':1650,'IN':1050,'RD':1600}[zone]
    cam(zone+'_CAM_detail',zone,focus,(close_scale*.65,-close_scale*.9,close_scale*.65),close_scale)
    label(zone+'_TITLE',NAMES[zone]+' / COMPLETE CONCEPT ASSEMBLY',-w/2+45,-d/2-75,24,zone)
    label(zone+'_NOTE','LOCAL METRES / CONCEPT PLACEMENTS / DIMENSIONS TO VERIFY',-w/2+45,-d/2-120,13,zone)
    scene.camera=bpy.data.objects[zone+'_CAM_overview']
    scene.view_layers[0].material_override=mat('grey')

# Drop old scenes/objects from THIS new project; v1 .blend on disk stays intact.
activate('GH')
for scene in list(bpy.data.scenes):
    if not scene.name.startswith('ASSEMBLY_'):
        bpy.data.scenes.remove(scene)
for c in list(bpy.data.collections):
    if not any(c.name.startswith(z+' / ') for z in NAMES):
        bpy.data.collections.remove(c)
bpy.ops.outliner.orphans_purge(do_local_ids=True,do_linked_ids=False,do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT+'assembly-greybox-v2.blend')
print(json.dumps({'stage':'all_four_complete_park_greyboxes','building_groups':{z:len(l['buildings']) for z,l in LAYOUT['zones'].items()},
                  'scenes':[s.name for s in bpy.data.scenes],'asset_prototypes':list(sources),'objects':len(bpy.data.objects)},ensure_ascii=False))

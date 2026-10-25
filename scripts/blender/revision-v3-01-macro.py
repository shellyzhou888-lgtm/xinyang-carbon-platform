# All four compositions before detailing. Keep v2 scenes and its file intact.
for zone,layout in LAYOUT['zones'].items():
    scene=bpy.data.scenes.get('V3_'+zone)
    if scene is not None:assert not len(scene.objects),'Existing populated V3 scene; inspect before rerunning.'
    else:scene=bpy.data.scenes.new('V3_'+zone)
    activate(zone)
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    scene.render.engine='BLENDER_EEVEE_NEXT'
    scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.cycles.max_bounces=5
    scene.cycles.diffuse_bounces=3;scene.cycles.glossy_bounces=3
    scene.render.image_settings.file_format='PNG'
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
    scene.render.film_transparent=False
    world=bpy.data.worlds.new('V3_'+zone+'_DAYLIGHT');world.use_nodes=True
    sky=world.node_tree.nodes.new('ShaderNodeTexSky');sky.sky_type='NISHITA'
    sky.sun_elevation=math.radians(42);sky.sun_rotation=math.radians(135);sky.sun_disc=False
    sky.altitude=.15;sky.air_density=1.1;sky.dust_density=1.1
    background=next(n for n in world.node_tree.nodes if n.type=='BACKGROUND')
    world.node_tree.links.new(sky.outputs['Color'],background.inputs[0])
    background.inputs[1].default_value=.28;scene.world=world
    sun=bpy.data.lights.new('V3_'+zone+'_SUN','SUN');sun.energy=3.2;sun.angle=math.radians(3)
    light=bpy.data.objects.new(sun.name,sun);collection(zone,'90_CAMERA_LIGHT').objects.link(light)
    light.rotation_euler=(math.radians(28),math.radians(-28),math.radians(-35))
    ground=Batch('V3_'+zone+'_LAND',zone,'00_GROUND')
    box(ground,0,900,-.6,7500,8500,1.2,'grass');finish(ground)
    surface=Batch('V3_'+zone+'_SURFACES',zone,'01_SURFACES')
    for i,(x,y,w,d) in enumerate(layout['yards']):box(surface,x,y,.07,w,d,.12,'concrete_yard')
    for x,y,w,d in layout['reserves']:
        box(surface,x,y,.04,w,d,.06,'soil' if zone!='IN' else 'drygrass')
    for i,r in enumerate(layout['roads']):
        ribbon(surface,r['points'],r['width']+3.5,.14+i*.0001,'concrete_yard')
        ribbon(surface,r['points'],r['width'],.18+i*.0001,'concrete_yard' if r['role']=='pedestrian' else 'asphalt')
    if zone=='IN':
        shore=layout['shoreline'];p=[(shore[0][0],-3400)]+shore+[(shore[-1][0],5000),(3600,5000),(3600,-3400)]
        batch_add(surface,[(x,y,.1) for x,y in p],[tuple(range(len(p)))],'water')
        ribbon(surface,shore,10,.19,'bank')
    for i,(x,y,rx,ry) in enumerate(layout['ponds']):
        p=[(x+rx*math.cos(j*math.tau/60)*(1+.10*math.sin(j*.7)),
            y+ry*math.sin(j*math.tau/60)*(1+.08*math.cos(j*.6)),.15) for j in range(60)]
        batch_add(surface,p,[tuple(range(60))],'water')
    finish(surface)
    for spec in layout['buildings']:
        b=Batch('V3_MACRO_'+spec['id'],zone,'10_MACRO')
        for x,y,w,d,h in parts(spec):box(b,x,y,h/2+.18,w,d,h,'grey')
        if spec['kind']=='process':
            for i in range(4):tube(b,(spec['x']-40+i*18,spec['y'],0),(spec['x']-40+i*18,spec['y'],30+i%2*5),5,'grey',10)
        obj=finish(b);obj['source_id']=spec['id']
    forest=Batch('V3_'+zone+'_MACRO_CANOPY',zone,'11_MACRO_CANOPY');rng=random.Random(723+ord(zone[0]))
    for i in range(125):
        x=rng.uniform(-1100,1100);y=rng.uniform(-850,1650)
        if clear_land(x,y,layout,35):ellipsoid(forest,x,y,7,rng.uniform(18,40),rng.uniform(16,35),8,'grey',rng)
    finish(forest)
    camera(zone,'overview',layout['target'],layout['eye'],lens=42)
    camera(zone,'plan',(0,150,0),(0,150,4000),ortho=max(layout['extent'])*1.15)
    first=next(s for s in layout['buildings'] if not s.get('context'))
    factor=1.25 if zone!='IN' else 2.3
    reach=max(first['w'],first['d'])*factor
    camera(zone,'detail',(first['x'],first['y'],first['h']*.4),
           (first['x']+reach*.75,first['y']-reach*1.1,first['h']+reach*.7),lens=44)
    scene.camera=bpy.data.objects['V3_'+zone+'_overview']
    scene['stage']='all-zone macro composition before structural refinement'
    scene['scene_truth']=LAYOUT['scene_truth'];scene['references']=','.join(layout['references'])
    scene['geometry_status']='reference-driven concept revision, not surveyed'
activate('GH')
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-reference-v3-greybox.blend',compress=True)
print(json.dumps({'stage':'macro_complete','scenes':['V3_'+z for z in LAYOUT['zones']],
                  'buildings':{z:len(d['buildings']) for z,d in LAYOUT['zones'].items()},
                  'render_engine':bpy.context.scene.render.engine,'saved':bpy.data.filepath}))

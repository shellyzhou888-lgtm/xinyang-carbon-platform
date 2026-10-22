# Pass 1: ALL four zones, roads, foreground/middleground/background and assets.
for name in ('Cube','Camera','Light'):
    ob=bpy.data.objects.get(name)
    if ob:
        bpy.data.objects.remove(ob,do_unlink=True)
scene=bpy.context.scene
scene.name='PARK / FOUR ZONES / V1'
scene.unit_settings.system='METRIC'
scene.unit_settings.scale_length=1
scene['approval']='2026-10-22 用户：我觉得可以，你可以开始建模，色调需要统一'
scene['coordinates']='concept study tiles in local metres; NOT georeferenced / NOT surveyed'
scene['workflow_stage']='01_all_zones_greybox'
scene.render.engine='CYCLES'
scene.cycles.samples=20
scene.cycles.use_denoising=True
scene.render.image_settings.file_format='PNG'
scene.world.color=(.4,.4,.4)
scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.65,.69,.72,1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.7
scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast'
sun_data=bpy.data.lights.new('Daylight / all zones','SUN')
sun_data.energy=3.0
sun_data.angle=math.radians(22)
sun=bpy.data.objects.new('Daylight / all zones',sun_data)
collection('PRESENTATION').objects.link(sun)
sun.rotation_euler=(math.radians(25),math.radians(-28),math.radians(-30))
for z in ('GH','EI','IN','RD'):
    base=box(z+'_study_base',0,-6,-4.6,640,550,8,'paving',z)
    bevel=base.modifiers.new('Soft study base edges','BEVEL')
    bevel.width=5
    bevel.segments=3
    box(z+'_terrain',0,0,-.25,620,460,.5,'grass',z)
    plaque(z,'CONCEPT MODEL / LOCAL METRES / DIMENSIONS TO VERIFY')
    camera('CAM_'+z,z,target=(0,-6,4),scale=900)
    root(z)['scene_truth']='assets/modeling-concepts/v2/'+{'GH':'01-green-home','EI':'02-electronics','IN':'03-innovation-community','RD':'04-research'}[z]+'.png'

# Green home: independent factory compounds on both sides of a broad road.
for x,y,w,d in [(0,0,620,24),(5,0,24,460)]:
    box('GH_primary_road',x,y,.05,w,d,.1,'road','GH')
for name,x,y,w,d,h in [('GH_hero',-153,-112,220,80,12),('GH_front_east',155,-115,210,94,13),
                       ('GH_mid_west',-152,105,220,95,12),('GH_mid_east',157,99,194,83,12),
                       ('GH_bg_01',-230,199,95,34,8),('GH_bg_02',-102,199,92,32,9),
                       ('GH_bg_03',86,199,72,28,10),('GH_bg_04',204,198,81,34,8)]:
    box(name+'_apron',x,y,.15,w+18,d+28,.25,'paving','GH')
    building_proxy(name,x,y,w,d,h,'GH','workshop')
building_proxy('GH_process_hall',110,36,48,22,15,'GH','process')
for x,y,h in [(76,35,29),(95,42,34),(120,34,27)]:
    building_proxy('GH_process_tower',x,y,7,7,h,'GH','process_tower')

# Electronics: paired foreground halls, separate multi-wing blocks farther north.
for x,y,w,d in [(-268,0,24,460),(270,0,22,460),(0,-12,620,20),(0,141,620,18)]:
    box('EI_road',x,y,.05,w,d,.1,'road','EI')
for name,x,y,w,d,h in [('EI_hero',-130,-108,178,122,11),('EI_pair',109,-108,170,122,11),
                       ('EI_m01',-171,68,65,51,21),('EI_m02',-58,66,70,48,18),
                       ('EI_m03',96,70,90,51,20),('EI_bg01',-156,194,152,57,10),
                       ('EI_bg02',76,196,172,55,11)]:
    box(name+'_apron',x,y,.15,w+18,d+18,.25,'paving','EI')
    building_proxy(name,x,y,w,d,h,'EI','electronic_hall' if h<15 else 'multiwing')

# Beihu: lake surface and irregular shoreline first; sparse settlement on land.
shore=[(35,-230),(65,-195),(52,-156),(108,-122),(124,-77),(100,-30),(135,11),(155,63),(141,105),(191,151),(198,230)]
polygon('IN_lake',shore+[(310,230),(310,-230)],.06,'water','IN')
path('IN_shoreline',shore,7,.09,'sand','IN')
path('IN_rural_road',[(-264,-230),(-218,-145),(-226,-79),(-171,-11),(-183,59),(-145,116),(-167,230)],7,.13,'road','IN')
path('IN_branch',[(-225,-79),(-111,-77),(-45,-30),(75,-40)],4,.14,'paving','IN')
building_proxy('IN_hero',-75,-31,48,16,7.4,'IN','courtyard')
for i,(x,y,w,d,h) in enumerate([(-234,134,25,13,6),(-200,159,24,13,6),(-105,181,22,12,5),(-241,39,28,14,6),(-45,143,25,14,6)]):
    building_proxy('IN_context_'+str(i),x,y,w,d,h,'IN','village_context')
box('IN_hero_terrace',-65,-53,.3,76,68,.6,'paving','IN')

# Research: partially developed blocks, large open foreground, right arterial.
for x,y,w,d in [(260,0,30,460),(-114,0,18,460),(70,-50,360,18),(80,129,340,18)]:
    box('RD_road',x,y,.05,w,d,.1,'road','RD')
for name,x,y,w,d,h in [('RD_m01',-51,50,62,42,22),('RD_m02',61,58,64,38,18),
                       ('RD_m03',171,67,56,51,20),('RD_bg01',-38,184,75,44,24),
                       ('RD_bg02',123,189,90,46,15),('RD_west',-237,130,60,40,16)]:
    box(name+'_apron',x,y,.14,w+16,d+18,.22,'paving','RD')
    building_proxy(name,x,y,w,d,h,'RD','research_block')
polygon('RD_pond',[(-242,-204),(-190,-218),(-133,-193),(-128,-156),(-176,-141),(-228,-159)],.08,'water','RD')
polygon('RD_bare_plot',[(-83,-198),(190,-198),(207,-79),(-80,-82)],.06,'sand','RD')
path('RD_unpaved_access',[(-105,-191),(-39,-164),(59,-173),(159,-113)],5,.09,'paving','RD')

# Separate research asset study: NO claim of its location inside the RD scene.
box('RA_study_base',0,0,-2,160,136,4,'paving','RA')
building_proxy('RA_podium',0,0,68,44,14,'RA','podium')
building_proxy('RA_tower',10,5,31,29,68,'RA','tower')
building_proxy('RA_left_wing',-44,4,28,34,11,'RA','wing')
camera('CAM_RA','RA',target=(-5,0,28),offset=(135,-195,135),scale=169)
root('RA')['location_status']='unverified: separate asset study; not inserted into research parcel'

# Coarse foreground / middle / distance vegetation masses in ALL four scenes.
for z in ('GH','EI','RD'):
    points=[]
    for i in range(24):
        points.append((-291+i*25,-210,7+(i%4)))
        points.append((-290+i*25,225,8+(i%3)))
    for i in range(16):
        points.append((-299,-187+i*25,8+(i%2)))
        points.append((301,-187+i*25,8+(i%3)))
    trees(z+'_edge_trees',points,z)
trees('IN_woodland',[(-290+(i%10)*28,75+(i//10)*25,11+(i%5)) for i in range(60)]
      +[(-150+(i%7)*27,-183+(i//7)*28,9+(i%4)) for i in range(28)],'IN')
scene.view_layers[0].material_override=material('grey')
show_zone('GH')
scene.camera=bpy.data.objects['CAM_GH']
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-greybox-v1.blend')
print(json.dumps({'stage':'all_zones_greybox','objects':len(bpy.data.objects),
                  'zones':[z for z in ZONES], 'saved':bpy.data.filepath},ensure_ascii=False))

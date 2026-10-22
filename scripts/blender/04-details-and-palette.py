# Pass 3: one shared palette; building details follow the approved asset studies.
scene=bpy.context.scene
scene['workflow_stage']='04_details_and_unified_palette'
scene.view_layers[0].material_override=None
scene.cycles.samples=32
# Tiny vertical separation at road crossings prevents coincident surfaces.
for zone in ('GH','EI','RD'):
    roads=[o for o in root(zone).objects if o.name.startswith(zone+'_road') or o.name.startswith(zone+'_primary_road')]
    for i,o in enumerate(roads):
        o.location.z=.003*i
for name in ('IN_shoreline','IN_rural_road','IN_branch','RD_unpaved_access'):
    bpy.data.objects.remove(bpy.data.objects[name],do_unlink=True)
path('IN_shoreline',[(35,-230),(65,-195),(52,-156),(108,-122),(124,-77),(100,-30),(135,11),(155,63),(141,105),(191,151),(198,230)],7,.09,'sand','IN')
path('IN_rural_road',[(-264,-230),(-218,-145),(-226,-79),(-171,-11),(-183,59),(-145,116),(-167,230)],7,.13,'road','IN')
path('IN_branch',[(-225,-79),(-111,-77),(-45,-30),(75,-40)],4,.14,'paving','IN')
path('RD_unpaved_access',[(-105,-191),(-39,-164),(59,-173),(159,-113)],5,.09,'paving','RD')

def windows(name,x,y,w,d,h,rows,cols,zone):
    glazing,frames=[],[]
    for j in range(rows):
        z=2.3+j*3.2
        if z+1>h:
            continue
        for i in range(cols):
            px=x-w/2+(i+.5)*w/cols
            ww=w/cols*.68
            glazing += [(px,y-d/2-.05,z,ww,.16,1.65),(px,y+d/2+.05,z,ww,.16,1.65)]
            frames += [(px,y-d/2-.16,z,.08,.1,1.8),(px,y+d/2+.16,z,.08,.1,1.8)]
    side_cols=max(2,int(d/8))
    for j in range(rows):
        z=2.3+j*3.2
        if z+1>h:
            continue
        for i in range(side_cols):
            py=y-d/2+(i+.5)*d/side_cols
            glazing += [(x-w/2-.05,py,z,.16,d/side_cols*.62,1.65),(x+w/2+.05,py,z,.16,d/side_cols*.62,1.65)]
    if glazing:
        cubes(name+'_glazing',glazing,'glass',zone)
        cubes(name+'_mullions',frames,'body',zone)

def hvac(name,x,y,z,count,zone):
    cubes(name+'_HVAC',[(x+i*2.4,y,z+.65,1.7,1.3,1.3) for i in range(count)],'roof',zone)
    cubes(name+'_vent_faces',[(x+i*2.4,y-.67,z+.65,1.3,.08,.8) for i in range(count)],'base',zone)

def tree_row(zone,x0,y0,dx,dy,count):
    trees(zone+'_street_trees',[(x0+dx*i,y0+dy*i,7+(i%3)) for i in range(count)],zone)

for ob in [o for o in bpy.data.objects if 'kind' in o]:
    zone,kind=ob['zone_id'],ob['kind']
    x,y,w,d,h=[ob[k] for k in ('local_x','local_y','width','depth','height')]
    name=ob.name
    if kind in ('workshop','electronic_hall'):
        # Long metal facade: regular sheet joints rather than a featureless box.
        ribs=[]
        for i in range(int(w/2)):
            xx=x-w/2+i*2
            ribs += [(xx,y-d/2-.11,h*.57,.07,.16,h*.80),(xx,y+d/2+.11,h*.57,.07,.16,h*.80)]
        cubes(name+'_sheet_joints',ribs,'roof',zone)
        cols=4 if kind=='workshop' else 6
        doors=[]
        for i in range(cols):
            xx=x-w*.32+i*w*.64/(cols-1)
            if kind=='workshop':
                doors.append((xx,y-d/2-.25,3,6.0,.3,6))
                box(name+'_door_hood',xx,y-d/2-2,6.35,7.4,4,.3,'roof',zone)
                cubes(name+'_bollards',[(xx-3.7,y-d/2-2,.6,.28,.28,1.2),(xx+3.7,y-d/2-2,.6,.28,.28,1.2)],'accent',zone)
            else:
                doors.append((xx,y-d/2-.2,2.2,3.8,.25,4.4))
        cubes(name+'_loading_doors',doors,'accent' if kind=='workshop' else 'base',zone)
        if kind=='electronic_hall':
            box(name+'_continuous_canopy',x,y-d/2-3.2,4.9,w*.97,6.8,.30,'roof',zone)
            box(name+'_red_canopy_edge',x,y-d/2-6.7,4.85,w*.97,.25,.38,'accent',zone)
            cubes(name+'_canopy_posts',[(x-w*.45+i*w*.9/7,y-d/2-6.25,2.4,.22,.22,4.8) for i in range(8)],'base',zone)
            box(name+'_recessed_entry',x-w*.15,y-d/2-.45,2.25,9,.5,4.5,'glass',zone)
            cubes(name+'_entry_steps',[(x-w*.15,y-d/2-6.5-j*.75,.15*(3-j),13,.75,.3*(3-j)) for j in range(3)],'paving',zone)
        windows(name+'_office',x-w/2+17,y-d/2-9,32,19,9.2,2,5,zone)
        hvac(name,x-w/2+5,y-d/2-8,9.7,4,zone)
        hvac(name+'_service',x+w/2-25,y+d/2+7,5.9,4,zone)
        # Clerestory ribbon, downpipes, one unambiguous roof span count.
        window_boxes=[]
        for i in range(12):
            xx=x-w*.46+i*w*.92/11
            window_boxes += [(xx,y-d/2-.15,3.8,w/12*.65,.2,1.35),(xx,y+d/2+.15,3.8,w/12*.65,.2,1.35)]
        cubes(name+'_strip_windows',window_boxes,'glass',zone)
        cubes(name+'_downpipes',[(x-w/2+2+i*w/5,y-d/2-.35,h*.49,.18,.2,h*.98) for i in range(6)],'base',zone)
        count=ob['roof_bays']
        seam_vertices,seam_faces=[],[]
        ox,oy=ZONES[zone]
        for j in range(count):
            yy=y-d/2+(j+.5)*d/count
            if kind=='workshop':
                box(name+'_skylight',x,yy,h+1.78,w*.84,1.5,.12,'glass',zone)
            for i in range(int(w/3)):
                xx=x-w/2+i*3
                # Lines follow the two roof slopes as thin rectangular planes.
                for side in (-1,1):
                    rise=1.7 if kind=='workshop' else 1.0
                    k=len(seam_vertices)
                    seam_vertices += [(ox+xx-.03,oy+yy,h+rise+.035),(ox+xx+.03,oy+yy,h+rise+.035),
                                      (ox+xx+.03,oy+yy+side*d/count/2,h+.035),(ox+xx-.03,oy+yy+side*d/count/2,h+.035)]
                    seam_faces.append((k,k+1,k+2,k+3) if side<0 else (k+3,k+2,k+1,k))
        mesh_object(name+'_roof_seams',seam_vertices,seam_faces,'paving',zone)
        box(name+'_rear_service_door',x+w*.38,y+d/2+14.1,1.3,2.2,.16,2.6,'base',zone)
    elif kind in ('multiwing','research_block'):
        windows(name,x,y,w,d,h,max(1,int(h/3.2)),max(5,int(w/7)),zone)
        windows(name+'_wing',x-w/2-9,y+2,22,d*.72,h*.64,max(1,int(h*.64/3.2)),3,zone)
        hvac(name,x-w*.2,y+d*.2,h+4.6,4,zone)
        # Horizontal floor lines and a solid stair core provide structural rhythm.
        cubes(name+'_floor_edges',[(x,y-d/2-.18,3.2*j,w,.18,.15) for j in range(1,int(h/3.2)+1)],'roof',zone)
        box(name+'_entry_glass',x-w*.13,y-d/2-.2,1.9,w*.27,.2,3.8,'glass',zone)
    elif kind in ('courtyard','village_context'):
        bpy.data.objects[name+'_pitched_roof'].data.materials[0]=material('base')
        windows(name,x,y,w,d,h,2 if kind=='courtyard' else 1,6 if kind=='courtyard' else 3,zone)
        # Tiled eave/ridge lines remain visible from architectural close-up cameras.
        tile_lines=[]
        for side in (-1,1):
            for j in range(1,7):
                yy=y+side*d/2*j/7
                zz=h+(2.7 if kind=='courtyard' else 2)*(1-j/7)+.06
                tile_lines.append((x,yy,zz,w+1.2,.08,.06))
        cubes(name+'_tile_courses',tile_lines,'base',zone)
        box(name+'_ridge',x,y,h+(2.7 if kind=='courtyard' else 2)+.06,w+1.4,.24,.14,'base',zone)
        if kind=='courtyard':
            box('IN_hero_entrance',x,y-d/2-.2,1.65,2,.25,3.3,'wood',zone)
            box('IN_hero_entry_rainhood',x,y-d/2-1.2,3.5,4,2.4,.18,'wood',zone)
            box('IN_hero_wing_glass',x+19.9,y-18,1.9,.16,32,3.2,'glass',zone)
            box('IN_hero_wing_outer_glass',x+34.1,y-18,1.9,.16,32,3.2,'glass',zone)
            box('IN_hero_wing_end_glass',x+27,y-36.1,1.9,12,.16,3.2,'glass',zone)
            cubes('IN_hero_wing_mullions',[(x+19.75,y-33+j*4,1.9,.14,.16,3.5) for j in range(9)],'wood',zone)
            box('IN_hero_terrace_drain',x+7,y-35,.63,25,.18,.05,'base',zone)
            cubes('IN_hero_path_squares',[(x+1,y-25-j*4,.65,3.2,3.2,.1) for j in range(7)],'body',zone)
            trees('IN_hero_courtyard_trees',[(x-23,y-22,5),(x-22,y-41,5),(x+6,y-46,4)],zone)
            hvac('IN_hero_wing',x+28,y-7,4.4,2,zone)
    elif zone=='RA':
        if kind=='tower':
            glass=[]
            piers=[]
            # Continuous vertical blue-grey strips with pale structural fins.
            for i in range(9):
                xx=x-w/2+(i+.5)*w/9
                glass += [(xx,y-d/2-.08,41,w/9*.72,.18,53),(xx,y+d/2+.08,41,w/9*.72,.18,53)]
                piers += [(xx-w/18,y-d/2-.32,41,.5,.5,54),(xx-w/18,y+d/2+.32,41,.5,.5,54)]
            for i in range(7):
                yy=y-d/2+(i+.5)*d/7
                glass += [(x-w/2-.08,yy,41,.18,d/7*.72,53),(x+w/2+.08,yy,41,.18,d/7*.72,53)]
            cubes('RA_tower_curtain_glass',glass,'glass',zone)
            cubes('RA_tower_vertical_fins',piers,'body',zone)
            cubes('RA_tower_floor_mullions',[(x,y-d/2-.2,14+j*3,w,.18,.14) for j in range(19)]
                  +[(x,y+d/2+.2,14+j*3,w,.18,.14) for j in range(19)],'roof',zone)
            hvac('RA_roof',x-4,y-3,h+3.6,4,zone)
        else:
            windows(name,x,y,w,d,h,max(1,int(h/3.2)),max(5,int(w/5.5)),zone)
            cubes(name+'_piers',[(x-w/2+i*5.5,y-d/2-.3,h/2,.6,.55,h) for i in range(int(w/5.5)+1)],'body',zone)
        if kind=='podium':
            box('RA_tall_glass_lobby',3,-22.2,6.4,23,.3,11.8,'glass',zone)
            cubes('RA_lobby_mullions',[(3-10+j*2.5,-22.5,6.3,.16,.3,11.8) for j in range(9)],'roof',zone)

# Green-home process group: keep the process silhouette local and compact.
for i,(x,y,h) in enumerate([(76,35,29),(95,42,34),(120,34,27)]):
    cubes('GH_process_platform_'+str(i),[(x,y,5+j*6,10,10,.5) for j in range(int(h/6))],'roof','GH')
    box('GH_process_service_pipe',x+4,y,14,1.0,1.0,28,'paving','GH')
    box('GH_process_link',x+11,y,8,18,.8,.8,'roof','GH')

# Road markings, pavements, trees, equipment and scale cues use the SAME palette.
for zone in ('GH','EI','RD'):
    marks=[]
    if zone=='GH':
        for i in range(39):
            xx=-285+i*15
            if abs(xx-5)>25:
                marks.append((xx,0,.125,7,.22,.04))
        for i in range(28):
            yy=-212+i*16
            if abs(yy)>22:
                marks.append((5,yy,.125,.22,7,.04))
        tree_row(zone,-280,-22,26,0,23)
        tree_row(zone,-280,23,26,0,23)
    elif zone=='EI':
        for xx in (-268,270):
            for i in range(27):
                marks.append((xx,-210+i*16,.125,.22,7,.04))
        for i in range(37):
            marks.append((-285+i*16,-12,.125,7,.22,.04))
        tree_row(zone,-249,-205,0,20,22)
        tree_row(zone,249,-205,0,20,22)
    else:
        for i in range(29):
            marks += [(260,-215+i*15,.125,.22,7,.04),(252,-215+i*15,.125,.15,7,.04),(268,-215+i*15,.125,.15,7,.04)]
        tree_row(zone,236,-210,0,20,22)
        tree_row(zone,-99,-210,0,20,22)
    cubes(zone+'_lane_markings',marks,'line',zone)
    # Parking at the foreground edge, lamp poles along access streets.
    slots=[]
    cars=[]
    for j in range(10):
        xx=-235+j*6
        slots.append((xx,-191,.17,.13,8,.05))
        if j%3!=1:
            cars.append((xx+2.8,-191,1.0,2.1,4.6,1.5))
    if zone!='RD':
        cubes(zone+'_parking_lines',slots,'line',zone)
        cubes(zone+'_cars',cars,'body',zone)
        cubes(zone+'_car_glass',[(a,b,c+.65,d*.8,e*.46,.48) for a,b,c,d,e,f in cars],'glass',zone)
    lamps=[]
    for i in range(13):
        xx=-275+i*44
        lamps += [(xx,-28,4.5,.24,.24,9),(xx,-27.2,9,1.8,2.4,.22)]
    cubes(zone+'_street_lights',lamps,'base',zone)

for zone in ('GH','EI','IN','RD','RA'):
    root(zone)['palette']='shared PARK materials / warm grey-white + blue-grey glass + dark plinth / muted red industrial accent'
    root(zone)['detail_pass_complete']=True
scene['palette_hex']=json.dumps(PALETTE)
scene['disclaimer']='Reference-led first modeling iteration. Geometry/roof heights inferred. No measured/as-built or parcel-accurate claim.'
show_zone('GH')
scene.camera=bpy.data.objects['CAM_GH']
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-unified-v1.blend')
print(json.dumps({'stage':'unified_palette_complete','objects':len(bpy.data.objects),
                  'materials':[(m.name,m.get('palette_hex')) for m in bpy.data.materials if m.name.startswith('PARK /')],
                  'mesh_objects':sum(o.type=='MESH' for o in bpy.data.objects)},ensure_ascii=False))

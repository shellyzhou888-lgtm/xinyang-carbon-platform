# After all four macro layouts are reviewed, assemble coherent refined assets.
summary={}
BOUNDS={key:asset_bounds(key) for key in ('GH_A','GH_B','GH_S','GH_P','EI_A','EI_M','IN_A','IN_S','RD_A','RD_B')}
for zone,layout in LAYOUT['zones'].items():
    scene=activate(zone)
    scene['macro_review']='all four complete-park greybox renders reviewed before refinement'
    for spec in layout['buildings']:
        proxy=bpy.data.objects.get('PROXY_'+spec['id'])
        if proxy:
            bpy.data.objects.remove(proxy,do_unlink=True)
        instance(spec,zone)
    tree_points=[]
    lane_boxes=[]
    lamp_boxes=[]
    # Road line work / avenue trees, in batches at district scale.
    for road_index,road in enumerate(layout['roads']):
        role=road['role']
        for a,b in zip(road['points'],road['points'][1:]):
            vector=Vector((b[0]-a[0],b[1]-a[1]))
            length=vector.length
            tangent=vector.normalized()
            normal=Vector((-tangent.y,tangent.x))
            if role not in ('access','pedestrian','rural'):
                for j in range(int(length/18)):
                    p=Vector(a)+tangent*(j*18+9)
                    horizontal=abs(tangent.x)>.5
                    lane_boxes.append((p.x,p.y,.12+road_index*.0002,8 if horizontal else .25,.25 if horizontal else 8,.02))
                for j in range(int(length/38)):
                    p=Vector(a)+tangent*(j*38+20)
                    for side in (-1,1):
                        q=p+normal*(road['width']/2+7)*side
                        # Keep riverbank side free in the lakeside district.
                        tree_points.append((q.x,q.y,9+(j%4)))
                    if j%2==0:
                        q=p+normal*(road['width']/2+3)
                        lamp_boxes += [(q.x,q.y,5,.35,.35,10),(q.x,q.y,10.1,2.8,.8,.25)]
            elif zone=='IN':
                for j in range(int(length/37)):
                    p=Vector(a)+tangent*(j*37+18)+normal*(road['width']/2+5)
                    tree_points.append((p.x,p.y,7+j%4))
    if lane_boxes:
        boxes(zone+'_ROAD_MARKINGS',lane_boxes,'line',zone,'11_ROAD_FURNITURE')
    if lamp_boxes:
        boxes(zone+'_ROAD_LIGHTS',lamp_boxes,'base',zone,'11_ROAD_FURNITURE')

    gate_parts=[];gate_glass=[];fences=[];car_parts=[];car_glass=[];parking=[]
    for parcel_index,parcel in enumerate(layout['compounds']):
        x,y,w,d=[parcel[k] for k in ('x','y','w','d')]
        if parcel['role']=='reserve':
            # Reserved land stays visibly empty rather than filled with assets.
            ribbon(parcel['id']+'_soil_track',[[x-w*.42,y-d*.32],[x-w*.04,y+d*.1],[x+w*.4,y+d*.21]],7,.24,'sand',zone,'50_LANDSCAPE')
            for j in range(36):
                tree_points.append((x-w*.44+(j%12)*w*.08,y-d*.4+(j//12)*d*.07,8+j%4))
            label(parcel['id']+'_RESERVE','RESERVED LAND',x-w*.3,y-d*.15,16,zone)
            continue
        ident=parcel['id']
        # Connected service / fire-access loop, south entrance and cross aisle.
        loop=[(x-w/2+18,y-d/2+40),(x+w/2-18,y-d/2+40),
              (x+w/2-18,y+d/2-40),(x-w/2+18,y+d/2-40),(x-w/2+18,y-d/2+40)]
        ribbon(ident+'_FIRE_LOOP',loop,12,.235,'road',zone,'21_INTERNAL_CIRCULATION')
        ribbon(ident+'_CROSS_AISLE',[(x-w/2+18,y),(x+w/2-18,y)],12,.24,'road',zone,'21_INTERNAL_CIRCULATION')
        ribbon(ident+'_ENTRY_LINK',[(x,y-d/2-12),(x,y-d/2+40)],14,.242,'road',zone,'21_INTERNAL_CIRCULATION')
        # Warehouse aisles between building columns; avoid going through halls.
        if zone=='GH':
            aisle_offsets=(-137.5,137.5)
        elif zone=='EI':
            aisle_offsets=(0,) if parcel_index//2 in (0,4) else (-75,75)
        else:
            aisle_offsets=(0,)
        for j,dx in enumerate(aisle_offsets):
            ribbon(ident+'_AISLE_'+str(j),[(x+dx,y-d/2+40),(x+dx,y+d/2-40)],10,.247+j*.001,'road',zone,'21_INTERNAL_CIRCULATION')
        # South entrance, security kiosk and raised portal, not a wall across traffic.
        sy=y-d/2
        gate_parts += [(x-16,sy+8,1.75,8,6,3.5),(x-16,sy+8,3.65,9,7,.3),
                       (x-11,sy,2.5,.7,.7,5),(x+11,sy,2.5,.7,.7,5),(x,sy,5.1,23,1.3,.5)]
        gate_glass += [(x-16,sy+4.95,2,6.8,.15,1.3)]
        # Low physical boundary; actual ownership lines are not asserted.
        fences += [(x-w/2,y,.7,.4,d,1.4),(x+w/2,y,.7,.4,d,1.4),(x,y+d/2,.7,w,.4,1.4),
                   (x-(w/4+6),sy,.7,w/2-12,.4,1.4),(x+(w/4+6),sy,.7,w/2-12,.4,1.4)]
        for j in range(12 if zone!='RD' else 8):
            px=x-w/2+32+j*6
            py=sy+20
            parking.append((px,py,.26,.12,7,.02))
            if j%4!=2:
                car_parts.append((px+2.8,py,1.0,2.1,4.6,1.5))
                car_glass.append((px+2.8,py,1.68,1.8,2.4,.5))
        for j in range(int(w/34)):
            tree_points += [(x-w/2+15+j*34,y+d/2-10,8+j%4)]

    if gate_parts:
        boxes(zone+'_GATEHOUSES_PORTALS',gate_parts,'body',zone,'40_ENTRANCES_PARKING')
        boxes(zone+'_GATEHOUSE_GLASS',gate_glass,'glass',zone,'40_ENTRANCES_PARKING')
        boxes(zone+'_COMPOUND_BOUNDARIES',fences,'base',zone,'20_COMPOUNDS')
        boxes(zone+'_PARKED_CARS',car_parts,'body',zone,'40_ENTRANCES_PARKING')
        boxes(zone+'_CAR_GLASS',car_glass,'glass',zone,'40_ENTRANCES_PARKING')
        boxes(zone+'_PARKING_STRIPES',parking,'line',zone,'40_ENTRANCES_PARKING')

    if zone=='GH':
        # Preserve distinct foreground factories, local process plant and empty plots.
        for i in range(6):
            polygon('GH_FIELD_'+str(i),[(-2050+i*100,-1850),(-1970+i*100,-1850),(-1970+i*100,-1570),(-2050+i*100,-1570)],.02,'sand' if i%3==0 else 'grass',zone,'50_LANDSCAPE')
    elif zone=='EI':
        # A separate rail/industrial corridor follows the eastern edge as context.
        ribbon('EI_RAIL_BED',[(1030,-2470),(1030,2470)],18,.09,'sand',zone,'60_BACKGROUND_CONTEXT')
        boxes('EI_RAILS',[(1027,0,.21,.28,4940,.18),(1033,0,.21,.28,4940,.18)],'base',zone,'60_BACKGROUND_CONTEXT')
        boxes('EI_RAIL_SLEEPERS',[(1030,-2450+j*12,.15,10,.7,.2) for j in range(410)],'base',zone,'60_BACKGROUND_CONTEXT')
    elif zone=='IN':
        # Courtyard units are explicitly DESIGN proposals, not asserted built HQs.
        for i,spec in enumerate(s for s in layout['buildings'] if s['asset']=='IN_A'):
            x,y=spec['x'],spec['y']
            ribbon('IN_COURT_LINK_'+str(i),[(x+8,y-46),(x+8,y-32)],3.2,.30,'paving',zone,'21_INTERNAL_CIRCULATION')
        for i,(x,y) in enumerate([(-40,-620),(145,-320),(185,30),(290,430)]):
            box('IN_VIEWING_DECK_'+str(i),x,y,.4,23,13,.8,'wood',zone,'50_LANDSCAPE')
            ribbon('IN_DECK_LINK_'+str(i),[(x-30,y),(x,y)],3,.45,'paving',zone,'21_INTERNAL_CIRCULATION')
        for i in range(6):
            polygon('IN_FIELD_'+str(i),[(-820+i*90,-790),(-745+i*90,-790),(-745+i*90,-585),(-820+i*90,-585)],.02,'sand' if i%3==0 else 'grass',zone,'50_LANDSCAPE')
    else:
        # Partially developed research area: substantial reserve fields and ponds.
        for i in range(6):
            x=-450+i*190
            polygon('RD_RESERVE_FIELD_'+str(i),[(x,-1430),(x+150,-1430),(x+150,-1000),(x,-1000)],.025,'sand' if i%3==0 else 'grass',zone,'50_LANDSCAPE')
        ribbon('RD_UNPAVED_TRACK',[(-520,-1330),(-350,-1170),(-130,-1190),(40,-1000)],7,.09,'paving',zone,'50_LANDSCAPE')
        for i in range(80):
            a=i*math.tau/80
            pond=layout['ponds'][0]
            tree_points.append((pond['x']+(pond['rx']+20)*math.cos(a),pond['y']+(pond['ry']+25)*math.sin(a),10+i%5))
    prune_macro_trees(zone,layout)
    tree_points=[p for p in tree_points if clear_land(p[0],p[1],layout)]
    green_batch(zone+'_AVENUE_COURT_TREES',tree_points,zone)
    scene.view_layers[0].material_override=None
    scene['workflow_stage']='03_complete_park_asset_assembly_and_circulation'
    scene['buildings']=len(layout['buildings'])
    scene['geometry_status']='uniform-scale reuse of approved assets; structural annexes, roofs, cores and setbacks retained'
    scene['palette']='shared PARK materials from v1; warm grey white / blue grey glass / charcoal plinth'
    summary[zone]={'building_groups':len(layout['buildings']),'compounds':len(layout['compounds']),
                   'road_routes':len(layout['roads']),'new_street_trees':len(tree_points)}
activate('GH')
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-assemblies-v2.blend')
print(json.dumps({'assembly':summary,'objects':len(bpy.data.objects),'scenes':[s.name for s in bpy.data.scenes]},ensure_ascii=False))

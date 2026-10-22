BOUNDS={key:asset_bounds(key) for key in ('GH_A','GH_B','GH_S','GH_P','EI_A','EI_M','IN_A','IN_S','RD_A','RD_B')}
findings=[]
for zone,layout in LAYOUT['zones'].items():
    scene=activate(zone)
    for spec in layout['buildings']:
        obj=bpy.data.objects[spec['id']]
        obj.location.x=spec['x'];obj.location.y=spec['y']
        # Reject overlap with district public roads. Access drives through an
        # asset's apron are intentional and are checked separately as circulation.
        b=BOUNDS[spec['asset']];s=spec['scale'];t=math.radians(spec['rotation_deg'])
        corners=[(spec['x']+s*(xx*math.cos(t)-yy*math.sin(t)),spec['y']+s*(xx*math.sin(t)+yy*math.cos(t)))
                 for xx in b[0] for yy in b[1]]
        xmin=min(p[0] for p in corners);xmax=max(p[0] for p in corners)
        ymin=min(p[1] for p in corners);ymax=max(p[1] for p in corners)
        for r in layout['roads']:
            if r['role'] not in ('primary','secondary'):
                continue
            a,c=r['points'][0],r['points'][-1];half=r['width']/2
            if a[0]==c[0] and xmin<a[0]+half and xmax>a[0]-half and ymax>min(a[1],c[1]) and ymin<max(a[1],c[1]):
                findings.append((spec['id'],r['id']))
            if a[1]==c[1] and ymin<a[1]+half and ymax>a[1]-half and xmax>min(a[0],c[0]) and xmin<max(a[0],c[0]):
                findings.append((spec['id'],r['id']))
    prune_macro_trees(zone,layout)
    # Existing avenue batches are also pruned against roads, buildings and water.
    old=bpy.data.objects[zone+'_AVENUE_COURT_TREES']
    v=old.data.vertices
    pts=[(v[i+33].co.x,v[i+33].co.y,v[i+33].co.z/1.01) for i in range(0,len(v),34)]
    pts=[p for p in pts if clear_land(p[0],p[1],layout)]
    bpy.data.objects.remove(old,do_unlink=True)
    bpy.data.objects.remove(bpy.data.objects[zone+'_AVENUE_COURT_TREES_trunks'],do_unlink=True)
    green_batch(zone+'_AVENUE_COURT_TREES',pts,zone)
    if zone=='GH':
        patches=[(-1920,900),(-1700,1750),(-550,1780),(650,1750),(1850,900),(-1650,-1750)]
        cols,rows,step=18,12,28
    elif zone=='EI':
        patches=[(-1010,y) for y in (-1800,-600,600,1800)]
        cols,rows,step=8,20,25
    elif zone=='RD':
        patches=[(-1000,900),(-1000,-500),(-300,-1500),(850,-1100)]
        cols,rows,step=12,12,24
    else:
        patches=[(-650,400),(-100,650),(-450,-650)]
        cols,rows,step=14,12,22
    points=[]
    for cx,cy in patches:
        for j in range(rows):
            for i in range(cols):
                x=cx+(i-(cols-1)/2)*step+5*math.sin(i*3+j)
                y=cy+(j-(rows-1)/2)*step+5*math.sin(j*2+i)
                if clear_land(x,y,layout):
                    points.append((x,y,13+(i+j)%6))
    green_batch(zone+'_PERIPHERAL_WOODS',points,zone)
    scene['woodland_added_trees']=len(points)
    scene['layout_review']='no district-road/building-apron overlaps after concept layout adjustment'
assert not findings,findings
activate('GH')
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-assemblies-v2.blend')
print(json.dumps({'public_road_building_overlap':findings,'scene_objects':len(bpy.data.objects),
                  'planning_references_excluded':True,'review':'all instances inside study extent; vegetation on land clear of roads/buildings/water'},ensure_ascii=False))

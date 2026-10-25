def soften(points,iterations=2):
    result=points
    for k in range(iterations):
        sm=[result[0]]
        for a,b in zip(result,result[1:]):
            sm.extend([[a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25],
                       [a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]])
        result=sm+[result[-1]]
    return result

def tree(batch,x,y,rng,kind=None,scale=1):
    kind=kind if kind is not None else rng.choices(range(5),[40,20,15,18,7])[0]
    height=rng.uniform(9,20)*scale;radius=rng.uniform(3.7,7)*scale
    shade=rng.choice(['leaf0','leaf1','leaf2','leaf3','leaf4','leaf5'])
    if kind==1:height*=1.25;radius*=.57  # Narrow poplar-like form.
    if kind==2:height*=.8;radius*=1.35  # Spreading mature deciduous form.
    if kind==4:height*=.3;radius*=.6    # Shrub / low secondary stratum.
    tube(batch,(x,y,0),(x+.3*scale,y,height*.75),max(.12,height*.018),'trunk',6)
    if kind==3:
        for j in range(3):ellipsoid(batch,x,y,height*(.47+j*.17),radius*(1-j*.26),radius*(1-j*.26),height*.27,shade,rng)
    else:
        for j in range(rng.randint(3,5)):
            a=rng.random()*math.tau;reach=radius*rng.uniform(.15,.65)
            xx=x+math.cos(a)*reach;yy=y+math.sin(a)*reach
            zz=height*rng.uniform(.58,.82)
            tube(batch,(x,y,height*.35),(xx,yy,zz),.13*scale,'trunk',5)
            ellipsoid(batch,xx,yy,zz,radius*rng.uniform(.55,.82),radius*rng.uniform(.55,.88),
                      height*(.26 if kind!=1 else .36),shade if j%3 else rng.choice(['leaf0','leaf1','leaf2']),rng)
    return kind

def vehicle(batch,x,y,axis,rng,truck=False):
    w,d,h=(2.5,10,3.4) if truck else (1.9,4.5,1.6)
    if axis=='X':w,d=d,w
    color='whitecar' if truck else rng.choice(['whitecar','whitecar','darksteel','bluecar','redcar'])
    box(batch,x,y,.4+h/2,w,d,h,color)
    box(batch,x,y,h+.45,w*.75,d*.55,.3,'window')
    if truck:
        box(batch,x+(w*.35 if axis=='X' else 0),y+(0 if axis=='X' else d*.35),1.3,w*.9 if axis=='Y' else 2,d*.9 if axis=='X' else 2,2,'whitecar')

counts={}
for zone,layout in LAYOUT['zones'].items():
    scene=activate(zone)
    assert not bpy.data.collections.get('V3_'+zone+' / 30_VEGETATION'),'Landscape already built; inspect before rerun'
    bpy.data.objects['V3_'+zone+'_LAND'].location.z=0
    rng=random.Random(90210+sum(ord(c) for c in zone))
    # Smooth landscape shore and footpaths; industrial roads retain their real straight alignment.
    if zone=='IN':
        layout['shoreline']=soften(layout['shoreline'])
        for r in layout['roads']:
            if r['role'] in ('pedestrian','rural'):r['points']=soften(r['points'])
        original=bpy.data.objects['V3_'+zone+'_SURFACES'];original.hide_render=True;original.hide_set(True)
        surf=Batch('V3_IN_SOFT_SHORE_SURFACES',zone,'01_SURFACES')
        for x,y,w,d in layout['yards']:box(surf,x,y,.07,w,d,.12,'concrete_yard')
        for x,y,w,d in layout['reserves']:box(surf,x,y,.04,w,d,.06,'drygrass')
        for r in layout['roads']:
            ribbon(surf,r['points'],r['width']+1,.14,'soil')
            ribbon(surf,r['points'],r['width'],.18,'concrete_yard' if r['role']=='pedestrian' else 'asphalt')
        shore=[(layout['shoreline'][0][0],-3400)]+layout['shoreline']+[(layout['shoreline'][-1][0],5000)]
        # Explicit strip quads avoid non-convex n-gon triangulation across a concave shoreline.
        for a,b in zip(shore,shore[1:]):
            batch_add(surf,[(a[0],a[1],.10),(3600,a[1],.10),(3600,b[1],.10),(b[0],b[1],.10)],[(0,1,2,3)],'water')
        ribbon(surf,layout['shoreline'],7,.19,'bank')
        for x,y,rx,ry in layout['ponds']:
            p=[(x+rx*math.cos(j*math.tau/60),y+ry*math.sin(j*math.tau/60),.15) for j in range(60)]
            batch_add(surf,p,[tuple(range(60))],'water')
        finish(surf)
    paving=Batch('V3_'+zone+'_STREET_DETAILS',zone,'31_STREET_DETAILS')
    vegetation=Batch('V3_'+zone+'_MIXED_VEGETATION',zone,'30_VEGETATION')
    tally=[0]*5
    # Designed avenue trees, variable age/crown; never a single repeated crown mesh.
    for r in layout['roads']:
        for a,b in zip(r['points'],r['points'][1:]):
            delta=Vector(b)-Vector(a);length=delta.length
            if length<1:continue
            t=delta.normalized();n=Vector((-t.y,t.x))
            if r['role'] not in ('pedestrian','rural'):
                for offset in (-.18,.18):
                    pa=Vector(a)+n*offset;pb=Vector(b)+n*offset
                    ribbon(paving,[list(pa),list(pb)],.14,.205,'yellow')
                for dist in range(8,int(length)-3,16):
                    pa=Vector(a)+t*dist;pb=pa+t*5
                    for offset in (-r['width']*.28,r['width']*.28):
                        ribbon(paving,[list(pa+n*offset),list(pb+n*offset)],.16,.215,'line')
                for dist in range(25,int(length)-20,92):
                    p=Vector(a)+t*dist+n*(r['width']*.25)
                    vehicle(paving,p.x,p.y,'X' if abs(t.x)>.5 else 'Y',rng,truck=zone in ('GH','EI') and rng.random()<.27)
            for dist in range(10,int(length)-4,18 if zone!='IN' else 25):
                for sign in (-1,1):
                    p=Vector(a)+t*(dist+rng.uniform(-2,2))+n*sign*(r['width']/2+6.5)
                    if clear_land(p.x,p.y,layout,2):
                        k=tree(vegetation,p.x,p.y,rng,1 if rng.random()<.32 else 0,rng.uniform(.65,.95));tally[k]+=1
    # Broad natural groves: deterministic clustered sampling, not an avenue grid.
    centers=[(rng.uniform(-1250,1100),rng.uniform(-1000,2000),rng.uniform(60,200)) for i in range(44)]
    target=4400 if zone=='IN' else 3400
    accepted=0
    for attempt in range(target*14):
        if accepted>=target:break
        if attempt%4:
            cx,cy,spread=rng.choice(centers);x=rng.gauss(cx,spread);y=rng.gauss(cy,spread)
        else:x=rng.uniform(-1450,1350);y=rng.uniform(-1200,2300)
        if abs(x)>1750 or y < -1500 or y>2800:continue
        if not clear_land(x,y,layout,7):continue
        # Keep approved foreground reserve parcels legible rather than turning them into woodland.
        reserve=any(abs(x-xx)<w/2 and abs(y-yy)<d/2 for xx,yy,w,d in layout['reserves'])
        if reserve and rng.random()<.92:continue
        k=tree(vegetation,x,y,rng,scale=rng.uniform(.75,1.25));tally[k]+=1;accepted+=1
    # Plant the actual open parts of campus courtyards; the outer bounding box is not a building.
    for s in layout['buildings']:
        if s['kind'] not in ('campus','courtyard'):continue
        x,y,w,d,h=[s[k] for k in ('x','y','w','d','h')]
        if s['kind']=='campus':
            box(paving,x,y-d*.23,.17,w*.35,d*.26,.09,'grass')
            for j in range(5):
                xx=x-w*.12+j*w*.06;yy=y-d*.23
                k=tree(vegetation,xx,yy,rng,0,.65);tally[k]+=1
        else:
            k=tree(vegetation,x+w*.1,y-d*.1,rng,2,.65);tally[k]+=1
    # Rail corridor remains a separate eastern land-use element in the electronics concept.
    if layout.get('rail'):
        points=layout['rail'];ribbon(paving,points,16,.21,'concrete')
        for xoff in (-4.2,-2.7,2.7,4.2):
            tube(paving,(405+xoff,points[0][1],.5),(405+xoff,points[-1][1],.5),.09,'steel',6)
        for yy in range(int(points[0][1]),int(points[-1][1]),3):
            for xx in (401.55,408.45):box(paving,xx,yy,.3,2.8,.22,.2,'darksteel')
    # Mixed planting mesh is unique at each position, but batched to keep scene overhead low.
    obj=finish(vegetation);obj['morphology_counts']=json.dumps(tally);obj['seed']=90210+sum(ord(c) for c in zone)
    finish(paving);counts[zone]=dict(total=sum(tally),morphologies=tally)
    scene.cycles.samples=32;scene.render.engine='CYCLES'
    scene['stage']='v3 photo-reference correction / user review pending'
    scene['vegetation_morphologies']='broadleaf / narrow crown / spreading / layered conifer-like / shrub'
activate('GH')
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-reference-v3.blend',compress=True)
print(json.dumps({'stage':'revision_saved','vegetation':counts,'saved':bpy.data.filepath}))

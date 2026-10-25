# Structural refinement and photo-interpreted envelopes, exclusively through MCP.
def facade(batch,x,y,w,d,h,floors,skin='plaster',ground=.2):
    box(batch,x,y,ground+h/2,w,d,h,skin)
    # A visible plinth, roof coping, punched glazing and vertical piers.
    box(batch,x,y,ground+.4,w+.12,d+.12,.8,'concrete')
    box(batch,x,y,ground+h+.15,w+.5,d+.5,.30,'concrete')
    for level in range(max(1,floors)):
        z=ground+(level+.55)*h/max(1,floors)
        wh=min(2.3,h/max(1,floors)*.54)
        for side in (-1,1):
            for i in range(max(1,int(w/5.6))):
                xx=x-w/2+2.8+i*5.6
                if xx<x+w/2-1.4:box(batch,xx,y+side*(d/2+.05),z,3.5,.12,wh,'window')
            for i in range(max(1,int(d/6))):
                yy=y-d/2+3+i*6
                if yy<y+d/2-1.4:box(batch,x+side*(w/2+.05),yy,z,.12,3.4,wh,'window')
    # Parapets around flat roofs, and services with a functional location.
    for sy in (-1,1):box(batch,x,y+sy*(d/2-.25),ground+h+.6,w,.5,1,'plaster')
    for sx in (-1,1):box(batch,x+sx*(w/2-.25),y,ground+h+.6,.5,d,1,'plaster')
    box(batch,x-w*.24,y+d*.22,ground+h+1.5,min(w*.22,12),min(d*.25,9),3,'concrete')
    for i in range(max(1,int(w/45))):box(batch,x+i*9,y,ground+h+.8,5,3,1.4,'steel')

def shed(batch,s):
    x,y,w,d,h=[s[k] for k in ('x','y','w','d','h')]
    axis=s.get('ridge_axis','X');roofkey=s.get('roof','zinc')
    box(batch,x,y,h/2+.2,w,d,h,'plaster')
    box(batch,x,y,1,w+.15,d+.15,1.5,'concrete')
    roof(batch,x,y,w+1.4,d+1.4,h+.2,s.get('bays',2),roofkey,2.2,axis)
    # Distinct door rhythms are on operational loading sides, not arbitrary roofs.
    if axis=='X':
        for i in range(max(1,int(w/25))):
            xx=x-w/2+13+i*25
            box(batch,xx,y-d/2-.07,2.8,4.8,.16,5,s.get('doors','darksteel'))
            box(batch,xx,y-d/2-.8,5.5,6,1.6,.18,'steel')
        for xx in range(int(x-w/2+4),int(x+w/2-2),6):
            box(batch,xx,y-d/2-.11,h*.74,4.8,.16,1.4,'glass')
            box(batch,xx,y+d/2+.11,h*.74,4.8,.16,1.4,'glass')
        # One real lower ancillary block, with asymmetric placement.
        facade(batch,x+w*.22,y-d/2-7,w*.23,14,min(6,h*.6),1)
    else:
        for yy in range(int(y-d/2+12),int(y+d/2-5),24):
            for sx in (-1,1):
                box(batch,x+sx*(w/2+.08),yy,2.7,.18,4.5,5,s.get('doors','darksteel'))
                box(batch,x+sx*(w/2+.12),yy+8,8,.2,12,1.6,'glass')
        if s.get('front_office'):
            facade(batch,x,y-d/2-5,w*.82,10,7.5,2,'plaster')
            box(batch,x,y-d/2-10.4,7.9,w*.88,1.6,.4,'red')
    # Cladding joints / structural column rhythm on each long elevation.
    for sx in (-1,1):
        for yy in range(int(y-d/2+2),int(y+d/2),8):box(batch,x+sx*(w/2+.12),yy,h/2+.2,.18,.18,h,'concrete')

for zone,layout in LAYOUT['zones'].items():
    scene=activate(zone)
    assert not bpy.data.collections.get('V3_'+zone+' / 20_ARCHITECTURE'),'Already detailed: inspect before rerun'
    for obj in collection(zone,'10_MACRO').objects:obj.hide_render=True;obj.hide_set(True)
    for obj in collection(zone,'11_MACRO_CANOPY').objects:obj.hide_render=True;obj.hide_set(True)
    for s in layout['buildings']:
        batch=Batch('V3_DETAIL_'+s['id'],zone,'20_ARCHITECTURE')
        x,y,w,d,h=[s[k] for k in ('x','y','w','d','h')];kind=s['kind']
        if kind=='hall':shed(batch,s)
        elif kind=='process':
            for j,(xx,yy,ww,dd,hh) in enumerate(parts(s)):
                shed(batch,dict(x=xx,y=yy,w=ww,d=dd,h=hh,bays=2,roof='blue' if j==2 else 'zinc'))
            for j in range(5):
                xx=x-42+j*18;yy=y-5+(j%2)*17;hh=28+(j%3)*5
                tube(batch,(xx,yy,.2),(xx,yy,hh),4.4,'steel',16)
                tube(batch,(xx,yy,hh),(xx,yy,hh+2),3,'steel',16)
                for zz in (8,16,24):
                    box(batch,xx,yy,zz,10,10,.3,'darksteel')
                    for sx in (-1,1):tube(batch,(xx+sx*5,yy-5,zz),(xx+sx*5,yy+5,zz),.12,'steel')
                tube(batch,(xx-4,yy-4,0),(xx-4,yy-4,hh),.3,'darksteel')
            for zz in (7.5,10,12):
                tube(batch,(x-w*.5,y-25,zz),(x+w*.45,y-25,zz),.8,'steel',12)
                tube(batch,(x+w*.45,y-25,zz),(x+w*.45,y+50,zz),.8,'steel',12)
            for xx in range(int(x-w*.5),int(x+w*.5),25):
                for yy in (y-28,y-22):tube(batch,(xx,yy,0),(xx,yy,13),.35,'darksteel')
                tube(batch,(xx,y-28,13),(xx,y-22,13),.35,'darksteel')
        elif kind in ('courtyard','village'):
            for xx,yy,ww,dd,hh in parts(s):
                facade(batch,xx,yy,ww,dd,hh,max(1,round(hh/3.7)),'plaster')
                roof(batch,xx,yy,ww+1,dd+1,hh+1,1,s.get('roof','tile'),min(4,dd*.18))
                if kind=='courtyard':
                    box(batch,xx,yy-dd/2-2,hh*.75,ww,4,.3,'wood')
                    for px in range(int(xx-ww/2+2),int(xx+ww/2),5):tube(batch,(px,yy-dd/2-3.8,.2),(px,yy-dd/2-3.8,hh*.75),.22,'wood')
        else:
            for xx,yy,ww,dd,hh in parts(s):
                lower=hh*.72 if s.get('setback') else hh
                facade(batch,xx,yy,ww,dd,lower,max(1,round(lower/4)),s.get('facade','plaster'))
                if s.get('setback'):
                    facade(batch,xx-ww*.08,yy+dd*.10,ww*.78,dd*.65,hh-lower,max(1,round((hh-lower)/4)),s.get('facade','plaster'),ground=lower+.3)
            if kind=='campus':
                box(batch,x,y-d*.1,h*.36,w*.65,7,3.4,'concrete')
                box(batch,x,y-d*.1-3.55,h*.36,w*.65,.16,2,'glass')
                for sx in (-1,1):tube(batch,(x+sx*w*.25,y-d*.1,.2),(x+sx*w*.25,y-d*.1,h*.36),.5,'concrete')
        obj=finish(batch);obj['building_type']=kind;obj['source_spec']=s['id']
        obj['reference_ids']=','.join(layout['references'])
    scene['stage']='structural refinement; photo-interpreted envelope; landscaping next'
activate('GH')
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-reference-v3-structure.blend',compress=True)
print('Four-zone structural refinement saved; no GLB export or Form approval claimed.')

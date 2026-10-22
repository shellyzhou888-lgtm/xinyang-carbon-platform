BOUNDS={key:asset_bounds(key) for key in ('GH_A','GH_B','GH_S','GH_P','EI_A','EI_M','IN_A','IN_S','RD_A','RD_B')}
layout=LAYOUT['zones']['RD']
scene=activate('RD')
p=layout['ponds'][0]
for v in bpy.data.objects['RD_POND_0'].data.vertices:
    v.co.x=p['x']+(v.co.x+650)*p['rx']/210
name='RD_AVENUE_COURT_TREES'
obj=bpy.data.objects[name];vertices=obj.data.vertices
points=[]
for i in range(0,len(vertices),34):
    vertex=vertices[i+33]
    x,y,height=vertex.co.x,vertex.co.y,vertex.co.z/1.01
    if abs(((x+650)/230)**2+((y+1160)/145)**2-1)<.001:
        x=p['x']+(x+650)*(p['rx']+20)/230
    if clear_land(x,y,layout):
        points.append((x,y,height))
bpy.data.objects.remove(obj,do_unlink=True)
bpy.data.objects.remove(bpy.data.objects[name+'_trunks'],do_unlink=True)
green_batch(name,points,'RD')
overlaps=[]
for pond in layout['ponds']:
    for r in layout['roads']:
        if r['role'] not in ('primary','secondary'):
            continue
        a,b=r['points'][0],r['points'][-1]
        if a[0]==b[0] and abs(a[0]-pond['x'])<pond['rx']+r['width']/2 and min(a[1],b[1])<pond['y']+pond['ry'] and max(a[1],b[1])>pond['y']-pond['ry']:
            overlaps.append((r['id'],pond))
        if a[1]==b[1] and abs(a[1]-pond['y'])<pond['ry']+r['width']/2 and min(a[0],b[0])<pond['x']+pond['rx'] and max(a[0],b[0])>pond['x']-pond['rx']:
            overlaps.append((r['id'],pond))
assert not overlaps,overlaps
for view in ('overview','detail','plan'):
    render('RD',view,width=1600,height=1100)
scene.camera=bpy.data.objects['RD_CAM_overview']
activate('GH')
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-assemblies-v2.blend')
print(json.dumps({'water_public_road_overlap':overlaps,'action':'pond and riparian trees set clear of public road; no unverified bridge invented'}))

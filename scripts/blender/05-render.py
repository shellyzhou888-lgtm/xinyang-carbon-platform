# MCP client defines ZONE and VIEW ('scene', 'asset', or a true orthographic side).
zone=ZONE
view=VIEW
scene=bpy.context.scene
scene.cycles.samples=16
show_zone(zone)
for ob in root(zone).objects:
    ob.hide_render=False
if view=='scene':
    render_view(bpy.data.objects['CAM_'+zone],'renders/'+zone+'-scene.png',1600,1200)
else:
    prefix={'GH':'GH_hero','EI':'EI_hero','IN':'IN_hero','RA':'RA_'}[zone]
    configs={'GH':(-153,-112,10,300,110),'EI':(-130,-108,8,300,140),'IN':(-66,-48,5,110,85),'RA':(-5,0,32,169,140)}
    x,y,z,scale,depth=configs[zone]
    for ob in root(zone).objects:
        ob.hide_render=not ob.name.startswith(prefix)
    floor_name='ASSET_FLOOR_'+zone
    floor=bpy.data.objects.get(floor_name)
    if floor is None:
        floor=box(floor_name,x,y,-.75,scale*1.4,scale*1.1,1.0,'paving',zone)
    floor.hide_render=False
    if view=='asset':
        cam=camera('DETAIL_'+zone,zone,target=(x,y,z),offset=(scale*(-.65 if zone=='IN' else .65),-scale*.85,scale*.60),scale=scale)
        render_view(cam,'renders/'+zone+'-asset.png',1600,1100)
    else:
        # All five cameras inspect exactly the SAME mesh, no AI-generated projection.
        offsets={'front':(0,-500,0),'back':(0,500,0),'left':(-500,0,0),'right':(500,0,0),'top':(0,0,500)}
        ortho_scale=scale if view in ('front','back','top') else depth*1.25
        cam=camera('ORTHO_'+zone+'_'+view,zone,target=(x,y,z),offset=offsets[view],scale=ortho_scale)
        render_view(cam,'orthographic/'+zone+'-'+view+'.png',1200,800)
    floor.hide_render=True
    for ob in root(zone).objects:
        ob.hide_render=False
    floor.hide_render=True
print(json.dumps({'zone':zone,'view':view,'camera':scene.camera.name,'projection':scene.camera.data.type}))

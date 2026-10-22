# Define ZONE via the MCP client. Render real parallel-projection asset checks.
zone=ZONE
scene=bpy.context.scene
scene.cycles.samples=10
scene.cycles.max_bounces=3
scene.cycles.diffuse_bounces=2
scene.cycles.glossy_bounces=2
show_zone(zone)
prefix={'GH':'GH_hero','EI':'EI_hero','IN':'IN_hero','RA':'RA_'}[zone]
configs={'GH':(-153,-112,10,275,125),'EI':(-130,-108,8,280,160),
         'IN':(-66,-48,5,100,85),'RA':(-5,0,32,150,125)}
x,y,z,scale,depth=configs[zone]
floor=bpy.data.objects.get('ASSET_FLOOR_'+zone)
if floor is None:
    floor=box('ASSET_FLOOR_'+zone,x,y,-.75,scale*1.6,scale*1.3,1,'paving',zone)
for ob in root(zone).objects:
    ob.hide_render=not ob.name.startswith(prefix)
floor.hide_render=False
for side,offset in [('front',(0,-500,0)),('back',(0,500,0)),('left',(-500,0,0)),('right',(500,0,0)),('top',(0,0,500))]:
    image_scale=120 if zone=='IN' and side=='top' else (scale if side in ('front','back','top') else depth)
    cam=camera('ORTHO_'+zone+'_'+side,zone,target=(x,y,z),offset=offset,scale=image_scale)
    render_view(cam,'orthographic/'+zone+'-'+side+'.png',1000,700)
for ob in root(zone).objects:
    ob.hide_render=False
floor.hide_render=True
print(json.dumps({'zone':zone,'parallel_views':['front','back','left','right','top'],
                  'geometry':'same mesh for all five views','dimensions':'inferred, to verify'}))

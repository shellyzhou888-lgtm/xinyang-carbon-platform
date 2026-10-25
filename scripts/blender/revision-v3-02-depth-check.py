for zone in LAYOUT['zones']:
    s=activate(zone)
    land=bpy.data.objects['V3_'+zone+'_LAND']
    land.location.z=-1
    for view in ('overview','plan','detail'):
        cam=bpy.data.objects['V3_'+zone+'_'+view]
        cam.data.clip_start=10;cam.data.clip_end=18000
    s.render.engine='CYCLES';s.cycles.samples=16
    bg=next(n for n in s.world.node_tree.nodes if n.type=='BACKGROUND')
    bg.inputs[1].default_value=.10
    for obj in s.objects:
        if obj.type=='LIGHT':obj.data.energy=2.5
    surf=bpy.data.objects['V3_'+zone+'_SURFACES']
    print(zone, 'surface vertices',len(surf.data.vertices),'zrange',
          min(v.co.z for v in surf.data.vertices),max(v.co.z for v in surf.data.vertices),
          'hidden',surf.hide_render,'land top',max(v.co.z for v in land.data.vertices)+land.location.z)
print(render('RD','overview',False,1000,650))

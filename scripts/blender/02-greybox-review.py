scene=bpy.context.scene
scene.cycles.samples=12
for zone in ('GH','EI','IN','RD'):
    show_zone(zone)
    render_view(bpy.data.objects['CAM_'+zone],'greybox/'+zone+'-greybox.png',960,720)
print(json.dumps({'stage':'greybox_review','rendered':['GH','EI','IN','RD'],
                  'material_override':scene.view_layers[0].material_override.name,
                  'proxy_buildings':sum(1 for o in bpy.data.objects if 'kind' in o)},ensure_ascii=False))

scene=bpy.context.scene
scene.view_layers[0].material_override=None
exports=[]
for zone in ('GH','EI','IN','RD','RA'):
    show_zone(zone)
    # Deselect hidden collections too, preventing previous zones leaking into GLB.
    for ob in bpy.data.objects:
        ob.select_set(False)
    selected=[o for o in root(zone).objects if o.type=='MESH' and not o.name.startswith('ASSET_FLOOR_')]
    ox,oy=ZONES[zone]
    for ob in selected:
        ob.select_set(True)
        ob.location.x-=ox
        ob.location.y-=oy
    bpy.context.view_layer.objects.active=selected[0]
    filepath=OUT+zone+'-v1.glb'
    bpy.ops.export_scene.gltf(filepath=filepath,export_format='GLB',use_selection=True,
                              export_extras=True,export_yup=True,export_apply=True,
                              export_cameras=False,export_lights=False)
    for ob in selected:
        ob.location.x+=ox
        ob.location.y+=oy
    exports.append({'zone':zone,'file':zone+'-v1.glb','objects':len(selected),
                    'vertices':sum(len(o.data.vertices) for o in selected),
                    'faces':sum(len(o.data.polygons) for o in selected),
                    'coordinate_system':'local metres, glTF Y-up; origin rebased per study tile',
                    'georeferenced':False})
show_zone('GH')
for z in ('GH','EI','IN','RD','RA'):
    floor=bpy.data.objects.get('ASSET_FLOOR_'+z)
    if floor:
        floor.hide_render=True
        floor.hide_set(True)
scene.camera=bpy.data.objects['CAM_GH']
scene['workflow_stage']='07_first_model_delivery'
scene['export_manifest']=json.dumps(exports)
# Named scene tabs let the user open each zone without manually toggling many
# collections. Scene copies share the same mesh datablocks, not duplicate assets.
for zone in ('GH','EI','IN','RD','RA'):
    tab=scene.copy()
    tab.name=LABELS[zone]
    for child in list(tab.collection.children):
        if child.name.startswith('ZONE_') and child.name!='ZONE_'+zone:
            tab.collection.children.unlink(child)
    tab.camera=bpy.data.objects['CAM_'+zone]
    tab['active_zone']=zone
    root(zone).hide_render=False
    root(zone).hide_viewport=False
for layer_child in scene.view_layers[0].layer_collection.children:
    if layer_child.name.startswith('ZONE_'):
        layer_child.exclude=layer_child.name!='ZONE_GH'
# Establish a useful saved viewport without relying on native UI automation.
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-unified-v1.blend')
print(json.dumps({'exports':exports,'saved':bpy.data.filepath,
                  'objects':len(bpy.data.objects),'scene_tabs':[s.name for s in bpy.data.scenes],
                  'asset_roof_bounds':{z: [min(v.co.z for v in bpy.data.objects[z+'_hero_roof'].data.vertices),max(v.co.z for v in bpy.data.objects[z+'_hero_roof'].data.vertices)] for z in ('GH','EI')},
                  'stages':['greybox','structural','unified_palette'],
                  'all_meshes_have_materials':all(len(o.data.materials)>0 for o in bpy.data.objects if o.type=='MESH'),
                  'all_mesh_coordinates_finite':all(math.isfinite(v) for o in bpy.data.objects if o.type=='MESH' for vertex in o.data.vertices for v in vertex.co)},ensure_ascii=False))

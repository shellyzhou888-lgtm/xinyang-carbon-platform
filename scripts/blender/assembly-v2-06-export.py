reports=[]
for zone,layout in LAYOUT['zones'].items():
    scene=activate(zone)
    scene.view_layers[0].material_override=None
    scene.view_layers[0].update()
    scene.camera=bpy.data.objects[zone+'_CAM_overview']
    scene.render.resolution_x=1600;scene.render.resolution_y=1100
    for obj in bpy.data.objects:
        obj.select_set(False)
    objects=[o for o in scene.objects if o.type=='MESH' and o.get('role')!='95_PLANNING_REFERENCE_OFF']
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.export_scene.gltf(filepath=OUT+'models/'+zone+'-complete-v2.glb',export_format='GLB',
                              use_selection=True,export_extras=True,export_yup=True,export_apply=True,
                              export_cameras=False,export_lights=False)
    report={'zone':zone,'buildings':len(layout['buildings']),'compounds':len(layout['compounds']),
            'road_routes':len(layout['roads']),'extent_m':layout['extent'],'export_mesh_objects':len(objects),
            'geometry_vertices_before_instancing':sum(len(o.data.vertices) for o in objects),
            'unique_meshes':len({o.data.name for o in objects}),
            'tree_count':sum(o.get('tree_count',0) for o in objects),
            'all_mesh_coordinates_finite':all(math.isfinite(v) for o in objects for vertex in o.data.vertices for v in vertex.co),
            'all_meshes_have_materials':all(len(o.data.materials)>0 for o in objects),
            'georeferenced':False,'planning_reference_exported':False}
    scene['model_report']=json.dumps(report)
    reports.append(report)
    for obj in objects:
        obj.select_set(False)
activate('GH')
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-assemblies-v2.blend')
print(json.dumps({'reports':reports,'saved':bpy.data.filepath,'scenes':[s.name for s in bpy.data.scenes]},ensure_ascii=False))

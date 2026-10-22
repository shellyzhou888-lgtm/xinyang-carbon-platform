# Run AFTER opening the master in a separate MCP call.
scene=activate(ZONE)
for other in list(bpy.data.scenes):
    if other!=scene:
        bpy.data.scenes.remove(other)
for c in list(bpy.data.collections):
    if not c.name.startswith(ZONE+' / '):
        bpy.data.collections.remove(c)
for data in bpy.data.meshes:
    data.use_fake_user=False
bpy.ops.outliner.orphans_purge(do_local_ids=True,do_linked_ids=False,do_recursive=True)
scene.camera=bpy.data.objects[ZONE+'_CAM_overview']
scene.view_layers[0].material_override=None
bpy.ops.wm.save_as_mainfile(filepath=OUT+'models/'+ZONE+'-complete-v2.blend')
assert len(bpy.data.scenes)==1
assert all(o.get('zone_id',ZONE)==ZONE for o in scene.objects if o.type=='MESH')
print(json.dumps({'standalone':ZONE,'scenes':[s.name for s in bpy.data.scenes],'objects':len(scene.objects),
                  'report':json.loads(scene['model_report']),'saved':bpy.data.filepath},ensure_ascii=False))

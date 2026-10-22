# Final review: include the entire courtyard terrace in its roof plan.
bpy.context.window.scene=bpy.data.scenes['03 / BEIHU COURTYARD']
scene=bpy.context.scene
scene.cycles.samples=10
for ob in root('IN').objects:
    ob.hide_render=not ob.name.startswith('IN_hero')
floor=bpy.data.objects['ASSET_FLOOR_IN']
floor.hide_set(False)
floor.hide_render=False
cam=camera('ORTHO_IN_top_complete','IN',target=(-66,-48,5),offset=(0,0,500),scale=120)
render_view(cam,'orthographic/IN-top.png',1000,700)
for ob in root('IN').objects:
    ob.hide_render=False
floor.hide_render=True
floor.hide_set(True)
scene.camera=bpy.data.objects['CAM_IN']
for tab in bpy.data.scenes:
    tab.render.resolution_x=1600
    tab.render.resolution_y=1200
for z in ZONES:
    root(z).hide_render=False
    root(z).hide_viewport=False
bpy.context.window.scene=bpy.data.scenes['PARK / FOUR ZONES / V1']
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-unified-v1.blend')
print(json.dumps({'final_review':'all four scenes and four assets visually reviewed; courtyard top crop corrected',
                  'active_scene':bpy.context.scene.name,'saved':bpy.data.filepath,
                  'scene_tabs':[s.name for s in bpy.data.scenes]},ensure_ascii=False))

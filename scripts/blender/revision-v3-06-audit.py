# Read-only geometry audit followed by explicit UI selection and saving this review source.
report={'stage':'form_review_pending','saved_file':bpy.data.filepath,'zones':{},'external_images':[],
        'surveyed':False,'runtime_exported':False,'audit_scope':'inventory, budget, scene isolation, external dependencies, camera; not a full BVH, road-collision or measured-parity certification'}
for zone,layout in LAYOUT['zones'].items():
    rectangles=[(s['x'],s['y'],s['w'],s['d']) for s in layout['buildings']]
    rectangles+=layout['reserves']+[(x,y,rx*2,ry*2) for x,y,rx,ry in layout['ponds']]
    if zone=='IN':rectangles.append((-100,-10,1500,2220))
    minx=min(x-w/2 for x,y,w,d in rectangles);maxx=max(x+w/2 for x,y,w,d in rectangles)
    miny=min(y-d/2 for x,y,w,d in rectangles);maxy=max(y+d/2 for x,y,w,d in rectangles)
    plan=bpy.data.objects['V3_'+zone+'_plan'];plan.location=((minx+maxx)/2,(miny+maxy)/2,4000)
    plan.data.ortho_scale=max(maxx-minx,(maxy-miny)*1.6)*1.12
    scene=activate(zone);objects=[o for o in scene.objects if not o.hide_render]
    tris=0
    for obj in objects:
        if obj.type=='MESH':
            obj.data.calc_loop_triangles();tris+=len(obj.data.loop_triangles)
    missing=[s['id'] for s in layout['buildings'] if 'V3_DETAIL_'+s['id'] not in scene.objects]
    wrong=[o.name for o in objects if o.get('zone_id',zone)!=zone]
    vegetation=bpy.data.objects['V3_'+zone+'_MIXED_VEGETATION']
    report['zones'][zone]={'scene':scene.name,'visible_objects':len(objects),'triangles':tris,
        'composition_units':len(layout['buildings']),'missing_units':missing,'wrong_zone_objects':wrong,
        'canopy_morphologies':json.loads(vegetation['morphology_counts']),
        'canopy_ratio':vegetation.get('canopy_decimation_ratio'),
        'camera_count':sum(o.type=='CAMERA' for o in scene.objects),
        'units':scene.unit_settings.system,'scale':scene.unit_settings.scale_length,
        'perspective_eye':list(bpy.data.objects['V3_'+zone+'_overview'].location),
        'plan_ortho_scale':plan.data.ortho_scale,'plan_center':list(plan.location),
        'render_engine':scene.render.engine,'materials':sorted({m.name for o in objects if o.type=='MESH' for m in o.data.materials if m})}
    assert not missing and not wrong,'Missing building or cross-zone contamination'
    assert tris<=LAYOUT['budget']['target_triangles_per_scene'],'Triangle budget exceeded'
    assert report['zones'][zone]['camera_count']==3
for im in bpy.data.images:
    if im.source=='FILE' and im.filepath and not im.packed_file:report['external_images'].append(im.filepath)
report['original_scenes_preserved']=[s.name for s in bpy.data.scenes if s.name.startswith('ASSEMBLY_')]
assert len(report['original_scenes_preserved'])==4
assert not report['external_images']
scene=activate('GH');scene.camera=bpy.data.objects['V3_GH_overview']
window=bpy.context.window or bpy.context.window_manager.windows[0]
for area in window.screen.areas:
    if area.type=='VIEW_3D':
        space=area.spaces.active;space.region_3d.view_perspective='CAMERA';space.region_3d.view_camera_zoom=8
        space.clip_end=18000;space.overlay.show_overlays=False;space.shading.type='MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-reference-v3.blend',compress=True)
print(json.dumps(report,ensure_ascii=False))

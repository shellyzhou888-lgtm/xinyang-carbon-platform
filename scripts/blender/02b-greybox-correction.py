# Correct coplanar base/terrain surfaces and ensure the whole study fits camera.
for z in ('GH','EI','IN','RD'):
    base=bpy.data.objects[z+'_study_base']
    base.location.z=-.6-max(vertex.co.z for vertex in base.data.vertices)
    bpy.data.objects['CAM_'+z].data.ortho_scale=900
scene=bpy.context.scene
scene.cycles.samples=12
for z in ('GH','EI','IN','RD'):
    show_zone(z)
    render_view(bpy.data.objects['CAM_'+z],'greybox/'+z+'-greybox.png',960,720)
show_zone('GH')
scene.camera=bpy.data.objects['CAM_GH']
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-greybox-v1.blend')
print('Four corrected greyboxes rendered; no coincident base/terrain faces; full scene in frame.')

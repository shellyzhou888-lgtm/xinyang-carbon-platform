# Execute through Blender MCP after opening the master in a separate call.
# Inspect saved geometry; only the active UI scene/view is adjusted.
import bpy
import json

report = {
    'blender': bpy.app.version_string,
    'background': bpy.app.background,
    'file_name': bpy.path.basename(bpy.data.filepath),
    'scenes': {},
    'external_images': [],
}
for zone, layout in LAYOUT['zones'].items():
    scene = bpy.data.scenes.get('ASSEMBLY_' + zone)
    if scene is None:
        raise RuntimeError('Missing scene: ASSEMBLY_' + zone)
    missing = [item['id'] for item in layout['buildings'] if item['id'] not in scene.objects]
    wrong_zone = [obj.name for obj in scene.objects
                  if obj.type == 'MESH' and obj.get('zone_id', zone) != zone]
    cameras = [zone + '_CAM_' + view for view in ('overview', 'detail', 'plan')]
    missing_cameras = [name for name in cameras if name not in scene.objects]
    report['scenes'][zone] = {
        'name': scene.name,
        'objects': len(scene.objects),
        'meshes': sum(obj.type == 'MESH' for obj in scene.objects),
        'building_groups': len(layout['buildings']),
        'missing_building_groups': missing,
        'wrong_zone_objects': wrong_zone,
        'missing_cameras': missing_cameras,
        'units': scene.unit_settings.system,
        'unit_scale': scene.unit_settings.scale_length,
    }
    if missing or wrong_zone or missing_cameras:
        raise RuntimeError(json.dumps(report['scenes'][zone]))
for image in bpy.data.images:
    if image.source == 'FILE' and image.filepath and not image.packed_file:
        report['external_images'].append(image.filepath)

window = bpy.context.window or bpy.context.window_manager.windows[0]
window.scene = bpy.data.scenes['ASSEMBLY_GH']
for area in window.screen.areas:
    if area.type == 'VIEW_3D':
        space = area.spaces.active
        space.region_3d.view_perspective = 'CAMERA'
        space.region_3d.view_camera_zoom = 22
        space.clip_end = 100000
        space.overlay.show_overlays = False
        space.shading.type = 'SOLID'
        space.shading.color_type = 'MATERIAL'
report['active_scene'] = window.scene.name
report['geometry_modified'] = False
report['saved'] = False
print(json.dumps(report, ensure_ascii=False))

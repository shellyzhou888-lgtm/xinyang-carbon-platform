# Review refinement: dark tiled roof and glazed wing agree with the accepted board.
for ob in [o for o in bpy.data.objects if o.get('zone_id')=='IN' and 'kind' in o]:
    bpy.data.objects[ob.name+'_pitched_roof'].data.materials[0]=material('base')
box('IN_hero_wing_outer_glass',-40.9,-49,1.9,.16,32,3.2,'glass','IN')
box('IN_hero_wing_end_glass',-48,-67.1,1.9,12,.16,3.2,'glass','IN')
show_zone('IN')
scene=bpy.context.scene
scene.cycles.samples=12
render_view(bpy.data.objects['CAM_IN'],'renders/IN-scene.png',1600,1200)
print('Courtyard review: grey tiled roof and glazed wing restored to approved design; scene rerendered.')

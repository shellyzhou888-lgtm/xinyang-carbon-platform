# Fix coincident apron surfaces found in final top-down review.
import bmesh
surface=bpy.data.objects['V3_GH_SURFACES'];bm=bmesh.new();bm.from_mesh(surface.data)
bm.faces.ensure_lookup_table()
# First six faces belong to H01. The next four boxes are the tightened left cluster.
bmesh.ops.delete(bm,geom=[bm.faces[i] for i in range(6,30)],context='FACES')
bm.to_mesh(surface.data);bm.free()
apron=Batch('V3_GH_JOINED_FACTORY_APRON','GH','01_SURFACES')
box(apron,-315,-15,.07,440,602,.12,'concrete_yard');finish(apron)
surface=bpy.data.objects['V3_EI_SURFACES']
for i in range(len(LAYOUT['zones']['EI']['yards'])):
    for v in list(surface.data.vertices)[i*8:i*8+8]:v.co.z+=i*.006
surface['overlapping_apron_depth_separation_m']=.006
print('Resolved coplanar apron overlap in GH and EI; no files or v2 assets removed.')

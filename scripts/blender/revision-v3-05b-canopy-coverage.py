# Review natural woodland coverage without adding identical mesh instances or triangles.
import bmesh
report={}
for zone,layout in LAYOUT['zones'].items():
    if zone=='GH':
        for s in layout['buildings']:
            if s['id'] in ('GH_H03','GH_H04','GH_H05'):s['y']={'GH_H03':-82,'GH_H04':54,'GH_H05':210}[s['id']]
    obj=bpy.data.objects['V3_'+zone+'_MIXED_VEGETATION']
    assert not obj.get('natural_canopy_expanded'),'Already refined'
    bm=bmesh.new();bm.from_mesh(obj.data);seen=set();changed=0
    for root in bm.verts:
        if root in seen:continue
        stack=[root];seen.add(root);component=[]
        while stack:
            v=stack.pop();component.append(v)
            for edge in v.link_edges:
                other=edge.other_vert(v)
                if other not in seen:seen.add(other);stack.append(other)
        if not root.link_faces:continue
        mat=obj.data.materials[root.link_faces[0].material_index]
        if not mat.name.startswith('V3 / leaf'):continue
        lo=Vector((min(v.co.x for v in component),min(v.co.y for v in component),min(v.co.z for v in component)))
        hi=Vector((max(v.co.x for v in component),max(v.co.y for v in component),max(v.co.z for v in component)))
        center=(lo+hi)/2;size=hi-lo
        if not clear_land(center.x,center.y,layout,22):continue
        factor=1.55 if size.z<max(size.x,size.y)*1.8 else 1.15
        for v in component:
            v.co.x=center.x+(v.co.x-center.x)*factor;v.co.y=center.y+(v.co.y-center.y)*factor
        changed+=1
    bm.to_mesh(obj.data);bm.free();obj['natural_canopy_expanded']=True
    obj['natural_canopy_components_expanded']=changed;report[zone]=changed
activate('GH');bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-reference-v3.blend',compress=True)
print(json.dumps({'natural_crown_components_expanded':report,'added_triangles':0}))

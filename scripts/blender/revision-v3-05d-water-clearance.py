# Top-view review: preserve roads; move unmeasured context ponds out of road corridors.
import bmesh
corrections={'GH':[(-710,420,0,-30,70,48),(710,510,0,60,80,55)],
             'RD':[(-650,350,0,-110,100,68),(-520,-700,-70,0,145,80)]}
for zone,changes in corrections.items():
    obj=bpy.data.objects['V3_'+zone+'_SURFACES'];mesh=obj.data
    for x,y,dx,dy,rx,ry in changes:
        matches=[]
        for face in mesh.polygons:
            if mesh.materials[face.material_index].name!='V3 / water':continue
            xx=sum(mesh.vertices[i].co.x for i in face.vertices)/len(face.vertices)
            yy=sum(mesh.vertices[i].co.y for i in face.vertices)/len(face.vertices)
            if math.hypot(xx-x,yy-y)<12:matches.append(face)
        assert len(matches)==1,'Pond already moved or ambiguous; inspect before retry'
        for i in matches[0].vertices:mesh.vertices[i].co.x+=dx;mesh.vertices[i].co.y+=dy
    vegetation=bpy.data.objects['V3_'+zone+'_MIXED_VEGETATION'];bm=bmesh.new();bm.from_mesh(vegetation.data)
    seen=set();remove=[]
    for root in bm.verts:
        if root in seen:continue
        stack=[root];seen.add(root);component=[]
        while stack:
            vertex=stack.pop();component.append(vertex)
            for edge in vertex.link_edges:
                other=edge.other_vert(vertex)
                if other not in seen:seen.add(other);stack.append(other)
        xx=sum(v.co.x for v in component)/len(component);yy=sum(v.co.y for v in component)/len(component)
        if any(((xx-x-dx)/(rx+5))**2+((yy-y-dy)/(ry+5))**2<1 for x,y,dx,dy,rx,ry in changes):remove.extend(component)
    bmesh.ops.delete(bm,geom=remove,context='VERTS');bm.to_mesh(vegetation.data);bm.free()
    vegetation['pond_clearance_pruned_vertices']=len(remove)
activate('GH');bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-reference-v3.blend',compress=True)
print('Four context ponds clear of road corridors; intruding vegetation pruned. Positions remain unmeasured.')

# Second visual review: tighten the left factory cluster, enrich ground/water,
# refine different roof silhouettes, and reduce invisible canopy tessellation.
import bmesh
gh=LAYOUT['zones']['GH']
for key,new_y in [('GH_H03',-82),('GH_H04',54),('GH_H05',210)]:
    spec=next(s for s in gh['buildings'] if s['id']==key);delta=new_y-spec['y']
    for prefix in ('V3_DETAIL_','V3_MACRO_'):bpy.data.objects[prefix+key].location.y+=delta
    idx=gh['buildings'].index(spec)
    mesh=bpy.data.objects['V3_GH_SURFACES'].data
    for v in list(mesh.vertices)[idx*8:idx*8+8]:v.co.y+=delta
    # Keep the source scene contract in custom data; file is updated by the packaging script.
    spec['y']=new_y;gh['yards'][idx][1]=new_y

# Turn repetitive rectangular commercial blocks into reference-supported L/T roof groups.
for zone in ('RD','EI'):
    layout=LAYOUT['zones'][zone]
    extra=Batch('V3_'+zone+'_SECONDARY_WINGS',zone,'20_ARCHITECTURE')
    for i,s in enumerate(layout['buildings']):
        x,y,w,d,h=[s[k] for k in ('x','y','w','d','h')]
        if s['kind']=='village' and zone=='RD':
            xx=x+(-1 if i%2 else 1)*w*.28;yy=y+d*.52
            facade(extra,xx,yy,w*.30,d*.90,h*.72,2,'plaster')
            roof(extra,xx,yy,w*.30+1,d*.90+1,h*.72+1,1,s.get('roof','tile'),3,axis='Y')
        if s['kind']=='campus':
            if i%2:
                facade(extra,x-w*.06,y-d*.39,w*.62,d*.13,h*.35,2,'concrete')
            else:
                facade(extra,x+w*.26,y+d*.40,w*.32,d*.18,h*.2,1,'concrete',ground=h+.5)
    finish(extra)

# Photo palette is an interpretation, not a calibrated sampled reflectance value.
for key,hexcode in [('zinc','#CFD3D1'),('plaster','#D9DFD8')]:
    mat=material(key);rgb=linear(hexcode);mat.diffuse_color=(*rgb,1);mat['photo_palette_hex']=hexcode
    p=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value=(*rgb,1)
    for ramp in [n for n in mat.node_tree.nodes if n.type=='VALTORGB']:
        ramp.color_ramp.elements[0].color=(*(x*.82 for x in rgb),1)
        ramp.color_ramp.elements[1].color=(*(min(1,x*1.14) for x in rgb),1)
    if key=='zinc':p.inputs['Metallic'].default_value=.25;p.inputs['Roughness'].default_value=.48

grass=material('grass');nodes=grass.node_tree.nodes;links=grass.node_tree.links
p=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
coords=next(n for n in nodes if n.type=='TEX_COORD')
macro=nodes.new('ShaderNodeTexNoise');macro.inputs['Scale'].default_value=.013
macro.inputs['Detail'].default_value=5;macro.inputs['Roughness'].default_value=.75
links.new(coords.outputs['Object'],macro.inputs['Vector'])
ramp=nodes.new('ShaderNodeValToRGB');ramp.label='Photo ground: scrub / green / dry grass / exposed soil'
stops=[(.20,'#3B5127'),(.40,'#596C2E'),(.54,'#7F8645'),(.63,'#9F9660'),(.76,'#B7A177')]
for i,(pos,col) in enumerate(stops):
    e=ramp.color_ramp.elements[i] if i<2 else ramp.color_ramp.elements.new(pos)
    e.position=pos;e.color=(*linear(col),1)
links.new(macro.outputs['Fac'],ramp.inputs[0]);links.new(ramp.outputs['Color'],p.inputs['Base Color'])
for key in ('soil','drygrass'):
    mat=material(key);p=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    rr=next(n for n in mat.node_tree.nodes if n.type=='VALTORGB')
    rr.color_ramp.elements[0].color=(*linear('#617137'),1)
    rr.color_ramp.elements[0].position=.34
    rr.color_ramp.elements[1].color=(*linear('#B5A078'),1)
    rr.color_ramp.elements[1].position=.64
    nn=next(n for n in mat.node_tree.nodes if n.type=='TEX_NOISE');nn.inputs['Scale'].default_value=.035

water=material('water');p=next(n for n in water.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
p.inputs['Metallic'].default_value=.12;p.inputs['Roughness'].default_value=.13
noise=next(n for n in water.node_tree.nodes if n.type=='TEX_NOISE');noise.inputs['Scale'].default_value=.18
bump=next(n for n in water.node_tree.nodes if n.type=='BUMP');bump.inputs['Distance'].default_value=.7;bump.inputs['Strength'].default_value=.6
for key in ['leaf'+str(i) for i in range(6)]:
    mat=material(key);nodes=mat.node_tree.nodes;links=mat.node_tree.links
    p=next(n for n in nodes if n.type=='BSDF_PRINCIPLED');p.inputs['Roughness'].default_value=.86
    coords=nodes.new('ShaderNodeTexCoord');noise=nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value=2.4;noise.inputs['Detail'].default_value=3
    links.new(coords.outputs['Object'],noise.inputs['Vector'])
    bump=nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.32;bump.inputs['Strength'].default_value=.55
    links.new(noise.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],p.inputs['Normal'])

# Perspective camera crop follows the approved composition, not a centered map tile.
poses={'GH':((40,140,0),(780,-1180,650)),
       'EI':((0,190,0),(850,-1500,1100)),
       'IN':((-20,180,0),(750,-1250,850)),
       'RD':((0,260,0),(1000,-1700,1260))}
for zone,(target,eye) in poses.items():
    cam=bpy.data.objects['V3_'+zone+'_overview'];cam.location=eye
    cam.rotation_euler=(Vector(target)-Vector(eye)).to_track_quat('-Z','Y').to_euler();cam.data.lens=42
    scene=activate(zone);scene['review_adjustments']='tighter GH hall spacing; secondary wings; multi-scale ground palette; lower perspective view'
    # Reduce subpixel triangle density without replacing the five crown morphologies.
    obj=bpy.data.objects['V3_'+zone+'_MIXED_VEGETATION']
    if zone=='GH':
        # Clear whole connected crown/branch pieces from the newly occupied footprints.
        bounds=[(s['x']-s['w']/2-3,s['x']+s['w']/2+3,s['y']-s['d']/2-3,s['y']+s['d']/2+3)
                for s in gh['buildings'] if s['id'] in ('GH_H03','GH_H04','GH_H05')]
        bm=bmesh.new();bm.from_mesh(obj.data);seen=set();remove=[]
        for root in bm.verts:
            if root in seen:continue
            stack=[root];seen.add(root);component=[]
            while stack:
                vertex=stack.pop();component.append(vertex)
                for edge in vertex.link_edges:
                    other=edge.other_vert(vertex)
                    if other not in seen:seen.add(other);stack.append(other)
            xmin=min(v.co.x for v in component);xmax=max(v.co.x for v in component)
            ymin=min(v.co.y for v in component);ymax=max(v.co.y for v in component)
            if any(xmin<b and xmax>a and ymin<d and ymax>c for a,b,c,d in bounds):remove.extend(component)
        bmesh.ops.delete(bm,geom=remove,context='VERTS');bm.to_mesh(obj.data);bm.free()
        obj['pruned_canopy_vertices_after_spacing_review']=len(remove)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    modifier=obj.modifiers.new('Review canopy triangle budget','DECIMATE');modifier.ratio=.58
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj['canopy_decimation_ratio']=.58
    scene.cycles.samples=48
activate('GH')
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-reference-v3.blend',compress=True)
print('Second review refinements and canopy budget optimization saved.')

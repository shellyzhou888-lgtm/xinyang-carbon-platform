# Pass 2 only after all four greybox renders have been reviewed.
scene=bpy.context.scene
scene['workflow_stage']='03_structural_refinement'
scene['greybox_review']='2026-10-22: reviewed all four rendered greyboxes before structural refinement'
proxies=[o for o in bpy.data.objects if 'kind' in o]
for ob in proxies:
    zone=ob['zone_id']
    kind=ob['kind']
    x,y,w,d,h=[ob[k] for k in ('local_x','local_y','width','depth','height')]
    name=ob.name
    ob['structural_pass']='reference-led roof / annex / setbacks; no random distortion'
    if kind in ('workshop','electronic_hall'):
        bay_count=4 if kind=='workshop' and w>150 else 1
        roof(name+'_roof',x,y,w+.8,d+.8,h,1.7 if kind=='workshop' else 1.0,bay_count,zone)
        ob['roof_bays']=bay_count
        box(name+'_office',x-w/2+17,y-d/2-9,4.6,32,19,9.2,'body',zone)
        box(name+'_office_parapet',x-w/2+17,y-d/2-9,9.4,32.6,19.6,.5,'roof',zone)
        box(name+'_service',x+w/2-18,y+d/2+7,2.7,34,14,5.4,'body',zone)
        box(name+'_service_roof',x+w/2-18,y+d/2+7,5.6,35,15,.4,'roof',zone)
        box(name+'_plinth',x,y,.55,w+.15,d+.15,1.1,'base',zone)
        ob['asset_truth']='building-concepts/v1/01-green-home-views.png' if kind=='workshop' else 'building-concepts/v1/02-electronics-views.png'
    elif kind in ('multiwing','research_block'):
        # Coherent high / low linked volumes, a recessed gap and rooftop stair.
        box(name+'_low_wing',x-w/2-9,y+2,h*.32,22,d*.72,h*.64,'body',zone)
        box(name+'_setback',x+w*.09,y+d*.08,h+2.2,w*.70,d*.64,4.4,'body',zone)
        box(name+'_stair_core',x+w*.36,y+d*.28,(h+7)/2,w*.16,d*.24,h+7,'body',zone)
        box(name+'_roof_lip',x,y,h+.18,w+.7,d+.7,.36,'roof',zone)
        box(name+'_wing_roof',x-w/2-9,y+2,h*.64+.15,22.7,d*.72+.7,.3,'roof',zone)
        box(name+'_entry_canopy',x-w*.13,y-d/2-3,4.0,w*.36,7,.48,'roof',zone)
        box(name+'_base',x,y,.45,w+.2,d+.2,.9,'base',zone)
    elif kind in ('courtyard','village_context'):
        roof(name+'_pitched_roof',x,y,w+1.2,d+1.6,h,2.7 if kind=='courtyard' else 2.0,1,zone)
        box(name+'_stone_base',x,y,.4,w+.15,d+.15,.8,'base',zone)
        if kind=='courtyard':
            box('IN_hero_glass_wing',x+27,y-18,2.0,14,36,4,'body',zone)
            box('IN_hero_wing_roof',x+27,y-18,4.2,15.4,37,.4,'roof',zone)
            box('IN_hero_colonnade_roof',x+17,y-18,3.8,6.2,35,.5,'roof',zone)
            cubes('IN_hero_colonnade_columns',[(x+17,y-33+j*5,1.8,.35,.35,3.6) for j in range(7)],'wood',zone)
            cubes('IN_hero_entry_steps',[(x,y-41-j*1.4,.12*(5-j),9,1.4,.24*(5-j)) for j in range(5)],'paving',zone)
            ob['asset_truth']='building-concepts/v1/03-innovation-community-views.png'
            ob['truth_status']='approved_design_proposal_not_existing_building_claim'
    elif zone=='RA':
        box(name+'_roof',x,y,h+.25,w+.6,d+.6,.5,'roof',zone)
        if kind=='podium':
            box('RA_entry_canopy',3,-28,6.4,27,13,.8,'body',zone)
            cubes('RA_canopy_supports',[(-8,-32,3.1,.65,.65,6.2),(14,-32,3.1,.65,.65,6.2)],'base',zone)
            box('RA_entry_steps',3,-34,.3,32,8,.6,'paving',zone)
        if kind=='tower':
            box('RA_roof_service',x+2,y+2,h+1.9,15,16,3.3,'base',zone)
        ob['asset_truth']='building-concepts/v1/04-research-views.png'
        ob['placement']='separate asset library / parcel location unverified'

for zone in ('GH','EI','IN','RD','RA'):
    root(zone)['structural_refinement_complete']=True
show_zone('GH')
bpy.ops.wm.save_as_mainfile(filepath=OUT+'park-structural-v1.blend')
print(json.dumps({'stage':'structural_refinement_complete','objects':len(bpy.data.objects),
                  'proxy_buildings':len(proxies),'four_span_resolution':'GH uses exactly 4 parallel roof bays'},ensure_ascii=False))

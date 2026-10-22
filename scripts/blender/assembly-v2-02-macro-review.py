# Complete foreground / middle / background green masses BEFORE asset detail.
for zone,layout in LAYOUT['zones'].items():
    activate(zone)
    w,d=layout['extent']
    points=[]
    # Distant forest edge with deliberately nonuniform outline.
    for i in range(130):
        x=-w*.45+(i%26)*w*.9/25+8*math.sin(i*2.1)
        y=d*.38+(i//26)*d*.019+12*math.sin(i*.9)
        if zone=='IN' and x>220:
            continue
        if zone=='RD' and y>1460:
            continue
        points.append((x,y,12+(i%6)))
    if zone=='IN':
        # Woodlands remain on land, rather than obeying red lines over water.
        for i in range(210):
            x=-820+(i%21)*32+7*math.sin(i*2)
            y=220+(i//21)*46+10*math.sin(i*.7)
            if abs(x+420)<45 or (abs(y-360)<100 and abs(x+180)<75):
                continue
            if 50<y<215 and x<-650:
                continue
            points.append((x,y,12+i%8))
        for i in range(80):
            points.append((-680+(i%16)*35,-700+(i//16)*36,10+i%5))
    else:
        for i in range(85):
            points.append((-w*.45+(i%17)*w*.9/16,-d*.42+(i//17)*26,11+i%5))
    green_batch(zone+'_MACRO_WOODLAND',points,zone)
    layout_count=len(layout['buildings'])
    bpy.context.scene['macro_building_groups']=layout_count
    bpy.context.scene['macro_tree_count']=len(points)
    render(zone,'overview',gray=True,width=1000,height=750)
activate('GH')
bpy.ops.wm.save_as_mainfile(filepath=OUT+'assembly-greybox-v2.blend')
print(json.dumps({'stage':'four_complete_park_greyboxes_rendered','objects':len(bpy.data.objects),
                  'review_scope':'all buildings, road hierarchy, compounds, reserve land, lake, foreground-middle-background vegetation'},ensure_ascii=False))

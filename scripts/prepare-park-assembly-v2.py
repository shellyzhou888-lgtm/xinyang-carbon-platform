"""Prepare auditable scene specifications. All 3D geometry is built in Blender MCP."""
import json
import math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/blender-models/v2'
OUT.mkdir(parents=True,exist_ok=True)
for folder in ('renders','greybox','models'):
    (OUT/folder).mkdir(exist_ok=True)
planning=json.loads((ROOT/'apps/web/data/planning-overlay.json').read_text(encoding='utf-8'))
keys={'GH':'green-home','EI':'electronics','IN':'innovation-community','RD':'research'}
names={'GH':'绿色家居产业园区','EI':'电子信息产业园区','IN':'科创部落','RD':'科创研发片区'}
zones={}
for key,pid in keys.items():
    f=next(f for f in planning['features'] if f['properties']['id']==pid)
    points=[p for polygon in f['geometry']['coordinates'] for p in polygon[0]]
    lon=(min(p[0] for p in points)+max(p[0] for p in points))/2
    lat=(min(p[1] for p in points)+max(p[1] for p in points))/2
    def local(p):
        return [round(math.radians(p[0]-lon)*6378137*math.cos(math.radians(lat)),2),
                round(math.radians(p[1]-lat)*6378137,2)]
    rings=[[local(p) for p in poly[0]] for poly in f['geometry']['coordinates']]
    zones[key]={'id':key,'name':names[key],'planning_id':pid,'planning_area_km2':f['properties']['areaKm2'],
                'display_origin_gcj02':[lon,lat],'planning_rings_local_m':rings,'buildings':[],
                'roads':[],'compounds':[],
                'placement_status':'approved_scene_concept_assembly; NOT registered building footprints',
                'planning_status':'approximate reference overlay; independent from concept layout; not legal/survey boundary'}

def road(z,name,points,width,role='secondary'):
    zones[z]['roads'].append({'id':name,'points':points,'width':width,'role':role})

def building(z,id,asset,x,y,rotation=0,scale=1,role='production'):
    zones[z]['buildings'].append({'id':id,'asset':asset,'x':round(x,2),'y':round(y,2),
                                  'rotation_deg':rotation,'scale':scale,'role':role,
                                  'status':'concept placement, dimensions unmeasured'})

def compound(z,id,x,y,w,d,south_road,role='industrial'):
    zones[z]['compounds'].append({'id':id,'x':x,'y':y,'w':w,'d':d,'role':role})
    road(z,id+'_entry',[[x,south_road],[x,y-d/2+35]],14,'access')

# All layout dimensions are a concept scaffold in metres, NOT measured roads.
zones['GH']['extent']=[4400,4100]
for i,x in enumerate((-1700,-700,350,1500)):
    road('GH','GH_NS_'+str(i),[[x,-1900],[x,1900]],34 if x==350 else 24,'primary' if x==350 else 'secondary')
for i,y in enumerate((-1450,-600,350,1300)):
    road('GH','GH_EW_'+str(i),[[-2050,y],[2050,y]],36 if y==-600 else 26,'primary' if y==-600 else 'secondary')
for r,(cy,entry) in enumerate(((-1025,-1450),(-125,-600),(825,350))):
    for c,cx in enumerate((-1200,-175,925)):
        ident=f'GH_C{r*3+c+1:02d}'
        vacant=(r,c) in ((0,2),(2,1))
        compound('GH',ident,cx,cy,850,650,entry,'reserve' if vacant else 'industrial')
        if vacant:
            continue
        for row in range(2):
            for col in range(3):
                asset='GH_B' if (r+c+row+col)%3==0 else 'GH_A'
                building('GH',ident+f'_H{row*3+col+1:02d}',asset,cx-275+col*275,cy-125+row*230,scale=1)
        if r==1 and c==1:
            building('GH',ident+'_PROCESS','GH_P',cx+270,cy+225,role='process_equipment')
for i,x in enumerate((-1940,-1500,-1100,-420,-30,200,620,1030,1320,1840)):
    building('GH',f'GH_CONTEXT_{i:02d}','GH_S',x,1660+55*(i%2),scale=.7,role='background')

zones['EI']['extent']=[2300,5200]
for i,x in enumerate((-820,-230,470,880)):
    road('EI','EI_NS_'+str(i),[[x,-2450],[x,2450]],34 if x==470 else 24,'primary' if x==470 else 'secondary')
for i,y in enumerate((-2150,-1250,-300,650,1600,2280)):
    road('EI','EI_EW_'+str(i),[[-1030,y],[1030,y]],26,'secondary')
for r,(cy,entry) in enumerate(((-1700,-2150),(-775,-1250),(175,-300),(1125,650),(1940,1600))):
    for c,cx in enumerate((-525,120)):
        ident=f'EI_C{r*2+c+1:02d}'
        compound('EI',ident,cx,cy,490 if c==0 else 580,700 if r<4 else 480,entry)
        if r in (0,4):
            for row in range(2):
                for col in range(2):
                    building('EI',ident+f'_H{row*2+col+1}','EI_A',cx-115+col*230,cy-150+row*300,scale=1 if r==0 else .86)
        else:
            for row in range(2):
                for col in range(3):
                    building('EI',ident+f'_M{row*3+col+1}','EI_M',cx-150+col*150,cy-145+row*290,
                             rotation=180 if row else 0,scale=1 if (row+col)%2 else 1.08,role='multiwing_court')
for i in range(5):
    building('EI',f'EI_EAST_{i}','EI_A',675,-1750+i*880,rotation=90,scale=.85,role='secondary_workshop')

zones['IN']['extent']=[1800,1700]
shore=[[-60,-800],[50,-680],[25,-550],[190,-440],[145,-300],[260,-180],
       [190,-40],[300,105],[250,250],[390,390],[340,540],[420,800]]
zones['IN']['shoreline']=shore
road('IN','IN_rural',[[-730,-800],[-620,-560],[-650,-320],[-505,-70],[-540,180],[-420,420],[-470,800]],9,'rural')
road('IN','IN_shore_path',[[p[0]-40,p[1]] for p in shore],4,'pedestrian')
for i,(x,y) in enumerate(((-150,-435),(-390,-25),(-180,360))):
    building('IN',f'IN_COURT_{i+1:02d}','IN_A',x,y,role='approved_courtyard_design_proposal')
    road('IN',f'IN_branch_{i}',[[-630 if i==0 else -505 if i==1 else -472.5,y-45],[x,y-45],
                               [90 if i==0 else 165 if i==1 else 275,y-45]],5,'access')
road('IN','IN_north_village',[[-437.5,600],[-745,600]],5,'access')
road('IN','IN_north_east_village',[[-443,650],[-170,650]],4,'access')
road('IN','IN_west_village',[[-530,130],[-745,130]],5,'access')
for i,(x,y) in enumerate(((-700,610),(-610,580),(-660,470),(-350,650),(-260,600),(-170,680),(-740,200),(-730,90),(-720,-20))):
    building('IN',f'IN_VILLAGE_{i:02d}','IN_S',x,y,rotation=0 if i%2 else 90,role='low_rise_context')

zones['RD']['extent']=[2200,3200]
for i,x in enumerate((-600,60,850)):
    road('RD','RD_NS_'+str(i),[[x,-1500],[x,1500]],40 if x==850 else 24,'primary' if x==850 else 'secondary')
for i,y in enumerate((-900,0,900)):
    road('RD','RD_EW_'+str(i),[[-1010,y],[1020,y]],28,'secondary')
for i,(cx,cy,entry) in enumerate(((-270,450,0),(450,450,0),(-270,1180,900),(440,1200,900),(-830,450,0))):
    compound('RD',f'RD_C{i+1:02d}',cx,cy,500 if i<4 else 330,580 if i<2 else 410,entry,'research_court')
    for j in range(3 if i<4 else 2):
        building('RD',f'RD_C{i+1:02d}_B{j+1}','RD_A' if j%2 else 'RD_B',cx+(j%2-.5)*170,cy-110+(j//2)*225,
                 rotation=0 if j%2 else 180,scale=1.0 if i%2 else 1.1,role='research_block')
zones['RD']['ponds']=[{'x':-860,'y':-1160,'rx':170,'ry':120},{'x':400,'y':-1280,'rx':170,'ry':100}]
for i,x in enumerate((-940,-810,-680,-490,-345,-200,-55,170,315,460,605,750)):
    building('RD',f'RD_CITY_{i:02d}','RD_A',x,1510,scale=.8 if i%2 else 1.15,role='distant_city_context')

data={'version':'v2','purpose':'four complete concept park assemblies from approved scene and asset directions',
      'user_instruction':'帮我组装成每个园区的完整建模','source_model':'assets/blender-models/v1/park-unified-v1.blend',
      'scene_truth':'assets/modeling-concepts/v2','asset_truth':'assets/building-concepts/v1; v1 same-mesh orthographic checks',
      'disclaimer':'Complete scene organisation; not surveyed full inventory or site-registered as-built reconstruction.',
      'zones':zones}
(OUT/'assembly-layout.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({z:{'extent':d['extent'],'building_groups':len(d['buildings']),'compounds':len(d['compounds']),
                      'roads':len(d['roads']),'planning_rings':len(d['planning_rings_local_m'])}for z,d in zones.items()},ensure_ascii=False))

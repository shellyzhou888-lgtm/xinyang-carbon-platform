"""Prepare reference-driven scene contracts; geometry is built only via Blender MCP."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/blender-models/v3'
ZONES = {}

def zone(key, size, target, eye, refs):
    ZONES[key] = dict(id=key, extent=size, target=target, eye=eye, references=refs,
                      buildings=[], roads=[], yards=[], ponds=[], reserves=[])

def building(z, key, kind, x, y, w, d, h, **extra):
    ZONES[z]['buildings'].append(dict(id=z+'_'+key, kind=kind, x=x, y=y, w=w, d=d,
                                     h=h, rotation=0, status='reference_interpretation_unmeasured', **extra))

def road(z, key, points, width, role='secondary'):
    ZONES[z]['roads'].append(dict(id=z+'_'+key, points=points, width=width, role=role))

def yard(z, x, y, w, d):
    ZONES[z]['yards'].append([x,y,w,d])

zone('GH', [1500,1400], [0,65,0], [1000,-1450,900], ['S04-04','S36-10','M09'])
road('GH','MAIN_EW',[[-900,-400],[900,-400]],28,'primary')
road('GH','MAIN_NS',[[-65,-850],[-65,950]],24,'primary')
road('GH','PROCESS_ACCESS',[[-65,-155],[680,-155]],16)
road('GH','NORTH_EW',[[-730,470],[730,470]],20)
road('GH','WEST_ACCESS',[[-590,-400],[-590,820]],14)
road('GH','EAST_ACCESS',[[610,-400],[610,820]],14)
for key,x,y,w,d,h,bays in [('H01',240,-280,330,112,12,4),('H02',-320,-230,390,124,11,4),
                          ('H03',-325,-45,360,116,12,4),('H04',-310,125,390,112,10,4),
                          ('H05',-350,320,300,104,12,4),('H06',180,345,220,92,10,3)]:
    building('GH',key,'hall',x,y,w,d,h,bays=bays,roof='zinc',doors='red')
    yard('GH',x,y,w+28,d+48)
building('GH','PROCESS','process',270,-15,260,144,15,roof='zinc')
yard('GH',270,-15,310,188)
building('GH','OFFICE1','office',465,-275,65,44,16,floors=4,facade='concrete')
building('GH','OFFICE2','office',-116,335,56,36,12,floors=3,facade='plaster')
building('GH','UTILITY','hall',520,190,100,50,7,bays=2,roof='blue',doors='red')
building('GH','SERVICE','office',115,195,62,32,8,floors=2,facade='plaster')
for i,(x,y,w,d) in enumerate([(-440,630,180,66),(-205,620,205,82),(145,620,240,100),
                             (425,600,180,80),(-510,820,140,55),(120,860,170,75),(400,820,115,60)]):
    building('GH','BACKGROUND'+str(i),'hall',x,y,w,d,7+i%3*2,bays=2+i%2,
             roof='blue' if i in (1,4) else 'zinc',doors='red',context=True)
    yard('GH',x,y,w+22,d+30)
ZONES['GH']['reserves']=[[370,235,160,90],[-420,-600,330,190],[20,785,120,100]]
ZONES['GH']['ponds']=[[-710,420,70,48],[710,510,80,55]]

zone('EI',[1050,1750],[0,220,0],[1120,-1650,1280],['S21-01','S21-05','M17','M19','M15'])
road('EI','BOULEVARD',[[-310,-1100],[-310,1350]],28,'primary')
road('EI','EAST_NS',[[310,-1100],[310,1350]],18)
for y in [-640,-230,155,520,890]:
    road('EI','CROSS'+str(y),[[-310,y],[310,y]],16 if y!=155 else 20)
road('EI','HALL_AISLE',[[-54,-640],[-54,-230]],20,'access')
for key,x,w,d in [('HALL_W',-146,155,310),('HALL_E',45,170,292)]:
    building('EI',key,'hall',x,-435,w,d,12,bays=3,roof='zinc',doors='red',ridge_axis='Y',front_office=True)
yard('EI',-30,-435,485,368)
building('EI','ADMIN','office',228,-475,74,52,16,floors=4,facade='concrete')
building('EI','GATE','office',226,-591,28,18,4,floors=1,facade='plaster')
ZONES['EI']['reserves']=[[-10,-35,530,305],[190,710,150,265]]
for key,x,y,w,d,h,kind in [('CAMPUS_W',-185,330,140,220,18,'campus'),
                          ('CAMPUS_E',100,330,190,220,22,'campus'),
                          ('ANNEX',-10,470,86,45,12,'office')]:
    building('EI',key,kind,x,y,w,d,h,floors=round(h/4),facade='plaster')
    yard('EI',x,y,w+20,d+28)
for i,(x,y,w,d) in enumerate([(-170,690,155,250),(35,655,160,170),(-170,1050,170,250),(80,1060,240,240)]):
    building('EI','LOGISTICS'+str(i),'hall',x,y,w,d,10+i%2*2,bays=3,
             ridge_axis='Y',roof='blue',doors='red')
    yard('EI',x,y,w+24,d+36)
for i,(x,y) in enumerate([(-525,-500),(-530,-60),(-535,390),(-515,880)]):
    building('EI','WEST_CONTEXT'+str(i),'hall',x,y,150+20*(i%2),74,8,bays=2,roof='zinc',context=True)
ZONES['EI']['rail']=[[405,-1250],[405,1500]]
ZONES['EI']['ponds']=[[-650,690,95,55]]

zone('IN',[1300,1400],[0,80,0],[1050,-1400,1000],['S40-05','S39-04','M03','M04'])
shore=[[-260,-950],[-160,-750],[30,-620],[95,-480],[35,-340],[190,-225],
       [120,-80],[280,65],[185,220],[320,375],[250,520],[410,730],[350,1100]]
ZONES['IN']['shoreline']=shore
road('IN','RURAL',[[-610,-1000],[-490,-730],[-560,-500],[-395,-250],[-445,10],[-325,340],[-390,700],[-270,1100]],8,'rural')
road('IN','WATERFRONT',[[x-34,y] for x,y in shore],3.5,'pedestrian')
for i,(x,y,w,d,variant) in enumerate([(-180,-440,62,48,'L'),(-130,-30,76,58,'U'),(-80,400,56,48,'paired')]):
    building('IN','COURT'+str(i),'courtyard',x,y,w,d,5.5,variant=variant,roof='tile')
    road('IN','BRANCH'+str(i),[[-460 if i==0 else -435 if i==1 else -338,y-45],[x,y-45],[x+105,y-38]],4.5,'access')
    yard('IN',x,y,w+16,d+16)
for i,(x,y) in enumerate([(-625,220),(-570,230),(-612,280),(-545,290),(-595,350),
                         (-430,640),(-360,610),(-340,680),(-270,660),(-290,730),
                         (-650,-650),(-620,-715),(-690,-720)]):
    building('IN','VILLAGE'+str(i),'village',x,y,19+(i%3)*5,13+i%2*5,5+(i%2)*2.6,
             roof='tile' if i%3 else 'terracotta',floors=1+i%2,context=True)
ZONES['IN']['ponds']=[[-550,-60,90,54],[-680,550,75,46],[-330,-690,62,35]]
ZONES['IN']['reserves']=[[-680,-400,140,185],[-220,220,150,150],[-210,820,190,140]]

zone('RD',[1500,1900],[10,260,0],[1250,-1700,1420],['M05','M06','M07','S32-08:material-only-unlocated'])
road('RD','ARTERIAL',[[500,-1350],[500,1500]],34,'primary')
road('RD','WEST_NS',[[-410,-1150],[-410,1500]],18)
road('RD','CENTRAL_NS',[[25,-50],[25,1500]],16)
for y in [-100,370,780,1170]:
    road('RD','CROSS'+str(y),[[-750,y],[500,y]],18)
# The southwest is intentionally undeveloped; compact clusters occupy individual parcels.
for i,(x,y) in enumerate([(-295,65),(-175,90),(-290,220),(-150,235)]):
    building('RD','MIDRISE'+str(i),'office',x,y,74+(i%2)*12,46,25+i%2*4,
             floors=6+i%2,facade='concrete',setback=True)
yard('RD',-225,160,300,355)
for i,(x,y) in enumerate([(135,0),(290,10),(135,125),(300,150),(145,270),(310,280)]):
    building('RD','BUSINESS'+str(i),'village',x,y,100 if i%2 else 80,42,10+(i%3)*2,
             floors=3,roof='terracotta' if i in (1,2,4) else 'tile')
yard('RD',230,145,385,385)
building('RD','CAMPUS_E','campus',265,575,350,295,20,floors=5,facade='plaster')
yard('RD',265,575,400,350)
building('RD','CAMPUS_W','campus',-215,590,250,280,24,floors=6,facade='concrete')
yard('RD',-215,590,300,340)
for i,(x,y,w,d) in enumerate([(-235,980,230,210),(180,960,270,200),(380,1110,100,70)]):
    building('RD','NORTH'+str(i),'campus' if i<2 else 'office',x,y,w,d,12+i*4,floors=3+i,facade='plaster')
    yard('RD',x,y,w+20,d+25)
for i in range(14):
    x=650+(i%3)*130; y=-420+(i//3)*370
    building('RD','CITY'+str(i),'office',x,y,65+(i%3)*12,42+i%2*10,24+(i%4)*10,
             floors=6+(i%4)*2,facade='concrete',context=True)
ZONES['RD']['ponds']=[[-520,-700,145,80],[-65,-630,122,62],[285,-850,110,65],[-650,350,100,68]]
ZONES['RD']['reserves']=[[-200,-370,380,240],[265,-370,300,240],[-210,-970,480,220]]

contract = dict(version='v3', source_project='assets/blender-models/v2/park-assemblies-v2.blend',
    scene_truth='assets/modeling-concepts/v2/', prior_approval='assets/blender-models/v1/approval.json',
    user_correction='间距太大，建筑同质化，绿植长的一模一样；配色没有仿真，参考实景照片来',
    scope='four complete concept compositions; unmeasured revision, not an as-built cadastral model',
    symmetry='None at district level. Structural bays and planted avenues retain functional repetition.',
    camera_contract='Perspective aerials of approved concepts; overhead is supplemental diagnostic, not hero view.',
    collision_contract='Outdoor visual review only. No walkable interiors or runtime navigation asserted.',
    budget=dict(paid_service_credits=0, target_triangles_per_scene=1500000, render_pixels=[1600,1000]),
    gates=dict(function='Existing approved scene directions; user explicitly authorized correction.',
               form='Pending user review of v3 renders; no progressive runtime export.', runtime='Not requested.'),
    zones=ZONES)
for folder in ('greybox','renders','review'):
    (OUT/folder).mkdir(parents=True,exist_ok=True)
(OUT/'scene-contract.json').write_text(json.dumps(contract,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({z:dict(buildings=len(d['buildings']),extent=d['extent']) for z,d in ZONES.items()}))

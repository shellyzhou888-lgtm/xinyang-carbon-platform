# 总览地图、企业坐标与语音形象

文档版本：v1.1（2026-10-20）

## 已接入

- 总览页面加入高德 JS API 2.0 底图与 AntV L7 企业点位、分布示意面；支持产业片区筛选、企业搜索与详情、标准/卫星底图、2D/3D 倾角、名称/分布图层开关及全屏。
- 默认使用高德在线卫星影像；新增“边界与建模资料”及OSM下载入口。尚未导入地理空间数据云DEM/影像，倾斜地图不代表已建立真实地形模型。
- “3D 能耗”视图使用 ECharts-GL 2.1.0，根据当前年份的数据库企业能耗排序绘制柱体，点击柱体与企业详情联动；没有数据或浏览器没有 WebGL 时给出提示。沿用总览的模拟数据标识，不将地图来源的真实位置等同于能耗实测数据。
- 企业坐标导出为带 `coordinateSystem: GCJ-02` 的 GeoJSON 结构。它不是 RFC 7946 默认的 WGS84；用于其他 GIS 前需要明确坐标转换，不能直接当作 GPS 经纬度。
- 小云形象改用 `/mascots/carbon-cloud/animation.gif`。现用 SDK 没有公开的头像参数，因此在本项目拥有的挂载容器中向其开放 Shadow DOM 注入样式；保留原有点击、拖动、麦克风、键盘、字幕和会话逻辑。系统减少动态效果时使用同目录 `poster.png`。升级 SDK 后需要复核 `.xy-character-button` 等选择器。

## 配置与密钥

参考 `C:\Users\53472\Desktop\课题组项目\10.10能碳系统\platform` 的高德配置，将三个 `AMAP_*` 配置项复制至本项目被 Git 忽略的 `apps/web/.env.local`，没有复制其他项目的数据库或模型凭据。

`apps/web/.env.example` 是不含密钥的样例。`/api/map/config` 只返回公开 Web JS Key 和同源代理地址；`AMAP_SECURITY_JS_CODE`、`AMAP_WEB_SERVICE_KEY` 不下发。`/_AMapService` 仅转发当前使用的样式和 SDK 初始化日志服务，不提供任意网址或通用地点查询代理。

配置方式依据[高德官方安全密钥文档](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)。JS Key 出现在地图脚本地址中是该 API 的正常机制；部署到新域名时应在高德控制台核对域名和服务配额。

## 10 家企业点位

坐标来自 2026-10-20 高德公开 POI 查询，顺序为经度、纬度，坐标系为 GCJ-02。保留六位小数便于复现，**小数位数不代表测绘精度**。这些是企业、园区或楼栋 POI，不是企业用地红线拐点。

| 编码 | 企业 | 经度 | 纬度 | 位置依据与注意事项 |
| --- | --- | --- | --- | --- |
| E_WANHUA | 万华生态（信阳） | 114.120979 | 32.230438 | [万华禾香信阳项目](https://www.amap.com/detail/B0IRRDEV5J)，工业大道8号；排除了工十四路旧厂 |
| E_ZHUMEI | 现代筑美 | 114.112181 | 32.227813 | [河南省现代筑美家居有限公司](https://www.amap.com/detail/B0FFK7OSG4)，工业大道8号 |
| E_YADAN | 亚丹生态 | 114.132880 | 32.209995 | [亚丹生态科技（信阳）有限公司](https://www.amap.com/detail/B0JDAA6RW8)，纬北五路西段 |
| E_YONGHAOXUAN | 永豪轩家居 | 114.138782 | 32.220290 | [河南永豪轩智能家居股份有限公司](https://www.amap.com/detail/B0FFH9O305)，与原档案历史名称不同，需企业复核对应关系 |
| E_TIANYI | 天一美家 | 114.137183 | 32.209298 | [天一美家园区](https://www.amap.com/detail/B0FFG4050S)，品牌园区内有多家租户 |
| E_BAIDE | 百德实业 | 114.132155 | 32.208401 | [信阳百德实业有限公司](https://www.amap.com/detail/B0H33ZT833)，排除同名超市 |
| E_GUMAI | 谷麦光电 | 114.066850 | 32.175422 | [谷麦科技集团园区](https://www.amap.com/detail/B0FFI03U3F)，子公司与母公司共址，尚无独立厂房红线 |
| E_JINSHANG | 今上半导体 | 114.068481 | 32.183924 | [今上半导体（信阳）有限公司](https://www.amap.com/detail/B0H02ZCRG5)，富民路6号 |
| E_XINGYUAN | 星原智能 | 114.068544 | 32.189136 | [信阳星原智能科技有限公司](https://www.amap.com/detail/B0I6YHW0PP)，产业园内企业POI |
| E_QINJIE | 螓杰智能 | 114.068975 | 32.188725 | [河南螓杰智能科技有限公司](https://www.amap.com/detail/B0IUJZL7XC)，电子信息智能产业园7号楼 |

政府及企业资料作身份和区位交叉核对：[信阳市委组织部产业报道](https://www.hnxydj.gov.cn/s/youhuayingshanghuanjing/2024-02-02/8543.html)、[电子信息产业园企业走访](https://www.xystrm.com/news/show.php?itemid=661)、本地谷麦招股书（注册地址及生产经营地富强路1号）。POI 命名不自动修改数据库法人名称。

## 边界核查结果

**新增资料优先于以下早期检索结论**：已核对豫政办〔2023〕26号原始附件第149行：信阳经开区围合面积2634.29公顷、规划建设用地1556.30公顷，列3个四至片区；没有界址拐点坐标。用户上传的 `含边界信息.pdf` 第13/152页提供规划说明及4个功能片区图，仅作辅助。用户补充的11.7km²已与2020年设立通知扫描件核对，保留为历史口径。完整对照、OSM实际覆盖与DEM获取条件见 [边界与地形核查](terrain-and-osm-assessment.md)。

本次检查了 `reference/park-energy-carbon-model.docx`、`reference/requirements-notes.doc`、`reference/park-system-ui-fields.doc`、原方案、政策与数据清单，并检索 `storage/research/2026-10-20/` 中的谷麦招股书、高企名单和永豪轩采购资料。未找到可用于逐企业描边的测绘红线、界址坐标表、CAD、SHP 或 KML。当前10家样本企业并不等于园区完整企业名录。

网上检索到[信阳市产业集聚区（羊山片区）洪水影响评价报告](https://oss.xinyang.gov.cn/xinyang_shuiliju/ueditor/php/upload/file/20221008/1665219930541964.pdf)的已索引文字，描述2012年规划总面积30.01km²、2013年家居小镇15.16km²及四至。原PDF本次访问403；它与现有材料的11.7/15.6km²等历史口径不一致，也未核实当前经开区红线和金牛片区纳入批复，因此没有把这些文字硬转成现行园区边界。

**当前两片面仅为企业分布范围**：对已定位的6家家居企业、4家电子企业分别计算凸包，向外扩展约220米，方便地图取景和分组展示。数据标记 `geometryPurpose: distribution_envelope`、`notLegalBoundary: true`；企业档案标记 `boundaryStatus: unavailable`、`boundary: null`。页面和坐标导出均保留这个说明。不能把该范围用于用地面积、统计边界、碳核算归属或申报。

要形成准确厂界，需要26号文划定成果的界址几何、各企业或共用产业园的用地/租赁总平图、界址坐标及原始坐标系。取得后应按企业编码版本化录入，而不是围绕POI画任意矩形。

## 数据和程序位置

| 文件 | 用途 |
| --- | --- |
| `data/geography/amap-poi-research.json` | 不含密钥、电话和照片的公开POI候选证据 |
| `apps/web/data/park-geography.json` | 人工核对的企业编码、POI、坐标、来源和分布范围 |
| `scripts/research-park-geography.py` | 读取本机Web服务Key，重新查询公开POI候选 |
| `scripts/build-park-geography.py` | 按已审核的POI ID生成前端地理数据，不自动批准边界 |
| `data/geography/boundary-authority.json` | 26号文四至、规划辅助图与2020年历史口径的结构化依据 |
| `apps/web/public/geography/` | OSM周边WGS84矢量、数量与来源清单、ODbL许可 |
| `scripts/prepare-osm-context.py` | 从本机OSM XML生成保留孔洞的GeoJSON，未自动绑定企业 |
| `apps/web/components/ParkSpatialOverview.tsx` | 高德地图、L7图层和企业交互 |
| `apps/web/components/EnterpriseEnergy3D.tsx` | 按需加载ECharts-GL的3D能耗视图 |

运行：`py -X utf8 scripts/research-park-geography.py`；指定关键词可追加/更新候选。确认POI ID后运行 `py -X utf8 scripts/build-park-geography.py`。修改候选不会自动改变生产数据。

依赖：ECharts-GL 2.1.0 与 ECharts 6兼容；L7 2.29.1使用独立高德、Scene与Layer入口。L7间接依赖的MapLibre旧版有已披露XSS问题，使用 `maplibre-gl ^6.15.0` override；本页面不加载MapLibre底图。安装后的 `npm audit` 为0个已知漏洞。

## 本次验证

- `npm run typecheck`、`npm run build`通过，`npm audit --omit=dev`为0个已知漏洞。
- 浏览器确认AMap+L7加载10家样本点位；4家电子/6家家居筛选、企业选择、卫星切换、2D/3D倾角、全屏、ECharts-GL及坐标导出可用。390px移动视口无页面横向溢出。
- 配置接口只下发公开Key及同源代理；未支持路径404、跨站来源403、非法JSONP回调400。
- OSM静态下载HTTP 200，759个要素编号唯一，多边形环闭合，保留7个内环；统计与manifest一致。边界记录几何保持空值，未将四至文字伪造为界址坐标。
- 吸碳云朵已在原小云控件内显示，原麦克风/会话按钮保留；本次没有为验证外观而录音或发送消息。
- 页面截图见 `docs/evidence/park-map-overview.png`、`park-energy-3d.png`、`park-map-sources.png`。截图中的高德卫星图只用于本次界面验证，不作为下载正射影像或测绘资料。

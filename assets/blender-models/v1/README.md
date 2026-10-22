# 园区 Blender 首轮模型 v1

用户于2026-10-22批准开始建模并要求统一色调。打开index.html查看四区场景、代表建筑近景、20张真实正交视图及4张整体灰模。

park-unified-v1.blend为完整可编辑工程，ZONE_GH/EI/IN/RD为四个场景研究样区，ZONE_RA为未核实地块位置的智慧岛独立资产。工程默认显示GH，可在Blender顶部Scene下拉中切换五个命名分区场景；它们共享网格数据。park-greybox-v1.blend、park-structural-v1.blend为阶段检查点。

GH/EI/IN/RD-v1.glb为各区样区模型，RA-v1.glb为独立资产。每个GLB已移回自身局部原点、米制、glTF Y向上；未完成地理配准。全部场景操作、保存、渲染、导出经真实MCP服务工具execute_blender_code，证据见mcp-audit.json。

统一暖灰白主体、低饱和蓝灰玻璃、深灰基座，工业建筑少量灰红点缀。四类代表资产为参考驱动的首次建模；建筑/道路数量与尺度为推定，科创院落为设计提案，不是实测或全部园区逐栋复原。玻璃及植被等使用简化材质/代理几何，没有照片级纹理。详情见../../../docs/park-blender-model-v1.md。

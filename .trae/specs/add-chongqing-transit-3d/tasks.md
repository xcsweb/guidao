# Tasks

- [x] Task 1: 项目脚手架与引擎引导
  - [x] SubTask 1.1: 初始化 Vite + React + TypeScript 工程，配置路径别名、构建脚本与严格模式
  - [x] SubTask 1.2: 建立 `src/engine`、`src/sim`、`src/ui`、`src/data`、`scripts` 目录与全局样式、页面骨架
  - [x] SubTask 1.3: 渲染器引导（WebGL2、场景、灯光、resize、销毁），确认空场景可运行
  - [x] SubTask 1.4: 数据加载器与分阶段加载进度、错误提示骨架

- [x] Task 2: 数据管线：重庆线网与地表要素
  - [x] SubTask 2.1: 实现下载器（断点续传、缓存、重试）与城市配置（bbox、中心、投影参数）
  - [x] SubTask 2.2: PBF 流式解析，提取 route 关系、轨道 way、车站节点、水系、桥梁、建筑
  - [x] SubTask 2.3: 几何处理：按关系拼线、方向修正、经纬度→局部米制投影、去重与抽稀
  - [x] SubTask 2.4: 输出 `network.json`（线路/车站/轨道几何/班次参数）与 `features.json`（水系/桥梁/走廊建筑）
  - [x] SubTask 2.5: 输出校验报告（线路数、车站数、范围、连续性、资产体积），异常返回非零退出码

- [x] Task 3: 地形高程烘焙
  - [x] SubTask 3.1: 下载 Terrarium 高程瓦片（全域基础层 + 主城加密层），带缓存
  - [x] SubTask 3.2: 解码为量化高程栅格（Int16/0.5m），输出 `terrain.bin` + 元数据（bbox/尺寸/高程范围）
  - [x] SubTask 3.3: 融合全域层与主城高精度层，生成分层 LOD 源数据
  - [x] SubTask 3.4: 高程校验（已知点位采样误差、空洞检测）

- [x] Task 4: 地形渲染（真实高程 + 无缝 LOD）
  - [x] SubTask 4.1: 高度图加载为 DataTexture，实现双线性采样与法线估算
  - [x] SubTask 4.2: 四叉树分块 LOD + 裙边 + 视锥剔除
  - [x] SubTask 4.3: 地形着色（高程色带、坡度光照、江岸过渡）
  - [x] SubTask 4.4: 高程夸张系数与地形/线网/相机联动

- [x] Task 5: 线网与地表要素渲染
  - [x] SubTask 5.1: 轨道带几何贴合地形，线路配色，选中高亮/其余淡化
  - [x] SubTask 5.2: 车站实例化渲染、标签 LOD、拾取与信息面板
  - [x] SubTask 5.3: 线路聚焦飞行与线路范围计算
  - [x] SubTask 5.4: 水系、桥梁、走廊建筑图层（空间分块合并 + 视锥剔除）

- [x] Task 6: 列车模拟与实时数据接入
  - [x] SubTask 6.1: 班次表生成（区间运行时间、停站时长、发车频率、服务时段）
  - [x] SubTask 6.2: 模拟时钟、位置插值、停站与折返、时间倍率/暂停，保证无跳变
  - [x] SubTask 6.3: `RealtimeProvider` 抽象 + 模拟 Provider + HTTP Provider + 失败回退与来源标注
  - [x] SubTask 6.4: 列车实例渲染、车头朝向与灯光，对外提供列车查询（车次/线路/下一站/速度）

- [x] Task 7: 相机系统与列车跟随
  - [x] SubTask 7.1: 总览相机（阻尼、缩放边界、贴地防穿）
  - [x] SubTask 7.2: 跟随相机（车头位置、切线朝向、坡度俯仰、平滑、避免穿模）
  - [x] SubTask 7.3: 总览↔跟随平滑转场与退出恢复
  - [x] SubTask 7.4: 驾驶室 HUD（车次、线路、速度、下一站、距离、时钟）

- [x] Task 8: 中文界面与交互
  - [x] SubTask 8.1: 线路面板与列车列表（可一键跟随）
  - [x] SubTask 8.2: 时间倍率、画质档位、高程夸张、图层开关
  - [x] SubTask 8.3: 加载进度、错误提示、数据来源与 OSM/地形版权说明
  - [x] SubTask 8.4: 快捷键（空格/F/L/Esc）与基础响应式布局

- [x] Task 9: 性能优化与验证
  - [x] SubTask 9.1: 按需渲染、页面隐藏暂停、DPR 上限
  - [x] SubTask 9.2: 距离分级、标签/建筑 LOD、实例化与 draw call 收敛
  - [x] SubTask 9.3: 性能 HUD 与低帧率自动降级
  - [x] SubTask 9.4: 基准验证：视锥剔除前后 draw calls 对比、巡航帧率记录

- [x] Task 10: 扩展性与文档
  - [x] SubTask 10.1: 城市注册表 manifest 与数据 schema 定义
  - [x] SubTask 10.2: 引擎去城市化（城市参数全部来自 manifest）
  - [x] SubTask 10.3: README（构建、运行、数据来源、许可、接入实时源方式）

# Task Dependencies

- Task 2、Task 3 依赖 Task 1（目录与脚本约定）；两者可并行
- Task 4 依赖 Task 3
- Task 5 依赖 Task 2、Task 4
- Task 6 依赖 Task 2（可与 Task 4/5 并行开发核心逻辑）
- Task 7 依赖 Task 5、Task 6
- Task 8 依赖 Task 5、Task 6
- Task 9 依赖 Task 4–8
- Task 10 依赖 Task 5、Task 6

# 山城轨道 · 重庆轨道交通三维可视化

基于真实地形高程与 OpenStreetMap 线网数据的重庆轨道交通 3D 实时可视化：全线路网、列车运行、第一视角跟随，以及面向全国扩展的城市数据架构。

## 功能

- **全线路网**：环线、1、2、3、4、5、6、国博、9、10、18、江跳、璧铜等 14 条线路，278 座车站，按官方配色渲染
- **真实地形**：Terrarium DEM 烘焙的高程栅格，垂直比例默认 1:1，可调 0.5–3.0 夸张系数
- **列车运行**：班次表驱动的模拟实时（发车、区间加减速、停站、折返），显示下一站与到站倒计时
- **跟随视角**：跟随任意列车，以车头视角穿越江面、桥梁、隧道与高架，坡度随真实高程俯仰
- **性能优先**：地形四叉树 LOD、视锥/距离剔除、实例化、分块合并、按需渲染、DPR 上限与自动降级
- **可扩展**：城市清单 + 标准化数据包 + 可插拔实时数据源，新增城市无需修改渲染核心

## 快速开始

要求 Node.js 20+ 与 `curl`。

```bash
npm install
npm run dev        # http://localhost:5173
```

仓库已包含构建好的重庆数据包（`public/data/cq/`）。如需从零重建：

```bash
npm run build:data     # 下载 OSM 提取 + 高程瓦片，约 2 分钟（首次会缓存到 .cache/）
```

## 数据来源与许可

| 数据 | 来源 | 许可 |
| --- | --- | --- |
| 线网 / 车站 / 建筑 / 水系 | [OpenStreetMap](https://www.openstreetmap.org/copyright) 重庆省级提取（OSM France） | ODbL |
| 地形高程 | [Terrarium tiles](https://registry.opendata.aws/terrain-tiles/)（SRTM 等，AWS Open Data） | 见数据源说明 |
| 列车位置 | 班次表模拟 | 本项目生成 |

应用内左下角保留上述署名。列车位置为模拟数据，界面显示「模拟班次」；接入外部实时源后会显示来源与更新时间。

## 接入实时数据

设置环境变量后启动：

```bash
VITE_REALTIME_URL=https://your-endpoint.example.com/trains npm run dev
```

接口返回 JSON（GET，建议 5 秒轮询）：

```json
{
  "asOf": 1760000000000,
  "source": "重庆轨道实时适配器",
  "trains": [
    {
      "id": "1-0-1760000000",
      "lineId": "1",
      "direction": 0,
      "distanceAlong": 12345,
      "speedKph": 42.5,
      "nextStationId": "st-12",
      "etaSec": 95
    }
  ]
}
```

- `distanceAlong`：沿线路正向（`direction=0`）的米制里程；`direction=1` 时按反向里程计算
- 拉取失败或数据为空时自动回退到模拟班次，并在界面标注
- 重庆轨道交通暂无公开实时接口，本项目不内置未授权的第三方数据源

## 数据包与扩展城市

```
public/data/
  cities.json              # 城市注册表（渲染核心只认这个文件）
  cq/
    manifest.json          # 城市元数据、投影、资产索引、统计
    network.json           # 线路几何、车站、班次参数
    terrain.json + *.bin   # 分层高程栅格（Int16 / 0.5m）
    features.json          # 水系、建筑索引
    buildings.bin          # 建筑体块（x,z,半宽,半深,高,旋转）
```

新增城市：复制 `scripts/cities/cq.json` 为新的城市配置（bbox、PBF 地址、地形层级），执行
`node scripts/build-data.mjs --city=<id>`，构建脚本会自动写入 `cities.json`。渲染引擎的所有
坐标、配色、线路与班次参数均来自 manifest 与数据包，不含重庆硬编码（城市默认视距由数据范围推导）。

## 架构

```
src/
  data/      加载与类型（manifest / network / terrain / features）
  engine/    Terrain（四叉树 LOD）、LineGeometry、TransitLayer、BuildingLayer、WaterLayer、TrainLayer、相机
  sim/       班次表、模拟时钟、实时 Provider（HTTP + 回退）
  viewer/    Viewer 场景编排、渲染循环、交互 API、性能统计
  state/     轻量全局 store 与 ViewerApi 类型
  ui/        中文界面组件
scripts/     数据管线（PBF 解析、线路拼接、DEM 烘焙、校验报告）
```

### 性能策略

- 地形按四叉树分块，按屏幕空间误差选择 LOD，视锥与距离剔除，块间加裙边防裂缝
- 车站/列车使用 InstancedMesh，建筑按 3.5 km 空间分块合并并逐块剔除
- 画质档位控制 DPR（1 / 1.6 / 2）、地形精度、建筑距离与站点标签距离
- 标签页隐藏时暂停渲染与模拟推进；持续低帧率自动降级并在 HUD 提示

## 快捷键

| 按键 | 行为 |
| --- | --- |
| `Space` | 暂停 / 继续 |
| `F` | 跟随当前线路的第一班列车 |
| `L` | 显示 / 隐藏线路面板 |
| `Esc` | 退出跟随 / 关闭站点卡片 |

## 开发脚本

```bash
npm run dev          # 开发服务器
npm run build        # 类型检查 + 生产构建
npm run preview      # 预览构建产物
npm run build:data   # 重建数据包（含地形烘焙）
npm run build:data -- --skip-terrain   # 仅重建线网/建筑/水系
```

数据构建校验会检查：线路数、车站数、坐标范围、轨道连续性、车站序列；异常会写入
`public/data/cq/report.json` 并以非零退出码结束。

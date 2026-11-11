# 站台细节精修与线路近景可见性优化 Spec

## Why

上一轮已用无头 Blender 生成列车与地上站套件，但站台细节（地上站台设施、地下第一视角站台空间、地图近景地下出入口）仍有明显提升空间。同时，近景模式使用真实轨道几何，地下区间被地形遮挡，导致用户放大后线路「消失」，只有缩到全重庆总览才能看到线网，浏览体验不连贯。

## What Changes

- 继续用无头 Blender 精修**地上站**：站台雨棚、站台面与边缘、站厅、栏杆、座椅、导向标识、楼扶梯等部件，导出 GLB 并复用现有 `ModelKit` 加载链路替换程序化几何。
- 继续用无头 Blender 精修**地下站**：第一视角地下站台空间（站台板、安全门、墙顶、梁柱、导向、座椅、照明层次）与地图近景地下出入口（出入口亭、雨棚、扶梯、栏杆、标识柱），保持街面锚点与既有竖向剖面不变。
- 为**近景地下区间**提供「地下线路透视」显示：以线路色、关闭深度测试的半透明叠加渲染地下线路走向，使放大后仍能辨识线位；地上区间保持现状，不提供全图浮线。
- 在 UI 增加「地下线路透视」开关，默认开启；若验证发现视觉混乱或性能不可接受，则回退该叠加并保持现状。
- 通过真实浏览器截图验证地上站、地下站台、地下出入口与线路透视效果，完成后提交代码并部署。

## Impact

- Affected specs: `station-presentation`、`transit-3d-viewer`、`underground-line-visibility`
- Affected code: `scripts/blender/build_detail_models.py`、`public/models/*.glb`、`src/engine/ModelKit.ts`、`src/engine/StationDetailLayer.ts`、`src/engine/TunnelLayer.ts`、`src/engine/TransitLayer.ts`、`src/viewer/Viewer.ts`、UI 开关与状态
- Affected data: 沿用现有 `network.json` 与 DEM，不新增平行线路数据；不改动既有竖向剖面与站点锚点

## 非目标

- 不重做整条线路的地下空间或完整站厅室内场景。
- 不改变线路、站点归属、时刻数据与既有相机键位。
- 不为地上区间增加浮空叠加线，避免画面混乱。

## ADDED Requirements

### Requirement: Blender 精修地上站台细节

系统 SHALL 使用无头 Blender 生成地上站台高细节部件，并通过既有 `ModelKit` 加载链路在运行时替换对应实例化几何，加载失败时回退程序化几何。

#### Scenario: 地上站近景

- **WHEN** 用户近景查看地上站
- **THEN** 雨棚、站台、站厅及配套设施较上一版更精细，几何无破面、无明显穿插，实例化与视距剔除行为不变

### Requirement: Blender 精修地下站台与出入口

系统 SHALL 使用无头 Blender 生成地下第一视角站台细节与地图近景地下出入口部件，街面出入口、通风设施和标签仍位于地表，不随轨道下沉。

#### Scenario: 第一视角进入地下站

- **WHEN** 用户跟随列车进入地下站
- **THEN** 站台边界、安全门、墙顶、梁柱、导向、座椅和照明层次清晰，结构不侵入列车通行空间

#### Scenario: 地图近景地下出入口

- **WHEN** 用户近景查看地下站出入口
- **THEN** 出入口亭、雨棚、扶梯、栏杆和标识柱具有可辨识细节，且与街面高程一致

### Requirement: 近景地下线路透视显示

系统 SHALL 在近景（非总览）模式下，为地下区间提供可开关的线路色半透明叠加显示，关闭深度测试使其不被地形遮挡；地上区间不叠加。

#### Scenario: 放大查看地下线路

- **WHEN** 用户从全重庆视角放大到近景，且开关处于开启状态
- **THEN** 仍能辨识地下线路走向与线路色，不再出现线路完全消失的情况

#### Scenario: 关闭透视

- **WHEN** 用户关闭「地下线路透视」开关
- **THEN** 近景恢复现状，仅显示未被地形遮挡的真实轨道

#### Scenario: 总览模式

- **WHEN** 用户缩放到全重庆总览
- **THEN** 沿用既有抽象线网显示，透视叠加不重复叠加造成过亮或重影

### Requirement: 验证与部署

系统 SHALL 在完成后通过构建、既有断言与真实浏览器截图验证，并提交代码、推送 main 触发 GitHub Pages 部署。

#### Scenario: 完成交付

- **WHEN** 所有改动完成
- **THEN** `npm run build` 与 `npm run test:profile` 通过，截图确认效果，代码已提交且线上部署成功

## MODIFIED Requirements

### Requirement: 全线路网渲染

系统 SHALL 保留现有运营线路、配色、选中高亮和总览抽象线网；近景在保留真实遮挡关系的基础上，为地下区间提供可开关的透视叠加，使用户在任意缩放级别都能辨识线路走向。

## REMOVED Requirements

无。若透视叠加验证效果不可接受，则仅回退该叠加显示，不移除任何既有能力。

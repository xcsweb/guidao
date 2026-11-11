# Tasks

- [ ] Task 1: 用 Blender 精修地上站台部件并接入运行时
  - [ ] SubTask 1.1: 扩展 `scripts/blender/build_detail_models.py`，细化雨棚、站台、站厅及栏杆、座椅、导向标识、楼扶梯等部件，导出更新后的 GLB
  - [ ] SubTask 1.2: 通过 `ModelKit` 与 `StationDetailLayer.applyDetailGeometry` 接入新部件，保持实例化与回退逻辑不变

- [ ] Task 2: 用 Blender 精修地下站台与地图近景出入口并接入
  - [ ] SubTask 2.1: 生成第一视角地下站台细节（站台板、安全门、墙顶、梁柱、导向、座椅、照明），接入 `TunnelLayer` 局部站台场景
  - [ ] SubTask 2.2: 生成地图近景地下出入口部件（出入口亭、雨棚、扶梯、栏杆、标识柱），接入 `StationDetailLayer` 的 metro 系列实例，保持街面锚点

- [ ] Task 3: 实现近景地下线路透视显示与开关
  - [ ] SubTask 3.1: 在 `TransitLayer` 为地下区间增加关闭深度测试的半透明线路色叠加，仅近景生效，总览不重复叠加
  - [ ] SubTask 3.2: 增加 UI「地下线路透视」开关并接入状态，默认开启；若截图验证效果不可接受则回退叠加并保持现状

- [ ] Task 4: 构建、断言、截图验证并提交部署
  - [ ] SubTask 4.1: 执行 `npm run build` 与 `npm run test:profile`
  - [ ] SubTask 4.2: 真实浏览器截取地上站、地下站台、地下出入口与线路透视效果，检查无破面、无遮挡异常、无控制台错误
  - [ ] SubTask 4.3: 提交代码、合并 main、推送并验证 GitHub Pages 部署成功（遵循 `guidao-commit-deploy` 技能）

# Task Dependencies

- Task 1 与 Task 2 可并行
- Task 3 可独立实施，与 Task 1、Task 2 并行
- Task 4 依赖 Task 1–3

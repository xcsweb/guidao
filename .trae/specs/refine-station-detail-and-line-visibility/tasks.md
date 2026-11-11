# Tasks

- [x] Task 1: 用 Blender 精修地上站台部件并接入运行时
  - [x] SubTask 1.1: 扩展 `scripts/blender/build_detail_models.py`，细化雨棚、站台、站厅及栏杆、座椅、导向标识、楼扶梯等部件，导出更新后的 GLB
  - [x] SubTask 1.2: 通过 `ModelKit` 与 `StationDetailLayer.applyDetailGeometry` 接入新部件，保持实例化与回退逻辑不变

- [x] Task 2: 用 Blender 精修地下站台与地图近景出入口并接入
  - [x] SubTask 2.1: 生成第一视角地下站台细节（站台板、安全门、墙顶、梁柱、导向、座椅、照明），接入 `TunnelLayer` 局部站台场景
  - [x] SubTask 2.2: 生成地图近景地下出入口部件（出入口亭、雨棚、扶梯、栏杆、标识柱），接入 `StationDetailLayer` 的 metro 系列实例，保持街面锚点

- [x] Task 3: 实现近景地下线路透视显示与开关
  - [x] SubTask 3.1: 在 `TransitLayer` 为地下区间增加关闭深度测试的半透明线路色叠加，仅近景生效，总览不重复叠加
  - [x] SubTask 3.2: 增加 UI「地下线路透视」开关并接入状态，默认开启；若截图验证效果不可接受则回退叠加并保持现状

- [x] Task 4: 实现地上/地下站台候车视角（上车前视角）
  - [x] SubTask 4.1: 在 `ViewerApi`、`Viewer` 与 `CameraController` 增加站台候车视角：相机位于站台候车区、站立人眼高度、面向轨道，支持环顾与退出恢复
  - [x] SubTask 4.2: 在地上站与地下站分别接入候车视角，复用既有站台几何与竖向锚点，确保能看到列车进站、停靠与出站
  - [x] SubTask 4.3: 在 UI 提供「站台候车视角」入口与退出按钮，与列车跟随视角并存且互不影响

- [x] Task 5: 引入许可明确的第三方模型补充细节
  - [x] SubTask 5.1: 寻找 CC0 / CC-BY 的站台设施、家具、标识等现成模型，记录来源链接、作者与许可
  - [x] SubTask 5.2: 将可用模型转换为 GLB 放入 `public/models/third-party/`，统一尺度与风格并接入对应图层；无合适资源时回退自建 Blender 模型

- [ ] Task 6: 构建、断言、截图验证并提交部署
  - [x] SubTask 6.1: 执行 `npm run build` 与 `npm run test:profile`
  - [x] SubTask 6.2: 真实浏览器截取地上站、地下站台、地下出入口、候车视角与线路透视效果，检查无破面、无遮挡异常、无控制台错误
  - [ ] SubTask 6.3: 提交代码、合并 main、推送并验证 GitHub Pages 部署成功（遵循 `guidao-commit-deploy` 技能）

- [x] Task 7: 修复候车环顾后退出时残余阻尼导致原视角偏移
  - [x] SubTask 7.1: 退出候车前清空 OrbitControls 残余旋转增量，确保恢复位置与进入前一致
  - [x] SubTask 7.2: 复验地上与地下站环顾退出恢复及既有相机交互

# Task Dependencies

- Task 1、Task 2、Task 3、Task 5 可并行
- Task 4 依赖 Task 1、Task 2 的站台几何与既有锚点，可与其并行开发、在其后验证
- Task 6 依赖 Task 1–5

# 开发与验证踩坑记录

记录《车站、轨道竖向与相机体验优化》这一轮开发中实际耗时较多的问题，供后续开发直接规避。
每条包含：现象 → 根因 → 正确做法。

## 一、环境与工具链

### 1. `npm run build` 全量报错

**现象**：`tsc` 找不到 `react`、`three` 的类型声明，Vite 无法解析依赖。

**根因**：仓库只有 `package-lock.json`，没有 `node_modules`。

**做法**：

```bash
npm ci --no-audit --no-fund
```

不要用 `npm install`，会改写锁文件导致无关差异。

### 2. Python Playwright 未安装

**现象**：`ModuleNotFoundError: playwright`。

**做法**：

```bash
python -m pip install playwright
```

### 3. `playwright install chromium` 下载超时

**现象**：多次超时，提高超时时间仍然很慢，浪费大量时间。

**根因**：沙箱网络受限，Chromium 包体积大。

**做法**：直接复用沙箱已有的 Chrome，不要重复下载：

```python
browser = p.chromium.launch(
    headless=True,
    executable_path='/root/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome',
    args=['--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
)
```

### 4. Chrome 启动报缺少 `libatk-1.0.so.0`

**根因**：系统运行库不全。

**做法**：

```bash
python -m playwright install-deps chromium
```

### 5. 软件 WebGL 帧率极低

**现象**：高画质下地形块可达 320 个，一次完整回归约十分钟；动画推进明显变慢。

**根因**：无 GPU，使用 SwiftShader。主循环有 `dt = Math.min(0.12, ...)` 的上限（[Viewer.ts](file:///workspace/src/viewer/Viewer.ts#L302)），所以低帧率时动画按"帧"推进而不是按真实时间。

**做法**：

- 回归脚本先用低画质、关闭建筑和水系、缩小视口做功能验证；只在需要视觉截图时切回高画质。
- 任何依赖动画完成的断言都必须等待状态，不要等待固定时长。

## 二、浏览器自动化：最容易造成"假失败"

### 6. 固定 `wait_for_timeout` 造成误判（本轮主要时间浪费点）

**现象**：首轮完整回归 19/21 通过，`station-left-click` 和 `follow-portal-transition-and-exit` 失败；单独复测同样场景却通过。

**根因**：

- 相机"退出跟随"恢复动画时长 1.1 秒（[CameraController.ts](file:///workspace/src/engine/CameraController.ts#L236-L248)），低帧率下 `dt` 被钳制，实际需要更多帧；`controls.enabled` 在动画结束后才恢复。
- 前一次拖拽的 OrbitControls 阻尼仍在衰减，站点标签还在缓慢移动，固定等待 900ms 后点击会打到标签外的位置。

**正确做法**：用 `wait_for_function` 等待可观测状态，而不是猜时间。

```python
# 等相机稳定
page.wait_for_function("""() => {
  const c = window.__viewer.cameraController;
  return c.flying === null && c.restoring === null && c.controls.enabled;
}""", timeout=30000)

# 等跟随相机高程与轨道 pose 一致
page.wait_for_function("""() => {
  const v = window.__viewer;
  const train = v.currentTrains.find(t => t.id === v.followId);
  if (!train || v.cameraController.followBlend < 1) return false;
  const geo = v.transit.geometries.get(train.lineId);
  const centerS = train.direction === 0 ? train.distance : geo.length - train.distance;
  const pose = v.trains.poseOf(train, v.transit.geometries);
  const cameraS = centerS + (train.direction === 0 ? 18.6 : -18.6);
  const tunnel = geo.isInsideTunnel(cameraS);
  const expected = pose.y * v.exaggeration + (tunnel ? 2.5 : 2.7);
  return Math.abs(v.camera.position.y - expected) < 0.08;
}""", timeout=30000)

# 等标签位置连续三帧稳定且命中 canvas
page.wait_for_function("""() => {
  const v = window.__viewer;
  const label = v.transit.labels.find(l => l.stationId === window.__stationId);
  const r = label.object.element.getBoundingClientRect();
  const previous = window.__probe;
  const stable = previous && Math.hypot(previous.x - r.x, previous.y - r.y) < 1;
  window.__probe = {x:r.x, y:r.y};
  return stable && label.object.visible && r.width > 0;
}""")
```

### 7. 站点点击排查要点

**现象**：点击标签中心后站点卡片没有出现，但日志显示标签曾可见。

**已知事实**：

- `.labels-layer`、`.station-label` 都是 `pointer-events: none`（[global.css](file:///workspace/src/styles/global.css#L168-L194)），事件实际落在 `canvas` 上。
- 选择逻辑在 [Viewer.ts](file:///workspace/src/viewer/Viewer.ts#L255-L286)：`pointerdown` 记录起点，`pointerup` 判断位移 ≤ 6px 才拾取；拾取依赖 CSS2D 标签的 `getBoundingClientRect()`（[TransitLayer.ts](file:///workspace/src/engine/TransitLayer.ts#L409-L441)）。

**排查顺序**（不要一上来就改源码）：

1. `document.elementFromPoint(x, y)` 是否等于 `canvas`；
2. `window.__viewer.pointerStart` 在 `pointerdown/up` 时是否形成并正确清空；
3. 直接调用 `transit.pickStation(...)` 能否返回目标站点 id；
4. 标签矩形中心与事件坐标是否一致（阻尼未停会让两者漂移）。

本轮结论：生产代码正确，失败只来自测试等待不足。

### 8. 洞口采样区间选错，导致"全部在隧道内"

**现象**：`follow-portal-transition-and-exit` 断言要求采样中同时存在洞内和洞外，但五次采样 `tunnel` 全为 `true`。

**根因**：测试以洞口 `s` 为基准取 `[-85, -28, 0, 28, 85]` 米；但这些采样点还要加上驾驶室偏移 18.6 米，而该洞口隧道区间只有约 209 米，负向采样仍落在区间内。断言本身失败，与相机高程无关（高程数值全部吻合）。

**正确做法**：

- 采样区间必须能跨过洞口边界，例如 `[-180, -140, -85, 0, 85, 140, 180]`；
- 断言中显式要求 `any(tunnel) and any(not tunnel)`，否则用例没有真正覆盖"进出洞"；
- 同时断言洞口附近高程连续、没有跳变。

### 9. 不要为了测试改生产数据

**做法**：固定列车位置只在浏览器运行时包装 `timetable.sample`，不改 `src` 和数据文件：

```javascript
const original = v.timetable.sample.bind(v.timetable);
v.timetable.sample = (time) => {
  const trains = original(time);
  if (!window.__config) return trains;
  const train = trains.find(t => t.id === ...);
  const geo = v.transit.geometries.get(config.lineId);
  train.direction = config.direction;
  train.distance = config.direction === 0 ? config.s : geo.length - config.s;
  return trains;
};
```

这样回归结果可复现，也不会污染生产逻辑。

### 10. 视觉截图要真的看

**做法**：截图只断言"文件大于 10KB"没有意义，必须逐张打开确认内容：

- 地上站：轨道与站台没有被地形掩埋；
- 街面出入口：模型高程等于 `groundY`，没有随轨道下沉；
- 洞口：开口、衬砌、两侧翼墙、短洞都在；
- 路堑：`renderHeightAt` 低于轨道面且可见槽底、边坡；
- 地下站台：安全门、梁柱、座椅、照明、站名齐全；
- 移动端：无横向滚动，提示文案切换为触摸版。

## 三、部署

### 11. 只推送功能分支不会更新站点

**根因**：[deploy-pages.yml](file:///workspace/.github/workflows/deploy-pages.yml) 只在 `push: branches: [main]` 或手动触发时运行。

**正确流程**：

```bash
git checkout main
git merge --ff-only trae/agent-h2r6t8   # 先确认可快进，避免无意义合并提交
git push origin main
```

### 12. 部署后要校验，不要只看"推送成功"

**做法**：

```bash
gh run list --repo xcsweb/guidao --limit 3
gh run watch <run-id> --repo xcsweb/guidao --exit-status
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' https://xcsweb.github.io/guidao/
```

注意：线上 JS 约 925KB，受限网络下用 `curl` 完整下载可能超时，这并不代表部署失败。校验资源可用 `-o /dev/null` 或先只看 HTTP 状态，必要时用 Range 请求。

## 四、已知但暂时不阻塞的告警

- Vite 提示 `vite.config.ts` 使用 `__dirname`，未来默认 `configLoader: 'native'` 会不兼容。后续可改为 `import.meta.dirname`。
- GitHub Actions 提示 Node.js 20 即将弃用，`checkout@v4` / `setup-node@v4` / `configure-pages@v5` / `upload-pages-artifact@v3` 被强制运行在 Node 24。属平台告警，不影响当前部署。

## 五、提交前检查清单

```bash
npm run build          # 类型检查 + 生产构建
npm run test:profile   # 竖向剖面 / 路堑 / 门户 / 资源断言
git diff --check       # 空白与冲突标记
git status --short     # 确认没有误改数据文件或生成物
```

回归通过标准：桌面与移动端控制台无错误；站点点击、进出洞、退出跟随、触摸手势、画质切换、重复进站资源数量稳定。

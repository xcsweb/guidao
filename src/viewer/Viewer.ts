import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { LoadedCity } from '@/data/loadCity';
import type { LineGeometry } from '@/engine/LineGeometry';
import type { LineSummary, Quality, TrainInfo } from '@/state/store';
import { store, lineSummaries } from '@/state/store';
import type { ViewerApi } from '@/state/api';
import type { StationData } from '@/data/types';
import { TerrainSystem } from '@/engine/Terrain';
import { TransitLayer } from '@/engine/TransitLayer';
import { StationDetailLayer } from '@/engine/StationDetailLayer';
import { TunnelLayer } from '@/engine/TunnelLayer';
import { BuildingLayer } from '@/engine/BuildingLayer';
import { WaterLayer } from '@/engine/WaterLayer';
import { TrainLayer } from '@/engine/TrainLayer';
import { CameraController } from '@/engine/CameraController';
import { VegetationLayer } from '@/engine/VegetationLayer';
import { Timetable, SimClock, initialSimTime, type SimTrain } from '@/sim/Timetable';
import { HttpRealtimeProvider, type ResolvedTrains } from '@/sim/Realtime';

const SKY_VERT = `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = `
varying vec3 vWorldPosition;
void main() {
  float h = normalize(vWorldPosition).y;
  vec3 horizon = vec3(0.32, 0.38, 0.42);
  vec3 zenith = vec3(0.05, 0.10, 0.16);
  vec3 below = vec3(0.10, 0.13, 0.14);
  vec3 col = mix(horizon, zenith, smoothstep(-0.02, 0.62, h));
  col = mix(below, col, smoothstep(-0.25, 0.05, h));
  gl_FragColor = vec4(col, 1.0);
}`;

export class Viewer {
  readonly api: ViewerApi;
  private canvas: HTMLCanvasElement;
  private loaded: LoadedCity;
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private root = new THREE.Group();
  private terrain: TerrainSystem;
  private transit: TransitLayer;
  private stationDetail: StationDetailLayer;
  private tunnel: TunnelLayer;
  private buildings: BuildingLayer;
  private vegetation: VegetationLayer;
  private water: WaterLayer;
  private trains: TrainLayer;
  private cameraController: CameraController;
  private timetable: Timetable;
  private clock: SimClock;
  private http: HttpRealtimeProvider | null = null;

  private exaggeration = 1;
  private quality: Quality = 'medium';
  private selectedLineId: string | null = null;
  private followId: string | null = null;
  private followMissCount = 0;
  private tunnelActiveView = false;
  private currentTrains: SimTrain[] = [];
  private resolved: ResolvedTrains | null = null;
  private running = false;
  private raf = 0;
  private lastFrame = 0;
  private fpsFrames = 0;
  private fpsElapsed = 0;
  private fps = 60;
  private uiTimer = 0;
  private slowTimer = 0;
  private autoDegraded = false;
  private resolutionScale = 1;
  private resolutionCooldown = 0;
  private fastTimer = 0;
  private frameIndex = 0;
  private toastTimer = 0;
  private pointerStart: { x: number; y: number } | null = null;
  private firstFrame = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, loaded: LoadedCity) {
    this.canvas = canvas;
    this.loaded = loaded;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setClearColor(0x0a1218, 1);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.2, 240000);
    this.scene.fog = new THREE.FogExp2(0x33424c, 0.000022);
    this.scene.add(this.root);
    this.root.add(new THREE.AmbientLight(0x597082, 0.5));

    const hemi = new THREE.HemisphereLight(0xb3c9dd, 0x2a3a2f, 1.0);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd9ad, 1.65);
    sun.position.set(-70000, 46000, 52000);
    this.scene.add(sun);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(210000, 32, 20),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    sky.frustumCulled = false;
    this.scene.add(sky);

    this.terrain = new TerrainSystem(loaded.manifest, loaded.terrainMeta, loaded.terrainBuffers);
    this.root.add(this.terrain.group);
    for (const station of loaded.network.stations) {
      station.elevation = Math.round(this.terrain.heightAt(station.x, station.z));
    }
    this.water = new WaterLayer(loaded.features.rivers, this.terrain);
    this.root.add(this.water.group);
    this.transit = new TransitLayer(loaded.network, this.terrain);
    this.root.add(this.transit.group);
    this.root.add(this.transit.labelGroup);
    this.stationDetail = new StationDetailLayer(
      loaded.network,
      this.transit.geometries,
      this.transit.stationPositions,
      window.innerHeight,
      this.camera.fov,
    );
    this.root.add(this.stationDetail.group);
    this.tunnel = new TunnelLayer();
    this.root.add(this.tunnel.group);
    this.buildings = new BuildingLayer(
      loaded.buildings,
      loaded.features.buildings.stride,
      this.terrain,
      (x, z) => this.transit.nearRail(x, z),
    );
    this.buildings.setQuality(this.quality);
    this.root.add(this.buildings.group);
    this.vegetation = new VegetationLayer(this.transit.geometries, this.terrain);
    this.vegetation.setQuality(this.quality);
    this.root.add(this.vegetation.group);
    this.trains = new TrainLayer();
    this.root.add(this.trains.group);

    const bounds = loaded.manifest.boundsLocal;
    const span = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
    this.cameraController = new CameraController(
      this.camera,
      canvas,
      this.terrain,
      [0, 0],
      span,
    );

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'labels-layer';
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.left = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    const parent = canvas.parentElement || document.body;
    parent.appendChild(this.labelRenderer.domElement);

    this.timetable = new Timetable(loaded.network, this.transit.geometries);
    this.clock = new SimClock(initialSimTime(loaded.network.service), 1, false);

    const url = (import.meta.env.VITE_REALTIME_URL as string | undefined) || '';
    if (url) {
      this.http = new HttpRealtimeProvider(url);
      this.http.start();
    }

    this.applyQuality(this.quality);
    this.resize();
    this.bindEvents();
    this.api = this.createApi();
    if (import.meta.env.DEV) {
      (window as unknown as { __viewer: Viewer }).__viewer = this;
    }

    const clock = this.clock.timeSec;
    store.reset({
      phase: 'loading',
      stage: '构建三维场景',
      progress: 100,
      registry: store.getSnapshot().registry,
      manifest: loaded.manifest,
      lines: lineSummaries(loaded.network.lines),
      sim: { timeSec: clock, multiplier: this.clock.multiplier, paused: false },
      source: { kind: 'simulated', label: '模拟班次', asOf: Date.now() },
      exaggeration: 1,
      quality: this.quality,
      service: loaded.network.service,
    });
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
  }

  private resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.labelRenderer.setSize(width, height);
    this.terrain.setViewport(height, this.camera.fov);
    this.stationDetail.resizeMetrics(height, this.camera.fov);
  };

  private onVisibility = (): void => {
    if (document.hidden) {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.clock.syncLast();
    } else if (!this.disposed) {
      this.lastFrame = performance.now();
      this.clock.syncLast();
      this.running = true;
      this.raf = requestAnimationFrame(this.loop);
    }
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.pointerStart = { x: event.clientX, y: event.clientY };
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pointerStart) return;
    const moved = Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y);
    this.pointerStart = null;
    if (moved > 6) return;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const station = this.transit.pickStation(this.camera, ndc);
    if (station) {
      store.patch({ station });
    } else {
      store.patch({ station: null });
    }
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.12, Math.max(0.0005, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.frameIndex++;

    this.clock.update(now);
    this.currentTrains = this.timetable.sample(this.clock.timeSec);
    if (this.http) {
      this.resolved = this.http.resolve(
        this.loaded.network,
        this.transit.geometries,
        this.currentTrains,
        Date.now(),
      );
      this.currentTrains = this.resolved.trains;
    } else {
      this.resolved = {
        trains: this.currentTrains,
        kind: 'simulated',
        label: '模拟班次',
        asOf: Date.now(),
        error: null,
      };
    }

    let tunnelActive = false;
    let cameraTunnel = false;
    let tunnelDepth = 0;
    let tunnelGeo: LineGeometry | null = null;
    let tunnelS = 0;
    let tunnelDirection: 0 | 1 = 0;

    if (this.followId) {
      const train = this.currentTrains.find((t) => t.id === this.followId);
      if (train) {
        this.followMissCount = 0;
        const pose = this.trains.poseOf(train, this.transit.geometries);
        if (pose) {
          const geo = this.transit.geometries.get(train.lineId) || null;
          const s = train.direction === 0 ? train.distance : (geo?.length || 0) - train.distance;
          if (geo) {
            const cameraS = s + (train.direction === 0 ? 18.6 : -18.6);
            cameraTunnel = geo.isInsideTunnel(cameraS);
            tunnelActive = geo.isInsideTunnel(s) || cameraTunnel;
            if (cameraTunnel) {
              const range = geo.tunnels.find(([a, b]) => cameraS >= a && cameraS <= b);
              if (range) tunnelDepth = Math.min(cameraS - range[0], range[1] - cameraS);
            }
            tunnelGeo = geo;
            tunnelS = s;
            tunnelDirection = train.direction;
          }
          this.cameraController.updateFollowPose(pose, cameraTunnel);
        }
      } else {
        this.followMissCount++;
        if (this.followMissCount > 30) {
          this.exitFollow();
          this.notify('所跟列车已到达终点，已退出跟随视角');
        }
      }
    }

    if (tunnelActive && tunnelGeo) {
      this.tunnel.update(tunnelGeo, tunnelS, tunnelDirection, true);
    } else {
      this.tunnel.update(null, 0, 0, false);
    }
    this.tunnelActiveView = cameraTunnel;
    this.transit.group.visible = !cameraTunnel;
    this.transit.labelGroup.visible = !cameraTunnel;
    this.stationDetail.group.visible = !cameraTunnel;
    this.trains.setLocalOnly(this.followId !== null);
    const layers = store.getSnapshot().layers;
    this.buildings.setVisible(!cameraTunnel && layers.buildings && this.quality !== 'low');
    this.water.setVisible(!cameraTunnel && layers.water);
    this.vegetation.setVisible(!cameraTunnel && this.quality !== 'low');

    this.cameraController.update(dt);

    const overview = this.camera.position.y / Math.max(0.5, this.exaggeration) > 5200;
    const deepTunnel = cameraTunnel && tunnelDepth > 120;
    this.terrain.group.visible = !deepTunnel;
    if (!deepTunnel) this.terrain.update(this.camera, now);
    if (!cameraTunnel) {
      if (this.frameIndex % 6 === 0) this.buildings.update(this.camera);
      if (this.frameIndex % 10 === 0) this.water.update(this.camera);
    }
    this.transit.setOverviewMode(overview);
    this.trains.setOverviewMode(overview);
    if (!cameraTunnel) {
      this.stationDetail.update(this.camera, overview);
      this.transit.setStationMarkersHidden(this.stationDetail.getDetailedStationIds());
      this.transit.update(this.camera);
    }
    this.trains.update(this.currentTrains, this.transit.geometries, this.camera);

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    if (!this.firstFrame) {
      this.firstFrame = true;
      store.patch({ phase: 'ready', stage: '就绪', progress: 100 }, true);
    }

    this.fpsFrames++;
    this.fpsElapsed += dt;
    if (this.fpsElapsed >= 0.5) {
      this.fps = this.fpsFrames / this.fpsElapsed;
      this.fpsFrames = 0;
      this.fpsElapsed = 0;
      this.evaluateAutoQuality(dt);
    }

    this.uiTimer += dt;
    if (this.uiTimer >= 0.25) {
      this.uiTimer = 0;
      this.pushUiState();
    }
  };

  private evaluateAutoQuality(dt: number): void {
    void dt;
    this.resolutionCooldown = Math.max(0, this.resolutionCooldown - 0.5);
    if (this.fps < 44 && this.resolutionCooldown === 0 && this.resolutionScale > 0.7) {
      this.resolutionScale = Math.max(0.7, this.resolutionScale - 0.12);
      this.resolutionCooldown = 3;
      this.fastTimer = 0;
      this.applyResolution();
    } else if (this.fps > 57) {
      this.fastTimer += 0.5;
    } else {
      this.fastTimer = 0;
    }
    if (this.fastTimer >= 6 && this.resolutionScale < 1) {
      this.resolutionScale = Math.min(1, this.resolutionScale + 0.08);
      this.fastTimer = 0;
      this.applyResolution();
    }

    if (this.fps < 38 && !this.clock.paused) {
      this.slowTimer += 0.5;
    } else {
      this.slowTimer = 0;
    }
    if (this.slowTimer > 5 && !this.autoDegraded && this.quality !== 'low') {
      this.autoDegraded = true;
      const next: Quality = this.quality === 'high' ? 'medium' : 'low';
      this.applyQuality(next);
      this.notify(`帧率偏低，已自动切换到「${next === 'medium' ? '中' : '低'}」画质`);
    }
  }

  private pushUiState(): void {
    const snapshot = store.getSnapshot();
    const nowSec = this.clock.timeSec;
    const trains: TrainInfo[] = this.currentTrains.map((t) => this.trainInfo(t));
    const followTrain = this.followId
      ? this.currentTrains.find((t) => t.id === this.followId) || null
      : null;
    const stationBoard = snapshot.station
      ? this.timetable.stationBoard(snapshot.station.id, nowSec, 2)
      : [];
    const lineBoard = this.selectedLineId
      ? this.timetable.lineBoard(this.selectedLineId, nowSec)
      : null;
    store.patch({
      trains,
      follow: followTrain ? this.trainInfo(followTrain) : null,
      stationBoard,
      lineBoard,
      sim: {
        timeSec: nowSec,
        multiplier: this.clock.multiplier,
        paused: this.clock.paused,
      },
      stats: {
        fps: Math.round(this.fps),
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        chunks: this.terrain.visibleChunks,
      },
      source: this.resolved
        ? {
            kind: this.resolved.kind,
            label: this.resolved.label,
            asOf: this.resolved.asOf,
          }
        : { kind: 'simulated', label: '模拟班次', asOf: Date.now() },
      followTunnel: this.tunnelActiveView,
    });
  }

  private trainInfo(t: SimTrain): TrainInfo {
    return {
      id: t.id,
      lineId: t.lineId,
      lineName: t.lineName,
      color: t.color,
      direction: t.direction,
      destination: t.destination,
      nextStation: t.nextStationName,
      etaSec: t.etaSec,
      speedKph: t.speedKph,
      distance: t.distance,
      progress: t.progress,
      code: t.code,
      status: t.status,
      nextArrivalSec: t.nextArrivalSec,
    };
  }

  private applyResolution(): void {
    const cap = this.quality === 'low' ? 1 : this.quality === 'medium' ? 1.5 : 1.75;
    const dpr = Math.max(
      0.75,
      Math.min(window.devicePixelRatio || 1, cap) * this.resolutionScale,
    );
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  private applyQuality(quality: Quality): void {
    this.quality = quality;
    this.resolutionScale = 1;
    this.resolutionCooldown = 2;
    this.applyResolution();
    this.terrain.setQuality(quality);
    this.buildings.setQuality(quality);
    this.vegetation.setQuality(quality);
    this.trains.setQuality(quality);
    this.stationDetail.setQuality(quality);
    this.tunnel.setQuality(quality);
    this.transit.setLabelDistance(quality === 'low' ? 6000 : quality === 'medium' ? 12000 : 20000);
    this.resize();
    store.patch({ quality });
  }

  private notify(message: string): void {
    store.patch({ toast: message });
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => store.patch({ toast: null }), 3200);
  }

  private createApi(): ViewerApi {
    return {
      selectLine: (id) => {
        if (this.followId) this.exitFollow();
        this.selectedLineId = id;
        this.transit.setSelected(id);
        if (!id) {
          this.cameraController.resetView();
        } else {
          const info = this.transit.getLineBounds(id);
          if (info) this.cameraController.flyTo(info.center, info.bounds);
        }
        store.patch({ selectedLineId: id });
      },
      flyToLine: (id) => {
        if (!id) {
          this.cameraController.resetView();
          return;
        }
        if (this.followId) this.exitFollow();
        const info = this.transit.getLineBounds(id);
        if (info) this.cameraController.flyTo(info.center, info.bounds);
      },
      followTrain: (id) => {
        const train = this.currentTrains.find((t) => t.id === id);
        if (!train) {
          this.notify('该班次已结束运行，请选择其他列车');
          return;
        }
        this.followId = id;
        this.followMissCount = 0;
        this.trains.setFollowedTrain(id);
        this.cameraController.enterFollow();
        store.patch({ follow: this.trainInfo(train) });
      },
      exitFollow: () => {
        this.exitFollow();
      },
      togglePause: () => {
        const paused = !this.clock.paused;
        this.clock.setPaused(paused);
        store.patch({ sim: { timeSec: this.clock.timeSec, multiplier: this.clock.multiplier, paused } });
      },
      setMultiplier: (value) => {
        this.clock.setMultiplier(value);
        store.patch({ sim: { timeSec: this.clock.timeSec, multiplier: value, paused: this.clock.paused } });
      },
      setQuality: (quality) => {
        this.autoDegraded = true;
        this.applyQuality(quality);
      },
      setExaggeration: (value) => {
        this.exaggeration = value;
        this.root.scale.y = value;
        this.terrain.setHeightScale(value);
        this.cameraController.setExaggeration(value);
        store.patch({ exaggeration: value });
      },
      setLayer: (key, value) => {
        if (key === 'buildings') this.buildings.setVisible(value);
        if (key === 'water') this.water.setVisible(value);
        if (key === 'labels') this.transit.setLabelsEnabled(value);
        if (key === 'trains') this.trains.group.visible = value;
        store.patch({ layers: { ...store.getSnapshot().layers, [key]: value } });
      },
      focusStation: (id) => {
        const station = this.loaded.network.stations.find((s) => s.id === id);
        if (!station) return;
        const pos = this.transit.stationPositions.get(id);
        if (!pos) return;
        if (this.followId) this.exitFollow();
        this.cameraController.flyToStation(pos.x, pos.z, pos.y);
        store.patch({ station });
      },
      resetView: () => {
        if (this.followId) this.exitFollow();
        this.selectedLineId = null;
        this.transit.setSelected(null);
        this.cameraController.resetView();
        store.patch({ selectedLineId: null, station: null });
      },
      setStatsVisible: (value) => store.patch({ statsVisible: value }),
      zoomBy: (factor) => this.cameraController.zoomBy(factor),
    };
  }

  private exitFollow(): void {
    this.followId = null;
    this.followMissCount = 0;
    this.trains.setFollowedTrain(null);
    this.trains.setLocalOnly(false);
    this.cameraController.exitFollow();
    store.patch({ follow: null, followTunnel: false });
  }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.toastTimer);
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.http?.stop();
    this.cameraController.dispose();
    this.terrain.dispose();
    this.transit.dispose();
    this.stationDetail.dispose();
    this.tunnel.dispose();
    this.buildings.dispose();
    this.vegetation.dispose();
    this.water.dispose();
    this.trains.dispose();
    this.renderer.dispose();
    this.labelRenderer.domElement.remove();
  }
}

export function currentStationLineNames(station: StationData, lines: LineSummary[]): string[] {
  return station.lines
    .map((id) => lines.find((l) => l.id === id)?.name)
    .filter((v): v is string => !!v);
}

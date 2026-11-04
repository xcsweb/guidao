import type { LineData, NetworkFile, ServiceConfig } from '@/data/types';
import { LineGeometry } from '@/engine/LineGeometry';

export interface SimTrain {
  id: string;
  lineId: string;
  lineName: string;
  color: string;
  direction: 0 | 1;
  destination: string;
  distance: number;
  speedKph: number;
  nextStationId: string;
  nextStationName: string;
  etaSec: number;
  progress: number;
  atStation: boolean;
  departedAt: number;
}

interface SegmentProfile {
  distance: number;
  vmax: number;
  tAccel: number;
  dAccel: number;
  tCruise: number;
  tTotal: number;
}

interface DirSchedule {
  stations: Array<{ id: string; name: string; s: number }>;
  segments: SegmentProfile[];
  arrivals: number[];
  departures: number[];
  duration: number;
  departuresAt: number[];
  line: LineData;
  direction: 0 | 1;
}

const ACCEL = 1.15;
const DWELL = 30;

function profileFor(distance: number, vmax: number): SegmentProfile {
  const dAccel = (vmax * vmax) / (2 * ACCEL);
  if (2 * dAccel >= distance) {
    const vpeak = Math.sqrt(ACCEL * distance);
    const tAccel = vpeak / ACCEL;
    return {
      distance,
      vmax: vpeak,
      tAccel,
      dAccel: distance / 2,
      tCruise: 0,
      tTotal: 2 * tAccel,
    };
  }
  const tAccel = vmax / ACCEL;
  const tCruise = (distance - 2 * dAccel) / vmax;
  return {
    distance,
    vmax,
    tAccel,
    dAccel,
    tCruise,
    tTotal: 2 * tAccel + tCruise,
  };
}

function posInProfile(p: SegmentProfile, t: number): { pos: number; speed: number } {
  if (t <= 0) return { pos: 0, speed: 0 };
  if (t >= p.tTotal) return { pos: p.distance, speed: 0 };
  if (t < p.tAccel) return { pos: 0.5 * ACCEL * t * t, speed: ACCEL * t };
  if (t < p.tAccel + p.tCruise) {
    return { pos: p.dAccel + p.vmax * (t - p.tAccel), speed: p.vmax };
  }
  const dt = p.tTotal - t;
  return { pos: p.distance - 0.5 * ACCEL * dt * dt, speed: ACCEL * dt };
}

function isPeak(service: ServiceConfig, t: number): boolean {
  return service.peakRanges.some(([a, b]) => t >= a && t <= b);
}

function buildSchedule(
  line: LineData,
  geometry: LineGeometry,
  service: ServiceConfig,
  direction: 0 | 1,
): DirSchedule {
  const baseStations = geometry.stations.map((s) => ({ id: s.id, name: s.name, s: s.s }));
  if (geometry.closedLoop && baseStations.length > 1) {
    baseStations.push({
      id: baseStations[0].id,
      name: baseStations[0].name,
      s: geometry.length,
    });
  }
  const stations =
    direction === 0
      ? baseStations
      : baseStations
          .slice()
          .reverse()
          .map((s) => ({ ...s, s: geometry.length - s.s }));

  const vmax = (line.speedKph || 36) * 1000 / 3600;
  const segments: SegmentProfile[] = [];
  const arrivals: number[] = [0];
  const departures: number[] = [0];
  for (let i = 0; i < stations.length - 1; i++) {
    const d = Math.max(12, stations[i + 1].s - stations[i].s);
    const profile = profileFor(d, vmax);
    segments.push(profile);
    const arrival = departures[i] + profile.tTotal;
    arrivals.push(arrival);
    const isLast = i + 1 === stations.length - 1;
    departures.push(arrival + (isLast ? 0 : DWELL));
  }
  const duration = Math.max(60, arrivals[arrivals.length - 1]);

  const departuresAt: number[] = [];
  let t = service.startSec;
  while (t <= service.endSec) {
    departuresAt.push(t);
    const headway = isPeak(service, t) ? service.headwayPeakSec : service.headwayOffSec;
    t += headway;
  }

  return {
    stations,
    segments,
    arrivals,
    departures,
    duration,
    departuresAt,
    line,
    direction,
  };
}

export class Timetable {
  readonly schedules = new Map<string, [DirSchedule, DirSchedule]>();
  private service: ServiceConfig;

  constructor(network: NetworkFile, geometries: Map<string, LineGeometry>) {
    this.service = network.service;
    for (const line of network.lines) {
      const geo = geometries.get(line.id);
      if (!geo) continue;
      this.schedules.set(line.id, [
        buildSchedule(line, geo, this.service, 0),
        buildSchedule(line, geo, this.service, 1),
      ]);
    }
  }

  sample(timeSec: number): SimTrain[] {
    const out: SimTrain[] = [];
    for (const [lineId, pair] of this.schedules) {
      for (const schedule of pair) {
        const { departuresAt, duration } = schedule;
        for (const dep of departuresAt) {
          if (timeSec < dep || timeSec >= dep + duration) continue;
          const train = this.trainAt(schedule, timeSec - dep, dep);
          if (train) out.push(train);
        }
      }
      void lineId;
    }
    return out;
  }

  private trainAt(schedule: DirSchedule, t: number, departedAt: number): SimTrain | null {
    const { stations, segments, arrivals, departures, line } = schedule;
    if (t <= 0 || t >= schedule.duration) return null;
    for (let i = 0; i < segments.length; i++) {
      if (t < departures[i]) {
        // still dwelling at station i
        const next = stations[Math.min(stations.length - 1, i + 1)];
        const eta = Math.max(0, arrivals[i + 1] - t);
        return {
          id: `${line.id}-${schedule.direction}-${departedAt}`,
          lineId: line.id,
          lineName: line.name,
          color: line.color,
          direction: schedule.direction,
          destination: stations[stations.length - 1].name,
          distance: stations[i].s,
          speedKph: 0,
          nextStationId: next.id,
          nextStationName: next.name,
          etaSec: eta,
          progress: stations[i].s / Math.max(1, line.length),
          atStation: true,
          departedAt,
        };
      }
      if (t < arrivals[i + 1]) {
        const local = t - departures[i];
        const { pos, speed } = posInProfile(segments[i], local);
        const distance = stations[i].s + pos;
        const next = stations[i + 1];
        return {
          id: `${line.id}-${schedule.direction}-${departedAt}`,
          lineId: line.id,
          lineName: line.name,
          color: line.color,
          direction: schedule.direction,
          destination: stations[stations.length - 1].name,
          distance,
          speedKph: speed * 3.6,
          nextStationId: next.id,
          nextStationName: next.name,
          etaSec: Math.max(0, arrivals[i + 1] - t),
          progress: distance / Math.max(1, line.length),
          atStation: false,
          departedAt,
        };
      }
    }
    const last = stations[stations.length - 1];
    return {
      id: `${line.id}-${schedule.direction}-${departedAt}`,
      lineId: line.id,
      lineName: line.name,
      color: line.color,
      direction: schedule.direction,
      destination: last.name,
      distance: last.s,
      speedKph: 0,
      nextStationId: last.id,
      nextStationName: last.name,
      etaSec: 0,
      progress: 1,
      atStation: true,
      departedAt,
    };
  }

  config(): ServiceConfig {
    return this.service;
  }
}

export class SimClock {
  timeSec: number;
  multiplier: number;
  paused: boolean;
  private last = 0;

  constructor(timeSec: number, multiplier = 10, paused = false) {
    this.timeSec = timeSec;
    this.multiplier = multiplier;
    this.paused = paused;
    this.last = performance.now();
  }

  update(now = performance.now()): number {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) {
      this.timeSec = (this.timeSec + dt * this.multiplier) % 86400;
    }
    return this.timeSec;
  }

  setMultiplier(value: number): void {
    this.multiplier = value;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.last = performance.now();
  }

  syncLast(now = performance.now()): void {
    this.last = now;
  }
}

export function initialSimTime(service: ServiceConfig): number {
  const now = new Date();
  const sec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  if (sec < service.startSec || sec > service.endSec) return service.startSec + 20 * 60;
  return sec;
}

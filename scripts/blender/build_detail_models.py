"""Headless Blender authoring of the detailed rolling-stock and station kits.

Every part is authored directly in the Three.js local frame used by the
instanced layers (metres, +Y up, +Z forward) and converted to Blender's Z-up
frame on the fly, so the exported GLB geometry can replace the procedural
geometry without any extra transform.

Run:  blender --background --python scripts/blender/build_detail_models.py -- public/models
"""

import math
import os
import sys

import bpy
from mathutils import Vector

OUT_DIR = "public/models"
if "--" in sys.argv:
    rest = sys.argv[sys.argv.index("--") + 1 :]
    if rest:
        OUT_DIR = rest[0]


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


class Builder:
    """Accumulates many small solids into one mesh (one GLB node per part)."""

    def __init__(self):
        self.verts = []
        self.faces = []

    def add(self, verts, faces):
        base = len(self.verts)
        self.verts.extend(verts)
        self.faces.extend([tuple(base + i for i in face) for face in faces])

    def box(self, x0, x1, y0, y1, z0, z1):
        vs = [
            (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
            (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
        ]
        fs = [
            (3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
            (7, 6, 2, 3), (0, 4, 7, 3), (1, 2, 6, 5),
        ]
        self.add(vs, fs)

    def loft(self, rings, cap=True):
        n = len(rings[0])
        vs = [p for ring in rings for p in ring]
        fs = []
        for s in range(len(rings) - 1):
            a = s * n
            b = (s + 1) * n
            for i in range(n):
                j = (i + 1) % n
                fs.append((a + i, a + j, b + j, b + i))
        if cap:
            fs.append(tuple(range(n - 1, -1, -1)))
            last = (len(rings) - 1) * n
            fs.append(tuple(last + i for i in range(n)))
        self.add(vs, fs)

    def prism(self, p0, p1, w, h):
        a = Vector(p0)
        b = Vector(p1)
        d = b - a
        if d.length < 1e-6:
            return
        t = d.normalized()
        up = Vector((0, 1, 0))
        if abs(t.dot(up)) > 0.95:
            up = Vector((0, 0, 1))
        n = t.cross(up).normalized()
        m = n.cross(t).normalized()
        corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        r0 = [a + n * (u * w / 2) + m * (v * h / 2) for u, v in corners]
        r1 = [p + d for p in r0]
        self.loft([
            [(p.x, p.y, p.z) for p in r0],
            [(p.x, p.y, p.z) for p in r1],
        ])

    def cyl_x(self, x0, x1, cy, cz, r, seg=14):
        rings = []
        for x in (x0, x1):
            ring = []
            for i in range(seg):
                a = 2 * math.pi * i / seg
                ring.append((x, cy + r * math.cos(a), cz + r * math.sin(a)))
            rings.append(ring)
        self.loft(rings)

    def cyl_y(self, y0, y1, cx, cz, r, seg=10):
        rings = []
        for y in (y0, y1):
            ring = []
            for i in range(seg):
                a = 2 * math.pi * i / seg
                ring.append((cx + r * math.cos(a), y, cz + r * math.sin(a)))
            rings.append(ring)
        self.loft(rings)

    def arch_beam(self, base, rise, half, depth, width, samples=18, z0=0.0, z1=0.0):
        """Sweep a rectangular rib along a parabolic arch in the XY plane."""
        rings = []
        for i in range(samples + 1):
            x = -half + (2 * half) * i / samples
            t = x / half
            y = base + rise * (1 - t * t)
            slope = -2 * rise * t / half
            tl = math.hypot(1.0, slope)
            nx, ny = -slope / tl, 1.0 / tl
            ring = [
                (x + nx * depth / 2, y + ny * depth / 2, z0),
                (x + nx * depth / 2, y + ny * depth / 2, z1),
                (x - nx * depth / 2, y - ny * depth / 2, z1),
                (x - nx * depth / 2, y - ny * depth / 2, z0),
            ]
            rings.append([(p[0], p[1], p[2]) for p in ring])
        self.loft(rings)
        if width:
            pass


def finish(name, builder, smooth=False):
    if not builder.verts:
        return None
    mesh = bpy.data.meshes.new(name)
    # three.js (x, y, z) -> Blender (x, -z, y)
    mesh.from_pydata([(x, -z, y) for (x, y, z) in builder.verts], [], builder.faces)
    mesh.validate(verbose=False)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    return obj


def export_glb(path):
    bpy.ops.object.select_all(action="SELECT")
    args = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="NONE",
    )
    try:
        bpy.ops.export_scene.gltf(**args)
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True)
    size = os.path.getsize(path)
    print(f"[blender] wrote {path} ({size / 1024:.1f} KiB)")


# ---------------------------------------------------------------- rolling stock

CAR_HALF_W = 1.45
CAR_LEN = 13.6


def build_train():
    body = Builder()
    profile = [
        (0.00, 0.40), (1.10, 0.40), (1.40, 0.58), (1.45, 0.74),
        (1.45, 2.56), (1.40, 2.80), (1.20, 2.99), (0.72, 3.13), (0.00, 3.15),
        (-0.72, 3.13), (-1.20, 2.99), (-1.40, 2.80), (-1.45, 2.56),
        (-1.45, 0.74), (-1.40, 0.58), (-1.10, 0.40),
    ]

    def section(z, sx, sy):
        return [(x * sx, 0.40 + (y - 0.40) * sy, z) for (x, y) in profile]

    body.loft([
        section(-CAR_LEN / 2, 0.86, 0.93),
        section(-CAR_LEN / 2 + 0.35, 0.985, 0.995),
        section(CAR_LEN / 2 - 0.35, 0.985, 0.995),
        section(CAR_LEN / 2, 0.86, 0.93),
    ])
    # Skirt and equipment boxes under the floor.
    for z in (-4.9, -1.6, 1.6, 4.9):
        body.box(-1.12, 1.12, 0.16, 0.40, z - 0.95, z + 0.95)
    finish("train_body", body, smooth=False)

    window = Builder()
    pane_z = [-4.72, -2.83, -0.94, 0.94, 2.83, 4.72]
    for zc in pane_z:
        for sign in (-1, 1):
            x0 = 1.442 if sign > 0 else -1.492
            x1 = 1.492 if sign > 0 else -1.442
            window.box(x0, x1, 2.06, 2.82, zc - 0.86, zc + 0.86)
    # Cab windscreens follow the tapered noses.
    for zc, d in ((CAR_LEN / 2 - 0.30, 0.06), (-CAR_LEN / 2 + 0.30, -0.06)):
        window.box(-0.98, 0.98, 2.16, 2.84, zc - d, zc + d)
    finish("train_window", window)

    roof = Builder()
    roof.box(-0.78, 0.78, 3.10, 3.42, -1.55, 1.55)
    for i in range(7):
        z = -1.35 + i * 0.45
        roof.box(-0.80, 0.80, 3.42, 3.48, z - 0.06, z + 0.06)
    for sign in (-1, 1):
        x0 = 0.80 if sign > 0 else -0.86
        x1 = 0.86 if sign > 0 else -0.80
        roof.box(x0, x1, 3.16, 3.36, -1.44, 1.44)
    roof.cyl_y(3.42, 3.86, 0.52, 0.9, 0.022, seg=6)
    roof.cyl_y(3.42, 3.72, -0.42, -1.1, 0.02, seg=6)
    finish("train_roof", roof)

    panto = Builder()
    for sign in (-1, 1):
        x = sign * 0.52
        panto.box(x - 0.05, x + 0.05, 0.0, 0.07, -0.46, 0.46)
        for z in (-0.30, 0.30):
            panto.cyl_y(0.05, 0.22, x, z, 0.062, seg=10)
        panto.prism((x, 0.22, -0.26), (sign * 0.16, 0.62, -0.05), 0.055, 0.075)
        panto.prism((x, 0.22, 0.26), (sign * 0.16, 0.62, 0.05), 0.055, 0.075)
        panto.prism((sign * 0.16, 0.62, 0.0), (sign * 0.05, 0.94, 0.0), 0.045, 0.055)
        panto.box(sign * 0.30 - 0.03, sign * 0.30 + 0.03, 0.60, 0.64, -0.36, 0.36)
    panto.box(-0.74, 0.74, 0.94, 1.00, -0.055, 0.055)
    for sign in (-1, 1):
        panto.prism((sign * 0.74, 0.97, 0.0), (sign * 0.93, 0.88, 0.0), 0.05, 0.05)
    finish("train_pantograph", panto)

    bogie = Builder()
    for sign in (-1, 1):
        x = sign * 1.05
        bogie.box(x - 0.09, x + 0.09, 0.28, 0.62, -1.28, 1.28)
    bogie.box(-1.0, 1.0, 0.32, 0.58, -0.36, 0.36)
    for sign in (-1, 1):
        for z in (-0.94, 0.94):
            bogie.cyl_x(sign * 0.98 - 0.05, sign * 0.98 + 0.05, 0.42, z, 0.42, seg=16)
            bogie.box(sign * 1.10 - 0.09, sign * 1.10 + 0.09, 0.34, 0.68, z - 0.20, z + 0.20)
            bogie.cyl_y(0.14, 0.62, sign * 1.14, z, 0.07, seg=8)
    finish("train_bogie", bogie, smooth=True)


# -------------------------------------------------------------------- stations


def arch_y(x, base, rise, half):
    t = x / half
    return base + rise * (1.0 - t * t)


def build_station():
    # ---- arched canopy shell (width 15.6, length 86, base 4.55, rise 1.15)
    canopy = Builder()
    half, base, rise = 7.8, 4.55, 1.15
    steps = 20
    top = [(x, arch_y(x, base, rise, half)) for x in
           [-half + 2 * half * i / steps for i in range(steps + 1)]]
    bottom = [(x, y - 0.20) for (x, y) in reversed(top)]
    loop = top + bottom
    area = 0.0
    for i in range(len(loop)):
        x1, y1 = loop[i]
        x2, y2 = loop[(i + 1) % len(loop)]
        area += x1 * y2 - x2 * y1
    if area < 0:
        loop = list(reversed(loop))
    rings = [[(x, y, z) for (x, y) in loop] for z in (-43.0, 0.0, 43.0)]
    canopy.loft(rings)
    # Gutters + fascia boards along both eaves.
    for sign in (-1, 1):
        x = sign * half
        canopy.box(min(x, x + sign * 0.18), max(x, x + sign * 0.18), base - 0.22, base + 0.10, -43, 43)
        canopy.box(min(x, x + sign * 0.30), max(x, x + sign * 0.30), base - 0.34, base - 0.18, -43, 43)
    # Raised upstands flanking the ridge skylight.
    for sign in (-1, 1):
        x0 = sign * 1.30
        x1 = sign * 1.52
        canopy.box(min(x0, x1), max(x0, x1), 5.58, 5.80, -41, 41)
    # End trims.
    for z in (-43.0, 42.86):
        canopy.box(-half - 0.02, half + 0.02, base - 0.24, base - 0.10, z, z + 0.14)
    finish("station_canopy", canopy)

    # ---- structural arch rib (matches the procedural rib centre line)
    rib = Builder()
    rib.arch_beam(base - 0.12, rise, half, 0.24, 0.11, samples=20, z0=-0.055, z1=0.055)
    finish("station_rib", rib, smooth=True)

    # ---- platforms (left / right of the island track pair)
    for name, sign in (("station_platform_left", -1), ("station_platform_right", 1)):
        plat = Builder()
        inner = sign * 3.40
        outer = sign * 6.90
        x0, x1 = min(inner, outer), max(inner, outer)
        # Slab with a chamfered track-side nosing.
        ring = [
            (inner, 0.995), (outer, 0.995), (outer, 0.445),
            (inner + sign * 0.16, 0.445), (inner, 0.90),
        ]
        if sign < 0:
            ring = list(reversed(ring))
        plat.loft([[(x, y, z) for (x, y) in ring] for z in (-46.0, 46.0)])
        # Edge coping and service hatches.
        plat.box(min(inner, inner + sign * 0.16), max(inner, inner + sign * 0.16), 0.995, 1.02, -45.6, 45.6)
        for i in range(7):
            z = -33 + i * 11
            cx = sign * 5.6
            plat.box(cx - 0.42, cx + 0.42, 1.0, 1.035, z - 0.35, z + 0.35)
        finish(name, plat)

    # ---- station hall (footprint x 9..22, y 0..7, z -8..8)
    hall = Builder()
    # Keep the hall envelope visually solid while opening the end-facade
    # circulation portals used by the exterior stairs and escalators.
    hall.box(9.0, 22.0, 0.5, 3.35, -8.0, 8.0)
    hall.box(9.0, 22.0, 6.45, 7.0, -8.0, 8.0)
    hall.box(21.72, 22.0, 3.35, 6.45, -8.0, 8.0)
    hall.box(8.7, 22.3, 0.0, 0.5, -8.25, 8.25)
    hall.box(8.85, 22.15, 4.28, 4.6, -8.15, 8.15)
    hall.box(8.55, 9.02, 4.14, 4.30, -3.4, 3.4)
    for i in range(7):
        z = -7.2 + i * 2.4
        hall.box(8.90, 9.05, 0.5, 6.45, z - 0.16, z + 0.16)
    hall.box(8.88, 9.06, 5.35, 5.50, -8.0, 8.0)
    for z in (-8.0, 8.0):
        hall.box(9.0, 9.8, 3.35, 6.45, z - 0.14, z + 0.14)
        hall.box(16.5, 22.0, 3.35, 6.45, z - 0.14, z + 0.14)
        hall.box(16.5, 22.0, 5.35, 5.50, z - 0.09, z + 0.09)
        for x in (17.0, 18.2, 19.4, 20.6, 21.8):
            hall.box(x - 0.055, x + 0.055, 3.35, 6.45, z - 0.09, z + 0.09)
    finish("station_hall", hall)

    # End glazing is split around the two circulation portals. This geometry
    # uses the same per-end instance transform as the procedural glass panel.
    glazing = Builder()
    glazing.box(-6.2, -5.7, -0.95, 0.95, -0.045, 0.045)
    for i in range(5):
        x0 = 1.0 + i * 1.04
        glazing.box(x0 + 0.025, x0 + 1.015, -0.95, 0.95, -0.045, 0.045)
    finish("station_hall_glazing", glazing)

    # ---- viaduct deck slab
    deck = Builder()
    ring = [
        (-2.28, 0.425), (2.28, 0.425), (2.45, 0.30), (2.45, -0.34),
        (2.10, -0.425), (-2.10, -0.425), (-2.45, -0.34), (-2.45, 0.30),
    ]
    deck.loft([[(x, y, z) for (x, y) in ring] for z in (-45.5, 45.5)])
    deck.box(-2.42, -2.28, -0.30, 0.24, -45.0, 45.0)
    for z in (-30, 0, 30):
        deck.box(-2.46, 2.46, 0.40, 0.46, z - 0.5, z + 0.5)
    finish("station_deck", deck)

    # ---- I-section girder under the deck edge
    girder = Builder()
    girder.box(-0.33, 0.33, 0.51, 0.60, -45.5, 45.5)
    girder.box(-0.25, 0.25, -0.60, -0.51, -45.5, 45.5)
    girder.box(-0.07, 0.07, -0.51, 0.51, -45.5, 45.5)
    for z in (-34.5, -11.5, 11.5, 34.5):
        girder.box(-0.30, 0.30, -0.16, 0.16, z - 0.10, z + 0.10)
    finish("station_girder", girder)


def build_station_refinements():
    """Close-range station details, merged into reusable instanced parts."""
    base, rise, half = 4.55, 1.15, 7.8

    # Longitudinal purlins, knee braces and rainwater pipes turn the canopy
    # shell and arch ribs into one readable structural system.
    structure = Builder()
    for sign in (-1, 1):
        for x in (2.85, 5.15):
            px = sign * x
            py = arch_y(px, base, rise, half) - 0.25
            structure.box(px - 0.065, px + 0.065, py - 0.08, py + 0.08, -42.4, 42.4)
        for z in (-34, -21.6, -9.2, 3.2, 15.6, 28):
            structure.prism(
                (sign * 7.08, 3.58, z),
                (sign * 5.85, arch_y(sign * 5.85, base, rise, half) - 0.27, z),
                0.13,
                0.16,
            )
        for z in (-34, 3.2, 28):
            structure.cyl_y(1.02, 4.48, sign * 7.18, z, 0.045, seg=6)
            structure.box(
                sign * 7.18 - 0.085,
                sign * 7.18 + 0.085,
                4.30,
                4.48,
                z - 0.08,
                z + 0.08,
            )
    finish("station_canopy_detail", structure)

    # A 5.6 m platform-edge railing module. Railings sit on the outer edge,
    # leaving the track-side coping and all train clearances untouched.
    railing = Builder()
    for z in (-2.8, 0, 2.8):
        railing.box(-0.04, 0.04, 0.0, 1.04, z - 0.04, z + 0.04)
    for i in range(1, 8):
        z = -2.8 + i * 0.7
        if abs(z) < 0.01:
            continue
        railing.box(-0.018, 0.018, 0.20, 0.96, z - 0.018, z + 0.018)
    railing.box(-0.045, 0.045, 0.96, 1.045, -2.84, 2.84)
    railing.box(-0.032, 0.032, 0.20, 0.27, -2.84, 2.84)
    finish("station_platform_railing", railing)

    # Suspended wayfinding board; a textured procedural face is layered over
    # this frame at runtime so station instances share one readable sign.
    sign = Builder()
    sign.box(-1.65, 1.65, -0.45, 0.45, -0.07, 0.07)
    sign.box(-1.72, 1.72, 0.40, 0.49, -0.085, 0.085)
    sign.box(-1.72, 1.72, -0.49, -0.40, -0.085, 0.085)
    for x in (-1.25, 1.25):
        sign.box(x - 0.035, x + 0.035, 0.48, 1.20, -0.035, 0.035)
    finish("station_wayfinding", sign)

    # Two end flights, each with a conventional stair and an escalator. The
    # treads, landings, stringers, balustrades and handrails are one GLB part.
    circulation = Builder()
    stair_count = 22
    escalator_count = 26
    run = 7.05
    for end in (-1, 1):
        for i in range(stair_count):
            t = (i + 0.5) / stair_count
            z = end * (15.2 - run * t)
            top = 0.18 + 4.42 * (i + 1) / stair_count
            dz = run / stair_count * 0.52
            circulation.box(10.0, 12.5, top - 0.17, top, z - dz, z + dz)
            if i in (0, 5, 10, 15, 21):
                for x in (9.94, 12.56):
                    circulation.box(x - 0.032, x + 0.032, top, top + 0.93, z - 0.032, z + 0.032)
        for x in (9.94, 12.56):
            circulation.prism((x, 0.10, end * 15.28), (x, 4.48, end * 8.08), 0.16, 0.22)
            circulation.prism((x, 1.12, end * 15.22), (x, 5.54, end * 8.08), 0.075, 0.075)

        for i in range(escalator_count):
            t = (i + 0.5) / escalator_count
            z = end * (15.2 - run * t)
            top = 0.18 + 4.42 * (i + 1) / escalator_count
            dz = run / escalator_count * 0.51
            circulation.box(13.95, 15.75, top - 0.12, top, z - dz, z + dz)
        for x in (13.86, 15.84):
            circulation.prism((x, 0.10, end * 15.28), (x, 4.48, end * 8.08), 0.18, 0.24)
            circulation.prism((x, 0.80, end * 15.18), (x, 5.15, end * 8.10), 0.10, 0.58)
            circulation.prism((x, 1.18, end * 15.18), (x, 5.60, end * 8.10), 0.09, 0.09)
        circulation.box(9.78, 16.02, 4.42, 4.60, end * 8.08 - 0.34, end * 8.08 + 0.34)
        circulation.box(9.78, 16.02, 0.0, 0.18, end * 15.20 - 0.40, end * 15.20 + 0.40)
    finish("station_circulation", circulation)

    # Street-level underground entrance canopy with standing seams, gutters
    # and rear downpipes. Authored in the station frame like its fallback.
    metro_roof = Builder()
    metro_roof.box(7.75, 13.95, 3.39, 3.61, -3.5, 3.5)
    for z in (-3.5, 3.5):
        metro_roof.box(7.68, 14.02, 3.42, 3.63, z - 0.08, z + 0.08)
    for x in (7.78, 13.92):
        metro_roof.box(x - 0.07, x + 0.07, 3.39, 3.60, -3.56, 3.56)
    for z in (-2.8, -1.4, 0, 1.4, 2.8):
        metro_roof.box(7.90, 13.80, 3.61, 3.66, z - 0.025, z + 0.025)
    for z in (-3.18, 3.18):
        metro_roof.cyl_y(0.28, 3.46, 13.68, z, 0.045, seg=6)
        metro_roof.box(13.58, 13.78, 3.26, 3.47, z - 0.07, z + 0.07)
    finish("station_metro_roof", metro_roof)

    # Sloped entrance handrail module, matching the original 4 m / -0.12 rad
    # centre line, with vertical balusters and a lower safety rail.
    handrail = Builder()
    handrail.prism((-2.0, 0.24, 0), (2.0, -0.24, 0), 0.075, 0.075)
    handrail.prism((-2.0, -0.42, 0), (2.0, -0.90, 0), 0.045, 0.045)
    for x in (-1.8, -0.6, 0.6, 1.8):
        top = -0.12 * x
        handrail.prism((x, top - 0.72, 0), (x, top, 0), 0.055, 0.055)
    finish("station_metro_handrail", handrail)

    # Horizontal guards around the street opening, kept at the original
    # surface anchor rather than following the underground track elevation.
    guard = Builder()
    for x in (-2.3, -1.15, 0, 1.15, 2.3):
        guard.box(x - 0.035, x + 0.035, 0.0, 1.05, -0.035, 0.035)
    for i in range(1, 12):
        x = -2.3 + i * 4.6 / 12
        guard.box(x - 0.016, x + 0.016, 0.18, 0.98, -0.016, 0.016)
    guard.box(-2.34, 2.34, 0.98, 1.065, -0.045, 0.045)
    guard.box(-2.34, 2.34, 0.15, 0.21, -0.032, 0.032)
    finish("station_metro_guardrail", guard)

    # Three raised anti-slip strips per existing stair instance.
    nosing = Builder()
    for x in (0.17, 0.225, 0.28):
        nosing.box(x - 0.009, x + 0.009, 0.061, 0.074, -1.62, 1.62)
    finish("station_metro_step_nosing", nosing)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    reset_scene()
    build_train()
    export_glb(os.path.join(OUT_DIR, "rolling-stock.glb"))
    reset_scene()
    build_station()
    build_station_refinements()
    export_glb(os.path.join(OUT_DIR, "station-kit.glb"))


main()

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
    hall.box(9.0, 22.0, 0.5, 7.0, -8.0, 8.0)
    hall.box(8.7, 22.3, 0.0, 0.5, -8.25, 8.25)
    hall.box(8.85, 22.15, 4.28, 4.6, -8.15, 8.15)
    hall.box(8.55, 9.02, 4.14, 4.30, -3.4, 3.4)
    for i in range(7):
        z = -7.2 + i * 2.4
        hall.box(8.90, 9.05, 0.5, 4.28, z - 0.16, z + 0.16)
    for z in (-8.0, 8.0):
        hall.box(9.0, 22.0, 6.70, 7.0, z - 0.14, z + 0.14)
    finish("station_hall", hall)

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


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    reset_scene()
    build_train()
    export_glb(os.path.join(OUT_DIR, "rolling-stock.glb"))
    reset_scene()
    build_station()
    export_glb(os.path.join(OUT_DIR, "station-kit.glb"))


main()

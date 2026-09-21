"""生成 PWA 图标（纯标准库，无需 PIL）

设计：主色底 + 白色上升折线（寓意「提分上岸」）。
maskable 版本把图形收进 80% 安全区，避免被系统裁切。
"""
import os
import struct
import zlib

PRIMARY = (43, 92, 230, 255)   # #2B5CE6
WHITE = (255, 255, 255, 255)

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'icons')


def make_png(size: int, pixels):
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for px in row:
            raw += struct.pack('4B', *px)
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr)
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )


def dist_to_segment(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    cx, cy = x1 + t * dx, y1 + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def render(size: int, maskable: bool = False):
    # maskable：整体缩到 80%，四周留白
    pad = size * 0.20 if maskable else 0.0
    inner = size - pad * 2
    lw = inner * 0.10            # 线宽
    dot_r = inner * 0.075        # 端点圆点半径

    pts = [
        (pad + inner * 0.16, pad + inner * 0.72),
        (pad + inner * 0.48, pad + inner * 0.46),
        (pad + inner * 0.84, pad + inner * 0.22),
    ]

    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            color = PRIMARY
            hit = False
            for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                if dist_to_segment(px, py, x1, y1, x2, y2) <= lw / 2:
                    hit = True
                    break
            if not hit:
                for (cx, cy) in pts:
                    if (px - cx) ** 2 + (py - cy) ** 2 <= dot_r ** 2:
                        hit = True
                        break
            if hit:
                color = WHITE
            row.append(color)
        rows.append(row)
    return make_png(size, rows)


def main():
    out = os.path.abspath(OUT_DIR)
    os.makedirs(out, exist_ok=True)
    targets = [
        ('icon-192.png', 192, False),
        ('icon-512.png', 512, False),
        ('icon-512-maskable.png', 512, True),
    ]
    for name, size, maskable in targets:
        path = os.path.join(out, name)
        with open(path, 'wb') as f:
            f.write(render(size, maskable))
        print(f'生成 {name} ({size}x{size}) -> {path}')


if __name__ == '__main__':
    main()

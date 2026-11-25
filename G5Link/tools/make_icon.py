"""Writes mod/FS25_G5Link/icon.dds: a 256x256 uncompressed BGRA DDS (no image libraries needed)."""
import struct, pathlib

W = H = 256
BG, PANEL, YEL, GRN, KEY, WHITE = (11, 12, 13), (27, 29, 32), (255, 212, 0), (63, 174, 73), (44, 48, 53), (242, 243, 244)

px = [[BG] * W for _ in range(H)]

def rect(x0, y0, x1, y1, c, r=0):
    for y in range(max(0, y0), min(H, y1)):
        for x in range(max(0, x0), min(W, x1)):
            if r:
                cx = min(max(x, x0 + r), x1 - 1 - r)
                cy = min(max(y, y0 + r), y1 - 1 - r)
                if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                    continue
            px[y][x] = c

rect(20, 40, 236, 204, YEL, 14)          # display bezel
rect(28, 48, 228, 196, PANEL, 9)         # screen
rect(38, 58, 120, 120, GRN, 6)           # active module
rect(128, 58, 218, 120, KEY, 6)
rect(38, 128, 218, 186, KEY, 6)
for i in range(8):                       # section bar
    rect(46 + i * 21, 140, 62 + i * 21, 174, GRN if i != 5 else PANEL, 2)
rect(96, 214, 160, 230, YEL, 5)          # mount

header = struct.pack('<4s7I44x', b'DDS ', 124, 0x100F, H, W, W * 4, 0, 0)
pixfmt = struct.pack('<8I', 32, 0x41, 0, 32, 0x00FF0000, 0x0000FF00, 0x000000FF, 0xFF000000)
caps = struct.pack('<5I', 0x1000, 0, 0, 0, 0)
data = bytearray()
for row in px:
    for (r, g, b) in row:
        data += bytes((b, g, r, 255))

out = pathlib.Path(__file__).resolve().parent.parent / 'mod' / 'FS25_G5Link' / 'icon.dds'
out.write_bytes(header + pixfmt + caps + bytes(data))
print(out, out.stat().st_size, 'bytes')

#!/usr/bin/env python3
"""Generate the placeholder app icon (1024x1024 PNG, flow-graph motif) with stdlib only."""

import math
import struct
import zlib

W = H = 1024
NODES = [(330, 380), (700, 300), (610, 700)]
EDGES = [(0, 1), (1, 2), (0, 2)]
NODE_R = 58
EDGE_W = 11


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    t = max(0.0, min(1.0, (vx * wx + vy * wy) / (vx * vx + vy * vy)))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


rows = []
for y in range(H):
    row = bytearray()
    for x in range(W):
        t = (x + y) / (W + H)
        r = int(26 + (104 - 26) * t)
        g = int(18 + (58 - 18) * t)
        b = int(54 + (236 - 54) * t)
        d = min(seg_dist(x, y, *NODES[a], *NODES[b]) for a, b in EDGES)
        if d < EDGE_W:
            r, g, b = 235, 235, 250
        for nx, ny in NODES:
            if math.hypot(x - nx, y - ny) < NODE_R:
                r, g, b = 255, 255, 255
                break
        row += bytes((r, g, b, 255))
    rows.append(bytes(row))

raw = b"".join(b"\x00" + r for r in rows)


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress(raw, 9))
    + chunk(b"IEND", b"")
)

with open("app-icon.png", "wb") as f:
    f.write(png)
print("wrote app-icon.png")

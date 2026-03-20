"""
generate-icons.py — Draws Meet Transcript Capture icons as PNG files.
Run: python3 generate-icons.py

Icon concept: white speech bubble with 3 transcript lines on a blue background.
A small red dot in the top-right corner signals "recording".
"""

import struct, zlib, os, math

# ---------------------------------------------------------------------------
# Minimal RGBA canvas with anti-aliased primitives
# ---------------------------------------------------------------------------
class Canvas:
    def __init__(self, w, h):
        self.w = w
        self.h = h
        # RGBA stored flat: index = (y * w + x) * 4
        self.buf = bytearray(w * h * 4)  # transparent black

    def _blend(self, x, y, r, g, b, a):
        if x < 0 or y < 0 or x >= self.w or y >= self.h:
            return
        i = (y * self.w + x) * 4
        src_a = a / 255
        dst_a = self.buf[i + 3] / 255
        out_a = src_a + dst_a * (1 - src_a)
        if out_a == 0:
            return
        self.buf[i]     = int((r * src_a + self.buf[i]     * dst_a * (1 - src_a)) / out_a)
        self.buf[i + 1] = int((g * src_a + self.buf[i + 1] * dst_a * (1 - src_a)) / out_a)
        self.buf[i + 2] = int((b * src_a + self.buf[i + 2] * dst_a * (1 - src_a)) / out_a)
        self.buf[i + 3] = int(out_a * 255)

    def fill_rect(self, x1, y1, x2, y2, r, g, b, a=255):
        for y in range(max(0, y1), min(self.h, y2 + 1)):
            for x in range(max(0, x1), min(self.w, x2 + 1)):
                self._blend(x, y, r, g, b, a)

    def fill_circle(self, cx, cy, radius, r, g, b, a=255):
        for y in range(int(cy - radius - 1), int(cy + radius + 2)):
            for x in range(int(cx - radius - 1), int(cx + radius + 2)):
                d = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
                alpha = max(0.0, min(1.0, radius - d + 0.5))
                if alpha > 0:
                    self._blend(x, y, r, g, b, int(a * alpha))

    def fill_rounded_rect(self, x1, y1, x2, y2, rx, r, g, b, a=255):
        rx = min(rx, (x2 - x1) // 2, (y2 - y1) // 2)
        # Center strips
        self.fill_rect(x1 + rx, y1, x2 - rx, y2, r, g, b, a)
        self.fill_rect(x1, y1 + rx, x2, y2 - rx, r, g, b, a)
        # Corners
        for cx, cy in [(x1+rx, y1+rx), (x2-rx, y1+rx), (x1+rx, y2-rx), (x2-rx, y2-rx)]:
            self.fill_circle(cx, cy, rx, r, g, b, a)

    def fill_triangle(self, pts, r, g, b, a=255):
        (x1,y1),(x2,y2),(x3,y3) = pts
        min_x, max_x = int(min(x1,x2,x3)), int(max(x1,x2,x3))
        min_y, max_y = int(min(y1,y2,y3)), int(max(y1,y2,y3))
        denom = (y2-y3)*(x1-x3) + (x3-x2)*(y1-y3)
        if denom == 0:
            return
        for y in range(min_y, max_y + 1):
            for x in range(min_x, max_x + 1):
                la = ((y2-y3)*(x-x3) + (x3-x2)*(y-y3)) / denom
                lb = ((y3-y1)*(x-x3) + (x1-x3)*(y-y3)) / denom
                lc = 1 - la - lb
                if la >= 0 and lb >= 0 and lc >= 0:
                    self._blend(x, y, r, g, b, a)

    def to_png(self):
        def chunk(name, data):
            crc = zlib.crc32(name + data) & 0xffffffff
            return struct.pack('>I', len(data)) + name + data + struct.pack('>I', crc)

        ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', self.w, self.h, 8, 6, 0, 0, 0))
        rows = b''
        for y in range(self.h):
            rows += b'\x00'
            rows += bytes(self.buf[y * self.w * 4:(y + 1) * self.w * 4])
        idat = chunk(b'IDAT', zlib.compress(rows, 9))
        iend = chunk(b'IEND', b'')
        return b'\x89PNG\r\n\x1a\n' + ihdr + idat + iend


# ---------------------------------------------------------------------------
# Icon drawing
# ---------------------------------------------------------------------------
def draw_icon(size):
    c = Canvas(size, size)
    s = size / 128  # scale factor relative to 128px master

    def sc(v):  # scale a value
        return int(round(v * s))

    # --- Background: deep blue rounded square ---
    BG = (26, 115, 232)       # #1a73e8
    BUBBLE = (255, 255, 255)  # white
    LINE = (26, 115, 232)     # lines inside bubble match bg
    DOT = (234, 67, 53)       # #ea4335 Google red

    bg_r = sc(18)
    c.fill_rounded_rect(0, 0, size - 1, size - 1, bg_r, *BG)

    # --- Speech bubble body ---
    bx1, by1 = sc(14), sc(10)
    bx2, by2 = sc(110), sc(88)
    bubble_r = sc(12)
    c.fill_rounded_rect(bx1, by1, bx2, by2, bubble_r, *BUBBLE)

    # --- Bubble tail (triangle pointing down-left) ---
    tail = [
        (sc(24), sc(84)),   # top of tail (on bubble edge)
        (sc(42), sc(84)),   # right of tail
        (sc(18), sc(108)),  # tip
    ]
    c.fill_triangle(tail, *BUBBLE)

    # --- Cover the notch where tail meets bubble so it looks smooth ---
    c.fill_circle(sc(33), sc(84), sc(9), *BUBBLE)

    # --- Transcript lines inside the bubble ---
    line_x1 = sc(28)
    line_x2_full = sc(96)
    line_x2_short = sc(74)
    lh = max(1, sc(7))   # line height
    gap = sc(13)         # gap between lines
    line_y_start = sc(28)

    for i, x2 in enumerate([line_x2_full, line_x2_full, line_x2_short]):
        ly = line_y_start + i * (lh + gap)
        line_r = lh // 2
        c.fill_rounded_rect(line_x1, ly, x2, ly + lh, line_r, *LINE)

    # --- Red recording dot (top-right of bubble) ---
    if size >= 24:
        dot_r = sc(9)
        c.fill_circle(sc(96), sc(18), dot_r, *DOT)
        # White border around dot so it reads on the bubble
        if size >= 48:
            for layer in range(max(1, sc(2))):
                border_a = int(200 * (1 - layer / sc(2)))
                c.fill_circle(sc(96), sc(18), dot_r + layer + 1, 255, 255, 255, border_a)
            c.fill_circle(sc(96), sc(18), dot_r, *DOT)

    return c


# ---------------------------------------------------------------------------
# Generate all sizes
# ---------------------------------------------------------------------------
out_dir = os.path.join(os.path.dirname(__file__), 'icons')
os.makedirs(out_dir, exist_ok=True)

for size in [16, 48, 128]:
    canvas = draw_icon(size)
    path = os.path.join(out_dir, f'icon{size}.png')
    with open(path, 'wb') as f:
        f.write(canvas.to_png())
    print(f'Generated {path} ({size}x{size})')

print('Done.')

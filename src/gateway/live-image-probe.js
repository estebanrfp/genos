let drawGlyph5x7 = function (params) {
    const rows = GLYPH_ROWS_5X7[params.char];
    if (!rows) {
      return;
    }
    for (let row = 0; row < 7; row += 1) {
      const bits = rows[row] ?? 0;
      for (let col = 0; col < 5; col += 1) {
        const on = (bits & (1 << (4 - col))) !== 0;
        if (!on) {
          continue;
        }
        for (let dy = 0; dy < params.scale; dy += 1) {
          for (let dx = 0; dx < params.scale; dx += 1) {
            fillPixel(
              params.buf,
              params.x + col * params.scale + dx,
              params.y + row * params.scale + dy,
              params.width,
              params.color.r,
              params.color.g,
              params.color.b,
              params.color.a ?? 255,
            );
          }
        }
      }
    }
  },
  drawText = function (params) {
    const text = params.text.toUpperCase();
    let cursorX = params.x;
    for (const raw of text) {
      const ch = raw in GLYPH_ROWS_5X7 ? raw : raw.toUpperCase();
      drawGlyph5x7({
        buf: params.buf,
        width: params.width,
        x: cursorX,
        y: params.y,
        char: ch,
        scale: params.scale,
        color: params.color,
      });
      cursorX += 6 * params.scale;
    }
  },
  measureTextWidthPx = function (text, scale) {
    return text.length * 6 * scale - scale;
  };
import { encodePngRgba, fillPixel } from "../media/png-encode.js";
const GLYPH_ROWS_5X7 = {
  0: [14, 17, 19, 21, 25, 17, 14],
  1: [4, 12, 4, 4, 4, 4, 14],
  2: [14, 17, 1, 2, 4, 8, 31],
  3: [30, 1, 1, 14, 1, 1, 30],
  4: [2, 6, 10, 18, 31, 2, 2],
  5: [31, 16, 30, 1, 1, 17, 14],
  6: [6, 8, 16, 30, 17, 17, 14],
  7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14],
  9: [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  T: [31, 4, 4, 4, 4, 4, 4],
};
export function renderCatNoncePngBase64(nonce) {
  const top = "CAT";
  const bottom = nonce.toUpperCase();
  const scale = 12;
  const pad = 18;
  const gap = 18;
  const topWidth = measureTextWidthPx(top, scale);
  const bottomWidth = measureTextWidthPx(bottom, scale);
  const width = Math.max(topWidth, bottomWidth) + pad * 2;
  const height = pad * 2 + 7 * scale + gap + 7 * scale;
  const buf = Buffer.alloc(width * height * 4, 255);
  const black = { r: 0, g: 0, b: 0 };
  drawText({
    buf,
    width,
    x: Math.floor((width - topWidth) / 2),
    y: pad,
    text: top,
    scale,
    color: black,
  });
  drawText({
    buf,
    width,
    x: Math.floor((width - bottomWidth) / 2),
    y: pad + 7 * scale + gap,
    text: bottom,
    scale,
    color: black,
  });
  const png = encodePngRgba(buf, width, height);
  return png.toString("base64");
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../web/style.css", import.meta.url), "utf8");
const token = (name) =>
  css.match(new RegExp(`--${name}:\\s*(#[a-f0-9]{6})`, "i"))[1];
const lum = (color) => {
  const c = color
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
};
const contrast = (a, b) =>
  (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
test("meaningful theme text and chart marks meet declared contrast thresholds", () => {
  assert(contrast(token("muted"), token("card")) >= 4.5);
  assert(contrast(token("base"), token("accent")) >= 4.5);
  assert(contrast(token("accent"), token("card")) >= 3);
  assert(contrast(token("blue"), token("card")) >= 3);
  assert(contrast("#77777c", token("elevated")) >= 3);
});

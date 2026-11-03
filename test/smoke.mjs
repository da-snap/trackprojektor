// Headless-Chrome-Test: lädt index.html, spielt synthetisches Foto + GPX ein und prüft
// Linie sichtbar + Passpunkt-Löser (1, 2, 3 Punkte) gegen eine bekannte Kamera.
// Braucht Netz (three.js/Leaflet vom CDN, Höhenkacheln). CHROME_PATH überschreibt den Browser.
import puppeteer from "puppeteer-core";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "trackprojektor-"));

// Track: Zickzack 2–7 km nördlich der Kamera (Rieserferner)
const cam = { lat: 46.8998, lon: 12.0890 };
let gpx = '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>';
for (let k = 0; k <= 200; k++) {
  const t = k / 200;
  const lat = cam.lat + 0.018 + t * 0.045;
  const lon = cam.lon - 0.02 + t * 0.04 + 0.006 * Math.sin(t * 20);
  gpx += `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>2000</ele></trkpt>`;
}
writeFileSync(join(tmp, "t.gpx"), gpx + "</trkseg></trk></gpx>");

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--allow-file-access-from-files"],
});
let failed = 0;
const check = (name, ok, info = "") => {
  console.log((ok ? "ok   " : "FAIL ") + name + (info ? "  " + info : ""));
  if (!ok) failed++;
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on("pageerror", e => check("keine Skriptfehler", false, e.message));
  await page.goto(pathToFileURL(join(root, "index.html")).href, { waitUntil: "networkidle2" });

  // Testfoto 1600×1200 aus einem Canvas
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 1600; c.height = 1200;
    const g = c.getContext("2d"); g.fillStyle = "#7a8a99"; g.fillRect(0, 0, 1600, 1200);
    return c.toDataURL("image/png").split(",")[1];
  });
  writeFileSync(join(tmp, "p.png"), Buffer.from(png, "base64"));

  await page.evaluate((lat, lon) => { $("camLat").value = lat; $("camLon").value = lon; }, cam.lat, cam.lon);
  await (await page.$("#fGpx")).uploadFile(join(tmp, "t.gpx"));
  await page.waitForFunction(() => state.track);
  await page.evaluate(() => { $("camLat").dispatchEvent(new Event("change")); });
  await (await page.$("#fPhoto")).uploadFile(join(tmp, "p.png"));
  await page.waitForFunction(() => state.photo);
  await page.evaluate(() => demJob);

  check("Gelände geladen", await page.evaluate(() => !!state.dem && groundAt(state.origin.lat, state.origin.lon) > 1000));

  const lit = await page.evaluate(() => {
    aimAtTrack();
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 8) n++;
    return n;
  });
  check("Linie sichtbar", lit > 200, lit + " px");

  // Bekannte Kamera -> Bildpunkte dreier Trackpunkte
  const r = await page.evaluate(() => {
    const gt = { yaw: state.yaw + 3, pitch: state.pitch - 2, roll: 1.5, hfov: 70, origin: { ...state.origin } };
    Object.assign(state, { yaw: gt.yaw, pitch: gt.pitch, roll: gt.roll, hfov: gt.hfov });
    const pins = [20, 110, 190].map(i => { const [nx, ny] = projectLocal(state.segPts[i]); return { i, nx, ny }; });
    const W = state.photo.naturalWidth;
    const out = {};

    // 1 Punkt: Punkt muss exakt sitzen, Roll + Bildwinkel bleiben
    Object.assign(state, { yaw: gt.yaw + 10, pitch: gt.pitch + 5, hfov: 55, pins: [pins[0]] });
    solvePins(true);
    const p1 = projectLocal(state.segPts[pins[0].i]);
    out.one = Math.hypot(p1[0] - pins[0].nx, p1[1] - pins[0].ny) * W;

    // 2 Punkte: alles außer Standort exakt
    Object.assign(state, { yaw: gt.yaw - 8, pitch: gt.pitch + 4, roll: -3, hfov: 50, pins: pins.slice(0, 2) });
    solvePins(true);
    out.two = Math.max(Math.abs(state.yaw - gt.yaw), Math.abs(state.pitch - gt.pitch),
                       Math.abs(state.roll - gt.roll), Math.abs(state.hfov - gt.hfov));

    // 3 Punkte: Standort 300 m daneben -> muss zurückfinden
    setOrigin(gt.origin.lat, gt.origin.lon + 300 / mPerDegLon(gt.origin.lat));
    Object.assign(state, { yaw: gt.yaw + 2, hfov: 60, pins });
    const t0 = performance.now();
    solvePins(true);
    out.ms = performance.now() - t0;
    out.dist = Math.hypot((state.origin.lat - gt.origin.lat) * M_PER_DEG_LAT,
                          (state.origin.lon - gt.origin.lon) * mPerDegLon(gt.origin.lat));
    out.three = Math.max(Math.abs(state.yaw - gt.yaw), Math.abs(state.pitch - gt.pitch), Math.abs(state.hfov - gt.hfov));
    return out;
  });
  check("1 Punkt sitzt", r.one < 0.5, r.one.toFixed(3) + " px");
  check("2 Punkte lösen Ausrichtung", r.two < 0.01, r.two.toExponential(2) + "°");
  check("3 Punkte finden Standort", r.dist < 10, r.dist.toFixed(1) + " m, " + r.ms.toFixed(0) + " ms");
  check("3 Punkte lösen Ausrichtung", r.three < 0.1, r.three.toFixed(3) + "°");

  // Bedienablauf: Foto-Klick + Karten-Klick ergeben einen Passpunkt
  const n = await page.evaluate(() => {
    state.pins = []; state.pending = null;
    const r = $("gl").getBoundingClientRect(), o = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1 };
    $("gl").dispatchEvent(new PointerEvent("pointerdown", o));
    $("gl").dispatchEvent(new PointerEvent("pointerup", o));
    const t = state.track[100];
    map.fire("click", { latlng: L.latLng(t.lat, t.lon) });
    return state.pins.length;
  });
  check("Klick Foto + Klick Karte = Passpunkt", n === 1);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);

# Trackprojektor

Draws a GPX track into a landscape photo in correct perspective: the line sits in the terrain
instead of being a map snippet in the corner. Runs entirely in the browser; photo and track
never leave your machine.

## Usage

1. Load a photo (JPG/PNG) and a GPX track, either with the file pickers or by dropping them onto the window.
   Position, focal length and heading are taken from the photo's EXIF data when present.
2. Click a distinctive spot in the photo, then the same spot on the track in the map (either order).
   - **1 point:** that point stays fixed; dragging in the photo rotates around it, the mouse wheel zooms.
   - **2 points:** field of view and direction are set. Dragging in the photo moves the camera position,
     which tilts the line around the two points.
   - **3 points:** everything is fixed, and the camera position is computed from the points.

   Points in the photo can be dragged to fine-tune. The blue dot on the map is the camera position and can be dragged too.
3. Use the eraser to remove leftover segments, then export a PNG at full resolution.

The UI is in German.

## Development

There's no build step. `index.html` is the whole app (three.js r128 and Leaflet 1.9.4 from cdnjs).

```bash
npm start      # serves on http://localhost:8000
npm install
npm test       # headless Chrome: line visibility + 1/2/3-point solver round-trips
```

The tests need network access (CDN, elevation tiles) and Chrome at `/usr/bin/google-chrome`
(override with `CHROME_PATH`).

Elevation data comes from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), and the
map tiles come from OpenTopoMap and OpenStreetMap.

## Publishing

It's a static page. GitHub Pages works: Settings → Pages → deploy from branch `main`, root folder.

## License

MIT, see [LICENSE](LICENSE).

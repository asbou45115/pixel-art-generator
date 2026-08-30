# Pixel Art Generator

A single-page browser tool that converts images, GIFs, and videos to pixel art with live preview, palettes, dithering, and private client-side processing.

## Run locally

```bash
py -m http.server 8080
```

Then open http://localhost:8080

## Features

- Upload PNG, JPG, GIF, WEBP, MP4, or WebM — no file size limit (client-side only)
- Animated GIF and video support with a frame strip to preview individual frames
- Play animation preview in the browser before exporting
- Header export controls: upload file, format, output size, and download
- Export animations as GIF or MP4 with progress bar and cancel support
- Live pixel size, brightness, contrast, saturation controls
- Built-in palettes (Pico-8, Lost Century, Game Boy, NES, and more)
- Auto palette extracted from the source (shared across animation frames on export)
- Floyd-Steinberg and ordered dithering
- Lospec palette import
- Export still images as PNG, JPEG, or WebP at multiple sizes

## Limits

- GIFs and videos are sampled to 150 frames and 15 seconds of video for performance
- Animated GIF decoding requires a browser with `ImageDecoder` support (Chrome, Edge, Firefox)
- MP4 export uses WebCodecs when available, otherwise falls back to the browser's native recorder

## Project structure

```
index.html
assets/
  css/styles.css
  js/
    main.js          Page bootstrap
    layout.js        Compact header
    editor.js        Editor UI
    pixelate.js      Image processing
    palettes.js      Palette data
    upload.js        Upload zone
    media-source.js  GIF/video frame loading
    media-export.js  GIF/MP4 export
    progress.js      Cancellable task overlay with progress
    gifenc.js        GIF encoder (vendored)
    mp4-muxer.js     MP4 muxer (vendored)
```

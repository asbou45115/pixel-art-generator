# Pixel Art Generator

A single-page browser tool that converts images, GIFs, and videos to pixel art with live preview, palettes, dithering, and private client-side processing.

## Run locally

```bash
py -m http.server 8080
```

Then open http://localhost:8080

## Features

- Upload PNG, JPG, GIF, WEBP, MP4, or WebM (images up to 10MB, video up to 25MB)
- Animated GIF and video support with live preview
- Export animations as GIF or WebM video
- Live pixel size, brightness, contrast, saturation controls
- Built-in palettes (Pico-8, Lost Century, Game Boy, NES, and more)
- Auto palette extracted from the source (shared across animation frames)
- Floyd-Steinberg and ordered dithering
- Lospec palette import
- Export still images as PNG, JPEG, or WebP at multiple sizes

## Limits

- GIFs and videos are capped at 150 frames and 15 seconds of video
- Animated GIF decoding requires a browser with `ImageDecoder` support (Chrome, Edge, Firefox)

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
    media-export.js  GIF/WebM export
    gifenc.js        GIF encoder (vendored)
```

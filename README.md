# Pixel Art Generator

A single-page browser tool that converts images to pixel art with live preview, palettes, dithering, and private client-side processing.

## Run locally

```bash
py -m http.server 8080
```

Then open http://localhost:8080

## Features

- Upload PNG, JPG, GIF, or WEBP (up to 10MB)
- Live pixel size, brightness, contrast, saturation controls
- Built-in palettes (Pico-8, Lost Century, Game Boy, NES, and more)
- Auto palette extracted from the source image
- Floyd-Steinberg, Atkinson, and ordered dithering
- Lospec palette import
- Export as PNG, JPEG, or WebP at multiple sizes

## Project structure

```
index.html
assets/
  css/styles.css
  js/
    main.js       Page bootstrap
    layout.js     Compact header
    editor.js     Editor UI
    pixelate.js   Image processing
    palettes.js   Palette data
    upload.js     Upload zone
```

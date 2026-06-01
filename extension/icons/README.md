# Extension Icons

Place PNG icons here:

- `icon-16.png`  — 16x16px
- `icon-48.png`  — 48x48px
- `icon-128.png` — 128x128px

Generate from `public/img/logo-mark.svg` using ImageMagick:

```bash
magick public/img/logo-mark.svg -resize 16x16   extension/icons/icon-16.png
magick public/img/logo-mark.svg -resize 48x48   extension/icons/icon-48.png
magick public/img/logo-mark.svg -resize 128x128 extension/icons/icon-128.png
```

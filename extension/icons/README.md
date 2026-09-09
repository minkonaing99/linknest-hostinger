# Extension Icons

Place PNG icons here:

- `icon-16.png`  — 16x16px
- `icon-48.png`  — 48x48px
- `icon-128.png` — 128x128px

Generate from `public/img/logo-source.png` using ImageMagick:

```bash
magick public/img/logo-source.png -filter Lanczos -resize 16x16 -strip extension/icons/icon-16.png
magick public/img/logo-source.png -filter Lanczos -resize 48x48 -strip extension/icons/icon-48.png
magick public/img/logo-source.png -filter Lanczos -resize 128x128 -strip extension/icons/icon-128.png
```

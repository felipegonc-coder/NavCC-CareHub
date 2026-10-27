# App icons

The PNG icons for the installed app and the iPhone Home Screen, kept as base64 text because the
tools that commit to this repository can't add binary files. `scripts/write-icons.mjs` writes them
to `public/icons/` before `npm run dev` and `npm run build`. Git ignores that folder.

| File                        | Size   | Used by                                                                                         |
| --------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `apple-touch-icon.png.b64`  | 180 px | The iPhone and iPad Home Screen (`index.html`). No transparency.                                |
| `icon-192.png.b64`          | 192 px | The installed app (`public/manifest.webmanifest`).                                              |
| `icon-512.png.b64`          | 512 px | The installed app and its splash screen.                                                        |
| `icon-maskable-512.png.b64` | 512 px | Android, which crops it to its own shape. No transparency; the "C" stays inside the middle 80%. |

Each is `public/favicon.svg` at that size, with square corners for the two without transparency. To
change one, make the PNG and save it as base64 text, for example
`base64 -w 76 icon-192.png > icons/icon-192.png.b64`.

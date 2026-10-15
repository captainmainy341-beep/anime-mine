# Story art packs ("skins")

The Story tab draws its characters and backgrounds from an **art pack**. Without any setup it uses the
built-in pack: characters and backgrounds drawn in code (SVG and CSS gradients, in
`src/renderer/learn/vn/defaultSkin.mjs`): shaded busts with per-character hair, eyes, outfits and
accessories, five faces each, and layered backgrounds. Characters breathe and blink, clouds drift and
festival lanterns sway; all of that stops when the system asks for reduced motion. That art is original and released as CC0, so nothing needs
attribution and nothing third-party ships with the app.

You can replace any part of it with your own images.

## Where packs live

```
<userData>/vn-skins/<pack name>/
  pack.json
  ...your images...
```

`<userData>` is Electron's per-user data folder for anime-mine (the same folder that holds `learn.json`):

| OS      | Path                                         |
| ------- | -------------------------------------------- |
| macOS   | `~/Library/Application Support/anime-mine`   |
| Windows | `%APPDATA%\anime-mine`                       |
| Linux   | `~/.config/anime-mine`                       |

Pick the pack in **Learn > Story > Art**. The choice is remembered. Packs are read when a scene opens, so
re-open the scene after editing files.

Pack names use letters, digits, space, `.`, `_` and `-` (up to 60 characters).

## `pack.json`

```json
{
  "name": "My pack",
  "author": "You",
  "license": "CC0",
  "characters": {
    "mio":  { "neutral": "mio/neutral.png", "smile": "mio/smile.png" },
    "sora": { "neutral": "sora.png" }
  },
  "backgrounds": {
    "classroom-morning": "bg/classroom.jpg",
    "park-day": "bg/park.png"
  }
}
```

- `characters`: character id -> expression -> image path. Character ids are the ids used by the scenes
  (the shipped story uses `mio`, `sora`, `tanaka`; anime-line scenes use `line`). Expression ids used by the
  shipped story are `neutral`, `smile`, `tired`, `surprised` and `sad`.
- `backgrounds`: background id -> image path. The shipped story uses `classroom-morning`,
  `school-gate-evening`, `riverside-evening`, `park-day`, `festival-hall` and `anime-default`.
- `name`, `author` and `license` are informational. Keep the license of any art you include.
- Ids are lowercase letters, digits, `-` and `_`.

### Sprites

Transparent PNG, WebP or SVG, roughly 2:3 portrait (a bust or full body). They are scaled to about 88% of
the stage height and sit on the bottom edge. Two or three characters can share the stage (left, centre,
right).

### Backgrounds

16:9 JPG, PNG or WebP, around 1280x720 or larger.

## Fallbacks

Nothing about a pack is required to be complete. For every sprite the app tries, in order:

1. the pack's image for that character and expression,
2. the pack's `neutral` image for that character,
3. the built-in drawn character (a colour-coded bust, one face per expression).

For every background:

1. the episode frame, for anime-line scenes whose video file is still on disk,
2. the pack's image for that background id,
3. the built-in gradient background (unknown ids get a plain dark gradient).

A pack whose `pack.json` is missing, unreadable or not an object is shown as invalid and ignored. Entries
whose image does not exist are skipped one by one.

## Limits and safety

- Image paths are relative to the pack folder. Absolute paths, `..`, and symlinks that point outside the
  pack are rejected.
- Allowed types: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`. At most 8 MB per image, 256 KB for
  `pack.json`.
- Images are read by the main process and sent to the page as data URLs; nothing is fetched from the
  network.

## Using art you did not draw

Only use art you have the right to use. Do not copy, trace or rip sprites or backgrounds from commercial
visual novels, games or anime, and do not use "fan" packs made from them: that art is not yours to
redistribute, even privately shared. The app ships none of it and never will.

### Where to find free art

Good places to look for art you are allowed to use (check each asset's own page, licences vary):

- **OpenGameArt.org**: filter by licence (CC0, CC-BY, CC-BY-SA). Search "visual novel", "character
  portrait", "background".
- **itch.io game assets**: browse *Game assets* and filter by tags such as "visual novel", "sprites" or
  "backgrounds"; many creators release free packs under CC0 or CC-BY, others under their own terms (read
  them: some forbid redistribution or AI training, some require credit).
- **Kenney.nl**: everything is CC0; mostly game UI and props, a few backgrounds.
- Public-domain photo sites such as **Wikimedia Commons** (check the file's licence) for real-world
  backgrounds you can pass through a filter.
- Your own drawings or photos.

Keep the attribution:

- Put the licence in `pack.json` (`"license": "CC-BY 4.0"`, `"author": "..."`) and add a `LICENSE` or
  `CREDITS.txt` next to it listing each asset, its author, its source URL and its licence.
- CC-BY requires credit; CC-BY-SA also requires sharing changes under the same licence; CC0 needs nothing
  but crediting is still kind.
- Packs live only in your `<userData>/vn-skins` folder; they are not uploaded or shared by the app.

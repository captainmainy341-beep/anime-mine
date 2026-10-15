# Anime Mine native Anki bridge

A separate Anki add-on registers five actions on the existing AnkiConnect server:
`animeMineDeckOptions`, `animeMineSetDeckOptions`, `animeMineStudyQueue`,
`animeMineStudyAnswer`, and `animeMineOpenDeckOptions`.
It does not edit AnkiConnect, use a separate database, or implement a scheduler.

## Install

Copy `anime_mine_bridge/` to the current Anki add-ons directory (Tools → Add-ons → View Files), then restart Anki. AnkiConnect must already be enabled. Requires modern Anki with its native V3 scheduler and protobuf deck-options update API (tested with the locally installed Anki Python package).

## Behaviour and safety

- Permanent limits use Anki's per-deck overrides; presets remain untouched.
- Today-only limits use native daily overrides and native day rollover, not OS midnight.
- Order and sibling settings clone a shared preset only if a behaviour change is necessary. FSRS, custom scheduling, retention, global collection settings and other fields are retained.
- Saves are one atomic, undoable native deck-options operation. An optimistic revision rejects concurrent changes from Anki and changes across day rollover.
- Reading counts and studying select the requested deck in Anki, just like Anki's deck picker. Native reviewing or modal dialogs block access to prevent concurrent sessions/options edits.
- Each review fetches one scheduler-selected card. An opaque, short-lived token and a fresh native-queue check reject duplicate/stale answers. Review time includes time spent on the card.
- Collections with custom scheduling JavaScript must be reviewed in Anki so the script is not silently bypassed. Filtered decks are managed in Anki.
- Advanced settings open the actual Anki options dialog. Close it and click Read Anki to refresh Anime Mine.
- Anime Mine IPC still requires Live mode and an explicitly visible deck. Sample/Hidden modes make no bridge requests. No initial settings or card history is changed by installation.

## Test

`npm test`

`node_modules/.bin/electron scripts/anki-controls-smoke.cjs`

With an Anki Python environment:
`python -m unittest discover -s test -p 'anki_bridge_test.py' -v`

Python tests create only throwaway collections. The Electron fixture uses mock IPC and blocks HTTP(S).

## Rollback

Close Anki, remove/disable only `anime_mine_bridge`, and restore the backed-up Anime Mine app bundle if desired. Uninstalling does not reset deck options or review history; use Anki's Undo for a just-saved options change, or edit the native deck options in Anki.

"""A separate add-on extends AnkiConnect without replacing or editing it."""
import sys
from aqt import gui_hooks
import aqt
from .bridge import NativeBridge
from .browse import BrowseBridge

_bridge = None


def _busy():
    return aqt.mw.state == 'review' or aqt.mw.app.activeModalWidget() is not None


def bridge():
    global _bridge
    if aqt.mw is None or aqt.mw.col is None:
        raise ValueError('Open an Anki profile first')
    if _bridge is None or _bridge.col is not aqt.mw.col:
        _bridge = NativeBridge(aqt.mw.col, busy=_busy)
    return _bridge


def animeMineDeckOptions(self, deck, visibleDecks):
    return bridge().options(deck, visibleDecks)


def animeMineSetDeckOptions(self, deck, patch, expectedRevision, visibleDecks):
    result = bridge().save(deck, patch, expectedRevision, visibleDecks)
    aqt.mw.reset()
    return result


def animeMineStudyQueue(self, deck, visibleDecks):
    return bridge().queue(deck, visibleDecks)


def animeMineStudyAnswer(self, deck, cardId, ease, token, visibleDecks):
    result = bridge().answer(deck, cardId, ease, token, visibleDecks)
    aqt.mw.reset()
    return result


def animeMineCardAction(self, action, cardIds, args):
    if aqt.mw is None or aqt.mw.col is None:
        raise ValueError('Open an Anki profile first')
    result = BrowseBridge(aqt.mw.col, busy=_busy).action(action, cardIds, args)
    aqt.mw.reset()
    return result


def animeMineToday(self):
    if aqt.mw is None or aqt.mw.col is None:
        raise ValueError('Open an Anki profile first')
    return BrowseBridge(aqt.mw.col, busy=_busy).today()


def animeMineOpenDeckOptions(self, deck):
    native = bridge()
    selected = native._deck(deck)
    from aqt.deckoptions import display_options_for_deck
    display_options_for_deck(selected)
    return {'ok': True}


def register():
    # AnkiConnect may be installed under its numeric ID or a development name.
    module = next((m for m in list(sys.modules.values()) if m is not None and 'AnkiConnect' in vars(m) and 'ac' in vars(m)), None)
    if module is None:
        return
    for method in (animeMineDeckOptions, animeMineSetDeckOptions, animeMineStudyQueue, animeMineStudyAnswer, animeMineOpenDeckOptions, animeMineCardAction, animeMineToday):
        setattr(module.AnkiConnect, method.__name__, module.util.api()(method))


def clear():
    global _bridge
    _bridge = None


gui_hooks.profile_did_open.append(register)
gui_hooks.profile_will_close.append(clear)

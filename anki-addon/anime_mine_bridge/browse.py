"""Card actions stock AnkiConnect cannot do reliably: user flags and bury/unbury."""

SUSPENDED = -1
BURIED = (-2, -3)
ACTIONS = ('flag', 'bury', 'unbury')


class BrowseBridge:
    def __init__(self, collection, busy=lambda: False):
        self.col = collection
        self.busy = busy

    def _guard(self):
        if self.busy():
            raise ValueError("Leave the active Anki review/options screen before using Anime Mine.")

    def today(self):
        self._guard()
        return {'today': int(self.col.sched.today), 'cutoff': int(self.col.sched.day_cutoff)}

    def action(self, action, card_ids, args):
        self._guard()
        if action not in ACTIONS:
            raise ValueError(f"Unknown card action: {action}")
        if not isinstance(card_ids, list) or not 1 <= len(card_ids) <= 500:
            raise ValueError("Choose 1-500 cards")
        if not all(type(cid) is int and cid > 0 for cid in card_ids):
            raise ValueError("cardIds must be positive integers")
        if action == 'flag':
            flag = args.get('flag') if isinstance(args, dict) else None
            if type(flag) is not int or not 0 <= flag <= 7:
                raise ValueError("flag must be an integer 0-7")
            self.col.set_user_flag_for_cards(flag, card_ids)
            return {'ok': True}
        cards = [self.col.get_card(cid) for cid in card_ids]
        if action == 'bury':
            targets = [c.id for c in cards if c.queue != SUSPENDED]
            if targets:
                self.col.sched.bury_cards(targets)
        else:
            targets = [c.id for c in cards if c.queue in BURIED]
            if targets:
                self.col.sched.unbury_cards(targets)
        return {'ok': True}

"""Runs against a throwaway real Anki collection; never opens the user's profile."""
import importlib.util
import tempfile
import time
import unittest
from pathlib import Path
from anki.collection import Collection

spec = importlib.util.spec_from_file_location('anime_mine_browse_core', Path(__file__).parents[1] / 'anki-addon/anime_mine_bridge/browse.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BrowseBridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.col = Collection(self.tmp.name + '/test.anki2')
        self.did = self.col.decks.id('Anime')
        for n in range(3):
            note = self.col.new_note(self.col.models.by_name('Basic'))
            note['Front'] = 'word ' + str(n)
            note['Back'] = 'meaning'
            self.col.add_note(note, self.did)
        self.cards = list(self.col.find_cards('deck:Anime'))
        self.bridge = module.BrowseBridge(self.col)

    def tearDown(self):
        self.col.close()
        self.tmp.cleanup()

    def queue(self, cid):
        return self.col.get_card(cid).queue

    def test_flag_sets_and_clears_user_flag_on_each_card(self):
        self.bridge.action('flag', self.cards[:2], {'flag': 3})
        self.assertEqual([self.col.get_card(c).user_flag() for c in self.cards], [3, 3, 0])
        self.bridge.action('flag', self.cards[:1], {'flag': 0})
        self.assertEqual(self.col.get_card(self.cards[0]).user_flag(), 0)

    def test_flag_rejects_values_outside_0_to_7(self):
        for bad in (8, -1, '1', True, 1.0, None):
            with self.assertRaisesRegex(ValueError, 'flag must be'):
                self.bridge.action('flag', self.cards, {'flag': bad})
        self.assertEqual([self.col.get_card(c).user_flag() for c in self.cards], [0, 0, 0])

    def test_bury_then_unbury_restores_buried_cards(self):
        self.bridge.action('bury', self.cards[:1], {})
        self.assertIn(self.queue(self.cards[0]), (-2, -3))
        self.bridge.action('unbury', self.cards[:1], {})
        self.assertEqual(self.queue(self.cards[0]), 0)

    def test_bury_leaves_suspended_cards_suspended_and_unbury_does_not_unsuspend(self):
        self.col.sched.suspend_cards([self.cards[0]])
        self.bridge.action('bury', self.cards, {})
        self.assertEqual(self.queue(self.cards[0]), -1)
        self.assertIn(self.queue(self.cards[1]), (-2, -3))
        self.bridge.action('unbury', self.cards, {})
        self.assertEqual(self.queue(self.cards[0]), -1)
        self.assertEqual(self.queue(self.cards[1]), 0)

    def test_today_reports_the_collection_day_and_cutoff(self):
        out = self.bridge.today()
        self.assertEqual(out, {'today': self.col.sched.today, 'cutoff': self.col.sched.day_cutoff})
        self.assertIsInstance(out['today'], int)
        self.assertGreater(out['cutoff'], time.time())

    def test_today_is_blocked_while_a_busy_screen_is_open(self):
        busy = module.BrowseBridge(self.col, busy=lambda: True)
        with self.assertRaisesRegex(ValueError, 'Leave the active Anki'):
            busy.today()

    def test_busy_screen_blocks_every_action_before_writing(self):
        busy = module.BrowseBridge(self.col, busy=lambda: True)
        with self.assertRaisesRegex(ValueError, 'Leave the active Anki'):
            busy.action('flag', self.cards, {'flag': 2})
        self.assertEqual([self.col.get_card(c).user_flag() for c in self.cards], [0, 0, 0])

    def test_unknown_action_and_bad_card_lists_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unknown card action'):
            self.bridge.action('delete', self.cards, {})
        with self.assertRaisesRegex(ValueError, 'Choose 1-500 cards'):
            self.bridge.action('bury', [], {})
        with self.assertRaisesRegex(ValueError, 'Choose 1-500 cards'):
            self.bridge.action('bury', list(range(1, 502)), {})
        with self.assertRaisesRegex(ValueError, 'positive integers'):
            self.bridge.action('bury', ['1'], {})

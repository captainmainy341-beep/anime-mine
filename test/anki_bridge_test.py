"""Runs against a throwaway real Anki collection; never opens the user's profile."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from anki.collection import Collection

spec = importlib.util.spec_from_file_location('anime_mine_bridge_core', Path(__file__).parents[1] / 'anki-addon/anime_mine_bridge/bridge.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NativeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.col = Collection(self.tmp.name + '/test.anki2')
        self.did = self.col.decks.id('Anime')
        self.other = self.col.decks.id('Other')
        self.bridge = module.NativeBridge(self.col)
        for n in range(5):
            note = self.col.new_note(self.col.models.by_name('Basic'))
            note['Front'] = 'word ' + str(n)
            note['Back'] = 'meaning'
            self.col.add_note(note, self.did)

    def tearDown(self):
        self.col.close()
        self.tmp.cleanup()

    def save(self, patch):
        return self.bridge.save('Anime', patch, self.bridge.options('Anime')['revision'])

    def test_permanent_deck_limits_preserve_other_decks_and_preset(self):
        before = self.col.decks.config_dict_for_deck_id(self.other)
        out = self.save({'scope':'permanent','newPerDay':2,'reviewsPerDay':99})
        self.assertEqual(out['remaining']['new'], 2)
        self.assertEqual(out['permanent']['reviewsPerDay'], 99)
        self.assertEqual(before, self.col.decks.config_dict_for_deck_id(self.other))
        self.assertIsNone(self.col.decks.get(self.other)['newLimit'])

    def test_today_override_and_native_expiry(self):
        self.save({'scope':'permanent','newPerDay':2,'reviewsPerDay':90})
        out = self.save({'scope':'today','newPerDay':4,'reviewsPerDay':110})
        self.assertEqual(out['remaining']['new'], 4)
        self.assertEqual(out['permanent']['newPerDay'], 2)
        deck = self.col.decks.get(self.did)
        deck['newLimitToday']['today'] -= 1
        deck['reviewLimitToday']['today'] -= 1
        self.col.decks.update_dict(deck)
        out = self.bridge.options('Anime')
        self.assertIsNone(out['today']['newPerDay'])
        self.assertEqual(out['remaining']['new'], 2)

    def test_clear_today_restores_permanent(self):
        self.save({'scope':'today','newPerDay':0,'reviewsPerDay':0})
        self.assertEqual(self.bridge.queue('Anime')['cardIds'], [])
        out = self.save({'scope':'today','clearToday':True})
        self.assertEqual(out['remaining']['new'], 5)

    def test_behaviour_clones_shared_config_and_preserves_fsrs_and_other_fields(self):
        old = self.col.decks.config_dict_for_deck_id(self.did)
        self.save({'scope':'permanent','newMix':1,'buryNew':True,'buryReviews':True,'buryLearning':True})
        now = self.col.decks.config_dict_for_deck_id(self.did)
        self.assertNotEqual(now['id'], old['id'])
        self.assertEqual(self.col.decks.config_dict_for_deck_id(self.other), old)
        for key in ('fsrsParams6','desiredRetention','lapse','maxTaken'):
            self.assertEqual(now[key], old[key])
        self.assertTrue(now['new']['bury'])

    def test_native_queue_respects_daily_limits_across_sessions(self):
        self.save({'scope':'permanent','newPerDay':2})
        self.col.decks.select(self.other)
        ids = []
        for _ in range(2):
            q = self.bridge.queue('Anime')
            ids += q['cardIds']
            self.assertEqual(self.col.decks.selected(), self.did)
            self.bridge.answer('Anime', q['cardIds'][0], 4, q['token'])
            self.assertEqual(self.col.decks.selected(), self.did)
        self.assertEqual(len(set(ids)), 2)
        self.assertEqual(self.bridge.queue('Anime')['cardIds'], [])
        self.assertEqual(self.bridge.options('Anime')['completed']['new'], 2)

    def test_stale_revision_and_tokens_do_not_write(self):
        revision = self.bridge.options('Anime')['revision']
        self.save({'scope':'permanent','newPerDay':1})
        with self.assertRaisesRegex(ValueError, 'Reload'):
            self.bridge.save('Anime', {'scope':'permanent','newPerDay':4}, revision)
        q = self.bridge.queue('Anime')
        with self.assertRaisesRegex(ValueError, 'expired'):
            self.bridge.answer('Anime', q['cardIds'][0], 4, 'wrong')
        self.assertEqual(self.bridge.options('Anime')['completed']['new'], 0)
        self.bridge.answer('Anime', q['cardIds'][0], 4, q['token'])
        with self.assertRaisesRegex(ValueError, 'expired'):
            self.bridge.answer('Anime', q['cardIds'][0], 4, q['token'])

    def test_validation_and_active_native_reviewer(self):
        for patch in [{'scope':'permanent','newPerDay':True}, {'scope':'today','newMix':1}, {'scope':'today','newPerDay':-1}]:
            with self.assertRaises(ValueError):
                self.save(patch)
        busy = module.NativeBridge(self.col, busy=lambda:True)
        with self.assertRaisesRegex(ValueError, 'Leave the active'):
            busy.queue('Anime')

    def test_native_review_limit_is_enforced(self):
        ids = self.col.find_cards('deck:Anime')
        for cid in ids:
            card = self.col.get_card(cid)
            card.type = 2
            card.queue = 2
            card.due = self.col.sched.today
            card.ivl = 10
            self.col.update_card(card)
        self.save({'scope':'permanent','reviewsPerDay':1,'newPerDay':0})
        q = self.bridge.queue('Anime')
        self.assertEqual(q['remaining']['reviews'], 1)
        self.bridge.answer('Anime', q['cardIds'][0], 4, q['token'])
        self.assertEqual(self.bridge.queue('Anime')['cardIds'], [])
        self.assertEqual(self.bridge.options('Anime')['completed']['reviews'], 1)

    def test_parent_caps_follow_native_collection_setting(self):
        child = self.col.decks.id('Anime::Child')
        for cid in self.col.find_cards('deck:Anime'):
            card = self.col.get_card(cid)
            card.did = child
            self.col.update_card(card)
        self.save({'scope':'permanent','newPerDay':1})
        out = self.bridge.options('Anime::Child')
        self.assertEqual(out['remaining']['new'], 5)  # Anki defaults to no ancestor caps when selecting a child.
        from anki.deck_config_pb2 import UpdateDeckConfigsRequest
        native = self.col.decks.get_deck_configs_for_update(child)
        config = next(x.config for x in native.all_config if x.config.id == native.current_deck.config_id)
        self.col.decks.update_deck_configs(UpdateDeckConfigsRequest(target_deck_id=child,configs=[config],limits=native.current_deck.limits,apply_all_parent_limits=True))
        self.assertEqual(self.bridge.options('Anime::Child')['remaining']['new'], 1)
        self.save({'scope':'permanent','reviewsPerDay':100})
        self.assertTrue(self.col.decks.get_deck_configs_for_update(self.did).apply_all_parent_limits)

    def test_undo_preserves_other_config_and_restores_shared_assignment(self):
        old = self.col.decks.config_dict_for_deck_id(self.did)
        self.save({'scope':'permanent','newMix':2,'buryNew':True})
        self.col.undo()
        self.assertEqual(self.col.decks.config_dict_for_deck_id(self.did), old)
        self.assertEqual(self.col.decks.config_dict_for_deck_id(self.other), old)

    def test_note_and_card_history_not_reset_by_option_changes(self):
        q = self.bridge.queue('Anime')
        self.bridge.answer('Anime', q['cardIds'][0], 4, q['token'])
        before = self.col.get_card(q['cardIds'][0])
        self.save({'scope':'permanent','reviewsPerDay':400,'newPerDay':50})
        after = self.col.get_card(before.id)
        self.assertEqual((before.reps,before.ivl,before.due),(after.reps,after.ivl,after.due))
        self.assertEqual(self.col.card_count(), 5)

    def test_external_anki_options_change_invalidates_pending_review(self):
        q = self.bridge.queue('Anime')
        deck = self.col.decks.get(self.did)
        deck['newLimit'] = 2
        self.col.decks.update_dict(deck)
        with self.assertRaisesRegex(ValueError, 'Deck options changed'):
            self.bridge.answer('Anime', q['cardIds'][0], 4, q['token'])
        self.assertEqual(self.bridge.options('Anime')['completed']['new'], 0)

    def test_native_undo_restores_limits(self):
        self.save({'scope':'permanent','newPerDay':1})
        self.col.undo()
        self.assertEqual(self.bridge.options('Anime')['permanent']['newPerDay'], 20)

    def test_new_deck_option_keys_round_trip(self):
        values = {'learnSteps': [1, 10, 0.5], 'relearnSteps': [15], 'graduatingInterval': 2, 'easyInterval': 5,
                  'startingEase': 230, 'newGatherOrder': 2, 'newSortOrder': 1, 'reviewOrder': 3, 'interdayLearningMix': 2,
                  'newMix': 2, 'maxInterval': 3650, 'easyBonus': 130, 'intervalModifier': 90, 'hardInterval': 120,
                  'lapseNewInterval': 50, 'lapseMinInterval': 2, 'leechThreshold': 6, 'leechAction': 1, 'buryNew': False,
                  'buryReviews': False, 'buryLearning': True, 'disableAutoplay': True, 'skipQuestionWhenReplayingAnswer': True,
                  'maxAnswerSecs': 45, 'showTimer': True, 'stopTimerOnAnswer': True, 'fsrs': True, 'desiredRetention': 0.85}
        self.save({'scope': 'permanent', **values})
        permanent = self.bridge.options('Anime')['permanent']
        for key, value in values.items():
            self.assertEqual(permanent[key], value, key)
        self.assertEqual(self.bridge.options('Anime')['permanent']['newPerDay'], 20)

    def test_preset_create_assign_rename_remove(self):
        self.save({'scope': 'permanent', 'newPreset': {'name': 'Kanji', 'cloneCurrent': False}, 'graduatingInterval': 3})
        out = self.bridge.options('Anime')
        kanji = next(p for p in out['presets'] if p['name'] == 'Kanji')
        self.assertEqual(out['presetId'], kanji['id'])
        self.assertEqual(out['permanent']['graduatingInterval'], 3)
        self.assertEqual(self.bridge.options('Other')['presetId'], 1)
        self.save({'scope': 'permanent', 'renamePreset': {'id': kanji['id'], 'name': 'Kanji 2'}})
        self.assertIn('Kanji 2', [p['name'] for p in self.bridge.options('Anime')['presets']])
        self.save({'scope': 'permanent', 'presetId': 1})
        self.assertEqual(self.bridge.options('Anime')['presetId'], 1)
        self.save({'scope': 'permanent', 'removePreset': kanji['id']})
        self.assertNotIn(kanji['id'], [p['id'] for p in self.bridge.options('Anime')['presets']])
        with self.assertRaises(ValueError):
            self.save({'scope': 'permanent', 'removePreset': 1})

    def test_removing_assigned_preset_moves_deck_to_default(self):
        self.save({'scope': 'permanent', 'newPreset': {'name': 'Temp', 'cloneCurrent': True}})
        temp = self.bridge.options('Anime')['presetId']
        self.save({'scope': 'permanent', 'removePreset': temp})
        out = self.bridge.options('Anime')
        self.assertEqual(out['presetId'], 1)
        self.assertEqual(self.bridge.options('Other')['presetId'], 1)

    def test_clone_current_copies_values_and_new_preset_edits_leave_shared_preset(self):
        self.save({'scope': 'permanent', 'learnSteps': [2, 20], 'buryNew': True})
        shared = self.col.decks.config_dict_for_deck_id(self.other)
        self.save({'scope': 'permanent', 'newPreset': {'name': 'Copy', 'cloneCurrent': True}, 'newMix': 2})
        out = self.bridge.options('Anime')
        self.assertEqual(out['permanent']['learnSteps'], [2, 20])
        self.assertEqual(out['permanent']['newMix'], 2)
        self.assertEqual(self.col.decks.config_dict_for_deck_id(self.other), shared)

    def test_apply_to_children_assigns_new_preset_to_subdecks(self):
        child = self.col.decks.id('Anime::Child')
        self.save({'scope': 'permanent', 'newPreset': {'name': 'Tree', 'cloneCurrent': False}, 'applyToChildren': True})
        tree = self.bridge.options('Anime')['presetId']
        self.assertEqual(self.col.decks.config_dict_for_deck_id(child)['id'], tree)

    def test_revision_changes_with_presets_and_new_fields(self):
        revision = self.bridge.options('Anime')['revision']
        self.save({'scope': 'permanent', 'leechThreshold': 9})
        self.assertNotEqual(self.bridge.options('Anime')['revision'], revision)
        with self.assertRaisesRegex(ValueError, 'Reload'):
            self.bridge.save('Anime', {'scope': 'permanent', 'newPerDay': 4}, revision)
        revision = self.bridge.options('Anime')['revision']
        self.save({'scope': 'permanent', 'newPreset': {'name': 'Second', 'cloneCurrent': False}})
        self.assertNotEqual(self.bridge.options('Anime')['revision'], revision)

    def test_invalid_deck_option_inputs_are_rejected_without_writing(self):
        before = self.bridge.options('Anime')
        bad = [
            {'scope': 'permanent', 'learnSteps': [0]}, {'scope': 'permanent', 'learnSteps': [1] * 11},
            {'scope': 'permanent', 'learnSteps': ['1']}, {'scope': 'permanent', 'relearnSteps': [525601]},
            {'scope': 'permanent', 'graduatingInterval': 0}, {'scope': 'permanent', 'easyInterval': 366},
            {'scope': 'permanent', 'startingEase': 129}, {'scope': 'permanent', 'easyBonus': 99},
            {'scope': 'permanent', 'intervalModifier': 201}, {'scope': 'permanent', 'hardInterval': 99},
            {'scope': 'permanent', 'lapseNewInterval': 101}, {'scope': 'permanent', 'lapseMinInterval': 0},
            {'scope': 'permanent', 'leechThreshold': 10000}, {'scope': 'permanent', 'leechAction': 2},
            {'scope': 'permanent', 'newGatherOrder': 6}, {'scope': 'permanent', 'newSortOrder': 5},
            {'scope': 'permanent', 'reviewOrder': 12}, {'scope': 'permanent', 'maxInterval': 36501},
            {'scope': 'permanent', 'maxAnswerSecs': 3601}, {'scope': 'permanent', 'showTimer': 1},
            {'scope': 'permanent', 'desiredRetention': 0.69}, {'scope': 'permanent', 'desiredRetention': 0.9},
            {'scope': 'permanent', 'fsrs': 'yes'}, {'scope': 'permanent', 'presetId': 0},
            {'scope': 'permanent', 'removePreset': 1}, {'scope': 'permanent', 'presetId': 1, 'newPreset': {'name': 'x', 'cloneCurrent': False}},
            {'scope': 'permanent', 'newPreset': {'name': '  ', 'cloneCurrent': False}},
            {'scope': 'permanent', 'renamePreset': {'id': 1, 'name': 'x'}, 'newMix': 1},
            {'scope': 'permanent', 'unknownKey': 1}, {'scope': 'today', 'learnSteps': [1]},
        ]
        for patch in bad:
            with self.assertRaises(ValueError, msg=str(patch)):
                self.save(patch)
        self.assertEqual(self.bridge.options('Anime'), before)

    def test_fsrs_toggle_changes_only_when_asked(self):
        self.assertFalse(self.bridge.options('Anime')['permanent']['fsrs'])
        self.save({'scope': 'permanent', 'newMix': 1})
        self.assertFalse(self.bridge.options('Anime')['permanent']['fsrs'])
        self.save({'scope': 'permanent', 'fsrs': True, 'desiredRetention': 0.85})
        self.assertTrue(self.bridge.options('Anime')['permanent']['fsrs'])
        self.save({'scope': 'permanent', 'reviewsPerDay': 50})
        self.assertTrue(self.bridge.options('Anime')['permanent']['fsrs'])
        self.assertEqual(self.bridge.options('Anime')['permanent']['desiredRetention'], 0.85)
        self.save({'scope': 'permanent', 'fsrs': False})
        self.assertFalse(self.bridge.options('Anime')['permanent']['fsrs'])

    def test_desired_retention_requires_fsrs(self):
        before = self.bridge.options('Anime')
        with self.assertRaisesRegex(ValueError, 'FSRS'):
            self.save({'scope': 'permanent', 'desiredRetention': 0.9})
        self.assertEqual(self.bridge.options('Anime'), before)


if __name__ == '__main__':
    unittest.main()

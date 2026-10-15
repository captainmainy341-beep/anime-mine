"""Native Anki APIs only; no collection SQL and no separate review scheduler."""
import copy
import hashlib
import json
import time
import uuid
from contextlib import contextmanager


LIMITS = {
    'newPerDay': (0, 9999), 'reviewsPerDay': (0, 9999), 'graduatingInterval': (1, 365), 'easyInterval': (1, 365),
    'startingEase': (130, 999), 'maxInterval': (1, 36500), 'easyBonus': (100, 1000), 'intervalModifier': (50, 200),
    'hardInterval': (100, 200), 'lapseNewInterval': (0, 100), 'lapseMinInterval': (1, 365), 'leechThreshold': (1, 9999),
    'maxAnswerSecs': (0, 3600),
}
ENUMS = {
    'newMix': (0, 1, 2), 'interdayLearningMix': (0, 1, 2), 'newGatherOrder': (0, 1, 2, 3, 4, 5),
    'newSortOrder': (0, 1, 2, 3, 4), 'reviewOrder': tuple(range(12)), 'leechAction': (0, 1),
}
BOOLS = {
    'buryNew', 'buryReviews', 'buryLearning', 'disableAutoplay', 'skipQuestionWhenReplayingAnswer',
    'showTimer', 'stopTimerOnAnswer', 'fsrs', 'applyToChildren',
}
STEP_KEYS = ('learnSteps', 'relearnSteps')
SCALED = {'startingEase': 'initial_ease', 'easyBonus': 'easy_multiplier', 'intervalModifier': 'interval_multiplier',
          'hardInterval': 'hard_multiplier', 'lapseNewInterval': 'lapse_multiplier'}
FIELDS = {
    'newMix': 'new_mix', 'interdayLearningMix': 'interday_learning_mix', 'newGatherOrder': 'new_card_gather_priority',
    'newSortOrder': 'new_card_sort_order', 'reviewOrder': 'review_order', 'buryNew': 'bury_new', 'buryReviews': 'bury_reviews',
    'buryLearning': 'bury_interday_learning', 'learnSteps': 'learn_steps', 'relearnSteps': 'relearn_steps',
    'graduatingInterval': 'graduating_interval_good', 'easyInterval': 'graduating_interval_easy',
    'maxInterval': 'maximum_review_interval', 'lapseMinInterval': 'minimum_lapse_interval',
    'leechThreshold': 'leech_threshold', 'leechAction': 'leech_action', 'disableAutoplay': 'disable_autoplay',
    'skipQuestionWhenReplayingAnswer': 'skip_question_when_replaying_answer', 'maxAnswerSecs': 'cap_answer_time_to_secs',
    'showTimer': 'show_timer', 'stopTimerOnAnswer': 'stop_timer_on_answer', 'desiredRetention': 'desired_retention',
}
PRESET_KEYS = {'presetId', 'newPreset', 'renamePreset', 'removePreset'}
QUEUE_SCAN = 50


def _steps_ok(value):
    return isinstance(value, list) and len(value) <= 10 and all(
        type(x) in (int, float) and 0 < x <= 1440 * 365 for x in value)


def _name_ok(value):
    return isinstance(value, str) and 0 < len(value.strip()) <= 80


class NativeBridge:
    def __init__(self, collection, busy=lambda: False):
        self.col = collection
        self.busy = busy
        self.pending = {}

    def _deck(self, name):
        if self.busy():
            raise ValueError("Leave the active Anki review/options screen before using Anime Mine.")
        if not isinstance(name, str) or not name:
            raise ValueError("Choose a deck")
        deck = self.col.decks.by_name(name)
        if not deck or deck['name'] != name:
            raise ValueError("Deck not found")
        if deck.get('dyn'):
            raise ValueError("Filtered decks must be managed in Anki")
        if not hasattr(self.col.sched, 'get_queued_cards'):
            raise ValueError("Anki's native V3 scheduler is required")
        return deck

    @contextmanager
    def _selected(self, did):
        # Match Anki's deck picker. Do not create a select/restore undo operation on every read.
        if self.col.decks.selected() != did:
            self.col.decks.select(did)
        yield

    def _native(self, deck):
        native = self.col.decks.get_deck_configs_for_update(deck['id'])
        current = next(c for c in native.all_config if c.config.id == native.current_deck.config_id)
        return native, current

    @staticmethod
    def _config_values(config):
        values = {}
        for key, field in FIELDS.items():
            value = getattr(config, field)
            values[key] = [round(x, 4) for x in value] if key in STEP_KEYS else round(value, 4) if key == 'desiredRetention' else value
        for key, field in SCALED.items():
            values[key] = round(getattr(config, field) * 100)
        return values

    def _revision(self, deck, config):
        relevant = {key: deck.get(key) for key in ('conf', 'newLimit', 'reviewLimit', 'newLimitToday', 'reviewLimitToday')}
        relevant['config'] = config
        relevant['day'] = self.col.sched.today
        native, current = self._native(deck)
        relevant['collection'] = {key: getattr(native, key) for key in ('fsrs', 'card_state_customizer', 'new_cards_ignore_review_limit', 'apply_all_parent_limits')}
        relevant['native'] = self._config_values(current.config.config)
        relevant['presets'] = sorted((c.config.id, c.config.name, c.use_count) for c in native.all_config)
        return hashlib.sha256(json.dumps(relevant, sort_keys=True).encode()).hexdigest()

    def options(self, name, visible_decks):
        deck = self._deck(name)
        config = self.col.decks.config_dict_for_deck_id(deck['id'])
        today = self.col.sched.today
        def override(key):
            value = deck.get(key)
            return value['limit'] if value and value.get('today') == today else None
        def count(key):
            value = deck.get(key, [today, 0])
            return value[1] if value[0] == today else 0
        with self._selected(deck['id']):
            queue = self.col.sched.get_queued_cards(fetch_limit=1)
        native, current = self._native(deck)
        visible = set(visible_decks)
        used = {d.get('conf') for d in self.col.decks.all() if d['name'] in visible} | {current.config.id}
        permanent = {
            'newPerDay': deck.get('newLimit') if deck.get('newLimit') is not None else config['new']['perDay'],
            'reviewsPerDay': deck.get('reviewLimit') if deck.get('reviewLimit') is not None else config['rev']['perDay'],
            **self._config_values(current.config.config),
            'fsrs': native.fsrs,
        }
        return {
            'deck': name, 'native': True, 'preset': config['name'], 'presetId': current.config.id,
            'presets': [{'id': c.config.id, 'name': c.config.name, 'useCount': c.use_count} for c in native.all_config if c.config.id in used],
            'sharedPreset': sum(d.get('conf') == deck.get('conf') for d in self.col.decks.all()) > 1,
            'revision': self._revision(deck, config), 'permanent': permanent,
            'today': {'newPerDay': override('newLimitToday'), 'reviewsPerDay': override('reviewLimitToday')},
            'completed': {'new': count('newToday'), 'reviews': count('revToday'), 'learning': count('lrnToday')},
            'remaining': {'new': queue.new_count, 'reviews': queue.review_count, 'learning': queue.learning_count},
            'day': today, 'rollover': self.col.sched.day_cutoff,
        }

    @staticmethod
    def validate(patch):
        if not isinstance(patch, dict) or patch.get('scope') not in ('permanent', 'today'):
            raise ValueError('Choose permanent or today-only limits')
        if patch['scope'] == 'today':
            allowed = {'scope', 'newPerDay', 'reviewsPerDay', 'clearToday'}
        else:
            allowed = {'scope'} | set(LIMITS) | set(ENUMS) | BOOLS | set(STEP_KEYS) | set(SCALED) | set(FIELDS) | PRESET_KEYS
        if set(patch) - allowed:
            raise ValueError('Unsupported deck option')
        for key in ('clearToday',) + tuple(sorted(BOOLS)):
            if key in patch and type(patch[key]) is not bool:
                raise ValueError(f'{key} must be true or false')
        for key, (low, high) in LIMITS.items():
            if key in patch and (type(patch[key]) is not int or not low <= patch[key] <= high):
                raise ValueError(f'{key} must be a whole number from {low} to {high}')
        for key, options in ENUMS.items():
            if key in patch and (type(patch[key]) is not int or patch[key] not in options):
                raise ValueError(f'Invalid value for {key}')
        for key in STEP_KEYS:
            if key in patch and not _steps_ok(patch[key]):
                raise ValueError(f'{key} must be up to 10 positive step lengths in minutes')
        if 'desiredRetention' in patch and (type(patch['desiredRetention']) not in (int, float) or not 0.7 <= patch['desiredRetention'] <= 0.99):
            raise ValueError('desiredRetention must be from 0.7 to 0.99')
        if 'presetId' in patch and (type(patch['presetId']) is not int or patch['presetId'] < 1):
            raise ValueError('presetId must be a preset id')
        if 'newPreset' in patch:
            new = patch['newPreset']
            if not isinstance(new, dict) or set(new) != {'name', 'cloneCurrent'} or type(new['cloneCurrent']) is not bool or not _name_ok(new['name']):
                raise ValueError('newPreset needs a name and cloneCurrent')
        if 'renamePreset' in patch:
            rename = patch['renamePreset']
            if not isinstance(rename, dict) or set(rename) != {'id', 'name'} or type(rename['id']) is not int or not _name_ok(rename['name']):
                raise ValueError('renamePreset needs an id and name')
        if 'removePreset' in patch and (type(patch['removePreset']) is not int or patch['removePreset'] < 2):
            raise ValueError('removePreset must be a preset id other than the default')
        if len(set(patch) & {'presetId', 'newPreset'}) > 1:
            raise ValueError('Choose one preset to assign')
        if (set(patch) & {'renamePreset', 'removePreset'}) and len(set(patch) - {'scope'}) > 1:
            raise ValueError('Rename or remove a preset on its own')
        if patch.get('clearToday') and ('newPerDay' in patch or 'reviewsPerDay' in patch):
            raise ValueError('Clear today or set limits, not both')

    def save(self, name, patch, expected_revision, visible_decks):
        self.validate(patch)
        deck = self._deck(name)
        config = self.col.decks.config_dict_for_deck_id(deck['id'])
        if expected_revision != self._revision(deck, config):
            raise ValueError('Deck options changed in Anki. Reload before saving.')
        from anki.deck_config_pb2 import UpdateDeckConfigsRequest, UpdateDeckConfigsMode
        native, current = self._native(deck)
        fsrs = patch.get('fsrs', native.fsrs)
        if 'desiredRetention' in patch and not fsrs:
            raise ValueError('Desired retention needs FSRS on')
        limits = copy.deepcopy(native.current_deck.limits)
        configs, removed = [copy.deepcopy(current.config)], []
        mode = UpdateDeckConfigsMode.UPDATE_DECK_CONFIGS_MODE_NORMAL
        if patch['scope'] == 'today':
            for key, field in (('newPerDay', 'new_today'), ('reviewsPerDay', 'review_today')):
                if patch.get('clearToday'):
                    limits.ClearField(field)
                    setattr(limits, field + '_active', False)
                elif key in patch:
                    setattr(limits, field, patch[key])
                    setattr(limits, field + '_active', True)
        else:
            for key, field in (('newPerDay', 'new'), ('reviewsPerDay', 'review')):
                if key in patch:
                    setattr(limits, field, patch[key])
            visible = set(visible_decks)
            if patch.get('applyToChildren') and any(child not in visible for child, _ in self.col.decks.children(deck['id'])):
                raise ValueError('Apply to children needs every subdeck visible')
            if 'renamePreset' in patch:
                self._require_visible_users(patch['renamePreset']['id'], visible)
            if 'removePreset' in patch:
                self._require_visible_users(patch['removePreset'], visible)
            configs, removed = self._configs(native, current, patch, name)
            if patch.get('applyToChildren'):
                mode = UpdateDeckConfigsMode.UPDATE_DECK_CONFIGS_MODE_APPLY_TO_CHILDREN
        request = UpdateDeckConfigsRequest(
            target_deck_id=deck['id'], configs=configs, removed_config_ids=removed, mode=mode, limits=limits,
            card_state_customizer=native.card_state_customizer,
            new_cards_ignore_review_limit=native.new_cards_ignore_review_limit,
            fsrs=fsrs, apply_all_parent_limits=native.apply_all_parent_limits,
            fsrs_health_check=native.fsrs_health_check,
        )
        # One native atomic, undoable operation preserves all unrelated config/global fields.
        self.col.decks.update_deck_configs(request)
        self.pending.clear()
        return self.options(name)

    def _first_visible(self, cards, visible_decks):
        return next((q for q in cards if self.col.decks.name(self.col.get_card(q.card.id).current_deck_id()) in visible_decks), None)

    def _require_visible_users(self, conf_id, visible):
        if any(d.get('conf') == conf_id and d['name'] not in visible for d in self.col.decks.all()):
            raise ValueError('Preset is used by hidden decks')

    @staticmethod
    def _configs(native, current, patch, name):
        extra = {c.config.id: c for c in native.all_config}
        target = copy.deepcopy(current.config)
        configs, removed = [], []
        if 'renamePreset' in patch:
            rename = patch['renamePreset']
            if rename['id'] not in extra:
                raise ValueError('Preset not found')
            renamed = copy.deepcopy(extra[rename['id']].config)
            renamed.name = rename['name'].strip()
            if renamed.id == target.id:
                target = renamed
            else:
                configs.append(renamed)
        if 'removePreset' in patch:
            if patch['removePreset'] not in extra:
                raise ValueError('Preset not found')
            removed.append(patch['removePreset'])
            if target.id == patch['removePreset']:
                target = copy.deepcopy(extra[1].config)
        if 'presetId' in patch:
            if patch['presetId'] not in extra:
                raise ValueError('Preset not found')
            target = copy.deepcopy(extra[patch['presetId']].config)
        elif 'newPreset' in patch:
            created = patch['newPreset']
            target = copy.deepcopy(current.config if created['cloneCurrent'] else native.defaults)
            target.id = 0
            target.name = created['name'].strip()
        edited = copy.deepcopy(target)
        for key, value in patch.items():
            if key in SCALED:
                setattr(edited.config, SCALED[key], value / 100)
            elif key in STEP_KEYS:
                steps = getattr(edited.config, FIELDS[key])
                del steps[:]
                steps.extend(value)
            elif key in FIELDS:
                setattr(edited.config, FIELDS[key], value)
        if edited.config != target.config and target.id in extra and extra[target.id].use_count > 1 and not PRESET_KEYS & set(patch):
            edited.id = 0
            edited.name = 'Anime Mine: ' + name
        configs.append(edited)
        return configs, removed

    def queue(self, name, visible_decks):
        deck = self._deck(name)
        if self.col.decks.get_deck_configs_for_update(deck['id']).card_state_customizer:
            raise ValueError('This collection uses custom scheduling JavaScript. Review in Anki to preserve it.')
        with self._selected(deck['id']):
            queue = self.col.sched.get_queued_cards(fetch_limit=QUEUE_SCAN)
            remaining = {'new': queue.new_count, 'reviews': queue.review_count, 'learning': queue.learning_count}
            queued = self._first_visible(queue.cards, visible_decks)
            if queued is None:
                self.pending.pop(name, None)
                return {'cardIds': [], 'remaining': remaining, 'native': True}
            card = self.col.get_card(queued.card.id)
            card.start_timer()
            token = uuid.uuid4().hex
            self.pending[name] = {'token': token, 'id': card.id, 'mod': card.mod, 'day': self.col.sched.today, 'card': card, 'created': time.monotonic(), 'revision': self._revision(deck, self.col.decks.config_dict_for_deck_id(deck['id']))}
            return {'cardIds': [card.id], 'token': token, 'remaining': remaining, 'native': True,
                    'intervals': list(self.col.sched.describe_next_states(queued.states))}

    def answer(self, name, card_id, ease, token, visible_decks):
        deck = self._deck(name)
        if type(ease) is not int or ease not in (1, 2, 3, 4):
            raise ValueError('ease must be 1-4')
        pending = self.pending.get(name)
        if not pending or pending['token'] != token or pending['id'] != card_id:
            raise ValueError('Review expired. Start a new session.')
        if pending['day'] != self.col.sched.today or time.monotonic() - pending['created'] > 3600:
            self.pending.pop(name, None)
            raise ValueError('Review expired. Start a new session.')
        if pending['revision'] != self._revision(deck, self.col.decks.config_dict_for_deck_id(deck['id'])):
            self.pending.pop(name, None)
            raise ValueError('Deck options changed in Anki. Start a new session.')
        if self.col.decks.name(self.col.get_card(card_id).current_deck_id()) not in visible_decks:
            raise ValueError('Deck is hidden')
        with self._selected(deck['id']):
            queue = self.col.sched.get_queued_cards(fetch_limit=QUEUE_SCAN)
            queued = self._first_visible(queue.cards, visible_decks)
            if queued is None or queued.card.id != card_id or self.col.get_card(card_id).mod != pending['mod']:
                self.pending.pop(name, None)
                raise ValueError('The queue changed in Anki. Start a new session.')
            answer = self.col.sched.build_answer(card=pending['card'], states=queued.states, rating=ease - 1)
            self.col.sched.answer_card(answer)
        self.pending.pop(name, None)
        return {'ok': True}

"""Study queue API contract, without importing Anki's GUI or opening a profile."""
import ast
from pathlib import Path
import unittest
from unittest.mock import Mock


class StudyQueueContractTests(unittest.TestCase):
    def setUp(self):
        source = Path(__file__).parents[1] / 'anki-addon/anime_mine_bridge/__init__.py'
        tree = ast.parse(source.read_text())
        method = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'animeMineStudyQueue')
        self.native = Mock()
        namespace = {'bridge': lambda: self.native}
        exec(compile(ast.Module(body=[method], type_ignores=[]), str(source), 'exec'), namespace)
        self.queue = namespace['animeMineStudyQueue']

    def test_queue_forwards_explicit_scope_and_result(self):
        self.native.queue.return_value = {'cardIds': [123]}
        result = self.queue(None, deck='Anime', visibleDecks=['Anime'])
        self.native.queue.assert_called_once_with('Anime', ['Anime'])
        self.assertEqual(result, {'cardIds': [123]})

    def test_empty_scope_stays_empty(self):
        self.queue(None, deck='Anime', visibleDecks=[])
        self.native.queue.assert_called_once_with('Anime', [])

    def test_missing_scope_fails_closed(self):
        with self.assertRaises(TypeError):
            self.queue(None, deck='Anime')
        self.native.queue.assert_not_called()


if __name__ == '__main__':
    unittest.main()

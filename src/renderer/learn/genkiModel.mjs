// Pure helpers that let the Genki path show up outside the Story tab (Learn home, grammar pages).

// Where the learner is on the path: the first lesson whose primer or story is unfinished.
export function pathProgress(data) {
  const lessons = [...(data?.lessons ?? [])].sort((a, b) => a.lesson - b.lesson);
  const isDone = (row) => row.learned && (row.storyDone || !row.hasStory);
  const next = lessons.find((row) => !isDone(row)) ?? null;
  const done = lessons.filter(isDone).length;
  return { lessons, next, done, total: lessons.length, complete: lessons.length > 0 && !next };
}

// What the main button on the home card does for the next lesson.
export function nextAction(row) {
  if (!row) return null;
  if (!row.learned) return { label: row.lesson === 1 ? 'Start Lesson 1' : `Start Lesson ${row.lesson}`, hint: `${row.minutes} min · ${row.words} words · ${row.patterns} patterns`, target: { lesson: row.id } };
  return { label: 'Play the story', hint: 'Use what you just learned in a scene', target: { play: row.id } };
}

// Genki lessons that teach a grammar point, for the "In Genki" link on a grammar page.
export function lessonsForPoint(data, pointId) {
  return [...(data?.points?.[pointId] ?? [])].sort((a, b) => a.lesson - b.lesson);
}

export function lessonLabel(entry) {
  return `Genki Lesson ${entry.lesson} · ${entry.title}`;
}

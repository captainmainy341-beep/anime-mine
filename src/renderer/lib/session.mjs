function questionTypes(card) {
  if (card.kind === 'radical') return ['meaning'];
  if (card.kind === 'grammar') return ['cloze'];
  return card.reading ? ['meaning', 'reading'] : ['meaning'];
}

export function createSession({ cards, batchSize = 10, rng = Math.random }) {
  const items = cards.map((card) => {
    const item = { id: card.id, card, incorrectCount: 0, remaining: 0, done: false };
    item.questions = questionTypes(card).map((type) => ({ item, type, answered: false }));
    item.remaining = item.questions.length;
    return item;
  });

  const queue = [];
  const results = [];
  let cur = null;
  let lastWrong = null;
  let last = null;
  let nextUnseen = 0;
  let itemsDone = 0;
  let questionsAnswered = 0;
  let correct = 0;
  let incorrect = 0;

  function enter(item) {
    queue.push(...item.questions);
  }

  function enterNext() {
    if (nextUnseen < items.length) enter(items[nextUnseen++]);
  }

  for (let i = 0; i < Math.min(batchSize, items.length); i++) enterNext();

  function pick() {
    if (cur) return cur;
    if (queue.length === 0) return null;
    let candidates = queue.map((_, i) => i).filter((i) => queue[i] !== lastWrong);
    if (candidates.length === 0) candidates = queue.map((_, i) => i);
    const idx = candidates[Math.floor(rng() * candidates.length)];
    cur = queue.splice(idx, 1)[0];
    lastWrong = null;
    return cur;
  }

  function isFinished() {
    return itemsDone === items.length;
  }

  function settle(question) {
    question.answered = true;
    questionsAnswered += 1;
    const { item } = question;
    item.remaining -= 1;
    if (item.remaining === 0) {
      item.done = true;
      itemsDone += 1;
      results.push({ id: item.id, incorrectCount: item.incorrectCount });
      enterNext();
      return { itemId: item.id, itemDone: true, incorrectCount: item.incorrectCount, finished: isFinished() };
    }
    return { itemId: item.id, itemDone: false, incorrectCount: null, finished: isFinished() };
  }

  function current() {
    const question = pick();
    if (!question) return null;
    return { card: question.item.card, question: question.type, wrongForItem: question.item.incorrectCount };
  }

  function answer(result) {
    if (result !== 'correct' && result !== 'incorrect') {
      throw new Error(`Unknown answer: ${result}`);
    }
    const question = pick();
    if (!question) throw new Error('Session is finished');
    cur = null;
    last = null;
    if (result === 'correct') {
      correct += 1;
      return settle(question);
    }
    question.item.incorrectCount += 1;
    incorrect += 1;
    queue.push(question);
    lastWrong = question;
    last = question;
    return { itemId: question.item.id, itemDone: false, incorrectCount: null, finished: false };
  }

  function overrideLast() {
    if (!last) throw new Error('No incorrect answer to override');
    const question = last;
    last = null;
    question.item.incorrectCount -= 1;
    incorrect -= 1;
    correct += 1;
    if (cur === question) {
      cur = null;
    } else {
      queue.splice(queue.indexOf(question), 1);
    }
    if (lastWrong === question) lastWrong = null;
    return settle(question);
  }

  function progress() {
    const attempts = correct + incorrect;
    return {
      itemsDone,
      itemsTotal: items.length,
      questionsAnswered,
      correct,
      incorrect,
      accuracy: attempts ? correct / attempts : null,
    };
  }

  return {
    current,
    answer,
    overrideLast,
    progress,
    results: () => results.map((r) => ({ ...r })),
    isFinished,
  };
}

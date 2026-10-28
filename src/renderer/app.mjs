import { mountAnki } from './anki.mjs';
import { mountLearn } from './learn.mjs';
import { mountLibrary } from './library.mjs';
import { mountManga } from './manga.mjs';
import { mountPlayer } from './player.mjs';
import { mountSettings } from './settings.mjs';
import { mountVocab } from './vocab.mjs';

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const navButtons = [...nav.querySelectorAll('button')];
let unmountView = null;

const routes = {
  library: (container) => mountLibrary(container, { onPlay: (episode) => go('player', episode) }),
  player: (container, episode) =>
    mountPlayer(container, episode, {
      onBack: () => go('library'),
      onOpenSettings: () => go('settings'),
      onPlayEpisode: (next) => go('player', next),
    }),
  anki: mountAnki,
  learn: (container) => mountLearn(container, { onWatch: watchScene }),
  manga: mountManga,
  vocab: mountVocab,
  settings: mountSettings,
};

async function watchScene({ videoPath, start }) {
  await window.api.progress.update({ videoPath, patch: { position: Math.max(0, start - 2) } });
  const shows = await window.api.library.getShows();
  const episode = shows.flatMap((show) => show.episodes).find((candidate) => candidate.path === videoPath);
  go('player', episode ?? { path: videoPath, name: videoPath.split(/[\\/]/).pop() });
}

function go(name, arg) {
  if (unmountView?.canLeave && !unmountView.canLeave()) return;
  unmountView?.();
  view.replaceChildren();
  unmountView = routes[name](view, arg);
  const navName = name === 'player' ? 'library' : name;
  for (const button of navButtons) {
    const active = button.dataset.route === navName;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

for (const button of navButtons) {
  button.addEventListener('click', () => go(button.dataset.route));
}

go('library');

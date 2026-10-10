import { mountAnki } from './anki.mjs';
import { mountLibrary } from './library.mjs';
import { mountPlayer } from './player.mjs';
import { mountSettings } from './settings.mjs';

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
  settings: mountSettings,
};

function go(name, arg) {
  unmountView?.();
  view.replaceChildren();
  unmountView = routes[name](view, arg);
  const navName = name === 'player' ? 'library' : name;
  for (const button of navButtons) {
    button.classList.toggle('active', button.dataset.route === navName);
  }
}

for (const button of navButtons) {
  button.addEventListener('click', () => go(button.dataset.route));
}

go('library');

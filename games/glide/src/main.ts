import './ui/styles.css';
import { Game } from './game/game';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

const root = document.getElementById('app')!;

if (!webglAvailable()) {
  const msg = document.createElement('div');
  msg.className = 'nogl';
  msg.innerHTML = 'WebGL2 が利用できないため起動できません。<br />WebGL2 is required to run CONTOUR GLIDE.';
  document.body.appendChild(msg);
} else if (new URLSearchParams(location.search).has('selftest')) {
  void import('./debug/selftest').then((m) => m.runSelfTest(root));
} else {
  const game = new Game(root);
  game.start();
  (window as unknown as { __game: Game }).__game = game;
}

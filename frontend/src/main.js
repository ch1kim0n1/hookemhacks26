import { render } from 'lit-html';
import { app } from './components/app.js';
import { initAnimations } from './lib/animations.js';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Missing #app root');
}

render(app(), root);

// Initialize scroll/reveal/graph animations after the first paint so lit-html
// has committed the DOM tree. Running in rAF avoids measuring stale layout.
requestAnimationFrame(() => initAnimations());

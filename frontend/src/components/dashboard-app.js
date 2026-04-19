import { html } from 'lit-html';
import { store } from './dashboard/state.js';
import { shell } from './dashboard/shell.js';
import { loginView } from './dashboard/login.js';
import { overviewView } from './dashboard/views/overview.js';
import { attacksView } from './dashboard/views/attacks.js';
import { registryView } from './dashboard/views/registry.js';
import { agentsView } from './dashboard/views/agents.js';
import { auditView } from './dashboard/views/audit.js';
import { settingsView } from './dashboard/views/settings.js';
import { awsView } from './dashboard/views/aws.js';

const ROUTES = {
  overview: overviewView,
  attacks: attacksView,
  registry: registryView,
  agents: agentsView,
  audit: auditView,
  settings: settingsView,
  aws: awsView,
};

export const dashboardApp = () => {
  const state = store.getState();
  if (!state.session) return loginView();
  const view = ROUTES[state.route] ?? overviewView;
  return shell(view());
};

export { store };

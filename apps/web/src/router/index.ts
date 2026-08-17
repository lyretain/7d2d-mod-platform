import { createRouter, createWebHistory } from 'vue-router';
import { can, refreshSession, session } from '../stores/session';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/setup', component: () => import('../views/SetupView.vue'), meta: { public: true } },
    { path: '/signin', component: () => import('../views/SignInView.vue'), meta: { public: true } },
    {
      path: '/',
      component: () => import('../layouts/AdminShell.vue'),
      children: [
        { path: '', redirect: '/workshop' },
        { path: 'workshop', component: () => import('../views/WorkshopView.vue'), meta: { titleKey: 'page.workshop.title', hintKey: 'page.workshop.hint' } },
        { path: 'workshop/:id', component: () => import('../views/WorkshopView.vue'), meta: { titleKey: 'page.workshop.title', hintKey: 'page.workshop.hint' } },
        { path: 'mods', component: () => import('../views/ModsView.vue'), meta: { titleKey: 'page.mods.title', hintKey: 'page.mods.hint', perm: 'catalog.write' } },
        { path: 'mods/:id', component: () => import('../views/ModsView.vue'), meta: { titleKey: 'page.mods.title', hintKey: 'page.mods.hint', perm: 'catalog.write' } },
        { path: 'packs', component: () => import('../views/PacksView.vue'), meta: { titleKey: 'page.packs.title', hintKey: 'page.packs.hint' } },
        { path: 'packs/:id', component: () => import('../views/PacksView.vue'), meta: { titleKey: 'page.packs.title', hintKey: 'page.packs.hint' } },
        { path: 'packs/:id/contents', redirect: (to) => `/packs/${to.params.id}` },
        { path: 'servers', component: () => import('../views/ServersView.vue'), meta: { titleKey: 'page.servers.title', hintKey: 'page.servers.hint' } },
        { path: 'servers/:id', component: () => import('../views/ServersView.vue'), meta: { titleKey: 'page.servers.title', hintKey: 'page.servers.hint' } },
        { path: 'ops', component: () => import('../views/OpsView.vue'), meta: { titleKey: 'page.ops.title', hintKey: 'page.ops.hint', perm: 'ops.read' } },
        { path: 'ops/:section', component: () => import('../views/OpsView.vue'), meta: { titleKey: 'page.ops.title', hintKey: 'page.ops.hint', perm: 'ops.read' } },
        { path: 'account', component: () => import('../views/AccountView.vue'), meta: { titleKey: 'page.account.title', hintKey: 'page.account.hint' } },
        { path: 'account/:section', component: () => import('../views/AccountView.vue'), meta: { titleKey: 'page.account.title', hintKey: 'page.account.hint' } }
      ]
    },
    { path: '/:pathMatch(.*)*', redirect: '/workshop' }
  ]
});

router.beforeEach(async (to) => {
  if (!session.ready) await refreshSession();
  if (!session.initialized && to.path !== '/setup') return '/setup';
  if (session.initialized && to.path === '/setup') return session.user ? '/workshop' : '/signin';
  if (to.meta.public) {
    if (session.user && to.path === '/signin') return '/workshop';
    return true;
  }
  if (!session.user) return '/signin';
  if (typeof to.meta.perm === 'string' && !can(to.meta.perm)) return '/workshop';
  return true;
});

export default router;

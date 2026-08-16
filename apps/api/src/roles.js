export const ROLES = ['superadmin', 'community', 'developer', 'user'];
export const ROLE_ALIASES = { admin: 'superadmin', viewer: 'user' };
export const ROLE_LABELS = {
  superadmin: '超级管理员',
  community: '社区管理员',
  developer: '开发者',
  user: '普通用户'
};

const PERMISSIONS = {
  'platform.manage': ['superadmin'],
  'users.manage': ['superadmin'],
  'invite.community': ['superadmin'],
  'invite.developer': ['superadmin', 'community'],
  'review.approve': ['superadmin', 'community'],
  'catalog.write': ['superadmin', 'community', 'developer'],
  'pack.publish': ['superadmin', 'community'],
  'server.manage': ['superadmin', 'community'],
  'ops.read': ['superadmin', 'community']
};

const GITHUB_REQUIRED = new Set(['invite.developer', 'review.approve', 'catalog.write', 'pack.publish', 'server.manage']);

export function normalizeRole(role) {
  return ROLE_ALIASES[role] || role;
}

export function isRole(role) {
  return ROLES.includes(normalizeRole(role));
}

export function describePrincipal(user) {
  if (!user) return null;
  const role = user.bootstrap ? 'superadmin' : normalizeRole(user.role);
  const githubBound = Boolean(user.bootstrap || user.githubId);
  return {
    id: user.id,
    username: user.username,
    role,
    bootstrap: Boolean(user.bootstrap),
    githubBound,
    githubLogin: user.githubLogin || null,
    permissions: Object.keys(PERMISSIONS).filter((perm) => can({ ...user, role }, perm))
  };
}

export function can(user, permission) {
  if (!user) return false;
  const role = user.bootstrap ? 'superadmin' : normalizeRole(user.role);
  const allowed = PERMISSIONS[permission] || [];
  if (!allowed.includes(role)) return false;
  if (role === 'community' && GITHUB_REQUIRED.has(permission) && !user.githubId && !user.bootstrap) return false;
  return true;
}

export function denyReason(user, permission) {
  if (!user) return 'Login required';
  const role = user.bootstrap ? 'superadmin' : normalizeRole(user.role);
  const allowed = PERMISSIONS[permission] || [];
  if (!allowed.includes(role)) return 'Insufficient role';
  if (role === 'community' && GITHUB_REQUIRED.has(permission) && !user.githubId && !user.bootstrap) return 'GitHub binding required';
  return null;
}

export function canInviteRole(actor, role) {
  const target = normalizeRole(role);
  if (!isRole(target) || target === 'user') return false;
  if (actor?.bootstrap) return target === 'superadmin' || target === 'community' || target === 'developer';
  if (normalizeRole(actor?.role) === 'superadmin') return target === 'community' || target === 'developer';
  if (can(actor, 'invite.developer')) return target === 'developer';
  return false;
}

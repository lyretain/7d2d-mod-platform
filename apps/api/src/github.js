export function githubAuthorizeUrl({ clientId, redirectUri, state }) {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeGithubCode({ clientId, clientSecret, code, redirectUri }) {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri })
  });
  const tokenBody = await tokenRes.json();
  if (!tokenBody.access_token) throw Object.assign(new Error('GitHub authorization failed'), { code: 'INVALID_CREDENTIALS' });
  const userRes = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${tokenBody.access_token}`, accept: 'application/vnd.github+json', 'user-agent': '7dtd-mod-platform' }
  });
  const profile = await userRes.json();
  if (!profile.id) throw Object.assign(new Error('GitHub profile was not returned'), { code: 'INVALID_CREDENTIALS' });
  return { id: String(profile.id), login: String(profile.login || '') };
}

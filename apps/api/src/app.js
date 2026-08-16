import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { prepareDiagnostic } from './diagnostics.js';
import { createAuthService } from './auth.js';
import { bearer, id, isSafeId, json, now, problem, readBody, readJson, requireFields, sha256 } from './util.js';

const ADMIN_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>7DTD Mod Platform</title><style>
body{font-family:system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;background:#111;color:#eee}h1{color:#ffb000}
section{background:#1d1d1d;padding:18px;margin:18px 0;border-radius:10px}input,textarea,button{box-sizing:border-box;width:100%;padding:9px;margin:5px 0;background:#292929;color:#fff;border:1px solid #555;border-radius:5px}button{background:#9b2f24;cursor:pointer}pre{white-space:pre-wrap;background:#080808;padding:12px;max-height:420px;overflow:auto}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
</style></head><body><h1>7DTD Mod Platform</h1><p>可部署 MVP 管理控制台</p>
<section><h2>连接</h2><input id="token" type="password" placeholder="ADMIN_TOKEN"><button onclick="loadState()">读取状态</button></section>
<section><h2>上传 Mod ZIP</h2><input id="artifact" type="file" accept=".zip"><button onclick="upload()">上传并计算哈希</button><pre id="uploadResult"></pre></section>
<section><h2>注册 Mod 版本</h2><div class="row"><input id="modId" placeholder="mod id"><input id="modName" placeholder="显示名称"><input id="modVersion" placeholder="版本"><input id="artifactSha" placeholder="artifact sha256"></div><input id="gameVersions" placeholder="游戏版本，逗号分隔"><input id="installRoots" placeholder="ZIP 顶层目录，逗号分隔"><label><input id="containsDll" type="checkbox" style="width:auto"> 包含客户端 DLL / 需要重启</label><button onclick="registerMod()">注册</button></section>
<section><h2>创建并发布 ModPack</h2><div class="row"><input id="packId" placeholder="pack id"><input id="packName" placeholder="名称"><input id="packGame" placeholder="游戏版本"><input id="packEntries" placeholder="mod@version,mod2@version"></div><button onclick="publishPack()">创建并发布</button></section>
<section><h2>状态</h2><pre id="out">尚未读取</pre></section>
<script>
const headers=()=>({'authorization':'Bearer '+document.querySelector('#token').value,'content-type':'application/json'});
async function request(url,options={}){const r=await fetch(url,options);const b=await r.json();if(!r.ok)throw new Error(JSON.stringify(b));return b}
async function loadState(){try{out.textContent=JSON.stringify(await request('/api/v1/admin/state',{headers:headers()}),null,2)}catch(e){out.textContent=e}}
async function upload(){try{const file=artifact.files[0];if(!file)throw Error('请选择 ZIP');const bytes=await file.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');const r=await request('/api/v1/artifacts/'+hash,{method:'PUT',headers:{authorization:headers().authorization,'content-type':'application/zip','x-file-name':file.name},body:bytes});artifactSha.value=hash;uploadResult.textContent=JSON.stringify(r,null,2)}catch(e){uploadResult.textContent=e}}
async function registerMod(){try{const body={id:modId.value,name:modName.value,version:modVersion.value,artifactSha:artifactSha.value,gameVersions:gameVersions.value.split(',').map(x=>x.trim()).filter(Boolean),installRoots:installRoots.value.split(',').map(x=>x.trim()).filter(Boolean),containsDll:containsDll.checked,requiresRestart:containsDll.checked};out.textContent=JSON.stringify(await request('/api/v1/mods',{method:'POST',headers:headers(),body:JSON.stringify(body)}),null,2)}catch(e){out.textContent=e}}
async function publishPack(){try{const entries=packEntries.value.split(',').map(x=>{const [modId,version]=x.trim().split('@');return{modId,version,required:true}});await request('/api/v1/packs',{method:'POST',headers:headers(),body:JSON.stringify({id:packId.value,name:packName.value,gameVersion:packGame.value,entries})});out.textContent=JSON.stringify(await request('/api/v1/packs/'+encodeURIComponent(packId.value)+'/releases',{method:'POST',headers:headers(),body:'{}'}),null,2)}catch(e){out.textContent=e}}
</script></body></html>`;

const ADMIN_HTML_V2 = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>七日杀 Mod 平台</title><style>
body{font-family:system-ui,"Microsoft YaHei",sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;background:#111;color:#eee}h1{color:#ffb000}h2{margin-top:0}
section{background:#1d1d1d;padding:18px;margin:16px 0;border-radius:10px}input,select,button{box-sizing:border-box;width:100%;padding:9px;margin:5px 0;background:#292929;color:#fff;border:1px solid #555;border-radius:5px}button{background:#9b2f24;cursor:pointer}button.secondary{background:#444}pre{white-space:pre-wrap;background:#080808;padding:12px;max-height:420px;overflow:auto}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.three{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}.status{padding:8px 12px;background:#252525;border-radius:6px}@media(max-width:700px){.row,.three{grid-template-columns:1fr}}
</style></head><body><h1>七日杀 Mod 平台</h1><p class="status" id="authStatus">尚未登录</p>
<section><h2>登录</h2><div class="row"><input id="loginUser" autocomplete="username" placeholder="用户名"><input id="loginPassword" type="password" autocomplete="current-password" placeholder="密码"></div><button onclick="login()">登录</button><button class="secondary" onclick="logout()">退出登录</button></section>
<section><h2>邀请码注册</h2><div class="three"><input id="registerUser" autocomplete="username" placeholder="用户名（3-32位）"><input id="registerPassword" type="password" autocomplete="new-password" placeholder="密码（至少10位）"><input id="registerInvite" placeholder="邀请码"></div><button onclick="register()">注册</button></section>
<section><h2>首次部署 / 邀请管理</h2><input id="bootstrapToken" type="password" placeholder="首次部署可在此填写 ADMIN_TOKEN"><div class="three"><select id="inviteRole"><option value="admin">管理员</option><option value="viewer">只读用户</option></select><input id="inviteUses" type="number" min="1" max="100" value="1" placeholder="可使用次数"><input id="inviteHours" type="number" min="1" max="8760" value="168" placeholder="有效小时"></div><button onclick="createInvite()">创建邀请码</button><pre id="inviteResult">邀请码只显示一次，请安全发送给受邀用户。</pre></section>
<section><h2>上传 Mod ZIP</h2><input id="artifact" type="file" accept=".zip"><button onclick="upload()">上传并计算哈希</button><pre id="uploadResult"></pre></section>
<section><h2>注册 Mod 版本</h2><div class="row"><input id="modId" placeholder="Mod ID"><input id="modName" placeholder="显示名称"><input id="modVersion" placeholder="版本"><input id="artifactSha" placeholder="文件 SHA-256"></div><input id="gameVersions" placeholder="游戏版本，逗号分隔，例如 3.0.1-b4"><input id="installRoots" placeholder="ZIP 顶层目录，逗号分隔"><label><input id="containsDll" type="checkbox" style="width:auto"> 包含客户端 DLL / 需要重启</label><button onclick="registerMod()">注册 Mod 版本</button></section>
<section><h2>创建并发布 ModPack</h2><div class="row"><input id="packId" placeholder="Pack ID"><input id="packName" placeholder="名称"><input id="packGame" placeholder="游戏版本"><input id="packEntries" placeholder="mod@version,mod2@version"></div><button onclick="publishPack()">创建并发布</button></section>
<section><h2>平台状态</h2><button onclick="loadState()">刷新状态</button><pre id="out">尚未读取</pre></section>
<script>
const savedToken=()=>localStorage.getItem('modPlatformToken')||bootstrapToken.value;
const headers=()=>({'authorization':'Bearer '+savedToken(),'content-type':'application/json'});
async function request(url,options={}){const r=await fetch(url,options);let b={};try{b=await r.json()}catch{}if(!r.ok)throw new Error(b.error?.message||('HTTP '+r.status));return b}
function show(value){out.textContent=typeof value==='string'?value:JSON.stringify(value,null,2)}
async function refreshMe(){const token=savedToken();if(!token){authStatus.textContent='尚未登录';return}try{const me=await request('/api/v1/auth/me',{headers:headers()});authStatus.textContent='已登录：'+me.user.username+'（'+me.user.role+'）'}catch{authStatus.textContent='登录已失效';localStorage.removeItem('modPlatformToken')}}
async function login(){try{const r=await request('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:loginUser.value,password:loginPassword.value})});localStorage.setItem('modPlatformToken',r.token);loginPassword.value='';await refreshMe();show('登录成功')}catch(e){show(e.message)}}
async function logout(){try{await request('/api/v1/auth/logout',{method:'POST',headers:headers(),body:'{}'})}catch{}localStorage.removeItem('modPlatformToken');bootstrapToken.value='';await refreshMe();show('已退出登录')}
async function register(){try{const r=await request('/api/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:registerUser.value,password:registerPassword.value,inviteCode:registerInvite.value})});registerPassword.value='';registerInvite.value='';show({message:'注册成功，请登录',user:r.user})}catch(e){show(e.message)}}
async function createInvite(){try{const r=await request('/api/v1/invites',{method:'POST',headers:headers(),body:JSON.stringify({role:inviteRole.value,maxUses:Number(inviteUses.value),expiresInHours:Number(inviteHours.value)})});inviteResult.textContent='邀请码（只显示一次）：\n'+r.code+'\n\n'+JSON.stringify(r.invite,null,2)}catch(e){inviteResult.textContent=e.message}}
async function loadState(){try{show(await request('/api/v1/admin/state',{headers:headers()}))}catch(e){show(e.message)}}
async function upload(){try{const file=artifact.files[0];if(!file)throw Error('请选择 ZIP');const bytes=await file.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');const r=await request('/api/v1/artifacts/'+hash,{method:'PUT',headers:{authorization:headers().authorization,'content-type':'application/zip','x-file-name':file.name},body:bytes});artifactSha.value=hash;uploadResult.textContent=JSON.stringify(r,null,2)}catch(e){uploadResult.textContent=e.message}}
async function registerMod(){try{const body={id:modId.value,name:modName.value,version:modVersion.value,artifactSha:artifactSha.value,gameVersions:gameVersions.value.split(',').map(x=>x.trim()).filter(Boolean),installRoots:installRoots.value.split(',').map(x=>x.trim()).filter(Boolean),containsDll:containsDll.checked,requiresRestart:containsDll.checked};show(await request('/api/v1/mods',{method:'POST',headers:headers(),body:JSON.stringify(body)}))}catch(e){show(e.message)}}
async function publishPack(){try{const entries=packEntries.value.split(',').map(x=>{const parts=x.trim().split('@');return{modId:parts[0],version:parts[1],required:true}});await request('/api/v1/packs',{method:'POST',headers:headers(),body:JSON.stringify({id:packId.value,name:packName.value,gameVersion:packGame.value,entries})});show(await request('/api/v1/packs/'+encodeURIComponent(packId.value)+'/releases',{method:'POST',headers:headers(),body:'{}'}))}catch(e){show(e.message)}}
refreshMe();
</script></body></html>`;

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function receiveArtifact(req, target, expectedHash, limit) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > limit) return callback(Object.assign(new Error('Request body is too large'), { code: 'BODY_TOO_LARGE' }));
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  try {
    await pipeline(req, meter, createWriteStream(temporary, { flags: 'wx' }));
    const actual = hash.digest('hex');
    if (actual !== expectedHash) throw Object.assign(new Error('Artifact SHA-256 does not match URL'), { code: 'HASH_MISMATCH', details: { expected: expectedHash, actual } });
    try { await rename(temporary, target); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await unlink(temporary); }
    return { size, actual };
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export function createApp({ store, signing, dataDir, adminToken, allowBootstrapAdmin = false, publicBaseUrl, maxArtifactBytes = 2_147_483_648, maxDiagnosticBytes = 262_144 }) {
  const objectDir = path.join(dataDir, 'objects');
  const auth = createAuthService({ store, bootstrapToken: adminToken, allowBootstrapAfterSetup: allowBootstrapAdmin });

  function isAdmin(req) {
    return auth.principal(req)?.role === 'admin';
  }

  function requireAdmin(req, res) {
    if (isAdmin(req)) return true;
    problem(res, 401, 'UNAUTHORIZED', 'Administrator token required');
    return false;
  }

  function requireUser(req, res) {
    const user = auth.principal(req);
    if (user) return user;
    problem(res, 401, 'UNAUTHORIZED', 'Login required');
    return null;
  }

  async function handler(req, res) {
    const url = new URL(req.url, publicBaseUrl);
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (req.method === 'GET' && pathname === '/') {
        const body = Buffer.from(ADMIN_HTML_V2);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'x-content-type-options': 'nosniff' });
        return res.end(body);
      }
      if (req.method === 'GET' && pathname === '/health') return json(res, 200, { status: 'ok', time: now() });
      if (req.method === 'GET' && pathname === '/api/v1/public-key') return json(res, 200, signing.publicJwk());

      if (req.method === 'POST' && pathname === '/api/v1/auth/register') {
        const body = await readJson(req, 32 * 1024);
        requireFields(body, ['username', 'password', 'inviteCode']);
        const user = await auth.register(body);
        return json(res, 201, { user });
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/login') {
        const body = await readJson(req, 32 * 1024);
        requireFields(body, ['username', 'password']);
        return json(res, 200, await auth.login(req, body));
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/logout') {
        await auth.logout(req);
        return json(res, 200, { loggedOut: true });
      }

      if (req.method === 'GET' && pathname === '/api/v1/auth/me') {
        const user = auth.principal(req);
        if (!user) return problem(res, 401, 'UNAUTHORIZED', 'Login required');
        return json(res, 200, { user: { id: user.id, username: user.username, role: user.role, bootstrap: user.bootstrap } });
      }

      if (req.method === 'POST' && pathname === '/api/v1/invites') {
        const principal = auth.principal(req);
        if (!principal || principal.role !== 'admin') return problem(res, 403, 'FORBIDDEN', 'Administrator role required');
        const body = await readJson(req, 32 * 1024);
        const result = await auth.createInvite({ ...body, createdBy: principal.id });
        return json(res, 201, result);
      }

      if (req.method === 'GET' && pathname === '/api/v1/invites') {
        if (!requireAdmin(req, res)) return;
        return json(res, 200, { invites: auth.listInvites() });
      }

      const revokeInviteMatch = pathname.match(/^\/api\/v1\/invites\/([^/]+)$/);
      if (req.method === 'DELETE' && revokeInviteMatch) {
        if (!requireAdmin(req, res)) return;
        if (!await auth.revokeInvite(revokeInviteMatch[1])) return problem(res, 404, 'INVITE_NOT_FOUND', 'Invitation was not found');
        return json(res, 200, { revoked: true });
      }

      if (req.method === 'GET' && pathname === '/api/v1/admin/state') {
        if (!requireUser(req, res)) return;
        const state = store.snapshot();
        state.diagnostics = state.diagnostics.slice(-20);
        for (const server of Object.values(state.servers)) delete server.tokenHash;
        for (const user of Object.values(state.users)) delete user.passwordHash;
        for (const invite of Object.values(state.invites)) delete invite.codeHash;
        state.sessions = { activeCount: Object.values(state.sessions).filter((session) => Date.parse(session.expiresAt) > Date.now()).length };
        return json(res, 200, state);
      }

      const artifactMatch = pathname.match(/^\/api\/v1\/artifacts\/([a-f0-9]{64})$/);
      if (req.method === 'PUT' && artifactMatch) {
        if (!requireAdmin(req, res)) return;
        const expected = artifactMatch[1];
        await mkdir(objectDir, { recursive: true });
        const target = path.join(objectDir, expected);
        const received = await receiveArtifact(req, target, expected, maxArtifactBytes);
        return json(res, 201, { sha256: expected, size: received.size, fileName: req.headers['x-file-name'] || null });
      }

      const publicArtifact = pathname.match(/^\/api\/v1\/public\/artifacts\/([a-f0-9]{64})$/);
      if (req.method === 'GET' && publicArtifact) {
        const file = path.join(objectDir, publicArtifact[1]);
        const info = await stat(file);
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': info.size,
          'cache-control': 'public, max-age=31536000, immutable',
          'etag': `"${publicArtifact[1]}"`,
          'x-content-type-options': 'nosniff'
        });
        return createReadStream(file).pipe(res);
      }

      if (req.method === 'POST' && pathname === '/api/v1/mods') {
        if (!requireAdmin(req, res)) return;
        const body = await readJson(req);
        requireFields(body, ['id', 'name', 'version', 'artifactSha']);
        if (!isSafeId(body.id) || !isSafeId(body.version) || !/^[a-f0-9]{64}$/.test(body.artifactSha)) throw Object.assign(new Error('Invalid id, version, or SHA-256'), { code: 'VALIDATION' });
        const artifact = path.join(objectDir, body.artifactSha);
        const artifactInfo = await stat(artifact);
        const result = await store.mutate((draft) => {
          const mod = draft.mods[body.id] || { id: body.id, name: body.name, versions: {} };
          mod.name = body.name;
          mod.versions[body.version] = {
            version: body.version,
            artifactSha: body.artifactSha,
            artifactSize: artifactInfo.size,
            gameVersions: Array.isArray(body.gameVersions) ? body.gameVersions : [],
            installRoots: Array.isArray(body.installRoots) ? body.installRoots : [],
            containsDll: Boolean(body.containsDll),
            requiresRestart: Boolean(body.requiresRestart || body.containsDll),
            createdAt: now()
          };
          draft.mods[body.id] = mod;
          return mod;
        });
        return json(res, 201, result);
      }

      if (req.method === 'POST' && pathname === '/api/v1/packs') {
        if (!requireAdmin(req, res)) return;
        const body = await readJson(req);
        requireFields(body, ['id', 'name', 'gameVersion', 'entries']);
        if (!isSafeId(body.id) || !Array.isArray(body.entries)) throw Object.assign(new Error('Invalid pack'), { code: 'VALIDATION' });
        const snapshot = store.snapshot();
        for (const entry of body.entries) {
          const version = snapshot.mods[entry.modId]?.versions?.[entry.version];
          if (!version) throw Object.assign(new Error(`Unknown mod version: ${entry.modId}@${entry.version}`), { code: 'VALIDATION' });
          if (version.gameVersions.length && !version.gameVersions.includes(body.gameVersion)) throw Object.assign(new Error(`${entry.modId}@${entry.version} does not declare compatibility with game ${body.gameVersion}`), { code: 'VALIDATION' });
        }
        const pack = await store.mutate((draft) => {
          const existing = draft.packs[body.id];
          const value = { id: body.id, name: body.name, gameVersion: body.gameVersion, entries: body.entries, createdAt: existing?.createdAt || now(), updatedAt: now(), latestReleaseId: existing?.latestReleaseId || null };
          draft.packs[body.id] = value;
          return value;
        });
        return json(res, 201, pack);
      }

      const releaseMatch = pathname.match(/^\/api\/v1\/packs\/([^/]+)\/releases$/);
      if (req.method === 'POST' && releaseMatch) {
        if (!requireAdmin(req, res)) return;
        const snapshot = store.snapshot();
        const pack = snapshot.packs[releaseMatch[1]];
        if (!pack) return problem(res, 404, 'PACK_NOT_FOUND', 'ModPack was not found');
        const releaseNumber = Object.values(snapshot.releases).filter((item) => item.packId === pack.id).length + 1;
        const unsigned = {
          schemaVersion: 1,
          packId: pack.id,
          packVersion: releaseNumber,
          gameVersion: pack.gameVersion,
          issuedAt: now(),
          mods: pack.entries.map((entry) => {
            const version = snapshot.mods[entry.modId].versions[entry.version];
            return {
              id: entry.modId,
              version: entry.version,
              required: entry.required !== false,
              containsDll: version.containsDll,
              requiresRestart: version.requiresRestart,
              installRoots: version.installRoots,
              size: version.artifactSize,
              sha256: version.artifactSha,
              url: `${publicBaseUrl.replace(/\/$/, '')}/api/v1/public/artifacts/${version.artifactSha}`
            };
          })
        };
        const manifest = signing.signObject(unsigned);
        const release = await store.mutate((draft) => {
          const releaseId = id('rel');
          const value = { id: releaseId, packId: pack.id, packVersion: releaseNumber, manifest, createdAt: now(), revokedAt: null };
          draft.releases[releaseId] = value;
          draft.packs[pack.id].latestReleaseId = releaseId;
          return value;
        });
        return json(res, 201, release);
      }

      const manifestMatch = pathname.match(/^\/api\/v1\/public\/packs\/([^/]+)\/latest$/);
      if (req.method === 'GET' && manifestMatch) {
        const snapshot = store.snapshot();
        const pack = snapshot.packs[manifestMatch[1]];
        const release = pack && snapshot.releases[pack.latestReleaseId];
        if (!release || release.revokedAt) return problem(res, 404, 'RELEASE_NOT_FOUND', 'No active release was found');
        return json(res, 200, release.manifest, { 'cache-control': 'public, max-age=30' });
      }

      if (req.method === 'POST' && pathname === '/api/v1/servers') {
        if (!requireAdmin(req, res)) return;
        const body = await readJson(req);
        requireFields(body, ['name', 'packId']);
        if (!store.snapshot().packs[body.packId]) throw Object.assign(new Error('Unknown packId'), { code: 'VALIDATION' });
        const serverId = id('srv');
        const token = randomBytes(32).toString('base64url');
        await store.mutate((draft) => { draft.servers[serverId] = { id: serverId, name: body.name, packId: body.packId, publicAddress: body.publicAddress || null, tokenHash: tokenHash(token), createdAt: now(), lastSeenAt: null }; });
        return json(res, 201, { serverId, token, packId: body.packId });
      }

      if (req.method === 'GET' && pathname === '/api/v1/public/servers/resolve') {
        const address = String(url.searchParams.get('address') || '').trim().toLocaleLowerCase('en-US');
        if (!address) return problem(res, 422, 'VALIDATION', 'address query parameter is required');
        const snapshot = store.snapshot();
        const server = Object.values(snapshot.servers).find((item) => String(item.publicAddress || '').trim().toLocaleLowerCase('en-US') === address);
        if (!server) return problem(res, 404, 'SERVER_NOT_FOUND', 'No registered server uses that public address');
        const pack = snapshot.packs[server.packId];
        const release = pack && snapshot.releases[pack.latestReleaseId];
        return json(res, 200, { serverId: server.id, packId: server.packId, packVersion: release?.packVersion || null, gameVersion: release?.manifest?.gameVersion || null });
      }

      const assignmentMatch = pathname.match(/^\/api\/v1\/servers\/([^/]+)\/assignment$/);
      if (req.method === 'GET' && assignmentMatch) {
        const snapshot = store.snapshot();
        const server = snapshot.servers[assignmentMatch[1]];
        if (!server || tokenHash(bearer(req)) !== server.tokenHash) return problem(res, 401, 'UNAUTHORIZED', 'Invalid server credential');
        await store.mutate((draft) => { draft.servers[server.id].lastSeenAt = now(); });
        const pack = snapshot.packs[server.packId];
        const release = pack && snapshot.releases[pack.latestReleaseId];
        return json(res, 200, { serverId: server.id, packId: server.packId, manifest: release?.manifest || null });
      }

      if (req.method === 'POST' && pathname === '/api/v1/diagnostics') {
        const body = await readJson(req, maxDiagnosticBytes);
        requireFields(body, ['sessionId', 'side', 'gameVersion', 'stage']);
        const event = prepareDiagnostic({ ...body, id: id('diag'), occurredAt: body.occurredAt || now(), receivedAt: now() });
        await store.mutate((draft) => {
          draft.diagnostics.push(event);
          if (draft.diagnostics.length > 10_000) draft.diagnostics.splice(0, draft.diagnostics.length - 10_000);
          const fingerprint = draft.fingerprints[event.fingerprint] || { fingerprint: event.fingerprint, count: 0, firstSeenAt: event.receivedAt, lastSeenAt: event.receivedAt, gameVersions: {}, packs: {}, sampleEventId: event.id };
          fingerprint.count += 1;
          fingerprint.lastSeenAt = event.receivedAt;
          fingerprint.gameVersions[event.gameVersion] = (fingerprint.gameVersions[event.gameVersion] || 0) + 1;
          if (event.packId) fingerprint.packs[event.packId] = (fingerprint.packs[event.packId] || 0) + 1;
          draft.fingerprints[event.fingerprint] = fingerprint;
        });
        return json(res, 202, { accepted: true, eventId: event.id, fingerprint: event.fingerprint });
      }

      if (req.method === 'GET' && pathname === '/api/v1/diagnostics/summary') {
        if (!requireUser(req, res)) return;
        const fingerprints = Object.values(store.snapshot().fingerprints).sort((a, b) => b.count - a.count);
        return json(res, 200, { fingerprints });
      }

      return problem(res, 404, 'NOT_FOUND', 'Route not found');
    } catch (error) {
      if (error.code === 'ENOENT') return problem(res, 404, 'NOT_FOUND', 'Requested file or object was not found');
      if (error.code === 'BODY_TOO_LARGE') return problem(res, 413, error.code, error.message);
      if (error.code === 'HASH_MISMATCH') return problem(res, 422, error.code, error.message, error.details);
      if (error.code === 'INVALID_CREDENTIALS') return problem(res, 401, error.code, error.message);
      if (error.code === 'RATE_LIMITED') return problem(res, 429, error.code, error.message);
      if (error.code === 'CONFLICT') return problem(res, 409, error.code, error.message);
      if (error.code === 'INVALID_INVITE') return problem(res, 422, error.code, error.message);
      if (error.code === 'INVALID_JSON' || error.code === 'VALIDATION') return problem(res, 422, error.code, error.message, error.details);
      console.error(error);
      return problem(res, 500, 'INTERNAL_ERROR', 'Unexpected server error');
    }
  }

  return handler;
}

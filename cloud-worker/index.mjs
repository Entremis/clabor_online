import syncModel from '../sync_model.js';
const encoder=new TextEncoder();
// Production Workers cap native PBKDF2 at 100,000 iterations. A separate
// secret peppers the derived hash so a database leak alone cannot test passwords.
const iterations=100000;
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const secret=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
async function hash(value) {return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));}
async function passwordHash(password,salt,count,pepper) {
 if(typeof pepper!=='string'||pepper.length<64)throw new Error('Password protection secret is not configured.');
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 const derived=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:count},key,256);
 const secretKey=await crypto.subtle.importKey('raw',encoder.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(new Uint8Array(await crypto.subtle.sign('HMAC',secretKey,derived)));
}
function equal(a,b) {if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
async function body(request,max=1000000) {
 if(Number(request.headers.get('content-length'))>max) throw failure('Слишком большой запрос.',413);
 const reader=request.body?.getReader();if(!reader)throw failure('Пустой запрос.');
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw failure('Слишком большой запрос.',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch(_){throw failure('Некорректный запрос.');}
}
async function throttle(env,key,limit,seconds) {
 const now=Date.now(),id=await hash(key);
 const row=await env.DB.prepare(`INSERT INTO auth_limits(key,count,reset_at) VALUES (?,1,?)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,
 reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING count`).bind(id,now+seconds*1000,now,now,now+seconds*1000).first();
 if(row.count>limit)throw failure('Слишком много попыток. Попробуйте позже.',429);
}
async function authenticate(request,env,register) {
 const data=await body(request,2000),username=String(data.username||'').trim().toLowerCase(),password=data.password;
 if(!/^[a-z0-9._-]{3,32}$/.test(username))throw failure('Логин: 3–32 латинские буквы, цифры, точка, дефис или подчёркивание.');
 if(typeof password!=='string'||password.length<8||password.length>128)throw failure('Пароль должен содержать от 8 до 128 символов.');
 const ip=request.headers.get('CF-Connecting-IP')||'local';
 await throttle(env,'auth-ip:'+ip,register?10:40,600);await throttle(env,'auth-user:'+username,20,600);
 let user;
 if(register){
   if(await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first())throw failure('Этот логин уже занят.',409);
   const id=crypto.randomUUID(),salt=secret(),password_hash=await passwordHash(password,salt,iterations,env.PASSWORD_PEPPER);
   try{await env.DB.prepare('INSERT INTO users(id,username,password_hash,salt,iterations,created_at) VALUES (?,?,?,?,?,?)').bind(id,username,password_hash,salt,iterations,Date.now()).run();}
   catch(error){if(String(error).includes('UNIQUE'))throw failure('Этот логин уже занят.',409);throw error;}
   user={id,username};
 }else{
   user=await env.DB.prepare('SELECT id,username,password_hash,salt,iterations FROM users WHERE username=?').bind(username).first();
   const candidate=await passwordHash(password,user?.salt||'clabor-unknown-account',user?.iterations||iterations,env.PASSWORD_PEPPER);
   if(!user||!equal(candidate,user.password_hash))throw failure('Неверный логин или пароль.',401);
 }
 const token=secret(),expires=Date.now()+30*86400000;
 await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(Date.now()),env.DB.prepare('DELETE FROM auth_limits WHERE reset_at<=?').bind(Date.now()),env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await hash(token),user.id,expires)]);
 return json({userId:user.id,username:user.username,token,expiresAt:expires});
}
async function currentUser(request,env) {
 const header=request.headers.get('Authorization')||'';
 if(!/^Bearer [a-f0-9]{64}$/.test(header))throw failure('Нужно войти в аккаунт.',401);
 const tokenHash=await hash(header.slice(7));
 const user=await env.DB.prepare('SELECT users.id,users.username FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?').bind(tokenHash,Date.now()).first();
 if(!user)throw failure('Сессия истекла. Войдите снова — локальные изменения сохранены.',401);
 return {...user,tokenHash};
}
async function pull(request,env,user) {
 const url=new URL(request.url),since=Number(url.searchParams.get('since')||0),after=Number(url.searchParams.get('after')||since),afterKey=url.searchParams.get('key')||'';
 if(!Number.isSafeInteger(since)||since<0||!Number.isSafeInteger(after)||after<since)throw failure('Некорректная версия.');
 const current=await env.DB.prepare('SELECT revision FROM users WHERE id=?').bind(user.id).first();
 const until=url.searchParams.has('until')?Number(url.searchParams.get('until')):current.revision;
 if(!Number.isSafeInteger(until)||until<since||until>current.revision)throw failure('Некорректная граница изменений.');
 const result=await env.DB.prepare(`SELECT key,value,revision FROM records WHERE owner_id=? AND revision>? AND revision<=? AND (revision>? OR (revision=? AND key>?)) ORDER BY revision,key LIMIT 101`).bind(user.id,since,until,after,after,afterKey).all();
 const rows=result.results.slice(0,100),last=rows.at(-1);
 return json({until,records:rows.map(row=>({key:row.key,value:row.value===null?null:JSON.parse(row.value)})),next:result.results.length>100?{after:last.revision,key:last.key}:null});
}
async function push(request,env,user) {
 const data=await body(request),{requestId,baseVersion,changes}=data;
 if(typeof requestId!=='string'||!/^[a-zA-Z0-9-]{16,100}$/.test(requestId)||!Number.isSafeInteger(baseVersion)||baseVersion<0||!Array.isArray(changes)||!changes.length||changes.length>20||new Set(changes.map(c=>c?.key)).size!==changes.length)throw failure('Некорректная отправка изменений.');
 for(const change of changes) {if(!change||!Object.hasOwn(change,'value'))throw failure('Некорректная запись.');syncModel.validateRecord(change.key,change.value);}
 const payloadHash=await hash(JSON.stringify(data));
 const receipt=await env.DB.prepare('SELECT revision,payload_hash FROM mutations WHERE owner_id=? AND id=?').bind(user.id,requestId).first();
 if(receipt){if(receipt.payload_hash!==payloadHash)throw failure('Идентификатор запроса уже использован.',409);return json({revision:receipt.revision});}
 const revision=baseVersion+1,attemptId=crypto.randomUUID(),statements=[env.DB.prepare('UPDATE users SET revision=?,last_operation=? WHERE id=? AND revision=?').bind(revision,attemptId,user.id,baseVersion)];
 for(const change of changes) statements.push(env.DB.prepare(`INSERT INTO records(owner_id,key,value,revision)
 SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND revision=? AND last_operation=?)
 ON CONFLICT(owner_id,key) DO UPDATE SET value=excluded.value,revision=excluded.revision`).bind(user.id,change.key,change.value===null?null:JSON.stringify(change.value),revision,user.id,revision,attemptId));
 statements.push(env.DB.prepare(`INSERT OR IGNORE INTO mutations(owner_id,id,revision,payload_hash) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND revision=? AND last_operation=?)`).bind(user.id,requestId,revision,payloadHash,user.id,revision,attemptId));
 const results=await env.DB.batch(statements);
 if(!results[0].meta.changes){
   const retry=await env.DB.prepare('SELECT revision,payload_hash FROM mutations WHERE owner_id=? AND id=?').bind(user.id,requestId).first();
   if(retry?.payload_hash===payloadHash)return json({revision:retry.revision});
   throw failure('В облаке уже есть изменения. Требуется обновление.',409);
 }
 return json({revision});
}
export default {
 async fetch(request,env) {
  const origin=request.headers.get('Origin'),allowed=(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim());
  if(origin&&!allowed.includes(origin))return json({error:'Этот адрес приложения не разрешён.'},403);
  let response;
  try {
   const path=new URL(request.url).pathname;
   if(request.method==='OPTIONS')response=new Response(null,{status:204});
   else if(path==='/health'&&request.method==='GET')response=json({ok:true,app:'clabor-cloud',version:1});
   else if(path==='/auth/register'&&request.method==='POST')response=await authenticate(request,env,true);
   else if(path==='/auth/login'&&request.method==='POST')response=await authenticate(request,env,false);
   else {
    const user=await currentUser(request,env);
    if(path==='/auth/me'&&request.method==='GET')response=json({userId:user.id,username:user.username});
    else if(path==='/auth/logout'&&request.method==='POST'){await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(user.tokenHash).run();response=json({ok:true});}
    else if(path==='/sync'&&request.method==='GET')response=await pull(request,env,user);
    else if(path==='/sync'&&request.method==='PUT')response=await push(request,env,user);
    else response=json({error:'Страница не найдена.'},404);
   }
  } catch(error) {
   const status=error.status||(/Некоррект|Слишком/.test(error.message)?400:500);
   if(status===500)console.error('Cloud request failed:',error.name,error.message);
   response=json({error:status===500?'Облако временно недоступно. Изменения остаются на устройстве.':error.message},status);
  }
  response.headers.set('Vary','Origin');response.headers.set('X-Content-Type-Options','nosniff');
  if(origin){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');response.headers.set('Access-Control-Allow-Headers','Content-Type,Authorization');}
  return response;
 }
};

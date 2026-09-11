import {AppError,config,configuration,database,decrypt,encrypt} from './server';
type Tokens={access_token:string;refresh_token?:string;expires_in?:number;scope?:string};
export type PrivateAccount={id:string;owner:string;x_user_id:string;username:string;name:string;tokens:string;expires:number;blocked_until:number;locked_until:number};
export class XError extends AppError{constructor(message:string,public upstreamStatus:number,public uncertain=false){super(message,upstreamStatus===429?429:502);}}
export async function tokenRequest(params:Record<string,string>,path='token'):Promise<Tokens>{
 if(!configuration().configured)throw new AppError('X connection setup is incomplete.',503);
 let response:Response;try{response=await fetch('https://api.x.com/2/oauth2/'+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+btoa(config('X_CLIENT_ID')+':'+config('X_CLIENT_SECRET'))},body:new URLSearchParams({...params,client_id:config('X_CLIENT_ID')}),signal:AbortSignal.timeout(15000)});}catch{throw new AppError('X did not respond to the connection request. Reconnect and try again.',502);}
 if(!response.ok)throw new AppError('X could not authorize this connection. Check your app configuration and reconnect.',502);
 const result=await response.json() as Tokens;if(path==='token'&&!result.access_token)throw new AppError('X returned an incomplete connection. Please reconnect.',502);return result;
}
export async function withAccount<T>(owner:string,id:string,fn:(a:PrivateAccount)=>Promise<T>){
 const db=database();const a=await db.prepare('SELECT * FROM accounts WHERE owner=? AND id=?').bind(owner,id).first<PrivateAccount>();if(!a)throw new AppError('Connect and select an X account first.',404);
 if(a.blocked_until>Date.now())throw new AppError('X requests are paused until '+new Date(a.blocked_until).toISOString()+'.',429);
 const lockedUntil=Date.now()+120000;const locked=await db.prepare('UPDATE accounts SET locked_until=? WHERE owner=? AND id=? AND locked_until<?').bind(lockedUntil,owner,id,Date.now()).run();if(!locked.meta.changes)throw new AppError('Another X request is running for this profile. Try again shortly.',409);
 try{const fresh=await db.prepare('SELECT * FROM accounts WHERE owner=? AND id=?').bind(owner,id).first<PrivateAccount>();if(!fresh)throw new AppError('This account was disconnected.',409);return await fn(fresh);}finally{await db.prepare('UPDATE accounts SET locked_until=0 WHERE owner=? AND id=? AND locked_until=?').bind(owner,id,lockedUntil).run();}
}
export async function accessToken(a:PrivateAccount){let tokens=JSON.parse(await decrypt(a.tokens)) as Tokens;
 if(a.expires<Date.now()+60000){if(!tokens.refresh_token)throw new AppError('This X connection has expired. Reconnect in Settings.',401);const next=await tokenRequest({grant_type:'refresh_token',refresh_token:tokens.refresh_token});tokens={...next,refresh_token:next.refresh_token||tokens.refresh_token};const encrypted=await encrypt(JSON.stringify(tokens));const expires=Date.now()+(tokens.expires_in||7200)*1000;await database().prepare('UPDATE accounts SET tokens=?,expires=? WHERE id=? AND owner=?').bind(encrypted,expires,a.id,a.owner).run();a.tokens=encrypted;a.expires=expires;}return tokens.access_token;
}
export async function xRequest<T>(a:PrivateAccount,path:string,init:RequestInit={}):Promise<T>{const token=await accessToken(a);return rawRequest<T>(token,path,init,a);}
export async function rawRequest<T>(token:string,path:string,init:RequestInit={},a?:PrivateAccount):Promise<T>{
 let r:Response;try{r=await fetch('https://api.x.com/2/'+path,{...init,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});}catch{throw new XError('X did not confirm the request. Check your X profile before trying to publish again.',0,init.method==='POST');}
 if(a&&(r.status===429||r.headers.get('x-rate-limit-remaining')==='0')){const seconds=Number(r.headers.get('x-rate-limit-reset'));const retry=r.headers.get('retry-after');const retryAt=retry?(/^\d+$/.test(retry)?Date.now()+Number(retry)*1000:Date.parse(retry)):0;const until=Math.max(Date.now()+60000,Number.isFinite(seconds)?seconds*1000:0,Number.isFinite(retryAt)?retryAt:0);await database().prepare('UPDATE accounts SET blocked_until=? WHERE id=? AND owner=?').bind(until,a.id,a.owner).run();}
 if(!r.ok){const message=r.status===429?'X’s request limit was reached. Requests are paused until its reset time.':r.status===401?'X authorization expired or was revoked. Reconnect this account.':r.status===402?'Your X developer app needs API credits.':r.status===403?'X denied this action. Check your app permissions and account status.':'X could not complete this request.';throw new XError(message,r.status,r.status>=500&&init.method==='POST');}
 try{return await r.json() as T;}catch{throw new XError('X returned an unreadable response. Check X before publishing again.',r.status,init.method==='POST');}
}

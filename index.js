// Public bot directory + per-owner bot control.
function botOwner(req){ return sessionUser(req); }
function botHasPremium(cfg){
  return ["pro","premium","enterprise"].includes(String(cfg.plan||"basic").toLowerCase()) &&
    (!cfg.expiresAt || new Date(cfg.expiresAt).getTime()>Date.now());
}
function botDefaultWatching(cfg){
  const link=cfg.serverLink||process.env.DISCORD_INVITE_URL||"";
  return link ? "MLD · "+link : "MLD Community";
}
function botSafeProfile(cfg){
  const premium=botHasPremium(cfg);
  return {
    id:cfg.id,name:cfg.name,botId:cfg.botId||null,guildId:cfg.guildId,
    modules:cfg.modules||[],plan:cfg.plan||"basic",status:cfg.status||"created",
    prefix:cfg.prefix||"!",watching:premium?(cfg.watching||botDefaultWatching(cfg)):botDefaultWatching(cfg),
    statusText:premium?(cfg.statusText||"online"):"online",
    watchingLocked:!premium,profileLocked:!premium,
    serverLink:premium?(cfg.serverLink||process.env.DISCORD_INVITE_URL||""):(
      cfg.serverLink||process.env.DISCORD_INVITE_URL||""
    ),
    avatar:cfg.avatar||null,creatorUsername:cfg.ownerUsername||cfg.creatorUsername||"MALADH",
    createdAt:cfg.createdAt,updatedAt:cfg.updatedAt,expiresAt:cfg.expiresAt||null
  };
}
function applyBotPresence(cfg){
  const bc=botInstances.get(cfg.id);if(!bc?.user)return;
  const premium=botHasPremium(cfg);
  const watching=premium?(cfg.watching||botDefaultWatching(cfg)):botDefaultWatching(cfg);
  const status=premium&&["online","idle","dnd","invisible"].includes(cfg.statusText)?cfg.statusText:"online";
  try{bc.user.setPresence({status,activities:[{name:String(watching).slice(0,128),type:3}]})}catch{}
}
app.get("/api/platform/bots",(req,res)=>{
  const bots=[...botConfigs.values()].map(botSafeProfile);
  res.json({bots,modules:BOT_MODULES});
});
app.get("/api/platform/bots/:id",(req,res)=>{
  const b=botConfigs.get(req.params.id);if(!b)return res.status(404).json({error:"البوت غير موجود"});
  res.json({bot:botSafeProfile(b),modules:BOT_MODULES});
});
app.patch("/api/platform/bots/:id/profile",(req,res)=>{
  const me=botOwner(req);if(!me)return res.status(401).json({error:"سجّل دخولك أولًا"});
  const b=botConfigs.get(req.params.id);if(!b)return res.status(404).json({error:"البوت غير موجود"});
  if(me.role!=="owner"&&b.ownerUsername!==me.username)return res.status(403).json({error:"هذا البوت ليس لك"});
  const premium=botHasPremium(b);
  if(req.body?.watching!==undefined&&!premium)return res.status(403).json({error:"تعديل الواتشينق يحتاج اشتراكًا مفعّلًا من الأونر"});
  if(req.body?.statusText!==undefined&&!premium)return res.status(403).json({error:"تغيير حالة البوت يحتاج اشتراكًا مفعّلًا من الأونر"});
  if(req.body?.serverLink!==undefined&&!premium)return res.status(403).json({error:"تغيير رابط السيرفر في الملف يحتاج اشتراكًا مفعّلًا من الأونر"});
  if(req.body?.watching!==undefined)b.watching=safeText(req.body.watching,128)||null;
  if(req.body?.statusText!==undefined)b.statusText=["online","idle","dnd","invisible"].includes(req.body.statusText)?req.body.statusText:"online";
  if(req.body?.serverLink!==undefined)b.serverLink=safeText(req.body.serverLink,300)||null;
  if(req.body?.prefix!==undefined)b.prefix=safeText(req.body.prefix,5)||"!";
  b.updatedAt=nowIso();applyBotPresence(b);
  res.json({ok:true,bot:botSafeProfile(b)});
});
app.patch("/api/platform/bots/:id/settings",(req,res)=>{
  const me=botOwner(req);if(!me)return res.status(401).json({error:"سجّل دخولك أولًا"});
  const b=botConfigs.get(req.params.id);if(!b)return res.status(404).json({error:"البوت غير موجود"});
  if(me.role!=="owner"&&b.ownerUsername!==me.username)return res.status(403).json({error:"هذا البوت ليس لك"});
  if(req.body?.name!==undefined)b.name=safeText(req.body.name,60)||b.name;
  if(req.body?.prefix!==undefined)b.prefix=safeText(req.body.prefix,5)||"!";
  b.updatedAt=nowIso();res.json({ok:true,bot:botSafeProfile(b)});
});
app.get("/api/platform/my-bots",(req,res)=>{
  const me=botOwner(req);if(!me)return res.status(401).json({error:"سجّل دخولك أولًا"});
  res.json({bots:[...botConfigs.values()].filter(b=>me.role==="owner"||b.ownerUsername===me.username).map(botSafeProfile),modules:BOT_MODULES});
});
app.post("/api/auth/logout",(req,res)=>{const token=req.headers.cookie?.match(/(?:^|;\s*)mld_session=([^;]+)/)?.[1];if(token)sessions.delete(token);res.setHeader("Set-Cookie","mld_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");res.json({ok:true})});

// MALADH platform modules (runtime store; use durable database before production scale).
const platform = {
  publicChat: [], reviews: [], jokes: [], vents: [], stories: [],
  conversations: new Map(), tickets: new Map(), applications: new Map(), rooms: new Map(), groups: new Map(), audit: []
};
const newId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
let siteAnnouncement = {enabled:true,text:"أهلًا بكم في MALADH · مجتمعنا يجمعنا",color:"#ff9cde",speed:"normal"};
app.get("/api/public/announcement",(req,res)=>res.json(siteAnnouncement));
app.patch("/api/platform/owner/announcement",(req,res)=>{
  const u=needUser(req,res); if(!u)return;
  if(u.role!=="owner")return res.status(403).json({error:"هذا التحكم للأونر فقط"});
  const text=safeText(req.body?.text,220);
  siteAnnouncement={enabled:Boolean(req.body?.enabled),text,color:/^#[0-9a-fA-F]{6}$/.test(String(req.body?.color||""))?String(req.body.color):"#ff9cde",speed:["slow","normal","fast"].includes(req.body?.speed)?req.body.speed:"normal"};
  audit(u,"update","announcement", "site", {text:siteAnnouncement.text,enabled:siteAnnouncement.enabled});
  res.json({ok:true,announcement:siteAnnouncement});
});


platform.hubPolls = platform.hubPolls || [
  {id:newId(),question:"وش تبون يكون محور الفعالية الجاية؟",options:["ليلة ألعاب","بطولة","جلسة سوالف","سينما"],votes:[0,0,0,0],voters:[]}
];
platform.hubEvents = platform.hubEvents || [];
platform.hubIdeas = platform.hubIdeas || [];
app.get("/api/platform/hub/polls",(req,res)=>res.json({items:platform.hubPolls.filter(x=>!x.closed)}));
app.post("/api/platform/hub/polls/:id/vote",(req,res)=>{const u=needUser(req,res);if(!u)return;const p=platform.hubPolls.find(x=>x.id===req.params.id);const option=Number(req.body?.option);if(!p||!Number.isInteger(option)||option<0||option>=p.options.length)return res.status(400).json({error:"التصويت غير صالح"});if(p.voters.includes(u.username))return res.status(409).json({error:"صوّت مسبقًا"});p.voters.push(u.username);p.votes[option]+=1;audit(u,"vote","poll",p.id,{option});res.json({ok:true});});
app.get("/api/platform/hub/events",(req,res)=>res.json({items:platform.hubEvents.filter(x=>new Date(x.startsAt)>new Date()).sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt)).slice(0,20)}));
app.get("/api/platform/hub/ideas",(req,res)=>res.json({items:platform.hubIdeas.filter(x=>!x.deleted).slice(0,50)}));
app.post("/api/platform/hub/ideas",(req,res)=>{const u=needUser(req,res);if(!u)return;const title=safeText(req.body?.title,120),text=safeText(req.body?.text,1000);if(title.length<3||text.length<4)return res.status(400).json({error:"اكتب عنوان وفكرة واضحة"});const item={id:newId(),title,text,user:publicProfile(u),votes:0,voters:[],createdAt:nowIso(),deleted:false};platform.hubIdeas.unshift(item);audit(u,"create","idea",item.id);res.json({ok:true,item});});
app.post("/api/platform/hub/ideas/:id/vote",(req,res)=>{const u=needUser(req,res);if(!u)return;const item=platform.hubIdeas.find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:"الاقتراح غير موجود"});if(item.voters.includes(u.username))return res.status(409).json({error:"صوّت مسبقًا"});item.voters.push(u.username);item.votes+=1;audit(u,"vote","idea",item.id);res.json({ok:true});});
app.get("/api/platform/hub/achievements",async(req,res)=>{const scores=new Map();for(const u of siteUsers.values())scores.set(u.username,{user:publicProfile(u),points:0,badge:"بداية الرحلة"});for(const m of platform.publicChat){if(m.user?.username&&scores.has(m.user.username))scores.get(m.user.username).points+=2}for(const r of platform.reviews){if(!r.deleted&&r.user?.username&&scores.has(r.user.username))scores.get(r.user.username).points+=5}for(const i of platform.hubIdeas){if(!i.deleted&&i.user?.username&&scores.has(i.user.username))scores.get(i.user.username).points+=4}res.json({items:[...scores.values()].sort((a,b)=>b.points-a.points).slice(0,30).map(x=>({...x,badge:x.points>=50?"MALADH LEGEND":x.points>=20?"MALADH ACTIVE":"MALADH MEMBER"}))});});

function currentUser(req){ return sessionUser(req); }
function needUser(req,res){ const u=currentUser(req); if(!u){res.status(401).json({error:"سجّل الدخول أولًا"});return null;} return u; }
function needStaff(req,res){ const u=needUser(req,res); if(!u)return null; if(!["owner","admin"].includes(u.role)){res.status(403).json({error:"هذه الميزة للإدارة فقط"});return null;} return u; }
function audit(actor,action,type,id,details={}){platform.audit.unshift({id:newId(),actor:actor.username,action,type,entityId:id,details,createdAt:nowIso()});if(platform.audit.length>5000)platform.audit.length=5000;}
function safeText(value,max=2000){return String(value||"").trim().slice(0,max);}
function publicProfile(u){return {username:u.username,displayName:u.displayName,role:u.role,avatar:u.avatar||null};}
function visibleConversation(conv,u){return u.role==="owner"||conv.owner===u.username||conv.members.includes(u.username);}
app.get("/api/platform/users",(req,res)=>{const u=needUser(req,res);if(!u)return;res.json({users:[...siteUsers.values()].filter(x=>x.username!==u.username).map(publicProfile)});});
app.get("/api/platform/chat",(req,res)=>res.json({messages:platform.publicChat.slice(0,150).reverse()}));
app.post("/api/platform/chat",(req,res)=>{const u=needUser(req,res);if(!u)return;const text=safeText(req.body?.text,1500);if(!text)return res.status(400).json({error:"اكتب الرسالة"});const m={id:newId(),user:publicProfile(u),text,createdAt:nowIso(),deleted:false};platform.publicChat.unshift(m);audit(u,"send","public_message",m.id);res.json({ok:true,message:m});});
app.delete("/api/platform/chat/:id",(req,res)=>{const u=needUser(req,res);if(!u)return;const m=platform.publicChat.find(x=>x.id===req.params.id);if(!m)return res.status(404).json({error:"الرسالة غير موجودة"});if(u.role!=="owner"&&m.user.username!==u.username)return res.status(403).json({error:"لا يمكنك حذف هذه الرسالة"});const deletedText=m.text;m.deleted=true;m.text="تم حذف الرسالة";m.deletedAt=nowIso();audit(u,"delete","public_message",m.id,{text:deletedText,author:m.user.username});res.json({ok:true});});
app.get("/api/platform/reviews",(req,res)=>res.json({reviews:platform.reviews.filter(x=>!x.deleted).slice(0,100)}));
app.post("/api/platform/reviews",(req,res)=>{const u=needUser(req,res);if(!u)return;const text=safeText(req.body?.text,600);const rating=Math.max(1,Math.min(5,Number(req.body?.rating)||5));if(text.length<4)return res.status(400).json({error:"اكتب رأيًا من 4 أحرف على الأقل"});const r={id:newId(),user:publicProfile(u),text,rating,createdAt:nowIso(),deleted:false};platform.reviews.unshift(r);audit(u,"create","review",r.id);res.json({ok:true,review:r});});
app.delete("/api/platform/reviews/:id",(req,res)=>{const u=needUser(req,res);if(!u)return;const r=platform.reviews.find(x=>x.id===req.params.id);if(!r)return res.status(404).json({error:"الرأي غير موجود"});if(u.role!=="owner"&&r.user.username!==u.username)return res.status(403).json({error:"لا يمكنك حذف هذا الرأي"});r.deleted=true;audit(u,"delete","review",r.id,{text:r.text,author:r.user.username});res.json({ok:true});});
for (const [route,key,max] of [["jokes","jokes",1000],["vent","vents",1500],["stories","stories",3000]]) {
  app.get("/api/platform/"+route,(req,res)=>res.json({items:platform[key].filter(x=>!x.deleted).slice(0,100)}));
  app.post("/api/platform/"+route,(req,res)=>{const u=needUser(req,res);if(!u)return;const text=safeText(req.body?.text,max);if(text.length<4)return res.status(400).json({error:"المحتوى قصير جدًا"});const item={id:newId(),user:publicProfile(u),text,createdAt:nowIso(),deleted:false};platform[key].unshift(item);audit(u,"create",route,item.id);res.json({ok:true,item});});
  app.delete("/api/platform/"+route+"/:id",(req,res)=>{const u=needUser(req,res);if(!u)return;const item=platform[key].find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:"العنصر غير موجود"});if(u.role!=="owner"&&item.user.username!==u.username)return res.status(403).json({error:"لا يمكنك حذف هذا المحتوى"});item.deleted=true;audit(u,"delete",route,item.id,{text:item.text,author:item.user.username});res.json({ok:true});});
}
app.get("/api/platform/conversations",(req,res)=>{const u=needUser(req,res);if(!u)return;res.json({conversations:[...platform.conversations.values()].filter(c=>visibleConversation(c,u)).map(c=>({id:c.id,title:c.title,owner:c.owner,members:c.members,updatedAt:c.updatedAt,messageCount:c.messages.length}))});});
app.post("/api/platform/conversations",(req,res)=>{const u=needUser(req,res);if(!u)return;const members=Array.isArray(req.body?.members)?[...new Set(req.body.members.map(x=>String(x).slice(0,24)).filter(x=>siteUsers.has(x)&&x!==u.username))].slice(0,20):[];if(!members.length)return res.status(400).json({error:"اختر حسابًا واحدًا على الأقل"});const c={id:newId(),title:safeText(req.body?.title,80)||members.map(x=>siteUsers.get(x).displayName||x).join("، "),owner:u.username,members:[u.username,...members],messages:[],createdAt:nowIso(),updatedAt:nowIso()};platform.conversations.set(c.id,c);audit(u,"create","conversation",c.id,{members:c.members});res.json({ok:true,conversation:{id:c.id,title:c.title,owner:c.owner,members:c.members}});});
app.get("/api/platform/conversations/:id/messages",(req,res)=>{const u=needUser(req,res);if(!u)return;const c=platform.conversations.get(req.params.id);if(!c||!visibleConversation(c,u))return res.status(404).json({error:"المحادثة غير موجودة"});res.json({messages:c.messages.slice(-200)});});
app.post("/api/platform/conversations/:id/messages",(req,res)=>{const u=needUser(req,res);if(!u)return;const c=platform.conversations.get(req.params.id);if(!c||!visibleConversation(c,u))return res.status(404).json({error:"المحادثة غير موجودة"});const text=safeText(req.body?.text,2000);if(!text)return res.status(400).json({error:"اكتب الرسالة"});const m={id:newId(),user:publicProfile(u),text,createdAt:nowIso(),deleted:false};c.messages.push(m);c.updatedAt=nowIso();audit(u,"send","private_message",m.id,{conversationId:c.id});res.json({ok:true,message:m});});
app.delete("/api/platform/conversations/:id/messages/:messageId",(req,res)=>{const u=needUser(req,res);if(!u)return;const c=platform.conversations.get(req.params.id);if(!c||!visibleConversation(c,u))return res.status(404).json({error:"المحادثة غير موجودة"});const m=c.messages.find(x=>x.id===req.params.messageId);if(!m)return res.status(404).json({error:"الرسالة غير موجودة"});if(u.role!=="owner"&&m.user.username!==u.username&&c.owner!==u.username)return res.status(403).json({error:"لا تملك صلاحية حذف الرسالة"});const deletedText=m.text;m.deleted=true;m.text="تم حذف الرسالة";m.deletedAt=nowIso();audit(u,"delete","private_message",m.id,{conversationId:c.id,text:deletedText,author:m.user.username});res.json({ok:true});});
app.post("/api/platform/conversations/:id/members",(req,res)=>{const u=needUser(req,res);if(!u)return;const c=platform.conversations.get(req.params.id);if(!c||!visibleConversation(c,u))return res.status(404).json({error:"المحادثة غير موجودة"});if(c.owner!==u.username&&u.role!=="owner")return res.status(403).json({error:"مالك المحادثة فقط يستطيع إدارة الأعضاء"});const name=String(req.body?.username||"").slice(0,24);if(!siteUsers.has(name))return res.status(404).json({error:"الحساب غير موجود"});if(!c.members.includes(name))c.members.push(name);audit(u,"add_member","conversation",c.id,{username:name});res.json({ok:true,members:c.members});});
app.delete("/api/platform/conversations/:id/members/:username",(req,res)=>{const u=needUser(req,res);if(!u)return;const c=platform.conversations.get(req.params.id);if(!c||!visibleConversation(c,u))return res.status(404).json({error:"المحادثة غير موجودة"});if(c.owner!==u.username&&u.role!=="owner")return res.status(403).json({error:"مالك المحادثة فقط يستطيع إدارة الأعضاء"});if(req.params.username===c.owner)return res.status(400).json({error:"لا يمكن طرد مالك المحادثة"});c.members=c.members.filter(x=>x!==req.params.username);audit(u,"remove_member","conversation",c.id,{username:req.params.username});res.json({ok:true,members:c.members});});
app.get("/api/platform/tickets",(req,res)=>{const u=needUser(req,res);if(!u)return;const all=[...platform.tickets.values()].filter(t=>u.role==="owner"||u.role==="admin"||t.owner===u.username);res.json({tickets:all.map(({messages,...t})=>({...t,messageCount:messages.length}))});});
app.post("/api/platform/tickets",(req,res)=>{const u=needUser(req,res);if(!u)return;const title=safeText(req.body?.title,100),text=safeText(req.body?.text,2000);if(!title||!text)return res.status(400).json({error:"اكتب عنوان الطلب والتفاصيل"});const t={id:newId(),title,text,owner:u.username,status:"open",messages:[],createdAt:nowIso(),updatedAt:nowIso()};platform.tickets.set(t.id,t);audit(u,"create","ticket",t.id);res.json({ok:true,ticket:{...t,messages:undefined}});});
app.get("/api/platform/tickets/:id",(req,res)=>{const u=needUser(req,res);if(!u)return;const t=platform.tickets.get(req.params.id);if(!t)return res.status(404).json({error:"التذكرة غير موجودة"});if(u.role!=="owner"&&u.role!=="admin"&&t.owner!==u.username)return res.status(404).json({error:"التذكرة غير موجودة"});res.json({ticket:t})});
app.post("/api/platform/tickets/:id/reply",(req,res)=>{const u=needUser(req,res);if(!u)return;const t=platform.tickets.get(req.params.id);if(!t)return res.status(404).json({error:"التذكرة غير موجودة"});if(u.role!=="owner"&&u.role!=="admin"&&t.owner!==u.username)return res.status(403).json({error:"هذه التذكرة ليست لك"});const text=safeText(req.body?.text,2000);if(!text)return res.status(400).json({error:"اكتب الرد"});t.messages.push({id:newId(),user:publicProfile(u),text,createdAt:nowIso()});t.updatedAt=nowIso();audit(u,"reply","ticket",t.id);res.json({ok:true});});
app.patch("/api/platform/tickets/:id",(req,res)=>{const u=needStaff(req,res);if(!u)return;const t=platform.tickets.get(req.params.id);if(!t)return res.status(404).json({error:"التذكرة غير موجودة"});const next=String(req.body?.status||"");if(!["open","claimed","closed"].includes(next))return res.status(400).json({error:"حالة غير صالحة"});t.status=next;t.assignee=next==="claimed"?u.username:t.assignee;t.updatedAt=nowIso();audit(u,"status","ticket",t.id,{status:next});res.json({ok:true,ticket:{...t,messages:undefined}});});
app.get("/api/platform/applications",(req,res)=>{const u=needUser(req,res);if(!u)return;const all=[...platform.applications.values()].filter(a=>u.role==="owner"||u.role==="admin"||a.owner===u.username);res.json({applications:all.map(({answers,...a})=>({...a,answers:u.role==="owner"||u.role==="admin"?answers:undefined}))});});
app.post("/api/platform/applications",(req,res)=>{const u=needUser(req,res);if(!u)return;const discordUsername=safeText(req.body?.discordUsername,80),answers=safeText(req.body?.answers,3000);if(!discordUsername||!answers)return res.status(400).json({error:"اكتب يوزر ديسكورد وإجاباتك"});const a={id:newId(),owner:u.username,discordUsername,answers,status:"pending",createdAt:nowIso()};platform.applications.set(a.id,a);audit(u,"submit","application",a.id);res.json({ok:true,application:{...a,answers:undefined}});});
app.patch("/api/platform/applications/:id",async(req,res)=>{const u=needStaff(req,res);if(!u)return;const a=platform.applications.get(req.params.id);if(!a)return res.status(404).json({error:"الطلب غير موجود"});const next=String(req.body?.status||"");if(!["pending","accepted","rejected"].includes(next))return res.status(400).json({error:"حالة غير صالحة"});if(next==="accepted"){const applicant=siteUsers.get(a.owner);if(!applicant?.discordId)return res.status(400).json({error:"حساب المتقدم غير مرتبط بديسكورد"});try{const guild=await getGuild(),member=await guild.members.fetch(applicant.discordId),roleId=process.env.APPLICATION_ROLE_ID||"1548732606508703744";await member.roles.add(roleId,"Accepted MLD website administration application");await member.send("تم قبول تقديمك للإدارة في MLD، وتمت إضافة رتبة الإدارة الأولية.").catch(()=>{});}catch(error){console.error("Application role:",error);return res.status(503).json({error:"تعذر إضافة رتبة الإدارة. تحقق من APPLICATION_ROLE_ID وصلاحيات البوت."});}}a.status=next;a.reviewedBy=u.username;a.reviewedAt=nowIso();audit(u,"review","application",a.id,{status:next});res.json({ok:true,application:{...a,answers:undefined}});});
app.get("/api/platform/rooms",(req,res)=>{const now=Date.now();for(const [id,r] of platform.rooms){if(r.status!=="open"||now-Date.parse(r.updatedAt)>300000)platform.rooms.delete(id)}res.json({rooms:[...platform.rooms.values()].filter(r=>r.status==="open").map(({participants,spectators,...r})=>({...r,participantsCount:participants.length,spectatorsCount:spectators.length}))})});
app.post("/api/platform/rooms",(req,res)=>{const u=needUser(req,res);if(!u)return;const type=req.body?.type==="cinema"?"cinema":"game",title=safeText(req.body?.title,100),game=safeText(req.body?.game,500),maxPlayers=Math.max(2,Math.min(12,Number(req.body?.maxPlayers)||8));if(!title)return res.status(400).json({error:"اكتب اسم الجلسة"});if(type==="cinema"&&game&&!/^https:\/\//i.test(game))return res.status(400).json({error:"استخدم رابط HTTPS للمصدر المرخّص"});for(const [id,room] of platform.rooms){if(Date.now()-Date.parse(room.updatedAt)>300000)platform.rooms.delete(id);else if(room.status==="open"&&(room.participants.includes(u.username)||room.spectators.includes(u.username)))return res.status(409).json({error:"أنت داخل جلسة مفتوحة بالفعل، اخرج منها أولًا"});}const r={id:newId(),type,title,game,owner:u.username,status:"open",maxPlayers,participants:[u.username],spectators:[],ready:[],started:false,scores:{},createdAt:nowIso(),updatedAt:nowIso()};platform.rooms.set(r.id,r);audit(u,"create","room",r.id,{type});res.json({ok:true,room:{id:r.id,type,title,game,owner:r.owner,status:r.status,maxPlayers,participantsCount:1,spectatorsCount:0}});});
app.post("/api/platform/rooms/:id/join",(req,res)=>{const u=needUser(req,res);if(!u)return;const r=platform.rooms.get(req.params.id);if(!r||r.status!=="open"||Date.now()-Date.parse(r.updatedAt)>300000)return res.status(404).json({error:"الجلسة غير متاحة"});const mode=req.body?.mode==="spectator"?"spectator":"player";for(const [id,room] of platform.rooms){if(id!==r.id&&room.status==="open"&&(room.participants.includes(u.username)||room.spectators.includes(u.username)))return res.status(409).json({error:"أنت داخل جلسة ثانية بالفعل"});}if(mode==="spectator"){if(!r.spectators.includes(u.username))r.spectators.push(u.username);r.participants=r.participants.filter(x=>x!==u.username)}else{if(r.type==="game"&&r.participants.length>=r.maxPlayers&&!r.participants.includes(u.username))return res.status(409).json({error:"الجلسة مكتملة؛ ادخل كمشاهد"});if(!r.participants.includes(u.username))r.participants.push(u.username);r.spectators=r.spectators.filter(x=>x!==u.username)}r.updatedAt=nowIso();audit(u,mode==="spectator"?"spectate":"join","room",r.id);res.json({ok:true,room:{id:r.id,title:r.title,type:r.type,game:r.game,owner:r.owner,participants:r.participants,spectators:r.spectators}});});
app.get("/api/platform/rooms/:id/state",(req,res)=>{const u=needUser(req,res);if(!u)return;const r=platform.rooms.get(req.params.id);if(!r||r.status!=="open")return res.status(404).json({error:"الجلسة غير موجودة"});if(u.role!=="owner"&&r.owner!==u.username&&!r.participants.includes(u.username)&&!r.spectators.includes(u.username))return res.status(403).json({error:"انضم للجلسة أولًا"});res.json({room:{id:r.id,title:r.title,type:r.type,game:r.game,owner:r.owner,status:r.status,maxPlayers:r.maxPlayers,participants:r.participants,spectators:r.spectators,ready:r.ready||[],started:Boolean(r.started),scores:r.scores||{}}})});
app.post("/api/platform/rooms/:id/action",(req,res)=>{const u=needUser(req,res);if(!u)return;const r=platform.rooms.get(req.params.id);if(!r||r.status!=="open")return res.status(404).json({error:"الجلسة غير موجودة"});if(!r.participants.includes(u.username)&&u.role!=="owner")return res.status(403).json({error:"اللاعبون فقط يستطيعون تنفيذ هذا الإجراء"});const action=String(req.body?.action||"");if(action==="ready"){r.ready=r.ready||[];if(!r.ready.includes(u.username))r.ready.push(u.username)}else if(action==="start"){if(u.username!==r.owner&&u.role!=="owner")return res.status(403).json({error:"مالك الجلسة فقط يستطيع البدء"});r.started=true;r.startedAt=nowIso()}else if(action==="end"){if(u.username!==r.owner&&u.role!=="owner")return res.status(403).json({error:"مالك الجلسة فقط يستطيع إنهاء الجلسة"});r.status="closed"}else return res.status(400).json({error:"إجراء غير معروف"});r.updatedAt=nowIso();audit(u,action,"room",r.id);res.json({ok:true,room:{id:r.id,ready:r.ready||[],started:Boolean(r.started),status:r.status}})});
app.post("/api/platform/rooms/:id/leave",(req,res)=>{const u=needUser(req,res);if(!u)return;const r=platform.rooms.get(req.params.id);if(!r)return res.status(404).json({error:"الجلسة غير موجودة"});r.participants=r.participants.filter(x=>x!==u.username);r.spectators=r.spectators.filter(x=>x!==u.username);r.updatedAt=nowIso();audit(u,"leave","room",r.id);res.json({ok:true})});
app.post("/api/platform/rooms/:id/close",(req,res)=>{const u=needUser(req,res);if(!u)return;const r=platform.rooms.get(req.params.id);if(!r)return res.status(404).json({error:"الجلسة غير موجودة"});if(u.role!=="owner"&&r.owner!==u.username)return res.status(403).json({error:"مالك الجلسة فقط يستطيع إغلاقها"});r.status="closed";r.updatedAt=nowIso();audit(u,"close","room",r.id);res.json({ok:true});});
app.get("/api/platform/groups",(req,res)=>{const u=sessionUser(req);const groups=[...platform.groups.values()].filter(g=>g.status==="approved"||(u&&["owner","admin"].includes(u.role)));res.json({groups});});
app.post("/api/platform/groups",(req,res)=>{const u=needUser(req,res);if(!u)return;const name=safeText(req.body?.name,60),description=safeText(req.body?.description,500);if(name.length<3)return res.status(400).json({error:"اسم القروب قصير"});if(!u.discordId)return res.status(400).json({error:"اربط حسابك بعضوية ديسكورد أولًا"});const g={id:newId(),name,description,owner:u.username,discordOwnerId:u.discordId,status:"pending",createdAt:nowIso(),updatedAt:nowIso()};platform.groups.set(g.id,g);audit(u,"create","group_request",g.id);res.json({ok:true,group:g});});
app.patch("/api/platform/groups/:id",async(req,res)=>{const u=needStaff(req,res);if(!u)return;const g=platform.groups.get(req.params.id);if(!g)return res.status(404).json({error:"طلب القروب غير موجود"});const decision=String(req.body?.status||"");if(!["approved","rejected"].includes(decision))return res.status(400).json({error:"الحالة غير صالحة"});if(decision==="rejected"){g.status="rejected";g.reviewedBy=u.username;g.updatedAt=nowIso();audit(u,"reject","group_request",g.id);return res.json({ok:true,group:g});}try{const guild=await getGuild();const owner=await guild.members.fetch(g.discordOwnerId);const safeName=g.name.replace(/[^\p{L}\p{N} _-]/gu,"").trim().slice(0,80)||"mld-group";const role=await guild.roles.create({name:"MLD • "+safeName,reason:"Approved MLD website group request"});let category;try{category=await guild.channels.create({name:safeName,type:4,permissionOverwrites:[{id:guild.id,deny:["ViewChannel"]},{id:role.id,allow:["ViewChannel","SendMessages","ReadMessageHistory","Connect","Speak"]}],reason:"Approved MLD website group request"});const textChannel=await guild.channels.create({name:"chat",type:0,parent:category.id,reason:"MLD group text channel"});const voiceChannel=await guild.channels.create({name:"voice",type:2,parent:category.id,reason:"MLD group voice channel"});await owner.roles.add(role);g.status="approved";g.roleId=role.id;g.categoryId=category.id;g.textChannelId=textChannel.id;g.voiceChannelId=voiceChannel.id;g.inviteHint="تم إنشاء القروب وقنواته في ديسكورد";g.reviewedBy=u.username;g.updatedAt=nowIso();audit(u,"approve","group_request",g.id,{roleId:role.id,categoryId:category.id});return res.json({ok:true,group:g});}catch(err){if(category)await category.delete("Rollback failed MLD group creation").catch(()=>{});await role.delete("Rollback failed MLD group creation").catch(()=>{});throw err}}catch(error){console.error("Group approval:",error);return res.status(503).json({error:"تعذر إنشاء القنوات والأدوار. تأكد من صلاحيات البوت Manage Channels وManage Roles."});}});
app.get("/api/platform/owner/users",(req,res)=>{const u=needUser(req,res);if(!u)return;if(u.role!=="owner")return res.status(403).json({error:"للأونر فقط"});res.json({users:[...siteUsers.values()].map(x=>({username:x.username,displayName:x.displayName,discordUsername:x.discordUsername,discordId:x.discordId||null,role:x.role,createdAt:x.createdAt}))});});
app.patch("/api/platform/owner/users/:username/role",(req,res)=>{const u=needUser(req,res);if(!u)return;if(u.role!=="owner")return res.status(403).json({error:"للأونر فقط"});const target=siteUsers.get(String(req.params.username));if(!target)return res.status(404).json({error:"الحساب غير موجود"});if(target.username===u.username)return res.status(400).json({error:"لا يمكنك تغيير صلاحية حساب الأونر الحالي"});const role=String(req.body?.role||"");if(!["member","admin"].includes(role))return res.status(400).json({error:"الصلاحية غير صالحة"});target.role=role;audit(u,"role_change","site_user",target.username,{role});res.json({ok:true,user:publicUser(target)});});
app.get("/api/platform/owner/audit",(req,res)=>{const u=needUser(req,res);if(!u)return;if(u.role!=="owner")return res.status(403).json({error:"السجلات الخاصة للأونر فقط"});res.json({logs:platform.audit.slice(0,500)});});

setInterval(async()=>{try{const guild=await getGuild();for(const u of siteUsers.values()){if(!u.discordId||u.role==="owner")continue;try{await guild.members.fetch(u.discordId)}catch(error){for(const [sessionToken,sessionUserValue] of sessions){if(sessionUserValue.username===u.username)sessions.delete(sessionToken)}}}}catch(error){console.error("Membership session check:",error.message)}},60000).unref?.();
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    botReady: client.isReady(),
    membersCached: Boolean(memberSnapshot),
    membersCachedCount: memberSnapshot?.length || 0,
    membersUpdatedAt: memberSnapshotAt || null
  });
});

app.get("/api/public/server", async (req, res) => {
  try {
    const guild = await getGuild();
    res.json({
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL({ extension: "png", size: 256 }),
      memberCount: guild.memberCount,
      ownerName: process.env.SERVER_FOUNDER_NAME || "فهد المطيري",
      onlineCount: (await getAllMembers(guild)).filter((member) => member.presence?.status && member.presence.status !== "offline").length,
      visits: siteVisits,
      invite: process.env.DISCORD_INVITE_URL || ""
    });
  } catch (error) {
    console.error("Server endpoint:", error);
    res.status(503).json({ error: "Discord server unavailable" });
  }
});

app.get("/api/public/members", async (req, res) => {
  try {
    const guild = await getGuild();
    const allMembers = await getAllMembers(guild);
    const query = String(req.query.q || "").trim().toLocaleLowerCase("ar");
    const cleanQuery = query.replace(/^@/, "");

    const filtered = cleanQuery
      ? allMembers.filter((member) => {
          const searchable = [
            member.displayName,
            member.user.username,
            member.user.globalName,
            member.user.tag,
            member.id
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("ar");
          return searchable.includes(cleanQuery);
        })
      : allMembers;

    res.json({
      members: sortedMemberJson(filtered),
      total: filtered.length,
      totalServerMembers: allMembers.length,
      updatedAt: memberSnapshotAt,
      cached: Boolean(memberSnapshot)
    });
  } catch (error) {
    console.error("Members endpoint:", error);
    res.status(503).json({ error: "Members are temporarily unavailable" });
  }
});

app.get("/api/public/roles", async (req, res) => {
  try {
    const guild = await getGuild();
    const allMembers = await getAllMembers(guild);

    const roles = leadershipRoleIds
      .map((id) => guild.roles.cache.get(id))
      .filter(Boolean)
      .map((role) => {
        const count = allMembers.reduce(
          (total, member) => total + (member.roles.cache.has(role.id) ? 1 : 0),
          0
        );
        return roleJson(role, count);
      });

    res.json({ roles, updatedAt: memberSnapshotAt });
  } catch (error) {
    console.error("Roles endpoint:", error);
    res.status(503).json({ error: "Roles are temporarily unavailable" });
  }
});

app.get("/api/public/roles/:id/members", async (req, res) => {
  try {
    const guild = await getGuild();
    const role = guild.roles.cache.get(req.params.id);

    if (!role || !leadershipRoleSet.has(role.id)) {
      return res.status(404).json({ error: "Role not found" });
    }

    const roleMembers = (await getAllMembers(guild))
      .filter((member) => member.roles.cache.has(role.id));

    res.json({
      role: roleJson(role, roleMembers.length),
      members: sortedMemberJson(roleMembers),
      updatedAt: memberSnapshotAt
    });
  } catch (error) {
    console.error("Role members endpoint:", error);
    res.status(503).json({ error: "Role members are temporarily unavailable" });
  }
});

app.get("/api/public/top", async (req, res) => {
  try {
    const members = (await getAllMembers(await getGuild())).map(memberJson);
    const top = (key) => [...members]
      .sort((a, b) => (b.stats[key] || 0) - (a.stats[key] || 0))
      .slice(0, 10);

    res.json({
      messages: top("messages"),
      mentions: top("mentionsReceived"),
      voice: top("voiceMinutes"),
      joins: top("voiceJoins"),
      updatedAt: memberSnapshotAt
    });
  } catch (error) {
    console.error("Top endpoint:", error);
    res.status(503).json({ error: "Top is temporarily unavailable" });
  }
});

app.get("/api/public/member/:id", async (req, res) => {
  try {
    const guild = await getGuild();
    const member = await guild.members.fetch(req.params.id).catch(() => null);

    if (!member) return res.status(404).json({ error: "Member not found" });

    const highest = member.roles.cache
      .filter((role) => role.id !== guild.id && !role.managed)
      .sort((a, b) => b.position - a.position)
      .first();

    res.json({
      ...memberJson(member),
      highestRole: highest ? roleJson(highest) : null,
      permissions: highest ? importantPermissions(highest.permissions) : [],
      upcomingRoles: guild.roles.cache
        .filter((role) => role.position > (highest?.position || 0) && !role.managed)
        .sort((a, b) => a.position - b.position)
        .first(8)
        .map((role) => roleJson(role))
    });
  } catch (error) {
    console.error("Member endpoint:", error);
    res.status(404).json({ error: "Member not found" });
  }
});

app.post("/api/public/message", async (req, res) => {
  const now = Date.now();
  const ip = req.ip || "unknown";
  const last = sendHits.get(ip) || 0;

  if (now - last < 10_000) {
    return res.status(429).json({ error: "انتظر 10 ثواني قبل الإرسال مرة أخرى" });
  }

  const title = String(req.body?.title || "رسالة من إدارة MLD").trim();
  const text = String(req.body?.message || "").trim();
  const targetId = String(req.body?.memberId || "").trim();

  if (!targetId || !text || text.length > 2000 || title.length > 120) {
    return res.status(400).json({ error: "بيانات الرسالة غير صحيحة" });
  }

  try {
    const member = await (await getGuild()).members.fetch(targetId).catch(() => null);
    if (!member) return res.status(404).json({ error: "العضو غير موجود" });

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(text)
      .setColor("#ff9cdc")
      .setFooter({ text: "MLD Community" })
      .setTimestamp();

    await member.send({ embeds: [embed] });
    sendHits.set(ip, now);
    res.json({ ok: true });
  } catch (error) {
    console.error("DM endpoint:", error);
    res.status(500).json({ error: "تعذر الإرسال؛ قد يكون الخاص مقفلًا" });
  }
});

client.on("guildMemberAdd", invalidateMemberSnapshot);
client.on("guildMemberRemove", invalidateMemberSnapshot);
client.on("guildMemberUpdate", invalidateMemberSnapshot);

client.on("messageCreate", (message) => {
  if (message.author.bot) return;

  const sender = getActivity(message.author.id);
  sender.messages += 1;
  sender.chatRounds += 1;

  for (const id of message.mentions.users.keys()) {
    getActivity(id).mentionsReceived += 1;
    sender.mentionsSent += 1;
  }
});

client.on("voiceStateUpdate", (oldState, newState) => {
  const id = newState.id;

  if (!oldState.channelId && newState.channelId) {
    voiceSessions.set(id, Date.now());
    getActivity(id).voiceJoins += 1;
  }

  if (oldState.channelId && !newState.channelId && voiceSessions.has(id)) {
    getActivity(id).voiceMinutes += Math.round(
      (Date.now() - voiceSessions.get(id)) / 60000
    );
    voiceSessions.delete(id);
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => console.log(`MLD listening on port ${port}`));
client.once("ready", () => console.log(`Logged in as ${client.user.tag}`));
client.login(token).catch((error) => {
  console.error("Discord login failed:", error.message);
  process.exit(1);
});

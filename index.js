"use strict";
require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const express = require("express");
const cors = require("cors");
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const port = Number(process.env.PORT || 3000);

if (!token || !guildId) {
  console.error("Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences
  ]
});

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "20kb" }));

// كل تحميل فعلي للصفحة الرئيسية = زيارة واحدة.
app.use((req, res, next) => {
  if (req.method === "GET" && req.path === "/") siteVisits += 1;
  next();
});

app.use(express.static(path.join(__dirname, "public")));

const leadershipRoleIds = [
  "1530712642384040027", // Owner
  "1521187079336362024", // Co-Owner
  "1531109479264026706", // Founder
  "1548732297669255259", // Senior Staff
  "1548732341185155103", // Staff
  "1548732606508703744"  // Junior Staff
];

const leadershipRoleSet = new Set(leadershipRoleIds);
const importantPermissionNames = new Set([
  "Administrator",
  "ManageGuild",
  "ManageRoles",
  "ManageChannels",
  "ManageMessages",
  "ManageWebhooks",
  "ManageNicknames",
  "BanMembers",
  "KickMembers",
  "ModerateMembers",
  "MentionEveryone",
  "ViewAuditLog",
  "ManageEvents",
  "ManageThreads",
  "ManageEmojisAndStickers"
]);

const activity = new Map();
const voiceSessions = new Map();
const sendHits = new Map();
const siteUsers = new Map();
const sessions = new Map();
const pendingSignups = new Map();
let siteVisits = 0;

let guildCache = null;
let guildCacheAt = 0;
let guildFetchPromise = null;
let memberSnapshot = null;
let memberSnapshotAt = 0;
let memberFetchPromise = null;

const MEMBER_CACHE_TTL = 45_000;
const GUILD_CACHE_TTL = 15_000;

function getActivity(id) {
  if (!activity.has(id)) {
    activity.set(id, {
      messages: 0,
      mentionsReceived: 0,
      mentionsSent: 0,
      voiceMinutes: 0,
      voiceJoins: 0,
      chatRounds: 0
    });
  }

  return activity.get(id);
}

async function getGuild() {
  if (guildCache && Date.now() - guildCacheAt < GUILD_CACHE_TTL) {
    return guildCache;
  }

  if (guildFetchPromise) return guildFetchPromise;

  guildFetchPromise = client.guilds.fetch(guildId)
    .then((guild) => {
      guildCache = guild;
      guildCacheAt = Date.now();
      return guild;
    })
    .finally(() => {
      guildFetchPromise = null;
    });

  return guildFetchPromise;
}

function invalidateMemberSnapshot() {
  memberSnapshotAt = 0;
}

async function getAllMembers(guild) {
  const fresh = memberSnapshot && Date.now() - memberSnapshotAt < MEMBER_CACHE_TTL;
  if (fresh) return memberSnapshot;
  if (memberFetchPromise) return memberFetchPromise;

  memberFetchPromise = guild.members.fetch()
    .then((collection) => {
      // لا نستبعد البوتات: هذه القائمة تمثل كل أعضاء السيرفر فعلًا.
      memberSnapshot = [...collection.values()];
      memberSnapshotAt = Date.now();
      return memberSnapshot;
    })
    .catch((error) => {
      // عند حدوث Rate Limit أو فشل مؤقت، نستخدم آخر لقطة صحيحة بدل قائمة فارغة.
      if (memberSnapshot?.length) return memberSnapshot;
      throw error;
    })
    .finally(() => {
      memberFetchPromise = null;
    });

  return memberFetchPromise;
}

function importantPermissions(permissionCollection) {
  return permissionCollection.toArray()
    .filter((permission) => importantPermissionNames.has(permission));
}

function roleJson(role, membersCount = role.members?.size || 0) {
  return {
    id: role.id,
    name: role.name,
    color: role.hexColor,
    position: role.position,
    permissions: importantPermissions(role.permissions),
    membersCount,
    mentionable: role.mentionable
  };
}

function memberJson(member) {
  const roles = member.roles.cache
    .filter((role) => role.id !== member.guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => roleJson(role));

  const leadershipRoles = roles.filter((role) => leadershipRoleSet.has(role.id));

  return {
    id: member.id,
    name: member.displayName,
    username: member.user.username,
    globalName: member.user.globalName,
    bot: member.user.bot,
    avatar: member.user.displayAvatarURL({ extension: "png", size: 256 }),
    joinedAt: member.joinedAt,
    roles,
    importantRoles: leadershipRoles,
    rank: leadershipRoles[0]?.name || roles[0]?.name || "عضو",
    stats: getActivity(member.id)
  };
}

function sortedMemberJson(members) {
  return [...members]
    .sort((a, b) => {
      const aRole = a.roles.cache
        .filter((role) => leadershipRoleSet.has(role.id))
        .sort((x, y) => y.position - x.position)
        .first();
      const bRole = b.roles.cache
        .filter((role) => leadershipRoleSet.has(role.id))
        .sort((x, y) => y.position - x.position)
        .first();
      return (bRole?.position || 0) - (aRole?.position || 0);
    })
    .map(memberJson);
}

function cleanUsername(value){return String(value||"").trim().toLowerCase().replace(/[^a-z0-9_\-]/g,"").slice(0,24)}
function sessionUser(req){const token=req.headers.cookie?.match(/(?:^|;\s*)mld_session=([^;]+)/)?.[1];return token?sessions.get(token)||null:null}
function publicUser(u){return u?{username:u.username,displayName:u.displayName,discordUsername:u.discordUsername,role:u.role,createdAt:u.createdAt}:null}
app.get("/api/auth/me",(req,res)=>res.json({authenticated:Boolean(sessionUser(req)),user:publicUser(sessionUser(req))}));
app.post("/api/auth/login",async(req,res)=>{const username=cleanUsername(req.body?.username),password=String(req.body?.password||"");if(!username||!password)return res.status(400).json({error:"اكتب اسم المستخدم وكلمة المرور"});let u=siteUsers.get(username);if(!u&&username===cleanUsername(process.env.OWNER_USERNAME||"w4px")&&password===String(process.env.OWNER_PASSWORD||"")){u={username,displayName:process.env.OWNER_DISPLAY_NAME||"فهد المطيري",discordUsername:process.env.OWNER_DISCORD_USERNAME||"w4px",role:"owner",passwordHash:await bcrypt.hash(password,12),createdAt:new Date().toISOString()};siteUsers.set(username,u)}if(!u||!u.passwordHash||!(await bcrypt.compare(password,u.passwordHash)))return res.status(401).json({error:"اسم المستخدم أو كلمة المرور غير صحيحة"});const token=crypto.randomBytes(32).toString("hex");sessions.set(token,u);res.setHeader("Set-Cookie","mld_session="+token+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800");res.json({ok:true,user:publicUser(u)})});
app.post("/api/auth/signup",async(req,res)=>{const username=cleanUsername(req.body?.username),password=String(req.body?.password||""),discordUsername=String(req.body?.discordUsername||"").trim();if(username.length<3||password.length<6||!discordUsername)return res.status(400).json({error:"اسم المستخدم 3 أحرف على الأقل وكلمة المرور 6 أحرف"});if(siteUsers.has(username))return res.status(409).json({error:"اسم المستخدم مستخدم بالفعل"});try{const guild=await getGuild(),members=await getAllMembers(guild),member=members.find(m=>m.user.username.toLowerCase()===discordUsername.toLowerCase()||String(m.user.globalName||"").toLowerCase()===discordUsername.toLowerCase());if(!member)return res.status(403).json({error:"يوزر الديسكورد غير موجود في السيرفر"});if([...siteUsers.values()].some(u=>u.discordId===member.id))return res.status(409).json({error:"حساب ديسكورد مرتبط بحساب MLD آخر"});pendingSignups.set(username,{username,passwordHash:await bcrypt.hash(password,12),discordUsername,memberId:member.id,expires:Date.now()+600000,confirmed:false});try{const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("mld_signup_confirm_"+username).setLabel("تأكيد إنشاء حساب MLD").setStyle(ButtonStyle.Success));await member.send({content:"تم طلب إنشاء حساب في MLD. إذا كنت أنت صاحب الطلب اضغط الزر أدناه للتأكيد.",components:[row]})}catch(e){pendingSignups.delete(username);return res.status(503).json({error:"تعذر إرسال زر التأكيد للخاص في ديسكورد"})}res.json({ok:true,verificationRequired:true,message:"أرسلنا لك زر تأكيد في الخاص بديسكورد"})}catch(e){console.error("Signup:",e);res.status(503).json({error:"تعذر التحقق من عضو الديسكورد"})}});
app.get("/api/auth/signup-status",(req,res)=>{const p=pendingSignups.get(cleanUsername(req.query?.username));res.json({pending:Boolean(p),confirmed:Boolean(p?.confirmed),expired:Boolean(p&&Date.now()>p.expires)});});
app.post("/api/auth/verify-signup",(req,res)=>{const username=cleanUsername(req.body?.username),p=pendingSignups.get(username);if(!p||Date.now()>p.expires)return res.status(400).json({error:"انتهت صلاحية طلب التسجيل، أعد المحاولة"});if(!p.confirmed)return res.status(400).json({error:"اضغط زر التأكيد في الخاص بديسكورد أولًا"});const u={username:p.username,displayName:p.username,discordUsername:p.discordUsername,discordId:p.memberId,role:"member",passwordHash:p.passwordHash,createdAt:new Date().toISOString()};siteUsers.set(username,u);pendingSignups.delete(username);const token=crypto.randomBytes(32).toString("hex");sessions.set(token,u);res.setHeader("Set-Cookie","mld_session="+token+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800");res.json({ok:true,user:publicUser(u)});});
client.on("interactionCreate",async(interaction)=>{if(!interaction.isButton()||!interaction.customId.startsWith("mld_signup_confirm_"))return;const username=cleanUsername(interaction.customId.slice("mld_signup_confirm_".length));const p=pendingSignups.get(username);if(!p||Date.now()>p.expires){return interaction.reply({content:"انتهت صلاحية طلب التسجيل. ارجع للموقع وابدأ من جديد.",ephemeral:true})}if(interaction.user.id!==p.memberId)return interaction.reply({content:"هذا الزر مخصص لصاحب طلب التسجيل فقط.",ephemeral:true});p.confirmed=true;pendingSignups.set(username,p);await interaction.update({content:"تم تأكيد إنشاء حساب MLD بنجاح ✓ ارجع للموقع لإكمال الدخول.",components:[]});});
app.post("/api/auth/logout",(req,res)=>{const token=req.headers.cookie?.match(/(?:^|;\s*)mld_session=([^;]+)/)?.[1];if(token)sessions.delete(token);res.setHeader("Set-Cookie","mld_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");res.json({ok:true})});

// MLD platform modules (runtime store; use durable database before production scale).
const platform = {
  publicChat: [], reviews: [], jokes: [], vents: [], stories: [],
  conversations: new Map(), tickets: new Map(), applications: new Map(), rooms: new Map(), groups: new Map(), audit: []
};
const newId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
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
app.delete("/api/platform/chat/:id",(req,res)=>{const u=needUser(req,res);if(!u)return;const m=platform.publicChat.find(x=>x.id===req.params.id);if(!m)return res.status(404).json({error:"الرسالة غير موجودة"});if(u.role!=="owner"&&m.user.username!==u.username)return res.status(403).json({error:"لا يمكنك حذف هذه الرسالة"});m.deleted=true;m.text="تم حذف الرسالة";m.deletedAt=nowIso();audit(u,"delete","public_message",m.id);res.json({ok:true});});
app.get("/api/platform/reviews",(req,res)=>res.json({reviews:platform.reviews.filter(x=>!x.deleted).slice(0,100)}));
app.post("/api/platform/reviews",(req,res)=>{const u=needUser(req,res);if(!u)return;const text=safeText(req.body?.text,600);const rating=Math.max(1,Math.min(5,Number(req.body?.rating)||5));if(text.length<4)return res.status(400).json({error:"اكتب رأيًا من 4 أحرف على الأقل"});const r={id:newId(),user:publicProfile(u),text,rating,createdAt:nowIso(),deleted:false};platform.reviews.unshift(r);audit(u,"create","review",r.id);res.json({ok:true,review:r});});
app.delete("/api/platform/reviews/:id",(req,res)=>{const u=needUser(req,res);if(!u)return;const r=platform.reviews.find(x=>x.id===req.params.id);if(!r)return res.status(404).json({error:"الرأي غير موجود"});if(u.role!=="owner"&&r.user.username!==u.username)return res.status(403).json({error:"لا يمكنك حذف هذا الرأي"});r.deleted=true;audit(u,"delete","review",r.id);res.json({ok:true});});
for (const [route,key,max] of [["jokes","jokes",1000],["vent","vents",1500],["stories","stories",3000]]) {
  app.get("/api/platform/"+route,(req,res)=>res.json({items:platform[key].filter(x=>!x.deleted).slice(0,100)}));
  app.post("/api/platform/"+route,(req,res)=>{const u=needUser(req,res);if(!u)return;const text=safeText(req.body?.text,max);if(text.length<4)return res.status(400).json({error:"المحتوى قصير جدًا"});const item={id:newId(),user:publicProfile(u),text,createdAt:nowIso(),deleted:false};platform[key].unshift(item);audit(u,"create",route,item.id);res.json({ok:true,item});});
  app.delete("/api/platform/"+route+"/:id",(req,res)=>{const u=needUser(req,res);if(!u)return;const item=platform[key].find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:"العنصر غير موجود"});if(u.role!=="owner"&&item.user.username!==u.username)return res.status(403).json({error:"لا يمكنك حذف هذا المحتوى"});item.deleted=true;audit(u,"delete",route,item.id);res.json({ok:true});});
}
app.get("/api/platform/conversations",(req,res)=>{const u=needUser(req,res);if(!u)return;res.json({conversations:[...platform.conversations.values()].filter(c=>visibleConversation(c,u)).map(c=>({id:c.id,title:c.title,owner:c.owner,members:c.members,updatedAt:c.updatedAt,messageCount:c.messages.length}))});});
app.post("/api/platform/conversations",(req,res)=>{const u=needUser(req,res);if(!u)return;const members=Array.isArray(req.body?.members)?[...new Set(req.body.members.map(x=>String(x).slice(0,24)).filter(x=>siteUsers.has(x)&&x!==u.username))].slice(0,20):[];if(!members.length)return res.status(400).json({error:"اختر حسابًا واحدًا على الأقل"});const c={id:newId(),title:safeText(req.body?.title,80)||members.map(x=>siteUsers.get(x).displayName||x).join("، "),owner:u.username,members:[u.username,...members],messages:[],createdAt:nowIso(),updatedAt:nowIso()};platform.conversations.set(c.id,c);audit(u,"create","conversation",c.id,{members:c.members});res.json({ok:true,conversation:{id:c.id,title:c.title,owner:c.owner,members:c.members}});});
app.get("/api/platform/conversations/:id/messages",(req,res)=>{const u=needUser(req,res);if(!u)return;const c=platform.conversations.get(req.params.id);if(!c||!visibleConversation(c,u))return res.status(404).json({error:"المحادثة غير موجودة"});res.json({messages:c.messages.slice(-200)});});
app.post("/api/platform/conversations/:id/messages",(req,res)=>{const u=needUser(req,res);if(!u)return;const c=platform.conversations.get(req.params.id);if(!c||!visibleConversation(c,u))return res.status(404).json({error:"المحادثة غير موجودة"});const text=safeText(req.body?.text,2000);if(!text)return res.status(400).json({error:"اكتب الرسالة"});const m={id:newId(),user:publicProfile(u),text,createdAt:nowIso(),deleted:false};c.messages.push(m);c.updatedAt=nowIso();audit(u,"send","private_message",m.id,{conversationId:c.id});res.json({ok:true,message:m});});
app.delete("/api/platform/conversations/:id/messages/:messageId",(req,res)=>{const u=needUser(req,res);if(!u)return;const c=platform.conversations.get(req.params.id);if(!c||!visibleConversation(c,u))return res.status(404).json({error:"المحادثة غير موجودة"});const m=c.messages.find(x=>x.id===req.params.messageId);if(!m)return res.status(404).json({error:"الرسالة غير موجودة"});if(u.role!=="owner"&&m.user.username!==u.username&&c.owner!==u.username)return res.status(403).json({error:"لا تملك صلاحية حذف الرسالة"});m.deleted=true;m.text="تم حذف الرسالة";m.deletedAt=nowIso();audit(u,"delete","private_message",m.id,{conversationId:c.id});res.json({ok:true});});
app.post("/api/platform/conversations/:id/members",(req,res)=>{const u=needUser(req,res);if(!u)return;const c=platform.conversations.get(req.params.id);if(!c||!visibleConversation(c,u))return res.status(404).json({error:"المحادثة غير موجودة"});if(c.owner!==u.username&&u.role!=="owner")return res.status(403).json({error:"مالك المحادثة فقط يستطيع إدارة الأعضاء"});const name=String(req.body?.username||"").slice(0,24);if(!siteUsers.has(name))return res.status(404).json({error:"الحساب غير موجود"});if(!c.members.includes(name))c.members.push(name);audit(u,"add_member","conversation",c.id,{username:name});res.json({ok:true,members:c.members});});
app.delete("/api/platform/conversations/:id/members/:username",(req,res)=>{const u=needUser(req,res);if(!u)return;const c=platform.conversations.get(req.params.id);if(!c||!visibleConversation(c,u))return res.status(404).json({error:"المحادثة غير موجودة"});if(c.owner!==u.username&&u.role!=="owner")return res.status(403).json({error:"مالك المحادثة فقط يستطيع إدارة الأعضاء"});if(req.params.username===c.owner)return res.status(400).json({error:"لا يمكن طرد مالك المحادثة"});c.members=c.members.filter(x=>x!==req.params.username);audit(u,"remove_member","conversation",c.id,{username:req.params.username});res.json({ok:true,members:c.members});});
app.get("/api/platform/tickets",(req,res)=>{const u=needUser(req,res);if(!u)return;const all=[...platform.tickets.values()].filter(t=>u.role==="owner"||u.role==="admin"||t.owner===u.username);res.json({tickets:all.map(({messages,...t})=>({...t,messageCount:messages.length}))});});
app.post("/api/platform/tickets",(req,res)=>{const u=needUser(req,res);if(!u)return;const title=safeText(req.body?.title,100),text=safeText(req.body?.text,2000);if(!title||!text)return res.status(400).json({error:"اكتب عنوان الطلب والتفاصيل"});const t={id:newId(),title,text,owner:u.username,status:"open",messages:[],createdAt:nowIso(),updatedAt:nowIso()};platform.tickets.set(t.id,t);audit(u,"create","ticket",t.id);res.json({ok:true,ticket:{...t,messages:undefined}});});
app.post("/api/platform/tickets/:id/reply",(req,res)=>{const u=needUser(req,res);if(!u)return;const t=platform.tickets.get(req.params.id);if(!t)return res.status(404).json({error:"التذكرة غير موجودة"});if(u.role!=="owner"&&u.role!=="admin"&&t.owner!==u.username)return res.status(403).json({error:"هذه التذكرة ليست لك"});const text=safeText(req.body?.text,2000);if(!text)return res.status(400).json({error:"اكتب الرد"});t.messages.push({id:newId(),user:publicProfile(u),text,createdAt:nowIso()});t.updatedAt=nowIso();audit(u,"reply","ticket",t.id);res.json({ok:true});});
app.patch("/api/platform/tickets/:id",(req,res)=>{const u=needStaff(req,res);if(!u)return;const t=platform.tickets.get(req.params.id);if(!t)return res.status(404).json({error:"التذكرة غير موجودة"});const next=String(req.body?.status||"");if(!["open","claimed","closed"].includes(next))return res.status(400).json({error:"حالة غير صالحة"});t.status=next;t.assignee=next==="claimed"?u.username:t.assignee;t.updatedAt=nowIso();audit(u,"status","ticket",t.id,{status:next});res.json({ok:true,ticket:{...t,messages:undefined}});});
app.get("/api/platform/applications",(req,res)=>{const u=needUser(req,res);if(!u)return;const all=[...platform.applications.values()].filter(a=>u.role==="owner"||u.role==="admin"||a.owner===u.username);res.json({applications:all.map(({answers,...a})=>({...a,answers:u.role==="owner"||u.role==="admin"?answers:undefined}))});});
app.post("/api/platform/applications",(req,res)=>{const u=needUser(req,res);if(!u)return;const discordUsername=safeText(req.body?.discordUsername,80),answers=safeText(req.body?.answers,3000);if(!discordUsername||!answers)return res.status(400).json({error:"اكتب يوزر ديسكورد وإجاباتك"});const a={id:newId(),owner:u.username,discordUsername,answers,status:"pending",createdAt:nowIso()};platform.applications.set(a.id,a);audit(u,"submit","application",a.id);res.json({ok:true,application:{...a,answers:undefined}});});
app.patch("/api/platform/applications/:id",(req,res)=>{const u=needStaff(req,res);if(!u)return;const a=platform.applications.get(req.params.id);if(!a)return res.status(404).json({error:"الطلب غير موجود"});const next=String(req.body?.status||"");if(!["pending","accepted","rejected"].includes(next))return res.status(400).json({error:"حالة غير صالحة"});a.status=next;a.reviewedBy=u.username;a.reviewedAt=nowIso();audit(u,"review","application",a.id,{status:next});res.json({ok:true,application:{...a,answers:undefined}});});
app.get("/api/platform/rooms",(req,res)=>{const now=Date.now();for(const [id,r] of platform.rooms){if(r.status!=="open"||now-Date.parse(r.updatedAt)>300000)platform.rooms.delete(id)}res.json({rooms:[...platform.rooms.values()].filter(r=>r.status==="open").map(({participants,spectators,...r})=>({...r,participantsCount:participants.length,spectatorsCount:spectators.length}))})});
app.post("/api/platform/rooms",(req,res)=>{const u=needUser(req,res);if(!u)return;const type=req.body?.type==="cinema"?"cinema":"game",title=safeText(req.body?.title,100),game=safeText(req.body?.game,500),maxPlayers=Math.max(2,Math.min(12,Number(req.body?.maxPlayers)||8));if(!title)return res.status(400).json({error:"اكتب اسم الجلسة"});for(const [id,room] of platform.rooms){if(Date.now()-Date.parse(room.updatedAt)>300000)platform.rooms.delete(id);else if(room.status==="open"&&(room.participants.includes(u.username)||room.spectators.includes(u.username)))return res.status(409).json({error:"أنت داخل جلسة مفتوحة بالفعل، اخرج منها أولًا"});}const r={id:newId(),type,title,game,owner:u.username,status:"open",maxPlayers,participants:[u.username],spectators:[],createdAt:nowIso(),updatedAt:nowIso()};platform.rooms.set(r.id,r);audit(u,"create","room",r.id,{type});res.json({ok:true,room:{id:r.id,type,title,game,owner:r.owner,status:r.status,maxPlayers,participantsCount:1,spectatorsCount:0}});});
app.post("/api/platform/rooms/:id/join",(req,res)=>{const u=needUser(req,res);if(!u)return;const r=platform.rooms.get(req.params.id);if(!r||r.status!=="open"||Date.now()-Date.parse(r.updatedAt)>300000)return res.status(404).json({error:"الجلسة غير متاحة"});const mode=req.body?.mode==="spectator"?"spectator":"player";for(const [id,room] of platform.rooms){if(id!==r.id&&room.status==="open"&&(room.participants.includes(u.username)||room.spectators.includes(u.username)))return res.status(409).json({error:"أنت داخل جلسة ثانية بالفعل"});}if(mode==="spectator"){if(!r.spectators.includes(u.username))r.spectators.push(u.username);r.participants=r.participants.filter(x=>x!==u.username)}else{if(r.type==="game"&&r.participants.length>=r.maxPlayers&&!r.participants.includes(u.username))return res.status(409).json({error:"الجلسة مكتملة؛ ادخل كمشاهد"});if(!r.participants.includes(u.username))r.participants.push(u.username);r.spectators=r.spectators.filter(x=>x!==u.username)}r.updatedAt=nowIso();audit(u,mode==="spectator"?"spectate":"join","room",r.id);res.json({ok:true,room:{id:r.id,title:r.title,type:r.type,game:r.game,owner:r.owner,participants:r.participants,spectators:r.spectators}});});
app.post("/api/platform/rooms/:id/leave",(req,res)=>{const u=needUser(req,res);if(!u)return;const r=platform.rooms.get(req.params.id);if(!r)return res.status(404).json({error:"الجلسة غير موجودة"});r.participants=r.participants.filter(x=>x!==u.username);r.spectators=r.spectators.filter(x=>x!==u.username);r.updatedAt=nowIso();audit(u,"leave","room",r.id);res.json({ok:true})});
app.post("/api/platform/rooms/:id/close",(req,res)=>{const u=needUser(req,res);if(!u)return;const r=platform.rooms.get(req.params.id);if(!r)return res.status(404).json({error:"الجلسة غير موجودة"});if(u.role!=="owner"&&r.owner!==u.username)return res.status(403).json({error:"مالك الجلسة فقط يستطيع إغلاقها"});r.status="closed";r.updatedAt=nowIso();audit(u,"close","room",r.id);res.json({ok:true});});
app.get("/api/platform/groups",(req,res)=>{const u=sessionUser(req);const groups=[...platform.groups.values()].filter(g=>g.status==="approved"||(u&&["owner","admin"].includes(u.role)));res.json({groups});});
app.post("/api/platform/groups",(req,res)=>{const u=needUser(req,res);if(!u)return;const name=safeText(req.body?.name,60),description=safeText(req.body?.description,500);if(name.length<3)return res.status(400).json({error:"اسم القروب قصير"});if(!u.discordId)return res.status(400).json({error:"اربط حسابك بعضوية ديسكورد أولًا"});const g={id:newId(),name,description,owner:u.username,discordOwnerId:u.discordId,status:"pending",createdAt:nowIso(),updatedAt:nowIso()};platform.groups.set(g.id,g);audit(u,"create","group_request",g.id);res.json({ok:true,group:g});});
app.patch("/api/platform/groups/:id",async(req,res)=>{const u=needStaff(req,res);if(!u)return;const g=platform.groups.get(req.params.id);if(!g)return res.status(404).json({error:"طلب القروب غير موجود"});const decision=String(req.body?.status||"");if(!["approved","rejected"].includes(decision))return res.status(400).json({error:"الحالة غير صالحة"});if(decision==="rejected"){g.status="rejected";g.reviewedBy=u.username;g.updatedAt=nowIso();audit(u,"reject","group_request",g.id);return res.json({ok:true,group:g});}try{const guild=await getGuild();const owner=await guild.members.fetch(g.discordOwnerId);const safeName=g.name.replace(/[^\p{L}\p{N} _-]/gu,"").trim().slice(0,80)||"mld-group";const role=await guild.roles.create({name:"MLD • "+safeName,reason:"Approved MLD website group request"});let category;try{category=await guild.channels.create({name:safeName,type:4,permissionOverwrites:[{id:guild.id,deny:["ViewChannel"]},{id:role.id,allow:["ViewChannel","SendMessages","ReadMessageHistory","Connect","Speak"]}],reason:"Approved MLD website group request"});const textChannel=await guild.channels.create({name:"chat",type:0,parent:category.id,reason:"MLD group text channel"});const voiceChannel=await guild.channels.create({name:"voice",type:2,parent:category.id,reason:"MLD group voice channel"});await owner.roles.add(role);g.status="approved";g.roleId=role.id;g.categoryId=category.id;g.textChannelId=textChannel.id;g.voiceChannelId=voiceChannel.id;g.inviteHint="تم إنشاء القروب وقنواته في ديسكورد";g.reviewedBy=u.username;g.updatedAt=nowIso();audit(u,"approve","group_request",g.id,{roleId:role.id,categoryId:category.id});return res.json({ok:true,group:g});}catch(err){if(category)await category.delete("Rollback failed MLD group creation").catch(()=>{});await role.delete("Rollback failed MLD group creation").catch(()=>{});throw err}}catch(error){console.error("Group approval:",error);return res.status(503).json({error:"تعذر إنشاء القنوات والأدوار. تأكد من صلاحيات البوت Manage Channels وManage Roles."});}});
app.get("/api/platform/owner/users",(req,res)=>{const u=needUser(req,res);if(!u)return;if(u.role!=="owner")return res.status(403).json({error:"للأونر فقط"});res.json({users:[...siteUsers.values()].map(x=>({username:x.username,displayName:x.displayName,discordUsername:x.discordUsername,discordId:x.discordId||null,role:x.role,createdAt:x.createdAt}))});});
app.patch("/api/platform/owner/users/:username/role",(req,res)=>{const u=needUser(req,res);if(!u)return;if(u.role!=="owner")return res.status(403).json({error:"للأونر فقط"});const target=siteUsers.get(String(req.params.username));if(!target)return res.status(404).json({error:"الحساب غير موجود"});if(target.username===u.username)return res.status(400).json({error:"لا يمكنك تغيير صلاحية حساب الأونر الحالي"});const role=String(req.body?.role||"");if(!["member","admin"].includes(role))return res.status(400).json({error:"الصلاحية غير صالحة"});target.role=role;audit(u,"role_change","site_user",target.username,{role});res.json({ok:true,user:publicUser(target)});});
app.get("/api/platform/owner/audit",(req,res)=>{const u=needUser(req,res);if(!u)return;if(u.role!=="owner")return res.status(403).json({error:"السجلات الخاصة للأونر فقط"});res.json({logs:platform.audit.slice(0,500)});});

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

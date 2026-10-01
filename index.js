"use strict";
require("dotenv").config();

const path = require("path");
const http = require("http");
const { Server: SocketIOServer } = require("socket.io");
const express = require("express");
const cors = require("cors");
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs");

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
    GatewayIntentBits.GuildVoiceStates
  ]
});

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public")));

const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");
const TICKETS_FILE = path.join(__dirname, "tickets.json");
const AUDIT_LOG_FILE = path.join(__dirname, "audit-logs.json");
const DM_LOG_FILE = path.join(__dirname, "dm-logs.json");
const JOKES_FILE = path.join(__dirname, "jokes.json");
const REVIEWS_FILE = path.join(__dirname, "reviews.json");
const STORIES_FILE = path.join(__dirname, "stories.json");
const CHAT_FILE = path.join(__dirname, "chat.json");
const ANNOUNCEMENT_FILE = path.join(__dirname, "announcement.json");
const broadcastJobs = new Map();
function readAnnouncement(){ return readJsonFile(ANNOUNCEMENT_FILE,{enabled:false,text:"",color:"#ff9cdc"}); }
function writeAnnouncement(v){ writeJsonFile(ANNOUNCEMENT_FILE,v); }
function broadcastSafe(job){return {id:job.id,status:job.status,total:job.total,sent:job.sent,failed:job.failed,startedAt:job.startedAt,finishedAt:job.finishedAt||null,lastError:job.lastError||null};}
async function runBroadcast(job,message,titleText){
  try{
    const members=await getAllMembers(await getGuild());
    const targets=members.filter(m=>!m.user.bot);
    job.total=targets.length; job.status="sending";
    const embed=new EmbedBuilder().setTitle(titleText||"رسالة من MLD").setDescription(message).setColor("#ff9cdc").setFooter({text:"MLD Community"}).setTimestamp();
    for(const member of targets){
      try{
        await member.send({embeds:[embed]});
        job.sent++;
      }catch(error){
        if(error?.status===429 && Number(error?.retryAfter)>0){
          await new Promise(resolve=>setTimeout(resolve,Math.min(Number(error.retryAfter)*1000,15000)));
          try{ await member.send({embeds:[embed]}); job.sent++; }
          catch(retryError){ job.failed++; if(job.failed<=10)job.lastError=String(retryError?.message||"تعذر الإرسال"); }
        }else{
          job.failed++;
          if(job.failed<=10)job.lastError=String(error?.message||"تعذر الإرسال؛ قد يكون الخاص مقفلًا");
        }
      }
      await new Promise(resolve=>setTimeout(resolve,1200));
    }
    job.status="completed";job.finishedAt=new Date().toISOString();
    audit("broadcast.completed",{broadcastId:job.id,total:job.total,sent:job.sent,failed:job.failed},job.actor);
  }catch(error){
    job.status="failed";job.finishedAt=new Date().toISOString();job.lastError=String(error?.message||"تعذر تنفيذ البرودكاست");
    audit("broadcast.failed",{broadcastId:job.id,error:job.lastError},job.actor);
  }
}

function readChat(){ return readJsonFile(CHAT_FILE,{general:{id:"general",name:"الشات العام",type:"general",ownerId:null,members:[],messages:[]},rooms:[]}); }
function writeChat(v){ writeJsonFile(CHAT_FILE,v); }
function chatAccount(req){ return getAuthAccountFromReq(req); }
function chatSafeUser(a){ return {id:a.id,username:a.username,role:a.role}; }
function findChatRoom(data,id){ return data.rooms.find(r=>r.id===id); }
function roomMember(room,id){ return room.type==="general" || room.members.some(m=>m.id===id); }
function canRoomManage(room,a){ return a && (room.ownerId===a.id || a.role==="owner"); }
function addChatMessage(room,a,text){const m={id:crypto.randomUUID(),userId:a.id,userName:a.username,role:a.role,text:cleanText(text,4000),createdAt:new Date().toISOString()};room.messages.push(m);if(room.messages.length>2000)room.messages=room.messages.slice(-2000);return m;}

app.get("/api/chat/users",(req,res)=>{const a=chatAccount(req);if(!a)return res.status(401).json({error:"سجل الدخول أولًا"});res.json({users:readAccounts().filter(x=>x.id!==a.id).map(chatSafeUser)});});
app.get("/api/chat/rooms",(req,res)=>{const a=chatAccount(req);if(!a)return res.status(401).json({error:"سجل الدخول أولًا"});const d=readChat();res.json({general:{id:"general",name:"الشات العام",type:"general",messages:d.general.messages.slice(-100)},rooms:d.rooms.filter(r=>roomMember(r,a.id)).map(r=>({...r,messages:r.messages.slice(-100)}))});});
app.post("/api/chat/rooms",(req,res)=>{const a=chatAccount(req);if(!a)return res.status(401).json({error:"سجل الدخول أولًا"});const ids=Array.isArray(req.body?.memberIds)?req.body.memberIds.map(String):[];const unique=[a.id,...ids.filter(id=>id!==a.id)].filter((v,i,x)=>x.indexOf(v)===i);const accounts=readAccounts();const members=unique.map(id=>accounts.find(x=>x.id===id)).filter(Boolean).map(chatSafeUser);const name=cleanText(req.body?.name,80)||members.map(x=>x.username).join("، ");const d=readChat();const room={id:crypto.randomUUID(),name,type:"private",ownerId:a.id,members,messages:[],createdAt:new Date().toISOString()};d.rooms.unshift(room);writeChat(d);audit("chat.room.created",{roomId:room.id,memberIds:members.map(x=>x.id)},a);res.json({room});});
app.patch("/api/chat/rooms/:id",(req,res)=>{const a=chatAccount(req),d=readChat(),r=findChatRoom(d,req.params.id);if(!a||!r)return res.status(404).json({error:"المحادثة غير موجودة"});if(!canRoomManage(r,a))return res.status(403).json({error:"مالك المحادثة فقط يقدر يديرها"});if(req.body?.name!==undefined)r.name=cleanText(req.body.name,80)||r.name;if(Array.isArray(req.body?.memberIds)){const accounts=readAccounts();const ids=[r.ownerId,...req.body.memberIds.map(String).filter(id=>id!==r.ownerId)].filter((v,i,x)=>x.indexOf(v)===i);r.members=ids.map(id=>accounts.find(x=>x.id===id)).filter(Boolean).map(chatSafeUser)}writeChat(d);audit("chat.room.updated",{roomId:r.id},a);io.to("chat:"+r.id).emit("chat:room",r);res.json({room:r});});
app.delete("/api/chat/rooms/:id",(req,res)=>{const a=chatAccount(req),d=readChat(),i=d.rooms.findIndex(x=>x.id===req.params.id);if(!a||i<0)return res.status(404).json({error:"المحادثة غير موجودة"});const r=d.rooms[i];if(!canRoomManage(r,a))return res.status(403).json({error:"مالك المحادثة فقط يقدر يحذفها"});d.rooms.splice(i,1);writeChat(d);audit("chat.room.deleted",{roomId:r.id},a);io.to("chat:"+r.id).emit("chat:deleted",r.id);res.json({ok:true});});
app.post("/api/chat/rooms/:id/leave",(req,res)=>{const a=chatAccount(req),d=readChat(),r=findChatRoom(d,req.params.id);if(!a||!r)return res.status(404).json({error:"المحادثة غير موجودة"});if(r.ownerId===a.id)return res.status(400).json({error:"المالك لا يغادر؛ احذف المحادثة أو انقل الملكية"});r.members=r.members.filter(m=>m.id!==a.id);writeChat(d);io.to("chat:"+r.id).emit("chat:room",r);res.json({ok:true});});
app.post("/api/chat/general/message",(req,res)=>{const a=chatAccount(req);if(!a)return res.status(401).json({error:"سجل الدخول أولًا"});const text=cleanText(req.body?.text,4000);if(!text)return res.status(400).json({error:"اكتب رسالة"});const d=readChat(),m=addChatMessage(d.general,a,text);writeChat(d);audit("chat.general.message",{messageId:m.id},a);io.emit("chat:general",m);res.json({message:m});});
app.post("/api/chat/rooms/:id/message",(req,res)=>{const a=chatAccount(req),d=readChat(),r=findChatRoom(d,req.params.id);if(!a||!r)return res.status(404).json({error:"المحادثة غير موجودة"});if(!roomMember(r,a.id))return res.status(403).json({error:"أنت لست ضمن هذه المحادثة"});const text=cleanText(req.body?.text,4000);if(!text)return res.status(400).json({error:"اكتب رسالة"});const m=addChatMessage(r,a,text);writeChat(d);m.roomId=r.id;audit("chat.private.message",{roomId:r.id,messageId:m.id},a);io.to("chat:"+r.id).emit("chat:message",m);res.json({message:m});});

function readContent(file){ return readJsonFile(file,[]); }
function writeContent(file,value){ writeJsonFile(file,value); }
function contentActor(req){ return getAuthAccountFromReq(req); }
function canManageContent(a){ return !!a && a.role === "owner"; }
function cleanText(v,max){ return String(v??"").trim().slice(0,max); }
function publicContent(item){
  const {status, ...rest}=item;
  return rest;
}
function visibleContent(req,file){
  const a=contentActor(req);
  const all=readContent(file);
  return a?.role==="owner" ? all : all.filter(x=>x.status==="published");
}

app.get("/api/jokes",(req,res)=>{
  const items=visibleContent(req,JOKES_FILE);
  res.json({jokes:items});
});
app.post("/api/jokes",(req,res)=>{
  const a=contentActor(req); if(!a)return res.status(401).json({error:"سجل الدخول أولًا"});
  const text=cleanText(req.body?.text,3000), category=cleanText(req.body?.category,60)||"عام";
  if(!text)return res.status(400).json({error:"اكتب النكتة"});
  const items=readContent(JOKES_FILE);
  const item={id:crypto.randomUUID(),text,category,authorId:a.id,authorName:a.username,status:a.role==="owner"?"published":"pending",createdAt:new Date().toISOString(),updatedAt:null};
  items.unshift(item);writeContent(JOKES_FILE,items);audit("joke.created",{jokeId:item.id,status:item.status},a);
  res.json({joke:publicContent(item)});
});
app.patch("/api/jokes/:id",(req,res)=>{
  const a=contentActor(req); if(!canManageContent(a))return res.status(403).json({error:"إدارة النكت للأونر فقط"});
  const items=readContent(JOKES_FILE),item=items.find(x=>x.id===req.params.id); if(!item)return res.status(404).json({error:"النكتة غير موجودة"});
  if(req.body?.text!==undefined)item.text=cleanText(req.body.text,3000);
  if(req.body?.category!==undefined)item.category=cleanText(req.body.category,60)||"عام";
  if(req.body?.status!==undefined)item.status=["published","pending"].includes(req.body.status)?req.body.status:item.status;
  item.updatedAt=new Date().toISOString();writeContent(JOKES_FILE,items);audit("joke.updated",{jokeId:item.id,status:item.status},a);res.json({joke:item});
});
app.delete("/api/jokes/:id",(req,res)=>{
  const a=contentActor(req);if(!canManageContent(a))return res.status(403).json({error:"حذف النكت للأونر فقط"});
  const items=readContent(JOKES_FILE),i=items.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"النكتة غير موجودة"});
  const [item]=items.splice(i,1);writeContent(JOKES_FILE,items);audit("joke.deleted",{jokeId:item.id},a);res.json({ok:true});
});

app.get("/api/reviews",(req,res)=>{
  const items=visibleContent(req,REVIEWS_FILE);
  res.json({reviews:items});
});
app.post("/api/reviews",(req,res)=>{
  const a=contentActor(req);if(!a)return res.status(401).json({error:"سجل الدخول أولًا"});
  const text=cleanText(req.body?.text,1200);if(!text)return res.status(400).json({error:"اكتب رأيك"});
  const rating=Math.min(5,Math.max(1,Number(req.body?.rating)||5));
  const items=readContent(REVIEWS_FILE);
  const item={id:crypto.randomUUID(),text,rating,authorId:a.id,authorName:a.username,status:a.role==="owner"?"published":"pending",createdAt:new Date().toISOString(),updatedAt:null};
  items.unshift(item);writeContent(REVIEWS_FILE,items);audit("review.created",{reviewId:item.id,status:item.status},a);res.json({review:publicContent(item)});
});
app.patch("/api/reviews/:id",(req,res)=>{
  const a=contentActor(req);if(!canManageContent(a))return res.status(403).json({error:"إدارة الآراء للأونر فقط"});
  const items=readContent(REVIEWS_FILE),item=items.find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:"الرأي غير موجود"});
  if(req.body?.text!==undefined)item.text=cleanText(req.body.text,1200);
  if(req.body?.rating!==undefined)item.rating=Math.min(5,Math.max(1,Number(req.body.rating)||5));
  if(req.body?.status!==undefined)item.status=["published","pending"].includes(req.body.status)?req.body.status:item.status;
  item.updatedAt=new Date().toISOString();writeContent(REVIEWS_FILE,items);audit("review.updated",{reviewId:item.id,status:item.status},a);res.json({review:item});
});
app.delete("/api/reviews/:id",(req,res)=>{
  const a=contentActor(req);if(!canManageContent(a))return res.status(403).json({error:"حذف الآراء للأونر فقط"});
  const items=readContent(REVIEWS_FILE),i=items.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"الرأي غير موجود"});
  const [item]=items.splice(i,1);writeContent(REVIEWS_FILE,items);audit("review.deleted",{reviewId:item.id},a);res.json({ok:true});
});

app.get("/api/stories",(req,res)=>{
  const items=visibleContent(req,STORIES_FILE);
  res.json({stories:items});
});
app.get("/api/stories/:id",(req,res)=>{
  const a=contentActor(req),item=readContent(STORIES_FILE).find(x=>x.id===req.params.id);
  if(!item)return res.status(404).json({error:"القصة غير موجودة"});
  if(item.status!=="published"&&a?.role!=="owner")return res.status(404).json({error:"القصة غير موجودة"});
  res.json({story:item});
});
app.post("/api/stories",(req,res)=>{
  const a=contentActor(req);if(!a)return res.status(401).json({error:"سجل الدخول أولًا"});
  const title=cleanText(req.body?.title,180),text=cleanText(req.body?.text,100000),cover=cleanText(req.body?.cover,500);
  if(!title||!text)return res.status(400).json({error:"أدخل عنوان القصة والنص"});
  const items=readContent(STORIES_FILE);
  const item={id:crypto.randomUUID(),title,text,cover,authorId:a.id,authorName:a.username,status:a.role==="owner"?"published":"pending",createdAt:new Date().toISOString(),updatedAt:null};
  items.unshift(item);writeContent(STORIES_FILE,items);audit("story.created",{storyId:item.id,status:item.status},a);res.json({story:publicContent(item)});
});
app.patch("/api/stories/:id",(req,res)=>{
  const a=contentActor(req);if(!canManageContent(a))return res.status(403).json({error:"إدارة القصص للأونر فقط"});
  const items=readContent(STORIES_FILE),item=items.find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:"القصة غير موجودة"});
  if(req.body?.title!==undefined)item.title=cleanText(req.body.title,180);
  if(req.body?.text!==undefined)item.text=cleanText(req.body.text,100000);
  if(req.body?.cover!==undefined)item.cover=cleanText(req.body.cover,500);
  if(req.body?.status!==undefined)item.status=["published","pending"].includes(req.body.status)?req.body.status:item.status;
  item.updatedAt=new Date().toISOString();writeContent(STORIES_FILE,items);audit("story.updated",{storyId:item.id,status:item.status},a);res.json({story:item});
});
app.delete("/api/stories/:id",(req,res)=>{
  const a=contentActor(req);if(!canManageContent(a))return res.status(403).json({error:"حذف القصص للأونر فقط"});
  const items=readContent(STORIES_FILE),i=items.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"القصة غير موجودة"});
  const [item]=items.splice(i,1);writeContent(STORIES_FILE,items);audit("story.deleted",{storyId:item.id},a);res.json({ok:true});
});
const OWNER_DATA = { name: process.env.OWNER_DISPLAY_NAME || "فهد المطيري", discordUsername: process.env.OWNER_DISCORD_USERNAME || "w4px", discordId: process.env.OWNER_DISCORD_ID || "" };
function readTickets(){try{return JSON.parse(fs.readFileSync(TICKETS_FILE,"utf8"));}catch{return [];}}
function writeTickets(a){fs.writeFileSync(TICKETS_FILE,JSON.stringify(a,null,2));}
function getAuthAccountFromReq(req){const s=sessionUser(req);return s?.type==="auth"?readAccounts().find(a=>a.id===s.accountId):null;}
function canManageTickets(a){return !!a&&["owner","admin"].includes(a.role);}

const sessions = new Map();
function readAccounts(){ try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE,"utf8")); } catch { return []; } }
function writeAccounts(a){ fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(a,null,2)); }
function readJsonFile(file,fallback=[]){ try { return JSON.parse(fs.readFileSync(file,"utf8")); } catch { return fallback; } }
function writeJsonFile(file,value){ fs.writeFileSync(file,JSON.stringify(value,null,2)); }
function readAuditLogs(){ return readJsonFile(AUDIT_LOG_FILE,[]); }
function readDmLogs(){ return readJsonFile(DM_LOG_FILE,[]); }
function audit(action,details={},actor=null){
  const logs=readAuditLogs();
  logs.unshift({id:crypto.randomUUID(),action,actor:actor?{id:actor.id,username:actor.username,role:actor.role}:null,details,createdAt:new Date().toISOString()});
  writeJsonFile(AUDIT_LOG_FILE,logs.slice(0,10000));
}
function logDm(entry){
  const logs=readDmLogs();
  logs.unshift({id:crypto.randomUUID(),...entry,createdAt:new Date().toISOString()});
  writeJsonFile(DM_LOG_FILE,logs.slice(0,5000));
}
function sessionUser(req){ const id=req.headers["x-session-id"]; return id ? sessions.get(id) : null; }
function safeUser(a){ return a && {id:a.id,username:a.username,discordUsername:a.discordUsername,role:a.role,createdAt:a.createdAt}; }
function findDiscordMember(username,members){ const q=String(username||"").trim().replace(/^@/,"").toLocaleLowerCase("ar"); return members.find(m => [m.user.username,m.user.globalName,m.displayName,m.user.tag].filter(Boolean).some(v=>String(v).toLocaleLowerCase("ar")===q || String(v).toLocaleLowerCase("ar").startsWith(q+"#"))); }


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

app.get("/api/owner",(req,res)=>res.json(OWNER_DATA));

app.get("/api/owner/dashboard",async(req,res)=>{
  const a=getAuthAccountFromReq(req);
  if(a?.role!=="owner") return res.status(403).json({error:"هذه اللوحة للأونر فقط"});
  const accounts=readAccounts();
  const tickets=readTickets();
  const applications=readApplications();
  let online=0;
  try{ online=(await getAllMembers(await getGuild())).filter(m=>m.presence?.status&&m.presence.status!=="offline").length; }catch{}
  res.json({stats:{accounts:accounts.length,tickets:tickets.length,openTickets:tickets.filter(t=>t.status==="open").length,applications:applications.length,pendingApplications:applications.filter(x=>x.status==="pending").length,online},owner:OWNER_DATA});
});

app.get("/api/announcement",(req,res)=>res.json(readAnnouncement()));
app.patch("/api/owner/announcement",(req,res)=>{
  const a=getAuthAccountFromReq(req);
  if(a?.role!=="owner")return res.status(403).json({error:"هذه العملية للأونر فقط"});
  const current=readAnnouncement();
  const enabled=Boolean(req.body?.enabled);
  const text=cleanText(req.body?.text,500);
  const color=/^#[0-9a-fA-F]{6}$/.test(String(req.body?.color||""))?String(req.body.color):current.color||"#ff9cdc";
  if(enabled&&!text)return res.status(400).json({error:"اكتب نص الإعلان أولًا"});
  const next={enabled,text,color,updatedAt:new Date().toISOString(),updatedBy:a.username};
  writeAnnouncement(next);audit("announcement.updated",{enabled,textLength:text.length,color},a);
  res.json({announcement:next});
});
app.get("/api/owner/broadcast/status/:id",(req,res)=>{
  const a=getAuthAccountFromReq(req);
  if(a?.role!=="owner")return res.status(403).json({error:"هذه العملية للأونر فقط"});
  const job=broadcastJobs.get(req.params.id);
  if(!job)return res.status(404).json({error:"البرودكاست غير موجود"});
  res.json({broadcast:broadcastSafe(job)});
});
app.post("/api/owner/broadcast",async(req,res)=>{
  const a=getAuthAccountFromReq(req);
  if(a?.role!=="owner")return res.status(403).json({error:"البرودكاست للأونر فقط"});
  const message=cleanText(req.body?.message,2000),titleText=cleanText(req.body?.title,120)||"رسالة من MLD";
  if(!message)return res.status(400).json({error:"اكتب رسالة البرودكاست"});
  const active=[...broadcastJobs.values()].find(x=>["queued","sending"].includes(x.status));
  if(active)return res.status(409).json({error:"يوجد برودكاست قيد الإرسال الآن",broadcast:broadcastSafe(active)});
  const job={id:crypto.randomUUID(),status:"queued",total:0,sent:0,failed:0,startedAt:new Date().toISOString(),actor:a};
  broadcastJobs.set(job.id,job);
  audit("broadcast.started",{broadcastId:job.id,title:titleText},a);
  runBroadcast(job,message,titleText);
  res.json({ok:true,broadcast:broadcastSafe(job)});
});

app.get("/api/owner/accounts",async(req,res)=>{
  const a=getAuthAccountFromReq(req);
  if(a?.role!=="owner") return res.status(403).json({error:"هذه العملية للأونر فقط"});
  const accounts=readAccounts();
  res.json({accounts:accounts.map(x=>safeUser(x))});
});

app.patch("/api/owner/accounts/:id",async(req,res)=>{
  const a=getAuthAccountFromReq(req);
  if(a?.role!=="owner") return res.status(403).json({error:"هذه العملية للأونر فقط"});
  const role=String(req.body?.role||"");
  if(!["member","admin"].includes(role)) return res.status(400).json({error:"رتبة الحساب غير صالحة"});
  if(req.params.id===a.id) return res.status(400).json({error:"لا يمكنك تغيير رتبة حساب الأونر"});
  const accounts=readAccounts(),target=accounts.find(x=>x.id===req.params.id);
  if(!target) return res.status(404).json({error:"الحساب غير موجود"});
  const previous=target.role; target.role=role; writeAccounts(accounts);
  audit("account.role.changed",{targetId:target.id,targetUsername:target.username,from:previous,to:role},a);
  res.json({user:safeUser(target)});
});
app.delete("/api/owner/accounts/:id",async(req,res)=>{
  const a=getAuthAccountFromReq(req);
  if(a?.role!=="owner") return res.status(403).json({error:"هذه العملية للأونر فقط"});
  if(req.params.id===a.id) return res.status(400).json({error:"لا يمكنك حذف حساب الأونر الحالي"});
  const accounts=readAccounts();
  const index=accounts.findIndex(x=>x.id===req.params.id);
  if(index<0) return res.status(404).json({error:"الحساب غير موجود"});
  const target=accounts[index];
  accounts.splice(index,1); writeAccounts(accounts);
  for(const [sid,s] of sessions.entries()) if(s?.type==="auth"&&s.accountId===target.id) sessions.delete(sid);
  audit("account.deleted",{targetId:target.id,targetUsername:target.username,targetDiscord:target.discordUsername},a);
  res.json({ok:true});
});

app.get("/api/owner/audit-logs",async(req,res)=>{
  const a=getAuthAccountFromReq(req);
  if(a?.role!=="owner") return res.status(403).json({error:"هذه السجلات للأونر فقط"});
  const limit=Math.min(Math.max(Number(req.query.limit)||250,1),1000);
  res.json({logs:readAuditLogs().slice(0,limit)});
});

app.get("/api/owner/dm-logs",async(req,res)=>{
  const a=getAuthAccountFromReq(req);
  if(a?.role!=="owner") return res.status(403).json({error:"سجلات الخاص للأونر فقط"});
  const limit=Math.min(Math.max(Number(req.query.limit)||250,1),1000);
  res.json({logs:readDmLogs().slice(0,limit)});
});
const APPLICATIONS_FILE = path.join(__dirname, "applications.json");
const APPLICATION_QUESTIONS_FILE = path.join(__dirname, "application-questions.json");
function readApplications(){try{return JSON.parse(fs.readFileSync(APPLICATIONS_FILE,"utf8"));}catch{return [];}}
function writeApplications(a){fs.writeFileSync(APPLICATIONS_FILE,JSON.stringify(a,null,2));}
function readApplicationQuestions(){try{return JSON.parse(fs.readFileSync(APPLICATION_QUESTIONS_FILE,"utf8"));}catch{return ["لماذا ترغب بالانضمام إلى الإدارة؟","ما خبرتك في إدارة المجتمعات أو Discord؟","كيف تتصرف مع خلاف بين عضوين؟","كم الوقت الذي تستطيع تخصيصه للإدارة؟"];}}
function canManageApplications(a){return !!a&&["owner","admin"].includes(a.role);}
app.get("/api/applications/questions",(req,res)=>res.json({questions:readApplicationQuestions()}));app.put("/api/applications/questions",(req,res)=>{
  const a=getAuthAccountFromReq(req);
  if(a?.role!=="owner") return res.status(403).json({error:"تعديل أسئلة التقديم للأونر فقط"});
  const questions=Array.isArray(req.body?.questions)?req.body.questions.map(x=>String(x||"").trim()).filter(Boolean).slice(0,20):[];
  if(!questions.length) return res.status(400).json({error:"يجب وجود سؤال واحد على الأقل"});
  writeJsonFile(APPLICATION_QUESTIONS_FILE,questions);
  audit("application.questions.updated",{count:questions.length},a);
  res.json({questions});
});

app.post("/api/applications",(req,res)=>{const a=getAuthAccountFromReq(req);if(!a)return res.status(401).json({error:"سجل الدخول أولًا"});const answers=Array.isArray(req.body?.answers)?req.body.answers.map(x=>String(x||"").trim()):[];const questions=readApplicationQuestions();if(answers.length!==questions.length||answers.some(x=>!x))return res.status(400).json({error:"أجب على جميع أسئلة التقديم"});const apps=readApplications();if(apps.some(x=>x.userId===a.id&&x.status==="pending"))return res.status(409).json({error:"لديك طلب تقديم قيد المراجعة"});const application={id:crypto.randomUUID(),userId:a.id,userName:a.username,discordUsername:a.discordUsername,answers,questions,status:"pending",createdAt:new Date().toISOString()};apps.unshift(application);writeApplications(apps);audit("application.created",{applicationId:application.id},a);res.json({application});});
app.get("/api/applications",(req,res)=>{const a=getAuthAccountFromReq(req);if(!canManageApplications(a))return res.status(403).json({error:"غير مصرح"});res.json({applications:readApplications()});});
app.post("/api/applications/:id/decision",async(req,res)=>{
  const a=getAuthAccountFromReq(req);
  if(a?.role!=="owner")return res.status(403).json({error:"قرار قبول أو رفض التقديم للأونر فقط"});
  const status=String(req.body?.status||"");
  if(!["accepted","rejected"].includes(status))return res.status(400).json({error:"قرار غير صالح"});
  const apps=readApplications(),item=apps.find(x=>x.id===req.params.id);
  if(!item)return res.status(404).json({error:"التقديم غير موجود"});
  if(item.status!=="pending")return res.status(409).json({error:"تمت مراجعة هذا التقديم مسبقًا"});
  if(status==="accepted"){
    const roleId=process.env.APPLICATION_ACCEPT_ROLE_ID||"1548732606508703744";
    try{
      const guild=await getGuild();
      const member=await guild.members.fetch(item.userId ? (readAccounts().find(x=>x.id===item.userId)?.discordId||"") : "").catch(()=>null);
      if(!member)return res.status(404).json({error:"عضو Discord المرتبط بالتقديم غير موجود"});
      const role=guild.roles.cache.get(roleId);
      if(!role)return res.status(500).json({error:"رتبة قبول التقديم غير موجودة. أضف APPLICATION_ACCEPT_ROLE_ID"});
      await member.roles.add(role,"قبول طلب الإدارة من لوحة الأونر");
      item.grantedRoleId=roleId;
    }catch(e){console.error("Application role assignment:",e);return res.status(500).json({error:"تعذر إعطاء رتبة الإدارة؛ لم يتم اعتماد التقديم"});}
  }
  item.status=status;item.reviewedAt=new Date().toISOString();item.reviewedBy=a.username;
  writeApplications(apps);audit("application.decision",{applicationId:item.id,status,grantedRoleId:item.grantedRoleId||null},a);
  res.json({application:item});
});
app.get("/api/tickets",(req,res)=>{const a=getAuthAccountFromReq(req);if(!a)return res.status(401).json({error:"سجل الدخول أولًا"});const all=readTickets();res.json({tickets:canManageTickets(a)?all:all.filter(t=>t.userId===a.id)});});
app.post("/api/tickets",(req,res)=>{const a=getAuthAccountFromReq(req);if(!a)return res.status(401).json({error:"سجل الدخول أولًا"});const subject=String(req.body?.subject||"").trim(),message=String(req.body?.message||"").trim();if(!subject||!message)return res.status(400).json({error:"اكتب عنوان التذكرة والرسالة"});const ts=readTickets(),t={id:crypto.randomUUID(),userId:a.id,userName:a.username,subject,message,status:"open",createdAt:new Date().toISOString(),messages:[{id:crypto.randomUUID(),userId:a.id,userName:a.username,role:a.role,text:message,createdAt:new Date().toISOString()}]};ts.unshift(t);writeTickets(ts);audit("ticket.created",{ticketId:t.id,subject:t.subject},a);io?.to("ticket:"+t.id).emit("ticket:updated",t);res.json({ticket:t});});
app.post("/api/tickets/:id/close",(req,res)=>{const a=getAuthAccountFromReq(req);if(!canManageTickets(a))return res.status(403).json({error:"غير مصرح"});const ts=readTickets(),t=ts.find(x=>x.id===req.params.id);if(!t)return res.status(404).json({error:"التذكرة غير موجودة"});t.status="closed";t.closedAt=new Date().toISOString();writeTickets(ts);audit("ticket.closed",{ticketId:t.id},a);io?.to("ticket:"+t.id).emit("ticket:updated",t);res.json({ticket:t});});
app.post("/api/auth/register", async (req,res)=>{
  const username=String(req.body?.username||"").trim();
  const password=String(req.body?.password||"");
  const discordUsername=String(req.body?.discordUsername||"").trim();
  if(!/^[\u0600-\u06FFa-zA-Z0-9_.-]{3,32}$/.test(username)) return res.status(400).json({error:"اسم المستخدم غير صالح"});
  if(password.length<8) return res.status(400).json({error:"كلمة المرور يجب أن تكون 8 أحرف على الأقل"});
  if(!discordUsername) return res.status(400).json({error:"أدخل يوزر Discord"});
  const accounts=readAccounts();
  if(accounts.some(a=>a.username.toLowerCase()===username.toLowerCase())) return res.status(409).json({error:"اسم المستخدم مستخدم بالفعل"});
  if(accounts.some(a=>a.discordUsername.toLowerCase()===discordUsername.toLowerCase())) return res.status(409).json({error:"حساب Discord مرتبط بحساب آخر"});
  try{
    const guild=await getGuild(), members=await getAllMembers(guild), member=findDiscordMember(discordUsername,members);
    if(!member) return res.status(403).json({error:"حساب Discord غير موجود في السيرفر"});
    const code=String(crypto.randomInt(100000,1000000));
    await member.send({embeds:[new EmbedBuilder().setTitle("تأكيد حساب MLD").setDescription(`رمز تأكيد تسجيل الحساب: **${code}**\nلا تشارك هذا الرمز مع أي شخص.`).setColor("#ff9cdc").setFooter({text:"MLD Community"})]});
    const pendingId=crypto.randomUUID();
    sessions.set(pendingId,{type:"pending",username,passwordHash:await bcrypt.hash(password,12),discordUsername,discordId:member.id,code,expiresAt:Date.now()+10*60*1000});
    res.json({ok:true,pendingId,message:"تم إرسال رمز التأكيد إلى الخاص في Discord"});
  }catch(e){ console.error("Register:",e); res.status(500).json({error:"تعذر إرسال رمز التأكيد. تأكد أن الخاص مفتوح في Discord"}); }
});
app.post("/api/auth/verify", async (req,res)=>{
  const p=sessions.get(String(req.body?.pendingId||"")); const code=String(req.body?.code||"").trim();
  if(!p || p.type!=="pending" || p.expiresAt<Date.now()) return res.status(400).json({error:"انتهت صلاحية طلب التسجيل"});
  if(p.code!==code) return res.status(400).json({error:"رمز التأكيد غير صحيح"});
  const accounts=readAccounts();
  const id=crypto.randomUUID();
  const role=accounts.length===0 && process.env.OWNER_USERNAME && p.username===process.env.OWNER_USERNAME ? "owner" : "member";
  const account={id,username:p.username,passwordHash:p.passwordHash,discordUsername:p.discordUsername,discordId:p.discordId,role,createdAt:new Date().toISOString()};
  accounts.push(account); writeAccounts(accounts); audit("account.created",{accountId:id,username:account.username,discordId:account.discordId},account); sessions.delete(String(req.body.pendingId));
  const sid=crypto.randomUUID(); sessions.set(sid,{type:"auth",accountId:id});
  res.json({ok:true,sessionId:sid,user:safeUser(account)});
});
app.post("/api/auth/login", async (req,res)=>{
  const username=String(req.body?.username||"").trim(), password=String(req.body?.password||"");
  const envOwnerUsername=String(process.env.OWNER_USERNAME||"").trim();
  const envOwnerPassword=String(process.env.OWNER_PASSWORD||"");
  let accounts=readAccounts();
  let account=accounts.find(a=>a.username.toLowerCase()===username.toLowerCase());
  if(envOwnerUsername && username.toLowerCase()===envOwnerUsername.toLowerCase() && envOwnerPassword && password===envOwnerPassword){
    let discordId=String(process.env.OWNER_DISCORD_ID||"").trim();
    try{
      const guild=await getGuild();
      let member=discordId ? await guild.members.fetch(discordId).catch(()=>null) : null;
      if(!member && process.env.OWNER_DISCORD_USERNAME) member=findDiscordMember(process.env.OWNER_DISCORD_USERNAME,await getAllMembers(guild));
      if(member) discordId=member.id;
    }catch(e){}
    if(!discordId)return res.status(403).json({error:"ضع OWNER_DISCORD_ID أو OWNER_DISCORD_USERNAME للأونر"});
    if(!account){
      account={id:"env-owner",username:envOwnerUsername,passwordHash:await bcrypt.hash(envOwnerPassword,12),discordUsername:process.env.OWNER_DISCORD_USERNAME||"w4px",discordId,role:"owner",createdAt:new Date().toISOString()};
      accounts.push(account);writeAccounts(accounts);
    }else{
      account.role="owner";account.discordId=discordId;account.discordUsername=process.env.OWNER_DISCORD_USERNAME||account.discordUsername;account.passwordHash=await bcrypt.hash(envOwnerPassword,12);writeAccounts(accounts);
    }
  }else if(!account || !(await bcrypt.compare(password,account.passwordHash))) return res.status(401).json({error:"اسم المستخدم أو كلمة المرور غير صحيحة"});
  try{
    const member=await (await getGuild()).members.fetch(account.discordId).catch(()=>null);
    if(!member) return res.status(403).json({error:"حسابك لم يعد عضوًا في السيرفر"});
    const sid=crypto.randomUUID(); sessions.set(sid,{type:"auth",accountId:account.id}); audit("auth.login",{},account);
    res.json({ok:true,sessionId:sid,user:safeUser(account)});
  }catch(e){res.status(503).json({error:"تعذر التحقق من عضويتك في Discord"});}
});
app.post("/api/auth/logout",(req,res)=>{const a=getAuthAccountFromReq(req);if(a)audit("auth.logout",{},a);sessions.delete(String(req.headers["x-session-id"]||""));res.json({ok:true});});
app.get("/api/auth/me",async(req,res)=>{
  const s=sessionUser(req), account=s?.type==="auth" ? readAccounts().find(a=>a.id===s.accountId) : null;
  if(!account) return res.status(401).json({error:"غير مسجل"});
  const member=await (await getGuild()).members.fetch(account.discordId).catch(()=>null);
  if(!member) return res.status(403).json({error:"لم تعد عضوًا في السيرفر"});
  res.json({user:safeUser(account)});
});
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
      invite: process.env.DISCORD_INVITE_URL || "",
      siteImage: process.env.SITE_IMAGE_URL || "/logo.svg.JPG",
      siteAvatar: process.env.SITE_AVATAR_URL || process.env.SITE_IMAGE_URL || "/logo.svg.JPG"
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
    logDm({senderId:null,senderUsername:"system",targetId:member.id,targetUsername:member.user.username,title,message:text,source:"site"});
    audit("dm.sent",{targetId:member.id,targetUsername:member.user.username,title},getAuthAccountFromReq(req));
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

const server=http.createServer(app);const io=new SocketIOServer(server,{cors:{origin:true,credentials:true}});
io.on("connection",socket=>{const sid=String(socket.handshake.auth?.sessionId||""),s=sessions.get(sid),a=s?.type==="auth"?readAccounts().find(x=>x.id===s.accountId):null;if(!a)return socket.disconnect(true);socket.on("chat:join",id=>{const d=readChat(),r=id==="general"?d.general:findChatRoom(d,String(id));if(!r||!roomMember(r,a.id))return;socket.join("chat:"+r.id);socket.emit("chat:room",r);});socket.on("ticket:join",id=>{const t=readTickets().find(x=>x.id===id);if(!t||(t.userId!==a.id&&!canManageTickets(a)))return;socket.join("ticket:"+id);socket.emit("ticket:updated",t);});socket.on("ticket:message",d=>{const id=String(d?.ticketId||""),text=String(d?.text||"").trim();if(!text)return;const ts=readTickets(),t=ts.find(x=>x.id===id);if(!t||t.status==="closed"||(t.userId!==a.id&&!canManageTickets(a)))return;const m={id:crypto.randomUUID(),userId:a.id,userName:a.username,role:a.role,text,createdAt:new Date().toISOString()};t.messages.push(m);writeTickets(ts);audit("ticket.message",{ticketId:id,messageId:m.id},a);io.to("ticket:"+id).emit("ticket:message",m);});});
server.listen(port,()=>console.log(`MLD listening on port ${port}`));
client.once("ready", () => console.log(`Logged in as ${client.user.tag}`));
client.login(token).catch((error) => {
  console.error("Discord login failed:", error.message);
  process.exit(1);
});

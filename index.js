"use strict";
require("dotenv").config();

const path=require("path");
const express=require("express");
const cors=require("cors");
const helmet=require("helmet");
const {Client,GatewayIntentBits,EmbedBuilder}=require("discord.js");

const token=process.env.DISCORD_BOT_TOKEN;
const guildId=process.env.DISCORD_GUILD_ID;
const port=Number(process.env.PORT||3000);

const app=express();
app.disable("x-powered-by");
app.use(helmet({contentSecurityPolicy:false}));
app.use(cors());
app.use(express.json({limit:"20kb"}));
app.use(express.static(path.join(__dirname,"public")));

const client=new Client({intents:[
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildPresences,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildVoiceStates
]});

const leadershipRoleIds=[
 "1530712642384040027","1521187079336362024","1531109479264026706",
 "1548732297669255259","1548732341185155103","1548732606508703744"
];
const leadershipRoleSet=new Set(leadershipRoleIds);
const importantPermissionNames=new Set([
 "Administrator","ManageGuild","ManageRoles","ManageChannels","ManageMessages",
 "ManageWebhooks","ManageNicknames","BanMembers","KickMembers","ModerateMembers",
 "MentionEveryone","ViewAuditLog","ManageEvents","ManageThreads","ManageEmojisAndStickers"
]);

const activity=new Map(),voiceSessions=new Map(),sendHits=new Map();
let guildCache=null,guildCacheAt=0,guildFetchPromise=null;
let memberSnapshot=null,memberSnapshotAt=0,memberFetchPromise=null;
let visits=0;
const startedAt=Date.now();
const MEMBER_CACHE_TTL=45_000,GUILD_CACHE_TTL=15_000;

function getActivity(id){
 if(!activity.has(id))activity.set(id,{messages:0,mentionsReceived:0,mentionsSent:0,voiceMinutes:0,voiceJoins:0,chatRounds:0});
 return activity.get(id);
}
async function getGuild(){
 if(guildCache&&Date.now()-guildCacheAt<GUILD_CACHE_TTL)return guildCache;
 if(guildFetchPromise)return guildFetchPromise;
 if(!client.isReady())throw new Error("Discord bot is not ready");
 guildFetchPromise=client.guilds.fetch(guildId).then(g=>{guildCache=g;guildCacheAt=Date.now();return g}).finally(()=>{guildFetchPromise=null});
 return guildFetchPromise;
}
function invalidateMemberSnapshot(){memberSnapshotAt=0}
async function getAllMembers(guild){
 if(memberSnapshot&&Date.now()-memberSnapshotAt<MEMBER_CACHE_TTL)return memberSnapshot;
 if(memberFetchPromise)return memberFetchPromise;
 memberFetchPromise=guild.members.fetch().then(c=>{
   memberSnapshot=[...c.values()];memberSnapshotAt=Date.now();return memberSnapshot;
 }).catch(e=>{if(memberSnapshot?.length)return memberSnapshot;throw e}).finally(()=>{memberFetchPromise=null});
 return memberFetchPromise;
}
function importantPermissions(p){return p.toArray().filter(x=>importantPermissionNames.has(x))}
function roleJson(role,count=role.members?.size||0){return{
 id:role.id,name:role.name,color:role.hexColor,position:role.position,
 permissions:importantPermissions(role.permissions),membersCount:count,mentionable:role.mentionable
}}
function memberJson(member){
 const roles=member.roles.cache.filter(r=>r.id!==member.guild.id).sort((a,b)=>b.position-a.position).map(r=>roleJson(r));
 const leadershipRoles=roles.filter(r=>leadershipRoleSet.has(r.id));
 return{
  id:member.id,name:member.displayName,username:member.user.username,globalName:member.user.globalName,
  bot:member.user.bot,avatar:member.displayAvatarURL({extension:"png",size:256}),joinedAt:member.joinedAt,
  roles,importantRoles:leadershipRoles,rank:leadershipRoles[0]?.name||roles[0]?.name||"عضو",stats:getActivity(member.id)
 };
}
function sortedMemberJson(members){
 return [...members].sort((a,b)=>{
   const ar=a.roles.cache.filter(r=>leadershipRoleSet.has(r.id)).sort((x,y)=>y.position-x.position).first();
   const br=b.roles.cache.filter(r=>leadershipRoleSet.has(r.id)).sort((x,y)=>y.position-x.position).first();
   return (br?.position||0)-(ar?.position||0);
 }).map(memberJson);
}

app.get("/health",(req,res)=>res.json({
 ok:true,botReady:client.isReady(),uptimeSeconds:Math.floor((Date.now()-startedAt)/1000),
 membersCached:Boolean(memberSnapshot),membersCachedCount:memberSnapshot?.length||0,visits
}));

app.get("/api/public/server",async(req,res)=>{
 visits++;
 try{
  const guild=await getGuild();
  res.json({
   id:guild.id,name:guild.name,icon:guild.iconURL({extension:"png",size:256}),
   memberCount:guild.memberCount,
   online:Number(guild.presences?.cache?.filter(p=>["online","idle","dnd"].includes(p.status)).size||0),
   visits,
   ownerName:process.env.OWNER_DISPLAY_NAME||process.env.SERVER_FOUNDER_NAME||"فهد المطيري",
   invite:process.env.DISCORD_INVITE_URL||""
  });
 }catch(e){console.error("Server endpoint:",e);res.status(503).json({error:"Discord server unavailable"})}
});

app.get("/api/public/members",async(req,res)=>{
 try{
  const members=await getAllMembers(await getGuild());
  const q=String(req.query.q||"").trim().toLocaleLowerCase("ar").replace(/^@/,"");
  const filtered=q?members.filter(m=>[m.displayName,m.user.username,m.user.globalName,m.user.tag,m.id].filter(Boolean).join(" ").toLocaleLowerCase("ar").includes(q)):members;
  res.json({members:sortedMemberJson(filtered),total:filtered.length,totalServerMembers:members.length,updatedAt:memberSnapshotAt,cached:true});
 }catch(e){console.error("Members endpoint:",e);res.status(503).json({error:"Members are temporarily unavailable"})}
});

app.get("/api/public/roles",async(req,res)=>{
 try{
  const guild=await getGuild(),members=await getAllMembers(guild);
  const roles=leadershipRoleIds.map(id=>guild.roles.cache.get(id)).filter(Boolean).map(role=>{
   const count=members.reduce((n,m)=>n+(m.roles.cache.has(role.id)?1:0),0);
   return roleJson(role,count);
  });
  res.json({roles,updatedAt:memberSnapshotAt});
 }catch(e){console.error("Roles endpoint:",e);res.status(503).json({error:"Roles are temporarily unavailable"})}
});

app.get("/api/public/roles/:id/members",async(req,res)=>{
 try{
  const guild=await getGuild(),role=guild.roles.cache.get(req.params.id);
  if(!role||!leadershipRoleSet.has(role.id))return res.status(404).json({error:"Role not found"});
  const members=(await getAllMembers(guild)).filter(m=>m.roles.cache.has(role.id));
  res.json({role:roleJson(role,members.length),members:sortedMemberJson(members),updatedAt:memberSnapshotAt});
 }catch(e){console.error("Role members endpoint:",e);res.status(503).json({error:"Role members are temporarily unavailable"})}
});

app.get("/api/public/top",async(req,res)=>{
 try{
  const members=(await getAllMembers(await getGuild())).map(memberJson);
  const top=k=>[...members].sort((a,b)=>(b.stats[k]||0)-(a.stats[k]||0)).slice(0,10);
  res.json({messages:top("messages"),mentions:top("mentionsReceived"),voice:top("voiceMinutes"),joins:top("voiceJoins"),updatedAt:memberSnapshotAt});
 }catch(e){console.error("Top endpoint:",e);res.status(503).json({error:"Top is temporarily unavailable"})}
});

app.get("/api/public/member/:id",async(req,res)=>{
 try{
  const guild=await getGuild(),member=await guild.members.fetch(req.params.id).catch(()=>null);
  if(!member)return res.status(404).json({error:"Member not found"});
  const highest=member.roles.cache.filter(r=>r.id!==guild.id&&!r.managed).sort((a,b)=>b.position-a.position).first();
  res.json({...memberJson(member),highestRole:highest?roleJson(highest):null,permissions:highest?importantPermissions(highest.permissions):[]});
 }catch(e){console.error("Member endpoint:",e);res.status(404).json({error:"Member not found"})}
});

app.post("/api/public/message",async(req,res)=>{
 const now=Date.now(),ip=req.ip||"unknown",last=sendHits.get(ip)||0;
 if(now-last<10_000)return res.status(429).json({error:"انتظر 10 ثواني قبل الإرسال مرة أخرى"});
 const title=String(req.body?.title||"رسالة من إدارة MLD").trim();
 const text=String(req.body?.message||"").trim();
 const targetId=String(req.body?.memberId||"").trim();
 if(!targetId||!text||text.length>2000||title.length>120)return res.status(400).json({error:"بيانات الرسالة غير صحيحة"});
 try{
  const member=await (await getGuild()).members.fetch(targetId).catch(()=>null);
  if(!member)return res.status(404).json({error:"العضو غير موجود"});
  await member.send({embeds:[new EmbedBuilder().setTitle(title).setDescription(text).setColor("#ff9cdc").setFooter({text:"MLD Community"}).setTimestamp()]});
  sendHits.set(ip,now);res.json({ok:true});
 }catch(e){console.error("DM endpoint:",e);res.status(500).json({error:"تعذر الإرسال؛ قد يكون الخاص مقفلًا"})}
});

client.on("guildMemberAdd",invalidateMemberSnapshot);
client.on("guildMemberRemove",invalidateMemberSnapshot);
client.on("guildMemberUpdate",invalidateMemberSnapshot);
client.on("messageCreate",message=>{
 if(message.author.bot)return;
 const sender=getActivity(message.author.id);sender.messages++;sender.chatRounds++;
 for(const id of message.mentions.users.keys()){getActivity(id).mentionsReceived++;sender.mentionsSent++}
});
client.on("voiceStateUpdate",(oldState,newState)=>{
 const id=newState.id;
 if(!oldState.channelId&&newState.channelId){voiceSessions.set(id,Date.now());getActivity(id).voiceJoins++}
 if(oldState.channelId&&!newState.channelId&&voiceSessions.has(id)){
  getActivity(id).voiceMinutes+=Math.round((Date.now()-voiceSessions.get(id))/60000);voiceSessions.delete(id)
 }
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(port,()=>console.log("MLD listening on port "+port));

if(!token||!guildId){
 console.error("Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID");
}else{
 client.once("ready",()=>console.log("Logged in as "+client.user.tag));
 client.login(token).catch(e=>{console.error("Discord login failed:",e.message);process.exit(1)});
}
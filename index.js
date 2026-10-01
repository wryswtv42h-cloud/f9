require("dotenv").config();
const path=require("path");
const express=require("express");
const cors=require("cors");
const helmet=require("helmet");
const {Client,GatewayIntentBits}=require("discord.js");

const app=express();
app.use(helmet({contentSecurityPolicy:false}));
app.use(cors());
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

const client=new Client({intents:[
 GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildPresences
]});

let guild=null;
const startedAt=Date.now();
let visits=0;

async function loadGuild(){
 if(!client.isReady()||!process.env.DISCORD_GUILD_ID)return null;
 guild=client.guilds.cache.get(process.env.DISCORD_GUILD_ID)||await client.guilds.fetch(process.env.DISCORD_GUILD_ID).catch(()=>null);
 return guild;
}

app.get("/health",(req,res)=>res.json({ok:true,uptime:Math.floor((Date.now()-startedAt)/1000)}));
app.use("/api/public",(req,res,next)=>{visits++;next()});

app.get("/api/public/server",async(req,res)=>{
 const g=await loadGuild();
 const members=g?.memberCount||0;
 const online=g?g.members.cache.filter(m=>m.presence?.status&&m.presence.status!=="offline").size:0;
 res.json({
  ok:true,name:g?.name||"MLD · Community",id:g?.id||null,
  status:g?"online":"offline",members,online,visits,
  owner:process.env.OWNER_DISPLAY_NAME||"فهد المطيري",
  invite:process.env.DISCORD_INVITE_URL||null
 });
});

app.get("/api/public/members",async(req,res)=>{
 const g=await loadGuild(); if(!g)return res.json({ok:true,members:[]});
 await g.members.fetch().catch(()=>{});
 const q=String(req.query.q||"").trim().toLowerCase();
 const members=[...g.members.cache.values()].filter(m=>!q||m.user.username.toLowerCase().includes(q)||m.displayName.toLowerCase().includes(q))
 .slice(0,5).map(m=>({id:m.id,username:m.user.username,name:m.displayName,avatar:m.user.displayAvatarURL({extension:"png",size:128}),status:m.presence?.status||"offline",roles:m.roles.cache.filter(r=>r.id!==g.id).map(r=>r.name).slice(0,4)}));
 res.json({ok:true,members});
});

app.get("/api/public/roles",async(req,res)=>{
 const g=await loadGuild(); if(!g)return res.json({ok:true,roles:[]});
 res.json({ok:true,roles:[...g.roles.cache.values()].filter(r=>r.id!==g.id).sort((a,b)=>b.position-a.position).map(r=>({id:r.id,name:r.name,color:r.hexColor,members:r.members.size}))});
});

app.get("/api/public/top",async(req,res)=>res.json({ok:true,top:[]}));

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

if(process.env.DISCORD_BOT_TOKEN){
 client.once("ready",async()=>{console.log("Discord ready:",client.user.tag);await loadGuild();});
 client.login(process.env.DISCORD_BOT_TOKEN).catch(e=>console.error("Discord login failed:",e.message));
}
const port=process.env.PORT||3000;
app.listen(port,()=>console.log("MLD running on",port));
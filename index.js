"use strict";
require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

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
function sessionUser(req){const token=req.headers.cookie?.match(/(?:^|;\\s*)mld_session=([^;]+)/)?.[1];return token?sessions.get(token)||null:null}
function publicUser(u){return u?{username:u.username,displayName:u.displayName,discordUsername:u.discordUsername,role:u.role,createdAt:u.createdAt}:null}
app.get("/api/auth/me",(req,res)=>res.json({authenticated:Boolean(sessionUser(req)),user:publicUser(sessionUser(req))}));
app.post("/api/auth/login",async(req,res)=>{const username=cleanUsername(req.body?.username),password=String(req.body?.password||"");if(!username||!password)return res.status(400).json({error:"اكتب اسم المستخدم وكلمة المرور"});let u=siteUsers.get(username);if(!u&&username===cleanUsername(process.env.OWNER_USERNAME||"w4px")&&password===String(process.env.OWNER_PASSWORD||"")){u={username,displayName:process.env.OWNER_DISPLAY_NAME||"فهد المطيري",discordUsername:process.env.OWNER_DISCORD_USERNAME||"w4px",role:"owner",password,createdAt:new Date().toISOString()};siteUsers.set(username,u)}if(!u||u.password!==password)return res.status(401).json({error:"اسم المستخدم أو كلمة المرور غير صحيحة"});const token=crypto.randomBytes(32).toString("hex");sessions.set(token,u);res.setHeader("Set-Cookie","mld_session="+token+"; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800");res.json({ok:true,user:publicUser(u)})});
app.post("/api/auth/signup",async(req,res)=>{const username=cleanUsername(req.body?.username),password=String(req.body?.password||""),discordUsername=String(req.body?.discordUsername||"").trim();if(username.length<3||password.length<6||!discordUsername)return res.status(400).json({error:"اسم المستخدم 3 أحرف على الأقل وكلمة المرور 6 أحرف"});if(siteUsers.has(username))return res.status(409).json({error:"اسم المستخدم مستخدم بالفعل"});try{const guild=await getGuild(),members=await getAllMembers(guild),member=members.find(m=>m.user.username.toLowerCase()===discordUsername.toLowerCase()||String(m.user.globalName||"").toLowerCase()===discordUsername.toLowerCase());if(!member)return res.status(403).json({error:"يوزر الديسكورد غير موجود في السيرفر"});const code=String(Math.floor(100000+Math.random()*900000));pendingSignups.set(username,{username,password,discordUsername,memberId:member.id,code,expires:Date.now()+600000});try{await member.send("رمز تأكيد إنشاء حساب MLD: **"+code+"**\nإذا لم تطلب إنشاء الحساب تجاهل الرسالة.")}catch(e){pendingSignups.delete(username);return res.status(503).json({error:"تعذر إرسال رمز التأكيد للخاص في ديسكورد"})}res.json({ok:true,verificationRequired:true,message:"أرسلنا رمز التأكيد إلى الخاص في ديسكورد"})}catch(e){console.error("Signup:",e);res.status(503).json({error:"تعذر التحقق من عضو الديسكورد"})}});
app.post("/api/auth/verify-signup",(req,res)=>{const username=cleanUsername(req.body?.username),code=String(req.body?.code||""),p=pendingSignups.get(username);if(!p||Date.now()>p.expires)return res.status(400).json({error:"انتهت صلاحية رمز التأكيد، أعد المحاولة"});if(p.code!==code)return res.status(400).json({error:"رمز التأكيد غير صحيح"});const u={username:p.username,displayName:p.username,discordUsername:p.discordUsername,discordId:p.memberId,role:"member",password:p.password,createdAt:new Date().toISOString()};siteUsers.set(username,u);pendingSignups.delete(username);const token=crypto.randomBytes(32).toString("hex");sessions.set(token,u);res.setHeader("Set-Cookie","mld_session="+token+"; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800");res.json({ok:true,user:publicUser(u)})});
app.post("/api/auth/logout",(req,res)=>{const token=req.headers.cookie?.match(/(?:^|;\\s*)mld_session=([^;]+)/)?.[1];if(token)sessions.delete(token);res.setHeader("Set-Cookie","mld_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");res.json({ok:true})});
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

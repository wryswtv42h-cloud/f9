const BANK_GROUPS = {
  "الترفيه والحظ":["راتب","بخشيش","حظ","روليت","فواكه","لعبه","نرد","قمار","رهان","حراميه"],
  "الاقتصاد":["تحويل","استثمار","صندوق","المعلومات","فلوس","وقت","بروفايل","مدير","الرصيد","البند","قرض","سداد","تبرع","تداول"],
  "الحماية والسرقة":["حمايه","نهب"],
  "العلاقات":["زواج","زواجي","زواجات","طلاق","خلع"],
  "كبار الشخصيات":["توب"],
  "المتجر والسوق":["متجر","سوق","شراء","بيع","عقار"],
  "المزرعة":["مزرعتي","زرع","حصاد","مخزون","سماد","توسعة"],
  "الإسطبل":["اسطبل","تغذية","جمع"]
};
const LYNX_ALIASES = {
  "سالفة":["سالفة","سالفه","برا","برا السالفة"],"روليت":["روليت"],"مافيا":["مافيا"],
  "كت":["كت"],"زر":["زر"],"بومب":["بومب"],"تصويت":["تصويت"],"ايفنت":["ايفنت"],
  "اعلام":["اعلام"],"فكك":["فكك"],"ترتيب":["ترتيب"],"صحح":["صحح"],"جمع":["جمع"],
  "مفرد":["مفرد"],"حيوانات":["حيوانات"],"شركة":["شركة","شركه"],"ضرب":["ضرب"],"طرح":["طرح"],
  "ترجمة":["ترجمة"],"عواصم":["عواصم"],"اعكس":["اعكس"],"اسرع":["اسرع"],"حرف":["حرف"],
  "ادمج":["ادمج"],"توب":["توب"],"هايد":["هايد"],"فخ":["فخ","لغم"],"حجره":["حجره"],
  "اكس":["uxo","اكس"],"المتجر":["المتجر"],"تحويل":["تحويل"],"ايقاف":["ايقاف"],
  "نقاطي":["points","p","نقاطي"]
};
const SYSTEM_GROUPS = {
  "إعدادات البوت":["setname","setprefix","setavatar","setbanner","owner","set","systemdown","systemup","resetallbot","wipeserver","theme"],
  "إعدادات السيرفر":["setup","new","removenew","defens","trust","spam","system","log","welcome","line","react","word","reply","col","autorole","addcolor","setcolors","copy","backup","restoreperm","reset"],
  "أوامر العقوبات":["warn","unwarn","warns","mute","unmute","mutes","vmute","unvmute","kick","ban","unban","unbanall","bans","prison","unprison"],
  "الأوامر العامة":["help","ping","commands"]
};
const norm = s => String(s||"").trim().toLowerCase().replace(/^[-.!]/,"");
const flat = groups => Object.values(groups).flat();
function catalog() {
  return {bank:BANK_GROUPS,lynx:LYNX_ALIASES,system:SYSTEM_GROUPS};
}
function findLynx(input) {
  const n=norm(input);
  return Object.entries(LYNX_ALIASES).find(([,aliases])=>aliases.some(a=>norm(a)===n))?.[0] || null;
}
function findBank(input) {
  const n=norm(input);
  for (const [group,items] of Object.entries(BANK_GROUPS)) if(items.some(a=>norm(a)===n)) return {group,command:n};
  return null;
}
function findSystem(input) {
  const n=norm(input);
  for (const [group,items] of Object.entries(SYSTEM_GROUPS)) if(items.some(a=>norm(a)===n)) return {group,command:n};
  return null;
}
function helpText(type,prefix) {
  if(type==="bank") return "💰 **نظام البنك**\n"+Object.entries(BANK_GROUPS).map(([g,c])=>"**"+g+"**\n"+c.map(x=>prefix+x).join(" · ")).join("\n");
  if(type==="lynx") return "🦊 **Lynx Store · الأوامر**\n"+Object.entries(SYSTEM_GROUPS).map(([g,c])=>"**"+g+"**\n"+c.map(x=>prefix+x).join(" · ")).join("\n")+"\n\n**الألعاب**\n"+flat(LYNX_ALIASES).join(" · ");
  return "MLADH BOT\n"+Object.keys(BOT_MODULES||{}).join(" · ");
}
function execute({type,command,args,author,prefix}) {
  const p=prefix||"!";
  if(type==="bank"){
    const hit=findBank(command);
    if(!hit)return null;
    const messages={
      "راتب":"💵 تم تجهيز راتبك. نظام الرصيد جاهز.",
      "بخشيش":"🪙 البخشيش متاح.",
      "حظ":"🍀 حظك اليوم قيد الحساب.",
      "روليت":"🎰 الروليت جاهز. استخدمه داخل جلسة اللعب.",
      "فواكه":"🍒🍋 آلة الفواكه جاهزة.",
      "نرد":"🎲 النرد جاهز.",
      "تحويل":"💸 التحويل متاح: حدّد المستلم والمبلغ.",
      "الرصيد":"💰 رصيدك محفوظ ضمن نظام البنك.",
      "بروفايل":"👤 ملفك الاقتصادي جاهز.",
      "توب":"🏆 قائمة المتصدرين جاهزة.",
      "متجر":"🛒 المتجر جاهز.",
      "سوق":"🏪 السوق جاهز.",
      "مزرعتي":"🌾 مزرعتك جاهزة.",
      "اسطبل":"🐎 إسطبلك جاهز."
    };
    return messages[hit.command] || "✅ أمر **"+hit.command+"** من قسم **"+hit.group+"** تم استقباله.";
  }
  const game=findLynx(command);
  if(type==="lynx"&&game)return "🎮 **"+game+"** جاهز. "+(args.length?"المدخلات: "+args.join(" "):"ابدأ الأمر لإنشاء الجولة.");
  const sys=findSystem(command);
  if(type==="system"&&sys)return "⚙️ أمر **"+sys.command+"** من قسم **"+sys.group+"** يحتاج صلاحية الإدارة وسيتم ربطه بإعدادات السيرفر.";
  return null;
}
module.exports={BANK_GROUPS,LYNX_ALIASES,SYSTEM_GROUPS,catalog,helpText,execute,findLynx,findBank,findSystem};

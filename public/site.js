"use strict";
const $=s=>document.querySelector(s);
const menu=$("#menu"),menuBtn=$("#menuBtn");
function closeMenu(){menu.classList.remove("open")}
menuBtn.addEventListener("click",e=>{e.stopPropagation();menu.classList.toggle("open")});
document.addEventListener("click",e=>{if(!menu.contains(e.target)&&!menuBtn.contains(e.target))closeMenu()});
document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener("click",()=>closeMenu()));
async function api(url){const r=await fetch(url,{cache:"no-store"});if(!r.ok)throw Error("HTTP "+r.status);return r.json()}
async function refresh(){
 try{const d=await api("/api/public/server");
 $("#serverName").textContent=d.name||"MLD · Community";$("#membersCount").textContent=(d.members??0).toLocaleString("ar-SA");$("#onlineCount").textContent=(d.online??0).toLocaleString("ar-SA");$("#visitsCount").textContent=(d.visits??0).toLocaleString("ar-SA");
 $("#statusText").textContent=d.status==="online"?"متصل بسيرفر Discord":"وضع العرض — بيانات Discord غير متاحة حالياً";
 }catch(e){$("#statusText").textContent="تعذر جلب بيانات Discord حالياً"}
}
function intro(){const el=$("#intro");setTimeout(()=>el.classList.add("hide"),900)}
refresh();setInterval(refresh,15000);intro();
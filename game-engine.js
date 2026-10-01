"use strict";

const GAMES={
  "أونو":{min:2,max:8,type:"cards"},
  "بلوت":{min:4,max:4,type:"cards"},
  "جاكارو":{min:2,max:4,type:"board"},
  "لودو":{min:2,max:4,type:"board"},
  "مافيا":{min:4,max:16,type:"social"},
  "مونوبولي":{min:2,max:6,type:"board"},
  "كود نيمز":{min:4,max:10,type:"teams"},
  "رووليت":{min:2,max:12,type:"quick"},
  "اكس":{min:2,max:2,type:"quick"},
  "حجره":{min:2,max:2,type:"quick"},
  "زر":{min:2,max:8,type:"quick"},
  "كت":{min:2,max:8,type:"quick"},
  "بومب":{min:3,max:12,type:"quick"},
  "فخ":{min:2,max:12,type:"quick"},
  "هايد":{min:3,max:12,type:"quick"},
  "عواصم":{min:2,max:8,type:"quiz"},
  "شركة":{min:2,max:8,type:"quick"},
  "سالفة":{min:2,max:12,type:"social"}
};

function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function base(game,players){return{game,players:[...players],turnIndex:0,phase:"playing",winner:null,log:[],scores:Object.fromEntries(players.map(p=>[p,0])),createdAt:new Date().toISOString()}}
function create(game,players){
 if(!GAMES[game])throw Error("اللعبة غير مدعومة");
 const s=base(game,players);
 if(game==="أونو"){const d=[];for(const c of ["red","yellow","green","blue"]){for(let n=0;n<10;n++)d.push({c,n});for(let n=1;n<10;n++)d.push({c,n})}for(let i=0;i<8;i++)d.push({c:"wild",n:4});shuffle(d);s.deck=d;s.discard=[s.deck.pop()];s.hands={};players.forEach(p=>s.hands[p]=s.deck.splice(0,7))}
 else if(game==="لودو"||game==="جاكارو"){s.pieces=Object.fromEntries(players.map(p=>[p,[0,0,0,0]]));s.dice=null}
 else if(game==="مونوبولي"){s.money=Object.fromEntries(players.map(p=>[p,1500]));s.position=Object.fromEntries(players.map(p=>[p,0]));s.properties={};s.dice=null}
 else if(game==="مافيا"){const roles={};players.forEach(p=>roles[p]="citizen");shuffle(players.slice()).slice(0,Math.max(1,Math.floor(players.length/4))).forEach(p=>roles[p]="mafia");s.roles=roles;s.alive=Object.fromEntries(players.map(p=>[p,true]));s.votes={};s.phase="night"}
 else if(game==="كود نيمز"){const words=shuffle(["بحر","قمر","ملاذ","نار","ملك","ورد","سيف","باب","ذهب","نجم","مفتاح","عين","كتاب","شمس","نهر","قصر","برج","مطر","طائرة","موز"]);const key=shuffle(Array(20).fill("neutral").map((x,i)=>i<7?"red":i<14?"blue":"neutral"));key[0]="assassin";shuffle(key);s.words=words;s.key=Object.fromEntries(words.map((_,i)=>[i,key[i]]));s.revealed={};s.teams={};s.spymasters={red:players[0],blue:players.find((p,i)=>i>0)||players[0]};players.forEach((p,i)=>s.teams[p]=i%2?"blue":"red");s.teamTurn="red";s.clue=null;s.scores={red:0,blue:0}}
 else if(game==="بلوت"){s.hands=Object.fromEntries(players.map(p=>[p,[]]));s.trick=[];s.scores=Object.fromEntries(players.map(p=>[p,0]));}
 else if(["اكس"].includes(game)){s.board=Array(9).fill(null)}
 else if(["حجره"].includes(game)){s.round=0;s.choices={};s.wins=Object.fromEntries(players.map(p=>[p,0]))}
 else if(["زر","بومب","فخ","كت","هايد","شركة"].includes(game)){s.round=1;s.target=players[Math.floor(Math.random()*players.length)];s.secret=Math.floor(Math.random()*12)+1}
 else if(game==="عواصم"){s.question={text:"عاصمة المملكة العربية السعودية؟",options:["الرياض","جدة","مكة","الدمام"],answer:0};s.answered={}}
 else if(game==="سالفة"){s.prompt="وش أكثر موقف ما تنساه؟";s.responses={}}
 return s;
}
function player(s,user){if(!s.players.includes(user))throw Error("لست لاعبًا")}
function turn(s,user){player(s,user);if(s.players[s.turnIndex]!==user)throw Error("ليس دورك")}
function advance(s){s.turnIndex=(s.turnIndex+1)%s.players.length}
function act(s,user,a={}){
 if(s.phase!=="playing")throw Error("انتهت اللعبة");player(s,user);
 if(s.game!=="مافيا"&&s.game!=="كود نيمز"&&s.game!=="اكس"&&s.game!=="حجره"&&s.game!=="عواصم"&&s.game!=="سالفة")turn(s,user);
 switch(s.game){
  case"أونو":return uno(s,user,a);case"لودو":case"جاكارو":return board(s,user,a);case"مونوبولي":return monopoly(s,user,a);
  case"مافيا":return mafia(s,user,a);case"كود نيمز":return codenames(s,user,a);case"بلوت":return baloot(s,user,a);case"رووليت":return roulette(s,user,a);
  case"اكس":return tic(s,user,a);case"حجره":return rps(s,user,a);case"عواصم":return quiz(s,user,a);case"سالفة":return story(s,user,a);
  default:return quick(s,user,a);
 }
}
function uno(s,u,a){if(a.type==="draw"){if(!s.deck.length)throw Error("لا توجد أوراق");s.hands[u].push(s.deck.pop());return s}if(a.type!=="play")throw Error("حركة غير صالحة");const h=s.hands[u],i=Number(a.index),c=h[i],top=s.discard.at(-1);if(!c)throw Error("ورقة غير موجودة");if(c.c!=="wild"&&top.c!=="wild"&&c.c!==top.c&&c.n!==top.n)throw Error("الورقة غير صالحة");h.splice(i,1);s.discard.push(c);if(!h.length){s.winner=u;s.phase="finished"}else advance(s);return s}
function board(s,u,a){if(a.type==="roll"){s.dice=1+Math.floor(Math.random()*6);return s}if(a.type!=="move")throw Error("حركة غير صالحة");const i=Number(a.piece);if(!s.dice||i<0||i>3)throw Error("حجر غير صالح");s.pieces[u][i]+=s.dice;s.dice=null;if(s.pieces[u][i]>=57){s.winner=u;s.phase="finished"}else advance(s);return s}
function monopoly(s,u,a){if(a.type==="roll"){s.dice=2+Math.floor(Math.random()*11);s.position[u]=(s.position[u]+s.dice)%40;s.money[u]-=25;return s}if(a.type==="buy"){const p=s.position[u],price=100+p*10;if(s.properties[p])throw Error("الموقع مملوك");if(s.money[u]<price)throw Error("الرصيد لا يكفي");s.money[u]-=price;s.properties[p]=u;advance(s);return s}throw Error("حركة غير صالحة")}
function mafia(s,u,a){if(s.phase==="night"){if(s.roles[u]!=="mafia"||a.type!=="kill")throw Error("صلاحية غير متاحة");if(!s.alive[a.target])throw Error("الهدف غير حي");s.alive[a.target]=false;s.phase="day";return s}if(a.type!=="vote")throw Error("التصويت غير متاح");if(!s.alive[a.target])throw Error("الهدف غير حي");s.votes[u]=a.target;const alive=s.players.filter(p=>s.alive[p]);if(Object.keys(s.votes).length>=alive.length){const c={};Object.values(s.votes).forEach(x=>c[x]=(c[x]||0)+1);const dead=Object.entries(c).sort((x,y)=>y[1]-x[1])[0]?.[0];if(dead)s.alive[dead]=false;s.votes={};const mafiaAlive=s.players.some(p=>s.alive[p]&&s.roles[p]==="mafia"),citAlive=s.players.some(p=>s.alive[p]&&s.roles[p]!=="mafia");if(!mafiaAlive){s.winner="citizens";s.phase="finished"}else if(!citAlive){s.winner="mafia";s.phase="finished"}else s.phase="night"}return s}
function codenames(s,u,a){const team=s.teams[u];if(team!==s.teamTurn)throw Error("ليس دور فريقك");if(a.type==="clue"){if(s.spymasters[team]!==u)throw Error("القائد فقط يستطيع إعطاء التلميح");const text=String(a.text||"").trim();const count=Math.max(0,Math.min(9,Number(a.count)||0));if(!text||!count)throw Error("أدخل تلميحًا وعددًا صحيحًا");s.clue={text,count,by:u};return s}if(a.type!=="guess")throw Error("التخمين غير متاح");if(s.spymasters[team]===u)throw Error("القائد لا يخمّن");const i=Number(a.index);if(!Number.isInteger(i)||!s.words[i]||s.revealed[i])throw Error("الكلمة غير صالحة");const color=s.key[i];s.revealed[i]=color;if(color===team)s.scores[team]++;if(color==="assassin"){s.winner=team==="red"?"blue":"red";s.phase="finished";return s}if(color!==team||Object.values(s.key).filter(x=>x===team).every((_,idx)=>false)){s.teamTurn=team==="red"?"blue":"red";s.clue=null}const remaining=Object.entries(s.key).filter(([i,x])=>x===team&&!s.revealed[i]).length;if(remaining===0){s.winner=team;s.phase="finished"}return s}
function baloot(s,u,a){if(a.type==="deal"){const deck=[];for(const suit of["♠","♥","♦","♣"])for(let n=1;n<=13;n++)deck.push({suit,rank:n});shuffle(deck);s.players.forEach(p=>s.hands[p]=deck.splice(0,8));return s}if(a.type!=="play")throw Error("حركة غير صالحة");const i=Number(a.index),card=s.hands[u][i];if(!card)throw Error("ورقة غير صالحة");s.hands[u].splice(i,1);s.trick.push({user:u,card});if(s.trick.length===s.players.length){s.scores[s.trick[0].user]++;s.trick=[]}advance(s);return s}
function roulette(s,u,a){if(a.type!=="bet")throw Error("الحركة غير صالحة");const amount=Math.max(1,Number(a.amount)||1);s.bets=s.bets||{};s.bets[u]={choice:String(a.choice||"red"),amount};if(Object.keys(s.bets).length>=s.players.length){s.result=Math.random()<.5?"red":"black";for(const[p,b]of Object.entries(s.bets))s.scores[p]+=(b.choice===s.result?b.amount:-b.amount);s.bets={};s.round=(s.round||0)+1}return s}
function tic(s,u,a){const i=Number(a.index);if(!Number.isInteger(i)||i<0||i>8||s.board[i])throw Error("الخانة غير صالحة");s.board[i]=s.players.indexOf(u)===0?"X":"O";const wins=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];if(wins.some(w=>w.every(i=>s.board[i]===s.board[w[0]]))){s.winner=u;s.phase="finished"}else if(s.board.every(Boolean))s.phase="finished";else advance(s);return s}
function rps(s,u,a){const c=String(a.choice||"");if(!["حجر","ورق","مقص"].includes(c))throw Error("اختر حجر أو ورق أو مقص");s.choices[u]=c;if(Object.keys(s.choices).length===s.players.length){const [a1,a2]=s.players;const x=s.choices[a1],y=s.choices[a2];if(x!==y){const win=(x==="حجر"&&y==="مقص")||(x==="ورق"&&y==="حجر")||(x==="مقص"&&y==="ورق");s.scores[win?a1:a2]++}s.choices={};s.round++}return s}
function quiz(s,u,a){if(s.answered[u])throw Error("أجبت مسبقًا");if(Number(a.answer)!==s.question.answer)throw Error("إجابة غير صحيحة");s.answered[u]=true;s.scores[u]++;return s}
function story(s,u,a){const text=String(a.text||"").trim();if(text.length<2)throw Error("اكتب إجابة");s.responses[u]=text;s.scores[u]++;return s}
function quick(s,u,a){const n=Number(a.number);if(a.type!=="pick"||!Number.isInteger(n))throw Error("اختر رقمًا صحيحًا");if(n===s.secret)s.scores[u]+=5;else s.scores[u]+=1;advance(s);s.secret=Math.floor(Math.random()*12)+1;s.round=(s.round||1)+1;return s}
function publicState(s,u){
 const x=JSON.parse(JSON.stringify(s));
 if(s.game==="أونو")x.hands=Object.fromEntries(Object.entries(s.hands).map(([p,h])=>[p,p===u?h:h.map(()=>({hidden:true}))]));
 if(s.game==="بلوت")x.hands=Object.fromEntries(Object.entries(s.hands).map(([p,h])=>[p,p===u?h:h.map(()=>({hidden:true}))]));
 if(s.game==="مافيا")x.roles={[u]:s.roles[u]};
 if(s.game==="كود نيمز"){
   const team=s.teams[u];const leader=s.spymasters[team]===u;
   if(!leader){delete x.key;delete x.spymasters}
   x.viewerTeam=team;x.viewerRole=leader?"قائد":"مخمّن";
 }
 if(s.game==="حجره")x.choices=Object.fromEntries(Object.keys(s.choices||{}).filter(p=>p===u).map(p=>[p,s.choices[p]]));
 if(s.game==="عواصم")x.question=s.question;
 return x;
}
module.exports={GAMES,create,act,publicState};

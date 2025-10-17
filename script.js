// ========== عدّل إعدادات Firebase هنا ==========
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "XXXX",
  appId: "XXXX"
};
// ==============================================

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// عناصر عامة
const nameEl = document.getElementById('name');
const roomEl = document.getElementById('room');
const statusEl = document.getElementById('status');
const copyBtn = document.getElementById('copy');

// لوحات
const hostPanel = document.getElementById('hostPanel');
const playerPanel = document.getElementById('playerPanel');

// مقدم
const scoreGreenEl = document.getElementById('scoreGreen');
const scoreOrangeEl = document.getElementById('scoreOrange');
const letterEl = document.getElementById('letter');
const questionEl = document.getElementById('question');
const openQBtn = document.getElementById('openQ');
const resetRoundBtn = document.getElementById('resetRound');
const allowedTeamTxt = document.getElementById('allowedTeamTxt');
const firstBuzzEl = document.getElementById('firstBuzz');
const timerEl = document.getElementById('timer');
const markCorrectBtn = document.getElementById('markCorrect');
const markWrongBtn = document.getElementById('markWrong');

// لاعب
const joinGreenBtn = document.getElementById('joinGreen');
const joinOrangeBtn = document.getElementById('joinOrange');
const myTeamEl = document.getElementById('myTeam');
const liveLetterEl = document.getElementById('liveLetter');
const liveQuestionEl = document.getElementById('liveQuestion');
const liveFirstEl = document.getElementById('liveFirst');
const liveTimerEl = document.getElementById('liveTimer');
const buzzerBtn = document.getElementById('buzzerBtn');

// حالة
let roomId = new URLSearchParams(location.search).get('room') || '';
if (roomId) roomEl.value = roomId;
let uid = Math.random().toString(36).slice(2, 10);
let isHost = false;
let myTeam = null;
let serverOffset = 0;

// مزامنة الوقت مع خادم Firebase
firebase.database().ref(".info/serverTimeOffset").on("value", function(snap) {
  serverOffset = snap.val() || 0;
});
function nowMs(){ return Date.now() + serverOffset; }

function setStatus(t){ statusEl.textContent = t || ''; }
function roomRef(id){ return db.ref('haroof/rooms/'+id); }
function playersRef(id){ return db.ref('haroof/rooms/'+id+'/players'); }

function copyLink(){
  if(!roomId) return;
  const url = location.origin + location.pathname + '?room=' + roomId;
  navigator.clipboard.writeText(url);
  setStatus('تم نسخ رابط الغرفة');
}

copyBtn.addEventListener('click', copyLink);

async function createRoom(){
  const name = (nameEl.value.trim() || ('Host-'+uid.slice(0,4)));
  roomId = (roomEl.value.trim() || Math.random().toString(36).slice(2,7).toUpperCase());
  const ref = roomRef(roomId);
  await ref.set({
    createdAt: nowMs(),
    hostId: uid,
    settings: { letter: '', question: '', allowedTeam: null },
    state: 'idle', // idle | open | locked
    scores: { green: 0, orange: 0 },
    buzzer: null, // {team, playerName, at}
    countdownEndsAt: null,
    players: {}
  });
  afterJoin(true, name);
}

async function joinRoom(){
  const name = (nameEl.value.trim() || ('Player-'+uid.slice(0,4)));
  roomId = roomEl.value.trim();
  if(!roomId){ setStatus('اكتب كود الغرفة أو اضغط إنشاء غرفة'); return; }
  const ref = roomRef(roomId);
  const snap = await ref.get();
  if(!snap.exists()){ setStatus('الغرفة غير موجودة'); return; }
  const data = snap.val();
  if(!data.hostId){
    await ref.child('hostId').set(uid);
    afterJoin(true, name);
  } else {
    // أضف كلاعب (بدون فريق حتى يختار)
    await ref.child('players').child(uid).set({ name, team: null, joinedAt: nowMs() });
    afterJoin(false, name);
  }
}

function afterJoin(asHost, myName){
  isHost = asHost;
  const url = location.origin + location.pathname + '?room=' + roomId;
  history.replaceState({}, '', url);
  setStatus('دخلت الغرفة: '+roomId+' — شارك الرابط مع الشلة');
  copyBtn.style.display = 'inline-block';
  if(asHost){
    hostPanel.style.display = 'block';
    playerPanel.style.display = 'none';
  }else{
    hostPanel.style.display = 'none';
    playerPanel.style.display = 'block';
  }
  // سجل الاسم
  if(asHost){
    roomRef(roomId).child('players').child(uid).set({ name: myName, team: 'host', joinedAt: nowMs() });
  }
  listenRoom();
}

// الاستماع لتغيرات الغرفة
function listenRoom(){
  roomRef(roomId).on('value', (snap)=>{
    if(!snap.exists()) return;
    const d = snap.val();
    // سكورات
    scoreGreenEl.textContent = d.scores?.green ?? 0;
    scoreOrangeEl.textContent = d.scores?.orange ?? 0;
    // اعدادات
    const allowed = d.settings?.allowedTeam;
    allowedTeamTxt.textContent = allowed ? (allowed==='green'?'الأخضر':'البرتقالي') : 'الفريقين';
    letterEl.value = d.settings?.letter || '';
    questionEl.value = d.settings?.question || '';
    liveLetterEl.textContent = d.settings?.letter || '-';
    liveQuestionEl.textContent = d.settings?.question || '-';
    // البازر
    firstBuzzEl.textContent = d.buzzer ? (d.buzzer.playerName+' — '+(d.buzzer.team==='green'?'🟢':'🟠')) : '-';
    liveFirstEl.textContent = firstBuzzEl.textContent;
    // حالة الزر للاعب
    let canBuzz = (d.state==='open');
    if(d.settings?.allowedTeam && myTeam && d.state==='open'){
      canBuzz = (d.settings.allowedTeam === myTeam);
    }
    // لا يستطيع الضغط إن لم يختر فريق
    if(!myTeam) canBuzz = false;
    // لو مغلق
    buzzerBtn.disabled = !canBuzz;
    buzzerBtn.className = 'buzzer ' + (myTeam==='green'?'green':(myTeam==='orange'?'orange':''));

    // عدّاد
    const end = d.countdownEndsAt || 0;
    updateCountdown(end);
  });
}

// عدّاد
let timerInterval = null;
function updateCountdown(endMs){
  if(timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  function tick(){
    const remain = Math.max(0, endMs - nowMs());
    const sec = (remain/1000).toFixed(1);
    timerEl.textContent = sec;
    liveTimerEl.textContent = sec;
  }
  tick();
  if(endMs>nowMs()){
    timerInterval = setInterval(()=>{
      if(nowMs() >= endMs){
        tick();
        clearInterval(timerInterval);
        timerInterval = null;
      } else {
        tick();
      }
    }, 100);
  }
}

// اختيار فريق
joinGreenBtn.addEventListener('click', ()=> chooseTeam('green'));
joinOrangeBtn.addEventListener('click', ()=> chooseTeam('orange'));

async function chooseTeam(team){
  if(!roomId) return;
  myTeam = team;
  myTeamEl.textContent = (team==='green'?'الأخضر':'البرتقالي');
  await playersRef(roomId).child(uid).update({ team });
}

// فتح السؤال
openQBtn.addEventListener('click', async ()=>{
  if(!isHost || !roomId) return;
  const letter = letterEl.value.trim();
  const question = questionEl.value.trim() || 'سؤال سريع';
  const ref = roomRef(roomId);
  await ref.update({
    'settings/letter': letter,
    'settings/question': question,
    'settings/allowedTeam': null, // كلا الفريقين
    state: 'open',
    buzzer: null,
    countdownEndsAt: null
  });
});

// زر البازر للاعب
buzzerBtn.addEventListener('click', async ()=>{
  if(!roomId || !myTeam) return;
  const name = nameEl.value.trim() || ('Player-'+uid.slice(0,4));
  const ref = roomRef(roomId);
  // عملية ذرّية: أول ضغط فقط
  await ref.transaction((d)=>{
    if(!d) return d;
    if(d.state!=='open') return d;
    if(d.settings && d.settings.allowedTeam && d.settings.allowedTeam !== myTeam) return d;
    if(d.buzzer) return d; // تم الحجز
    // احجز
    d.buzzer = { team: myTeam, playerName: name, at: nowMs() };
    d.state = 'locked';
    d.countdownEndsAt = nowMs() + 3000; // 3 ثواني
    return d;
  });
});

// جولة جديدة
resetRoundBtn.addEventListener('click', async ()=>{
  if(!isHost || !roomId) return;
  await roomRef(roomId).update({
    state: 'idle',
    buzzer: null,
    countdownEndsAt: null,
    'settings/allowedTeam': null
  });
});

// تقييم الإجابة
markCorrectBtn.addEventListener('click', async ()=>{
  if(!isHost || !roomId) return;
  const snap = await roomRef(roomId).get();
  if(!snap.exists()) return;
  const d = snap.val();
  const team = d.buzzer?.team;
  if(!team) return;
  const newScore = (d.scores?.[team] || 0) + 1;
  await roomRef(roomId).update({
    ['scores/'+team]: newScore,
    state: 'idle',
    countdownEndsAt: null,
    buzzer: null,
    'settings/allowedTeam': null
  });
});

markWrongBtn.addEventListener('click', async ()=>{
  if(!isHost || !roomId) return;
  const snap = await roomRef(roomId).get();
  if(!snap.exists()) return;
  const d = snap.val();
  const team = d.buzzer?.team;
  if(!team) return;
  // اعطِ الحق للفريق الآخر
  const other = (team==='green'?'orange':'green');
  await roomRef(roomId).update({
    state: 'open',
    buzzer: null,
    countdownEndsAt: null,
    'settings/allowedTeam': other
  });
});

// أزرار الانضمام/إنشاء
document.getElementById('create').addEventListener('click', createRoom);
document.getElementById('join').addEventListener('click', joinRoom);

// تلميح عند وجود بارامتر ?room=
if(roomId){ setStatus('اضغط "دخول غرفة" للدخول إلى: '+roomId); }
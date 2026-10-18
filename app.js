/* ===== 基本設定 ===== */
const BUFFER = 10;
const DAY_START = 6*60, DAY_END = 20*60;
const PPM = 2;
const SERVICES = {
  '和装メイク・かつら':{role:'make',skills:['和装メイク','日本髪・かつら'],min:4,dur:90},
  '洋装メイク・ヘア':{role:'make',skills:['洋装メイク','ヘアセット'],min:3,dur:120},
  '新郎メイク':{role:'make',skills:['新郎メイク'],min:2,dur:20},
  '留袖ヘア':{role:'make',skills:['留袖ヘア'],min:2,dur:30},
  'ヘアセット':{role:'make',skills:['ヘアセット'],min:2,dur:40},
  'ヘアチェンジ':{role:'make',skills:['ヘアセット'],min:3,dur:30},
  '白無垢着付け':{role:'kitsuke',skills:['白無垢'],min:4,dur:60},
  '色打掛着付け':{role:'kitsuke',skills:['色打掛'],min:4,dur:60},
  '紋付袴着付け':{role:'kitsuke',skills:['紋付袴'],min:2,dur:30},
  '留袖着付け':{role:'kitsuke',skills:['留袖'],min:2,dur:40},
  '振袖着付け':{role:'kitsuke',skills:['振袖'],min:2,dur:45},
  'ドレス着付け':{role:'kitsuke',skills:['ウエディングドレス'],min:3,dur:40},
  'カラードレス着付け':{role:'kitsuke',skills:['カラードレス'],min:3,dur:30},
  '子ども着物着付け':{role:'kitsuke',skills:['子ども着物'],min:2,dur:30},
};
const ROLE = {make:'メイク・ヘア',kitsuke:'着付け'};
const SKILLS = {make:[], kitsuke:[]};
for (const s of Object.values(SERVICES)) for (const k of s.skills) if (!SKILLS[s.role].includes(k)) SKILLS[s.role].push(k);
const FAM_COLORS = ['var(--f1)','var(--f2)','var(--f3)','var(--f4)','var(--f5)','var(--f6)'];
const WEEK = ['日','月','火','水','木','金','土'];

/* ===== 状態 ===== */
let CFG = null, DAYS = {}, date = '', DAY = null, C = null;
let selected = null, view = 'shift';
let db = null, me = null, uid = null, canWrite = false, loadedDays = false;
let editJob = null, editFam = null, editStaff = null, importPlan = null;

/* ===== 便利関数 ===== */
const m = t => { if (!t) return 0; const [h,mi] = String(t).split(':').map(Number); return h*60+(mi||0); };
const hm = n => String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const uidGen = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function ymd(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function dateLabel(s){ const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : `${d.getMonth()+1}月${d.getDate()}日（${WEEK[d.getDay()]}）`; }
function blankDay(d){ return {date:d, families:[], jobs:[], assign:{}, pins:{}, absent:{}, hours:{}}; }
function normDay(day){
  for (const k of ['families','jobs']) if (!Array.isArray(day[k])) day[k] = [];
  for (const k of ['assign','pins','absent','hours']) if (!day[k] || typeof day[k] !== 'object') day[k] = {};
  return day;
}

/* ===== 計算用ビュー（スタッフの当日勤務・欠勤を反映） ===== */
function buildCtx(day){
  const staff = (CFG?.staff || []).map(s => ({...s,
    start: day.hours?.[s.id]?.start || s.start,
    end: day.hours?.[s.id]?.end || s.end,
    absent: !!day.absent?.[s.id]}));
  const byId = {}; for (const s of staff) byId[s.id] = s;
  const jobs = day.jobs || [];
  const jobById = {}; for (const j of jobs) jobById[j.id] = j;
  const fam = {}; (day.families || []).forEach((f, i) => fam[f.id] = {...f, color: FAM_COLORS[i % FAM_COLORS.length]});
  return {day, staff, byId, jobs, jobById, fam};
}
function refresh(){
  DAY = normDay(DAYS[date] ? clone(DAYS[date]) : blankDay(date));
  C = buildCtx(DAY);
  if (selected && !C.jobById[selected]) selected = null;
}
const famOf = (ctx, j) => ctx.fam[j.fam] || {name:'（ご家族なし）', color:'var(--muted)'};
const spec = j => SERVICES[j.svc] || {role:'make', skills:['（不明なメニュー）'], min:9, dur:j.dur};
const jS = j => m(j.start), jE = j => m(j.start) + Number(j.dur);

/* ===== マッチング ===== */
function fit(st, j){
  const sp = spec(j);
  if (st.absent) return {ok:false, why:'当日欠勤'};
  if (st.role !== sp.role) return {ok:false, why:ROLE[sp.role]+'の担当ではない', hide:true};
  const miss = sp.skills.filter(k => !(st.skills || []).includes(k));
  if (miss.length) return {ok:false, why:'技術なし：'+miss.join('・')};
  if (Number(st.level) < sp.min) return {ok:false, why:'レベル不足（Lv.'+sp.min+'以上が必要）'};
  if (m(st.start) > jS(j) || m(st.end) < jE(j)) return {ok:false, why:'勤務時間外（'+st.start+'〜'+st.end+'）'};
  return {ok:true};
}
function overlaps(a, b){ return jS(a) < jE(b) + BUFFER && jS(b) < jE(a) + BUFFER; }
function conflictFor(ctx, stId, j, assign){
  for (const jid in assign){
    if (assign[jid] !== stId || jid === j.id) continue;
    const o = ctx.jobById[jid];
    if (o && overlaps(o, j)) return o;
  }
  return null;
}
function score(ctx, st, j, assign){
  const sp = spec(j), parts = [];
  parts.push(['必要な技術がそろっている', 40]);
  parts.push(['レベルの余裕（Lv.'+st.level+'／必要Lv.'+sp.min+'）', Math.min(Number(st.level) - sp.min, 2) * 8]);
  const r = Number(st.rating) || 0;
  parts.push(['お客様評価 '+r.toFixed(1), Math.round(Math.max(0, Math.min(20, (r - 4) * 20)))]);
  if (j.pref) parts.push([j.pref === st.id ? '指名・前撮り担当と一致' : '指名・前撮り担当ではない', j.pref === st.id ? 15 : 0]);
  else parts.push(['指名なし', 10]);
  if (j.en) parts.push([st.en ? '英語対応できる' : '英語対応できない', st.en ? 9 : -15]);
  else parts.push(['特別な要望なし', 9]);
  let same = false;
  for (const jid in assign) if (assign[jid] === st.id && jid !== j.id && ctx.jobById[jid]?.fam === j.fam){ same = true; break; }
  if (same) parts.push(['同じご家族を続けて担当', 5]);
  return {total: Math.max(0, Math.min(100, parts.reduce((a, p) => a + p[1], 0))), parts};
}
const loadOf = (stId, assign) => { let n = 0; for (const k in assign) if (assign[k] === stId) n++; return n; };
const pickScore = (ctx, st, j, a) => score(ctx, st, j, a).total - loadOf(st.id, a) * 3;
function objective(ctx, a){
  let v = 0;
  for (const j of ctx.jobs){ const sid = a[j.id]; v += sid && ctx.byId[sid] ? score(ctx, ctx.byId[sid], j, a).total : -150; }
  for (const st of ctx.staff){ const n = loadOf(st.id, a); v -= 2 * n * n; }
  return v;
}
/* 固定を先に置き、順番を変えた割り当てを何通りも試して、全体の点数が一番高い案を採用 */
function solve(ctx, fixed){
  const base = {};
  for (const jid in fixed){
    const j = ctx.jobById[jid], st = ctx.byId[fixed[jid]];
    if (j && st && fit(st, j).ok && !conflictFor(ctx, st.id, j, base)) base[jid] = st.id;
  }
  const cand = {};
  for (const j of ctx.jobs) cand[j.id] = ctx.staff.filter(st => fit(st, j).ok);
  const open = ctx.jobs.filter(j => !base[j.id]);
  if (!open.length) return base;
  const first = open.slice().sort((a, b) => cand[a.id].length - cand[b.id].length || jS(a) - jS(b));
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const iters = Math.max(40, Math.min(240, Math.round(6000 / open.length)));
  let best = null, bestV = -1e12;
  for (let it = 0; it < iters; it++){
    const order = it === 0 ? first : open.slice().sort(() => rnd() - 0.5);
    const a = Object.assign({}, base);
    for (const j of order){
      let pick = null, ps = -1e9;
      for (const st of cand[j.id]){
        if (conflictFor(ctx, st.id, j, a)) continue;
        const v = pickScore(ctx, st, j, a);
        if (v > ps){ ps = v; pick = st; }
      }
      if (pick) a[j.id] = pick.id;
    }
    for (const j of open){
      if (!a[j.id]) continue;
      const cur = a[j.id]; delete a[j.id];
      let pick = cur, ps = pickScore(ctx, ctx.byId[cur], j, a);
      for (const st of cand[j.id]){
        if (conflictFor(ctx, st.id, j, a)) continue;
        const v = pickScore(ctx, st, j, a);
        if (v > ps + 0.5){ ps = v; pick = st.id; }
      }
      a[j.id] = pick;
    }
    const v = objective(ctx, a);
    if (v > bestV){ bestV = v; best = a; }
  }
  return best;
}
function unassignedReason(ctx, j){
  if (!SERVICES[j.svc]) return 'メニュー「' + j.svc + '」が登録されていません';
  const rs = ctx.staff.map(st => ({st, f:fit(st, j)})).filter(x => !x.f.hide);
  if (!rs.length) return ROLE[spec(j).role] + 'のスタッフが登録されていません';
  if (!rs.some(x => x.f.ok)){
    const skill = rs.filter(x => !x.f.why.startsWith('技術なし'));
    if (!skill.length) return '必要な技術（' + spec(j).skills.join('・') + '）を持つスタッフがいません';
    if (!skill.some(x => x.f.why !== '当日欠勤')) return '技術を持つスタッフが全員欠勤です';
    return '技術を持つスタッフの勤務時間・レベルが合いません';
  }
  return '技術を持つスタッフは全員この時間に別の施術が入っています';
}
/* 今の担当をできるだけ残し、条件に合わなくなった枠・未定の枠だけを組み直す */
function reflow(ctx, extra){
  const keep = {};
  for (const jid in ctx.day.assign){
    const j = ctx.jobById[jid], st = ctx.byId[ctx.day.assign[jid]];
    if (j && st && fit(st, j).ok) keep[jid] = st.id;
  }
  for (const jid in ctx.day.pins) if (ctx.jobById[jid] && ctx.byId[ctx.day.pins[jid]]) keep[jid] = ctx.day.pins[jid];
  Object.assign(keep, extra || {});
  return solve(ctx, keep);
}

/* ===== 保存 ===== */
const queues = {};
async function writeDoc(path, getData){
  if (!db || !canWrite) return;
  const q = queues[path] || (queues[path] = {busy:false, again:false});
  if (q.busy){ q.again = true; return; }
  q.busy = true;
  try{ await db.doc(path).set(clone(getData())); }
  catch(e){
    if (e && e.code === 'invalid_argument'){ canWrite = false; applyMode(); toast('このアカウントは閲覧のみのため、変更を保存できませんでした'); }
    else if (e && e.code === 'quota_exceeded') toast('保存できる容量を超えました。古い日の予定を整理してください');
    else toast('保存できませんでした。通信を確認して、もう一度操作してください');
  }finally{
    q.busy = false;
    if (q.again){ q.again = false; writeDoc(path, getData); }
  }
}
function stamp(note){ return {by: uid || '', text: note || '更新', at: new Date().toISOString()}; }
function saveDay(note){
  DAY.date = date; DAY.last = stamp(note);
  DAYS[date] = clone(DAY);
  const d = date;
  writeDoc('days/' + d, () => DAYS[d]);
}
function saveCfg(note){ CFG.last = stamp(note); writeDoc('settings/main', () => CFG); }
function commitDay(note, msg){
  C = buildCtx(DAY);
  render(); saveDay(note);
  if (msg !== false) toast(msg || note);
}

/* ===== 描画 ===== */
function render(){
  renderHeader();
  if (!CFG || !C){ renderEmpty(); applyMode(); return; }
  renderStats(); renderLegend(); renderGantt(); renderPanel(); renderJobs(); renderStaff(); renderForms();
  applyMode();
}
function renderEmpty(){
  const msg = db
    ? '<b>データを読み込んでいます</b><span>少し待っても表示されない時は、ページを開き直してください。</span>'
    : '<b>データを保存できません</b><span>ブラウザの設定でサイトデータの保存が止められていないか確認してください。</span>';
  document.getElementById('stats').innerHTML = '';
  document.getElementById('legend').innerHTML = '';
  document.getElementById('gantt').innerHTML = '<div class="empty">' + msg + '</div>';
  document.getElementById('panel').innerHTML = '<p class="note">データが入ると、ここに担当と候補が表示されます。</p>';
  document.getElementById('jobs').innerHTML = '';
  document.getElementById('staff').innerHTML = '';
}
const names = {};
function renderHeader(){
  document.getElementById('d-date').value = date;
  const today = ymd(new Date());
  const days = Object.keys(DAYS).filter(d => (DAYS[d].jobs || []).length || (DAYS[d].families || []).length).sort();
  const up = days.filter(d => d >= today).slice(0, 8);
  const list = up.length ? up : days.slice(-8);
  document.getElementById('daychips').innerHTML = list.length
    ? '<span class="note">予定がある日：</span>' + list.map(d => `<button class="daychip" data-day="${d}" aria-current="${d === date}">${dateLabel(d)}・${(DAYS[d].jobs || []).length}件</button>`).join('')
    : '';
  document.getElementById('sample-pill').hidden = !(DAYS[date]?.sample);
  renderSync();
}
async function renderSync(){
  const el = document.getElementById('sync');
  const lasts = [DAYS[date]?.last, CFG?.last].filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const L = lasts[0];
  if (!L){ el.textContent = db ? (loadedDays ? 'この日の予定はまだ登録されていません' : 'データを読み込んでいます') : 'データを保存できません'; return; }
  const t = new Date(L.at);
  const time = isNaN(t) ? '' : t.toLocaleString('ja-JP', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
  el.innerHTML = '最終更新 <b></b>　<span></span>';
  const b = el.querySelector('b');
  b.textContent = time + (L.by && names[L.by] ? '・' + names[L.by] : '');
  el.querySelector('span').textContent = L.text || '';
  if (L.by && !names[L.by] && me?.profiles){
    try{ const ps = await me.profiles([L.by]); const n = ps?.[L.by]?.name; if (n){ names[L.by] = n; b.textContent = time + '・' + n; } }catch(e){}
  }
}
function applyMode(){
  const pill = document.getElementById('mode-pill');
  if (!db){ pill.className = 'pill err'; pill.textContent = '保存できません'; }
  else if (canWrite){ pill.className = 'pill live'; pill.textContent = 'この端末に保存中'; }
  else { pill.className = 'pill ro'; pill.textContent = '閲覧のみ'; }
  const off = !canWrite || !CFG;
  document.querySelectorAll('[data-write],[data-pin],[data-unpin],[data-abs],[data-hr],[data-del],[data-edit-job],[data-edit-fam],[data-del-fam],[data-edit-st],#famform input,#famform button,#jobform input,#jobform select,#jobform button,#stform input,#stform select,#stform button,#io-file,#io-apply,#bk-file,#bk-apply').forEach(el => {
    if (off) el.disabled = true;
    else if (!el.hasAttribute('data-blocked')) el.disabled = false;
  });
  document.getElementById('btn-share').disabled = !C || !C.jobs.length;
  document.getElementById('io-export').disabled = !C || !C.jobs.length;
}
function renderStats(){
  const total = C.jobs.length;
  const done = C.jobs.filter(j => C.byId[DAY.assign[j.id]]).length;
  const sc = C.jobs.filter(j => C.byId[DAY.assign[j.id]]).map(j => score(C, C.byId[DAY.assign[j.id]], j, DAY.assign).total);
  const avg = sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : 0;
  document.getElementById('stats').innerHTML =
    `<div class="stat"><span class="k">${dateLabel(date)}の施術枠</span><span class="v">${total}<small>件・${DAY.families.length}組</small></span></div>
     <div class="stat"><span class="k">割り当て済み</span><span class="v">${done}<small>件</small></span></div>
     <div class="stat ${total - done ? 'alert' : ''}"><span class="k">担当が決まらない枠</span><span class="v">${total - done}<small>件</small></span></div>
     <div class="stat"><span class="k">平均マッチ度・出勤者</span><span class="v">${avg}<small>点 ・ ${C.staff.filter(s => !s.absent).length}人</small></span></div>`;
}
function renderLegend(){
  const fams = Object.values(C.fam);
  document.getElementById('legend').innerHTML = (fams.length
    ? fams.map(f => `<span><i class="sw" style="background:${f.color}"></i>${esc(f.name)}${f.time ? '（' + esc(f.time) + ' 挙式）' : ''}</span>`).join('')
    : '<span>この日のご家族はまだ登録されていません</span>')
    + `<span><i class="sw" style="background:repeating-linear-gradient(135deg,var(--muted) 0 2px,transparent 2px 4px)"></i>勤務時間外</span><span>ブロックを押すと候補と理由を表示</span>`;
}
function lanePos(s, e){ const a = Math.max(s, DAY_START), b = Math.min(e, DAY_END); return `left:${(a - DAY_START) * PPM}px;width:${Math.max(18, (b - a) * PPM - 2)}px`; }
function gridlines(){ let h = ''; for (let t = DAY_START; t <= DAY_END; t += 60) h += `<i class="gridline" style="left:${(t - DAY_START) * PPM}px"></i>`; return h; }
function block(j, un){
  const f = famOf(C, j);
  const style = lanePos(jS(j), jE(j)) + (un ? '' : `;background:${f.color}`);
  return `<button class="blk${un ? ' un' : ''}${DAY.pins[j.id] ? ' pinned' : ''}${selected === j.id ? ' sel' : ''}" style="${style}" data-job="${j.id}" title="${esc(f.name + ' ' + j.person + '｜' + j.svc + ' ' + j.start + '〜' + hm(jE(j)))}">
    <span class="t">${esc(j.start)}–${hm(jE(j))}</span><span class="n">${esc(j.person)}・${esc(j.svc)}</span></button>`;
}
function renderGantt(){
  const g = document.getElementById('gantt');
  if (!C.staff.length){ g.innerHTML = '<div class="empty"><b>スタッフが登録されていません</b><span>「スタッフ」タブで追加するか、「Excel」タブから取り込んでください。</span></div>'; return; }
  const W = (DAY_END - DAY_START) * PPM;
  let h = `<div class="g-head"><div class="who"><span>スタッフ</span></div><div class="lane" style="width:${W}px">`;
  for (let t = DAY_START; t <= DAY_END; t += 60) h += `<span class="tick" style="left:${Math.min(Math.max((t - DAY_START) * PPM, 16), W - 16)}px">${t / 60}:00</span>`;
  h += `</div></div>`;
  if (!C.jobs.length) h += `<div class="g-row"><div class="who"><b>施術枠なし</b><span>${dateLabel(date)}</span></div><div class="lane" style="width:${W}px"><p class="note" style="padding:20px 16px;margin:0">この日の施術枠はまだありません。「予定・施術」タブでご家族と施術枠を登録してください。</p></div></div>`;
  const un = C.jobs.filter(j => !C.byId[DAY.assign[j.id]]);
  if (un.length) h += `<div class="g-row tray"><div class="who"><b>担当未定</b><span>${un.length}件・要対応</span></div><div class="lane" style="width:${W}px">${gridlines()}${un.map(j => block(j, true)).join('')}</div></div>`;
  for (const role of ['make', 'kitsuke']){
    for (const st of C.staff.filter(s => s.role === role)){
      const mine = C.jobs.filter(j => DAY.assign[j.id] === st.id);
      let lane = gridlines();
      if (st.absent) lane += `<i class="off" style="left:0;width:${W}px"></i>`;
      else {
        if (m(st.start) > DAY_START) lane += `<i class="off" style="left:0;width:${Math.min(W, (m(st.start) - DAY_START) * PPM)}px"></i>`;
        if (m(st.end) < DAY_END) lane += `<i class="off" style="left:${Math.max(0, (m(st.end) - DAY_START) * PPM)}px;width:${Math.min(W, (DAY_END - m(st.end)) * PPM)}px"></i>`;
      }
      lane += mine.map(j => block(j)).join('');
      h += `<div class="g-row ${st.absent ? 'absent' : ''}"><div class="who"><b>${esc(st.name)}</b><span>${ROLE[st.role]}・Lv.${esc(st.level)}・${st.absent ? '欠勤' : mine.length + '件'}</span></div><div class="lane" style="width:${W}px">${lane}</div></div>`;
    }
  }
  g.innerHTML = h;
}
const cls = n => n >= 80 ? 'hi' : n >= 60 ? 'mid' : 'lo';
function renderPanel(){
  const p = document.getElementById('panel');
  const j = C.jobById[selected];
  if (!j){ p.innerHTML = '<p class="note">シフト表のブロックを押すと、候補のスタッフと理由が出ます。</p>'; return; }
  const sp = spec(j), f = famOf(C, j);
  const cur = C.byId[DAY.assign[j.id]];
  let h = `<div><div class="sec-title" style="color:${f.color}">${esc(f.name)}</div><h2>${esc(j.person)}　${esc(j.svc)}</h2></div>
    <dl class="meta"><dt>時間</dt><dd style="font-family:var(--mono)">${esc(j.start)}〜${hm(jE(j))}（${esc(j.dur)}分）</dd>
    <dt>必要</dt><dd><div class="chips">${sp.skills.map(k => `<span class="chip need">${esc(k)}</span>`).join('')}<span class="chip">Lv.${sp.min}以上</span></div></dd>
    ${j.pref ? `<dt>指名</dt><dd>${esc(C.byId[j.pref]?.name || '（削除されたスタッフ）')}</dd>` : ''}
    ${j.en ? `<dt>要望</dt><dd>英語対応</dd>` : ''}
    ${j.note ? `<dt>メモ</dt><dd>${esc(j.note)}</dd>` : ''}</dl>`;
  if (cur){
    const s = score(C, cur, j, DAY.assign);
    h += `<div class="notice ok">担当：<b>${esc(cur.name)}</b>　マッチ度 ${s.total}点${DAY.pins[j.id] ? '（手動で固定中）' : ''}</div>
      <div class="breakdown">${s.parts.map(([k, v]) => `<div><span>${esc(k)}</span><span>${v > 0 ? '+' : ''}${v}</span></div>`).join('')}</div>`;
  } else h += `<div class="notice bad"><b>担当が決まっていません。</b><br>${esc(unassignedReason(C, j))}。開始時間をずらすか、外部スタッフの手配を検討してください。</div>`;
  const others = Object.assign({}, DAY.assign); delete others[j.id];
  const rows = C.staff.map(st => {
    const ft = fit(st, j); if (ft.hide) return null;
    let why = '', canUse = ft.ok, sc = null;
    if (ft.ok){
      const c = conflictFor(C, st.id, j, others);
      if (c){ canUse = false; why = '時間が重なる：' + famOf(C, c).name + ' ' + c.person + ' ' + c.start + '〜'; }
      sc = score(C, st, j, others).total;
    } else why = ft.why;
    return {st, canUse, why, sc};
  }).filter(Boolean).sort((a, b) => (b.canUse - a.canUse) || ((b.sc ?? -1) - (a.sc ?? -1)));
  h += `<div class="sec-title">候補スタッフ（${ROLE[sp.role]}）</div><div class="cands">`;
  for (const r of rows){
    const isCur = cur && r.st.id === cur.id;
    h += `<div class="cand ${isCur ? 'current' : ''}"><div class="score ${r.sc == null ? 'lo' : cls(r.sc)}">${r.sc == null ? '—' : r.sc}</div>
      <div style="min-width:0"><div class="nm">${esc(r.st.name)}<span class="note">　Lv.${esc(r.st.level)}・評価${(Number(r.st.rating) || 0).toFixed(1)}</span></div>
      <div class="why">${isCur ? '現在の担当' : r.canUse ? '空いていて条件を満たしています' : esc(r.why)}</div></div>
      ${isCur ? (DAY.pins[j.id] ? `<button data-unpin="${j.id}">固定を外す</button>` : `<button data-pin="${j.id}" data-staff="${r.st.id}">固定する</button>`) : `<button data-pin="${j.id}" data-staff="${r.st.id}" ${r.canUse ? '' : 'disabled data-blocked'}>この人に変更</button>`}</div>`;
  }
  if (!rows.length) h += '<p class="note">この担当のスタッフが登録されていません。</p>';
  h += `</div><div class="actions"><button class="small" data-edit-job="${j.id}">この枠を編集</button><button class="small danger" data-del="${j.id}">この枠を削除</button></div>
    <p class="note">「この人に変更」は手動で固定され、自動割り当てをやり直してもそのまま残ります。</p>`;
  p.innerHTML = h;
}
function renderJobs(){
  let h = '';
  if (!DAY.families.length) h = '<div class="empty"><b>この日のご家族はまだ登録されていません</b><span>上の「ご家族を登録」から追加すると、施術枠を登録できるようになります。</span></div>';
  for (const f0 of DAY.families){
    const f = C.fam[f0.id];
    const list = C.jobs.filter(j => j.fam === f.id).sort((a, b) => jS(a) - jS(b));
    h += `<div class="famhead"><i class="sw" style="background:${f.color}"></i>${esc(f.name)}<span class="sub">${f.time ? esc(f.time) + ' 挙式・' : ''}${f.memo ? esc(f.memo) + '・' : ''}${list.length}件</span>
      <span style="flex:1"></span><button class="small" data-edit-fam="${f.id}">編集</button><button class="small danger" data-del-fam="${f.id}">ご家族ごと削除</button></div>`;
    if (!list.length){ h += '<p class="note" style="padding:0 16px 12px;margin:0">施術枠はまだありません。</p>'; continue; }
    h += `<div class="tbl-scroll"><table><thead><tr><th>時間</th><th>お客様</th><th>メニュー</th><th>担当</th><th>マッチ度</th><th></th></tr></thead><tbody>`;
    for (const j of list){
      const st = C.byId[DAY.assign[j.id]];
      const sc = st ? score(C, st, j, DAY.assign).total : null;
      h += `<tr><td class="num">${esc(j.start)}–${hm(jE(j))}</td><td>${esc(j.person)}${j.en ? ' <span class="chip">英語</span>' : ''}</td><td>${esc(j.svc)}</td>
        <td>${st ? esc(st.name) + (DAY.pins[j.id] ? ' <span class="chip">固定</span>' : '') : '<span class="status bad">未定</span>'}</td>
        <td class="num">${sc == null ? '—' : `<span class="score ${cls(sc)}" style="font-size:15px">${sc}</span>`}</td>
        <td><div class="actions" style="flex-wrap:nowrap"><button class="small" data-open="${j.id}">候補</button><button class="small" data-edit-job="${j.id}">編集</button><button class="small danger" data-del="${j.id}">削除</button></div></td></tr>`;
    }
    h += `</tbody></table></div>`;
  }
  document.getElementById('jobs').innerHTML = h;
}
function renderStaff(){
  let h = `<thead><tr><th>名前</th><th>担当</th><th>レベル・評価</th><th>できる技術</th><th>この日の勤務</th><th>件数</th><th>この日</th><th></th></tr></thead><tbody>`;
  if (!C.staff.length) h += `<tr><td colspan="8" class="note">スタッフはまだいません。「スタッフを追加」から登録してください。</td></tr>`;
  for (const st of C.staff){
    h += `<tr><td><b>${esc(st.name)}</b>${st.en ? ' <span class="chip">英語</span>' : ''}</td><td>${ROLE[st.role] || ''}</td>
      <td class="num">Lv.${esc(st.level)}・${(Number(st.rating) || 0).toFixed(1)}</td>
      <td><div class="chips">${(st.skills || []).map(k => `<span class="chip">${esc(k)}</span>`).join('')}</div></td>
      <td class="num"><input type="time" id="hr-s-${st.id}" data-hr="${st.id}" data-k="start" value="${esc(st.start)}" step="900" aria-label="${esc(st.name)}の開始"> 〜 <input type="time" id="hr-e-${st.id}" data-hr="${st.id}" data-k="end" value="${esc(st.end)}" step="900" aria-label="${esc(st.name)}の終了"></td>
      <td class="num">${loadOf(st.id, DAY.assign)}件</td>
      <td><label class="switch"><input type="checkbox" id="abs-${st.id}" data-abs="${st.id}" ${st.absent ? 'checked' : ''}>欠勤</label></td>
      <td><button class="small" data-edit-st="${st.id}">編集</button></td></tr>`;
  }
  document.getElementById('staff').innerHTML = h + '</tbody>';
}
function renderForms(){
  const fs = document.getElementById('f-fam'), keepF = fs.value;
  fs.innerHTML = DAY.families.length ? DAY.families.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('') : '<option value="">先にご家族を登録</option>';
  if (DAY.families.some(f => f.id === keepF)) fs.value = keepF;
  const sv = document.getElementById('f-svc');
  if (!sv.options.length){ sv.innerHTML = Object.keys(SERVICES).map(k => `<option>${esc(k)}</option>`).join(''); document.getElementById('f-dur').value = SERVICES[sv.value].dur; }
  fillPref();
  document.getElementById('io-menus').innerHTML = Object.entries(SERVICES).map(([k, s]) => `<span class="chip">${esc(k)}（${s.dur}分）</span>`).join('');
}
function fillPref(){
  const sel = document.getElementById('f-pref'), keep = sel.value;
  const role = SERVICES[document.getElementById('f-svc').value]?.role || 'make';
  sel.innerHTML = '<option value="">なし</option>' + (CFG?.staff || []).filter(s => s.role === role).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
}

/* ===== 操作：日付・シフト ===== */
let toastTimer;
function toast(t){ const el = document.getElementById('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 3800); }
function setView(v){
  view = v;
  for (const k of ['shift', 'jobs', 'staff', 'io']){
    document.getElementById('view-' + k).hidden = k !== v;
    document.getElementById('tab-' + k).setAttribute('aria-selected', k === v);
  }
  try{ localStorage.setItem('bridal-shift-tab', v); }catch(e){}
}
for (const k of ['shift', 'jobs', 'staff', 'io']) document.getElementById('tab-' + k).onclick = () => setView(k);
function setDate(d){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return;
  date = d; selected = null; resetJobForm(); resetFamForm();
  refresh(); render();
  try{ localStorage.setItem('bridal-shift-date', d); }catch(e){}
}
document.getElementById('d-date').addEventListener('change', e => setDate(e.target.value));
function shiftDate(n){ const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + n); setDate(ymd(d)); }
document.getElementById('d-prev').onclick = () => shiftDate(-1);
document.getElementById('d-next').onclick = () => shiftDate(1);
document.getElementById('btn-solve').onclick = () => { DAY.assign = solve(C, DAY.pins); commitDay('自動で割り当て直しました（手動の固定はそのまま）'); };
document.getElementById('btn-unpin').onclick = () => { DAY.pins = {}; C = buildCtx(DAY); DAY.assign = solve(C, {}); commitDay('手動の固定を外して割り当て直しました'); };

/* 削除などは2回押して確定 */
const armed = new Map();
function confirmClick(btn, label, fn){
  if (armed.get(btn)){ armed.delete(btn); fn(); return; }
  armed.set(btn, btn.textContent);
  btn.textContent = label; btn.classList.add('armed');
  setTimeout(() => { if (armed.has(btn)){ btn.textContent = armed.get(btn); armed.delete(btn); btn.classList.remove('armed'); } }, 3500);
}
document.addEventListener('click', e => {
  const t = e.target;
  const dc = t.closest('[data-day]'); if (dc){ setDate(dc.dataset.day); return; }
  const b = t.closest('[data-job]'); if (b){ selected = b.dataset.job; renderGantt(); renderPanel(); applyMode(); return; }
  const o = t.closest('[data-open]'); if (o){ selected = o.dataset.open; setView('shift'); renderGantt(); renderPanel(); applyMode(); return; }
  const p = t.closest('[data-pin]');
  if (p){
    const jid = p.dataset.pin, sid = p.dataset.staff, prev = DAY.assign[jid];
    DAY.pins[jid] = sid; DAY.assign[jid] = sid;
    if (prev !== sid) DAY.assign = solve(C, Object.assign({}, DAY.assign, DAY.pins));
    const j = C.jobById[jid];
    commitDay(famOf(C, j).name + ' ' + j.person + 'の' + j.svc + 'を' + C.byId[sid].name + 'さんに' + (prev !== sid ? '変更' : '固定'));
    return;
  }
  const u = t.closest('[data-unpin]'); if (u){ delete DAY.pins[u.dataset.unpin]; commitDay('担当の固定を外しました'); return; }
  const d = t.closest('[data-del]');
  if (d){
    const jid = d.dataset.del, j = C.jobById[jid];
    confirmClick(d, '本当に削除', () => {
      DAY.jobs = DAY.jobs.filter(x => x.id !== jid); delete DAY.assign[jid]; delete DAY.pins[jid];
      if (selected === jid) selected = null;
      if (editJob === jid) resetJobForm();
      commitDay('施術枠を削除：' + famOf(C, j).name + ' ' + j.person + ' ' + j.svc);
    });
    return;
  }
  const ej = t.closest('[data-edit-job]'); if (ej){ startEditJob(ej.dataset.editJob); return; }
  const ef = t.closest('[data-edit-fam]'); if (ef){ startEditFam(ef.dataset.editFam); return; }
  const df = t.closest('[data-del-fam]');
  if (df){
    const fid = df.dataset.delFam, f = C.fam[fid];
    confirmClick(df, '施術枠ごと削除', () => {
      const ids = DAY.jobs.filter(j => j.fam === fid).map(j => j.id);
      DAY.families = DAY.families.filter(x => x.id !== fid);
      DAY.jobs = DAY.jobs.filter(j => j.fam !== fid);
      for (const id of ids){ delete DAY.assign[id]; delete DAY.pins[id]; }
      if (ids.includes(selected)) selected = null;
      if (editFam === fid) resetFamForm();
      commitDay(f.name + 'を削除（施術枠' + ids.length + '件）');
    });
    return;
  }
  const es = t.closest('[data-edit-st]'); if (es){ openStaffEditor(es.dataset.editSt); return; }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.abs){
    const id = t.dataset.abs, st = C.byId[id];
    if (t.checked){ DAY.absent[id] = true; for (const jid in DAY.pins) if (DAY.pins[jid] === id) delete DAY.pins[jid]; }
    else delete DAY.absent[id];
    const before = Object.keys(DAY.assign).filter(jid => DAY.assign[jid] === id);
    C = buildCtx(DAY);
    DAY.assign = reflow(C);
    const lost = before.filter(jid => !DAY.assign[jid]).length;
    commitDay(st.name + 'さんを' + (t.checked ? '欠勤に' + (before.length ? '：' + before.length + '件を組み直し' + (lost ? '（担当未定' + lost + '件）' : '') : '') : '出勤に戻しました'));
    return;
  }
  if (t.dataset.hr && t.value){
    const id = t.dataset.hr, base = CFG.staff.find(s => s.id === id);
    const h = Object.assign({start: base.start, end: base.end}, DAY.hours[id] || {});
    h[t.dataset.k] = t.value;
    if (h.start === base.start && h.end === base.end) delete DAY.hours[id]; else DAY.hours[id] = h;
    C = buildCtx(DAY);
    DAY.assign = reflow(C);
    commitDay(base.name + 'さんの' + dateLabel(date) + 'の勤務を' + h.start + '〜' + h.end + 'に変更');
    return;
  }
  if (t.id === 'f-svc'){ if (!editJob) document.getElementById('f-dur').value = SERVICES[t.value].dur; fillPref(); }
  if (t.id === 'se-role') renderSkillBoxes(t.value, []);
});

/* ===== 操作：ご家族 ===== */
function resetFamForm(){
  editFam = null;
  document.getElementById('famform').reset();
  document.getElementById('fm-time').value = '12:00';
  document.getElementById('fam-form-title').textContent = 'ご家族を登録';
  document.getElementById('fm-submit').textContent = '登録する';
  document.getElementById('fm-cancel').hidden = true;
}
function startEditFam(fid){
  const f = DAY.families.find(x => x.id === fid); if (!f) return;
  editFam = fid; setView('jobs');
  document.getElementById('fm-name').value = f.name;
  document.getElementById('fm-time').value = f.time || '';
  document.getElementById('fm-memo').value = f.memo || '';
  document.getElementById('fam-form-title').textContent = f.name + 'を編集';
  document.getElementById('fm-submit').textContent = '保存する';
  document.getElementById('fm-cancel').hidden = false;
  document.getElementById('famform').scrollIntoView({block:'nearest'});
}
document.getElementById('fm-cancel').onclick = resetFamForm;
document.getElementById('famform').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('fm-name').value.trim(); if (!name) return;
  const data = {name, time: document.getElementById('fm-time').value, memo: document.getElementById('fm-memo').value.trim()};
  if (editFam){
    Object.assign(DAY.families.find(x => x.id === editFam), data);
    resetFamForm(); commitDay(name + 'の情報を更新');
  } else {
    const f = {id: uidGen('f'), ...data};
    DAY.families.push(f);
    resetFamForm(); commitDay(dateLabel(date) + 'に' + name + 'を登録');
    document.getElementById('f-fam').value = f.id;
  }
});

/* ===== 操作：施術枠 ===== */
function resetJobForm(){
  editJob = null;
  const fs = document.getElementById('f-fam'), keepFam = fs.value;
  document.getElementById('jobform').reset();
  fs.value = keepFam;
  const sv = document.getElementById('f-svc').value;
  document.getElementById('f-dur').value = SERVICES[sv]?.dur || 40;
  document.getElementById('job-form-title').textContent = '施術枠を追加';
  document.getElementById('f-submit').textContent = '追加して割り当て';
  document.getElementById('f-cancel').hidden = true;
}
function startEditJob(jid){
  const j = DAY.jobs.find(x => x.id === jid); if (!j) return;
  setView('jobs'); editJob = jid;
  document.getElementById('f-fam').value = j.fam;
  document.getElementById('f-person').value = j.person;
  document.getElementById('f-svc').value = j.svc;
  fillPref();
  document.getElementById('f-start').value = j.start;
  document.getElementById('f-dur').value = j.dur;
  document.getElementById('f-pref').value = j.pref || '';
  document.getElementById('f-note').value = j.note || '';
  document.getElementById('f-en').checked = !!j.en;
  document.getElementById('job-form-title').textContent = '施術枠を編集';
  document.getElementById('f-submit').textContent = '保存して割り当て直す';
  document.getElementById('f-cancel').hidden = false;
  document.getElementById('jobform').scrollIntoView({block:'nearest'});
}
document.getElementById('f-cancel').onclick = resetJobForm;
document.getElementById('jobform').addEventListener('submit', e => {
  e.preventDefault();
  const fam = document.getElementById('f-fam').value;
  if (!fam){ toast('先に「ご家族を登録」からご家族を追加してください'); return; }
  const data = {
    fam, person: document.getElementById('f-person').value.trim() || 'ご親族',
    svc: document.getElementById('f-svc').value, start: document.getElementById('f-start').value,
    dur: Math.max(10, Number(document.getElementById('f-dur').value) || 30),
    pref: document.getElementById('f-pref').value, en: document.getElementById('f-en').checked,
    note: document.getElementById('f-note').value.trim()
  };
  let j, verb;
  if (editJob){ j = DAY.jobs.find(x => x.id === editJob); Object.assign(j, data); verb = '施術枠を変更'; delete DAY.pins[j.id]; delete DAY.assign[j.id]; }
  else { j = {id: uidGen('j'), ...data}; DAY.jobs.push(j); verb = '施術枠を追加'; }
  C = buildCtx(DAY);
  DAY.assign = reflow(C);
  selected = j.id; resetJobForm();
  C = buildCtx(DAY);
  const st = C.byId[DAY.assign[j.id]];
  const note = verb + '：' + famOf(C, j).name + ' ' + j.person + ' ' + j.svc;
  commitDay(note, st ? `${note}（${st.name}さん・${score(C, st, j, DAY.assign).total}点）` : note + '（担当できるスタッフが見つかりません）');
});

/* ===== 操作：スタッフ ===== */
function renderSkillBoxes(role, have){
  document.getElementById('se-skills').innerHTML = SKILLS[role].map((k, i) => `<label><input type="checkbox" id="sk-${role}-${i}" value="${esc(k)}" ${have.includes(k) ? 'checked' : ''}>${esc(k)}</label>`).join('');
}
function openStaffEditor(id){
  editStaff = id || null;
  const s = id ? CFG.staff.find(x => x.id === id) : {name:'', role:'make', level:3, rating:4.5, start:'09:00', end:'18:00', skills:[], en:false};
  if (!s) return;
  setView('staff');
  document.getElementById('st-editor').hidden = false;
  document.getElementById('st-ed-title').textContent = id ? s.name + 'さんを編集' : 'スタッフを追加';
  document.getElementById('se-name').value = s.name;
  document.getElementById('se-role').value = s.role;
  document.getElementById('se-level').value = s.level;
  document.getElementById('se-rating').value = s.rating;
  document.getElementById('se-start').value = s.start;
  document.getElementById('se-end').value = s.end;
  document.getElementById('se-en').checked = !!s.en;
  renderSkillBoxes(s.role, s.skills || []);
  const del = document.getElementById('se-delete'); del.hidden = !id; del.textContent = 'このスタッフを削除'; del.classList.remove('armed'); armed.delete(del);
  applyMode();
  document.getElementById('st-editor').scrollIntoView({block:'nearest'});
}
document.getElementById('st-new').onclick = () => openStaffEditor(null);
document.getElementById('se-cancel').onclick = () => { document.getElementById('st-editor').hidden = true; editStaff = null; };
/* スタッフの変更は全日共通なので、登録されているすべての日の担当を見直す */
function afterStaffChange(note){
  saveCfg(note);
  let changed = 0;
  for (const d of Object.keys(DAYS)){
    const day = normDay(clone(DAYS[d]));
    if (!day.jobs.length) continue;
    const ctx = buildCtx(day);
    for (const jid in day.pins) if (!ctx.byId[day.pins[jid]]) delete day.pins[jid];
    const next = reflow(ctx);
    if (JSON.stringify(next) !== JSON.stringify(day.assign)){
      day.assign = next; day.date = d; day.last = stamp(note + '（担当を見直し）');
      DAYS[d] = day; changed++;
      writeDoc('days/' + d, () => DAYS[d]);
    }
  }
  refresh(); render();
  toast(note + (changed ? '・' + changed + '日分の担当を見直しました' : ''));
}
document.getElementById('stform').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('se-name').value.trim(); if (!name) return;
  const data = {
    name, role: document.getElementById('se-role').value,
    level: Math.max(1, Math.min(5, Math.round(Number(document.getElementById('se-level').value) || 3))),
    rating: Math.max(1, Math.min(5, Number(document.getElementById('se-rating').value) || 4.5)),
    start: document.getElementById('se-start').value || '09:00', end: document.getElementById('se-end').value || '18:00',
    skills: [...document.querySelectorAll('#se-skills input:checked')].map(i => i.value),
    en: document.getElementById('se-en').checked
  };
  const note = editStaff ? name + 'さんの情報を更新' : name + 'さんを追加';
  if (editStaff) Object.assign(CFG.staff.find(x => x.id === editStaff), data);
  else CFG.staff.push({id: uidGen('s'), ...data});
  document.getElementById('st-editor').hidden = true; editStaff = null;
  afterStaffChange(note);
});
document.getElementById('se-delete').addEventListener('click', e => {
  const id = editStaff; if (!id) return;
  const st = CFG.staff.find(x => x.id === id);
  confirmClick(e.currentTarget, '本当に削除（担当は外れます）', () => {
    CFG.staff = CFG.staff.filter(x => x.id !== id);
    document.getElementById('st-editor').hidden = true; editStaff = null;
    afterStaffChange(st.name + 'さんを削除');
  });
});

/* ===== LINEで送る ===== */
function shiftText(){
  const lines = ['【婚礼美容シフト ' + dateLabel(date) + '】'];
  for (const role of ['make', 'kitsuke']){
    const list = C.staff.filter(s => s.role === role); if (!list.length) continue;
    lines.push('', '＜' + ROLE[role] + '＞');
    for (const st of list){
      if (st.absent){ lines.push('■' + st.name + '（欠勤）'); continue; }
      const mine = C.jobs.filter(j => DAY.assign[j.id] === st.id).sort((a, b) => jS(a) - jS(b));
      lines.push('■' + st.name + '（' + st.start + '〜' + st.end + '）' + (mine.length ? '' : '担当なし'));
      for (const j of mine) lines.push('・' + j.start + '〜' + hm(jE(j)) + ' ' + famOf(C, j).name + ' ' + j.person + ' ' + j.svc);
    }
  }
  const un = C.jobs.filter(j => !C.byId[DAY.assign[j.id]]).sort((a, b) => jS(a) - jS(b));
  if (un.length){ lines.push('', '⚠担当未定（' + un.length + '件）'); for (const j of un) lines.push('・' + j.start + '〜' + hm(jE(j)) + ' ' + famOf(C, j).name + ' ' + j.person + ' ' + j.svc); }
  return lines.join('\n');
}
function openShare(){
  if (!C || !C.jobs.length) return;
  const t = shiftText();
  document.getElementById('share-text').value = t;
  document.getElementById('share-line').href = 'https://line.me/R/share?text=' + encodeURIComponent(t);
  document.getElementById('copy-msg').textContent = '';
  const box = document.getElementById('sharebox'); box.hidden = false; box.scrollIntoView({block:'nearest'});
}
document.getElementById('btn-share').onclick = openShare;
document.getElementById('btn-share-close').onclick = () => { document.getElementById('sharebox').hidden = true; };
document.getElementById('btn-copy').onclick = () => {
  const ta = document.getElementById('share-text'), msg = document.getElementById('copy-msg');
  const fallback = () => { ta.focus(); ta.select(); msg.textContent = '文面を選択しました。長押し（または右クリック）でコピーしてください'; };
  try{ navigator.clipboard.writeText(ta.value).then(() => { msg.textContent = 'コピーしました。LINEのトークに貼り付けてください'; }, fallback); }catch(e){ fallback(); }
};

/* ===== Excel ===== */
const STAFF_HEAD = ['名前','担当','レベル','評価','技術','開始','終了','英語'];
const JOB_HEAD = ['日付','ご家族','挙式時間','お客様','メニュー','開始','所要分','指名','英語','メモ'];
async function saveWorkbook(rowsStaff, jobHead, rowsJobs, filename){
  if (typeof XLSX === 'undefined'){ toast('Excelの機能を読み込めませんでした。通信を確認してページを開き直してください'); return; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([STAFF_HEAD, ...rowsStaff]), 'スタッフ');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([jobHead, ...rowsJobs]), '施術');
  const data = new Uint8Array(XLSX.write(wb, {bookType:'xlsx', type:'array'}));
  try{ downloadFile(filename, data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); }
  catch(e){ toast('ファイルを保存できませんでした'); }
}
const staffRow = s => [s.name, s.role === 'kitsuke' ? '着付け' : 'メイク', s.level, s.rating, (s.skills || []).join('、'), s.start, s.end, s.en ? '○' : ''];
document.getElementById('io-template').onclick = () => saveWorkbook(
  [['山田 花子','メイク',4,4.6,'和装メイク、日本髪・かつら、ヘアセット','07:00','16:00',''],['田中 恵','着付け',3,4.4,'留袖、振袖、紋付袴','08:00','18:00','○']],
  JOB_HEAD,
  [[date,'森田家','10:00','新婦','和装メイク・かつら','07:00',90,'山田 花子','','前撮りも担当'],[date,'森田家','10:00','新婦母','留袖着付け','08:00',40,'','','']],
  'シフト取り込みテンプレート.xlsx');
document.getElementById('io-export').onclick = () => {
  if (!C || !C.jobs.length) return;
  const rows = C.jobs.slice().sort((a, b) => jS(a) - jS(b)).map(j => {
    const f = famOf(C, j);
    return [date, f.name, f.time || '', j.person, j.svc, j.start, Number(j.dur), C.byId[j.pref]?.name || '', j.en ? '○' : '', j.note || '', C.byId[DAY.assign[j.id]]?.name || '未定'];
  });
  saveWorkbook((CFG.staff || []).map(staffRow), [...JOB_HEAD, '担当'], rows, 'シフト_' + date + '.xlsx');
};
function cellTime(v){
  if (v == null || v === '') return '';
  if (typeof v === 'number') return hm(Math.round((v % 1) * 1440) % 1440);
  const s = String(v).trim().replace('：', ':');
  const mt = s.match(/^(\d{1,2})[:時](\d{1,2})?/); if (!mt) return '';
  return String(mt[1]).padStart(2, '0') + ':' + String(mt[2] || '00').padStart(2, '0');
}
function cellDate(v){
  if (v == null || v === '') return '';
  if (typeof v === 'number'){ const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
  const s = String(v).trim().replace(/[年月\/.]/g, '-').replace('日', '');
  const mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (!mt) return '';
  return mt[1] + '-' + mt[2].padStart(2, '0') + '-' + mt[3].padStart(2, '0');
}
const yes = v => /^(○|〇|◯|1|yes|true|可|あり|y)$/i.test(String(v ?? '').trim());
function sheetRows(wb, nameHint, head0){
  const name = wb.SheetNames.find(n => n.includes(nameHint)) || wb.SheetNames.find(n => {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[n], {header:1})[0] || []; return r.map(String).includes(head0);
  });
  if (!name) return null;
  return XLSX.utils.sheet_to_json(wb.Sheets[name], {defval:'', raw:true});
}
document.getElementById('io-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  const out = document.getElementById('io-preview');
  if (!file) return;
  if (typeof XLSX === 'undefined'){ out.innerHTML = '<div class="notice bad">Excelの機能を読み込めませんでした。ページを開き直してください。</div>'; return; }
  try{
    const wb = XLSX.read(await file.arrayBuffer(), {type:'array'});
    importPlan = planImport(wb);
    showPlan(importPlan);
  }catch(err){ importPlan = null; out.innerHTML = '<div class="notice bad">ファイルを読み込めませんでした。Excel（.xlsx）か、テンプレートと同じ列のCSVを選んでください。</div>'; }
});
function planImport(wb){
  const plan = {staffNew:[], staffUpd:[], jobs:{}, errors:[], jobCount:0};
  const sr = sheetRows(wb, 'スタッフ', '名前') || [];
  const allSkills = [...SKILLS.make, ...SKILLS.kitsuke];
  const byName = new Map((CFG.staff || []).map(s => [s.name.replace(/\s/g, ''), s]));
  sr.forEach((r, i) => {
    const name = String(r['名前'] || '').trim(); if (!name) return;
    const role = /着付/.test(String(r['担当'])) ? 'kitsuke' : 'make';
    const raw = String(r['技術'] || '').split(/[、,，\/\n]+/).map(s => s.trim()).filter(Boolean);
    const known = raw.filter(s => allSkills.includes(s));
    const unknown = raw.filter(s => !allSkills.includes(s));
    if (unknown.length) plan.errors.push(`スタッフ ${i + 2}行目：技術「${unknown.join('・')}」は登録されていないため外しました`);
    const s = {name, role, level: Math.max(1, Math.min(5, Math.round(Number(r['レベル']) || 3))), rating: Math.max(1, Math.min(5, Number(r['評価']) || 4.5)),
      skills: [...new Set(known)], start: cellTime(r['開始']) || '09:00', end: cellTime(r['終了']) || '18:00', en: yes(r['英語'])};
    const ex = byName.get(name.replace(/\s/g, ''));
    if (ex) plan.staffUpd.push({id: ex.id, ...s}); else { const n = {id: uidGen('s'), ...s}; plan.staffNew.push(n); byName.set(name.replace(/\s/g, ''), n); }
  });
  const nameToId = new Map([...(CFG.staff || []), ...plan.staffNew].map(s => [s.name.replace(/\s/g, ''), s.id]));
  const jr = sheetRows(wb, '施術', 'メニュー') || [];
  jr.forEach((r, i) => {
    const row = i + 2;
    const d = cellDate(r['日付']), fam = String(r['ご家族'] || '').trim(), svc = String(r['メニュー'] || '').trim(), start = cellTime(r['開始']);
    if (!d && !fam && !svc) return;
    if (!d){ plan.errors.push(`施術 ${row}行目：日付が読めないため飛ばしました`); return; }
    if (!fam){ plan.errors.push(`施術 ${row}行目：ご家族が空のため飛ばしました`); return; }
    if (!SERVICES[svc]){ plan.errors.push(`施術 ${row}行目：メニュー「${svc}」が登録されていないため飛ばしました`); return; }
    if (!start){ plan.errors.push(`施術 ${row}行目：開始時間が読めないため飛ばしました`); return; }
    const prefName = String(r['指名'] || '').trim();
    const pref = nameToId.get(prefName.replace(/\s/g, '')) || '';
    if (prefName && !pref) plan.errors.push(`施術 ${row}行目：指名「${prefName}」がスタッフにいないため指名なしにしました`);
    (plan.jobs[d] || (plan.jobs[d] = [])).push({fam, famTime: cellTime(r['挙式時間']), person: String(r['お客様'] || 'ご親族').trim(), svc, start,
      dur: Math.max(10, Number(r['所要分']) || SERVICES[svc].dur), pref, en: yes(r['英語']), note: String(r['メモ'] || '').trim()});
    plan.jobCount++;
  });
  if (!sr.length && !jr.length) plan.errors.unshift('「スタッフ」「施術」のシートが見つからないか、中身が空です');
  return plan;
}
function showPlan(p){
  const days = Object.keys(p.jobs).sort();
  const nothing = !p.staffNew.length && !p.staffUpd.length && !p.jobCount;
  document.getElementById('io-preview').innerHTML = `
    <div class="notice ${nothing ? 'bad' : 'info'}"><b>取り込む内容</b><br>
      スタッフ：新規 ${p.staffNew.length}人・上書き ${p.staffUpd.length}人<br>
      施術枠：${p.jobCount}件${days.length ? '（' + days.map(d => dateLabel(d) + ' ' + p.jobs[d].length + '件').join('、') + '）' : ''}</div>
    ${p.errors.length ? `<div class="notice bad" style="margin-top:8px"><b>確認が必要な行（${p.errors.length}件）</b><br>${p.errors.slice(0, 12).map(esc).join('<br>')}${p.errors.length > 12 ? '<br>ほか' + (p.errors.length - 12) + '件' : ''}</div>` : ''}
    <div class="actions" style="margin-top:10px"><button class="primary" id="io-apply" ${nothing ? 'disabled data-blocked' : ''}>この内容で取り込む</button><button id="io-cancel">やめる</button></div>`;
  document.getElementById('io-cancel').onclick = () => { importPlan = null; document.getElementById('io-preview').innerHTML = ''; };
  document.getElementById('io-apply').onclick = applyImport;
  applyMode();
}
function applyImport(){
  const p = importPlan; if (!p || !canWrite) return;
  for (const u of p.staffUpd) Object.assign(CFG.staff.find(s => s.id === u.id), u);
  CFG.staff.push(...p.staffNew);
  const days = Object.keys(p.jobs).sort();
  for (const d of days){
    const day = normDay(DAYS[d] ? clone(DAYS[d]) : blankDay(d));
    for (const r of p.jobs[d]){
      let f = day.families.find(x => x.name === r.fam);
      if (!f){ f = {id: uidGen('f'), name: r.fam, time: r.famTime, memo: ''}; day.families.push(f); }
      else if (!f.time && r.famTime) f.time = r.famTime;
      day.jobs.push({id: uidGen('j'), fam: f.id, person: r.person, svc: r.svc, start: r.start, dur: r.dur, pref: r.pref, en: r.en, note: r.note});
    }
    day.sample = false; day.date = d; day.last = stamp('Excelから' + p.jobs[d].length + '件を取り込み');
    DAYS[d] = day;
  }
  const note = 'Excelから取り込み（スタッフ' + (p.staffNew.length + p.staffUpd.length) + '人・施術' + p.jobCount + '件）';
  importPlan = null;
  if (p.staffNew.length || p.staffUpd.length) saveCfg(note);
  for (const d of Object.keys(DAYS)){
    const day = normDay(clone(DAYS[d]));
    if (!day.jobs.length) continue;
    const next = reflow(buildCtx(day));
    if (days.includes(d) || JSON.stringify(next) !== JSON.stringify(day.assign)){
      day.assign = next; if (!days.includes(d)) day.last = stamp(note + '（担当を見直し）');
      DAYS[d] = day;
      writeDoc('days/' + d, () => DAYS[d]);
    }
  }
  document.getElementById('io-preview').innerHTML = `<div class="notice ok">${esc(note)}しました。</div>`;
  if (days.length && !days.includes(date)) setDate(days[0]); else { refresh(); render(); }
  toast(note + 'しました');
}

/* ===== バックアップ（全データをJSONで保存・復元） ===== */
document.getElementById('bk-export').onclick = () => {
  if (!db) return;
  downloadFile('婚礼美容シフト_バックアップ_' + ymd(new Date()) + '.json', JSON.stringify({app:'bridal-shift', version:1, data: db.dump()}, null, 2), 'application/json');
};
document.getElementById('bk-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file || !db) return;
  try{
    const json = JSON.parse(await file.text());
    if (json?.app !== 'bridal-shift' || !json.data || typeof json.data !== 'object') throw new Error('format');
    const n = Object.keys(json.data).filter(k => k.startsWith('days/')).length;
    const btn = document.getElementById('bk-apply');
    btn.hidden = false; btn.textContent = 'いまのデータを消して復元（' + n + '日分）';
    btn.onclick = () => confirmClick(btn, '本当に復元する', () => {
      db.restore(json.data); btn.hidden = true;
      refresh(); render(); toast('バックアップから復元しました');
    });
  }catch(err){ toast('バックアップファイルを読み込めませんでした'); }
});

/* ===== 起動 ===== */
(function initDate(){
  let d = ''; try{ d = localStorage.getItem('bridal-shift-date') || ''; }catch(e){}
  date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ymd(new Date());
  try{ const v = localStorage.getItem('bridal-shift-tab'); if (v && document.getElementById('view-' + v)) setView(v); }catch(e){}
})();
render();
(async () => {
  try{ localStorage.setItem('bridal-shift-probe', '1'); localStorage.removeItem('bridal-shift-probe'); db = LocalStore; }catch(e){ db = null; }
  canWrite = !!db;
  if (!db){ render(); return; }
  let firstDays = true;
  db.doc('settings/main').onSnapshot(snap => {
    CFG = snap.exists ? clone(snap.data()) : {staff: []};
    if (!Array.isArray(CFG.staff)) CFG.staff = [];
    refresh(); render();
  });
  db.collection('days').onSnapshot(qs => {
    const next = {};
    for (const d of qs.docs) next[d.id] = clone(d.data());
    DAYS = next; loadedDays = true;
    if (firstDays){
      firstDays = false;
      let saved = ''; try{ saved = localStorage.getItem('bridal-shift-date') || ''; }catch(e){}
      if (!saved || !DAYS[saved]){
        const today = ymd(new Date());
        const ds = Object.keys(DAYS).filter(d => (DAYS[d].jobs || []).length).sort();
        const pick = ds.find(d => d >= today) || ds[ds.length - 1];
        if (pick) date = pick;
      }
    }
    if (CFG){ refresh(); render(); if (!document.getElementById('sharebox').hidden) openShare(); }
  });
})();

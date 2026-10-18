/* ===== 保存先 =====
   app.js は db.doc(path).set / remove / onSnapshot と db.collection(name).onSnapshot だけを使う。
   firebase-config.js に設定があれば Firebase（全員で共有）、なければこの端末のブラウザに保存する。 */

/* --- この端末のブラウザに保存 --- */
const LocalStore = (() => {
  const PREFIX = 'bridal-shift:';
  const listeners = [];
  const key = path => PREFIX + path;
  function read(path){
    try{ const v = localStorage.getItem(key(path)); return v == null ? undefined : JSON.parse(v); }catch(e){ return undefined; }
  }
  function paths(){
    const out = [];
    try{ for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length)); } }catch(e){}
    return out;
  }
  function notify(){ for (const fn of listeners) fn(); }
  /* 別のタブで変更された時も表示を合わせる */
  window.addEventListener('storage', e => { if (!e.key || e.key.startsWith(PREFIX)) notify(); });

  function docSnap(path){ const d = read(path); return {id: path.split('/').pop(), exists: d !== undefined, data: () => d}; }
  function colSnap(name){
    const docs = paths().filter(p => p.startsWith(name + '/') && !p.slice(name.length + 1).includes('/')).sort().map(docSnap);
    return {docs};
  }
  return {
    kind: 'local',
    doc(path){
      return {
        async set(data){
          try{ localStorage.setItem(key(path), JSON.stringify(data)); }
          catch(e){ const err = new Error('quota'); err.code = 'quota_exceeded'; throw err; }
          notify();
        },
        async remove(){ localStorage.removeItem(key(path)); notify(); },
        onSnapshot(cb){ const fn = () => cb(docSnap(path)); listeners.push(fn); fn(); }
      };
    },
    collection(name){
      return { onSnapshot(cb){ const fn = () => cb(colSnap(name)); listeners.push(fn); fn(); } };
    }
  };
})();

/* --- Firebase（スタッフ全員で共有） --- */
const FB_VER = '10.14.1';
async function openFirebase(cfg){
  const base = 'https://www.gstatic.com/firebasejs/' + FB_VER + '/';
  const [{initializeApp}, A, F] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  /* 電波が弱い時も見られるように、端末にも控えを持つ */
  let fs;
  try{ fs = F.initializeFirestore(app, {localCache: F.persistentLocalCache({tabManager: F.persistentMultipleTabManager()})}); }
  catch(e){ fs = F.getFirestore(app); }

  const mapErr = e => {
    const err = new Error(e?.message || 'error');
    err.code = e?.code === 'permission-denied' ? 'invalid_argument' : e?.code === 'resource-exhausted' ? 'quota_exceeded' : e?.code;
    return err;
  };
  const wrap = s => ({id: s.id, exists: s.exists(), data: () => s.data()});
  const db = {
    kind: 'firebase',
    doc(path){
      const ref = F.doc(fs, path);
      return {
        async set(data){ try{ await F.setDoc(ref, data); }catch(e){ throw mapErr(e); } },
        async remove(){ try{ await F.deleteDoc(ref); }catch(e){ throw mapErr(e); } },
        onSnapshot(cb, err){ return F.onSnapshot(ref, s => cb(wrap(s)), err); }
      };
    },
    collection(name){
      return { onSnapshot(cb, err){ return F.onSnapshot(F.collection(fs, name), qs => cb({docs: qs.docs.map(wrap)}), err); } };
    }
  };

  const gate = document.getElementById('gate');
  const msg = document.getElementById('gate-msg');
  const loginBtn = document.getElementById('gate-login');
  const otherBtn = document.getElementById('gate-other');
  const lock = (text, isMember) => {
    document.body.classList.add('locked'); gate.hidden = false;
    msg.textContent = text; loginBtn.hidden = isMember; otherBtn.hidden = !isMember;
  };
  const signIn = async () => {
    const provider = new A.GoogleAuthProvider();
    provider.setCustomParameters({prompt: 'select_account'});
    try{ await A.signInWithPopup(auth, provider); }
    catch(e){
      if (e?.code === 'auth/popup-blocked') await A.signInWithRedirect(auth, provider);
      else if (e?.code !== 'auth/popup-closed-by-user' && e?.code !== 'auth/cancelled-popup-request') msg.textContent = 'ログインできませんでした（' + (e?.code || 'エラー') + '）';
    }
  };
  loginBtn.onclick = signIn;
  otherBtn.onclick = async () => { await A.signOut(auth); signIn(); };
  document.getElementById('btn-logout').onclick = async () => { await A.signOut(auth); location.reload(); };

  /* ログインして、メンバーに登録されている人だけ先へ進む */
  return new Promise(resolve => {
    let done = false;
    A.onAuthStateChanged(auth, async user => {
      if (done) return;
      if (!user){ lock('婚礼美容室のスタッフ用ページです。登録されたGoogleアカウントでログインしてください。', false); return; }
      try{
        await F.getDocFromServer(F.doc(fs, 'config/members'));
      }catch(e){
        if (e?.code === 'permission-denied'){ lock((user.email || 'このアカウント') + ' はまだメンバーに登録されていません。管理している人に「スタッフ」タブの「アプリを使える人」へ追加してもらってください。', true); return; }
        /* 電波がない時は端末の控えで開く */
      }
      done = true;
      document.body.classList.remove('locked'); gate.hidden = true;
      resolve({db, user: {name: user.displayName || user.email || '', email: (user.email || '').toLowerCase()}});
    });
  });
}

/* 起動時に呼ぶ：使う保存先を決める */
async function openStore(){
  if (window.FIREBASE_CONFIG){
    try{ return await openFirebase(window.FIREBASE_CONFIG); }
    catch(e){
      document.body.classList.add('locked');
      document.getElementById('gate').hidden = false;
      document.getElementById('gate-msg').textContent = '共有データに接続できませんでした。通信を確認して、ページを開き直してください。';
      document.getElementById('gate-login').hidden = true;
      return {db: null, user: null};
    }
  }
  try{ localStorage.setItem('bridal-shift-probe', '1'); localStorage.removeItem('bridal-shift-probe'); return {db: LocalStore, user: null}; }
  catch(e){ return {db: null, user: null}; }
}

/* ファイルをダウンロードさせる */
function downloadFile(filename, data, type){
  const url = URL.createObjectURL(new Blob([data], {type: type || 'application/octet-stream'}));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ===== 保存先（この端末のブラウザ） =====
   app.js は db.doc(path).set / onSnapshot と db.collection(name).onSnapshot だけを使う。
   同じ形のオブジェクトを返せば、あとでクラウドのデータベースに差し替えられる。 */
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
  const db = {
    doc(path){
      return {
        async set(data){
          try{ localStorage.setItem(key(path), JSON.stringify(data)); }
          catch(e){ const err = new Error('quota'); err.code = 'quota_exceeded'; throw err; }
          notify();
        },
        onSnapshot(cb){ const fn = () => cb(docSnap(path)); listeners.push(fn); fn(); }
      };
    },
    collection(name){
      return { onSnapshot(cb){ const fn = () => cb(colSnap(name)); listeners.push(fn); fn(); } };
    },
    /* バックアップ用：全データをまとめて出し入れする */
    dump(){ const out = {}; for (const p of paths()) out[p] = read(p); return out; },
    restore(all){
      for (const p of paths()) localStorage.removeItem(key(p));
      for (const p of Object.keys(all || {})) localStorage.setItem(key(p), JSON.stringify(all[p]));
      notify();
    }
  };
  return db;
})();

/* ファイルをダウンロードさせる */
function downloadFile(filename, data, type){
  const url = URL.createObjectURL(new Blob([data], {type: type || 'application/octet-stream'}));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

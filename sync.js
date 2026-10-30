/* Conexión con Firebase (Auth con Google + Firestore). Se carga solo si firebase-config.js está completo. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export function createTransport(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  let fs;
  try {
    // caché persistente: sigue funcionando sin internet y sube los cambios al reconectar
    fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    fs = getFirestore(app);
  }
  let unsub = null;
  const courses = uid => collection(fs, 'users', uid, 'courses');

  return {
    onAuth(cb) { return onAuthStateChanged(auth, cb); },
    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
          await signInWithRedirect(auth, provider);
        } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
          throw e;
        }
      }
    },
    signOut() { return signOut(auth); },
    listen(uid, onDocs, onError) {
      if (unsub) unsub();
      unsub = onSnapshot(courses(uid), { includeMetadataChanges: true }, snap => {
        onDocs(
          snap.docs.map(d => ({ id: d.id, ...d.data() })),
          { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites }
        );
      }, onError);
    },
    unlisten() { if (unsub) unsub(); unsub = null; },
    write(uid, id, payload) { return setDoc(doc(fs, 'users', uid, 'courses', id), payload); }
  };
}

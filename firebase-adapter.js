(function () {
  "use strict";

  const CDN_BASE = "https://www.gstatic.com/firebasejs/10.14.1/";
  const DATASETS = Array.isArray(window.__FIREBASE_DATASET_NAMES__)
    ? window.__FIREBASE_DATASET_NAMES__.slice()
    : ["itinerary", "tickets", "flights", "accommodations", "expenses", "reservedExpenses"];
  const TRIP_ID = String(window.__FIREBASE_TRIP_ID__ || "japan-tokyo-2026");
  const config = window.__FIREBASE_CONFIG__ || {};
  let initPromise = null;

  function configured() {
    return Boolean(
      config.projectId &&
      config.apiKey &&
      config.appId &&
      config.messagingSenderId
    );
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const existing = document.querySelector('script[data-firebase-src="' + src + '"]');
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        if (window.firebase) resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.firebaseSrc = src;
      script.onload = resolve;
      script.onerror = function () { reject(new Error("Firebase SDK 載入失敗：" + src)); };
      document.head.appendChild(script);
    });
  }

  function userLabel(user, member) {
    return {
      id: user.uid,
      name: member?.name || user.displayName || user.email || user.uid,
      email: user.email || "",
      role: member?.role || "viewer",
      status: member?.status || "active",
      provider: "firebase"
    };
  }

  async function memberFor(user) {
    const snapshot = await firestore().doc("trips/" + TRIP_ID + "/members/" + user.uid).get();
    if (!snapshot.exists) {
      const error = new Error("此帳號尚未加入東京旅程。");
      error.code = "TRIP_MEMBER_REQUIRED";
      throw error;
    }
    const member = snapshot.data() || {};
    if (member.status === "disabled") {
      const error = new Error("此旅伴帳號已停用。");
      error.code = "ACCOUNT_DISABLED";
      throw error;
    }
    return member;
  }

  async function ensureInitialized() {
    if (!configured()) {
      const error = new Error("尚未填入 Firebase Web App config。");
      error.code = "FIREBASE_CONFIG_MISSING";
      throw error;
    }
    if (!initPromise) {
      initPromise = (async function () {
        await loadScript(CDN_BASE + "firebase-app-compat.js");
        await loadScript(CDN_BASE + "firebase-auth-compat.js");
        await loadScript(CDN_BASE + "firebase-firestore-compat.js");
        if (!window.firebase) throw new Error("Firebase SDK 尚未可用。");
        if (!window.firebase.apps.length) window.firebase.initializeApp(config);
        return { app: window.firebase.app(), auth: window.firebase.auth(), db: window.firebase.firestore() };
      }());
    }
    return initPromise;
  }

  function firestore() {
    if (!window.firebase || !window.firebase.firestore) throw new Error("Firestore 尚未初始化。");
    return window.firebase.firestore();
  }

  async function signIn(email, password) {
    const sdk = await ensureInitialized();
    const credential = await sdk.auth.signInWithEmailAndPassword(String(email || "").trim(), String(password || ""));
    const member = await memberFor(credential.user);
    const token = await credential.user.getIdToken();
    return { token, user: userLabel(credential.user, member) };
  }

  async function currentSession() {
    const sdk = await ensureInitialized();
    const user = sdk.auth.currentUser;
    if (!user) return null;
    const member = await memberFor(user);
    return { token: await user.getIdToken(), user: userLabel(user, member) };
  }

  async function signOut() {
    const sdk = await ensureInitialized();
    await sdk.auth.signOut();
  }

  async function changePassword(currentPassword, newPassword) {
    const sdk = await ensureInitialized();
    const user = sdk.auth.currentUser;
    if (!user || !user.email) throw new Error("請先登入。");
    const credential = window.firebase.auth.EmailAuthProvider.credential(user.email, String(currentPassword || ""));
    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(String(newPassword || ""));
    return { token: await user.getIdToken(true), user: userLabel(user, await memberFor(user)) };
  }

  function datasetRef(dataset) {
    if (!DATASETS.includes(dataset)) throw new Error("不支援的 Firestore 資料集：" + dataset);
    return firestore().doc("trips/" + TRIP_ID + "/datasets/" + dataset);
  }

  function stripClientMeta(record) {
    const value = record && typeof record === "object" ? { ...record } : {};
    delete value._cloudVersion;
    delete value._cloudUpdatedAt;
    delete value._cloudUpdatedBy;
    delete value._deleted;
    return value;
  }

  function stableRecords(records) {
    return (Array.isArray(records) ? records : []).filter(item => item && String(item.id || "").trim()).map(item => ({
      ...item,
      id: String(item.id)
    }));
  }

  async function readSnapshot() {
    await ensureInitialized();
    await memberFor(window.firebase.auth().currentUser);
    const entries = await Promise.all(DATASETS.map(async dataset => {
      const snapshot = await datasetRef(dataset).get();
      const data = snapshot.exists ? snapshot.data() || {} : {};
      const records = Array.isArray(data.records) ? data.records.filter(item => !item._deleted) : [];
      return [dataset, records.map(item => ({ ...item, _cloudVersion: Number(item._cloudVersion || 1), _cloudUpdatedAt: data.updatedAt || "", _cloudUpdatedBy: data.updatedBy || "" }))];
    }));
    const revisions = {};
    for (const dataset of DATASETS) {
      const snapshot = await datasetRef(dataset).get();
      const data = snapshot.exists ? snapshot.data() || {} : {};
      revisions[dataset] = { revision: Number(data.revision || 0), updatedAt: data.updatedAt || null };
    }
    return { trip: { id: TRIP_ID }, datasets: Object.fromEntries(entries), revisions };
  }

  async function writeDataset(dataset, incomingRecords, expectedRevision) {
    await ensureInitialized();
    const user = window.firebase.auth().currentUser;
    const member = await memberFor(user);
    if (!["admin", "editor"].includes(member.role)) {
      const error = new Error("檢視者不能修改旅程資料。");
      error.code = "FORBIDDEN";
      throw error;
    }
    const incoming = stableRecords(incomingRecords);
    const ref = datasetRef(dataset);
    const result = await firestore().runTransaction(async function (transaction) {
      const snapshot = await transaction.get(ref);
      const currentData = snapshot.exists ? snapshot.data() || {} : {};
      const revision = Number(currentData.revision || 0);
      if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== revision) {
        const error = new Error("Firestore 資料集版本衝突，請先重新載入。");
        error.code = "REVISION_CONFLICT";
        error.details = { dataset, expectedRevision: Number(expectedRevision), currentRevision: revision };
        throw error;
      }
      const current = Array.isArray(currentData.records) ? currentData.records : [];
      const currentById = new Map(current.map(item => [String(item.id), item]));
      const next = incoming.map(item => {
        const old = currentById.get(item.id);
        const expectedVersion = Number(item._cloudVersion || 0);
        if (old && expectedVersion !== Number(old._cloudVersion || 0)) {
          const error = new Error("Firestore 單筆資料版本衝突，請先重新載入。");
          error.code = "RECORD_CONFLICT";
          error.details = { dataset, id: item.id, expectedVersion, currentVersion: Number(old._cloudVersion || 0) };
          throw error;
        }
        return { ...stripClientMeta(item), id: item.id, _cloudVersion: Number(old?._cloudVersion || 0) + 1, _deleted: false };
      });
      const incomingIds = new Set(incoming.map(item => item.id));
      current.forEach(item => {
        if (!incomingIds.has(String(item.id)) && !item._deleted) next.push({ ...item, _cloudVersion: Number(item._cloudVersion || 0) + 1, _deleted: true });
      });
      const nextRevision = revision + 1;
      transaction.set(ref, {
        tripId: TRIP_ID,
        dataset,
        revision: nextRevision,
        updatedAt: new Date().toISOString(),
        updatedBy: user.uid,
        records: next
      });
      return { dataset, revision: nextRevision, records: next.filter(item => !item._deleted) };
    });
    return result;
  }

  async function previewImport(datasets) {
    const snapshot = await readSnapshot();
    const preview = {};
    DATASETS.forEach(dataset => {
      const current = snapshot.datasets?.[dataset] || [];
      const incoming = stableRecords(datasets?.[dataset] || []);
      const currentIds = new Set(current.map(item => String(item.id)));
      const incomingIds = new Set(incoming.map(item => String(item.id)));
      preview[dataset] = {
        current: current.length,
        incoming: incoming.length,
        added: [...incomingIds].filter(id => !currentIds.has(id)).length,
        updated: [...incomingIds].filter(id => currentIds.has(id)).length,
        removed: [...currentIds].filter(id => !incomingIds.has(id)).length
      };
    });
    return { tripId: TRIP_ID, preview, requiresConfirmation: true };
  }

  async function importDatasets(datasets, revisions) {
    const result = {};
    for (const dataset of DATASETS) {
      result[dataset] = await writeDataset(dataset, datasets?.[dataset] || [], revisions?.[dataset]?.revision);
    }
    return result;
  }

  window.travelFirebase = {
    configured,
    datasets: DATASETS,
    tripId: TRIP_ID,
    ensureInitialized,
    signIn,
    currentSession,
    signOut,
    changePassword,
    readSnapshot,
    writeDataset,
    previewImport,
    importDatasets
  };
}());


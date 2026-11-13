(function () {
  "use strict";

  const CDN_BASE = "https://www.gstatic.com/firebasejs/10.14.1/";
  const DATASETS = Array.isArray(window.__FIREBASE_DATASET_NAMES__)
    ? window.__FIREBASE_DATASET_NAMES__.slice()
    : ["itinerary", "tickets", "flights", "accommodations", "expenses", "reservedExpenses"];
  const DEFAULT_TRIP_ID = String(window.__FIREBASE_TRIP_ID__ || "japan-tokyo-2026");
  let activeTripId = String(window.__ACTIVE_TRIP_ID__ || DEFAULT_TRIP_ID);
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

  function normalizeTripId(value) {
    const tripId = String(value || "").trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,96}$/.test(tripId)) throw new Error("旅行 ID 格式不正確。");
    return tripId;
  }

  function tripPath(tripId = activeTripId) {
    return "trips/" + normalizeTripId(tripId);
  }

  function memberRef(tripId, uid) {
    return firestore().doc(tripPath(tripId) + "/members/" + String(uid));
  }

  async function memberFor(user, tripId = activeTripId) {
    if (!user) throw new Error("請先登入。");
    const snapshot = await memberRef(tripId, user.uid).get({ source: "server" });
    if (!snapshot.exists) {
      const error = new Error("此帳號尚未加入這趟旅行。");
      error.code = "TRIP_MEMBER_REQUIRED";
      throw error;
    }
    const member = snapshot.data() || {};
    if (member.status !== "active") {
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

  async function signIn(email, password, remember = true) {
    const sdk = await ensureInitialized();
    const persistence = window.firebase.auth.Auth.Persistence;
    await sdk.auth.setPersistence(remember ? persistence.LOCAL : persistence.SESSION);
    const credential = await sdk.auth.signInWithEmailAndPassword(String(email || "").trim(), String(password || ""));
    try {
      return { user: userLabel(credential.user, null) };
    } catch (error) {
      await sdk.auth.signOut();
      throw error;
    }
  }

  async function currentSession() {
    const sdk = await ensureInitialized();
    const user = await new Promise((resolve, reject) => {
      const unsubscribe = sdk.auth.onAuthStateChanged(
        current => { unsubscribe(); resolve(current); },
        error => { unsubscribe(); reject(error); }
      );
    });
    if (!user) return null;
    return { user: userLabel(user, null) };
  }

  async function sendPasswordReset(email) {
    const sdk = await ensureInitialized();
    try {
      await sdk.auth.sendPasswordResetEmail(String(email || "").trim());
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
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

  function datasetRef(dataset, tripId = activeTripId) {
    if (!DATASETS.includes(dataset)) throw new Error("不支援的 Firestore 資料集：" + dataset);
    return firestore().doc(tripPath(tripId) + "/datasets/" + dataset);
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

  async function readSnapshot(tripId = activeTripId) {
    await ensureInitialized();
    const selectedTripId = normalizeTripId(tripId);
    await memberFor(window.firebase.auth().currentUser, selectedTripId);
    const revisions = {};
    const entries = await Promise.all(DATASETS.map(async dataset => {
      const snapshot = await datasetRef(dataset, selectedTripId).get({ source: "server" });
      const data = snapshot.exists ? snapshot.data() || {} : {};
      const records = Array.isArray(data.records) ? data.records.filter(item => !item._deleted) : [];
      if (snapshot.exists && !Array.isArray(data.records)) {
        throw new Error("雲端資料格式與 App 不相容：" + dataset);
      }
      revisions[dataset] = { revision: Number(data.revision || 0), updatedAt: data.updatedAt || null };
      return [dataset, records.map(item => ({ ...item, _cloudVersion: Number(item._cloudVersion || 1), _cloudUpdatedAt: data.updatedAt || "", _cloudUpdatedBy: data.updatedBy || "" }))];
    }));
    return { trip: { id: selectedTripId }, datasets: Object.fromEntries(entries), revisions };
  }

  async function writeDataset(dataset, incomingRecords, expectedRevision, tripId = activeTripId) {
    await ensureInitialized();
    const user = window.firebase.auth().currentUser;
    const selectedTripId = normalizeTripId(tripId);
    const member = await memberFor(user, selectedTripId);
    if (!["admin", "editor"].includes(member.role)) {
      const error = new Error("檢視者不能修改旅程資料。");
      error.code = "FORBIDDEN";
      throw error;
    }
    const incoming = stableRecords(incomingRecords);
    const ref = datasetRef(dataset, selectedTripId);
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
        tripId: selectedTripId,
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

  async function previewImport(datasets, tripId = activeTripId) {
    const snapshot = await readSnapshot(tripId);
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
    return { tripId: normalizeTripId(tripId), preview, requiresConfirmation: true };
  }

  async function importDatasets(datasets, revisions, tripId = activeTripId) {
    const result = {};
    for (const dataset of DATASETS) {
      result[dataset] = await writeDataset(dataset, datasets?.[dataset] || [], revisions?.[dataset]?.revision, tripId);
    }
    return result;
  }

  async function tripFor(tripId = activeTripId) {
    await ensureInitialized();
    const selectedTripId = normalizeTripId(tripId);
    const user = window.firebase.auth().currentUser;
    const member = await memberFor(user, selectedTripId);
    const fallback = selectedTripId === DEFAULT_TRIP_ID ? {
      name: "Japan Tokyo｜旅する手帳",
      destination: "東京",
      startDate: "2026-11-28",
      endDate: "2026-12-06",
      timezone: "Asia/Tokyo",
      currency: "JPY",
      settlementCurrency: "TWD",
      theme: "postcard",
      status: "active",
      ownerId: member.role === "admin" ? member.uid || user.uid : ""
    } : {};
    let snapshot = null;
    try {
      snapshot = await firestore().doc(tripPath(selectedTripId)).get({ source: "server" });
    } catch (error) {
      if (selectedTripId !== DEFAULT_TRIP_ID) throw error;
      console.warn("舊 Firestore 規則尚未開放旅行設定讀取，使用東京相容設定：", error);
    }
    if (snapshot && !snapshot.exists && selectedTripId !== DEFAULT_TRIP_ID) throw new Error("找不到這趟旅行設定。");
    const stored = snapshot?.data() || {};
    const hasTripSettings = Boolean(stored.startDate && stored.endDate && stored.destination);
    return { id: selectedTripId, ...fallback, ...(selectedTripId === DEFAULT_TRIP_ID && !hasTripSettings ? {} : stored), member };
  }

  async function listTrips() {
    await ensureInitialized();
    const user = window.firebase.auth().currentUser;
    if (!user) return [];
    let refsSnapshot = null;
    try {
      refsSnapshot = await firestore().collection("users").doc(user.uid).collection("tripRefs").get({ source: "server" });
    } catch (error) {
      // 舊規則尚未部署時，先走既有東京 members 文件相容路徑。
      console.warn("旅行索引尚未可讀，改用既有成員文件：", error);
    }
    const ids = new Set((refsSnapshot?.docs || []).map(doc => doc.id));
    // 舊東京旅程沒有索引時，仍透過既有 members 文件相容讀取。
    if (!ids.has(DEFAULT_TRIP_ID)) {
      try { await memberFor(user, DEFAULT_TRIP_ID); ids.add(DEFAULT_TRIP_ID); } catch (error) { if (!['TRIP_MEMBER_REQUIRED', 'ACCOUNT_DISABLED'].includes(error.code)) throw error; }
    }
    const trips = [];
    for (const tripId of ids) {
      try { trips.push(await tripFor(tripId)); } catch (error) { console.warn("旅行列表略過無法讀取的旅行：" + tripId, error); }
    }
    return trips;
  }

  async function createTrip(settings) {
    await ensureInitialized();
    const user = window.firebase.auth().currentUser;
    if (!user) throw new Error("請先登入。");
    const payload = settings || {};
    const tripId = normalizeTripId(payload.id || ("trip-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)));
    const trip = {
      id: tripId,
      name: String(payload.name || "未命名旅行").trim(),
      destination: String(payload.destination || "").trim(),
      startDate: String(payload.startDate || ""),
      endDate: String(payload.endDate || ""),
      timezone: String(payload.timezone || "Asia/Tokyo"),
      currency: String(payload.currency || "JPY").toUpperCase(),
      settlementCurrency: String(payload.settlementCurrency || "TWD").toUpperCase(),
      cover: String(payload.cover || ""),
      theme: String(payload.theme || "postcard"),
      status: "active",
      ownerId: user.uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!trip.name || !trip.destination || !/^\d{4}-\d{2}-\d{2}$/.test(trip.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(trip.endDate) || trip.endDate < trip.startDate) {
      throw new Error("請填寫正確的旅行名稱、目的地與日期。");
    }
    const batch = firestore().batch();
    batch.set(firestore().doc(tripPath(tripId)), trip);
    batch.set(memberRef(tripId, user.uid), { name: user.displayName || user.email || user.uid, email: user.email || "", role: "admin", status: "active", owner: true, createdAt: trip.createdAt });
    batch.set(firestore().doc("users/" + user.uid + "/tripRefs/" + tripId), { tripId, name: trip.name, destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate, status: trip.status, updatedAt: trip.updatedAt });
    await batch.commit();
    return { ...trip, member: { role: "admin", status: "active", owner: true } };
  }

  async function updateTrip(tripId, patch) {
    await ensureInitialized();
    const selectedTripId = normalizeTripId(tripId);
    const user = window.firebase.auth().currentUser;
    const member = await memberFor(user, selectedTripId);
    if (member.role !== "admin") { const error = new Error("只有旅行擁有者／管理員可以修改旅行設定。"); error.code = "FORBIDDEN"; throw error; }
    const current = await tripFor(selectedTripId);
    const next = { ...current, ...patch, id: selectedTripId, ownerId: current.ownerId || user.uid, updatedAt: new Date().toISOString() };
    delete next.member;
    await firestore().doc(tripPath(selectedTripId)).set(next, { merge: true });
    await firestore().doc("users/" + user.uid + "/tripRefs/" + selectedTripId).set({ tripId: selectedTripId, name: next.name, destination: next.destination, startDate: next.startDate, endDate: next.endDate, status: next.status || "active", updatedAt: next.updatedAt }, { merge: true });
    return { ...next, member };
  }

  function setTrip(tripId) {
    activeTripId = normalizeTripId(tripId || DEFAULT_TRIP_ID);
    window.__ACTIVE_TRIP_ID__ = activeTripId;
    return activeTripId;
  }

  window.travelFirebase = {
    configured,
    datasets: DATASETS,
    get tripId() { return activeTripId; },
    defaultTripId: DEFAULT_TRIP_ID,
    setTrip,
    ensureInitialized,
    signIn,
    currentSession,
    signOut,
    sendPasswordReset,
    changePassword,
    memberFor,
    tripFor,
    listTrips,
    createTrip,
    updateTrip,
    readSnapshot,
    writeDataset,
    previewImport,
    importDatasets
  };
}());


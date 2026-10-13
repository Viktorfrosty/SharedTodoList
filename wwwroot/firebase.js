import { firebaseConfig as defaultFirebaseConfig } from "./firebase-config.js";

const storageKey = "home-together.demo.v1";
const firebaseVersion = "10.12.5";
let app;
let auth;
let database;
let firebase;
let currentUser;
let listsUnsubscribe;
let tasksUnsubscribe;
let activeComponent;
let localData;

export async function initialize(component) {
    activeComponent = component;
    const firebaseConfig = await loadFirebaseConfig();
    const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
    if (!configured) {
        localData = readLocalData();
        await publishAuth(null);
        return false;
    }

    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-firestore.js`)
    ]);
    firebase = { ...appSdk, ...authSdk, ...firestoreSdk };
    app = firebase.initializeApp(firebaseConfig);
    auth = firebase.getAuth(app);
    database = firebase.getFirestore(app);
    // Firebase Auth restores a saved session asynchronously; wait for this callback
    // before treating the visitor as signed out or starting their list query.
    firebase.onAuthStateChanged(auth, async user => {
        if (user && !user.emailVerified) {
            currentUser = null;
            await publishAuth(null);
            watchLists();
            return;
        }
        currentUser = user;
        await publishAuth(user ? profileFromUser(user) : null);
        watchLists();
    }, error => reportError(error, "authentication"));
    return true;
}

async function loadFirebaseConfig() {
    const configUrl = new URL("./firebase-config.local.js", import.meta.url);
    const response = await fetch(configUrl, { method: "HEAD" });
    if (response.status === 404) {
        // Missing local config is expected for a clean checkout and enables demo mode.
        return defaultFirebaseConfig;
    }
    if (!response.ok) {
        throw new Error(`Couldn't load Firebase configuration (HTTP ${response.status}).`);
    }
    const { firebaseConfig: localFirebaseConfig } = await import("./firebase-config.local.js");
    return { ...defaultFirebaseConfig, ...localFirebaseConfig };
}

export async function signInWithGoogle() {
    ensureFirebase();
    const provider = new firebase.GoogleAuthProvider();
    await firebase.signInWithPopup(auth, provider);
}

export async function signInWithEmail(email, password) {
    ensureFirebase();
    const credential = await firebase.signInWithEmailAndPassword(auth, email.trim(), password);
    if (!credential.user.emailVerified) {
        // Rules also require verified email; sign out here so the UI matches that boundary.
        await firebase.sendEmailVerification(credential.user);
        await firebase.signOut(auth);
        throw new Error("Your email isn't verified yet. We sent a new verification link; open it before signing in.");
    }
}

export async function createEmailAccount(displayName, email, password) {
    ensureFirebase();
    const name = requiredText(displayName, 60, "Display name");
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error("Enter a valid email address.");
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
        throw new Error("Choose a password between 8 and 128 characters.");
    }
    const credential = await firebase.createUserWithEmailAndPassword(auth, normalizedEmail, password);
    await firebase.updateProfile(credential.user, { displayName: name });
    await firebase.sendEmailVerification(credential.user);
    await firebase.signOut(auth);
    return "Account created. Check your email and verify your address before signing in.";
}

export async function signOut() {
    if (currentUser?.uid.startsWith("demo-")) {
        currentUser = null;
        localData.user = null;
        writeLocalData();
        await publishAuth(null);
        await publishLists();
        return;
    }
    ensureFirebase();
    await firebase.signOut(auth);
}

export async function enterDemo(displayName, email) {
    if (!displayName.trim() || !email.trim()) {
        throw new Error("Enter a name and email address to start the local demo.");
    }
    localData = readLocalData();
    const normalizedEmail = email.trim().toLowerCase();
    currentUser = {
        uid: `demo-${normalizedEmail}`,
        displayName: displayName.trim(),
        email: normalizedEmail,
        photoURL: ""
    };
    localData.user = currentUser;
    if (localData.lists.length === 0) {
        // Seed only a fresh demo so returning users keep the changes saved in this browser.
        const listId = crypto.randomUUID();
        localData.lists.push({
            id: listId,
            title: "Sunday groceries",
            ownerUid: currentUser.uid,
            members: [normalizedEmail],
            createdAt: Date.now()
        });
        localData.tasks[listId] = [
            { id: crypto.randomUUID(), listId, title: "Pick up oat milk", isCompleted: true, assignedToEmail: normalizedEmail, createdByUid: currentUser.uid },
            { id: crypto.randomUUID(), listId, title: "Fresh flowers", isCompleted: false, assignedToEmail: "", createdByUid: currentUser.uid },
            { id: crypto.randomUUID(), listId, title: "Get something for dinner", isCompleted: false, assignedToEmail: normalizedEmail, createdByUid: currentUser.uid }
        ];
    }
    writeLocalData();
    await publishAuth(profileFromUser(currentUser));
    await publishLists();
}

export async function watchTasks(listId, component) {
    if (tasksUnsubscribe) {
        tasksUnsubscribe();
        tasksUnsubscribe = null;
    }
    activeComponent = component;
    if (!listId) {
        await publishTasks([]);
        return;
    }

    if (currentUser?.uid.startsWith("demo-")) {
        await publishTasks(localData.tasks[listId] ?? []);
        return;
    }
    if (!currentUser) {
        await publishTasks([]);
        return;
    }

    const taskCollection = firebase.collection(database, "lists", listId, "tasks");
    // Tear down the previous listener above when switching lists to avoid stale task updates.
    tasksUnsubscribe = firebase.onSnapshot(taskCollection, snapshot => {
        const tasks = snapshot.docs.map(item => ({ id: item.id, listId, ...item.data() }))
            .sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0));
        publishTasks(tasks);
    }, error => reportError(error, "task updates"));
}

export async function createList(title) {
    requireSignedIn();
    const cleanTitle = requiredText(title, 60, "List name");
    if (isDemo()) {
        const list = { id: crypto.randomUUID(), title: cleanTitle, ownerUid: currentUser.uid, members: [currentUser.email], createdAt: Date.now(), deletionInProgress: false, deleted: false };
        localData.lists.push(list);
        localData.tasks[list.id] = [];
        writeLocalData();
        await publishLists();
        return;
    }
    const list = {
        title: cleanTitle,
        ownerUid: currentUser.uid,
        ownerEmail: currentUser.email.toLowerCase(),
        // Membership is stored lowercase because the list query and rules compare normalized emails.
        members: [currentUser.email.toLowerCase()],
        memberUids: { [currentUser.email.toLowerCase()]: currentUser.uid },
        createdAt: Date.now(),
        deletionInProgress: false,
        deleted: false
    };
    await firebase.addDoc(firebase.collection(database, "lists"), list);
}

export async function renameList(listId, title) {
    requireSignedIn();
    const cleanTitle = requiredText(title, 60, "List name");
    if (isDemo()) {
        findLocalList(listId).title = cleanTitle;
        writeLocalData();
        await publishLists();
        return;
    }
    await firebase.updateDoc(firebase.doc(database, "lists", listId), { title: cleanTitle });
}

export async function deleteList(listId) {
    requireSignedIn();
    if (isDemo()) {
        localData.lists = localData.lists.filter(list => list.id !== listId);
        delete localData.tasks[listId];
        writeLocalData();
        await publishLists();
        return;
    }

    await deleteCloudList(listId);
}

async function deleteCloudList(listId) {
    const listRef = firebase.doc(database, "lists", listId);
    const listSnapshot = await firebase.getDoc(listRef);
    if (!listSnapshot.exists()) {
        throw new Error("That list could not be found. Refresh and try again.");
    }
    const listData = listSnapshot.data();
    if (listData.deleted === true) return;
    // Revoke shared access before cleaning up tasks; keep the parent as a tombstone.
    if (listData.deletionInProgress !== true) {
        await firebase.updateDoc(listRef, {
            deletionInProgress: true,
            members: [currentUser.email.toLowerCase()]
        });
    }

    const tasks = await firebase.getDocs(firebase.collection(database, "lists", listId, "tasks"));
    // Firestore batches are limited to 500 writes; stay below the limit for safe cleanup.
    for (let index = 0; index < tasks.docs.length; index += 400) {
        const batch = firebase.writeBatch(database);
        for (const task of tasks.docs.slice(index, index + 400)) batch.delete(task.ref);
        await batch.commit();
    }
    await firebase.updateDoc(listRef, {
        deleted: true,
        title: "Deleted list",
        ownerUid: "",
        ownerEmail: "",
        members: [],
        memberUids: {}
    });
}

export async function createTask(listId, title, assignedToEmail) {
    requireSignedIn();
    const task = {
        listId,
        title: requiredText(title, 120, "Task"),
        isCompleted: false,
        assignedToEmail: assignedToEmail ?? "",
        createdByUid: currentUser.uid,
        createdAt: Date.now()
    };
    if (isDemo()) {
        task.id = crypto.randomUUID();
        (localData.tasks[listId] ??= []).push(task);
        writeLocalData();
        await publishTasks(localData.tasks[listId]);
        return;
    }
    await firebase.addDoc(firebase.collection(database, "lists", listId, "tasks"), task);
}

export async function toggleTask(listId, taskId, isCompleted) {
    requireSignedIn();
    if (isDemo()) {
        findLocalTask(listId, taskId).isCompleted = isCompleted;
        writeLocalData();
        await publishTasks(localData.tasks[listId]);
        return;
    }
    await firebase.updateDoc(firebase.doc(database, "lists", listId, "tasks", taskId), { isCompleted });
}

export async function updateTask(listId, taskId, title, assignedToEmail) {
    requireSignedIn();
    const updates = {
        title: requiredText(title, 120, "Task"),
        assignedToEmail: assignedToEmail ?? ""
    };
    if (isDemo()) {
        Object.assign(findLocalTask(listId, taskId), updates);
        writeLocalData();
        await publishTasks(localData.tasks[listId]);
        return;
    }
    await firebase.updateDoc(firebase.doc(database, "lists", listId, "tasks", taskId), updates);
}

export async function deleteTask(listId, taskId) {
    requireSignedIn();
    if (isDemo()) {
        localData.tasks[listId] = (localData.tasks[listId] ?? []).filter(task => task.id !== taskId);
        writeLocalData();
        await publishTasks(localData.tasks[listId]);
        return;
    }
    await firebase.deleteDoc(firebase.doc(database, "lists", listId, "tasks", taskId));
}

export async function addMember(listId, email) {
    requireSignedIn();
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error("Enter a valid email address.");
    }
    if (isDemo()) {
        const list = findLocalList(listId);
        if (!list.members.some(member => member.toLowerCase() === normalizedEmail)) list.members.push(normalizedEmail);
        writeLocalData();
        await publishLists();
        return;
    }
    // arrayUnion makes repeated invites idempotent; Firestore rules still decide who may invite.
    await firebase.updateDoc(firebase.doc(database, "lists", listId), { members: firebase.arrayUnion(normalizedEmail) });
}

export async function removeMember(listId, email) {
    requireSignedIn();
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error("That member email is invalid.");
    }
    if (normalizedEmail === currentUser.email.toLowerCase()) {
        throw new Error("The list owner can't remove themselves. Delete the list if you no longer need it.");
    }
    if (isDemo()) {
        const list = findLocalList(listId);
        if (list.ownerUid !== currentUser.uid) {
            throw new Error("Only the list owner can remove members.");
        }
        list.members = list.members.filter(member => member.toLowerCase() !== normalizedEmail);
        writeLocalData();
        await publishLists();
        return;
    }
    const listRef = firebase.doc(database, "lists", listId);
    await firebase.runTransaction(database, async transaction => {
        const snapshot = await transaction.get(listRef);
        if (!snapshot.exists()) throw new Error("That list could not be found. Refresh and try again.");
        const memberUids = snapshot.data().memberUids ?? {};
        delete memberUids[normalizedEmail];
        transaction.update(listRef, {
            members: firebase.arrayRemove(normalizedEmail),
            memberUids
        });
    });
}

export async function deleteAccount(listChoices, password) {
    requireSignedIn();
    if (isDemo()) {
        localStorage.removeItem(storageKey);
        localData = { user: null, lists: [], tasks: {} };
        currentUser = null;
        await publishAuth(null);
        await publishLists([]);
        return;
    }

    // Start reauthentication directly from the user's confirmation click, before
    // any Firestore reads can use up the browser's transient popup activation.
    await reauthenticateForDeletion(password);

    const email = currentUser.email.toLowerCase();
    const listSnapshot = await firebase.getDocs(firebase.query(
        firebase.collection(database, "lists"),
        firebase.where("members", "array-contains", email)
    ));
    const lists = listSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    const ownedLists = lists.filter(list => list.ownerUid === currentUser.uid);
    const choices = listChoices ?? {};

    // Check every shared list decision before making any irreversible changes.
    for (const list of ownedLists) {
        const collaborators = list.members.filter(member => member !== email);
        if (collaborators.length === 0) continue;
        const choice = choices[list.id];
        if (choice === "delete") continue;
        if (typeof choice === "string" && choice.startsWith("transfer:")) {
            const newOwnerEmail = choice.slice("transfer:".length);
            if (!collaborators.includes(newOwnerEmail)
                || list.memberUids?.[newOwnerEmail] === undefined) {
                throw new Error(`Choose an active member or delete the shared list “${list.title}”.`);
            }
            continue;
        }
        throw new Error(`Choose what to do with the shared list “${list.title}” before deleting your account.`);
    }

    for (const list of lists) {
        const listRef = firebase.doc(database, "lists", list.id);
        if (list.ownerUid === currentUser.uid) {
            const choice = choices[list.id];
            const collaborators = list.members.filter(member => member !== email);
            if (collaborators.length === 0 || choice === "delete") {
                await deleteCloudList(list.id);
                continue;
            }

            await clearUserTaskReferences(list.id, email, currentUser.uid);
            const newOwnerEmail = choice.slice("transfer:".length);
            const memberUids = { ...(list.memberUids ?? {}) };
            const newOwnerUid = memberUids[newOwnerEmail];
            delete memberUids[email];
            await firebase.updateDoc(listRef, {
                ownerUid: newOwnerUid,
                ownerEmail: newOwnerEmail,
                members: firebase.arrayRemove(email),
                memberUids
            });
            continue;
        }

        await clearUserTaskReferences(list.id, email, currentUser.uid);
        const memberUids = { ...(list.memberUids ?? {}) };
        delete memberUids[email];
        await firebase.updateDoc(listRef, {
            members: firebase.arrayRemove(email),
            memberUids
        });
    }

    await firebase.deleteDoc(firebase.doc(database, "users", currentUser.uid));
    await firebase.deleteUser(currentUser);
}

async function reauthenticateForDeletion(password) {
    const providerIds = currentUser.providerData.map(provider => provider.providerId);
    if (providerIds.includes("password")) {
        if (typeof password !== "string" || password.length === 0) {
            throw new Error("Enter your password to confirm account deletion.");
        }
        const credential = firebase.EmailAuthProvider.credential(currentUser.email, password);
        await firebase.reauthenticateWithCredential(currentUser, credential);
        return;
    }
    if (providerIds.includes("google.com")) {
        await firebase.reauthenticateWithPopup(currentUser, new firebase.GoogleAuthProvider());
        return;
    }
    throw new Error("This sign-in method can't re-verify your account here. Sign in again, then retry account deletion.");
}

async function clearUserTaskReferences(listId, email, uid) {
    const tasks = await firebase.getDocs(firebase.collection(database, "lists", listId, "tasks"));
    for (let index = 0; index < tasks.docs.length; index += 400) {
        const batch = firebase.writeBatch(database);
        let updateCount = 0;
        for (const task of tasks.docs.slice(index, index + 400)) {
            const updates = {};
            if (task.data().assignedToEmail === email) updates.assignedToEmail = "";
            if (task.data().createdByUid === uid) updates.createdByUid = "";
            if (Object.keys(updates).length > 0) {
                batch.update(task.ref, updates);
                updateCount++;
            }
        }
        if (updateCount > 0) await batch.commit();
    }
}

export async function updateProfile(displayName) {
    requireSignedIn();
    const name = requiredText(displayName, 60, "Display name");
    if (isDemo()) {
        currentUser.displayName = name;
        localData.user = currentUser;
        writeLocalData();
        await publishAuth(profileFromUser(currentUser));
        return;
    }
    // Auth owns the signed-in profile; the user document keeps a copy for app data.
    await firebase.updateProfile(currentUser, { displayName: name });
    await firebase.setDoc(firebase.doc(database, "users", currentUser.uid), {
        uid: currentUser.uid,
        displayName: name,
        email: currentUser.email,
        photoURL: currentUser.photoURL ?? ""
    }, { merge: true });
    // Publish the saved value directly; a profile update isn't an auth-state change event.
    await publishAuth({ ...profileFromUser(currentUser), displayName: name });
}

export function confirmAction(message) {
    return window.confirm(message);
}

export function dispose() {
    listsUnsubscribe?.();
    tasksUnsubscribe?.();
    listsUnsubscribe = null;
    tasksUnsubscribe = null;
    activeComponent = null;
}

function watchLists() {
    listsUnsubscribe?.();
    listsUnsubscribe = null;
    if (isDemo()) {
        publishLists();
        return;
    }
    if (!currentUser) {
        publishLists([]);
        return;
    }
    // Keep this filter aligned with the list read rule: Firestore rules don't filter results.
    const listsQuery = firebase.query(
        firebase.collection(database, "lists"),
        firebase.where("members", "array-contains", currentUser.email.toLowerCase()),
        firebase.where("deletionInProgress", "==", false)
    );
    listsUnsubscribe = firebase.onSnapshot(listsQuery, snapshot => {
        const lists = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
            .filter(list => list.deletionInProgress !== true)
            .filter(list => list.deleted !== true)
            .sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0));
        publishLists(lists);
        for (const list of lists) {
            ensureMemberIdentity(list);
        }
    }, error => reportError(error, "list updates"));
}

async function ensureMemberIdentity(list) {
    const email = currentUser?.email?.toLowerCase();
    if (!email || list.memberUids?.[email] === currentUser.uid) return;
    const listRef = firebase.doc(database, "lists", list.id);
    try {
        await firebase.runTransaction(database, async transaction => {
            const snapshot = await transaction.get(listRef);
            if (!snapshot.exists()) return;
            const memberUids = snapshot.data().memberUids ?? {};
            if (memberUids[email] === currentUser.uid) return;
            transaction.update(listRef, {
                memberUids: { ...memberUids, [email]: currentUser.uid }
            });
        });
    } catch (error) {
        reportError(error, "member identity sync");
    }
}

function profileFromUser(user) {
    return {
        uid: user.uid,
        displayName: user.displayName ?? user.email?.split("@")[0] ?? "Home member",
        email: user.email ?? "",
        photoURL: user.photoURL ?? "",
        providerIds: (user.providerData ?? []).map(provider => provider.providerId)
    };
}

function readLocalData() {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return { user: null, lists: [], tasks: {} };
    const parsed = JSON.parse(saved);
    // Older demo saves may omit newer fields, so tolerate missing top-level values.
    return {
        user: parsed.user ?? null,
        lists: Array.isArray(parsed.lists) ? parsed.lists : [],
        tasks: parsed.tasks && typeof parsed.tasks === "object" ? parsed.tasks : {}
    };
}

function writeLocalData() {
    localStorage.setItem(storageKey, JSON.stringify(localData));
}

function isDemo() {
    return currentUser?.uid.startsWith("demo-") === true;
}

function requireSignedIn() {
    if (!currentUser) throw new Error("Sign in to make changes.");
}

function ensureFirebase() {
    if (!auth || !firebase) throw new Error("Firebase is not configured. Follow the Firebase setup guide first.");
}

function requiredText(value, limit, label) {
    const text = String(value ?? "").trim();
    if (!text || text.length > limit) throw new Error(`${label} must be between 1 and ${limit} characters.`);
    return text;
}

function findLocalList(listId) {
    const list = localData.lists.find(item => item.id === listId);
    if (!list) throw new Error("That list could not be found. Refresh and try again.");
    return list;
}

function findLocalTask(listId, taskId) {
    const task = (localData.tasks[listId] ?? []).find(item => item.id === taskId);
    if (!task) throw new Error("That task could not be found. Refresh and try again.");
    return task;
}

async function publishAuth(user) {
    await activeComponent?.invokeMethodAsync("OnAuthChanged", user ? JSON.stringify(user) : null);
}

async function publishLists(lists = localData?.lists ?? []) {
    if (activeComponent) await activeComponent.invokeMethodAsync("OnListsChanged", JSON.stringify(lists));
}

async function publishTasks(tasks) {
    if (activeComponent) await activeComponent.invokeMethodAsync("OnTasksChanged", JSON.stringify(tasks));
}

function reportError(error, source = "Firebase request") {
    console.error(`Home Together ${source} error:`, error);
    activeComponent?.invokeMethodAsync(
        "OnStorageError",
        `${source}: ${error?.message ?? "A Firebase request failed."}`
    )
        .catch(callbackError => console.error("Couldn't report the Firebase error to the app:", callbackError));
}

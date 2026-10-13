import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    setDoc,
    updateDoc,
    where
} from "firebase/firestore";

const projectId = "demo-shared-todo-list";
const owner = {
    uid: "owner-uid",
    email: "owner@example.com"
};
let testEnvironment;

before(async () => {
    const rules = await readFile(
        fileURLToPath(new URL("../firestore.rules", import.meta.url)),
        "utf8"
    );

    testEnvironment = await initializeTestEnvironment({
        // The demo project ID makes accidental requests to a real Firebase project fail closed.
        projectId,
        firestore: { rules }
    });
});

after(async () => {
    await testEnvironment?.cleanup();
});

test("member-filtered list query reads only lists containing the signed-in email", async () => {
    // Seed both records outside the rules so the test can check member and non-member access.
    await testEnvironment.withSecurityRulesDisabled(async context => {
        const database = context.firestore();
        await setDoc(doc(database, "lists", "member-list"), {
            title: "Shared list",
            ownerUid: owner.uid,
            members: [owner.email],
            memberUids: { [owner.email]: owner.uid },
            deletionInProgress: false,
            deleted: false
        });
        await setDoc(doc(database, "lists", "private-list"), {
            title: "Another user's list",
            ownerUid: "another-owner",
            members: ["someone-else@example.com"],
            deletionInProgress: false,
            deleted: false
        });
        await setDoc(doc(database, "lists", "member-list", "tasks", "visible-task"), {
            title: "Visible to the list member",
            listId: "member-list",
            isCompleted: false,
            assignedToEmail: owner.email,
            createdByUid: owner.uid
        });
        await setDoc(doc(database, "lists", "private-list", "tasks", "private-task"), {
            title: "Private task",
            listId: "private-list",
            isCompleted: false,
            assignedToEmail: "",
            createdByUid: "another-owner"
        });
    });

    const database = testEnvironment
        .authenticatedContext(owner.uid, {
            email: owner.email,
            email_verified: true
        })
        .firestore();

    await assertSucceeds(getDoc(doc(database, "lists", "member-list")));
    await assertFails(getDoc(doc(database, "lists", "private-list")));

    const memberQuery = query(
        collection(database, "lists"),
        where("members", "array-contains", owner.email)
    );
    const snapshot = await assertSucceeds(getDocs(memberQuery));

    assert.deepEqual(
        snapshot.docs.map(item => item.id),
        ["member-list"]
    );

    await assertFails(getDocs(collection(database, "lists")));

    // This is the exact unfiltered subcollection read used by watchTasks/onSnapshot.
    const taskCollection = collection(database, "lists", "member-list", "tasks");
    const visibleTasks = await assertSucceeds(getDocs(taskCollection));
    assert.deepEqual(visibleTasks.docs.map(item => item.id), ["visible-task"]);

    let unsubscribe;
    try {
        const liveTasks = await assertSucceeds(new Promise((resolve, reject) => {
            unsubscribe = onSnapshot(taskCollection, resolve, reject);
        }));
        assert.deepEqual(liveTasks.docs.map(item => item.id), ["visible-task"]);
    } finally {
        unsubscribe?.();
    }

    await assertFails(getDocs(collection(database, "lists", "private-list", "tasks")));
});

test("a recreated account can read a stale deleting list but cannot read its tasks", async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
        const database = context.firestore();
        await setDoc(doc(database, "lists", "stale-deleting-list"), {
            title: "Old account list",
            ownerUid: "deleted-account-uid",
            members: [owner.email],
            memberUids: { [owner.email]: "deleted-account-uid" },
            deletionInProgress: true,
            deleted: false
        });
        await setDoc(doc(database, "lists", "stale-deleting-list", "tasks", "old-task"), {
            title: "Task from before account deletion",
            listId: "stale-deleting-list",
            isCompleted: false,
            assignedToEmail: "",
            createdByUid: "deleted-account-uid"
        });
    });

    // The same verified email can match the stale list, but recreating the account
    // produces a different UID and does not restore the old owner's task access.
    const recreatedAccount = testEnvironment
        .authenticatedContext("recreated-account-uid", {
            email: owner.email,
            email_verified: true
        })
        .firestore();

    await assertSucceeds(getDoc(doc(recreatedAccount, "lists", "stale-deleting-list")));
    await assertFails(getDocs(collection(recreatedAccount, "lists", "stale-deleting-list", "tasks")));
});

test("verified user can create a list using the app's Firestore document shape", async () => {
    const database = testEnvironment
        .authenticatedContext(owner.uid, {
            email: owner.email,
            email_verified: true
        })
        .firestore();

    await assertSucceeds(setDoc(doc(database, "lists", "created-by-app"), {
        title: "Weekly groceries",
        ownerUid: owner.uid,
        ownerEmail: owner.email,
        members: [owner.email],
        memberUids: { [owner.email]: owner.uid },
        createdAt: Date.now(),
        deletionInProgress: false,
        deleted: false
    }));
});

test("unverified user cannot create a list", async () => {
    const database = testEnvironment
        .authenticatedContext(owner.uid, {
            email: owner.email,
            email_verified: false
        })
        .firestore();

    await assertFails(setDoc(doc(database, "lists", "unverified-create"), {
        title: "Should be denied",
        ownerUid: owner.uid,
        members: [owner.email],
        memberUids: { [owner.email]: owner.uid },
        deletionInProgress: false,
        deleted: false
    }));
});

test("verified member can claim only their own email-to-UID mapping", async () => {
    const member = { uid: "member-uid", email: "member@example.com" };
    await testEnvironment.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), "lists", "legacy-member-list"), {
            title: "Legacy shared list",
            ownerUid: owner.uid,
            members: [owner.email, member.email],
            deletionInProgress: false,
            deleted: false
        });
    });

    const database = testEnvironment
        .authenticatedContext(member.uid, {
            email: member.email,
            email_verified: true
        })
        .firestore();

    await assertSucceeds(updateDoc(doc(database, "lists", "legacy-member-list"), {
        memberUids: { [member.email]: member.uid }
    }));
    await assertFails(updateDoc(doc(database, "lists", "legacy-member-list"), {
        memberUids: { [member.email]: member.uid, [owner.email]: "forged-owner-uid" }
    }));
});

test("owner can transfer a list to a verified member whose UID has been established", async () => {
    const member = { uid: "transfer-member-uid", email: "transfer-member@example.com" };
    await testEnvironment.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), "lists", "transfer-list"), {
            title: "Moving list",
            ownerUid: owner.uid,
            ownerEmail: owner.email,
            members: [owner.email, member.email],
            memberUids: { [owner.email]: owner.uid, [member.email]: member.uid },
            deletionInProgress: false,
            deleted: false
        });
    });

    const ownerDatabase = testEnvironment
        .authenticatedContext(owner.uid, {
            email: owner.email,
            email_verified: true
        })
        .firestore();

    await assertSucceeds(updateDoc(doc(ownerDatabase, "lists", "transfer-list"), {
        ownerUid: member.uid,
        ownerEmail: member.email,
        members: [member.email],
        memberUids: { [member.email]: member.uid }
    }));

    const memberDatabase = testEnvironment
        .authenticatedContext(member.uid, {
            email: member.email,
            email_verified: true
        })
        .firestore();
    const transferred = await assertSucceeds(getDoc(doc(memberDatabase, "lists", "transfer-list")));
    assert.equal(transferred.data().ownerUid, member.uid);
    await assertFails(getDoc(doc(ownerDatabase, "lists", "transfer-list")));
});

test("owner can remove a member and that member's UID mapping together", async () => {
    const member = { uid: "removed-member-uid", email: "removed-member@example.com" };
    await testEnvironment.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), "lists", "remove-member-list"), {
            title: "Shared list",
            ownerUid: owner.uid,
            members: [owner.email, member.email],
            memberUids: { [owner.email]: owner.uid, [member.email]: member.uid },
            deletionInProgress: false,
            deleted: false
        });
    });

    const ownerDatabase = testEnvironment
        .authenticatedContext(owner.uid, {
            email: owner.email,
            email_verified: true
        })
        .firestore();
    await assertFails(updateDoc(doc(ownerDatabase, "lists", "remove-member-list"), {
        members: [member.email],
        memberUids: { [member.email]: member.uid }
    }));
    await assertSucceeds(updateDoc(doc(ownerDatabase, "lists", "remove-member-list"), {
        members: [owner.email],
        memberUids: { [owner.email]: owner.uid }
    }));

    const memberDatabase = testEnvironment
        .authenticatedContext(member.uid, {
            email: member.email,
            email_verified: true
        })
        .firestore();
    await assertFails(getDoc(doc(memberDatabase, "lists", "remove-member-list")));
});

test("a member can leave after task assignments and creator references are cleared", async () => {
    const member = { uid: "leaving-member-uid", email: "leaving-member@example.com" };
    await testEnvironment.withSecurityRulesDisabled(async context => {
        const database = context.firestore();
        await setDoc(doc(database, "lists", "leave-list"), {
            title: "List to leave",
            ownerUid: owner.uid,
            ownerEmail: owner.email,
            members: [owner.email, member.email],
            memberUids: { [owner.email]: owner.uid, [member.email]: member.uid },
            deletionInProgress: false,
            deleted: false
        });
        await setDoc(doc(database, "lists", "leave-list", "tasks", "member-task"), {
            title: "Task created by member",
            listId: "leave-list",
            isCompleted: false,
            assignedToEmail: member.email,
            createdByUid: member.uid
        });
    });

    const memberDatabase = testEnvironment
        .authenticatedContext(member.uid, {
            email: member.email,
            email_verified: true
        })
        .firestore();
    const taskRef = doc(memberDatabase, "lists", "leave-list", "tasks", "member-task");

    await assertSucceeds(updateDoc(taskRef, {
        assignedToEmail: "",
        createdByUid: ""
    }));
    await assertFails(updateDoc(taskRef, { createdByUid: "another-user" }));
    await assertSucceeds(updateDoc(doc(memberDatabase, "lists", "leave-list"), {
        members: [owner.email],
        memberUids: { [owner.email]: owner.uid }
    }));
    await assertFails(getDoc(doc(memberDatabase, "lists", "leave-list")));
});

test("list deletion can finish by scrubbing identifying owner and member data", async () => {
    const member = { uid: "tombstone-member-uid", email: "tombstone-member@example.com" };
    await testEnvironment.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), "lists", "tombstone-list"), {
            title: "Private list title",
            ownerUid: owner.uid,
            ownerEmail: owner.email,
            members: [owner.email, member.email],
            memberUids: { [owner.email]: owner.uid, [member.email]: member.uid },
            deletionInProgress: false,
            deleted: false
        });
        await setDoc(doc(context.firestore(), "lists", "tombstone-list", "tasks", "leftover-task"), {
            title: "Remove me",
            listId: "tombstone-list",
            isCompleted: false,
            assignedToEmail: owner.email,
            createdByUid: owner.uid
        });
    });

    const ownerDatabase = testEnvironment
        .authenticatedContext(owner.uid, {
            email: owner.email,
            email_verified: true
        })
        .firestore();
    const listRef = doc(ownerDatabase, "lists", "tombstone-list");
    await assertSucceeds(updateDoc(listRef, {
        deletionInProgress: true,
        members: [owner.email]
    }));
    const taskRef = doc(ownerDatabase, "lists", "tombstone-list", "tasks", "leftover-task");
    await assertSucceeds(getDoc(taskRef));
    await assertSucceeds(deleteDoc(taskRef));
    await assertSucceeds(updateDoc(listRef, {
        deleted: true,
        title: "Deleted list",
        ownerUid: "",
        ownerEmail: "",
        members: [],
        memberUids: {}
    }));
    await assertFails(getDoc(listRef));
    let tombstone;
    await testEnvironment.withSecurityRulesDisabled(async context => {
        tombstone = await getDoc(doc(context.firestore(), "lists", "tombstone-list"));
    });
    assert.equal(tombstone.data().ownerEmail, "");
    assert.deepEqual(tombstone.data().members, []);
});

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
    doc,
    getDoc,
    getDocs,
    query,
    setDoc,
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
        deletionInProgress: false,
        deleted: false
    }));
});

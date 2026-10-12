# Home Together

A responsive shared-list app built with Blazor WebAssembly and Firebase. Households can organize shopping and home tasks, assign work, and see changes from other signed-in members live.

## Current functionality

- Google sign-in and email/password account creation/sign-in with Firebase Authentication.
- Shared lists: create, rename, share by email, and delete.
- List owners can remove invited members from the sharing dialog.
- Tasks: create, edit, assign to a list member, complete, and delete.
- Live list and task updates through Firestore snapshot listeners.
- Profile display-name editing.
- A local demo mode when Firebase isn't configured. Demo data is saved in the current browser only; it is not an account and is not shared.
- Responsive layout, keyboard focus styling, accessible labels, and inline error feedback.

The app intentionally does not provide file uploads, reminders, integrations, or languages other than English.

## Execution board

| Status | Work |
| --- | --- |
| Done | Blazor dashboard, responsive layout, profile screen, and task/list CRUD |
| Done | Firebase Google/email-password sign-in and Firestore live-list/task integration |
| Done | Firestore authorization rules and GitHub Pages deployment workflow |
| Needs project setup | Create the Firebase project, add its Web app config, enable Google and Email/Password sign-in, publish `firestore.rules`, and authorize the app domains |
| Needs final verification | Test two real Google accounts collaborating from separate browsers; verify the deployed Pages URL and mobile layout |
| Course deliverable | Record the walkthrough in the presentation checklist below and add the repository/demo links to the course submission |

The local demo is usable before Firebase setup, but it is intentionally not a substitute for testing the cloud collaboration flow with real accounts.

## Run the local demo

Install the .NET 10 SDK, then run:

```sh
dotnet run
```

Open the URL printed by the .NET development server. On the welcome screen enter any display name and email to explore the local-only demo. Lists, tasks, and profile data are stored in this browser's local storage.

## Connect Firebase

1. Create a Firebase project and register a **Web app**.
2. In **Authentication → Sign-in method**, enable **Google** and **Email/Password**. Add your local development host and the deployed GitHub Pages host to **Authorized domains**.
3. Create a Firestore database in Native mode.
4. For local development, copy `firebase-config.local.example.js` from the project root to `wwwroot/firebase-config.local.js` and fill in the Web app's `apiKey`, `authDomain`, `projectId`, and `appId`. The local config works with `dotnet run` but is explicitly excluded from publish output.
5. Publish the included `firestore.rules` from the Firebase console or Firebase CLI. The rules restrict list access to signed-in list members, list administration to its owner, and task updates to members. List deletion uses an owner-only tombstone to close member access before removing tasks; the parent document is retained to prevent a deleted list ID from being reused to expose orphaned tasks.
6. Run the app again. The welcome screen offers Google sign-in, email/password sign-in, and email/password account creation.

Email/password account creation sends an email verification link. The new user must verify their address before signing in and using Firestore; an unverified sign-in attempt sends a fresh verification link. Google sign-in is available as an alternative.

Firebase Web app config is necessarily delivered to the browser, including when supplied through build variables. Its API key identifies the Firebase project; it is not a password or authorization token. Do not put service-account credentials or other private secrets in this app. Protect data with Firebase Authentication, Firestore Security Rules, and appropriate API-key restrictions in Google Cloud. The rules require verified email addresses before granting access.

Sharing adds a lower-case email to a list's member array. In the **People on this list** dialog, the owner can use **Remove** beside an invitee and confirm to revoke their access. The owner cannot remove themselves; delete the list if it is no longer needed. The invited person must sign in with the shared email; no email or push notification is sent. Firestore rules are the authorization boundary, not the client UI.

Cloud list deletion first blocks member access, removes the list's tasks in batches, then marks the parent document as deleted. Firestore does not cascade subcollection deletes, and this browser-only app cannot safely hard-delete the parent while guaranteeing the task cleanup is race-free. The hidden tombstone is retained to prevent the list ID from being recreated while orphaned task documents might remain. Permanently purging tombstones would require a trusted backend cleanup function.

### Data layout

- `users/{uid}` — editable display name and account information.
- `lists/{listId}` — title, owner UID, lower-case member email array, creation time, and deletion state. Deleted lists remain as hidden tombstones.
- `lists/{listId}/tasks/{taskId}` — title, completion state, optional assignee email, creator UID, and creation time.

## GitHub Pages deployment

The workflow at `.github/workflows/deploy-pages.yml` publishes the app on pushes to `main` and on manual dispatch.

1. Set the repository's **Settings → Pages → Build and deployment** source to **GitHub Actions**.
2. Connect Firebase and add the deployed `OWNER.github.io` host (or custom domain) to Firebase Authentication's authorized domains.
3. In **Settings → Secrets and variables → Actions → Variables**, add `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, and `FIREBASE_APP_ID`. These repository variables keep the values out of source control, but the generated browser config remains public in the deployed app. If all four variables are absent, the site deploys in local-demo mode; if only some are set, the workflow fails.
4. Push to `main` or run **Deploy Blazor app to GitHub Pages** from the Actions tab.

The workflow sets the repository-name base path for project Pages URLs. For local Firebase development, use the ignored `wwwroot/firebase-config.local.js` file described above. Never put service-account credentials in GitHub variables, source control, or browser code.

## Course presentation checklist

A short walkthrough can demonstrate:

1. Sign in with Google (or introduce local demo mode if Firebase is not configured).
2. Create and rename a list, then show the list picker.
3. Add a task, assign it, edit it, complete it, and delete it; show the progress and filters update.
4. Share by email, then demonstrate the same list updating in a second signed-in browser.
5. Update the profile display name and sign out.
6. Explain the Firestore rules and note that notifications, uploads, and third-party integrations are intentionally out of scope.

## Build

```sh
dotnet build SharedTodoList.csproj
dotnet publish SharedTodoList.csproj --configuration Release
```

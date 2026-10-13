# Home Together

Home Together is a shared shopping and household task list. It is for people who want one simple place to decide what needs doing, assign a task, and keep everyone up to date.

The app is built with .NET Blazor WebAssembly. Firebase handles sign-in and cloud data; GitHub Pages hosts the published site.

## What you can do

- Sign in with Google, or make an email-and-password account.
- Create, rename, share, and delete lists.
- Add tasks, edit them, assign them to a list member, mark them done, or remove them.
- See list and task changes as other members make them.
- Change the display name on your profile.
- Try a local demo without connecting to Firebase. Demo data stays in this browser and is not shared.

There are no reminders, uploads, or connections to other apps. The interface is in English.

## Try the local demo

You need the .NET 10 SDK. From the project folder, run:

```sh
dotnet run
```

Open the local address printed in the terminal. If Firebase hasn't been configured, enter any name and email on the welcome screen and choose **Explore the demo**. The demo starts with a sample grocery list; anything you change is saved in this browser only.

## Connect Firebase for shared lists

These steps are for the person setting up the Firebase project:

1. Create a Firebase project and register a Web app.
2. In **Authentication → Sign-in method**, enable Google and Email/Password. Add both your local development domain and your GitHub Pages domain to **Authorized domains**.
3. Create a Firestore database in Native mode.
4. Copy `firebase-config.local.example.js` from the project root to `wwwroot/firebase-config.local.js`. Fill in the Web app's `apiKey`, `authDomain`, `projectId`, and `appId`.
5. Publish the project's `firestore.rules` in the Firebase console.
6. Run the app again and sign in. Email-and-password accounts must verify their email before they can use shared lists.

The local config file is ignored by Git and is left out of published output. Firebase Web configuration is still visible in a browser; it identifies the Firebase project, but is not an admin credential or a password. Never put a service-account key in this app. Firestore Security Rules and Firebase Authentication are what protect the data.

### Invite someone

Open a list and choose **Share**. Add the email address the other person will use to sign in. They need to open the app and sign in with that address; the app does not send an invitation email. The list owner can remove another member from the same dialog. The owner can't remove themselves; delete the list instead if it is no longer needed.

### Delete a list

Deleting a cloud list first closes member access, removes its tasks, and then marks the list as deleted. The parent document is kept as a hidden record. Firestore doesn't delete subcollection documents automatically, so keeping that record avoids reusing a list ID while leftover tasks might still exist.

### Delete your account

Open your profile and choose **Delete account**. Email-and-password accounts are asked for their password again; Google accounts ask you to confirm with Google. Lists you own that are shared with others need a decision first: delete the list and its tasks, or transfer it to a collaborator who has signed in since ownership transfer was added. A collaborator who hasn't signed in yet won't be offered as a transfer option; ask them to sign in once, then reopen the profile.

For lists owned by someone else, account deletion removes your membership and changes tasks assigned to you back to **Anyone**. Tasks you created are kept, but their creator reference is cleared. Your Firebase profile record and sign-in are deleted after list cleanup completes. If cleanup hits an error, already-finished list changes may remain; review the affected lists and retry. If Firebase refuses the final account deletion, the profile record may already be gone while sign-in still works, so sign in again and retry.

In local demo mode, this button only clears the demo data stored in the current browser. It does not delete a Firebase account.

## Run the Firestore rules tests

The emulator tests use a made-up demo project ID and local data; they do not connect to or change the production Firebase project. Install Node.js and Java 21 or later, then run:

```sh
npm install
npm run test:rules
```

The tests check the member-filtered list query, list creation, verified membership identity, member removal and leaving, ownership transfer, task anonymization, deleted-list cleanup, and denial of unfiltered reads and unverified users. A passing rules test is useful, but it doesn't replace trying the full app with two real accounts.

## Publish to GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` publishes the app when code is pushed to `main`, or when the workflow is run manually from GitHub Actions.

1. In **Settings → Pages**, set the source to **GitHub Actions**.
2. Add the deployed site's domain to Firebase Authentication's authorized domains.
3. In **Settings → Secrets and variables → Actions → Variables**, set `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, and `FIREBASE_APP_ID`.
4. Push to `main` or run **Deploy Blazor app to GitHub Pages** from the Actions tab.

Set all four Firebase variables or leave all four empty. If they're empty, the published site opens in local-demo mode. If only some are set, the workflow stops instead of publishing a partly configured app.

## Build the app

```sh
dotnet build SharedTodoList.csproj
dotnet publish SharedTodoList.csproj --configuration Release
```

## Course presentation and project board

The app's demo outline, accessibility check reminders, and suggested Trello cards are in [`docs/PROJECT-PRESENTATION.md`](docs/PROJECT-PRESENTATION.md). They are preparation notes, not a Trello board or a recorded presentation; the group still needs to create the board, divide the work, record the video, and submit the required links.

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

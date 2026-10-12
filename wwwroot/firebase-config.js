// Safe-to-commit fallback values. Firebase client config identifies the project; it
// does not grant database access. Firestore Security Rules must enforce authorization.
export const firebaseConfig = {
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: ""
};

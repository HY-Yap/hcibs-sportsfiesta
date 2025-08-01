import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDYSel3WBMz0bJEnYIpyAlefHXa-UdEE7Y",
  authDomain: "hcibs-sportsfiesta.firebaseapp.com",
  projectId: "hcibs-sportsfiesta",
  storageBucket: "hcibs-sportsfiesta.firebasestorage.app",
  messagingSenderId: "1059800316877",
  appId: "1:1059800316877:web:e5b4a29f8c53f36ca62284",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export { auth };

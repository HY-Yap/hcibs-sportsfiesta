'use client';

import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../js/firebase_config';

export default function Page() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setError('');
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        window.location.href = '/'; {/*placeholder for redirection*/}
    } catch (err: any) {
        console.error(err.code); 

        switch (err.code) {
        case 'auth/invalid-email':
            setError('Invalid email.');
            break;
        case 'auth/user-not-found':
            setError('No account found with that email.');
            break;
        case 'auth/wrong-password':
            setError('Incorrect password.');
            break;
        case 'auth/too-many-requests':
            setError('Too many failed attempts. Try again later.');
            break;
        default:
            setError('Login failed. Please try again.');
        }
    }
    };

  return (
    
    <div className="w-screen h-screen flex items-center justify-center">
      <div className="w-full max-w-sm flex flex-col gap-4 bg-blue-300/50 rounded-xl p-10 border-2 border-blue-400/50 shadow-lg shadow-blue-200">
        <h2 className="text-5xl font-bold text-center">SPORTS FIESTA</h2> {/*placeholder for title*/}
        <p className="text-2xl font-bold text-center">Login</p>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="text-lg bg-blue-300/50 border-2 border-blue-400/50 w-full rounded-lg focus:outline-none px-3 py-1 focus:border-blue-500/50 focus:bg-blue-400/50"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="text-lg bg-blue-300/50 border-2 border-blue-400/50 w-full rounded-lg focus:outline-none px-3 py-1 focus:border-blue-500/50 focus:bg-blue-400/50 mb-3"
        />
        <button 
            onClick={handleLogin}
            className="w-full bg-blue-300/50 border-2 border-blue-400 hover:bg-blue-400/50 hover:border-blue-500 py-2 rounded-lg text-lg transition-all duration-300 hover:scale-105 active:scale-100 hover:shadow-md shadow-blue-600 cursor-pointer"
        >
          Login
        </button>

        {error && <p className="text-red-600 text-sm text-center mt-1">{error}</p>}
      </div>
    </div>
  );
}

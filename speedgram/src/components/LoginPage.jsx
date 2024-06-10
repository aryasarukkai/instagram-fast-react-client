import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Notyf } from 'notyf';
import 'notyf/notyf.min.css';
import { isLoggedIn } from '../utils';
import { login } from '../instagramService';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const notyf = new Notyf();

  useEffect(() => {
    if (isLoggedIn()) {
      navigate('/home');
    }
  }, [navigate]);

  const handleLogin = async () => {
    try {
      const result = await login(username, password);
      if (result.success) {
        localStorage.setItem('ig_session', JSON.stringify(result.session));
        notyf.success('Login successful! Redirecting...');
        navigate('/home');
      } else {
        notyf.error(result.message);
      }
    } catch (error) {
      console.error('Login failed:', error);
      notyf.error(error.message || 'An unknown error occurred. Please try again.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-r from-blue-800 to-pink-900 px-4 sm:px-0">
      <img src="https://speedgram.dev/logo.png" alt="Speedgram Logo" className="mx-auto h-24 mb-8 rounded-lg" />
      <h1 className="text-4xl sm:text-5xl font-bold mb-8 text-white text-center" style={{ fontFamily: 'Georgia' }}>
        speedgram
      </h1>
      <div className="bg-gray-800 p-8 rounded shadow-md mx-4 sm:mx-0">
        <h2 className="text-xl sm:text-2xl font-bold mb-8 text-white text-center" style={{ fontFamily: 'Cabin' }}>
          Login with Instagram
        </h2>
        <input
          type="text"
          placeholder="Instagram Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full mb-4 p-2 bg-gray-700 rounded text-white"
          style={{ fontFamily: 'Cabin' }}
        />
        <input
          type="password"
          placeholder="Instagram Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-8 p-2 bg-gray-700 rounded text-white"
          style={{ fontFamily: 'Cabin' }}
        />
        <div className="flex flex-col sm:flex-row items-center justify-between">
          <button
            onClick={handleLogin}
            className="bg-indigo-400 hover:bg-indigo-300 text-gray-100 font-bold py-2 px-4 rounded mb-4 sm:mb-0"
            style={{ fontFamily: 'Cabin' }}
          >
            Login
          </button>
          <a
            href="https://www.instagram.com/accounts/emailsignup/"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-indigo-400 hover:bg-indigo-300 text-gray-100 font-bold py-2 px-4 rounded mb-4 sm:mb-0 sm:ml-4"
            style={{ fontFamily: 'Cabin' }}
          >
            Register via Instagram
          </a>
          <Link
            to="/"
            className="bg-indigo-400 hover:bg-indigo-300 text-gray-100 font-bold py-2 px-4 rounded mb-4 sm:mb-0 sm:ml-4"
            style={{ fontFamily: 'Cabin' }}
          >
            ⬅️ Back
          </Link>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

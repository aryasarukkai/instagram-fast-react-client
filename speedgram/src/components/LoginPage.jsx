import React, { useState } from 'react';
import { IgApiClient } from 'instagram-private-api';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async () => {
    const ig = new IgApiClient();
    ig.state.generateDevice(process.env.IG_USERNAME);
    ig.state.proxyUrl = process.env.IG_PROXY;

    try {
      await ig.simulate.preLoginFlow();
      const loggedInUser = await ig.account.login(username, password);
      process.nextTick(async () => await ig.simulate.postLoginFlow());

      // Save the session for future use
      localStorage.setItem('ig_session', JSON.stringify(ig.state.serialize()));

      // Redirect to the main app or dashboard
      window.location.href = '/dashboard';
    } catch (error) {
      console.error('Login failed:', error);
      // Display an error message to the user
      alert('Login failed. Please check your credentials and try again.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h2 className="text-2xl font-bold mb-8">Login to Speedgram</h2>
      <div className="bg-gray-800 p-8 rounded shadow-md">
        <input
          type="text"
          placeholder="Instagram Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full mb-4 p-2 bg-gray-700 rounded"
        />
        <input
          type="password"
          placeholder="Instagram Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-8 p-2 bg-gray-700 rounded"
        />
        <button
          onClick={handleLogin}
          className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded"
        >
          Login
        </button>
      </div>
    </div>
  );
};

export default LoginPage;
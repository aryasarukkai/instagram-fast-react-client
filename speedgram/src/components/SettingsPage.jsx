import React, { useState, useEffect } from 'react';
import { updateProfile, deserializeSession } from '../instagramService';
import { Notyf } from 'notyf';
import 'notyf/notyf.min.css';

const notyf = new Notyf();

const SettingsPage = () => {
  const [profileData, setProfileData] = useState({
    username: '',
    email: '',
    phone_number: '',
    // Add other profile fields as needed
  });
  const [error, setError] = useState('');

  useEffect(() => {
    const session = JSON.parse(localStorage.getItem('ig_session'));
    deserializeSession(session);
  }, []);

  const handleUpdateProfile = async () => {
    try {
      await updateProfile(profileData);
      notyf.success('Profile updated!');
    } catch (error) {
      console.error('Failed to update profile:', error);
      notyf.error(error.message);
      setError(error.message);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfileData({
      ...profileData,
      [name]: value,
    });
  };

  return (
    <div className="flex flex-col items-center min-h-screen bg-gradient-to-br from-teal-400 to-black text-white">
      <h2 className="text-2xl font-bold mb-4">Settings</h2>
      <div className="w-full max-w-4xl p-4">
        {error && <div className="text-red-500 mb-4">{error}</div>}
        <div className="space-y-4">
          <input
            type="text"
            name="username"
            placeholder="Username"
            value={profileData.username}
            onChange={handleChange}
            className="w-full mb-4 p-2 bg-gray-700 rounded text-white"
          />
          <input
            type="email"
            name="email"
            placeholder="Email"
            value={profileData.email}
            onChange={handleChange}
            className="w-full mb-4 p-2 bg-gray-700 rounded text-white"
          />
          <input
            type="tel"
            name="phone_number"
            placeholder="Phone Number"
            value={profileData.phone_number}
            onChange={handleChange}
            className="w-full mb-4 p-2 bg-gray-700 rounded text-white"
          />
          <button
            onClick={handleUpdateProfile}
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded"
          >
            Update Profile
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
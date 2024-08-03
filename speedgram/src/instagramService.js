// instagramService.js

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const API_URL = 'https://i.instagram.com/api/v1/';
const USER_AGENT = 'Instagram 76.0.0.15.395 Android (24/7.0; 640dpi; 1440x2560; samsung; SM-G930F; herolte; samsungexynos8890; en_US; 138226743)';

let session = null;

const generateDeviceId = () => uuidv4();

async function generateSignature(data) {
  const encoder = new TextEncoder();
  const key = encoder.encode('68a04945eb02970e2e8d15266fc256f7');
  const message = encoder.encode(data);

  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await window.crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    message
  );

  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function createPayload(data) {
  const signature = await generateSignature(JSON.stringify(data));
  return `signed_body=${signature}.${encodeURIComponent(JSON.stringify(data))}`;
}

export const login = async (username, password) => {
  const deviceId = generateDeviceId();
  const data = {
    username,
    password,
    device_id: deviceId,
    login_attempt_count: '0'
  };

  const payload = await createPayload(data);

  try {
    const response = await axios.post(`${API_URL}accounts/login/`, payload, {
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (response.status === 200) {
      session = response.data;
      return { success: true, session: response.data };
    } else {
      return { success: false, message: 'Login failed' };
    }
  } catch (error) {
    console.error("An error occurred:", error);
    return { success: false, message: error.response?.data?.message || 'An unknown error occurred' };
  }
};

export const deserializeSession = (sessionData) => {
  session = sessionData;
};

export const getFeed = async () => {
  if (!session) {
    throw new Error('Not logged in');
  }

  try {
    const response = await axios.get(`${API_URL}feed/timeline/`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Authorization': `Bearer ${session.token}`
      }
    });

    return response.data;
  } catch (error) {
    console.error("An error occurred:", error);
    throw error;
  }
};

export const getUserInfo = async (username) => {
  if (!session) {
    throw new Error('Not logged in');
  }

  try {
    const response = await axios.get(`${API_URL}users/${username}/usernameinfo/`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Authorization': `Bearer ${session.token}`
      }
    });

    return response.data;
  } catch (error) {
    console.error("An error occurred:", error);
    throw error;
  }
};

export const getDirectMessages = async () => {
  if (!session) {
    throw new Error('Not logged in');
  }

  try {
    const response = await axios.get(`${API_URL}direct_v2/inbox/`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Authorization': `Bearer ${session.token}`
      }
    });

    return response.data;
  } catch (error) {
    console.error("An error occurred:", error);
    throw error;
  }
};

export const sendDirectMessage = async (recipientId, message) => {
  if (!session) {
    throw new Error('Not logged in');
  }

  const data = {
    recipient_users: `[[${recipientId}]]`,
    client_context: uuidv4(),
    thread_ids: [],
    text: message
  };

  const payload = await createPayload(data);

  try {
    const response = await axios.post(`${API_URL}direct_v2/threads/broadcast/text/`, payload, {
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${session.token}`
      }
    });

    return response.data;
  } catch (error) {
    console.error("An error occurred:", error);
    throw error;
  }
};

export const updateProfile = async (profileData) => {
  if (!session) {
    throw new Error('Not logged in');
  }

  const payload = await createPayload(profileData);

  try {
    const response = await axios.post(`${API_URL}accounts/edit_profile/`, payload, {
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${session.token}`
      }
    });

    return response.data;
  } catch (error) {
    console.error("An error occurred:", error);
    throw error;
  }
};

// add some more but like later
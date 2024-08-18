import { v4 as uuidv4 } from 'uuid';
import CryptoJS from 'crypto-js';

import { Buffer } from 'buffer/';

const API_URL = 'https://i.instagram.com/api/v1/';
const USER_AGENT = 'Instagram 200.0.0.24.121 Android (24/7.0; 640dpi; 1440x2392; Samsung; SGH-T849; SGH-T849; hi3660; en_US; 304101669)';

let session = null;
let csrfToken = null;
let cookies = '';

const generateUUID = () => uuidv4().replace(/-/g, '');

const generateDeviceId = () => {
  return 'android-' + CryptoJS.MD5(Math.random().toString()).toString().substring(0, 16);
};
async function sendMessageToExtension(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage('njdidabcneoijpjohimfnbjmkbilppnb', message, response => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

async function createPayload(data) {
  return sendMessageToExtension({
    action: 'createPayload',
    data: data
  });
}

async function fetchCsrfToken() {
  const response = await sendMessageToExtension({
    action: 'makeRequest',
    method: 'GET',
    url: 'https://www.instagram.com/',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US',
    }
  });

  console.log('Full response:', response);

  // Extract CSRF token from HTML response
  const htmlContent = response.data;
  const csrfMatch = htmlContent.match(/"csrf_token":"([^"]+)"/);
  if (csrfMatch && csrfMatch[1]) {
    csrfToken = csrfMatch[1];
  } else {
    console.error('CSRF token not found in HTML response');
    throw new Error('Failed to extract CSRF token from response');
  }

  // Extract cookies from response headers
  if (response.responseHeaders && response.responseHeaders['set-cookie']) {
    cookies = response.responseHeaders['set-cookie'].join('; ');
  }

  console.log('CSRF Token:', csrfToken);
  console.log('Cookies:', cookies);
}

export const login = async (username, password) => {
  try {
    await fetchCsrfToken();

    const uuid = generateUUID();
    const phoneId = generateUUID();
    const androidId = generateDeviceId();
    const deviceId = generateUUID();

    const signedBody = JSON.stringify({
      jazoest: generateJazoest(phoneId),
      country_codes: JSON.stringify([{"country_code":"1","source":["default"]}]),
      phone_id: phoneId,
      enc_password: `#PWD_INSTAGRAM:0:${Math.floor(Date.now() / 1000)}:${password}`,
      username,
      adid: generateUUID(),
      guid: uuid,
      device_id: androidId,
      google_tokens: "[]",
      login_attempt_count: "0",
      _csrftoken: csrfToken  // Include CSRF token in the payload
    });

    const payload = `signed_body=SIGNATURE.${encodeURIComponent(signedBody)}`;

    const response = await sendMessageToExtension({
      action: 'makeRequest',
      method: 'POST',
      url: `${API_URL}accounts/login/`,
      data: payload,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US',
        'X-IG-App-Locale': 'en_US',
        'X-IG-Device-Locale': 'en_US',
        'X-IG-Mapped-Locale': 'en_US',
        'X-Pigeon-Session-Id': 'UFS-' + generateUUID(),
        'X-Pigeon-Rawclienttime': (Date.now() / 1000).toFixed(3),
        'X-IG-Connection-Speed': '-1kbps',
        'X-IG-Bandwidth-Speed-KBPS': '-1.000',
        'X-IG-Bandwidth-TotalBytes-B': '0',
        'X-IG-Bandwidth-TotalTime-MS': '0',
        'X-IG-App-Startup-Country': 'US',
        'X-Bloks-Version-Id': '5f56efad68e1edec7801f630b5c122704ceed7b34a81871aed7dcc6eb811bd7f',
        'X-IG-WWW-Claim': '0',
        'X-Bloks-Is-Layout-RTL': 'false',
        'X-Bloks-Is-Panorama-Enabled': 'true',
        'X-IG-Device-ID': uuid,
        'X-IG-Android-ID': androidId,
        'X-IG-Connection-Type': 'WIFI',
        'X-IG-Capabilities': '3brTvwE=',
        'X-IG-App-ID': '567067343352427',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept-Encoding': 'gzip, deflate',
        'Host': 'i.instagram.com',
        'X-FB-HTTP-Engine': 'Liger',
        'Connection': 'keep-alive',
        'Content-Length': payload.length.toString(),
        'Cookie': cookies,
        'X-CSRFToken': csrfToken  // Include CSRF token in the headers
      }
    });

    console.log('Login response:', response);

    if (response.status === 200) {
      const responseData = JSON.parse(response.data);
      session = {
        userId: responseData.logged_in_user.pk,
        sessionId: responseData.sessionid,
        csrfToken: csrfToken,
        rankToken: `${responseData.logged_in_user.pk}_${uuid}`,
        authorization: response.responseHeaders['ig-set-authorization'],
      };

      // Save session to browser storage
      chrome.storage.local.set({ 'igSession': session }, function() {
        console.log('Session saved to browser storage');
      });

      return { success: true, session: session };
    } else {
      return { success: false, message: 'Login failed: ' + (response.data || 'Unknown error') };
    }
  } catch (error) {
    console.error("An error occurred during login:", error);
    return { success: false, message: error.message || 'An unknown error occurred' };
  }
};

// Helper functions
function generateJazoest(input) {
  let buf = Buffer.from(input, 'utf8');
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    sum += buf[i];
  }
  return `2${sum}`;
}


export const deserializeSession = (sessionData) => {
  session = sessionData;
};

export const getFeed = async () => {
  if (!session) {
    throw new Error('Not logged in');
  }

  try {
    const response = await sendMessageToExtension({
      action: 'makeRequest',
      method: 'GET',
      url: `${API_URL}feed/timeline/`,
      headers: {
        'User-Agent': USER_AGENT,
        'Authorization': `Bearer ${session.token}`,
        'X-CSRFToken': csrfToken,
        'Cookie': cookies
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
    const response = await sendMessageToExtension({
      action: 'makeRequest',
      method: 'GET',
      url: `${API_URL}users/${username}/usernameinfo/`,
      headers: {
        'User-Agent': USER_AGENT,
        'Authorization': `Bearer ${session.token}`,
        'X-CSRFToken': csrfToken,
        'Cookie': cookies
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
    const response = await sendMessageToExtension({
      action: 'makeRequest',
      method: 'GET',
      url: `${API_URL}direct_v2/inbox/`,
      headers: {
        'User-Agent': USER_AGENT,
        'Authorization': `Bearer ${session.token}`,
        'X-CSRFToken': csrfToken,
        'Cookie': cookies
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
    const response = await sendMessageToExtension({
      action: 'makeRequest',
      method: 'POST',
      url: `${API_URL}direct_v2/threads/broadcast/text/`,
      data: payload,
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${session.token}`,
        'X-CSRFToken': csrfToken,
        'Cookie': cookies
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
    const response = await sendMessageToExtension({
      action: 'makeRequest',
      method: 'POST',
      url: `${API_URL}accounts/edit_profile/`,
      data: payload,
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${session.token}`,
        'X-CSRFToken': csrfToken,
        'Cookie': cookies
      }
    });

    return response.data;
  } catch (error) {
    console.error("An error occurred:", error);
    throw error;
  }
};

// Add more functions as needed
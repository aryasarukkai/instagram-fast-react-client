import { v4 as uuidv4 } from 'uuid';

const API_URL = 'https://i.instagram.com/api/v1/';
const USER_AGENT = 'Instagram 76.0.0.15.395 Android (24/7.0; 640dpi; 1440x2560; samsung; SM-G930F; herolte; samsungexynos8890; en_US; 138226743)';

let session = null;
let csrfToken = null;
let cookies = '';

const generateDeviceId = () => uuidv4();

async function sendMessageToExtension(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage('afhanfmghmpepaadkdoohlkbnincmneo', message, response => {
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
      'User-Agent': USER_AGENT
    }
  });

  const csrfTokenMatch = response.data.match(/"csrf_token":"(.*?)"/);
  if (csrfTokenMatch) {
    csrfToken = csrfTokenMatch[1];
    cookies = response.headers['set-cookie'].join('; ');
  } else {
    throw new Error('Unable to fetch CSRF token');
  }
}

export const login = async (username, password) => {
  await fetchCsrfToken();

  const deviceId = generateDeviceId();
  const data = {
    username,
    password,
    device_id: deviceId,
    login_attempt_count: '0'
  };

  const payload = await createPayload(data);

  try {
    const response = await sendMessageToExtension({
      action: 'makeRequest',
      method: 'POST',
      url: `${API_URL}accounts/login/`,
      data: payload,
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': csrfToken,
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookies
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
    return { success: false, message: error.message || 'An unknown error occurred' };
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
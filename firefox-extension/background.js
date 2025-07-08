// Log when the background script is loaded
console.log('Instagram API Extension Background Script loaded');

// Firefox uses browser.runtime instead of chrome.runtime
const runtime = typeof browser !== 'undefined' ? browser : chrome;

runtime.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  console.log('Received request:', request);

  if (request.action === 'makeRequest') {
    console.log('Making request to:', request.url);
    console.log('Request method:', request.method);
    console.log('Request headers:', request.headers);
    console.log('Request data:', request.data);

    fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.data,
      credentials: 'include'
    })
    .then(async response => {
      console.log('Received response from:', request.url);
      console.log('Response status:', response.status);

      const data = await response.text();
      console.log('Response data:', data);

      const responseHeaders = {};
      for (let [key, value] of response.headers) {
        if (key.toLowerCase() === 'set-cookie') {
          if (!responseHeaders[key]) {
            responseHeaders[key] = [];
          }
          responseHeaders[key].push(value);
        } else {
          responseHeaders[key] = value;
        }
      }
      console.log('Response headers:', responseHeaders);

      sendResponse({
        status: response.status,
        data: data,
        responseHeaders: responseHeaders,
        requestHeaders: request.headers
      });
    })
    .catch(error => {
      console.error('Error in fetch:', error);
      sendResponse({error: error.message});
    });
    return true; // Indicates that we will send a response asynchronously
  } else if (request.action === 'createPayload') {
    console.log('Creating payload for:', request.data);
    try {
      const payload = Object.keys(request.data)
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(request.data[key])}`)
        .join('&');
      console.log('Created payload:', payload);
      sendResponse(payload);
    } catch (error) {
      console.error('Error creating payload:', error);
      sendResponse({ error: error.message });
    }
    return true;
  } else {
    console.log('Unknown action:', request.action);
    sendResponse({ error: 'Unknown action' });
  }
});

// Handle webRequest for CORS
if (runtime.webRequest) {
  runtime.webRequest.onBeforeSendHeaders.addListener(
    function(details) {
      details.requestHeaders.push({
        name: 'Origin',
        value: 'https://www.instagram.com'
      });
      return {requestHeaders: details.requestHeaders};
    },
    {urls: ["https://*.instagram.com/*"]},
    ["blocking", "requestHeaders"]
  );
}
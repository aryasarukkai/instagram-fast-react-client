chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.action === 'makeRequest') {
    fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.data,
      credentials: 'include'  // This ensures cookies are sent with the request
    })
    .then(async response => {
      const data = await response.text();
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
      sendResponse({
        status: response.status,
        data: data,
        responseHeaders: responseHeaders,
        requestHeaders: request.headers // Send back the request headers as well
      });
    })
    .catch(error => {
      sendResponse({error: error.message});
    });
    return true; // Indicates that we will send a response asynchronously
  }
});

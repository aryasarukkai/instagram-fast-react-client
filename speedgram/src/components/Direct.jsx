import React, { useEffect, useState } from 'react';
import { getDirectMessages, sendDirectMessage, deserializeSession } from '../instagramService';
import { Notyf } from 'notyf';
import 'notyf/notyf.min.css';

const notyf = new Notyf();

const Direct = () => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const session = JSON.parse(localStorage.getItem('ig_session'));
        deserializeSession(session);

        const messagesResponse = await getDirectMessages();
        setMessages(messagesResponse.inbox.threads);
      } catch (error) {
        console.error('Failed to fetch data:', error);
        notyf.error(error.message);
        setError(error.message);
      }
    };

    fetchData();
  }, []);

  const handleSendMessage = async () => {
    try {
      await sendDirectMessage(recipientId, newMessage);
      notyf.success('Message sent!');
      setNewMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
      notyf.error(error.message);
      setError(error.message);
    }
  };

  return (
    <div className="flex flex-col items-center min-h-screen bg-gradient-to-br from-green-500 to-black text-white">
      <h2 className="text-2xl font-bold mb-4">Direct Messages</h2>
      <div className="w-full max-w-4xl p-4">
        {error && <div className="text-red-500 mb-4">{error}</div>}
        <div className="space-y-4 overflow-auto h-[75vh]">
          {messages.map((thread, index) => (
            <div key={index} className="bg-white text-black p-4 rounded-lg shadow-md">
              <div className="font-bold mb-2">{thread.users.map(user => user.username).join(', ')}</div>
              {thread.items.map((item, idx) => (
                <div key={idx} className="mb-2">
                  <div>{item.text}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-4">
          <input
            type="text"
            placeholder="Recipient ID"
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            className="w-full mb-4 p-2 bg-gray-700 rounded text-white"
          />
          <input
            type="text"
            placeholder="New Message"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            className="w-full mb-4 p-2 bg-gray-700 rounded text-white"
          />
          <button
            onClick={handleSendMessage}
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded"
          >
            Send Message
          </button>
        </div>
      </div>
    </div>
  );
};

export default Direct;
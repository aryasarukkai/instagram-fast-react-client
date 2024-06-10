import React, { useEffect, useState } from 'react';
import axios from 'axios';
import config from '../config.json'; // Import the config file
import FloatingToolbar from './FloatingToolbar';

const HomePage = () => {
  const [feed, setFeed] = useState([]);
  const [reels, setReels] = useState([]);
  const [inbox, setInbox] = useState([]);

  const session = JSON.parse(localStorage.getItem('ig_session'));

  useEffect(() => {
    const fetchData = async () => {
      try {
        const feedResponse = await axios.get(`${config.api_url}/feed`, {
          headers: { session: JSON.stringify(session) },
        });
        setFeed(feedResponse.data.items);

        const reelsResponse = await axios.get(`${config.api_url}/reels`, {
          headers: { session: JSON.stringify(session) },
        });
        setReels(reelsResponse.data.items);

        const inboxResponse = await axios.get(`${config.api_url}/direct/inbox`, {
          headers: { session: JSON.stringify(session) },
        });
        setInbox(inboxResponse.data.threads);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      }
    };

    fetchData();
  }, [session]);

  return (
    <div className="flex flex-col items-center min-h-screen bg-gradient-to-r from-black to-pink-900 text-white">
      <FloatingToolbar />
      <div className="w-full max-w-4xl p-4 mt-8">
        <h2 className="text-2xl font-bold mb-4">Feed</h2>
        <ul className="mb-8">
          {feed.map((item, index) => (
            <li key={index} className="mb-2">
              {item.caption ? item.caption.text : 'No caption'}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default HomePage;

import React, { useEffect, useState } from 'react';
import { getFeed, deserializeSession } from '../instagramService'; // Update the import path as needed
import FloatingToolbar from './FloatingToolbar';
import { Notyf } from 'notyf';
import 'notyf/notyf.min.css';
const notyf = new Notyf();
const HomePage = () => {
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState('');

  const session = JSON.parse(localStorage.getItem('ig_session'));

  useEffect(() => {
    const fetchData = async () => {
      try {
        await deserializeSession(session);

        const feedResponse = await getFeed();
        setFeed(feedResponse.items);
      } catch (error) {
        console.error('Failed to fetch data:', error);
        notyf.error(error.message);
        
      }
    };

    fetchData();
  }, [session]);

  return (
    <div className="flex flex-col items-center min-h-screen bg-gradient-to-r from-black to-pink-900 text-white">
      <FloatingToolbar />
      <div className="w-full max-w-4xl p-4 mt-8">
        {error && <div className="text-red-500 mb-4">{error}</div>}
        <h2 className="text-2xl font-bold mb-4">Feed</h2>
        <div className="space-y-4 overflow-auto h-[75vh]">
          {feed.map((item, index) => (
            <div key={index} className="bg-white text-black p-4 rounded-lg shadow-md">
              <div className="font-bold mb-2">{item.user.username}</div>
              <img src={item.image_versions2.candidates[0].url} alt="" className="w-full mb-2" />
              <div>{item.caption ? item.caption.text : 'No caption'}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HomePage;

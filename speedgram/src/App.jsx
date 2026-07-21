import { Navigate, Route, Routes } from 'react-router-dom';
import logo from './assets/speedgram-logo.png';
import { AuthProvider, useAuth } from './auth/AuthContext';
import ActivityPage from './components/ActivityPage';
import Direct from './components/Direct';
import ExplorePage from './components/ExplorePage';
import HomePage from './components/HomePage';
import LoginPage from './components/LoginPage';
import ProfilePage from './components/ProfilePage';
import ReelsPage from './components/ReelsPage';

const BootstrapScreen = () => (
  <main className="bootstrap-screen">
    <img className="bootstrap-mark" src={logo} alt="SpeedGram" width="88" height="88" />
    <div className="bootstrap-line"><span /></div>
  </main>
);

const RoutedApp = () => {
  const { authState } = useAuth();
  if (authState.status === 'booting') return <BootstrapScreen />;

  if (authState.status !== 'authenticated') return <LoginPage />;

  return (
    <Routes>
      <Route path="/home" element={<HomePage />} />
      <Route path="/explore" element={<ExplorePage />} />
      <Route path="/reels" element={<ReelsPage />} />
      <Route path="/direct" element={<Direct />} />
      <Route path="/activity" element={<ActivityPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
};

const App = () => (
  <AuthProvider>
    <RoutedApp />
  </AuthProvider>
);

export default App;

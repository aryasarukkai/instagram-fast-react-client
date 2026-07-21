import {
  Compass,
  Heart,
  Home,
  LogOut,
  MessageCircle,
  PlaySquare,
  Search,
  SquarePlus,
} from 'lucide-react';
import PropTypes from 'prop-types';
import { NavLink } from 'react-router-dom';
import logo from '../assets/speedgram-logo.png';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './Visual';

const navigation = [
  { label: 'Home', to: '/home', icon: Home },
  { label: 'Explore', to: '/explore', icon: Compass },
  { label: 'Reels', to: '/reels', icon: PlaySquare },
  { label: 'Messages', to: '/direct', icon: MessageCircle },
  { label: 'Notifications', to: '/activity', icon: Heart },
  { label: 'Search', icon: Search },
  { label: 'Create', icon: SquarePlus },
];

const AppShell = ({ children, wide }) => {
  const { authState, logout } = useAuth();
  const username = authState.user?.username || '';

  return (
    <div className="ig-shell">
      <aside className="ig-rail">
        <div className="ig-wordmark"><img src={logo} alt="" width="28" height="28" /> SpeedGram</div>

        <nav className="ig-nav" aria-label="Primary">
          {navigation.map(({ label, to, icon: Icon }) => to ? (
            <NavLink className={({ isActive }) => `ig-nav-link${isActive ? ' is-active' : ''}`} key={label} to={to}>
              <span className="ig-nav-icon"><Icon size={24} strokeWidth={1.8} /></span>
              {label}
            </NavLink>
          ) : (
            <button className="ig-nav-link is-disabled" key={label} type="button" disabled title={`${label} arrives in a later milestone`}>
              <span className="ig-nav-icon"><Icon size={24} strokeWidth={1.8} /></span>
              {label}
            </button>
          ))}
          <NavLink className={({ isActive }) => `ig-nav-link${isActive ? ' is-active' : ''}`} to="/profile">
            <span className="ig-nav-icon"><Avatar username={username} size={24} /></span>
            Profile
          </NavLink>
        </nav>

        <div className="ig-rail-foot">
          <button className="ig-nav-link" type="button" onClick={logout}>
            <span className="ig-nav-icon"><LogOut size={24} strokeWidth={1.8} /></span>
            Log out
          </button>
        </div>
      </aside>

      <main className={`ig-main${wide ? ' is-wide' : ''}`}>{children}</main>
    </div>
  );
};

AppShell.propTypes = { children: PropTypes.node.isRequired, wide: PropTypes.bool };
AppShell.defaultProps = { wide: false };

export default AppShell;

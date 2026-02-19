import { NavLink } from 'react-router-dom';
import styles from './Sidebar.module.css';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

const ChatIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 6a4 4 0 014-4h8a4 4 0 014 4v4a4 4 0 01-4 4H8l-4 3v-3a4 4 0 01-2-4V6z" />
  </svg>
);

const MemoryIcon = () => (
  <svg width="20" height="20" viewBox="0 0 18 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 2a5 5 0 00-3 9v2a1 1 0 001 1h4a1 1 0 001-1v-2a5 5 0 00-3-9z" />
    <path d="M7 15h4" />
    <path d="M8 17h2" />
  </svg>
);

const StatusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 13l2-2m2-2l2-2m2-2l2-2" />
    <path d="M5 17a1 1 0 110-2 1 1 0 010 2z" />
    <path d="M9 13a1 1 0 110-2 1 1 0 010 2z" />
    <path d="M13 9a1 1 0 110-2 1 1 0 010 2z" />
    <path d="M17 5a1 1 0 110-2 1 1 0 010 2z" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const navItems: NavItem[] = [
  { to: '/', label: 'Chat', icon: <ChatIcon /> },
  { to: '/memory', label: 'Memory', icon: <MemoryIcon /> },
  { to: '/status', label: 'Status', icon: <StatusIcon /> },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon /> },
];

export default function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <nav className={styles.nav}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `${styles.navItem}${isActive ? ` ${styles.active}` : ''}`
            }
            title={item.label}
          >
            {item.icon}
          </NavLink>
        ))}
      </nav>
      <div className={styles.logo}>E</div>
    </aside>
  );
}

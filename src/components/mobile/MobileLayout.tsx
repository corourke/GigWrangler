import React from 'react';
import { useVisualViewport, scrollFieldIntoView } from '../../hooks/useVisualViewport';
import { safeHref } from '../../utils/safeHref';
import {Barcode, Settings, Building2, List, Home, CalendarClock } from 'lucide-react';
import type { UserRole } from '../../utils/supabase/types';
import { useAuth } from '../../contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { SwitchCamera } from 'lucide-react';

interface MobileLayoutProps {
  children: React.ReactNode;
  currentRoute: string;
  onNavigate: (route: string) => void;
  onSwitchOrganization?: () => void;
  userRole?: UserRole;
}

const getIsAppleStandalone = () => {
  if (typeof window === 'undefined') return false;
  return (window.navigator as any).standalone === true;
};

const MobileLayout: React.FC<MobileLayoutProps> = ({ children, currentRoute, onNavigate, onSwitchOrganization, userRole }) => {
  const { user, selectedOrganization, organizations } = useAuth();

  const [isApplePWA] = React.useState(getIsAppleStandalone);

  // The visible area: the layout fits it, and while a keyboard is open it follows where iOS has
  // scrolled the visible area to (or the headers go off the top) and the tab bar steps aside
  // (or it rides up above the keyboard) (#442).
  const { height: vpHeight, offsetTop, keyboardOpen } = useVisualViewport();

  const getInitials = (firstName: string = '', lastName: string = '') => {
    const f = firstName?.[0] || '';
    const l = lastName?.[0] || '';
    return `${f}${l}`.toUpperCase() || '?';
  };

  // Today is the home screen for Staff, Admin and Manager; not Viewer (#445). For Staff, who have no
  // Gigs tab, it is called Home and also holds what Dashboard (My Schedule) showed.
  const today = { id: 'mobile-today', label: 'Today', icon: CalendarClock };
  const navItems = userRole === 'Staff'
    ? [
        { id: 'mobile-today', label: 'Home', icon: Home },
        { id: 'mobile-inventory', label: 'Scanning', icon: Barcode },
        { id: 'mobile-settings', label: 'Settings', icon: Settings },
      ]
    : [
        ...(userRole === 'Admin' || userRole === 'Manager' ? [today] : []),
        { id: 'mobile-gig-list', label: 'Gigs', icon: List },
        { id: 'mobile-inventory', label: 'Scanning', icon: Barcode },
        { id: 'mobile-settings', label: 'Settings', icon: Settings },
      ];

  return (
    <div
      className="mobile-layout-root"
      style={{
        backgroundColor: 'var(--background)',
        ...(vpHeight ? { height: `${vpHeight}px` } : {}),
        top: keyboardOpen ? `${offsetTop}px` : '0px',
      }}
    >
      <header
        style={{
          flexShrink: 0,
          backgroundColor: 'var(--background)',
          borderBottom: '1px solid var(--border)',
          paddingTop: 'max(8px, env(safe-area-inset-top))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56, padding: '0 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Building2 style={{ width: 18, height: 18, color: 'var(--primary-foreground)' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.025em', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedOrganization?.name || 'GigWrangler'}
              </div>
              {organizations && organizations.length > 1 && onSwitchOrganization && (
                <button
                  onClick={onSwitchOrganization}
                  style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 11, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  <SwitchCamera style={{ width: 10, height: 10 }} />
                  <span>Switch</span>
                </button>
              )}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <Avatar className="w-8 h-8">
                  <AvatarImage src={safeHref(user?.avatar_url)} alt={user ? `${user.first_name} ${user.last_name}` : ''} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                    {getInitials(user?.first_name, user?.last_name)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>
                <p className="text-sm">{user?.first_name} {user?.last_name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {onSwitchOrganization && organizations && organizations.length > 1 && (
                <DropdownMenuItem onClick={onSwitchOrganization}>
                  <SwitchCamera className="w-4 h-4 mr-2" />
                  Switch Organization
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main
        data-testid="mobile-main-content"
        data-mobile-scroll
        onFocus={scrollFieldIntoView}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
        }}
      >
        {children}
      </main>

      <nav
        data-testid="mobile-bottom-nav"
        className="mobile-bottom-nav"
        hidden={keyboardOpen}
        style={{
          flexShrink: 0,
          backgroundColor: 'var(--background)',
          borderTop: '1px solid var(--border)',
          WebkitUserSelect: 'none',
          userSelect: 'none',
          ...(isApplePWA ? { paddingBottom: 0 } : {}),
          ...(keyboardOpen ? { display: 'none' } : {}),
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', height: 56, maxWidth: 480, margin: '0 auto', padding: '0 8px' }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentRoute === item.id ||
              (item.id === 'mobile-inventory' && (currentRoute === 'mobile-inventory' || currentRoute === 'mobile-scanner')) ||
              (item.id === 'mobile-gig-list' && currentRoute === 'mobile-gig-detail') ||
              (item.id === 'mobile-dashboard' && currentRoute === 'mobile-dashboard');

            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  height: '100%',
                  gap: 4,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  borderRadius: 8,
                  color: isActive ? 'var(--primary)' : 'var(--muted-foreground)',
                }}
              >
                <div style={{
                  padding: 4,
                  borderRadius: 6,
                  backgroundColor: isActive ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'transparent',
                }}>
                  <Icon style={{ width: 24, height: 24, strokeWidth: isActive ? 2.5 : 2 }} />
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

export default MobileLayout;

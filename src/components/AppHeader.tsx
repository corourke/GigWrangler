import { Badge } from './ui/badge';
import { safeHref } from '../utils/safeHref';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Building2,
  Settings,
  LogOut,
  SwitchCamera,
  UserCircle,
} from 'lucide-react';
import React from 'react';
import { Organization, User, UserRole } from '../utils/supabase/types';
import { USER_ROLE_CONFIG } from '../utils/supabase/constants';
import NavigationMenu, { type RouteType } from './NavigationMenu';
import { useNavigation } from '../contexts/NavigationContext';
import NotificationBell from './NotificationBell';
import ModeratorQueueMenuItem from './ModeratorQueueMenuItem';

interface AppHeaderProps {
  organization?: Organization;
  user: User;
  userRole?: UserRole;
  currentRoute: RouteType;
  onSwitchOrganization?: () => void;
  onEditProfile?: () => void;
  onLogout: () => void | Promise<void>;
}

const AppHeader = React.memo(function AppHeader({
  organization,
  user,
  userRole,
  currentRoute,
  onSwitchOrganization,
  onEditProfile,
  onLogout,
}: AppHeaderProps) {
  const navigation = useNavigation();
  const effectiveEditProfile = onEditProfile || navigation?.onEditProfile;
  const effectiveNavigateToSettings = navigation?.onNavigateToSettings;

  const getInitials = (firstName: string = '', lastName: string = '') => {
    const f = firstName?.[0] || '';
    const l = lastName?.[0] || '';
    return `${f}${l}`.toUpperCase() || '?';
  };

  // One 56 px row (#39): org · section menu · bell and account menu.
  return (
    <div className="bg-background border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div data-testid="app-top-bar" className="flex h-14 items-center gap-4 lg:gap-7">
          {/* Organization Info or App Title */}
          <div className="flex min-w-0 flex-none items-center gap-2.5">
            <div className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary">
              <Building2 className="h-[18px] w-[18px] text-primary-foreground" />
            </div>
            <h2 className="max-w-[14rem] truncate text-[15px] font-semibold text-foreground">{organization?.name || 'GigWrangler'}</h2>
            {userRole && organization && (
              <Badge className={`text-xs ${USER_ROLE_CONFIG[userRole].color}`} variant="outline">
                {USER_ROLE_CONFIG[userRole].label}
              </Badge>
            )}
          </div>

          {/* Section menu - only when an organization and navigation context exist */}
          <div className="flex min-w-0 flex-1 justify-center">
            {organization && navigation && (
              <NavigationMenu
                currentRoute={currentRoute}
                userRole={userRole}
                onNavigate={{
                  dashboard: navigation.onNavigateToDashboard,
                  gigs: navigation.onNavigateToGigs,
                  team: navigation.onNavigateToTeam,
                  assets: navigation.onNavigateToAssets,
                  financials: navigation.onNavigateToFinancials,
                }}
              />
            )}
          </div>

          {/* User Menu */}
          <div className="flex flex-none items-center gap-3">
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button aria-label="Account menu" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                  <Avatar className="w-9 h-9">
                    <AvatarImage src={safeHref(user.avatar_url)} alt={`${user.first_name} ${user.last_name}`} />
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {getInitials(user.first_name, user.last_name)}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div>
                    <p className="text-sm">{user.first_name} {user.last_name}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {onSwitchOrganization && organization && (
                  <>
                    <DropdownMenuItem onClick={onSwitchOrganization}>
                      <SwitchCamera className="w-4 h-4 mr-2" />
                      Switch Organization
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <ModeratorQueueMenuItem />
                <DropdownMenuItem onClick={effectiveNavigateToSettings} disabled={!effectiveNavigateToSettings}>
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={effectiveEditProfile} disabled={!effectiveEditProfile}>
                  <UserCircle className="w-4 h-4 mr-2" />
                  Edit Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={async (e) => {
                    e.preventDefault();
                    try {
                      await Promise.resolve(onLogout());
                    } catch (error) {
                      console.error('Logout error:', error);
                    }
                  }} 
                  className="text-destructive"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
});

export default AppHeader;
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import App from '../App'
import { AuthProvider } from '../contexts/AuthContext'
import * as _userService from '../services/user.service'

// Mock user service functions
vi.mock('../services/user.service', () => ({
  getUserProfile: vi.fn(),
  getCompleteUserData: vi.fn(),
}))

// Mock Supabase client
vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  })),
}))

// Mock NavigationContext
vi.mock('../contexts/NavigationContext', () => ({
  NavigationProvider: ({ children }: { children: React.ReactNode }) => children,
  useNavigation: vi.fn(() => ({
    navigateToGigs: vi.fn(),
    navigateToAssets: vi.fn(),
    navigateToKits: vi.fn(),
    navigateToTeam: vi.fn(),
    navigateToDashboard: vi.fn(),
  })),
}))

// Mock all screen components to just render without errors
vi.mock('./LoginScreen', () => ({
  default: () => <div>LoginScreen</div>,
}))
vi.mock('./UserProfileCompletionScreen', () => ({
  default: () => <div>UserProfileCompletionScreen</div>,
}))
vi.mock('./OrganizationSelectionScreen', () => ({
  default: () => <div>OrganizationSelectionScreen</div>,
}))
vi.mock('./Dashboard', () => ({
  default: () => <div>Dashboard</div>,
}))
vi.mock('./GigListScreen', () => ({
  default: () => <div>GigListScreen</div>,
}))
vi.mock('./gig/GigPage', () => ({
  default: () => <div>GigPage</div>,
}))
vi.mock('./GigScreen', () => ({
  default: () => <div>GigScreen</div>,
}))
vi.mock('./TeamScreen', () => ({
  default: () => <div>TeamScreen</div>,
}))
vi.mock('./AssetListScreen', () => ({
  default: () => <div>AssetListScreen</div>,
}))
vi.mock('./AssetScreen', () => ({
  default: () => <div>AssetScreen</div>,
}))
vi.mock('./KitListScreen', () => ({
  default: () => <div>KitListScreen</div>,
}))
vi.mock('./KitScreen', () => ({
  default: () => <div>KitScreen</div>,
}))
vi.mock('./KitDetailScreen', () => ({
  default: () => <div>KitDetailScreen</div>,
}))
vi.mock('./OrganizationScreen', () => ({
  default: () => <div>OrganizationScreen</div>,
}))
vi.mock('./ImportScreen', () => ({
  default: () => <div>ImportScreen</div>,
}))

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock window.matchMedia for jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders without throwing errors', () => {
    // This test just ensures the App component can render without crashing
    expect(() => {
      render(
        <AuthProvider>
          <App />
        </AuthProvider>
      )
    }).not.toThrow()
  });

  it('handles missing session gracefully', () => {
    // Test that app handles null session without errors
    expect(() => {
      render(
        <AuthProvider>
          <App />
        </AuthProvider>
      )
    }).not.toThrow()
  });
})

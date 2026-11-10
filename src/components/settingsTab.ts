// Kept apart from SettingsScreen so the router can read the tab without loading the screen.
export type SettingsTab = 'calendar' | 'categories' | 'notifications' | 'security';

/** The tab named in the URL (/settings/:tab); Google Calendar when it names none. */
export function parseSettingsTab(tab: string | undefined): SettingsTab {
  return tab === 'categories' || tab === 'notifications' || tab === 'security' ? tab : 'calendar';
}

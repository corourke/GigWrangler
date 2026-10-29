// The screenshot manifest: every user-guide screenshot, defined once.
//
// Each shot:
//   id        '<section>/<page>-<what>', also the PNG path under
//             website/docs/src/assets/screenshots/
//   page      the guide page that shows it (under website/docs/src/content/docs/)
//   user      demo login key from USERS in shoot.mjs, or null for signed out
//   sources   app files whose UI the shot shows, so a change to them flags the
//             shot as possibly stale
//   prepare   async (page, ctx) => navigate and set up the screen
//   target    (page) => Locator, or an array of Locators, to crop to (their
//             combined box; optional pad, CSS px), or
//   clip      { x, y, width, height } in CSS px, or async (page) => that
//   viewport  optional override of the default 1200 x 900
//
// ctx.base is the app URL; ctx.users holds the demo emails.

// The demo gig most shots use: Harvest Gala Dinner & Dance, this Saturday.
const HARVEST_GALA = 'de000000-0000-4000-8000-000300000007';
// Cedar Hall Fall Songwriter Showcase, which the seed makes conflict with another gig.
const SONGWRITER_SHOWCASE = 'de000000-0000-4000-8000-000300000008';
// Riverside festival (Completed, two days): gear still out after it, for Not returned.
const FESTIVAL = 'de000000-0000-4000-8000-000300000005';

// The bounding box of a locator, as a plain object.
const box = async (locator) => {
  const b = await locator.boundingBox();
  if (!b) throw new Error('locator not visible');
  return b;
};
// The card (rounded section) that contains a piece of text.
const cardOf = (page, text) =>
  page.getByText(text, { exact: true }).first().locator('xpath=ancestor::div[contains(@class,"rounded-xl") or contains(@class,"rounded-lg")][1]');
const gigSection = (page, title) =>
  page.locator('h2').filter({ hasText: title }).first().locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
const hideConflictBanner = (page) =>
  page.getByText(/Conflicts Detected/i).first().evaluate((el) => {
    el.closest('.mb-4')?.setAttribute('style', 'display:none');
  }).catch(() => {});
const openEdit = async (page, ctx, gigId) => {
  await page.goto(`${ctx.base}/gigs/${gigId}/edit`);
  await page.getByText('All changes saved').waitFor();
};

const pick = async (page, trigger, option) => {
  await page.getByLabel(trigger).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};

export const shots = [
  {
    id: 'getting-started/onboarding-sign-up',
    page: 'getting-started/onboarding.md',
    user: null,
    sources: ['src/components/LoginScreen.tsx'],
    prepare: async (page, ctx) => {
      await page.goto(ctx.base);
      await page.getByRole('tab', { name: 'Sign Up' }).click();
      await page.locator('#signup-firstname').fill('Nina');
      await page.locator('#signup-lastname').fill('Newman');
      await page.locator('#signup-email').fill(ctx.users.newuser);
      await page.locator('#signup-password').fill(ctx.password);
      await page.locator('#signup-confirm-password').fill(ctx.password);
      await page.evaluate(() => document.activeElement?.blur());
    },
    target: (page) => page.getByRole('tablist').locator('xpath=ancestor::div[contains(@class,"shadow-lg")][1]'),
    pad: 12,
  },
  {
    id: 'getting-started/onboarding-select-organization',
    page: 'getting-started/onboarding.md',
    user: 'newuser',
    sources: ['src/components/OrganizationSelectionScreen.tsx'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/org-selection`);
      await page.getByText('No organizations yet').waitFor();
    },
    clip: { x: 0, y: 0, width: 1200, height: 650 },
  },
  {
    id: 'getting-started/onboarding-edit-profile',
    page: 'getting-started/onboarding.md',
    user: 'admin',
    sources: ['src/components/EditUserProfileDialog.tsx'],
    viewport: { width: 1200, height: 1300 }, // tall enough for the whole dialog
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/dashboard`);
      await page.locator('button[aria-haspopup="menu"]').last().click();
      await page.getByRole('menuitem', { name: 'Edit Profile' }).click();
      await page.getByRole('dialog').waitFor();
      await page.evaluate(() => document.activeElement?.blur());
    },
    target: (page) => page.getByRole('dialog'),
  },
  {
    id: 'getting-started/the-dashboard-avatar-menu',
    page: 'getting-started/the-dashboard.md',
    user: 'admin',
    sources: ['src/components/AppHeader.tsx'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/dashboard`);
      await page.getByText('Upcoming Gigs (Next 30 Days)').waitFor();
      await page.locator('button[aria-haspopup="menu"]').last().click();
      await page.getByRole('menuitem', { name: 'Edit Profile' }).waitFor();
    },
    // The menu plus the avatar button above it.
    target: (page) => [page.getByRole('menu'), page.locator('button[aria-haspopup="menu"]').last()],
    pad: 12,
  },
  {
    id: 'gigs/overview-gig-list',
    page: 'gigs/overview.md',
    user: 'admin',
    sources: ['src/components/GigListScreen.tsx', 'src/components/tables/SmartDataTable.tsx'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs`);
      await page.getByText('Harvest Gala Dinner & Dance').first().waitFor();
      // Leave out the demo data's deliberate conflict: the banner has its own page
      // (gigs/conflict-detection) and this shot is about the list itself.
      await hideConflictBanner(page);
    },
    // Ends on a row boundary (the sixth upcoming gig).
    clip: { x: 0, y: 0, width: 1200, height: 592 },
  },
  {
    id: 'gigs/overview-gig-page',
    page: 'gigs/overview.md',
    user: 'admin',
    sources: ['src/components/gig/GigPage.tsx', 'src/components/layout/PageHeader.tsx'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs/${HARVEST_GALA}`);
      await page.getByText('Load-Out').first().waitFor();
    },
    // Header, tabs, Schedule, Venue and the notes; Participants and Staffing are below.
    clip: { x: 0, y: 56, width: 1200, height: 620 },
  },
  {
    id: 'gigs/creating-a-gig-form',
    page: 'gigs/creating-a-gig.md',
    user: 'admin',
    sources: ['src/components/gig/basicInfo/GigBasicInfoFields.tsx', 'src/components/TagsInput.tsx'],
    viewport: { width: 1200, height: 1250 },
    prepare: async (page, ctx) => {
      // Fill the form but never select Create Gig.
      await page.goto(`${ctx.base}/gigs/new`);
      await page.locator('#title').fill('Winter Wonderland Gala');
      await page.locator('#start_time').fill('2026-12-05');
      await pick(page, 'start_time hour', '16');
      await pick(page, 'start_time minute', '00');
      await page.locator('#end_time').fill('2026-12-05');
      await pick(page, 'end_time hour', '23');
      await pick(page, 'end_time minute', '30');
      // The placeholder disappears after the first tag, so find the input by its label.
      const tags = page.getByText('Tags', { exact: true }).locator('xpath=following::input[1]');
      await tags.fill('Gala');
      await tags.press('Enter');
      await tags.fill('Holiday');
      await tags.press('Enter');
      await page.evaluate(() => document.activeElement?.blur());
    },
    target: (page) => page.getByText('Basic Information', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded")][1]'),
    pad: 8,
  },
  {
    id: 'gigs/change-history-history-tab',
    page: 'gigs/change-history.md',
    user: 'admin',
    sources: ['src/components/gig/GigPage.tsx', 'src/services/activityLog.service.ts'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs/${HARVEST_GALA}`);
      await page.getByRole('tab', { name: 'History' }).click();
      await page.getByText('Gig created').waitFor();
    },
    // The tabs and the History card.
    target: (page) => [
      page.getByRole('tab', { name: 'Overview' }),
      page.getByText('Gig created').locator('xpath=ancestor::div[contains(@class,"rounded")][1]'),
    ],
    pad: 6,
  },
  {
    id: 'gigs/the-gig-list-upcoming',
    page: 'gigs/the-gig-list.md',
    user: 'admin',
    sources: ['src/components/GigListScreen.tsx', 'src/components/gigs/GigListFilters.tsx', 'src/components/gigs/GigDateFilterDropdown.tsx'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs`);
      await page.getByText('Harvest Gala Dinner & Dance').first().waitFor();
    },
    // From the tabs and filters down through six rows; leaves out the conflict banner.
    clip: async (page) => {
      const top = await box(page.getByRole('tab', { name: /Upcoming/ }));
      return { x: 24, y: top.y - 12, width: 1152, height: 440 };
    },
  },
  {
    id: 'gigs/the-gig-list-row-menu',
    page: 'gigs/the-gig-list.md',
    user: 'admin',
    sources: ['src/components/GigListScreen.tsx', 'src/components/tables/SmartDataTable.tsx'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs`);
      const row = page.getByText('Harvest Gala Dinner & Dance', { exact: true }).first().locator('xpath=ancestor::tr[1]');
      await row.getByRole('button').last().click();
      await page.getByRole('menuitem', { name: 'Duplicate' }).waitFor();
    },
    target: (page) => [page.getByRole('menu'), page.getByText('Harvest Gala Dinner & Dance', { exact: true }).first().locator('xpath=ancestor::tr[1]')],
    pad: 8,
  },
  {
    id: 'gigs/calendar-view-month',
    page: 'gigs/calendar-view.md',
    user: 'admin',
    sources: ['src/components/GigListScreen.tsx'],
    viewport: { width: 1200, height: 1200 }, // the whole month
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs`);
      await page.getByRole('button', { name: 'Calendar' }).click();
      await page.getByText('Loading calendar...').waitFor({ state: 'hidden' });
      await page.getByText('Harvest Gala', { exact: false }).first().waitFor();
    },
    // The calendar card only (the conflict banner above it has its own page).
    target: (page) => page.getByRole('button', { name: 'Today' }).locator('xpath=ancestor::div[contains(@class,"rounded")][last()]'),
  },
  {
    id: 'gigs/schedule-editor',
    page: 'gigs/schedule.md',
    user: 'admin',
    sources: ['src/components/gig/GigScheduleEditor.tsx', 'src/components/gig/basicInfo/GigBasicInfoFields.tsx'],
    prepare: (page, ctx) => openEdit(page, ctx, HARVEST_GALA),
    target: (page) => cardOf(page, 'When & schedule'),
  },
  {
    id: 'gigs/staffing-assignments',
    page: 'gigs/staffing-and-participants.md',
    user: 'admin',
    sources: ['src/components/gig/GigStaffSlotsSection.tsx'],
    viewport: { width: 1200, height: 3000 },
    prepare: (page, ctx) => openEdit(page, ctx, HARVEST_GALA),
    target: (page) => cardOf(page, 'Staff Assignments'),
  },
  {
    id: 'gigs/staffing-view-card',
    page: 'gigs/staffing-and-participants.md',
    user: 'admin',
    sources: ['src/components/gig/view/GigStaffingTable.tsx', 'src/components/gig/view/staffRows.ts'],
    viewport: { width: 1200, height: 1600 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs/${HARVEST_GALA}`);
      await page.getByText(/ filled · /).first().waitFor();
    },
    // The read-only Staffing card on the gig's Overview tab, with its Staff cost line.
    target: (page) => page.getByText(/ filled · /).first().locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]'),
    pad: 6,
  },
  {
    id: 'gigs/participating-organizations-add',
    page: 'gigs/participating-organizations.md',
    user: 'admin',
    sources: ['src/components/gig/GigParticipantsSection.tsx'],
    viewport: { width: 1200, height: 3000 }, // keeps the card in the window
    prepare: async (page, ctx) => {
      // Opens a new row and types a name, but never picks or creates an organization.
      await openEdit(page, ctx, HARVEST_GALA);
      await page.getByRole('button', { name: 'Add Participant' }).click();
      const search = page.getByPlaceholder('Search organizations...').last();
      await search.click();
      await search.fill('Lumen');
      await page.getByText('Create "Lumen"', { exact: false }).first().waitFor();
      await page.getByText('Saving...').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    },
    clip: async (page) => {
      const card = await box(cardOf(page, 'Participants'));
      return { x: card.x - 8, y: card.y - 8, width: card.width + 16, height: card.height + 260 };
    },
  },
  {
    id: 'gigs/participating-organizations-contacts',
    page: 'gigs/participating-organizations.md',
    user: 'admin',
    sources: ['src/components/gig/GigParticipantsSection.tsx'],
    viewport: { width: 1200, height: 3000 }, // keeps the card in the window
    prepare: async (page, ctx) => {
      await openEdit(page, ctx, HARVEST_GALA);
      await cardOf(page, 'Participants').getByRole('button', { name: 'More actions' }).first().click();
      await page.getByRole('menuitem', { name: 'Add Contact' }).waitFor();
    },
    target: (page) => [cardOf(page, 'Participants'), page.getByRole('menu')],
    pad: 8,
  },
  // #175: a Manager of the owner sees Delete Gig grayed out, with its reason under it.
  {
    id: 'gigs/participating-organizations-delete-blocked',
    page: 'gigs/participating-organizations.md',
    user: 'manager',
    sources: ['src/components/gig/GigPage.tsx', 'src/utils/gigOwnership.ts'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs/${HARVEST_GALA}`);
      await page.getByText('Owned by', { exact: false }).first().waitFor();
      await page.getByRole('button', { name: 'More actions' }).first().click();
      // The item is aria-disabled, so it takes a forced click to show the reason.
      await page.getByRole('menuitem', { name: /Delete Gig/ }).click({ force: true });
      await page.getByRole('note').waitFor();
    },
    // The header, from the title through the tabs, and the open menu.
    clip: async (page) => {
      const menu = await box(page.getByRole('menu'));
      return { x: 0, y: 56, width: 1200, height: Math.max(menu.y + menu.height + 12, 180) - 56 };
    },
  },
  {
    id: 'gigs/documents-and-notes-section',
    page: 'gigs/documents-and-notes.md',
    user: 'admin',
    sources: ['src/components/gig/GigPage.tsx', 'src/components/AttachmentManager.tsx'],
    viewport: { width: 1200, height: 3000 },
    prepare: (page, ctx) => openEdit(page, ctx, HARVEST_GALA),
    target: (page) => cardOf(page, 'Notes & attachments'),
  },
  {
    id: 'gigs/conflict-detection-gig-page',
    page: 'gigs/conflict-detection.md',
    user: 'admin',
    sources: ['src/components/ConflictWarning.tsx', 'src/services/conflictDetection.service.ts'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs/${SONGWRITER_SHOWCASE}`);
      await page.getByText('Brightwave Rooftop Mixer').first().waitFor();
    },
    // The gig header and the Conflicts Detected card.
    clip: async (page) => {
      const card = await box(page.getByText(/Conflicts Detected/i).first().locator('xpath=ancestor::div[contains(@class,"rounded")][1]'));
      return { x: 0, y: 56, width: 1200, height: card.y + card.height + 12 - 56 };
    },
  },
  {
    id: 'team/team-and-roles-members-table',
    page: 'team/team-and-roles.md',
    user: 'admin',
    sources: ['src/components/team/teamColumns.tsx', 'src/components/TeamScreen.tsx'],
    prepare: async (page, ctx) => {
      ctx.restoreSignIns(); // Last Login: the seeded times, not this run's sign-ins
      await page.goto(`${ctx.base}/team`);
      await page.getByText('Sofia Lindqvist').first().waitFor();
    },
    target: (page) => cardOf(page, 'Active Members'),
  },
  {
    id: 'team/invitations-invite-dialog',
    page: 'team/invitations.md',
    user: 'admin',
    sources: ['src/components/team/AddTeamMemberDialog.tsx'],
    prepare: async (page, ctx) => {
      // Fills the form but never sends the invitation.
      await page.goto(`${ctx.base}/team`);
      await page.getByRole('button', { name: 'Add Team Member' }).click();
      await page.getByRole('tab', { name: 'Invite New' }).click();
      await page.locator('#invite_first_name').fill('Sasha');
      await page.locator('#invite_last_name').fill('Ortiz');
      await page.locator('#invite_email').fill('sasha.ortiz@crew.example');
      await page.evaluate(() => document.activeElement?.blur());
    },
    target: (page) => page.getByRole('dialog'),
  },
  {
    id: 'team/invitations-pending-table',
    page: 'team/invitations.md',
    user: 'admin',
    sources: ['src/components/TeamScreen.tsx'],
    viewport: { width: 1200, height: 1600 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/team`);
      await page.getByText('jordan.blake@crew.example').waitFor();
    },
    target: (page) => cardOf(page, 'Pending Invitations'),
  },
  {
    id: 'team/people-without-logins-no-account-tab',
    page: 'team/people-without-logins.md',
    user: 'admin',
    sources: ['src/components/team/AddTeamMemberDialog.tsx'],
    prepare: async (page, ctx) => {
      // Fills in a new freelancer; never selects Add to Team.
      await page.goto(`${ctx.base}/team`);
      await page.getByRole('button', { name: 'Add Team Member' }).click();
      await page.getByRole('tab', { name: 'No Account' }).click();
      await page.locator('#quick_add_first_name').fill('Jamie');
      await page.locator('#quick_add_last_name').fill('Tran');
      await page.locator('#quick_add_phone').fill('(510) 555-0131');
      await page.getByText(/No existing match/).waitFor();
      await page.evaluate(() => document.activeElement?.blur());
    },
    target: (page) => page.getByRole('dialog'),
  },
  {
    id: 'team/member-profiles-details-page',
    page: 'team/member-profiles.md',
    user: 'admin',
    sources: ['src/components/TeamMemberDetailScreen.tsx'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/team`);
      // In the members table; her access request above it also names her.
      await page.getByRole('cell', { name: 'Sofia Lindqvist' }).first().click();
      await page.waitForURL(/\/team\/.+/, { waitUntil: 'commit' });
      await page.locator('.animate-spin').first().waitFor({ state: 'hidden' }).catch(() => {});
      await page.getByRole('heading', { name: /Sofia Lindqvist/ }).first().waitFor();
    },
    clip: { x: 0, y: 56, width: 1200, height: 445 },
  },
  {
    id: 'team/member-profiles-contacts-card',
    page: 'team/member-profiles.md',
    user: 'admin',
    sources: ['src/components/organization/OrganizationContactsSection.tsx', 'src/components/OrganizationScreen.tsx'],
    viewport: { width: 1200, height: 2400 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/admin/orgs`);
      const row = page.getByText('Harborlight Pavilion', { exact: true }).first().locator('xpath=ancestor::tr[1]');
      await row.getByRole('button', { name: /Edit/ }).first().click();
      await page.getByText('Valerie Costa').first().waitFor();
    },
    target: (page) => cardOf(page, 'Contacts'),
  },
  // Held: reference/access-requests-* need a seeded access request and a platform
  // moderator login; the access-requests page is still a draft.
  {
    id: 'settings/categories-equipment',
    page: 'settings/categories.md',
    user: 'admin',
    sources: ['src/components/settings/CategoryListEditor.tsx', 'src/components/settings/CategoriesSettings.tsx'],
    viewport: { width: 1200, height: 2200 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/settings?tab=categories`);
      await page.getByRole('tab', { name: 'Categories' }).click().catch(() => {});
      await page.getByRole('tab', { name: 'Equipment categories' }).click();
      await page.getByText('How the types are written').waitFor();
    },
    // The card's top: the tabs, the type-writing rules and the first rows of the list.
    clip: async (page) => {
      const card = await box(page.getByText('How the types are written').locator('xpath=ancestor::div[contains(@class,"rounded-xl") or contains(@class,"rounded-lg")][2]'));
      return { x: card.x, y: card.y, width: card.width, height: 600 };
    },
  },
  {
    id: 'settings/google-calendar-connect',
    page: 'settings/google-calendar.md',
    user: 'admin',
    sources: ['src/components/CalendarIntegrationSettings.tsx'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/settings`);
      await page.getByRole('button', { name: 'Connect Google Calendar' }).waitFor();
    },
    clip: { x: 0, y: 56, width: 1200, height: 420 },
  },
  {
    id: 'getting-started/organizations-search-result',
    page: 'getting-started/organizations.md',
    user: 'newuser',
    sources: ['src/components/OrganizationSelectionScreen.tsx'],
    prepare: async (page, ctx) => {
      // Searches only; never joins.
      await page.goto(`${ctx.base}/org-selection`);
      await page.getByPlaceholder(/Search all organizations/).fill('Cedar');
      await page.getByRole('button', { name: 'Join as Viewer' }).first().waitFor();
    },
    clip: { x: 0, y: 56, width: 1200, height: 290 },
  },
  {
    id: 'getting-started/organizations-create-form',
    page: 'getting-started/organizations.md',
    user: 'newuser',
    sources: ['src/components/OrganizationScreen.tsx'],
    viewport: { width: 1200, height: 1800 },
    prepare: async (page, ctx) => {
      // Fills the form but never creates the organization.
      await page.goto(`${ctx.base}/create-org`);
      await page.getByText('Skip search and enter details manually').click();
      await page.getByPlaceholder('Enter organization name').fill('Bayline Audio');
      await page.locator('#role-Sound').click();
      await page.locator('#role-Rentals').click();
      await page.getByPlaceholder('+1 (555) 123-4567').fill('(510) 555-0188');
      await page.evaluate(() => document.activeElement?.blur());
    },
    // From Basic Information down to Allowed Email Domains.
    clip: async (page) => {
      const card = await box(page.getByText('Organization Roles').locator('xpath=ancestor::div[contains(@class,"rounded-xl") or contains(@class,"rounded-lg")][last()]'));
      return { x: card.x, y: card.y, width: card.width, height: 480 };
    },
  },
  {
    id: 'getting-started/organizations-request-access',
    page: 'getting-started/organizations.md',
    user: 'viewer',
    sources: ['src/components/team/RequestAccessDialog.tsx', 'src/components/TeamScreen.tsx'],
    prepare: async (page, ctx) => {
      // Opens the dialog; never submits.
      await page.goto(`${ctx.base}/team`);
      await page.getByRole('button', { name: 'Request Access' }).click();
      await page.getByPlaceholder('Why do you need this access?').fill('I handle the books and need to see Financials.');
      await page.evaluate(() => document.activeElement?.blur());
    },
    target: (page) => page.getByRole('dialog'),
  },
  {
    id: 'reference/access-requests-pending-card',
    page: 'reference/access-requests-and-moderation.md',
    user: 'admin',
    sources: ['src/components/TeamScreen.tsx'],
    viewport: { width: 1200, height: 2400 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/team`);
      await page.getByText('Pending Access Requests').waitFor();
      await page.getByText(/running FOH/).waitFor();
    },
    target: (page) => page.getByText('Pending Access Requests').locator('xpath=ancestor::div[contains(@class,"rounded-xl") or contains(@class,"rounded-lg")][1]'),
  },
  {
    id: 'reference/access-requests-moderator-queue',
    page: 'reference/access-requests-and-moderation.md',
    user: 'moderator',
    sources: ['src/components/ModeratorAccessRequestsScreen.tsx'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/admin/access-requests`);
      await page.getByText('Vera Holm').first().waitFor();
    },
    clip: { x: 0, y: 56, width: 1200, height: 320 },
  },
  {
    id: 'getting-started/organizations-notification',
    page: 'getting-started/organizations.md',
    user: 'viewer',
    sources: ['src/components/NotificationBell.tsx'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs`);
      await page.getByRole('button', { name: 'Notifications' }).click();
      await page.getByText(/was\s+rejected/).waitFor();
    },
    // The open panel plus the bell above it (the bell is aria-hidden while the panel is open).
    target: (page) => [page.locator('[data-radix-popper-content-wrapper]').first(), page.locator('button[aria-label="Notifications"]')],
    pad: 8,
  },
  {
    id: 'financials/reporting-income',
    page: 'financials/reporting.md',
    user: 'admin',
    sources: ['src/components/financials/ReportingTab.tsx'],
    viewport: { width: 1200, height: 1400 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/financials/reporting`);
      await page.getByRole('button', { name: 'Income', exact: true }).click();
      await page.getByText('Harvest Gala Dinner & Dance').first().waitFor();
    },
    clip: { x: 0, y: 56, width: 1200, height: 760 },
  },
  {
    id: 'financials/reporting-assets',
    page: 'financials/reporting.md',
    user: 'admin',
    sources: ['src/components/financials/ReportingTab.tsx'],
    viewport: { width: 1200, height: 1400 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/financials/reporting`);
      await page.getByRole('button', { name: 'Assets', exact: true }).click();
      await page.getByText(/7-year/).first().waitFor();
    },
    clip: { x: 0, y: 56, width: 1200, height: 800 },
  },
  {
    id: 'financials/reporting-grey-zone',
    page: 'financials/reporting.md',
    user: 'admin',
    sources: ['src/components/financials/ReportingTab.tsx', 'src/utils/taxReports.ts'],
    viewport: { width: 1200, height: 1400 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/financials/reporting`);
      await page.getByRole('button', { name: 'Grey zone', exact: true }).click();
      await page.getByRole('table', { name: 'Grey zone' }).waitFor();
    },
    // From Tax year down through the table.
    clip: async (page) => {
      const t = await box(page.getByRole('table', { name: 'Grey zone' }));
      return { x: 0, y: 56, width: 1200, height: Math.min(t.y + t.height + 24, 1300) - 56 };
    },
  },
  {
    id: 'getting-started/the-dashboard-overview',
    page: 'getting-started/the-dashboard.md',
    user: 'admin',
    sources: ['src/components/Dashboard.tsx', 'supabase/functions/server/lib/pure/dashboard.ts'],
    viewport: { width: 1200, height: 1600 },
    prepare: async (page, ctx) => {
      // The dashboard's numbers come from the server, which uses the real date, not the
      // pinned clock: wait for the upcoming list whatever it holds, not for a named gig.
      await page.goto(`${ctx.base}/dashboard`);
      const upcoming = cardOf(page, 'Upcoming Gigs (Next 30 Days)');
      await upcoming.waitFor();
      await upcoming.locator('tbody tr').or(upcoming.getByText(/No upcoming gigs/)).first().waitFor();
      await page.locator('.animate-spin').first().waitFor({ state: 'hidden' }).catch(() => {});
    },
    // The summary cards and the upcoming gigs, above Recent Activity.
    clip: async (page) => {
      const up = await box(cardOf(page, 'Upcoming Gigs (Next 30 Days)'));
      return { x: 0, y: 56, width: 1200, height: up.y + up.height + 16 - 56 };
    },
  },
  {
    id: 'getting-started/the-dashboard-staff-cards',
    page: 'getting-started/the-dashboard.md',
    user: 'staff',
    sources: ['src/components/Dashboard.tsx'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/dashboard`);
      await page.getByText('Owned', { exact: true }).waitFor();
    },
    // The row of summary cards a Staff member sees.
    target: (page) => [cardOf(page, 'Date Hold'), cardOf(page, 'Owned')],
    pad: 8,
  },
  {
    id: 'gigs/conflict-detection-banner',
    page: 'gigs/conflict-detection.md',
    user: 'admin',
    sources: ['src/components/ConflictWarning.tsx', 'src/components/GigListScreen.tsx'],
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs`);
      await page.getByText(/Conflicts? Detected/).first().waitFor();
    },
    target: (page) => page.getByText(/Conflicts? Detected/).first().locator('xpath=ancestor::div[contains(@class,"rounded")][1]'),
    pad: 8,
  },
  {
    id: 'gigs/conflict-detection-equipment-needed',
    page: 'gigs/conflict-detection.md',
    user: 'admin',
    sources: ['src/components/gig/EquipmentNeededTable.tsx', 'src/utils/equipmentNeeds.ts'],
    viewport: { width: 1200, height: 1800 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs/${SONGWRITER_SHOWCASE}/equipment`);
      await page.locator('#equipment-needed').waitFor();
      await page.getByText(/ short| spare|Enough/).first().waitFor();
    },
    target: (page) => page.locator('section[aria-labelledby="equipment-needed"]'),
    pad: 12,
  },
  // #175: Cedar Hall's Viewer on a gig where Cedar Hall is Inactive. The owner's Admin marks
  // it Inactive first, through the participant row menu (dev keeps it until the next seed, so this runs after the other gig shots).
  {
    id: 'gigs/participating-organizations-inactive-banner',
    page: 'gigs/participating-organizations.md',
    user: 'venue',
    sources: ['src/components/gig/GigPage.tsx', 'src/utils/gigOwnership.ts', 'src/components/gig/GigParticipantsSection.tsx'],
    prepare: async (page, ctx) => {
      const admin = await page.context().browser().newContext({ viewport: { width: 1200, height: 3000 } });
      const a = await admin.newPage();
      a.on('dialog', (d) => d.accept());
      await a.goto(ctx.base);
      await a.locator('#signin-email').fill(ctx.users.admin);
      await a.locator('#signin-password').fill(ctx.password);
      await a.getByRole('button', { name: 'Sign In' }).last().click();
      await a.waitForURL((u) => !/\/(login)?$/.test(u.pathname), { timeout: 30000 });
      await openEdit(a, ctx, SONGWRITER_SHOWCASE);
      await cardOf(a, 'Participants').getByRole('button', { name: 'More actions' }).first().click();
      const mark = a.getByRole('menuitem', { name: 'Mark Inactive' });
      if (await mark.count()) {
        await mark.click();
        await a.getByText('Cedar Hall is Inactive on this gig').first().waitFor();
      }
      await admin.close();
      await page.goto(`${ctx.base}/gigs/${SONGWRITER_SHOWCASE}`);
      await page.getByText('is Inactive on this gig', { exact: false }).first().waitFor();
    },
    // From the header through the banner.
    clip: async (page) => {
      const banner = await box(page.getByText('is Inactive on this gig', { exact: false }).first());
      return { x: 0, y: 56, width: 1200, height: banner.y + banner.height + 20 - 56 };
    },
  },
  {
    id: 'financials/reporting-schedule-c',
    page: 'financials/reporting.md',
    user: 'admin',
    sources: ['src/components/financials/ScheduleCView.tsx', 'src/utils/taxSummaryReports.ts'],
    viewport: { width: 1200, height: 1800 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/financials/reporting`);
      await page.getByRole('button', { name: 'Schedule C', exact: true }).click();
      await page.getByRole('table', { name: 'Schedule C summary' }).waitFor();
    },
    clip: async (page) => {
      const t = await box(page.getByRole('table', { name: 'Schedule C summary' }));
      return { x: 0, y: 56, width: 1200, height: Math.min(t.y + t.height + 90, 1750) - 56 };
    },
  },
  {
    id: 'financials/reporting-needs-attention',
    page: 'financials/reporting.md',
    user: 'admin',
    sources: ['src/components/financials/NeedsAttentionView.tsx', 'src/utils/taxSummaryReports.ts'],
    viewport: { width: 1200, height: 1800 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/financials/reporting`);
      await page.getByRole('button', { name: 'Needs attention', exact: true }).click();
      await page.getByText(/would leave the|Nothing needs attention/).first().waitFor();
      await page.waitForTimeout(500);
    },
    clip: async (page) => {
      const tables = page.locator('table');
      const n = await tables.count();
      const last = n ? await box(tables.nth(n - 1)) : await box(page.getByText(/Nothing needs attention/).first());
      return { x: 0, y: 56, width: 1200, height: Math.min(last.y + last.height + 24, 1750) - 56 };
    },
  },
  // Gig sections (GigSection): the card around a section heading.
  {
    id: 'equipment/assigning-to-a-gig-equipment-table',
    page: 'equipment/assigning-to-a-gig.md',
    user: 'admin',
    sources: ['src/components/gig/view/GigEquipmentTable.tsx', 'src/utils/packingSummary.ts'],
    viewport: { width: 1200, height: 1800 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs/${HARVEST_GALA}/equipment`);
      const card = gigSection(page, /^Equipment(\d|\s|$)/);
      await card.getByRole('button', { name: 'Columns' }).click();
      await page.getByText('Status', { exact: true }).last().click();
      await page.getByText('Location', { exact: true }).last().click();
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForTimeout(1500);
    },
    target: (page) => gigSection(page, /^Equipment(\d|\s|$)/),
    pad: 6,
  },
  {
    id: 'equipment/assigning-to-a-gig-not-returned',
    page: 'equipment/assigning-to-a-gig.md',
    user: 'admin',
    sources: ['src/components/gig/NotReturnedSection.tsx', 'src/services/writeOff.service.ts'],
    viewport: { width: 1200, height: 2200 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs/${FESTIVAL}/equipment`);
      await gigSection(page, /^Not returned/).getByRole('button', { name: 'Mark missing' }).first().waitFor();
    },
    target: (page) => gigSection(page, /^Not returned/),
    pad: 6,
  },
  {
    id: 'equipment/assigning-to-a-gig-write-off-confirm',
    page: 'equipment/assigning-to-a-gig.md',
    user: 'admin',
    sources: ['src/components/gig/NotReturnedSection.tsx'],
    viewport: { width: 1200, height: 2200 },
    // Opens the confirmation only; nothing is written off.
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs/${FESTIVAL}/equipment`);
      const card = gigSection(page, /^Not returned/);
      const row = card.locator('li').filter({ hasText: 'Tessel T58' }).first();
      await row.getByRole('button', { name: 'Mark missing' }).click();
      await row.getByRole('button', { name: 'Write off' }).click();
      await page.getByRole('alertdialog').waitFor();
    },
    target: (page) => page.getByRole('alertdialog'),
    pad: 8,
  },
  // Equipment → Locations: the filters and the first status groups.
  {
    id: 'equipment/location-explorer-overview',
    page: 'equipment/location-explorer.md',
    user: 'admin',
    sources: ['src/components/inventory/LocationExplorer.tsx', 'src/utils/locations.ts', 'src/services/inventoryManagement.service.ts'],
    viewport: { width: 1200, height: 1600 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/equipment/locations`);
      await page.getByText('Location Explorer Filters').waitFor();
      await page.getByRole('heading', { name: 'Checked Out' }).waitFor();
    },
    // From the filters through the Checked Out group.
    clip: async (page) => {
      const filters = await box(cardOf(page, 'Location Explorer Filters'));
      const next = await box(page.getByRole('heading', { name: 'In Warehouse' }));
      return { x: 0, y: filters.y - 16, width: 1200, height: next.y - 12 - (filters.y - 16) };
    },
  },
  // Kits: the kit page and the kit editor, for Main PA: 4 Top / 2 Sub.
  {
    id: 'equipment/kits-list',
    page: 'equipment/kits.md',
    user: 'admin',
    sources: ['src/components/KitListScreen.tsx'],
    viewport: { width: 1200, height: 1200 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/kits`);
      await page.getByText('Main PA: 4 Top / 2 Sub').first().waitFor();
      await page.getByText('6 of 29').first().waitFor();
    },
    // From the Equipment header through the list's card.
    clip: async (page) => {
      const t = await box(page.locator('table').first());
      return { x: 0, y: 56, width: 1200, height: t.y + t.height + 36 - 56 };
    },
  },
  {
    id: 'equipment/kits-kit-page',
    page: 'equipment/kits.md',
    user: 'admin',
    sources: ['src/components/KitDetailScreen.tsx'],
    viewport: { width: 1200, height: 1700 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/kits/de000000-0000-4000-8000-000500000002`);
      await page.getByText('Equipment in Kit', { exact: true }).waitFor();
      await page.getByText('Halden HS-18 Powered Subwoofer').first().waitFor();
    },
    // From the kit's name through Kit Structure, above Change History.
    clip: async (page) => {
      const end = await box(page.getByText('Change History', { exact: true }).first());
      return { x: 0, y: 56, width: 1200, height: end.y - 32 - 56 };
    },
  },
  {
    id: 'equipment/kits-editor',
    page: 'equipment/kits.md',
    user: 'admin',
    sources: ['src/components/KitScreen.tsx'],
    viewport: { width: 1200, height: 1400 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/kits/de000000-0000-4000-8000-000500000002/edit`);
      await page.getByText('Kit Contents', { exact: true }).waitFor();
      await page.getByText('4 units owned').first().waitFor();
    },
    // The whole form: Basic Information, Tracking Type, Kit Summary and Kit Contents (its
    // table fits its card since #279).
    clip: async (page) => {
      const contents = await box(cardOf(page, 'Kit Contents'));
      return { x: 0, y: 56, width: 1200, height: contents.y + contents.height + 12 - 56 };
    },
  },
  // The phone's Scanning screen (phone layout below 768 px wide).
  {
    id: 'mobile/field-inventory-pack-out',
    page: 'mobile/field-inventory.md',
    user: 'staff',
    sources: ['src/components/mobile/MobileInventoryMode.tsx', 'src/config/inventoryWorkflow.ts'],
    viewport: { width: 390, height: 844 },
    prepare: async (page, ctx) => {
      // A gig with nothing scanned yet: the seed's Harvest Gala scans sit under the top
      // kit, so its nested kits' counters would read 0 beside checked lines.
      await page.goto(`${ctx.base}/inventory?gig=${SONGWRITER_SHOWCASE}`);
      await page.getByText('Inventory Mode').waitFor();
      await page.getByText(/pieces Checked Out/).first().waitFor();
      await page.waitForTimeout(1000);
    },
    clip: { x: 0, y: 0, width: 390, height: 844 },
  },
  {
    id: 'mobile/adding-at-pack-out-search',
    page: 'mobile/adding-at-pack-out.md',
    user: 'staff',
    sources: ['src/components/mobile/MobileInventoryMode.tsx', 'src/services/mobile/orgIndex.service.ts'],
    viewport: { width: 390, height: 844 },
    // Opens the search only; nothing is added.
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/inventory?gig=${HARVEST_GALA}`);
      await page.getByText('Inventory Mode').waitFor();
      await page.getByRole('button', { name: '+ Add' }).click();
      await page.getByPlaceholder('Kit, item or lot name').fill('Case');
      await page.getByText('Items', { exact: true }).last().waitFor();
      await page.waitForTimeout(800);
    },
    clip: { x: 0, y: 0, width: 390, height: 844 },
  },
  {
    id: 'equipment/inventory-reports-packing-list',
    page: 'equipment/inventory-reports.md',
    user: 'admin',
    sources: ['src/components/inventory/InventoryReports.tsx', 'src/utils/packingColumns.ts', 'src/components/gig/GigPage.tsx'],
    viewport: { width: 1200, height: 2400 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/gigs/${HARVEST_GALA}/equipment`);
      await gigSection(page, /^Packing list/).getByText('Full Band Sound Package').first().waitFor();
    },
    // The card's top through the Mic Case: the Columns button, the summary, the first kit's
    // lines and a container with its contents.
    clip: async (page) => {
      const card = await box(gigSection(page, /^Packing list/));
      const mic = await box(gigSection(page, /^Packing list/).getByRole('row').filter({ hasText: 'CASE-01' }).first());
      return { x: card.x - 6, y: card.y - 6, width: card.width + 12, height: mic.y + mic.height + 6 - (card.y - 6) };
    },
  },
  // Equipment › Maintenance (#186): the seed's two Wash Bars, with details filled in through
  // the list's own Edit dialog (only the maintenance details change; nothing else moves).
  {
    id: 'equipment/inventory-reports-maintenance',
    page: 'equipment/inventory-reports.md',
    user: 'admin',
    sources: ['src/components/inventory/MaintenanceList.tsx', 'src/services/maintenance.service.ts'],
    viewport: { width: 1200, height: 1200 },
    prepare: async (page, ctx) => {
      await page.goto(`${ctx.base}/equipment/maintenance`);
      await page.getByRole('heading', { name: 'In maintenance' }).waitFor();
      const details = [
        ['DSL-0153', 'Fan noisy at full output; replace the fan.', 'Repair Bench', '2026-10-01'],
        ['DSL-0154', 'Cracked lens. New lens on order.', 'Repair Bench', '2026-10-20'],
      ];
      for (const [tag, notes, location, back] of details) {
        const row = page.getByRole('row').filter({ hasText: tag });
        await row.waitFor();
        if ((await row.innerText()).includes(location)) continue;
        await row.getByRole('button', { name: /^Edit/ }).click();
        const d = page.getByRole('dialog');
        await d.getByLabel('Condition notes').fill(notes);
        await d.getByLabel('Location').fill(location);
        await d.getByLabel('Expected back').fill(back);
        await d.getByRole('button', { name: 'Save' }).click();
        await d.waitFor({ state: 'hidden' });
        await page.getByRole('row').filter({ hasText: tag }).getByText(location).waitFor();
      }
      await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    },
    // From the count and Print through the In maintenance table, actions included (they
    // fit the card since #300).
    clip: async (page) => {
      const count = await box(page.getByText(/\d+ in maintenance/).first());
      const table = await box(page.getByRole('region', { name: 'In maintenance' }));
      return { x: 0, y: count.y - 16, width: 1200, height: table.y + table.height + 16 - (count.y - 16) };
    },
  },
  // Supplied by hand (Cameron, 10-08): these screens open only from a link in an
  // email, which the script can't follow, so they aren't taken here. Retake them by
  // hand from a dev email (Mailtrap) when the screen changes.
  //   team/invitations-accepted              src/components/AcceptInvitationScreen.tsx
  //   getting-started/onboarding-reset-password  src/components/ResetPasswordScreen.tsx
];

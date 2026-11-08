---
title: Roles & permissions
description: What each role can do on the Team screen, how to change a role, and how job positions work.
sidebar:
  order: 2
---

Every member of an organization has one **system role**: **Admin**, **Manager**,
**Staff** or **Viewer**. Roles are per organization, so the same person can be an
Admin of one organization and a Viewer of another. Open **Team** in the top nav to
see and change them. For what each role can do across GigWrangler, see
[Roles & access](/reference/roles-and-access/).

## The Team screen

**Active Members** lists everyone in the organization, including people who haven't
signed in yet and people without a login. The columns are **Name**, **Email**,
**Position**, **System Role** and **Last Login**, plus an optional **Timezone**
column you can turn on from the table's column controls. A **You** badge marks your
own row, and **Pending** in **Last Login** means the person has been invited but
hasn't signed in.

Everyone can open the screen. What else you see depends on your role:

- **Admins and Managers** see **Add Team Member**, can edit cells in place, and
  see **Pending Invitations**.
- **Admins and Managers** also see **Pending Access Requests** while one is
  waiting, with **Approve** and **Reject** buttons for each. Admins see every
  request; Managers see only requests to join the organization.
- **Staff and Viewers** see the list read-only, plus a **Request Access** button
  to ask for a higher role.

## Changing a role

Admins and Managers can change a role three ways:

- In the table, select a **System Role** cell and choose a role.
- Open the row's **⋯** menu → **Edit Permissions**, choose **Organization Role** in
  **Edit Team Member**, and select **Save Changes**.
- On the member's details page, select **Edit**, then do the same. See
  [Member profiles](/team/member-profiles/).

Only Admins can make someone an Admin, change an Admin's role, or remove an Admin.
Managers aren't offered **Admin**, and an Admin's role can't be changed by a
Manager. You can't change your own role: your **System Role** cell can't be
edited, and **Edit Team Member** doesn't show the role fields for your own row.

## Removing a member

Open the row's **⋯** menu → **Remove from Team**, then select **Remove Member**.
GigWrangler warns that the person loses access to all of the organization's data.
Admins and Managers can do this, except on their own row, where the menu item is
turned off.

## Positions

**Position** is a job title such as **FOH Engineer**, **Monitor Engineer**,
**Lighting Tech**, **Stage Manager**, **Stage Hand**, **Rigger**, **Video**,
**CameraOp** or **Runner**. It is separate from the system role: the role controls what
someone can do in GigWrangler, and the position is the job you'd normally staff
them for.

To set one, select a person's **Position** cell, or choose **Default Staffing Role**
in **Edit Team Member**. The default is **None**. GigWrangler uses it as the
starting role when you assign that person to a gig. The list of positions is shared
by all organizations, and you can't add or rename positions in the app.

![The Active Members table on Team: each person with email, Position, a System Role badge (Admin, Manager, Staff or Viewer) and Last Login](../../../assets/screenshots/team/team-and-roles-members-table.png)

## Related

- [Roles & access](/reference/roles-and-access/)
- [Getting into an organization](/getting-started/organizations/)

// The email telling a requester how their access request was decided. Every value people type
// (their name, the organization's name, the decider's reply) is escaped.

/** Text made safe to place in HTML. */
export function escapeHtml(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ');

export function accessRequestOutcomeEmail(params: {
  firstName: string | null | undefined;
  orgName: string;
  requestedRole: string;
  decision: 'approved' | 'rejected';
  responseMessage: string | null | undefined;
}): { subject: string; html: string } {
  const { firstName, orgName, requestedRole, decision, responseMessage } = params;
  const joining = requestedRole === 'Viewer' || requestedRole === 'Staff';
  const org = escapeHtml(orgName);
  const role = escapeHtml(requestedRole);
  const subject = oneLine(joining
    ? `Your request to join ${orgName} was ${decision}`
    : `Your ${requestedRole} request for ${orgName} was ${decision}`);
  const html = [
    `<p>Hi ${escapeHtml(firstName)},</p>`,
    joining
      ? `<p>Your request to join <strong>${org}</strong> as <strong>${role}</strong> was <strong>${decision}</strong>.</p>`
      : `<p>Your request for <strong>${role}</strong> access on <strong>${org}</strong> was <strong>${decision}</strong>.</p>`,
    responseMessage ? `<p>${escapeHtml(responseMessage)}</p>` : '',
  ].filter(Boolean).join('\n');
  return { subject, html };
}

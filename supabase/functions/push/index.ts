// Sends a new notification to its recipient's devices (push notifications, plan approved 11-10).
// The database calls it for each new notification of a push kind (migration 20261110110000).
import { handlePushRequest } from '../server/lib/push.ts';

Deno.serve(handlePushRequest);

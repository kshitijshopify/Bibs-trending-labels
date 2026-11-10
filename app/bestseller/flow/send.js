import { FLOW_TRIGGER_HANDLE } from "../config.js";
import { FLOW_TRIGGER_RECEIVE } from "../shopify/queries.js";

/**
 * Sends the run's Flow trigger events.
 *  - If ANY event is over the payload limit, nothing is sent (no truncation,
 *    no partial preview). The run report shows the sizes for review.
 *  - Events already marked SENT for this run are skipped unless `force`,
 *    so retries do not produce duplicate preview emails.
 */
export async function sendFlowEvents({ graphql, events, alreadySent = new Set(), force = false, record, log = () => {} }) {
  const oversized = events.filter((e) => !e.withinLimit);
  if (oversized.length) {
    for (const event of events) {
      await record(event.eventKey, {
        status: "BLOCKED_PAYLOAD_TOO_LARGE",
        bytes: event.bytes,
        error: oversized.map((e) => `${e.eventKey}: ${e.bytes} bytes`).join(", "),
      });
    }
    log("warn", "Flow events not sent: payload limit exceeded", { oversized: oversized.map((e) => e.eventKey) });
    return { sent: 0, blocked: true };
  }

  let sent = 0;
  for (const event of events) {
    if (alreadySent.has(event.eventKey) && !force) {
      log("info", "Flow event already sent; skipping", { eventKey: event.eventKey });
      continue;
    }
    try {
      const data = await graphql(FLOW_TRIGGER_RECEIVE, { handle: event.handle ?? FLOW_TRIGGER_HANDLE, payload: event.payload });
      const userErrors = data?.flowTriggerReceive?.userErrors ?? [];
      if (userErrors.length) {
        await record(event.eventKey, {
          status: "FAILED",
          bytes: event.bytes,
          error: userErrors.map((e) => e.message).join("; "),
        });
        log("error", "Flow trigger rejected", { eventKey: event.eventKey, userErrors });
        continue;
      }
      await record(event.eventKey, { status: "SENT", bytes: event.bytes, sentAt: new Date() });
      sent += 1;
    } catch (error) {
      await record(event.eventKey, { status: "FAILED", bytes: event.bytes, error: error.message });
      log("error", "Flow trigger request failed", { eventKey: event.eventKey, message: error.message });
    }
  }
  return { sent, blocked: false };
}

import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR webhook, fired 48 hours after uninstall. app/uninstalled
// already clears the shop's session on uninstall; this is the final sweep
// in case that didn't run (e.g. app was already reinstalled/uninstalled again).
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await db.session.deleteMany({ where: { shop } });

  return new Response();
};

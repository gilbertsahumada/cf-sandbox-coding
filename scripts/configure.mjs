import { readFile, writeFile } from "node:fs/promises";
const [base, model, api = "chat-completions"] = process.argv.slice(2);
if (!base || !model || !["chat-completions", "responses"].includes(api))
  throw new Error(
    "Usage: npm run configure -- https://api.provider.com/v1 model [chat-completions|responses]",
  );
const url = new URL(base);
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash
)
  throw new Error(
    "The URL must use HTTPS without credentials, query parameters or a fragment.",
  );
// Only non-secret provider settings belong in the checked-in Worker configuration.
const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
config.vars.MODEL_BASE_URL = base.replace(/\/$/, "");
config.vars.MODEL_ID = model;
config.vars.MODEL_API = api;
await writeFile("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
console.log(
  "Provider configured. Set MODEL_API_KEY with wrangler secret put; do not include it here.",
);

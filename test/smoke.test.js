"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the original MLD logo is present and referenced by the app", () => {
  const logo = path.join(root, "public", "logo.svg.JPG");
  assert.ok(fs.existsSync(logo), "public/logo.svg.JPG must be preserved");
  assert.ok(fs.statSync(logo).size > 10000, "the original logo file must not be replaced with an empty placeholder");
  const html = read("public/index.html");
  const js = read("public/site.js");
  assert.match(html, /href="\/logo\.svg\.JPG"/);
  assert.match(js, /src="\/logo\.svg\.JPG"/);
});

test("the main HTML points to existing CSS and JavaScript assets", () => {
  const html = read("public/index.html");
  for (const [, asset] of html.matchAll(/(?:src|href)="\/(style\.css|site\.js)(?:\?[^"]*)?"/g)) {
    assert.ok(fs.existsSync(path.join(root, "public", asset)), `Missing public asset: ${asset}`);
  }
});

test("all registered UI pages have corresponding renderer functions", () => {
  const js = read("public/site.js");
  const registered = js.match(/const pages=\{([^}]+)\}/);
  assert.ok(registered, "page registry must exist");
  const names = registered[1].split(",").map((part) => part.trim().split(":").pop().trim());
  for (const name of names) {
    assert.match(js, new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`), `Missing renderer function: ${name}`);
  }
});

test("API method/path pairs are not registered more than once", () => {
  const source = read("index.js");
  const routes = [...source.matchAll(/app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)]
    .map((match) => `${match[1].toUpperCase()} ${match[2]}`);
  const seen = new Set();
  const duplicates = [];
  for (const route of routes) {
    if (seen.has(route)) duplicates.push(route);
    seen.add(route);
  }
  assert.deepEqual(duplicates, [], `Duplicate route registrations: ${duplicates.join(", ")}`);
});

test("essential API contracts and security middleware remain present", () => {
  const source = read("index.js");
  for (const route of [
    'app.get("/health"',
    'app.post("/api/auth/register"',
    'app.post("/api/auth/login"',
    'app.get("/api/games/sessions"',
    'app.post("/api/games/sessions"',
    'app.post("/api/ai/chat"',
    'app.post("/api/bots"',
    'app.get("/api/owner/logs"',
  ]) assert.ok(source.includes(route), `Required route missing: ${route}`);
  assert.match(source, /helmet\(/, "Helmet security middleware must remain enabled");
});

test("navigation includes every principal platform area", () => {
  const js = read("public/site.js");
  for (const key of ["home", "members", "top", "roles", "chat", "profile", "zajel", "games", "groups", "cinema", "tickets", "applications", "reviews", "account", "admin", "owner", "ai", "bots"]) {
    assert.ok(js.includes(key), `Navigation/page key missing: ${key}`);
  }
});

test("managed bots have real prefix commands, limited slash commands, and per-bot settings", () => {
  const source = read("index.js");
  const ui = read("public/site.js");
  assert.match(source, /client\.on\("messageCreate"/, "managed bots must handle message commands");
  assert.match(source, /client\.on\("interactionCreate"/, "managed bots must handle slash commands");
  assert.match(source, /GatewayIntentBits\.MessageContent/, "message commands require the Message Content intent");
  assert.match(source, /app\.patch\("\/api\/bots\/:id\/settings"/, "per-bot prefix/alias settings endpoint must exist");
  assert.match(ui, /data-bot-settings/, "the bot dashboard must expose settings controls");
  const registry = source.match(/const MANAGED_COMMANDS=new Set\(\[([^\]]+)\]\)/);
  assert.ok(registry, "managed command registry must exist");
  assert.ok(registry[1].split(",").length >= 30, "the registry should contain a meaningful set of real commands");
  assert.match(source, /name:"ping",description:/);
  assert.match(source, /name:"server",description:/);
  assert.match(source, /name:"botinfo",description:/);
});

test("per-command enable/disable settings are enforced by the server", () => {
  const source = read("index.js");
  const ui = read("public/site.js");
  assert.match(source, /bot\.disabledCommands\.includes\(command\)/);
  assert.match(source, /q\.body\.disabledCommands!==undefined/);
  assert.match(ui, /name="enabledCommands"/);
  assert.match(ui, /botCommandGroups/);
});

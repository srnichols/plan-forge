import { readFileSync } from "node:fs";

const h = readFileSync("docs/manual/competitive-loop.html", "utf8");
if (!h.includes("mermaid")) throw new Error("missing mermaid");
if (!h.toLowerCase().includes("worktree")) throw new Error("missing worktree narrative");
if (!h.toLowerCase().includes("winner")) throw new Error("missing winner narrative");

const il = readFileSync("docs/manual/inner-loop.html", "utf8");
if (!il.toLowerCase().includes("phase-26")) throw new Error("inner-loop.html missing Phase-26 section");
if (!il.includes("competitive-loop.html")) throw new Error("inner-loop.html missing cross-link");

const v = readFileSync("VERSION", "utf8").trim();
if (!v.startsWith("2.58")) throw new Error("VERSION not bumped: " + v);

const c = readFileSync("CHANGELOG.md", "utf8");
if (!c.includes("2.58.0")) throw new Error("CHANGELOG missing 2.58.0");
if (!c.toLowerCase().includes("competitive")) throw new Error("CHANGELOG missing competitive mention");

console.log("ok");

import { readFileSync } from "node:fs";

const p = "docs/manual/self-deterministic-loop.html";
const h = readFileSync(p, "utf8");
if (!h.includes("mermaid")) throw new Error(p + ": missing mermaid");
if (!h.includes("stateDiagram-v2")) throw new Error(p + ": missing stateDiagram-v2");
if (!h.includes("flowchart")) throw new Error(p + ": missing flowchart");

const subsystems = ["reflexion", "trajector", "auto-skill", "postmortem", "gate synth", "reviewer", "federation", "competitive", "auto-fix", "cost anomal"];
const low = h.toLowerCase();
for (const s of subsystems) {
  if (!low.includes(s)) throw new Error(p + ": missing subsystem mention: " + s);
}

const il = readFileSync("docs/manual/inner-loop.html", "utf8");
if (!il.includes("self-deterministic-loop.html")) throw new Error("inner-loop.html missing cross-link to master page");

const cl = readFileSync("docs/manual/competitive-loop.html", "utf8");
if (!cl.includes("self-deterministic-loop.html")) throw new Error("competitive-loop.html missing cross-link");

const idx = readFileSync("docs/manual/index.html", "utf8");
if (!idx.includes("self-deterministic-loop.html")) throw new Error("manual index missing nav entry");

const cap = readFileSync("docs/capabilities.md", "utf8");
if (!cap.toLowerCase().includes("self-deterministic agent loop")) throw new Error("capabilities.md missing new section");

const llms1 = readFileSync("llms.txt", "utf8").toLowerCase();
if (!llms1.includes("self-deterministic")) throw new Error("llms.txt not updated");

const llms2 = readFileSync("docs/llms.txt", "utf8").toLowerCase();
if (!llms2.includes("self-deterministic")) throw new Error("docs/llms.txt not updated");

for (const f of ["README.md", "docs/index.html", "docs/docs.html"]) {
  const x = readFileSync(f, "utf8").toLowerCase();
  if (!x.includes("self-deterministic") && !x.includes("inner loop")) {
    throw new Error(f + ": missing subtle loop mention");
  }
}

const faq = readFileSync("docs/faq.html", "utf8").toLowerCase();
if (!faq.includes("self-deterministic")) throw new Error("faq.html missing new entry");

const banned = ["revolutionary", "world-class", "world class", "unparalleled", "game-changer", "game changer"];
const scan = [p, "README.md", "docs/index.html", "docs/docs.html", "docs/faq.html", "docs/manual/inner-loop.html", "docs/manual/competitive-loop.html"];
for (const f of scan) {
  const x = readFileSync(f, "utf8").toLowerCase();
  for (const b of banned) {
    if (x.includes(b)) throw new Error(f + ": banned superlative: " + b);
  }
}

console.log("ok");

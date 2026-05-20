import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  handleSubmit as crucibleHandleSubmit,
  handleAsk as crucibleHandleAsk,
  handlePreview as crucibleHandlePreview,
  handleFinalize as crucibleHandleFinalize,
  handleList as crucibleHandleList,
  handleAbandon as crucibleHandleAbandon,
  CrucibleFinalizeRefusedError,
  CruciblePlanExistsError,
  CrucibleAskMismatchError,
} from "../../crucible-server.mjs";
import { loadCrucibleConfig, saveCrucibleConfig } from "../../crucible-config.mjs";
import { readManualImports } from "../../crucible-enforce.mjs";
import { PROJECT_DIR, activeHub } from "../state.mjs";

export function _registerCrucibleHotspotRoutes(app) {
  app.post("/api/crucible/submit", (req, res) => {
    try {
      const { rawIdea, lane = null, source = "human", parentSmeltId = null } = req.body || {};
      if (typeof rawIdea !== "string" || !rawIdea.trim()) {
        return res.status(400).json({ error: "rawIdea is required" });
      }
      const result = crucibleHandleSubmit({
        rawIdea,
        lane,
        source,
        parentSmeltId,
        projectDir: PROJECT_DIR,
        hub: activeHub,
      });
      res.status(201).json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/crucible/ask — record an answer and fetch the next question
  app.post("/api/crucible/ask", (req, res) => {
    try {
      const { id, answer, questionId } = req.body || {};
      if (typeof id !== "string" || !id) {
        return res.status(400).json({ error: "id is required" });
      }
      const result = crucibleHandleAsk({ id, answer, questionId, projectDir: PROJECT_DIR, hub: activeHub });
      res.json(result);
    } catch (err) {
      // Issue #138 — surface ASK_QUESTION_MISMATCH as 409 with the expected
      // pending question so the client can re-fetch and retry.
      if (err && err.code === "ASK_QUESTION_MISMATCH") {
        return res.status(409).json({
          error: err.message,
          code: err.code,
          expected: err.expected,
          got: err.got,
        });
      }
      const status = /not found/i.test(err.message) ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // GET /api/crucible/list — all smelts (optionally filtered by status)
  app.get("/api/crucible/list", (req, res) => {
    try {
      const status = typeof req.query?.status === "string" ? req.query.status : null;
      res.json(crucibleHandleList({ status, projectDir: PROJECT_DIR }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/crucible/preview?id=… — live markdown preview + unresolved fields
  app.get("/api/crucible/preview", (req, res) => {
    try {
      const id = typeof req.query?.id === "string" ? req.query.id : null;
      if (!id) return res.status(400).json({ error: "id is required" });
      res.json(crucibleHandlePreview({ id, projectDir: PROJECT_DIR }));
    } catch (err) {
      const status = /not found/i.test(err.message) ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // POST /api/crucible/finalize — emit docs/plans/Phase-NN.md
  app.post("/api/crucible/finalize", (req, res) => {
    try {
      const { id, overwrite } = req.body || {};
      if (typeof id !== "string" || !id) {
        return res.status(400).json({ error: "id is required" });
      }
      const result = crucibleHandleFinalize({
        id,
        projectDir: PROJECT_DIR,
        hub: activeHub,
        overwrite: overwrite === true,
      });
      res.status(201).json(result);
    } catch (err) {
      // Issue #136 — propagate criticalGaps so callers don't have to fall
      // back to GET /preview to discover what's missing.
      if (err instanceof CrucibleFinalizeRefusedError) {
        return res.status(409).json({
          error: "Cannot finalize: smelt has unresolved fields. Resolve required questions first.",
          criticalGaps: err.payload?.criticalGaps || [],
          unresolvedFields: err.payload?.criticalGaps || [],
          hint: err.payload?.hint || "GET /api/crucible/preview?id=... for details",
        });
      }
      // Issue #137 — surface "plan already exists" as 409 with a path hint
      // so callers can re-issue with overwrite:true if they really mean it.
      if (err && err.code === "PLAN_ALREADY_EXISTS") {
        return res.status(409).json({
          error: err.message,
          phaseName: err.phaseName,
          planPath: err.planPath,
          draftPath: err.draftPath,
          hint: "Re-submit with overwrite:true to replace, or accept the side-by-side draft path.",
        });
      }
      const status = /not found/i.test(err.message) ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // POST /api/crucible/abandon — mark a smelt abandoned (no plan written)
  app.post("/api/crucible/abandon", (req, res) => {
    try {
      const { id } = req.body || {};
      if (typeof id !== "string" || !id) {
        return res.status(400).json({ error: "id is required" });
      }
      const result = crucibleHandleAbandon({ id, projectDir: PROJECT_DIR });
      res.json(result);
    } catch (err) {
      const status = /not found/i.test(err.message) ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // GET /api/crucible/config — load Crucible config (defaults if absent)
  app.get("/api/crucible/config", (_req, res) => {
    try {
      res.json(loadCrucibleConfig(PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/crucible/config — persist Crucible config (sanitized)
  app.post("/api/crucible/config", (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ error: "body must be a JSON object" });
      }
      res.json(saveCrucibleConfig(PROJECT_DIR, req.body));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/crucible/manual-imports — read-only audit log for the
  // Governance tab. Newest first, capped at 500 so we never leak a
  // runaway log into the browser.
  app.get("/api/crucible/manual-imports", (_req, res) => {
    try {
      const entries = readManualImports(PROJECT_DIR);
      const capped = entries
        .slice()
        .reverse()
        .slice(0, 500);
      res.json({ total: entries.length, showing: capped.length, entries: capped });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/crucible/governance — read-only view of PROJECT-PRINCIPLES.md
  // and any project-profile files. Returns file content + mtime so the
  // Governance tab can render it and offer an "open in VS Code" deep link.
  app.get("/api/crucible/governance", (_req, res) => {
    try {
      const files = [
        { path: "docs/plans/PROJECT-PRINCIPLES.md", role: "principles" },
        { path: ".github/instructions/project-profile.instructions.md", role: "project-profile" },
        { path: ".github/instructions/project-principles.instructions.md", role: "principles-instruction" },
      ];
      const out = [];
      for (const f of files) {
        const abs = resolve(PROJECT_DIR, f.path);
        if (!existsSync(abs)) continue;
        try {
          const stat = statSync(abs);
          const content = readFileSync(abs, "utf-8");
          out.push({
            path: f.path,
            absolutePath: abs,
            role: f.role,
            mtime: stat.mtime.toISOString(),
            bytes: stat.size,
            content,
          });
        } catch { /* skip unreadable */ }
      }
      res.json({ files: out, readOnly: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/hotspots — git churn hotspot analysis (cache TTL 24h)
  app.get("/api/hotspots", (_req, res) => {
    try {
      const top = Math.max(1, Math.min(100, parseInt(_req.query.top) || 10));
      const since = _req.query.since || "6 months ago";
      const cacheFile = resolve(PROJECT_DIR, ".forge", "hotspot-cache.json");

      let cached = null;
      if (existsSync(cacheFile)) {
        try {
          cached = JSON.parse(readFileSync(cacheFile, "utf-8"));
          const age = Date.now() - new Date(cached.generatedAt).getTime();
          if (age > 24 * 60 * 60 * 1000 || cached.since !== since) cached = null;
        } catch { cached = null; }
      }

      if (!cached) {
        const raw = execSync(`git log --format=format: --name-only --since="${since}"`, { cwd: PROJECT_DIR, encoding: "utf-8", timeout: 30_000 });
        const counts = {};
        for (const line of raw.split("\n")) {
          const f = line.trim();
          if (f && !f.startsWith(".forge/")) counts[f] = (counts[f] || 0) + 1;
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const hotspots = sorted.map(([file, commits]) => ({ file, commits }));
        mkdirSync(resolve(PROJECT_DIR, ".forge"), { recursive: true });
        cached = { generatedAt: new Date().toISOString(), since, totalFiles: hotspots.length, hotspots };
        writeFileSync(cacheFile, JSON.stringify(cached, null, 2), "utf-8");
      }

      res.json({ ...cached, hotspots: cached.hotspots.slice(0, top), showing: Math.min(top, cached.hotspots.length) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/deps/watch — latest dependency vulnerability snapshot
}

// Suppress unused-import lint warnings for error classes used only as instanceof checks.
void CruciblePlanExistsError;
void CrucibleAskMismatchError;

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { getReviewerCalibration, federationReadTrajectories, loadFederationConfig, validateFederationConfig, TRAJECTORY_FEDERATION_LIMIT } from "../../brain.mjs";
import { listPendingAutoSkills } from "../../memory.mjs";
import { readForgeJsonl, PROPOSED_FIX_DIR } from "../../orchestrator.mjs";
import { PROJECT_DIR, activeAbortController } from "../state.mjs";

export function _registerInnerloopServerRoutes(app) {
  app.get("/api/innerloop/status", (_req, res) => {
    try {
      const cwd = PROJECT_DIR;
      const calibration = getReviewerCalibration(cwd);
      const skillsPending = listPendingAutoSkills({ cwd });
      const federation = loadFederationConfig(cwd);
      const federationErrors = validateFederationConfig(cwd);
      const fixProposals = readForgeJsonl("fix-proposals.json", [], cwd);
      const openFixProposals = fixProposals.filter(
        (p) => p && p.status !== "resolved" && p.status !== "closed"
      );
      res.json({
        reviewer: {
          eligible: calibration.eligible,
          count: calibration.count,
          threshold: calibration.threshold,
        },
        skills: {
          pendingCount: skillsPending.length,
        },
        federation: {
          enabled: federation.enabled,
          repoCount: federation.repos.length,
          configErrors: federationErrors.length,
        },
        autoFix: {
          openProposals: openFixProposals.length,
        },
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/innerloop/reviewer-calibration — count + threshold + eligibility
  app.get("/api/innerloop/reviewer-calibration", (_req, res) => {
    try {
      const result = getReviewerCalibration(PROJECT_DIR);
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/innerloop/gate-suggestions — recent accept events + per-key counters
  app.get("/api/innerloop/gate-suggestions", (_req, res) => {
    try {
      const cwd = PROJECT_DIR;
      const path = resolve(cwd, ".forge", "gate-suggestions.jsonl");
      if (!existsSync(path)) return res.json({ records: [], counters: {} });
      // Read last 200 accept events for the dashboard list.
      const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
      const records = [];
      for (const line of lines) {
        try {
          const rec = JSON.parse(line);
          if (rec && rec.type === "accept") records.push(rec);
        } catch { /* skip malformed */ }
      }
      const recent = records.slice(-200).reverse();
      const counters = {};
      for (const rec of records) {
        if (!rec.suggestionKey) continue;
        counters[rec.suggestionKey] = (counters[rec.suggestionKey] || 0) + 1;
      }
      res.json({ records: recent, counters });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/innerloop/cost-anomalies — detected anomalies from .forge/cost-anomalies.jsonl
  app.get("/api/innerloop/cost-anomalies", (_req, res) => {
    try {
      const cwd = PROJECT_DIR;
      const anomalies = readForgeJsonl("cost-anomalies.jsonl", [], cwd);
      // Latest 50, newest first.
      const recent = anomalies.slice(-50).reverse();
      res.json({ anomalies: recent, count: anomalies.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/innerloop/proposed-fixes — list .forge/proposed-fixes/*.patch
  app.get("/api/innerloop/proposed-fixes", (_req, res) => {
    try {
      const cwd = PROJECT_DIR;
      const dir = resolve(cwd, ".forge", PROPOSED_FIX_DIR);
      if (!existsSync(dir)) return res.json({ fixes: [] });
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith(".patch"));
      const fixes = [];
      for (const e of entries) {
        const fullPath = resolve(dir, e.name);
        try {
          const stat = statSync(fullPath);
          fixes.push({
            fixId: e.name.slice(0, -".patch".length),
            path: fullPath,
            sizeBytes: stat.size,
            mtimeMs: stat.mtimeMs,
          });
        } catch { /* skip unreadable */ }
      }
      fixes.sort((a, b) => b.mtimeMs - a.mtimeMs);
      res.json({ fixes });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/innerloop/federation — config + validation errors + recent trajectories
  app.get("/api/innerloop/federation", (req, res) => {
    try {
      const cwd = PROJECT_DIR;
      const config = loadFederationConfig(cwd);
      const errors = validateFederationConfig(cwd);
      let trajectories = [];
      if (config.enabled && config.repos.length > 0) {
        const limitQ = Number(req.query?.limit);
        const limit = Number.isFinite(limitQ) && limitQ > 0
          ? Math.min(limitQ, TRAJECTORY_FEDERATION_LIMIT)
          : 20;
        // Strip large `content` field for the list view.
        trajectories = federationReadTrajectories({ cwd, limit }).map((t) => ({
          repo: t.repo,
          planBasename: t.planBasename,
          sliceId: t.sliceId,
          mtimeMs: t.mtimeMs,
        }));
      }
      res.json({
        enabled: config.enabled,
        repos: config.repos,
        configErrors: errors,
        trajectories,
        limit: TRAJECTORY_FEDERATION_LIMIT,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/innerloop/federation/toggle — flip brain.federation.enabled in .forge.json
  // Body: { enabled: boolean }. Writes .forge.json atomically (read → merge → write).
  // Returns the updated state (same shape as GET minus trajectories).
  app.post("/api/innerloop/federation/toggle", (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || typeof req.body.enabled !== "boolean") {
        return res.status(400).json({ error: "body must be { enabled: boolean }" });
      }
      const configPath = resolve(PROJECT_DIR, ".forge.json");
      let cfg = {};
      if (existsSync(configPath)) {
        try { cfg = JSON.parse(readFileSync(configPath, "utf-8")); } catch {
          return res.status(500).json({ error: ".forge.json is not valid JSON" });
        }
      }
      if (!cfg.brain || typeof cfg.brain !== "object") cfg.brain = {};
      if (!cfg.brain.federation || typeof cfg.brain.federation !== "object") {
        cfg.brain.federation = { enabled: false, repos: [] };
      }
      cfg.brain.federation.enabled = req.body.enabled;
      if (!Array.isArray(cfg.brain.federation.repos)) cfg.brain.federation.repos = [];
      writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
      const updated = loadFederationConfig(PROJECT_DIR);
      const errors = validateFederationConfig(PROJECT_DIR);
      res.json({ enabled: updated.enabled, repos: updated.repos, configErrors: errors });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/server/restart — exit the MCP/HTTP server process so the
  // supervising MCP client (VS Code, etc.) respawns it with freshly-loaded
  // code. Useful immediately after `pforge self-update` replaces files on
  // disk but the running process still has the old code in memory.
  //
  // Guards: refuses while a plan run is active (same guard as self-update).
  // Response returns 202 BEFORE the actual exit so the browser sees the ack.
  let _lastRestartTs = 0;
  const _RESTART_COOLDOWN_MS = 10 * 1000;
  app.post("/api/server/restart", (_req, res) => {
    try {
      if (activeAbortController) {
        return res.status(409).json({ error: "Cannot restart during active plan run", code: "ERR_RESTART_DURING_RUN" }); // TODO: enum migration
      }
      const now = Date.now();
      if (now - _lastRestartTs < _RESTART_COOLDOWN_MS) {
        const retryAfterMs = _RESTART_COOLDOWN_MS - (now - _lastRestartTs);
        return res.status(429).json({ error: "Rate limited", retryAfterMs });
      }
      _lastRestartTs = now;
      res.status(202).json({ ok: true, message: "Server exiting — the MCP client should respawn it automatically" });
      // Flush the response, then exit. 500ms gives Express time to drain.
      setTimeout(() => {
        try { console.log("[restart] exiting on /api/server/restart request"); } catch {}
        process.exit(0);
      }, 500).unref?.();
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── Phase-26 Slice 14: Dashboard UI state ──────────────────────────
  //
  // Stores per-user-machine dashboard preferences (welcome-card dismissal,
  // feature-tour progress). Kept in `.forge/dashboard-state.json` so it is
  // gitignored by default along with the rest of `.forge/`. Schema is an
  // arbitrary object — the dashboard owns the shape.
  app.get("/api/dashboard-state", (_req, res) => {
    try {
      const path = resolve(PROJECT_DIR, ".forge", "dashboard-state.json");
      if (!existsSync(path)) return res.json({});
      res.json(JSON.parse(readFileSync(path, "utf-8")));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/dashboard-state", (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ error: "Request body must be a JSON object" });
      }
      const dir = resolve(PROJECT_DIR, ".forge");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const path = resolve(dir, "dashboard-state.json");
      // Merge onto existing state so partial updates don't wipe other keys.
      let current = {};
      if (existsSync(path)) {
        try { current = JSON.parse(readFileSync(path, "utf-8")); } catch { current = {}; }
        if (!current || typeof current !== "object" || Array.isArray(current)) current = {};
      }
      const merged = { ...current, ...req.body };
      writeFileSync(path, JSON.stringify(merged, null, 2));
      res.json({ success: true, state: merged });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/config — read .forge.json
}

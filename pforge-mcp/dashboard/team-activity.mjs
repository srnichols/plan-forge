export function renderTeamActivityPanel(activities) {
  if (!activities || activities.length === 0) {
    return `<div class="team-activity-empty text-slate-500 text-sm p-4">
      No team activity yet. Activity is recorded after each plan run.<br/>
      <code class="text-amber-400">pforge team activity</code> to check.
    </div>`;
  }
  const rows = activities.slice(0, 10).map((a) => {
    const ago = formatRelativeTime(a.timestamp);
    const status = a.status === "completed" ? "✅" : a.status === "aborted" ? "⚠️" : "❌";
    return `<tr class="border-b border-slate-700">
      <td class="py-1 pr-4 text-slate-400 text-xs whitespace-nowrap">${ago}</td>
      <td class="py-1 pr-4">${status}</td>
      <td class="py-1 pr-4 text-slate-300 text-sm truncate max-w-xs">${a.plan ?? "—"}</td>
      <td class="py-1 pr-4 text-slate-400 text-xs">${a.operator?.split("<")[0].trim() ?? "—"}</td>
      <td class="py-1 text-amber-400 text-xs">${a.cost_usd != null ? "$" + Number(a.cost_usd).toFixed(2) : "—"}</td>
    </tr>`;
  }).join("");
  return `<div class="team-activity-panel">
    <table class="w-full text-left"><tbody>${rows}</tbody></table>
  </div>`;
}

function formatRelativeTime(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  return Math.floor(diff / 86400000) + "d ago";
}

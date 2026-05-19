import { buildServerSurface } from './server.mjs';
import { writeFileSync } from 'node:fs';
const surface = buildServerSurface();
writeFileSync('./tests/fixtures/server-surface.golden.json', JSON.stringify(surface, null, 2));
console.log('Generated:', surface.tools.length, 'tools,', surface.restRoutes.length, 'routes,', surface.mcpOnlyTools.length, 'mcpOnly');

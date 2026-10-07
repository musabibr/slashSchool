import type { ModuleDeps, ModuleRouters } from '../types';
import { registerSetup } from './setup';
import { registerStudents } from './students';

/** People & school setup: structure, staff, settings, dashboard (setup.ts) and students/guardians (students.ts). */
export function register(routers: ModuleRouters, deps: ModuleDeps): void {
  registerSetup(routers, deps);
  registerStudents(routers, deps);
}

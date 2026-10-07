import type { ModuleDeps, ModuleRouters, RegisterModule } from './types';
import { register as assessment } from './assessment';
import { register as attendance } from './attendance';
import { register as behavior } from './behavior';
import { register as comms } from './comms';
import { register as fees } from './fees';
import { register as lessons } from './lessons';
import { register as people } from './people';
import { register as timetable } from './timetable';

const MODULES: RegisterModule[] = [people, lessons, attendance, assessment, behavior, fees, comms, timetable];

export function registerModules(routers: ModuleRouters, deps: ModuleDeps) {
  for (const register of MODULES) register(routers, deps);
}

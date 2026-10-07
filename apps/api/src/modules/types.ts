import type { Router } from 'express';
import type { Config } from '../config';
import type { Db } from '../db/client';

export interface ModuleDeps {
  db: Db;
  config: Config;
}

/**
 * Routers a module mounts its endpoints on:
 *  - school:  /api/schools/:schoolId/*   (staff: admin / supervisor / teacher; req.school is set)
 *  - student: /api/students/:studentId/* (guardians of the student + staff of its school; req.student & req.school set)
 */
export interface ModuleRouters {
  school: Router;
  student: Router;
}

export type RegisterModule = (routers: ModuleRouters, deps: ModuleDeps) => void;

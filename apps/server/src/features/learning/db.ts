/**
 * The database handles every Learning service function takes first (0007 section 2.1). Stand-ins until core's
 * apps/server/src/db lands on main; then this file becomes `export type { Db, Tx } from '../../db';`.
 */
export type Db = object;
export type Tx = Db;
